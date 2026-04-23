import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  BatchV1Api,
  type CoreV1Event,
  CoreV1Api,
  KubeConfig,
  type V1ConfigMap,
  type V1Job,
  type V1JobCondition,
  type V1Pod,
  type V1Service,
} from "@kubernetes/client-node";
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { trainingJobs } from "@/server/db/schema";
import {
  type TrainingDistributedBackend,
  type TrainingJobStatus,
  type TrainingLauncherType,
  trainingK8sSupportedJobTypes,
} from "@/server/training/catalog";

const K8S_INFRA_DIR = path.join(process.cwd(), "infra", "k8s");
const CLUSTER_CONFIG_PATH = path.join(K8S_INFRA_DIR, "cluster", "config.json");
const TRAINING_CONFIG_MOUNT_PATH = "/etc/cola-training";
const TRAINING_SCRIPT_NAME = "train.py";
const DEEPSPEED_CONFIG_NAME = "deepspeed.json";
const MASTER_PORT = Number(process.env.COLA_TRAINING_MASTER_PORT ?? "29500");

function resolveTrainingRuntimeClassName() {
  const runtimeClassName = process.env.COLA_TRAINING_RUNTIME_CLASS_NAME?.trim();
  return runtimeClassName && runtimeClassName.length > 0
    ? runtimeClassName
    : null;
}

type ClusterConfig = {
  clusterName: string;
  workspaceNamespace?: string;
  gpuLabelKey?: string;
};

type TrainingJobRecord = typeof trainingJobs.$inferSelect;

type TrainingKubeContext = {
  namespace: string;
  gpuLabelKey: string;
  batchApi: BatchV1Api;
  coreApi: CoreV1Api;
  image: string;
};

type TrainingRuntimeLaunch = {
  namespace: string;
  kind: "indexed-job";
  jobName: string;
  serviceName: string;
  leaderPodName: string;
  image: string;
  artifactPath: string;
};

type ResolvedTrainingConfig = {
  datasetSplit: string;
  datasetTextField: string;
  nodeCount: number;
  gpusPerNode: number;
  launcherType: TrainingLauncherType;
  distributedBackend: TrainingDistributedBackend;
  deepspeedStage: number | null;
  precision: string;
  loadIn4bit: boolean;
};

type TrainingRuntimeManifest = {
  runtimeJobName: string;
  runtimeServiceName: string;
  runtimeConfigMapName: string;
  leaderPodName: string;
  artifactPath: string;
  serviceSpec: V1Service;
  configMapSpec: V1ConfigMap;
  jobSpec: V1Job;
};

type TrainingRuntimeJobReference = {
  namespace: string;
  jobName: string;
};

export type TrainingRuntimePodSummary = {
  name: string;
  phase: string;
  reason: string | null;
  nodeName: string | null;
  podIP: string | null;
  hostIP: string | null;
  startedAt: Date | null;
  completionIndex: string | null;
  ready: boolean;
  restarts: number;
  containerStatuses: Array<{
    name: string;
    ready: boolean;
    restartCount: number;
    state: string;
  }>;
};

export type TrainingRuntimeEventSummary = {
  type: string | null;
  reason: string | null;
  message: string;
  count: number;
  at: Date | null;
  source: string | null;
  involvedKind: string | null;
  involvedName: string | null;
};

export type TrainingRuntimeInspection = {
  namespace: string;
  jobName: string;
  serviceName: string | null;
  leaderPodName: string | null;
  selectedPodName: string | null;
  logText: string | null;
  pods: TrainingRuntimePodSummary[];
  events: TrainingRuntimeEventSummary[];
};

export type TrainingRuntimeInlineSummary = {
  runtimeSummary: string | null;
  runtimeSummaryTone: "neutral" | "success" | "warning" | "error";
  runtimeSummaryCategory:
    | "none"
    | "scheduling"
    | "creation"
    | "runtime"
    | "progress"
    | "success";
  runtimeSummaryAt: Date | null;
};

export type TrainingJobListItem = TrainingJobRecord &
  TrainingRuntimeInlineSummary;

function readClusterConfig() {
  return JSON.parse(
    fs.readFileSync(CLUSTER_CONFIG_PATH, "utf8"),
  ) as ClusterConfig;
}

function resolveKubeconfigPath(clusterName: string) {
  return (
    process.env.COLA_TRAINING_KUBECONFIG_PATH?.trim() ??
    process.env.REMOTE_WORK_KUBECONFIG_PATH ??
    process.env.WORKSPACE_KUBECONFIG ??
    path.join("/etc/kubeasz", "clusters", clusterName, "kubectl.kubeconfig")
  );
}

function resolveTrainingNamespace(config: ClusterConfig) {
  return (
    process.env.COLA_TRAINING_K8S_NAMESPACE?.trim() ??
    config.workspaceNamespace ??
    "default"
  );
}

function resolveTrainingImage() {
  return (
    process.env.COLA_TRAINING_K8S_IMAGE?.trim() ?? "unsloth/unsloth:latest"
  );
}

function createKubeConfig(clusterName: string) {
  const kubeConfig = new KubeConfig();

  if (
    process.env.KUBERNETES_SERVICE_HOST &&
    process.env.KUBERNETES_SERVICE_PORT
  ) {
    try {
      kubeConfig.loadFromCluster();
      return kubeConfig;
    } catch (error) {
      console.warn(
        "[training] failed to load in-cluster kubeconfig, falling back to file",
        error,
      );
    }
  }

  const kubeconfigPath = resolveKubeconfigPath(clusterName);
  fs.accessSync(kubeconfigPath, fs.constants.R_OK);
  kubeConfig.loadFromFile(kubeconfigPath);
  return kubeConfig;
}

async function createKubeContext(): Promise<TrainingKubeContext> {
  const config = readClusterConfig();
  const kubeConfig = createKubeConfig(config.clusterName);

  return {
    namespace: resolveTrainingNamespace(config),
    gpuLabelKey: config.gpuLabelKey ?? "remote-work/gpu",
    image: resolveTrainingImage(),
    batchApi: kubeConfig.makeApiClient(BatchV1Api),
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
  };
}

