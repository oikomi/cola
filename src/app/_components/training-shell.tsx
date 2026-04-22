"use client";

import {
  ArrowUpRightIcon,
  BrainCircuitIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { priorityLabels, priorityValues } from "@/server/office/catalog";
import {
  trainingConfigSourceLabels,
  trainingConfigSourceValues,
  trainingDistributedBackendLabels,
  trainingDistributedBackendValues,
  trainingJobStatusLabels,
  trainingJobTypeLabels,
  trainingJobTypeValues,
  trainingLauncherTypeLabels,
  trainingLauncherTypeValues,
  trainingPrecisionLabels,
  trainingPrecisionValues,
} from "@/server/training/catalog";
import { api, type RouterOutputs } from "@/trpc/react";

type TrainingDraft = {
  title: string;
  objective: string;
  configSource: (typeof trainingConfigSourceValues)[number];
  jobType: (typeof trainingJobTypeValues)[number];
  priority: (typeof priorityValues)[number];
  baseModel: string;
  datasetName: string;
  datasetSplit: string;
  datasetTextField: string;
  nodeCount: string;
  gpusPerNode: string;
  launcherType: (typeof trainingLauncherTypeValues)[number];
  distributedBackend: (typeof trainingDistributedBackendValues)[number];
  deepspeedStage: string;
  precision: (typeof trainingPrecisionValues)[number];
  loadIn4bit: "true" | "false";
  studioConfigJson: string;
};

type TrainingJobItem = RouterOutputs["training"]["listJobs"][number];
type TrainingListFilter = "all" | "running" | "issues" | "scheduling";

const defaultDraft: TrainingDraft = {
  title: "",
  objective: "",
  configSource: "manual",
  jobType: "sft",
  priority: "medium",
  baseModel: "Qwen/Qwen3-8B",
  datasetName: "",
  datasetSplit: "train",
  datasetTextField: "text",
  nodeCount: "1",
  gpusPerNode: "1",
  launcherType: "torchrun",
  distributedBackend: "deepspeed",
  deepspeedStage: "2",
  precision: "bf16",
  loadIn4bit: "true",
  studioConfigJson: "",
};

const minimalQwenLoraExample = {
  title: "Qwen2.5-0.5B 最小 LoRA 示例",
  objective:
    "使用 Unsloth + LoRA 验证训练平台链路，基于 4-bit Qwen2.5-0.5B Instruct 对最小中文客服问答样本做快速 smoke test，产出 adapter 权重。",
  configSource: "manual" as const,
  jobType: "lora" as const,
  priority: "medium" as (typeof priorityValues)[number],
  baseModel: "unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit",
  datasetName:
    "/workspace/cola-training/datasets/qwen2.5-0.5b-lora-minimal.jsonl",
  datasetSplit: "train",
  datasetTextField: "text",
  nodeCount: "1",
  gpusPerNode: "1",
  launcherType: "torchrun" as const,
  distributedBackend: "deepspeed" as const,
  deepspeedStage: "2",
  precision: "bf16" as const,
  loadIn4bit: "true" as const,
  studioConfigJson: "",
} satisfies TrainingDraft;

const minimalQwenLoraDatasetPreview = [
  '{"text":"你是客服助手。用户：退款一般多久到账？\\n助手：原路退款通常 1 到 3 个工作日到账，如遇银行处理延迟可再等待 1 到 2 个工作日。"}',
  '{"text":"你是客服助手。用户：我想修改收货地址怎么办？\\n助手：如果订单还未出库，请尽快提供新的详细地址和联系电话，我们会优先帮你修改。"}',
  '{"text":"你是客服助手。用户：你们支持开增值税专票吗？\\n助手：支持。请提供开票抬头、税号、开户行、账号和注册地址，我们会在审核后开具。"}',
] as const;

const minimalQwenLoraRuntimeNotes = [
  "默认用 1 节点 x 1 GPU，通过 torchrun + DeepSpeed ZeRO-2 跑最小链路。",
  "默认 load_in_4bit=true，适合用 1 张 GPU 先验证链路。",
  "默认读取 text 字段；如果你的字段名不同，需要改 COLA_TRAINING_DATASET_TEXT_FIELD。",
  "平台默认 max_steps=60、per_device_train_batch_size=2、gradient_accumulation_steps=4，更像 smoke test，不是正式收敛配置。",
  "任务完成后会把 LoRA adapter 写到产物目录下的 adapter/ 子目录。",
] as const;

function formatTime(value: Date | string | null | undefined) {
  if (!value) return "未启动";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusTone(status: keyof typeof trainingJobStatusLabels) {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "draft":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "stopped":
      return "border-border bg-muted text-muted-foreground";
    case "completed":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function priorityTone(priority: keyof typeof priorityLabels) {
  switch (priority) {
    case "critical":
      return "text-rose-700";
    case "high":
      return "text-amber-700";
    case "medium":
      return "text-emerald-700";
    case "low":
    default:
      return "text-muted-foreground";
  }
}

function runtimeSummaryTone(
  tone: "neutral" | "success" | "warning" | "error" | null | undefined,
) {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "neutral":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-2">
      <span className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-muted-foreground text-xs">{props.hint}</span>
      ) : null}
    </label>
  );
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`training-skeleton-${index}`}
          className="border-border/70 bg-background/70 rounded-3xl border p-4"
        >
          <div className="grid gap-3 md:grid-cols-[1.4fr_110px_1fr_110px_140px_220px] md:items-center">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-5 w-16" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-20 rounded-full" />
              <Skeleton className="h-9 w-20 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNestedValue(
  source: unknown,
  path: readonly string[],
): unknown {
  let current: unknown = source;

  for (const segment of path) {
    if (!isJsonRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

function pickFirstValue(
  source: unknown,
  paths: ReadonlyArray<readonly string[]>,
): unknown {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveIntegerString(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return String(parsed);
    }
  }

  return fallback;
}

function asBooleanString(value: unknown): "true" | "false" | null {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (value === 0) return "false";
    if (value === 1) return "true";
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return "true";
    if (["false", "0", "no", "off"].includes(normalized)) return "false";
  }

  return null;
}

function inferJobType(
  source: unknown,
): (typeof trainingJobTypeValues)[number] | null {
  const explicit = asTrimmedString(
    pickFirstValue(source, [
      ["jobType"],
      ["job_type"],
      ["task"],
      ["task_type"],
      ["training_type"],
      ["trainer", "task"],
    ]),
  );
  const normalized = explicit?.toLowerCase();
  if (normalized?.includes("pretrain")) return "pretrain";
  if (normalized?.includes("lora")) return "lora";
  if (normalized?.includes("dpo")) return "dpo";
  if (normalized?.includes("sft")) return "sft";

  const loraRank = pickFirstValue(source, [
    ["lora", "rank"],
    ["lora", "r"],
    ["peft", "lora_r"],
    ["lora_r"],
  ]);
  if (loraRank !== undefined) return "lora";

  return null;
}

function inferPrecision(
  source: unknown,
): (typeof trainingPrecisionValues)[number] | null {
  const precision = asTrimmedString(
    pickFirstValue(source, [
      ["precision"],
      ["trainer", "precision"],
      ["model", "precision"],
      ["mixed_precision"],
    ]),
  )?.toLowerCase();

  if (precision === "bf16") return "bf16";
  if (precision === "fp16" || precision === "float16") return "fp16";
  if (precision === "auto") return "auto";

  const bf16 = asBooleanString(
    pickFirstValue(source, [
      ["bf16"],
      ["trainer", "bf16"],
      ["model", "bf16"],
    ]),
  );
  if (bf16 === "true") return "bf16";

  const fp16 = asBooleanString(
    pickFirstValue(source, [
      ["fp16"],
      ["trainer", "fp16"],
      ["model", "fp16"],
    ]),
  );
  if (fp16 === "true") return "fp16";

  return null;
}

function inferDistributedBackend(
  source: unknown,
): (typeof trainingDistributedBackendValues)[number] | null {
  const backend = asTrimmedString(
    pickFirstValue(source, [
      ["distributed", "backend"],
      ["backend"],
      ["launcher"],
    ]),
  )?.toLowerCase();

  if (backend?.includes("deepspeed")) return "deepspeed";
  if (backend?.includes("none")) return "none";

  if (
    pickFirstValue(source, [
      ["deepspeed"],
      ["distributed", "deepspeed"],
      ["trainer", "deepspeed"],
    ]) !== undefined
  ) {
    return "deepspeed";
  }

  return null;
}

function inferLauncherType(
  source: unknown,
): (typeof trainingLauncherTypeValues)[number] | null {
  const launcher = asTrimmedString(
    pickFirstValue(source, [
      ["distributed", "launcher"],
      ["launcher"],
      ["runner", "launcher"],
    ]),
  )?.toLowerCase();

  if (launcher?.includes("python")) return "python";
  if (
    launcher?.includes("torchrun") ||
    launcher?.includes("deepspeed") ||
    launcher?.includes("accelerate")
  ) {
    return "torchrun";
  }

  return null;
}

function inferDraftFromStudioConfig(
  source: unknown,
  current: TrainingDraft,
): { draft: TrainingDraft; applied: string[] } {
  if (!isJsonRecord(source)) {
    return { draft: current, applied: [] };
  }

  const nextDraft = { ...current };
  const applied: string[] = [];

  const title = asTrimmedString(
    pickFirstValue(source, [
      ["title"],
      ["name"],
      ["project"],
      ["project_name"],
    ]),
  );
  if (title) {
    nextDraft.title = title;
    applied.push("任务标题");
  }

  const objective = asTrimmedString(
    pickFirstValue(source, [
      ["objective"],
      ["description"],
      ["goal"],
      ["notes"],
      ["project_description"],
    ]),
  );
  if (objective) {
    nextDraft.objective = objective;
    applied.push("训练目标");
  }

  const jobType = inferJobType(source);
  if (jobType) {
    nextDraft.jobType = jobType;
    applied.push("训练类型");
  }

  const baseModel = asTrimmedString(
    pickFirstValue(source, [
      ["baseModel"],
      ["base_model"],
      ["model_name"],
      ["model_name_or_path"],
      ["model", "name"],
      ["model", "model_name"],
      ["model", "model_name_or_path"],
    ]),
  );
  if (baseModel) {
    nextDraft.baseModel = baseModel;
    applied.push("基础模型");
  }

  const datasetName = asTrimmedString(
    pickFirstValue(source, [
      ["datasetName"],
      ["dataset_name"],
      ["dataset_path"],
      ["dataset", "name"],
      ["dataset", "path"],
      ["data", "dataset"],
    ]),
  );
  if (datasetName) {
    nextDraft.datasetName = datasetName;
    applied.push("数据集");
  }

  const datasetSplit = asTrimmedString(
    pickFirstValue(source, [
      ["datasetSplit"],
      ["dataset_split"],
      ["split"],
      ["dataset", "split"],
    ]),
  );
  if (datasetSplit) {
    nextDraft.datasetSplit = datasetSplit;
    applied.push("数据集 Split");
  }

  const datasetTextField = asTrimmedString(
    pickFirstValue(source, [
      ["datasetTextField"],
      ["dataset_text_field"],
      ["text_field"],
      ["dataset", "textField"],
      ["dataset", "text_field"],
      ["dataset", "field"],
    ]),
  );
  if (datasetTextField) {
    nextDraft.datasetTextField = datasetTextField;
    applied.push("文本字段");
  }

  const nodeCount = asPositiveIntegerString(
    pickFirstValue(source, [
      ["nodeCount"],
      ["node_count"],
      ["num_nodes"],
      ["distributed", "nodeCount"],
      ["distributed", "num_nodes"],
      ["trainer", "num_nodes"],
    ]),
  );
  if (nodeCount) {
    nextDraft.nodeCount = nodeCount;
    applied.push("节点数");
  }

  const gpusPerNode = asPositiveIntegerString(
    pickFirstValue(source, [
      ["gpusPerNode"],
      ["gpus_per_node"],
      ["num_gpus"],
      ["nproc_per_node"],
      ["distributed", "gpusPerNode"],
      ["distributed", "gpus_per_node"],
      ["distributed", "nproc_per_node"],
      ["trainer", "num_gpus"],
    ]),
  );
  if (gpusPerNode) {
    nextDraft.gpusPerNode = gpusPerNode;
    applied.push("每节点 GPU");
  }

  const launcherType = inferLauncherType(source);
  if (launcherType) {
    nextDraft.launcherType = launcherType;
    applied.push("启动器");
  }

  const distributedBackend = inferDistributedBackend(source);
  if (distributedBackend) {
    nextDraft.distributedBackend = distributedBackend;
    applied.push("后端");
  }

  const deepspeedStage = asPositiveIntegerString(
    pickFirstValue(source, [
      ["deepspeedStage"],
      ["deepspeed_stage"],
      ["zero_stage"],
      ["deepspeed", "stage"],
      ["deepspeed", "zero_stage"],
      ["deepspeed", "zero_optimization", "stage"],
      ["distributed", "deepspeedStage"],
    ]),
  );
  if (deepspeedStage === "2" || deepspeedStage === "3") {
    nextDraft.deepspeedStage = deepspeedStage;
    applied.push("DeepSpeed Stage");
  }

  const precision = inferPrecision(source);
  if (precision) {
    nextDraft.precision = precision;
    applied.push("精度");
  }

  const loadIn4bitValue =
    asBooleanString(
      pickFirstValue(source, [
        ["loadIn4bit"],
        ["load_in_4bit"],
        ["model", "loadIn4bit"],
        ["model", "load_in_4bit"],
        ["quantization", "load_in_4bit"],
      ]),
    ) ??
    (pickFirstValue(source, [
      ["quantization", "bits"],
      ["quantization_bits"],
    ]) === 4
      ? "true"
      : null);
  if (loadIn4bitValue) {
    nextDraft.loadIn4bit = loadIn4bitValue;
    applied.push("4-bit 加载");
  }

  nextDraft.configSource = "unsloth_studio";

  return {
    draft: nextDraft,
    applied,
  };
}

export function TrainingShell() {
  const utils = api.useUtils();
  const unslothStudioUrl = process.env.NEXT_PUBLIC_UNSLOTH_STUDIO_URL?.trim();
  const jobsQuery = api.training.listJobs.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [listFilter, setListFilter] = useState<TrainingListFilter>("all");
  const [runtimeDialog, setRuntimeDialog] = useState<{
    jobId: string;
    title: string;
  } | null>(null);
  const [selectedRuntimePodName, setSelectedRuntimePodName] = useState<
    string | undefined
  >(undefined);
  const [draft, setDraft] = useState(defaultDraft);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const runtimeDetailQuery = api.training.getRuntimeDetails.useQuery(
    {
      jobId: runtimeDialog?.jobId ?? "00000000-0000-0000-0000-000000000000",
      ...(selectedRuntimePodName ? { podName: selectedRuntimePodName } : {}),
      tailLines: 160,
    },
    {
      enabled: Boolean(runtimeDialog),
      refetchOnWindowFocus: true,
      refetchInterval: runtimeDialog ? 5000 : false,
    },
  );

  const createJob = api.training.createJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      setDraft(defaultDraft);
      setIsCreateOpen(false);
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const startJob = api.training.startJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const stopJob = api.training.stopJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const deleteJob = api.training.deleteJob.useMutation({
    onSuccess: (result) => {
      setFeedback({ tone: "success", message: result.message });
      void utils.training.listJobs.invalidate();
    },
    onError: (error) => {
      setFeedback({ tone: "error", message: error.message });
    },
  });

  const jobs = jobsQuery.data ?? [];
  const runtimeDetail = runtimeDetailQuery.data;
  const runningCount = jobs.filter((job) => job.status === "running").length;
  const issueCount = jobs.filter(
    (job) =>
      job.status === "failed" ||
      Boolean(job.lastError) ||
      job.runtimeSummaryTone === "warning" ||
      job.runtimeSummaryTone === "error",
  ).length;
  const schedulingIssueCount = jobs.filter(
    (job) => job.runtimeSummaryCategory === "scheduling",
  ).length;
  const filteredJobs = jobs.filter((job) => {
    if (listFilter === "running") {
      return job.status === "running";
    }

    if (listFilter === "issues") {
      return (
        job.status === "failed" ||
        Boolean(job.lastError) ||
        job.runtimeSummaryTone === "warning" ||
        job.runtimeSummaryTone === "error"
      );
    }

    if (listFilter === "scheduling") {
      return job.runtimeSummaryCategory === "scheduling";
    }

    return true;
  });
  const draftCount = jobs.filter((job) => job.status === "draft").length;
  const completedCount = jobs.filter(
    (job) => job.status === "completed",
  ).length;
  const activeGpuCount = jobs
    .filter((job) => job.status === "running")
    .reduce((total, job) => total + job.gpuCount, 0);

  const parsedNodeCount = Number(draft.nodeCount);
  const parsedGpusPerNode = Number(draft.gpusPerNode);
  const parsedDeepspeedStage = Number(draft.deepspeedStage);
  const totalGpuCount = parsedNodeCount * parsedGpusPerNode;
  const canSubmit =
    draft.title.trim().length >= 3 &&
    draft.objective.trim().length >= 8 &&
    draft.baseModel.trim().length >= 2 &&
    draft.datasetName.trim().length >= 2 &&
    draft.datasetSplit.trim().length >= 1 &&
    draft.datasetTextField.trim().length >= 1 &&
    Number.isInteger(parsedNodeCount) &&
    Number.isInteger(parsedGpusPerNode) &&
    parsedNodeCount >= 1 &&
    parsedNodeCount <= 32 &&
    parsedGpusPerNode >= 1 &&
    parsedGpusPerNode <= 16 &&
    totalGpuCount >= 1 &&
    totalGpuCount <= 128 &&
    (draft.distributedBackend !== "deepspeed" ||
      (Number.isInteger(parsedDeepspeedStage) &&
        parsedDeepspeedStage >= 2 &&
        parsedDeepspeedStage <= 3));

  function applyMinimalExample() {
    setDraft(minimalQwenLoraExample);
    setFeedback(null);
    setIsCreateOpen(true);
  }

  function parseStudioConfigSnapshot() {
    const raw = draft.studioConfigJson.trim();
    if (!raw) return undefined;

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      setFeedback({
        tone: "error",
        message: "Studio 配置 JSON 不是合法的 JSON，请修正后再提交。",
      });
      return null;
    }
  }

  function applyStudioConfigToDraft() {
    const studioConfigSnapshot = parseStudioConfigSnapshot();
    if (studioConfigSnapshot === null || studioConfigSnapshot === undefined) {
      if (studioConfigSnapshot === undefined) {
        setFeedback({
          tone: "error",
          message: "请先粘贴 Unsloth Studio JSON，再执行导入。",
        });
      }
      return;
    }

    const inferred = inferDraftFromStudioConfig(studioConfigSnapshot, draft);
    if (inferred.applied.length === 0) {
      setFeedback({
        tone: "error",
        message:
          "当前 JSON 已保存，但没有识别出可自动带入的字段。你仍然可以直接提交，它会作为 studioConfigSnapshot 存档。",
      });
      return;
    }

    setDraft(inferred.draft);
    setFeedback({
      tone: "success",
      message: `已从 Studio JSON 带入：${inferred.applied.join("、")}`,
    });
  }

  function openUnslothStudio() {
    if (!unslothStudioUrl) {
      setFeedback({
        tone: "error",
        message:
          "当前未配置 Unsloth Studio 地址，请先设置 NEXT_PUBLIC_UNSLOTH_STUDIO_URL。",
      });
      return;
    }

    const openedWindow = window.open(
      unslothStudioUrl,
      "_blank",
      "noopener,noreferrer",
    );

    if (!openedWindow) {
      setFeedback({
        tone: "error",
        message: "浏览器拦截了新窗口，请允许弹窗后重试。",
      });
    }
  }

  function openRuntimeDialog(job: TrainingJobItem) {
    setSelectedRuntimePodName(undefined);
    setRuntimeDialog({
      jobId: job.id,
      title: job.title,
    });
  }

  function closeRuntimeDialog() {
    setRuntimeDialog(null);
    setSelectedRuntimePodName(undefined);
  }

  return (
    <ModulePageShell>
      <ProductAreaHeader />

      <ModuleHero
        size="compact"
        eyebrow="Training Jobs"
        title="训练平台"
        description="把训练任务、基础模型、数据集和分布式 GPU 配额统一收口到一张作业表里。"
        icon={BrainCircuitIcon}
        badges={
          <Badge
            variant="outline"
            className="border-border/80 bg-background/60"
          >
            Unsloth / Kubernetes
          </Badge>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-9 rounded-full px-4"
              onClick={() => void jobsQuery.refetch()}
            >
              <RefreshCwIcon
                className={cn(
                  jobsQuery.isFetching ? "animate-spin" : undefined,
                )}
                data-icon="inline-start"
              />
              刷新列表
            </Button>
            <Button
              className="h-9 rounded-full px-4"
              onClick={() => setIsCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              创建训练任务
            </Button>
            <Button
              variant="outline"
              className="h-9 rounded-full px-4"
              onClick={openUnslothStudio}
            >
              <ArrowUpRightIcon data-icon="inline-start" />
              进入 Unsloth Studio
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ModuleMetricCard
            size="compact"
            label="任务总数"
            value={String(jobs.length)}
            description="当前训练控制面中记录的全部任务。"
            icon={BrainCircuitIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="运行中"
            value={String(runningCount)}
            description="已经提交并正在实际执行的训练作业。"
            icon={PlayIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="草稿"
            value={String(draftCount)}
            description="参数已配置但还未开始执行的任务。"
            icon={SquareIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="活跃 GPU"
            value={String(activeGpuCount)}
            description="按照运行中训练任务累计的 GPU 使用量。"
            icon={LoaderCircleIcon}
          />
        </div>
      </ModuleHero>

      {jobsQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>训练任务读取失败</AlertTitle>
          <AlertDescription>{jobsQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert
          variant={feedback.tone === "success" ? "default" : "destructive"}
        >
          <AlertTitle>
            {feedback.tone === "success" ? "操作完成" : "操作失败"}
          </AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="最小示例"
        description="先用一个最小 Qwen LoRA 任务把链路跑通，再逐步替换成自己的模型和数据。下面这组配置对应当前平台的默认 torchrun + DeepSpeed 执行器；如果要调更多高级超参，建议直接进入 Unsloth Studio。"
        action={
          <Button
            variant="outline"
            className="rounded-full"
            onClick={applyMinimalExample}
          >
            <PlusIcon data-icon="inline-start" />
            带入最小示例
          </Button>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="grid gap-4">
            <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(248,250,252,0.88),rgba(255,255,255,0.98))] p-5 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                  Unsloth
                </Badge>
                <Badge
                  variant="outline"
                  className="border-slate-200/90 bg-white/90"
                >
                  Qwen2.5-0.5B
                </Badge>
                <Badge
                  variant="outline"
                  className="border-slate-200/90 bg-white/90"
                >
                  LoRA Smoke Test
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 text-sm">
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    任务标题
                  </span>
                  <span className="font-medium text-slate-900">
                    {minimalQwenLoraExample.title}
                  </span>
                </div>
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    训练目标
                  </span>
                  <span className="leading-6 text-slate-700">
                    {minimalQwenLoraExample.objective}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                    <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                      训练类型
                    </span>
                    <span className="font-medium text-slate-900">
                      {trainingJobTypeLabels[minimalQwenLoraExample.jobType]}
                    </span>
                  </div>
                  <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                    <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                      分布式规格
                    </span>
                    <span className="font-medium text-slate-900">
                      {minimalQwenLoraExample.nodeCount} 节点 x{" "}
                      {minimalQwenLoraExample.gpusPerNode} GPU
                    </span>
                  </div>
                </div>
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    基础模型
                  </span>
                  <span className="font-medium break-all text-slate-900">
                    {minimalQwenLoraExample.baseModel}
                  </span>
                </div>
                <div className="grid gap-1 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-slate-500 uppercase">
                    数据集路径
                  </span>
                  <span className="font-medium break-all text-slate-900">
                    {minimalQwenLoraExample.datasetName}
                  </span>
                  <span className="text-xs leading-5 text-slate-500">
                    这个路径必须存在于训练 Pod
                    挂载卷中；仓库里的文档示例不会自动出现在容器里。
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-amber-200/80 bg-amber-50/70 p-5 text-sm leading-6 text-amber-900 shadow-[0_14px_34px_rgba(15,23,42,0.03)]">
              这是一个最小可跑示例，目标是先验证表单、Kubernetes
              Job、数据读取、LoRA
              保存链路都正常，再把数据集和步数切换到正式配置。
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white/94 p-5 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-semibold tracking-[-0.03em] text-slate-950">
                示例数据文件
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                先把下面 3 行 JSONL 保存到
                <span className="mx-1 font-mono text-[12px] text-slate-900">
                  {minimalQwenLoraExample.datasetName}
                </span>
                ，并确保字段名就是
                <span className="mx-1 font-mono text-[12px] text-slate-900">
                  text
                </span>
                。
              </p>
              <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80 bg-slate-950 px-4 py-4 text-[11px] leading-5 text-slate-100">
                {minimalQwenLoraDatasetPreview.join("\n")}
              </pre>
            </div>

            <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white/94 p-5 shadow-[0_14px_34px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-semibold tracking-[-0.03em] text-slate-950">
                平台默认参数
              </p>
              <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-700">
                {minimalQwenLoraRuntimeNotes.map((note) => (
                  <div
                    key={note}
                    className="rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3"
                  >
                    {note}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                如果你要做正式训练，至少要重新评估 step、batch size、learning
                rate 和数据格式；当前默认值更适合做链路验收。
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {unslothStudioUrl
                  ? "已经配置 Unsloth Studio，可从页面右上角直接进入原生配置界面。"
                  : "如果需要进入 Unsloth 原生页面，请配置 NEXT_PUBLIC_UNSLOTH_STUDIO_URL。"}
              </p>
            </div>
          </div>
        </div>
      </ModuleSection>

      <ModuleSection
        title="任务列表"
        description="查看运行态、优先级、数据集和动作入口。错误信息会直接内嵌在任务行里。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={listFilter === "all" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setListFilter("all")}
            >
              全部 {jobs.length}
            </Button>
            <Button
              variant={listFilter === "running" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setListFilter("running")}
            >
              运行中 {runningCount}
            </Button>
            <Button
              variant={listFilter === "issues" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setListFilter("issues")}
            >
              异常任务 {issueCount}
            </Button>
            <Button
              variant={listFilter === "scheduling" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setListFilter("scheduling")}
            >
              调度失败 {schedulingIssueCount}
            </Button>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60"
            >
              已完成 {completedCount}
            </Badge>
          </div>
        }
      >
        {jobsQuery.isLoading ? <LoadingRows /> : null}

        {!jobsQuery.isLoading && jobs.length === 0 ? (
          <ModuleEmptyState
            title="还没有训练任务"
            description="先创建一个任务，把模型、数据集和 GPU 配额记录进去。"
            action={
              <Button onClick={() => setIsCreateOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                创建第一个任务
              </Button>
            }
          />
        ) : null}

        {!jobsQuery.isLoading && jobs.length > 0 && filteredJobs.length === 0 ? (
          <ModuleEmptyState
            title="当前筛选下没有任务"
            description={
              listFilter === "running"
                ? "当前没有运行中的训练任务。"
                : listFilter === "scheduling"
                  ? "当前没有识别到调度失败任务。"
                  : "当前没有匹配筛选条件的异常任务。"
            }
            action={
              <Button variant="outline" onClick={() => setListFilter("all")}>
                查看全部任务
              </Button>
            }
          />
        ) : null}

        {!jobsQuery.isLoading && filteredJobs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>模型 / 数据集</TableHead>
                <TableHead>资源</TableHead>
                <TableHead>时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredJobs.map((job) => {
                const isStarting =
                  startJob.isPending && startJob.variables?.jobId === job.id;
                const isStopping =
                  stopJob.isPending && stopJob.variables?.jobId === job.id;
                const isDeleting =
                  deleteJob.isPending && deleteJob.variables?.jobId === job.id;
                const status: keyof typeof trainingJobStatusLabels = job.status;
                const canStart =
                  status === "draft" ||
                  status === "stopped" ||
                  status === "failed";

                return (
                  <TableRow key={job.id} className="border-border/70">
                    <TableCell className="align-top">
                      <div className="flex max-w-[26rem] flex-col gap-2">
                        <div className="flex flex-col gap-1">
                          <p className="text-foreground font-medium">
                            {job.title}
                          </p>
                          <p className="text-muted-foreground text-sm">
                            {trainingJobTypeLabels[job.jobType]} ·{" "}
                            <span className={priorityTone(job.priority)}>
                              {priorityLabels[job.priority]}优先级
                            </span>
                          </p>
                        </div>
                        <p className="text-muted-foreground line-clamp-2 text-sm leading-6">
                          {job.objective}
                        </p>
                        {job.runtimeJobName ? (
                          <p className="text-muted-foreground text-xs leading-5">
                            K8s Job: {job.runtimeNamespace ?? "default"}/
                            {job.runtimeJobName}
                          </p>
                        ) : null}
                        {job.runtimeServiceName ? (
                          <p className="text-muted-foreground text-xs leading-5">
                            Headless Service: {job.runtimeServiceName}
                          </p>
                        ) : null}
                        {job.artifactPath ? (
                          <p className="text-muted-foreground text-xs leading-5">
                            产物目录: {job.artifactPath}
                          </p>
                        ) : null}
                        {job.runtimeSummary ? (
                          <div
                            className={cn(
                              "rounded-2xl border px-3 py-2 text-xs leading-5",
                              runtimeSummaryTone(job.runtimeSummaryTone),
                            )}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">最近运行态</span>
                              {job.runtimeSummaryAt ? (
                                <span className="opacity-80">
                                  {formatTime(job.runtimeSummaryAt)}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1">{job.runtimeSummary}</div>
                          </div>
                        ) : null}
                        {job.lastError ? (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                            {job.lastError}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge
                        variant="outline"
                        className={cn("rounded-full", statusTone(status))}
                      >
                        {trainingJobStatusLabels[status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground font-medium">
                          {job.baseModel}
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {job.datasetName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-foreground font-medium">
                          {job.nodeCount} 节点 x {job.gpusPerNode} GPU
                        </span>
                        <span className="text-muted-foreground">
                          总计 {job.gpuCount} GPU ·{" "}
                          {
                            trainingDistributedBackendLabels[
                              job.distributedBackend as keyof typeof trainingDistributedBackendLabels
                            ]
                          }
                        </span>
                        <span className="text-muted-foreground">
                          {
                            trainingLauncherTypeLabels[
                              job.launcherType as keyof typeof trainingLauncherTypeLabels
                            ]
                          }{" "}
                          ·{" "}
                          {
                            trainingPrecisionLabels[
                              (job.precision ?? "auto") as keyof typeof trainingPrecisionLabels
                            ]
                          }
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-foreground font-medium">
                          {formatTime(job.updatedAt ?? job.createdAt)}
                        </span>
                        <span className="text-muted-foreground">
                          启动: {formatTime(job.startedAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex justify-end gap-2">
                        {job.runtimeJobName ? (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => openRuntimeDialog(job)}
                          >
                            运行态
                          </Button>
                        ) : null}

                        {canStart ? (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => startJob.mutate({ jobId: job.id })}
                          >
                            {isStarting ? (
                              <LoaderCircleIcon
                                className="animate-spin"
                                data-icon="inline-start"
                              />
                            ) : (
                              <PlayIcon data-icon="inline-start" />
                            )}
                            {isStarting ? "启动中" : "启动"}
                          </Button>
                        ) : null}

                        {job.status === "running" ? (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            disabled={isStarting || isStopping || isDeleting}
                            onClick={() => stopJob.mutate({ jobId: job.id })}
                          >
                            {isStopping ? (
                              <LoaderCircleIcon
                                className="animate-spin"
                                data-icon="inline-start"
                              />
                            ) : (
                              <SquareIcon data-icon="inline-start" />
                            )}
                            {isStopping ? "停止中" : "停止"}
                          </Button>
                        ) : null}

                        <Button
                          variant="destructive"
                          className="rounded-full"
                          disabled={
                            job.status === "running" ||
                            isStarting ||
                            isStopping ||
                            isDeleting
                          }
                          onClick={() => {
                            if (
                              !window.confirm(
                                `确认删除训练任务「${job.title}」吗？`,
                              )
                            ) {
                              return;
                            }

                            deleteJob.mutate({ jobId: job.id });
                          }}
                        >
                          {isDeleting ? (
                            <LoaderCircleIcon
                              className="animate-spin"
                              data-icon="inline-start"
                            />
                          ) : (
                            <Trash2Icon data-icon="inline-start" />
                          )}
                          {isDeleting ? "删除中" : "删除"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </ModuleSection>

      <Dialog
        open={Boolean(runtimeDialog)}
        onOpenChange={(open) => {
          if (!open) closeRuntimeDialog();
        }}
      >
        <DialogContent className="border-border/70 bg-background/95 text-foreground max-w-[1040px] p-0 backdrop-blur-xl">
          <DialogHeader className="border-border/70 border-b px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              训练运行态
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-6">
              {runtimeDialog
                ? `${runtimeDialog.title} 的 Pod、事件和最近日志。`
                : "查看当前训练任务的运行态。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => void runtimeDetailQuery.refetch()}
                disabled={!runtimeDialog || runtimeDetailQuery.isFetching}
              >
                <RefreshCwIcon
                  className={cn(
                    runtimeDetailQuery.isFetching ? "animate-spin" : undefined,
                  )}
                  data-icon="inline-start"
                />
                刷新运行态
              </Button>
              {runtimeDetail?.selectedPodName ? (
                <Field label="日志 Pod">
                  <Select
                    value={
                      selectedRuntimePodName ??
                      runtimeDetail.selectedPodName ??
                      undefined
                    }
                    onValueChange={(value) => {
                      const nextValue = value ?? "";
                      setSelectedRuntimePodName(
                        nextValue.length > 0 ? nextValue : undefined,
                      );
                    }}
                  >
                    <SelectTrigger className="min-w-[260px]">
                      <SelectValue placeholder="选择 Pod" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {runtimeDetail.pods.map((pod) => (
                          <SelectItem key={pod.name} value={pod.name}>
                            {pod.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>

            {runtimeDetailQuery.error ? (
              <Alert variant="destructive">
                <AlertTitle>运行态读取失败</AlertTitle>
                <AlertDescription>
                  {runtimeDetailQuery.error.message}
                </AlertDescription>
              </Alert>
            ) : null}

            {!runtimeDetailQuery.error && runtimeDetailQuery.isLoading ? (
              <div className="grid gap-3">
                <Skeleton className="h-24 rounded-3xl" />
                <Skeleton className="h-40 rounded-3xl" />
                <Skeleton className="h-56 rounded-3xl" />
              </div>
            ) : null}

            {!runtimeDetailQuery.isLoading && runtimeDetail === null ? (
              <Alert>
                <AlertTitle>还没有运行态对象</AlertTitle>
                <AlertDescription>
                  当前任务还没有可读取的 Kubernetes Job / Pod 运行态。
                </AlertDescription>
              </Alert>
            ) : null}

            {runtimeDetail ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Namespace
                    </p>
                    <p className="mt-2 font-medium text-slate-950">
                      {runtimeDetail.namespace}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Job
                    </p>
                    <p className="mt-2 break-all font-medium text-slate-950">
                      {runtimeDetail.jobName}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Service
                    </p>
                    <p className="mt-2 break-all font-medium text-slate-950">
                      {runtimeDetail.serviceName ?? "未记录"}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-4">
                    <p className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                      Leader Pod
                    </p>
                    <p className="mt-2 break-all font-medium text-slate-950">
                      {runtimeDetail.leaderPodName ?? "未记录"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium tracking-[-0.03em] text-slate-950">
                          Pods
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {runtimeDetail.pods.length} Pods
                        </Badge>
                      </div>
                      <div className="mt-4 grid gap-3">
                        {runtimeDetail.pods.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                            当前还没有读到任何 Pod。
                          </div>
                        ) : (
                          runtimeDetail.pods.map((pod) => (
                            <div
                              key={pod.name}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-slate-950">
                                  {pod.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    pod.phase === "Running"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : pod.phase === "Succeeded"
                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                        : pod.phase === "Failed"
                                          ? "border-rose-200 bg-rose-50 text-rose-700"
                                          : "border-slate-200 bg-white text-slate-700",
                                  )}
                                >
                                  {pod.phase}
                                </Badge>
                                {pod.completionIndex ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-slate-200 bg-white"
                                  >
                                    rank {pod.completionIndex}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-2 grid gap-1 text-xs leading-5 text-slate-600">
                                <span>
                                  节点: {pod.nodeName ?? "未知"} · Pod IP:{" "}
                                  {pod.podIP ?? "未知"} · 重启: {pod.restarts}
                                </span>
                                <span>
                                  启动时间: {formatTime(pod.startedAt)} · Ready:{" "}
                                  {pod.ready ? "Yes" : "No"}
                                </span>
                                <span>
                                  原因: {pod.reason ?? "无"}
                                </span>
                                {pod.containerStatuses.length > 0 ? (
                                  <span className="break-all">
                                    容器状态:{" "}
                                    {pod.containerStatuses
                                      .map(
                                        (status) =>
                                          `${status.name}=${status.state}`,
                                      )
                                      .join(" | ")}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium tracking-[-0.03em] text-slate-950">
                          K8s Events
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {runtimeDetail.events.length} Events
                        </Badge>
                      </div>
                      <div className="mt-4 grid max-h-[320px] gap-3 overflow-y-auto pr-1">
                        {runtimeDetail.events.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                            当前没有读到相关事件。
                          </div>
                        ) : (
                          runtimeDetail.events.map((event, index) => (
                            <div
                              key={`${event.involvedName ?? "event"}-${index}`}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    event.type === "Warning"
                                      ? "border-amber-200 bg-amber-50 text-amber-700"
                                      : "border-slate-200 bg-white text-slate-700",
                                  )}
                                >
                                  {event.type ?? "Info"}
                                </Badge>
                                <span className="font-medium text-slate-950">
                                  {event.reason ?? "Unknown"}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {event.involvedKind ?? "Object"} /{" "}
                                  {event.involvedName ?? "Unknown"}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-700">
                                {event.message}
                              </p>
                              <p className="mt-2 text-xs text-slate-500">
                                {formatTime(event.at)} · count {event.count}
                                {event.source ? ` · ${event.source}` : ""}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-slate-200/80 bg-white/88 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium tracking-[-0.03em] text-slate-950">
                          最近日志
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {runtimeDetail.selectedPodName ?? "未选择 Pod"}
                        </Badge>
                      </div>
                      <pre className="mt-4 max-h-[720px] overflow-auto rounded-2xl border border-slate-200/80 bg-slate-950 px-4 py-4 text-[11px] leading-5 whitespace-pre-wrap text-slate-100">
                        {runtimeDetail.logText &&
                        runtimeDetail.logText.trim().length > 0
                          ? runtimeDetail.logText.trim()
                          : "当前没有可显示的日志。Pod 可能尚未启动，或者日志还没有产生。"}
                      </pre>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter className="border-border/70 bg-muted/30 border-t px-6 py-4">
            <Button variant="outline" onClick={closeRuntimeDialog}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="border-border/70 bg-background/95 text-foreground max-w-[880px] p-0 backdrop-blur-xl">
          <DialogHeader className="border-border/70 border-b px-6 py-5">
            <DialogTitle className="text-2xl tracking-[-0.04em]">
              创建训练任务
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-6">
              当前启动后会提交到 Kubernetes，使用 Unsloth 容器通过
              Indexed Job、Headless Service 和 torchrun 执行。数据集可填写
              Hugging Face 数据集名，或挂载卷里的文件路径。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <Field label="任务标题">
              <Input
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="例如：Qwen3 客服语料 LoRA 微调"
              />
            </Field>

            <Field label="训练目标">
              <Textarea
                className="min-h-28 resize-none"
                value={draft.objective}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    objective: event.target.value,
                  }))
                }
                placeholder="说明任务目标、产出物和预期效果。"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="配置来源">
                <Select
                  value={draft.configSource}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      configSource: value! ?? current.configSource,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择配置来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {trainingConfigSourceValues.map((configSource) => (
                        <SelectItem key={configSource} value={configSource}>
                          {trainingConfigSourceLabels[configSource]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="训练类型">
                <Select
                  value={draft.jobType}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      jobType: value ?? current.jobType,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择训练类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {trainingJobTypeValues.map((jobType) => (
                        <SelectItem key={jobType} value={jobType}>
                          {trainingJobTypeLabels[jobType]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="优先级">
                <Select
                  value={draft.priority}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      priority: value!,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择优先级" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {priorityValues.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {priorityLabels[priority]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="精度">
                <Select
                  value={draft.precision}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      precision: value! ?? current.precision,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择精度" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {trainingPrecisionValues.map((precision) => (
                        <SelectItem key={precision} value={precision}>
                          {trainingPrecisionLabels[precision]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="4-bit 加载">
                <Select
                  value={draft.loadIn4bit}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      loadIn4bit: value === "false" ? "false" : "true",
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择量化策略" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="true">启用 4-bit</SelectItem>
                      <SelectItem value="false">关闭 4-bit</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="基础模型"
                hint="最小 smoke test 可直接使用 unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit"
              >
                <Input
                  value={draft.baseModel}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      baseModel: event.target.value,
                    }))
                  }
                  placeholder="Qwen/Qwen3-8B"
                />
              </Field>

              <Field
                label="数据集"
                hint="可填写 Hugging Face 数据集名，或挂载卷里的文件路径"
              >
                <Input
                  value={draft.datasetName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      datasetName: event.target.value,
                    }))
                  }
                  placeholder="例如：cola/support-v2 或 /workspace/datasets/support.jsonl"
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Field label="节点数" hint="范围 1-32">
                <Input
                  type="number"
                  min={1}
                  max={32}
                  value={draft.nodeCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      nodeCount: event.target.value,
                    }))
                  }
                  placeholder="1"
                />
              </Field>

              <Field
                label="每节点 GPU"
                hint="范围 1-16"
              >
                <Input
                  type="number"
                  min={1}
                  max={16}
                  value={draft.gpusPerNode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpusPerNode: event.target.value,
                    }))
                  }
                  placeholder="1"
                />
              </Field>

              <Field label="启动器">
                <Select
                  value={draft.launcherType}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      launcherType: value! ?? current.launcherType,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择启动器" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {trainingLauncherTypeValues.map((launcherType) => (
                        <SelectItem key={launcherType} value={launcherType}>
                          {trainingLauncherTypeLabels[launcherType]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="后端">
                <Select
                  value={draft.distributedBackend}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      distributedBackend: value! ?? current.distributedBackend,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择后端" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {trainingDistributedBackendValues.map((backend) => (
                        <SelectItem key={backend} value={backend}>
                          {trainingDistributedBackendLabels[backend]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="数据集 Split">
                <Input
                  value={draft.datasetSplit}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      datasetSplit: event.target.value,
                    }))
                  }
                  placeholder="train"
                />
              </Field>

              <Field label="文本字段">
                <Input
                  value={draft.datasetTextField}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      datasetTextField: event.target.value,
                    }))
                  }
                  placeholder="text"
                />
              </Field>

              <Field label="DeepSpeed Stage">
                <Select
                  value={draft.deepspeedStage}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      deepspeedStage: value ?? current.deepspeedStage,
                    }))
                  }
                  disabled={draft.distributedBackend !== "deepspeed"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 Stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="2">ZeRO-2</SelectItem>
                      <SelectItem value="3">ZeRO-3</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700">
              当前将申请
              <span className="mx-1 font-medium text-slate-950">
                {Number.isFinite(totalGpuCount) ? totalGpuCount : "-"}
              </span>
              张 GPU，规格为
              <span className="mx-1 font-medium text-slate-950">
                {draft.nodeCount} 节点 x {draft.gpusPerNode} GPU
              </span>
              ，使用
              <span className="mx-1 font-medium text-slate-950">
                {trainingLauncherTypeLabels[draft.launcherType]}
              </span>
              和
              <span className="mx-1 font-medium text-slate-950">
                {trainingDistributedBackendLabels[draft.distributedBackend]}
              </span>
              。
            </div>

            <Field
              label="Unsloth Studio JSON（可选）"
              hint="如果你从 Unsloth Studio 导出了配置，可先粘贴到这里；Cola 会把它作为 studioConfigSnapshot 保存。"
            >
              <Textarea
                className="min-h-28 resize-y font-mono text-xs"
                value={draft.studioConfigJson}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    studioConfigJson: event.target.value,
                    configSource: event.target.value.trim()
                      ? "unsloth_studio"
                      : current.configSource === "unsloth_studio"
                        ? "manual"
                        : current.configSource,
                  }))
                }
                placeholder='例如：{"project":"qwen-lora","notes":"exported from studio"}'
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={applyStudioConfigToDraft}
              >
                <RefreshCwIcon data-icon="inline-start" />
                从 Studio JSON 带入字段
              </Button>
              <p className="text-muted-foreground text-xs leading-5">
                这是宽松兼容解析：会优先识别模型、数据集、文本字段、节点数、每节点
                GPU、精度、DeepSpeed Stage 和 4-bit 设置。
              </p>
            </div>
          </div>

          <DialogFooter className="border-border/70 bg-muted/30 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!canSubmit || createJob.isPending}
              onClick={() => {
                const studioConfigSnapshot = parseStudioConfigSnapshot();
                if (studioConfigSnapshot === null) return;

                createJob.mutate({
                  title: draft.title.trim(),
                  objective: draft.objective.trim(),
                  configSource: studioConfigSnapshot
                    ? "unsloth_studio"
                    : draft.configSource,
                  jobType: draft.jobType,
                  priority: draft.priority,
                  baseModel: draft.baseModel.trim(),
                  datasetName: draft.datasetName.trim(),
                  datasetSplit: draft.datasetSplit.trim(),
                  datasetTextField: draft.datasetTextField.trim(),
                  nodeCount: parsedNodeCount,
                  gpusPerNode: parsedGpusPerNode,
                  launcherType: draft.launcherType,
                  distributedBackend: draft.distributedBackend,
                  deepspeedStage:
                    draft.distributedBackend === "deepspeed"
                      ? parsedDeepspeedStage
                      : null,
                  precision: draft.precision,
                  loadIn4bit: draft.loadIn4bit === "true",
                  ...(studioConfigSnapshot
                    ? { studioConfigSnapshot }
                    : {}),
                });
              }}
            >
              {createJob.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {createJob.isPending ? "创建中" : "创建训练任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModulePageShell>
  );
}
