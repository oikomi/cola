"use client";

import {
  ArrowUpRightIcon,
  CpuIcon,
  LoaderCircleIcon,
  NotebookTabsIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { notifyError, notifySuccess } from "@/components/ui/toast";
import {
  formatGpuAllocationLabel,
  gpuAllocationModeLabels,
  gpuAllocationModeValues,
} from "@/lib/gpu-allocation";
import { cn, optionLabel } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type JupyterLabItem =
  RouterOutputs["training"]["listJupyterLabs"]["items"][number];
type JupyterLabImageOption =
  RouterOutputs["training"]["listJupyterLabs"]["imageOptions"][number];

type JupyterLabDraft = {
  name: string;
  image: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: (typeof gpuAllocationModeValues)[number];
  gpuCount: string;
  gpuMemoryGi: string;
};

const defaultJupyterLabDraft: JupyterLabDraft = {
  name: "",
  image: "",
  cpu: "4",
  memoryGi: "16",
  gpuAllocationMode: "whole",
  gpuCount: "0",
  gpuMemoryGi: "",
};

const dialogControlClassName =
  "h-11 rounded-2xl border-slate-200/90 bg-white/92 px-3 text-[15px] shadow-[0_1px_0_rgba(255,255,255,0.7)]";

function sanitizeDnsNameInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48);
}