function getErrorStatus(error: unknown) {
  const candidate = error as {
    statusCode?: number;
    code?: number;
    body?: { code?: number };
    response?: { statusCode?: number };
  };

  return (
    candidate.statusCode ??
    candidate.code ??
    candidate.body?.code ??
    candidate.response?.statusCode ??
    null
  );
}

function isNotFoundError(error: unknown) {
  return getErrorStatus(error) === 404;
}

async function namespaceExists(coreApi: CoreV1Api, namespace: string) {
  try {
    await coreApi.readNamespace({ name: namespace });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function ensureNamespace(coreApi: CoreV1Api, namespace: string) {
  if (await namespaceExists(coreApi, namespace)) return;

  await coreApi.createNamespace({
    body: {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace },
    },
  });
}

function slugify(input: string) {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "job";
}

function appendDnsLabelSuffix(base: string, suffix: string) {
  const normalizedSuffix = suffix.replace(/^-+/, "");
  const maxBaseLength = Math.max(1, 63 - normalizedSuffix.length - 1);
  const trimmedBase = base.slice(0, maxBaseLength).replace(/-+$/g, "") || "job";
  return `${trimmedBase}-${normalizedSuffix}`.slice(0, 63).replace(/-+$/g, "");
}

function buildRuntimeJobName(job: TrainingJobRecord) {
  const prefix = "cola-train";
  const suffix = `${job.id.slice(0, 8)}-${Date.now().toString(36).slice(-6)}`;
  const maxSlugLength = Math.max(8, 63 - prefix.length - suffix.length - 2);
  const slug = slugify(job.title).slice(0, maxSlugLength).replace(/-+$/g, "");

  return `${prefix}-${slug || "job"}-${suffix}`
    .slice(0, 63)
    .replace(/-+$/g, "");
}

function buildRuntimeServiceName(runtimeJobName: string) {
  return appendDnsLabelSuffix(runtimeJobName, "svc");
}

function buildRuntimeConfigMapName(runtimeJobName: string) {
  return appendDnsLabelSuffix(runtimeJobName, "cfg");
}

function buildLeaderPodName(runtimeJobName: string) {
  return appendDnsLabelSuffix(runtimeJobName, "0");
}

function resolveArtifactPath(job: TrainingJobRecord, runtimeJobName: string) {
  const outputRoot =
    process.env.COLA_TRAINING_OUTPUT_ROOT?.trim() ?? "/workspace/cola-training";
  return path.posix.join(outputRoot, job.id, runtimeJobName);
}

function resolveWorkVolume() {
  const pvcName = process.env.COLA_TRAINING_PVC_NAME?.trim();
  if (pvcName) {
    return {
      volume: {
        name: "training-workdir",
        persistentVolumeClaim: {
          claimName: pvcName,
        },
      },
      mountPath:
        process.env.COLA_TRAINING_PVC_MOUNT_PATH?.trim() ?? "/workspace",
    };
  }

  return {
    volume: {
      name: "training-workdir",
      emptyDir: {},
    },
    mountPath: "/workspace",
  };
}

function resolveTrainingConfig(job: TrainingJobRecord): ResolvedTrainingConfig {
  const nodeCount = Math.max(1, job.nodeCount ?? 1);
  const gpusPerNode = Math.max(1, job.gpusPerNode ?? Math.max(1, job.gpuCount));
  const datasetSplit = job.datasetSplit?.trim();
  const datasetTextField = job.datasetTextField?.trim();
  const precision = job.precision?.trim();
  const launcherType: TrainingLauncherType =
    nodeCount > 1 || gpusPerNode > 1
      ? "torchrun"
      : job.launcherType === "python"
        ? "python"
        : "torchrun";
  const distributedBackend: TrainingDistributedBackend =
    job.distributedBackend === "deepspeed" ? "deepspeed" : "none";

  return {
    datasetSplit:
      (datasetSplit && datasetSplit.length > 0 ? datasetSplit : undefined) ??
      process.env.COLA_TRAINING_DATASET_SPLIT?.trim() ??
      "train",
    datasetTextField:
      (datasetTextField && datasetTextField.length > 0
        ? datasetTextField
        : undefined) ??
      process.env.COLA_TRAINING_DATASET_TEXT_FIELD?.trim() ??
      "text",
    nodeCount,
    gpusPerNode,
    launcherType,
    distributedBackend,
    deepspeedStage:
      distributedBackend === "deepspeed"
        ? Math.min(3, Math.max(2, job.deepspeedStage ?? 2))
        : null,
    precision:
      (precision && precision.length > 0 ? precision : undefined) ?? "bf16",
    loadIn4bit: job.loadIn4bit ?? true,
  };
}

function resolveCpuRequest(gpusPerNode: number) {
  return (
    process.env.COLA_TRAINING_CPU_REQUEST?.trim() ??
    `${Math.max(4, gpusPerNode * 4)}`
  );
}

function resolveMemoryRequest(gpusPerNode: number) {
  return (
    process.env.COLA_TRAINING_MEMORY_REQUEST?.trim() ??
    `${Math.max(24, gpusPerNode * 24)}Gi`
  );
}

function buildJobSpecPayload(
  job: TrainingJobRecord,
  config: ResolvedTrainingConfig,
) {
  return JSON.stringify({
    id: job.id,
    title: job.title,
    jobType: job.jobType,
    baseModel: job.baseModel,
    datasetName: job.datasetName,
    datasetSplit: config.datasetSplit,
    datasetTextField: config.datasetTextField,
    objective: job.objective,
    gpuCount: job.gpuCount,
    nodeCount: config.nodeCount,
    gpusPerNode: config.gpusPerNode,
    launcherType: config.launcherType,
    distributedBackend: config.distributedBackend,
    deepspeedStage: config.deepspeedStage,
    precision: config.precision,
    loadIn4bit: config.loadIn4bit,
    trainingConfigSnapshot: job.trainingConfigSnapshot ?? null,
  });
}

function buildTrainingPythonProgram() {
  return [
    "import json",
    "import os",
    "from pathlib import Path",
    "",
    "import torch",
    "from datasets import load_dataset",
    "from unsloth import FastLanguageModel",
    "from trl import SFTConfig, SFTTrainer",
    "",
    "job = json.loads(os.environ['COLA_JOB_SPEC'])",
    "job_type = job['jobType']",
    "dataset_name = job['datasetName']",
    "dataset_split = os.environ.get('COLA_DATASET_SPLIT', 'train')",
    "dataset_text_field = os.environ.get('COLA_DATASET_TEXT_FIELD', 'text')",
    "deepspeed_config_path = os.environ.get('COLA_DEEPSPEED_CONFIG_PATH', '').strip()",
    "precision = os.environ.get('COLA_PRECISION', 'bf16').strip().lower()",
    "rank = int(os.environ.get('RANK', '0'))",
    "world_size = int(os.environ.get('WORLD_SIZE', '1'))",
    "artifact_dir = Path(os.environ['COLA_ARTIFACT_DIR'])",
    "artifact_dir.mkdir(parents=True, exist_ok=True)",
    "",
    "if job_type == 'dpo':",
    "    raise RuntimeError('当前 Kubernetes Unsloth 执行器 MVP 暂不支持 DPO 数据集，请先使用 SFT、LoRA 或 pretrain 类型。')",
    "",
    "def load_training_dataset(source):",
    "    lower = source.lower()",
    "    if lower.endswith('.json') or lower.endswith('.jsonl'):",
    "        return load_dataset('json', data_files=source, split=dataset_split)",
    "    if lower.endswith('.csv'):",
    "        return load_dataset('csv', data_files=source, split=dataset_split)",
    "    if lower.endswith('.tsv'):",
    "        return load_dataset('csv', data_files=source, split=dataset_split, delimiter='\\t')",
    "    if lower.endswith('.parquet'):",
    "        return load_dataset('parquet', data_files=source, split=dataset_split)",
    "    return load_dataset(source, split=dataset_split)",
    "",
    "dataset = load_training_dataset(dataset_name)",
    "if dataset_text_field not in dataset.column_names:",
    "    raise RuntimeError(\"数据集缺少文本字段 '{}'，实际字段: {}\".format(dataset_text_field, dataset.column_names))",
    "if dataset_text_field != 'text':",
    "    dataset = dataset.rename_column(dataset_text_field, 'text')",
    "",
    "max_seq_length = int(os.environ.get('COLA_MAX_SEQ_LENGTH', '2048'))",
    "load_in_4bit = os.environ.get('COLA_LOAD_IN_4BIT', 'true').lower() == 'true'",
    "model, tokenizer = FastLanguageModel.from_pretrained(",
    "    model_name=job['baseModel'],",
    "    max_seq_length=max_seq_length,",
    "    dtype=None,",
    "    load_in_4bit=load_in_4bit,",
    ")",
    "",
    "use_lora = job_type in {'sft', 'lora'}",
    "if use_lora:",
    "    model = FastLanguageModel.get_peft_model(",
    "        model,",
    "        r=int(os.environ.get('COLA_LORA_RANK', '16')),",
    "        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],",
    "        lora_alpha=int(os.environ.get('COLA_LORA_ALPHA', '16')),",
    "        lora_dropout=float(os.environ.get('COLA_LORA_DROPOUT', '0')),",
    "        bias='none',",
    "        use_gradient_checkpointing='unsloth',",
    "        random_state=int(os.environ.get('COLA_RANDOM_SEED', '3407')),",
    "        use_rslora=False,",
    "        loftq_config=None,",
    "    )",
    "",
    "bf16 = precision == 'bf16' or (precision == 'auto' and torch.cuda.is_bf16_supported())",
    "fp16 = precision == 'fp16' or (precision == 'auto' and not torch.cuda.is_bf16_supported())",
    "",
    "sft_config_kwargs = {",
    "    'max_length': max_seq_length,",
    "    'dataset_text_field': 'text',",
    "    'per_device_train_batch_size': int(os.environ.get('COLA_PER_DEVICE_BATCH_SIZE', '2')),",
    "    'gradient_accumulation_steps': int(os.environ.get('COLA_GRADIENT_ACCUMULATION_STEPS', '4')),",
    "    'warmup_steps': int(os.environ.get('COLA_WARMUP_STEPS', '5')),",
    "    'max_steps': int(os.environ.get('COLA_MAX_STEPS', '60')),",
    "    'learning_rate': float(os.environ.get('COLA_LEARNING_RATE', '2e-4')),",
    "    'logging_steps': int(os.environ.get('COLA_LOGGING_STEPS', '1')),",
    "    'optim': os.environ.get('COLA_OPTIM', 'adamw_8bit'),",
    "    'weight_decay': float(os.environ.get('COLA_WEIGHT_DECAY', '0.01')),",
    "    'lr_scheduler_type': os.environ.get('COLA_LR_SCHEDULER_TYPE', 'linear'),",
    "    'seed': int(os.environ.get('COLA_RANDOM_SEED', '3407')),",
    "    'output_dir': str(artifact_dir),",
    "    'save_strategy': 'steps',",
    "    'save_steps': int(os.environ.get('COLA_SAVE_STEPS', '20')),",
    "    'save_total_limit': int(os.environ.get('COLA_SAVE_TOTAL_LIMIT', '2')),",
    "    'report_to': 'none',",
    "    'fp16': fp16,",
    "    'bf16': bf16,",
    "}",
    "if deepspeed_config_path:",
    "    sft_config_kwargs['deepspeed'] = deepspeed_config_path",
    "if world_size > 1 or deepspeed_config_path:",
    "    sft_config_kwargs['ddp_find_unused_parameters'] = False",
    "",
    "trainer = SFTTrainer(",
    "    model=model,",
    "    processing_class=tokenizer,",
    "    train_dataset=dataset,",
    "    args=SFTConfig(**sft_config_kwargs),",
    ")",
    "trainer.train()",
    "",
    "if torch.distributed.is_available() and torch.distributed.is_initialized():",
    "    torch.distributed.barrier()",
    "",
    "output_dir = artifact_dir / ('adapter' if use_lora else 'model')",
    "if rank == 0:",
    "    output_dir.mkdir(parents=True, exist_ok=True)",
    "    if deepspeed_config_path or world_size > 1:",
    "        trainer.save_model(str(output_dir))",
    "    else:",
    "        model.save_pretrained(str(output_dir))",
    "    tokenizer.save_pretrained(str(output_dir))",
    "    with open(artifact_dir / 'job-result.json', 'w', encoding='utf-8') as handle:",
    "        json.dump({",
    "            'jobId': job['id'],",
    "            'jobType': job_type,",
    "            'artifactDir': str(output_dir),",
    "            'dataset': dataset_name,",
    "            'baseModel': job['baseModel'],",
    "            'worldSize': world_size,",
    "            'launcherType': job.get('launcherType'),",
    "            'distributedBackend': job.get('distributedBackend'),",
    "            'deepspeedStage': job.get('deepspeedStage'),",
    "        }, handle, ensure_ascii=False, indent=2)",
    "",
    "if torch.distributed.is_available() and torch.distributed.is_initialized():",
    "    torch.distributed.barrier()",
    "",
    "if rank == 0:",
    "    print('Training finished. Artifacts written to {}'.format(output_dir))",
  ].join("\n");
}

function buildDeepSpeedConfig(stage: number | null) {
  if (!stage) return null;

  return JSON.stringify(
    {
      bf16: { enabled: "auto" },
      zero_optimization: {
        stage,
        overlap_comm: true,
        contiguous_gradients: true,
        reduce_scatter: true,
        allgather_partitions: true,
      },
      gradient_clipping: "auto",
      train_micro_batch_size_per_gpu: "auto",
      train_batch_size: "auto",
      gradient_accumulation_steps: "auto",
    },
    null,
    2,
  );
}

function buildTrainingShellCommand() {
  return [
    "set -eu",
    'mkdir -p "$COLA_ARTIFACT_DIR"',
    'export COLA_NODE_RANK="${JOB_COMPLETION_INDEX:-0}"',
    'if [ "$COLA_LAUNCHER_TYPE" = "torchrun" ]; then',
    "  exec torchrun \\",
    '    --nnodes="$COLA_NODE_COUNT" \\',
    '    --nproc_per_node="$COLA_GPUS_PER_NODE" \\',
    '    --node_rank="$COLA_NODE_RANK" \\',
    '    --master_addr="$COLA_MASTER_ADDR" \\',
    '    --master_port="$COLA_MASTER_PORT" \\',
    '    "$COLA_TRAIN_SCRIPT_PATH"',
    "fi",
    'exec python -u "$COLA_TRAIN_SCRIPT_PATH"',
  ].join("\n");
}

function buildTrainingConfigMap(
  runtimeConfigMapName: string,
  labels: Record<string, string>,
  config: ResolvedTrainingConfig,
) {
  const data: Record<string, string> = {
    [TRAINING_SCRIPT_NAME]: buildTrainingPythonProgram(),
  };
  const deepspeedConfig = buildDeepSpeedConfig(config.deepspeedStage);
  if (deepspeedConfig) {
    data[DEEPSPEED_CONFIG_NAME] = deepspeedConfig;
  }

  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: runtimeConfigMapName,
      labels,
    },
    data,
  } satisfies V1ConfigMap;
}

