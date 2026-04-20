import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  type V1Job,
  type V1JobCondition,
} from "@kubernetes/client-node";
import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { trainingJobs } from "@/server/db/schema";
import {
  type TrainingJobStatus,
  trainingK8sSupportedJobTypes,
} from "@/server/training/catalog";

const REMOTE_WORK_DIR = path.join(process.cwd(), "infra", "remote-work");
const CLUSTER_CONFIG_PATH = path.join(
  REMOTE_WORK_DIR,
  "cluster",
  "config.json",
);

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
  jobName: string;
  image: string;
  artifactPath: string;
};

function readClusterConfig() {
  return JSON.parse(fs.readFileSync(CLUSTER_CONFIG_PATH, "utf8")) as ClusterConfig;
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
  return process.env.COLA_TRAINING_K8S_IMAGE?.trim() ?? "unsloth/unsloth:latest";
}

function createKubeConfig(clusterName: string) {
  const kubeConfig = new KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
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

function buildRuntimeJobName(job: TrainingJobRecord) {
  const prefix = "cola-train";
  const suffix = `${job.id.slice(0, 8)}-${Date.now().toString(36).slice(-6)}`;
  const maxSlugLength = Math.max(8, 63 - prefix.length - suffix.length - 2);
  const slug = slugify(job.title).slice(0, maxSlugLength).replace(/-+$/g, "");

  return `${prefix}-${slug || "job"}-${suffix}`.slice(0, 63).replace(/-+$/g, "");
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

function resolveCpuRequest(gpuCount: number) {
  return process.env.COLA_TRAINING_CPU_REQUEST?.trim() ?? `${Math.max(4, gpuCount * 4)}`;
}

function resolveMemoryRequest(gpuCount: number) {
  return (
    process.env.COLA_TRAINING_MEMORY_REQUEST?.trim() ??
    `${Math.max(24, gpuCount * 24)}Gi`
  );
}

function buildJobSpecPayload(job: TrainingJobRecord) {
  return JSON.stringify({
    id: job.id,
    title: job.title,
    jobType: job.jobType,
    baseModel: job.baseModel,
    datasetName: job.datasetName,
    objective: job.objective,
    gpuCount: job.gpuCount,
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
    "from trl import SFTConfig, SFTTrainer",
    "from unsloth import FastLanguageModel",
    "",
    "job = json.loads(os.environ['COLA_JOB_SPEC'])",
    "job_type = job['jobType']",
    "dataset_name = job['datasetName']",
    "dataset_split = os.environ.get('COLA_DATASET_SPLIT', 'train')",
    "dataset_text_field = os.environ.get('COLA_DATASET_TEXT_FIELD', 'text')",
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
    "trainer = SFTTrainer(",
    "    model=model,",
    "    tokenizer=tokenizer,",
    "    train_dataset=dataset,",
    "    dataset_text_field='text',",
    "    args=SFTConfig(",
    "        max_seq_length=max_seq_length,",
    "        per_device_train_batch_size=int(os.environ.get('COLA_PER_DEVICE_BATCH_SIZE', '2')),",
    "        gradient_accumulation_steps=int(os.environ.get('COLA_GRADIENT_ACCUMULATION_STEPS', '4')),",
    "        warmup_steps=int(os.environ.get('COLA_WARMUP_STEPS', '5')),",
    "        max_steps=int(os.environ.get('COLA_MAX_STEPS', '60')),",
    "        learning_rate=float(os.environ.get('COLA_LEARNING_RATE', '2e-4')),",
    "        logging_steps=int(os.environ.get('COLA_LOGGING_STEPS', '1')),",
    "        optim=os.environ.get('COLA_OPTIM', 'adamw_8bit'),",
    "        weight_decay=float(os.environ.get('COLA_WEIGHT_DECAY', '0.01')),",
    "        lr_scheduler_type=os.environ.get('COLA_LR_SCHEDULER_TYPE', 'linear'),",
    "        seed=int(os.environ.get('COLA_RANDOM_SEED', '3407')),",
    "        output_dir=str(artifact_dir),",
    "        save_strategy='steps',",
    "        save_steps=int(os.environ.get('COLA_SAVE_STEPS', '20')),",
    "        save_total_limit=int(os.environ.get('COLA_SAVE_TOTAL_LIMIT', '2')),",
    "        report_to='none',",
    "        fp16=not torch.cuda.is_bf16_supported(),",
    "        bf16=torch.cuda.is_bf16_supported(),",
    "    ),",
    ")",
    "trainer.train()",
    "",
    "output_dir = artifact_dir / ('adapter' if use_lora else 'model')",
    "output_dir.mkdir(parents=True, exist_ok=True)",
    "model.save_pretrained(str(output_dir))",
    "tokenizer.save_pretrained(str(output_dir))",
    "",
    "with open(artifact_dir / 'job-result.json', 'w', encoding='utf-8') as handle:",
    "    json.dump({",
    "        'jobId': job['id'],",
    "        'jobType': job_type,",
    "        'artifactDir': str(output_dir),",
    "        'dataset': dataset_name,",
    "        'baseModel': job['baseModel'],",
    "    }, handle, ensure_ascii=False, indent=2)",
    "",
    "print('Training finished. Artifacts written to {}'.format(output_dir))",
  ].join("\n");
}

function buildTrainingShellCommand() {
  return [
    "set -euo pipefail",
    "mkdir -p \"$COLA_ARTIFACT_DIR\"",
    "cat <<'PY' >/tmp/cola_unsloth_train.py",
    buildTrainingPythonProgram(),
    "PY",
    "python -u /tmp/cola_unsloth_train.py",
  ].join("\n");
}

function buildTrainingJob(job: TrainingJobRecord, ctx: TrainingKubeContext) {
  const runtimeJobName = buildRuntimeJobName(job);
  const artifactPath = resolveArtifactPath(job, runtimeJobName);
  const cpuRequest = resolveCpuRequest(job.gpuCount);
  const memoryRequest = resolveMemoryRequest(job.gpuCount);
  const { volume, mountPath } = resolveWorkVolume();
  const labels = {
    "app.kubernetes.io/name": "cola-training",
    "app.kubernetes.io/component": "unsloth-job",
    "app.kubernetes.io/managed-by": "cola",
    "cola.training/job-id": job.id,
    "cola.training/type": job.jobType,
  };

  const env: Array<{
    name: string;
    value?: string;
    valueFrom?: {
      secretKeyRef: {
        name: string;
        key: string;
      };
    };
  }> = [
    { name: "TZ", value: process.env.COLA_TRAINING_TZ ?? "Asia/Shanghai" },
    { name: "COLA_JOB_SPEC", value: buildJobSpecPayload(job) },
    { name: "COLA_ARTIFACT_DIR", value: artifactPath },
    {
      name: "COLA_DATASET_SPLIT",
      value: process.env.COLA_TRAINING_DATASET_SPLIT ?? "train",
    },
    {
      name: "COLA_DATASET_TEXT_FIELD",
      value: process.env.COLA_TRAINING_DATASET_TEXT_FIELD ?? "text",
    },
    {
      name: "HF_HOME",
      value: process.env.COLA_TRAINING_HF_HOME ?? path.posix.join(mountPath, ".hf"),
    },
  ];

  const hfSecretName = process.env.COLA_TRAINING_HF_SECRET_NAME?.trim();
  const hfSecretKey = process.env.COLA_TRAINING_HF_SECRET_KEY?.trim() ?? "HF_TOKEN";

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
      "nvidia.com/gpu": `${job.gpuCount}`,
    },
    limits: {
      cpu: process.env.COLA_TRAINING_CPU_LIMIT?.trim() ?? cpuRequest,
      memory: process.env.COLA_TRAINING_MEMORY_LIMIT?.trim() ?? memoryRequest,
      "nvidia.com/gpu": `${job.gpuCount}`,
    },
  };

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
          runtimeClassName: "nvidia",
          ...(process.env.COLA_TRAINING_SERVICE_ACCOUNT?.trim()
            ? {
                serviceAccountName:
                  process.env.COLA_TRAINING_SERVICE_ACCOUNT.trim(),
              }
            : {}),
          nodeSelector: {
            [ctx.gpuLabelKey]: "true",
          },
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
              volumeMounts: [
                {
                  name: volume.name,
                  mountPath,
                },
              ],
              resources,
            },
          ],
          volumes: [volume],
        },
      },
    },
  } satisfies V1Job;

  return {
    runtimeJobName,
    artifactPath,
    jobSpec,
  };
}