function formatTime(value: Date | string | null | undefined) {
  if (!value) return "未知";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function jupyterLabStatusTone(status: JupyterLabItem["status"]) {
  switch (status) {
    case "running":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function jupyterLabStatusLabel(status: JupyterLabItem["status"]) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "error":
      return "异常";
    default:
      return status;
  }
}

function jupyterLabSpecLabel(lab: JupyterLabItem) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: lab.gpuAllocationMode,
    gpuCount: lab.gpuCount,
    gpuMemoryGi: lab.gpuMemoryGi,
  })} · ${lab.cpu} CPU · ${lab.memory}`;
}

function formatJupyterLabDraftSpec(draft: JupyterLabDraft) {
  const gpuCount = Number(draft.gpuCount);
  const gpuMemoryGi = Number(draft.gpuMemoryGi);

  return `${formatGpuAllocationLabel({
    gpuAllocationMode: draft.gpuAllocationMode,
    gpuCount: Number.isFinite(gpuCount) ? gpuCount : 0,
    gpuMemoryGi:
      draft.gpuAllocationMode === "memory" && Number.isFinite(gpuMemoryGi)
        ? gpuMemoryGi
        : null,
  })} · ${draft.cpu || "-"} CPU · ${draft.memoryGi || "-"} Gi`;
}

function jupyterLabImageLabel(option?: JupyterLabImageOption) {
  if (!option) return "选择镜像";
  return `${option.label} · ${option.image}`;
}

function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2", props.className)}>
      <span className="text-[13px] font-medium text-slate-700">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-5 text-slate-500">{props.hint}</span>
      ) : null}
    </label>
  );
}

function SurfaceLabel(props: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-medium tracking-[0.16em] text-slate-500 uppercase">
      {props.children}
    </p>
  );
}

function JupyterLabLoadingRows() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[var(--radius-shell)] border border-slate-200/85 bg-white/90 p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-[11px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function JupyterLabCard(props: {
  lab: JupyterLabItem;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const { lab } = props;

  return (
    <article className="rounded-[var(--radius-shell)] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.9))] p-4 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-slate-200/85 bg-white text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.035)]">
            <NotebookTabsIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] leading-6 font-semibold tracking-normal text-slate-950">
              {lab.name}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              更新于 {formatTime(lab.updatedAt)}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-xs",
            jupyterLabStatusTone(lab.status),
          )}
        >
          {jupyterLabStatusLabel(lab.status)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 rounded-[var(--radius-shell)] border border-slate-200/75 bg-slate-50/80 px-3.5 py-3 text-sm leading-6 text-slate-600">
        <div>
          <SurfaceLabel>资源规格</SurfaceLabel>
          <p className="mt-1 font-medium text-slate-950">
            {jupyterLabSpecLabel(lab)}
          </p>
        </div>
        <div>
          <SurfaceLabel>节点 / 入口</SurfaceLabel>
          <p className="mt-1 font-mono text-[12px] break-all text-slate-700">
            {lab.nodeName ?? "未分配节点"} · {lab.endpoint ?? "入口待分配"}
          </p>
        </div>
        <div>
          <SurfaceLabel>镜像</SurfaceLabel>
          <p className="mt-1 font-mono text-[12px] break-all text-slate-700">
            {lab.image}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        {lab.labUrl ? (
          <a
            href={lab.labUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-8 rounded-full px-3 text-[13px]",
            )}
          >
            <ArrowUpRightIcon data-icon="inline-start" />
            打开 Lab
          </a>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full px-3 text-[13px] text-slate-500"
            disabled
          >
            打开 Lab
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full border-rose-200/80 bg-white px-3 text-[13px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          disabled={props.isDeleting}
          onClick={props.onDelete}
        >
          {props.isDeleting ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <Trash2Icon data-icon="inline-start" />
          )}
          {props.isDeleting ? "删除中" : "删除"}
        </Button>
      </div>
    </article>
  );
}

export function TrainingShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const jupyterLabsQuery = api.training.listJupyterLabs.useQuery(undefined, {
    refetchInterval: 8000,
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [draft, setDraft] = useState(defaultJupyterLabDraft);
  const [pendingDeletedNames, setPendingDeletedNames] = useState<string[]>([]);

  const jupyterLabs = (jupyterLabsQuery.data?.items ?? []).filter(
    (lab) => !pendingDeletedNames.includes(lab.name),
  );
  const capabilityReason = jupyterLabsQuery.data?.reason ?? null;
  const available = jupyterLabsQuery.data?.available === true;
  const imageOptions = useMemo(
    () => jupyterLabsQuery.data?.imageOptions ?? [],
    [jupyterLabsQuery.data?.imageOptions],
  );
  const selectedImage =
    imageOptions.find((option) => option.image === draft.image) ??
    imageOptions[0] ??
    null;
  const selectedImageValue = selectedImage?.image ?? "";
  const runningCount = jupyterLabs.filter(
    (lab) => lab.status === "running",
  ).length;
  const gpuLabCount = jupyterLabs.filter((lab) => lab.gpuCount > 0).length;
  const totalRequestedGpu = jupyterLabs.reduce(
    (total, lab) => total + lab.gpuCount,
    0,
  );

  const parsedMemoryGi = Number(draft.memoryGi);
  const parsedGpuCount = Number(draft.gpuCount);
  const parsedGpuMemoryGi = Number(draft.gpuMemoryGi);
  const nameReady = draft.name.trim().length >= 2;
  const imageReady = Boolean(selectedImage);
  const memoryReady =
    Number.isInteger(parsedMemoryGi) &&
    parsedMemoryGi >= 1 &&
    parsedMemoryGi <= 2048;
  const gpuCountMin = draft.gpuAllocationMode === "whole" ? 0 : 1;
  const gpuCountReady =
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= gpuCountMin &&
    parsedGpuCount <= 16;
  const gpuMemoryReady =
    draft.gpuAllocationMode === "whole" ||
    (Number.isInteger(parsedGpuMemoryGi) &&
      parsedGpuMemoryGi >= 1 &&
      parsedGpuMemoryGi <= 1024);
  const canCreate =
    available &&
    nameReady &&
    imageReady &&
    memoryReady &&
    gpuCountReady &&
    gpuMemoryReady;
  const submitDisabledReason = !available
    ? (capabilityReason ?? "Kubernetes 当前不可用")
    : !nameReady
      ? "请输入至少 2 个字符的环境名称"
      : !imageReady
        ? "请选择 JupyterLab 镜像"
        : !memoryReady
          ? "内存范围必须是 1-2048 Gi"
          : !gpuCountReady
            ? draft.gpuAllocationMode === "memory"
              ? "显存份额模式下 GPU 份额范围是 1-16"
              : "整卡模式下 GPU 范围是 0-16"
            : !gpuMemoryReady
              ? "显存份额模式下每份额显存范围是 1-1024 Gi"
              : null;

  useEffect(() => {
    if (!jupyterLabsQuery.error) return;
    notifyError({
      title: "JupyterLab 读取失败",
      message: jupyterLabsQuery.error.message,
    });
  }, [jupyterLabsQuery.error]);

  useEffect(() => {
    if (!capabilityReason) return;
    notifyError({
      title: "JupyterLab 集群访问异常",
      message: capabilityReason,
    });
  }, [capabilityReason]);

  useEffect(() => {
    if (draft.image || imageOptions.length === 0) return;
    setDraft((current) => ({
      ...current,
      image: imageOptions[0]?.image ?? "",
    }));
  }, [draft.image, imageOptions]);

  const createJupyterLab = api.training.createJupyterLab.useMutation({
    onSuccess: (result) => {
      notifySuccess(result.message);
      setDraft(defaultJupyterLabDraft);
      setIsCreateOpen(false);
      void utils.training.listJupyterLabs.invalidate();
    },
    onError: (error) => {
      notifyError(error.message);
    },
  });

  const deleteJupyterLab = api.training.deleteJupyterLab.useMutation({
    onMutate: ({ name }) => {
      setPendingDeletedNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: (result) => {
      notifySuccess(result.message);
      void utils.training.listJupyterLabs.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      notifyError(error.message);
    },
  });

  function openCreateDialog() {
    setIsCreateOpen(true);
  }

  function handleCreateJupyterLab() {
    if (!canCreate) return;

    createJupyterLab.mutate({
      name: draft.name.trim(),
      image: selectedImageValue,
      cpu: draft.cpu.trim(),
      memoryGi: parsedMemoryGi,
      gpuAllocationMode: draft.gpuAllocationMode,
      gpuCount: parsedGpuCount,
      gpuMemoryGi:
        draft.gpuAllocationMode === "memory" ? parsedGpuMemoryGi : null,
    });
  }

  async function handleDeleteJupyterLab(name: string) {
    const confirmed = await confirm({
      title: `确认删除 JupyterLab「${name}」？`,
      description: "系统会删除对应的 Kubernetes Deployment 和 Service。",
      confirmLabel: "删除 JupyterLab",
      cancelLabel: "取消",
      confirmVariant: "destructive",
    });
    if (!confirmed) return;

    deleteJupyterLab.mutate({ name });
  }

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Training Workspace"
        title="训练作业"
        description="训练作业入口暂时只保留 JupyterLab 环境，用于数据检查、notebook 实验和单 Pod 调试。"
        icon={NotebookTabsIcon}
        size="compact"
        density="dense"
        badges={
          <Badge className="border border-slate-200/90 bg-white/86 text-slate-700">
            {available ? "Kubernetes 可用" : "Kubernetes 不可用"}
          </Badge>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={jupyterLabsQuery.isFetching}
              onClick={() => void jupyterLabsQuery.refetch()}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn(
                  jupyterLabsQuery.isFetching ? "animate-spin" : undefined,
                )}
              />
              刷新
            </Button>
            <Button disabled={!available} onClick={openCreateDialog}>
              <PlusIcon data-icon="inline-start" />
              新建 JupyterLab
            </Button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <ModuleMetricCard
            size="compact"
            label="环境"
            value={`${runningCount}/${jupyterLabs.length}`}
            description="运行中 / 全部"
            icon={NotebookTabsIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="GPU 环境"
            value={String(gpuLabCount)}
            description="已申请 GPU 的 Lab"
            icon={CpuIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="GPU 申请"
            value={String(totalRequestedGpu)}
            description="当前页面记录的总 GPU 数"
            icon={ServerIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        density="compact"
        title="JupyterLab 环境"
        description="创建、打开、刷新和删除 Kubernetes 中的 JupyterLab 环境。"
        action={
          <Button disabled={!available} onClick={openCreateDialog}>
            <PlusIcon data-icon="inline-start" />
            新建 JupyterLab
          </Button>
        }
      >
        {jupyterLabsQuery.isLoading ? <JupyterLabLoadingRows /> : null}

        {!jupyterLabsQuery.isLoading && jupyterLabs.length === 0 ? (
          <ModuleEmptyState
            title="还没有 JupyterLab 环境"
            description="创建一个环境后，可以从这里直接进入 JupyterLab。"
            action={
              <Button disabled={!available} onClick={openCreateDialog}>
                <PlusIcon data-icon="inline-start" />
                新建 JupyterLab
              </Button>
            }
          />
        ) : null}

        {!jupyterLabsQuery.isLoading && jupyterLabs.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {jupyterLabs.map((lab) => (
              <JupyterLabCard
                key={lab.id}
                lab={lab}
                isDeleting={
                  deleteJupyterLab.isPending &&
                  deleteJupyterLab.variables?.name === lab.name
                }
                onDelete={() => void handleDeleteJupyterLab(lab.name)}
              />
            ))}
          </div>
        ) : null}
      </ModuleSection>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="border-slate-200/85 bg-white shadow-[0_28px_68px_rgba(15,23,42,0.14)] sm:max-w-2xl">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-2">
              <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                JupyterLab
              </Badge>
              <Badge
                variant="outline"
                className="border-slate-200/90 bg-white/90"
              >
                Kubernetes Deployment
              </Badge>
            </div>
            <DialogTitle>新建 JupyterLab</DialogTitle>
            <DialogDescription>
              选择 CPU、内存、整卡或 HAMi 显存份额后，Cola 会在训练命名空间拉起
              JupyterLab 并分配 NodePort 入口。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <Field
              label="环境名称"
              hint={
                nameReady
                  ? "将用于生成 Kubernetes Deployment / Service 名称。"
                  : "名称至少 2 个字符，仅支持小写字母、数字和连字符。"
              }
            >
              <Input
                className={dialogControlClassName}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: sanitizeDnsNameInput(event.target.value),
                  }))
                }
                placeholder="例如：data-lab-01"
              />
            </Field>

            <Field
              label="镜像"
              hint={
                selectedImage?.description ?? "镜像列表由后端提供，最多 5 个。"
              }
            >
              <Select
                value={selectedImageValue}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    image: value ?? "",
                  }))
                }
              >
                <SelectTrigger className={cn("w-full", dialogControlClassName)}>
                  <SelectValue placeholder="选择镜像">
                    {jupyterLabImageLabel(selectedImage ?? undefined)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {imageOptions.map((option) => (
                      <SelectItem key={option.image} value={option.image}>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-muted-foreground max-w-[520px] truncate text-xs">
                            {option.image}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="CPU">
                <Input
                  className={dialogControlClassName}
                  inputMode="decimal"
                  value={draft.cpu}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cpu: event.target.value,
                    }))
                  }
                  placeholder="4"
                />
              </Field>

              <Field
                label="内存 (Gi)"
                hint={memoryReady ? undefined : "范围 1-2048。"}
              >
                <Input
                  className={dialogControlClassName}
                  inputMode="numeric"
                  value={draft.memoryGi}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      memoryGi: event.target.value,
                    }))
                  }
                  placeholder="16"
                />
              </Field>

              <Field
                label="GPU 分配方式"
                hint="选择整卡或 HAMi 显存份额；CPU-only 环境可使用整卡模式并把 GPU 填 0。"
              >
                <Select
                  value={draft.gpuAllocationMode}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      gpuAllocationMode:
                        value === "memory" ? "memory" : "whole",
                      gpuCount:
                        value === "memory" &&
                        Number.parseInt(current.gpuCount, 10) < 1
                          ? "1"
                          : current.gpuCount,
                      gpuMemoryGi:
                        value === "memory" ? current.gpuMemoryGi || "8" : "",
                    }))
                  }
                >
                  <SelectTrigger
                    className={cn("w-full", dialogControlClassName)}
                  >
                    <SelectValue placeholder="选择分配方式">
                      {optionLabel(gpuAllocationModeLabels, "选择分配方式")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {gpuAllocationModeValues.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {gpuAllocationModeLabels[mode]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={
                  draft.gpuAllocationMode === "memory" ? "GPU 份额" : "GPU"
                }
                hint={
                  gpuCountReady
                    ? undefined
                    : draft.gpuAllocationMode === "memory"
                      ? "显存模式下至少 1 个 GPU 份额。"
                      : "整卡模式范围 0-16。"
                }
              >
                <Input
                  className={dialogControlClassName}
                  inputMode="numeric"
                  value={draft.gpuCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuCount: event.target.value,
                    }))
                  }
                  placeholder="0"
                />
              </Field>

              <Field
                label="每份额显存 (Gi)"
                hint={
                  draft.gpuAllocationMode === "memory"
                    ? gpuMemoryReady
                      ? "仅显存模式生效。"
                      : "范围 1-1024。"
                    : "整卡模式不需要填写。"
                }
                className="md:col-span-2"
              >
                <Input
                  className={cn(
                    dialogControlClassName,
                    draft.gpuAllocationMode !== "memory"
                      ? "bg-slate-100/90 text-slate-400"
                      : undefined,
                  )}
                  inputMode="numeric"
                  value={draft.gpuMemoryGi}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuMemoryGi: event.target.value,
                    }))
                  }
                  placeholder="8"
                  disabled={draft.gpuAllocationMode !== "memory"}
                />
              </Field>
            </div>

            <div className="rounded-[var(--radius-shell)] border border-sky-200/70 bg-sky-50/70 px-4 py-3 text-sm leading-6 text-slate-700">
              当前规格：
              <span className="mx-1 font-semibold text-slate-950">
                {formatJupyterLabDraftSpec(draft)}
              </span>
              ，镜像：
              <span className="ml-1 font-semibold text-slate-950">
                {selectedImage?.label ?? "未选择"}
              </span>
            </div>

            {submitDisabledReason ? (
              <div className="rounded-[var(--radius-shell)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                {submitDisabledReason}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!canCreate || createJupyterLab.isPending}
              onClick={handleCreateJupyterLab}
            >
              {createJupyterLab.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <NotebookTabsIcon data-icon="inline-start" />
              )}
              {createJupyterLab.isPending ? "创建中" : "创建 JupyterLab"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </ModulePageShell>
  );
}