function buildHeadlessService(
  runtimeServiceName: string,
  labels: Record<string, string>,
  masterPort: number,
) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: runtimeServiceName,
      labels,
    },
    spec: {
      clusterIP: "None",
      publishNotReadyAddresses: true,
      selector: labels,
      ports: [
        {
          name: "torchrun",
          port: masterPort,
          targetPort: masterPort,
          protocol: "TCP",
        },
      ],
    },
  } satisfies V1Service;
}

function buildTrainingRuntime(
  job: TrainingJobRecord,
  ctx: TrainingKubeContext,
) {
  const config = resolveTrainingConfig(job);
  const runtimeJobName = buildRuntimeJobName(job);
  const runtimeServiceName = buildRuntimeServiceName(runtimeJobName);
  const runtimeConfigMapName = buildRuntimeConfigMapName(runtimeJobName);
  const leaderPodName = buildLeaderPodName(runtimeJobName);
  const artifactPath = resolveArtifactPath(job, runtimeJobName);
  const cpuRequest = resolveCpuRequest(config.gpusPerNode);
  const memoryRequest = resolveMemoryRequest(config.gpusPerNode);
  const { volume, mountPath } = resolveWorkVolume();
  const labels = {
    "app.kubernetes.io/name": "cola-training",
    "app.kubernetes.io/component": "unsloth-job",
    "app.kubernetes.io/managed-by": "cola",
    "cola.training/job-id": job.id,
    "cola.training/type": job.jobType,
    "cola.training/runtime-name": runtimeJobName,
  };
  const masterAddress = `${leaderPodName}.${runtimeServiceName}.${ctx.namespace}.svc.cluster.local`;
  const hfHome =
    process.env.COLA_TRAINING_HF_HOME ?? path.posix.join(mountPath, ".hf");
  const runtimeClassName = resolveTrainingRuntimeClassName();

  const env: Array<{
    name: string;
    value?: string;
    valueFrom?: {
      fieldRef?: {
        fieldPath: string;
      };
      secretKeyRef?: {
        name: string;
        key: string;
      };
    };
  }> = [
    { name: "TZ", value: process.env.COLA_TRAINING_TZ ?? "Asia/Shanghai" },
    { name: "COLA_JOB_SPEC", value: buildJobSpecPayload(job, config) },
    { name: "COLA_ARTIFACT_DIR", value: artifactPath },
    { name: "COLA_DATASET_SPLIT", value: config.datasetSplit },
    { name: "COLA_DATASET_TEXT_FIELD", value: config.datasetTextField },
    { name: "COLA_NODE_COUNT", value: String(config.nodeCount) },
    { name: "COLA_GPUS_PER_NODE", value: String(config.gpusPerNode) },
    { name: "COLA_MASTER_ADDR", value: masterAddress },
    { name: "COLA_MASTER_PORT", value: String(MASTER_PORT) },
    { name: "COLA_LAUNCHER_TYPE", value: config.launcherType },
    { name: "COLA_PRECISION", value: config.precision },
    { name: "COLA_LOAD_IN_4BIT", value: String(config.loadIn4bit) },
    {
      name: "COLA_TRAIN_SCRIPT_PATH",
      value: path.posix.join(TRAINING_CONFIG_MOUNT_PATH, TRAINING_SCRIPT_NAME),
    },
    {
      name: "HF_HOME",
      value: hfHome,
    },
    {
      name: "TRANSFORMERS_CACHE",
      value: hfHome,
    },
    {
      name: "NCCL_DEBUG",
      value: process.env.COLA_TRAINING_NCCL_DEBUG ?? "warn",
    },
    {
      name: "TORCH_DISTRIBUTED_DEBUG",
      value: process.env.COLA_TRAINING_TORCH_DISTRIBUTED_DEBUG ?? "DETAIL",
    },
    {
      name: "JOB_COMPLETION_INDEX",
      valueFrom: {
        fieldRef: {
          fieldPath:
            "metadata.annotations['batch.kubernetes.io/job-completion-index']",
        },
      },
    },
  ];

  if (config.deepspeedStage) {
    env.push({
      name: "COLA_DEEPSPEED_CONFIG_PATH",
      value: path.posix.join(TRAINING_CONFIG_MOUNT_PATH, DEEPSPEED_CONFIG_NAME),
    });
  }

  const hfSecretName = process.env.COLA_TRAINING_HF_SECRET_NAME?.trim();
  const hfSecretKey =
    process.env.COLA_TRAINING_HF_SECRET_KEY?.trim() ?? "HF_TOKEN";

  if (hfSecretName) {
    for (const envName of ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"]) {
      env.push({
        name: envName,
        valueFrom: {
          secretKeyRef: {
            name: hfSecretName,
            key: hfSecretKey,
          },
        },
      });
    }
  }

  const resources = {
    requests: {
      cpu: cpuRequest,
      memory: memoryRequest,
      "nvidia.com/gpu": `${config.gpusPerNode}`,
    },
    limits: {
      cpu: process.env.COLA_TRAINING_CPU_LIMIT?.trim() ?? cpuRequest,
      memory: process.env.COLA_TRAINING_MEMORY_LIMIT?.trim() ?? memoryRequest,
      "nvidia.com/gpu": `${config.gpusPerNode}`,
    },
  };

  const serviceSpec = buildHeadlessService(
    runtimeServiceName,
    labels,
    MASTER_PORT,
  );
  const configMapSpec = buildTrainingConfigMap(
    runtimeConfigMapName,
    labels,
    config,
  );
  const jobSpec = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: runtimeJobName,
      namespace: ctx.namespace,
      labels,
      annotations: {
        "cola.training/title": job.title,
      },
    },
    spec: {
      completionMode: "Indexed",
      completions: config.nodeCount,
      parallelism: config.nodeCount,
      backoffLimit: Number(process.env.COLA_TRAINING_BACKOFF_LIMIT ?? "0"),
      ttlSecondsAfterFinished: Number(
        process.env.COLA_TRAINING_TTL_SECONDS_AFTER_FINISHED ?? "86400",
      ),
      template: {
        metadata: {
          labels,
        },
        spec: {
          restartPolicy: "Never",
          subdomain: runtimeServiceName,
          ...(runtimeClassName ? { runtimeClassName } : {}),
          ...(process.env.COLA_TRAINING_SERVICE_ACCOUNT?.trim()
            ? {
                serviceAccountName:
                  process.env.COLA_TRAINING_SERVICE_ACCOUNT.trim(),
              }
            : {}),
          nodeSelector: {
            [ctx.gpuLabelKey]: "true",
          },
          affinity: {
            podAntiAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                {
                  weight: 100,
                  podAffinityTerm: {
                    topologyKey: "kubernetes.io/hostname",
                    labelSelector: {
                      matchLabels: {
                        "cola.training/runtime-name": runtimeJobName,
                      },
                    },
                  },
                },
              ],
            },
          },
          topologySpreadConstraints: [
            {
              maxSkew: 1,
              topologyKey: "kubernetes.io/hostname",
              whenUnsatisfiable: "ScheduleAnyway",
              labelSelector: {
                matchLabels: {
                  "cola.training/runtime-name": runtimeJobName,
                },
              },
            },
          ],
          containers: [
            {
              name: "unsloth-trainer",
              image: ctx.image,
              imagePullPolicy:
                process.env.COLA_TRAINING_IMAGE_PULL_POLICY ?? "IfNotPresent",
              workingDir: mountPath,
              command: ["sh", "-lc"],
              args: [buildTrainingShellCommand()],
              env,
              ports: [{ containerPort: MASTER_PORT, name: "torchrun" }],
              volumeMounts: [
                {
                  name: volume.name,
                  mountPath,
                },
                {
                  name: "training-config",
                  mountPath: TRAINING_CONFIG_MOUNT_PATH,
                  readOnly: true,
                },
              ],
              resources,
            },
          ],
          volumes: [
            volume,
            {
              name: "training-config",
              configMap: {
                name: runtimeConfigMapName,
              },
            },
          ],
        },
      },
    },
  } satisfies V1Job;

  return {
    runtimeJobName,
    runtimeServiceName,
    runtimeConfigMapName,
    leaderPodName,
    artifactPath,
    serviceSpec,
    configMapSpec,
    jobSpec,
  } satisfies TrainingRuntimeManifest;
}