function describeCondition(condition?: V1JobCondition | null) {
  if (!condition) return null;

  return [condition.reason, condition.message].filter(Boolean).join(": ") || null;
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
        describeCondition(failed) ?? "Kubernetes Job 进入失败状态，请检查 Pod 日志。",
    };
  }

  return null;
}

async function resolveRuntimeJobReference(
  job: TrainingJobRecord,
  ctx: TrainingKubeContext,
) {
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
    .sort((left, right) =>
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

export async function submitTrainingJob(job: TrainingJobRecord) {
  if (!trainingK8sSupportedJobTypes.some((type) => type === job.jobType)) {
    throw new Error(
      `当前 Unsloth Kubernetes 执行器暂不支持 ${job.jobType.toUpperCase()} 类型。`,
    );
  }

  const ctx = await createKubeContext();
  await ensureNamespace(ctx.coreApi, ctx.namespace);
  const runtime = buildTrainingJob(job, ctx);

  await ctx.batchApi.createNamespacedJob({
    namespace: ctx.namespace,
    body: runtime.jobSpec,
  });

  return {
    namespace: ctx.namespace,
    jobName: runtime.runtimeJobName,
    image: ctx.image,
    artifactPath: runtime.artifactPath,
  } satisfies TrainingRuntimeLaunch;
}

export async function stopTrainingJobRun(job: TrainingJobRecord) {
  const ctx = await createKubeContext();
  const runtimeJob = await resolveRuntimeJobReference(job, ctx);
  if (!runtimeJob) return;

  try {
    await ctx.batchApi.deleteNamespacedJob({
      namespace: runtimeJob.namespace,
      name: runtimeJob.jobName,
      propagationPolicy: "Foreground",
      gracePeriodSeconds: 0,
    });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

async function syncTrainingJobRuntime(job: TrainingJobRecord, ctx: TrainingKubeContext) {
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
    };
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
      };
    }

    console.error("[training] failed to sync runtime state", error);
    return job;
  }
}

export async function syncTrainingJobs(jobs: TrainingJobRecord[]) {
  const jobsToSync = jobs.filter((job) => job.status === "running");

  if (jobsToSync.length === 0) return jobs;

  try {
    const ctx = await createKubeContext();
    const synced = await Promise.all(
      jobs.map((job) => syncTrainingJobRuntime(job, ctx)),
    );

    return synced.sort(
      (left, right) =>
        new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf(),
    );
  } catch (error) {
    console.error("[training] failed to create kube context for sync", error);
    return jobs;
  }
}