function describeCondition(condition?: V1JobCondition | null) {
  if (!condition) return null;

  return (
    [condition.reason, condition.message].filter(Boolean).join(": ") || null
  );
}

function deriveJobTerminalState(runtimeJob: V1Job): {
  status: TrainingJobStatus;
  finishedAt: Date | null;
  lastError: string | null;
} | null {
  const conditions = runtimeJob.status?.conditions ?? [];
  const completed = conditions.find(
    (condition) => condition.type === "Complete" && condition.status === "True",
  );
  if (completed) {
    return {
      status: "completed",
      finishedAt: completed.lastTransitionTime
        ? new Date(completed.lastTransitionTime)
        : new Date(),
      lastError: null,
    };
  }

  const failed = conditions.find(
    (condition) => condition.type === "Failed" && condition.status === "True",
  );
  if (failed || (runtimeJob.status?.failed ?? 0) > 0) {
    return {
      status: "failed",
      finishedAt: failed?.lastTransitionTime
        ? new Date(failed.lastTransitionTime)
        : new Date(),
      lastError:
        describeCondition(failed) ??
        "Kubernetes Job 进入失败状态，请检查 Pod 日志。",
    };
  }

  return null;
}

async function resolveRuntimeJobReference(
  job: TrainingJobRecord,
  ctx: TrainingKubeContext,
): Promise<TrainingRuntimeJobReference | null> {
  const namespace = job.runtimeNamespace ?? ctx.namespace;

  if (job.runtimeJobName) {
    return {
      namespace,
      jobName: job.runtimeJobName,
    };
  }

  const jobList = await ctx.batchApi.listNamespacedJob({
    namespace,
    labelSelector: `cola.training/job-id=${job.id}`,
  });
  const matchedJob = [...jobList.items]
    .sort(
      (left, right) =>
        new Date(right.metadata?.creationTimestamp ?? 0).valueOf() -
        new Date(left.metadata?.creationTimestamp ?? 0).valueOf(),
    )
    .find((entry) => entry.metadata?.name);

  if (!matchedJob?.metadata?.name) {
    return null;
  }

  return {
    namespace,
    jobName: matchedJob.metadata.name,
  };
}

function describePodState(pod: V1Pod) {
  const waitingState = pod.status?.containerStatuses
    ?.map((status) => status.state?.waiting?.reason)
    .find(Boolean);
  const terminatedState = pod.status?.containerStatuses
    ?.map((status) => status.state?.terminated?.reason)
    .find(Boolean);
  return waitingState ?? terminatedState ?? pod.status?.reason ?? null;
}

function summarizePod(pod: V1Pod): TrainingRuntimePodSummary | null {
  const name = pod.metadata?.name;
  if (!name) return null;

  const containerStatuses = pod.status?.containerStatuses ?? [];
  const ready =
    containerStatuses.length > 0 &&
    containerStatuses.every((status) => status.ready);

  return {
    name,
    phase: pod.status?.phase ?? "Unknown",
    reason: describePodState(pod),
    nodeName: pod.spec?.nodeName ?? null,
    podIP: pod.status?.podIP ?? null,
    hostIP: pod.status?.hostIP ?? null,
    startedAt: pod.status?.startTime ? new Date(pod.status.startTime) : null,
    completionIndex:
      pod.metadata?.annotations?.["batch.kubernetes.io/job-completion-index"] ??
      null,
    ready,
    restarts: containerStatuses.reduce(
      (total, status) => total + (status.restartCount ?? 0),
      0,
    ),
    containerStatuses: containerStatuses.map((status) => ({
      name: status.name,
      ready: status.ready,
      restartCount: status.restartCount ?? 0,
      state: status.state?.running
        ? "running"
        : status.state?.waiting
          ? `waiting:${status.state.waiting.reason ?? "unknown"}`
          : status.state?.terminated
            ? `terminated:${status.state.terminated.reason ?? "unknown"}`
            : "unknown",
    })),
  };
}

function summarizeEvent(
  event: CoreV1Event,
): TrainingRuntimeEventSummary | null {
  const message = event.message?.trim();
  if (!message) return null;

  return {
    type: event.type ?? null,
    reason: event.reason ?? null,
    message,
    count: event.count ?? 1,
    at: event.lastTimestamp
      ? new Date(event.lastTimestamp)
      : event.eventTime
        ? new Date(event.eventTime)
        : event.firstTimestamp
          ? new Date(event.firstTimestamp)
          : event.metadata?.creationTimestamp
            ? new Date(event.metadata.creationTimestamp)
            : null,
    source: event.source?.component ?? null,
    involvedKind: event.involvedObject?.kind ?? null,
    involvedName: event.involvedObject?.name ?? null,
  };
}

async function listRuntimePods(
  ctx: TrainingKubeContext,
  namespace: string,
  jobName: string,
) {
  const podList = await ctx.coreApi.listNamespacedPod({
    namespace,
    labelSelector: `job-name=${jobName}`,
  });

  return [...podList.items]
    .map(summarizePod)
    .filter((pod): pod is TrainingRuntimePodSummary => Boolean(pod))
    .sort((left, right) => {
      const leftIndex = Number(left.completionIndex ?? Number.MAX_SAFE_INTEGER);
      const rightIndex = Number(
        right.completionIndex ?? Number.MAX_SAFE_INTEGER,
      );
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.name.localeCompare(right.name);
    });
}

async function listEventsForObject(
  ctx: TrainingKubeContext,
  namespace: string,
  name: string,
) {
  const eventList = await ctx.coreApi.listNamespacedEvent({
    namespace,
    fieldSelector: `involvedObject.name=${name}`,
  });

  return eventList.items;
}

async function listRuntimeEvents(
  ctx: TrainingKubeContext,
  runtimeJob: TrainingRuntimeJobReference,
  pods: TrainingRuntimePodSummary[],
) {
  const names = [runtimeJob.jobName, ...pods.map((pod) => pod.name)];
  const eventGroups = await Promise.all(
    names.map((name) => listEventsForObject(ctx, runtimeJob.namespace, name)),
  );
  const eventMap = new Map<string, TrainingRuntimeEventSummary>();

  for (const group of eventGroups) {
    for (const event of group) {
      const summary = summarizeEvent(event);
      const key =
        event.metadata?.uid ??
        `${event.involvedObject?.kind ?? "unknown"}:${event.involvedObject?.name ?? "unknown"}:${event.reason ?? "unknown"}:${event.metadata?.name ?? ""}`;

      if (!summary || eventMap.has(key)) continue;
      eventMap.set(key, summary);
    }
  }

  return [...eventMap.values()]
    .sort((left, right) => {
      const leftTime = left.at ? left.at.valueOf() : 0;
      const rightTime = right.at ? right.at.valueOf() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 40);
}

function buildRuntimeInlineSummary(
  job: TrainingJobRecord,
  pods: TrainingRuntimePodSummary[],
  events: TrainingRuntimeEventSummary[],
): TrainingRuntimeInlineSummary {
  const latestWarning = events.find((event) => event.type === "Warning");
  if (latestWarning) {
    const category =
      latestWarning.reason === "FailedScheduling"
        ? "scheduling"
        : latestWarning.reason?.startsWith("FailedCreate") === true
          ? "creation"
          : "runtime";
    return {
      runtimeSummary: latestWarning.message,
      runtimeSummaryTone:
        latestWarning.reason?.startsWith("Failed") === true
          ? "error"
          : "warning",
      runtimeSummaryCategory: category,
      runtimeSummaryAt: latestWarning.at,
    };
  }

  const problematicPod = pods.find(
    (pod) => pod.phase === "Failed" || (pod.phase === "Pending" && pod.reason),
  );
  if (problematicPod) {
    const category =
      problematicPod.reason?.includes("Unschedulable") === true
        ? "scheduling"
        : "runtime";
    return {
      runtimeSummary:
        problematicPod.reason ??
        `${problematicPod.name} 处于 ${problematicPod.phase} 状态。`,
      runtimeSummaryTone:
        problematicPod.phase === "Failed" ? "error" : "warning",
      runtimeSummaryCategory: category,
      runtimeSummaryAt: problematicPod.startedAt,
    };
  }

  if (job.status === "running" && pods.length === 0) {
    return {
      runtimeSummary: "作业已提交，正在等待 Pod 创建。",
      runtimeSummaryTone: "neutral",
      runtimeSummaryCategory: "progress",
      runtimeSummaryAt: null,
    };
  }

  if (pods.length > 0) {
    const readyCount = pods.filter((pod) => pod.ready).length;
    const runningCount = pods.filter((pod) => pod.phase === "Running").length;
    const pendingCount = pods.filter((pod) => pod.phase === "Pending").length;
    const completedCount = pods.filter(
      (pod) => pod.phase === "Succeeded",
    ).length;

    return {
      runtimeSummary:
        pendingCount > 0
          ? `Pods: ${readyCount}/${pods.length} ready · ${pendingCount} pending`
          : completedCount === pods.length
            ? `Pods 已全部完成，共 ${completedCount} 个。`
            : `Pods: ${readyCount}/${pods.length} ready · ${runningCount} running`,
      runtimeSummaryTone:
        readyCount === pods.length && readyCount > 0 ? "success" : "neutral",
      runtimeSummaryCategory:
        readyCount === pods.length && readyCount > 0 ? "success" : "progress",
      runtimeSummaryAt: pods[0]?.startedAt ?? null,
    };
  }

  return {
    runtimeSummary: null,
    runtimeSummaryTone: "neutral",
    runtimeSummaryCategory: "none",
    runtimeSummaryAt: null,
  };
}

async function readRuntimePodLog(
  ctx: TrainingKubeContext,
  namespace: string,
  podName: string,
  tailLines: number,
) {
  try {
    return await ctx.coreApi.readNamespacedPodLog({
      namespace,
      name: podName,
      container: "unsloth-trainer",
      tailLines,
      timestamps: true,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      return "Pod log is not available because the pod no longer exists.";
    }

    const message =
      error instanceof Error ? error.message : "Unknown log error";
    return `Unable to read pod log: ${message}`;
  }
}

async function deleteRuntimeResources(
  ctx: TrainingKubeContext,
  namespace: string,
  jobName: string,
  serviceName?: string | null,
) {
  const runtimeServiceName = serviceName ?? buildRuntimeServiceName(jobName);
  const runtimeConfigMapName = buildRuntimeConfigMapName(jobName);

  const cleanupActions = [
    async () =>
      ctx.batchApi.deleteNamespacedJob({
        namespace,
        name: jobName,
        propagationPolicy: "Foreground",
        gracePeriodSeconds: 0,
      }),
    async () =>
      ctx.coreApi.deleteNamespacedService({
        namespace,
        name: runtimeServiceName,
      }),
    async () =>
      ctx.coreApi.deleteNamespacedConfigMap({
        namespace,
        name: runtimeConfigMapName,
      }),
  ];

  for (const cleanup of cleanupActions) {
    try {
      await cleanup();
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }
}

export async function submitTrainingJob(job: TrainingJobRecord) {
  if (!trainingK8sSupportedJobTypes.some((type) => type === job.jobType)) {
    throw new Error(
      `当前 Unsloth Kubernetes 执行器暂不支持 ${job.jobType.toUpperCase()} 类型。`,
    );
  }

  const ctx = await createKubeContext();
  await ensureNamespace(ctx.coreApi, ctx.namespace);
  const runtime = buildTrainingRuntime(job, ctx);

  try {
    await ctx.coreApi.createNamespacedConfigMap({
      namespace: ctx.namespace,
      body: runtime.configMapSpec,
    });
    await ctx.coreApi.createNamespacedService({
      namespace: ctx.namespace,
      body: runtime.serviceSpec,
    });
    await ctx.batchApi.createNamespacedJob({
      namespace: ctx.namespace,
      body: runtime.jobSpec,
    });
  } catch (error) {
    try {
      await deleteRuntimeResources(
        ctx,
        ctx.namespace,
        runtime.runtimeJobName,
        runtime.runtimeServiceName,
      );
    } catch (cleanupError) {
      console.error(
        "[training] failed to cleanup runtime resources",
        cleanupError,
      );
    }
    throw error;
  }

  return {
    namespace: ctx.namespace,
    kind: "indexed-job",
    jobName: runtime.runtimeJobName,
    serviceName: runtime.runtimeServiceName,
    leaderPodName: runtime.leaderPodName,
    image: ctx.image,
    artifactPath: runtime.artifactPath,
  } satisfies TrainingRuntimeLaunch;
}

export async function stopTrainingJobRun(job: TrainingJobRecord) {
  const ctx = await createKubeContext();
  const runtimeJob = await resolveRuntimeJobReference(job, ctx);
  const jobName = runtimeJob?.jobName ?? job.runtimeJobName;
  const namespace =
    runtimeJob?.namespace ?? job.runtimeNamespace ?? ctx.namespace;

  if (!jobName) return;

  await deleteRuntimeResources(
    ctx,
    namespace,
    jobName,
    job.runtimeServiceName ?? null,
  );
}

export async function inspectTrainingJobRuntime(
  job: TrainingJobRecord,
  options?: {
    podName?: string | null;
    tailLines?: number;
  },
) {
  const ctx = await createKubeContext();
  const runtimeJob = await resolveRuntimeJobReference(job, ctx);
  if (!runtimeJob) return null;

  const pods = await listRuntimePods(
    ctx,
    runtimeJob.namespace,
    runtimeJob.jobName,
  );
  const requestedPodName = options?.podName?.trim();
  const selectedPodName =
    (requestedPodName && requestedPodName.length > 0
      ? requestedPodName
      : undefined) ??
    job.runtimeLeaderPodName ??
    pods[0]?.name ??
    null;
  const [events, logText] = await Promise.all([
    listRuntimeEvents(ctx, runtimeJob, pods),
    selectedPodName
      ? readRuntimePodLog(
          ctx,
          runtimeJob.namespace,
          selectedPodName,
          Math.min(500, Math.max(20, options?.tailLines ?? 120)),
        )
      : Promise.resolve<string | null>(null),
  ]);

  return {
    namespace: runtimeJob.namespace,
    jobName: runtimeJob.jobName,
    serviceName:
      job.runtimeServiceName ?? buildRuntimeServiceName(runtimeJob.jobName),
    leaderPodName:
      job.runtimeLeaderPodName ?? buildLeaderPodName(runtimeJob.jobName),
    selectedPodName,
    logText,
    pods,
    events,
  } satisfies TrainingRuntimeInspection;
}

async function summarizeTrainingJobRuntime(
  job: TrainingJobRecord,
  ctx: TrainingKubeContext,
): Promise<TrainingRuntimeInlineSummary> {
  if (!job.runtimeJobName && !job.runtimeNamespace) {
    return {
      runtimeSummary: null,
      runtimeSummaryTone: "neutral",
      runtimeSummaryCategory: "none",
      runtimeSummaryAt: null,
    };
  }

  const runtimeJob = await resolveRuntimeJobReference(job, ctx);
  if (!runtimeJob) {
    return {
      runtimeSummary:
        job.status === "running"
          ? "运行态对象不存在，可能已被外部删除。"
          : null,
      runtimeSummaryTone: job.status === "running" ? "warning" : "neutral",
      runtimeSummaryCategory: job.status === "running" ? "runtime" : "none",
      runtimeSummaryAt: null,
    };
  }

  const pods = await listRuntimePods(
    ctx,
    runtimeJob.namespace,
    runtimeJob.jobName,
  );
  const events = await listRuntimeEvents(ctx, runtimeJob, pods);
  return buildRuntimeInlineSummary(job, pods, events);
}

async function syncTrainingJobRuntime(
  job: TrainingJobRecord,
  ctx: TrainingKubeContext,
): Promise<TrainingJobRecord> {
  if (job.status !== "running") return job;
  const runtimeJob = await resolveRuntimeJobReference(job, ctx);
  if (!runtimeJob) return job;

  try {
    const runtimeJobDetail = await ctx.batchApi.readNamespacedJob({
      namespace: runtimeJob.namespace,
      name: runtimeJob.jobName,
    });
    const nextState = deriveJobTerminalState(runtimeJobDetail);
    if (!nextState) return job;

    await db
      .update(trainingJobs)
      .set({
        status: nextState.status,
        finishedAt: nextState.finishedAt,
        lastError: nextState.lastError,
        updatedAt: new Date(),
      })
      .where(eq(trainingJobs.id, job.id));

    return {
      ...job,
      status: nextState.status,
      finishedAt: nextState.finishedAt,
      lastError: nextState.lastError,
      updatedAt: new Date(),
    } satisfies TrainingJobRecord;
  } catch (error) {
    if (isNotFoundError(error)) {
      const now = new Date();

      await db
        .update(trainingJobs)
        .set({
          status: "failed",
          finishedAt: now,
          lastError: "Kubernetes Job 已不存在，任务状态已标记为失败。",
          updatedAt: now,
        })
        .where(eq(trainingJobs.id, job.id));

      return {
        ...job,
        status: "failed",
        finishedAt: now,
        lastError: "Kubernetes Job 已不存在，任务状态已标记为失败。",
        updatedAt: now,
      } satisfies TrainingJobRecord;
    }

    console.error("[training] failed to sync runtime state", error);
    return job;
  }
}

export async function syncTrainingJobs(jobs: TrainingJobRecord[]) {
  try {
    const ctx = await createKubeContext();
    const synced = await Promise.all(
      jobs.map((job) => syncTrainingJobRuntime(job, ctx)),
    );
    const enriched = await Promise.all(
      synced.map(async (job) => ({
        ...job,
        ...(await summarizeTrainingJobRuntime(job, ctx)),
      })),
    );

    return enriched.sort(
      (left, right) =>
        new Date(right.createdAt).valueOf() -
        new Date(left.createdAt).valueOf(),
    );
  } catch (error) {
    console.error("[training] failed to create kube context for sync", error);
    return jobs.map((job) => ({
      ...job,
      runtimeSummary: null,
      runtimeSummaryTone: "neutral",
      runtimeSummaryCategory: "none",
      runtimeSummaryAt: null,
    }));
  }
}
