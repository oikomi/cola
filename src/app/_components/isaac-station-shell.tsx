"use client";

import {
  ArrowUpRightIcon,
  CpuIcon,
  LoaderCircleIcon,
  PlusIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  ModuleHero,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { ResourceOwnerBadge } from "@/app/_components/resource-owner";
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
import { notifyError } from "@/components/ui/toast";
import {
  formatGpuAllocationLabel,
  gpuAllocationModeLabels,
  gpuAllocationModeValues,
} from "@/lib/gpu-allocation";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type IsaacStationRow = RouterOutputs["isaacStation"]["list"]["items"][number];
type IsaacStationImageOption =
  RouterOutputs["isaacStation"]["list"]["imageOptions"][number];
type GpuAllocationMode = (typeof gpuAllocationModeValues)[number];
type IsaacStationMode = "headless-webrtc" | "headless-egl";

type IsaacStationDraft = {
  name: string;
  image: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: GpuAllocationMode;
  gpuCount: string;
  gpuMemoryGi: string;
  mode: IsaacStationMode;
};

const STATUS_POLL_INTERVAL_MS = 5000;
const dialogControlClassName =
  "h-9 rounded-[10px] border-slate-200/90 bg-white/92 px-2.5 text-[13px] shadow-none";
const selectContentClassName = "max-h-72 rounded-[10px]";
const selectItemClassName = "py-1 pr-7 pl-1.5 text-[13px]";

const defaultDraft: IsaacStationDraft = {
  name: "",
  image: "",
  cpu: "8",
  memoryGi: "32",
  gpuAllocationMode: "whole",
  gpuCount: "1",
  gpuMemoryGi: "",
  mode: "headless-webrtc",
};

function sanitizeDnsNameInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 42);
}

function statusTone(status: IsaacStationRow["status"]) {
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

function statusLabel(status: IsaacStationRow["status"]) {
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

function modeLabel(mode: IsaacStationMode) {
  switch (mode) {
    case "headless-webrtc":
      return "Headless WebRTC";
    case "headless-egl":
      return "Headless EGL";
  }
}

function formatTime(value: Date | string | null | undefined) {
  if (!value) return "未知";

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未知";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function specLabel(station: IsaacStationRow) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: station.gpuAllocationMode,
    gpuCount: station.gpuCount,
    gpuMemoryGi: station.gpuMemoryGi,
  })} · ${station.cpu} CPU · ${station.memory}`;
}

function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", props.className)}>
      <span className="text-[12px] leading-4 font-medium text-slate-700">
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-4 text-slate-500">{props.hint}</span>
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

function LoadingCards() {
  return (
    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[10px] border border-slate-200/85 bg-white/90 p-3"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-[9px]" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusStrip(props: { stations: IsaacStationRow[] }) {
  const running = props.stations.filter(
    (station) => station.status === "running",
  ).length;
  const starting = props.stations.filter(
    (station) => station.status === "starting",
  ).length;
  const streaming = props.stations.filter((station) =>
    Boolean(station.streamingUrl),
  ).length;
  const gpuCount = props.stations.reduce(
    (total, station) => total + station.gpuCount,
    0,
  );

  return (
    <div className="grid gap-2 md:grid-cols-4">
      <StatusItem label="Station" value={String(props.stations.length)} />
      <StatusItem label="运行中" value={String(running)} />
      <StatusItem label="WebRTC" value={`${streaming}/${running}`} />
      <StatusItem label="GPU 申请" value={String(gpuCount)} />
      {starting > 0 ? <span className="sr-only">{starting} 个启动中</span> : null}
    </div>
  );
}

function StatusItem(props: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-[9px] border border-slate-200/90 bg-white/88 px-3 py-2">
      <span className="truncate text-[11px] leading-4 font-medium text-slate-500">
        {props.label}
      </span>
      <span className="shrink-0 text-[15px] leading-none font-semibold text-slate-950">
        {props.value}
      </span>
    </div>
  );
}

function StationCard(props: {
  station: IsaacStationRow;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const { station } = props;

  return (
    <article className="rounded-[10px] border border-slate-200/85 bg-white/94 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-emerald-200/85 bg-emerald-50 text-emerald-700">
            <CpuIcon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm leading-5 font-semibold tracking-normal text-slate-950">
              {station.name}
            </h3>
            <p className="text-xs leading-4 text-slate-500">
              创建于 {formatTime(station.updatedAt)}
            </p>
            <ResourceOwnerBadge
              value={station}
              compact
              className="mt-1 max-w-full"
            />
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-[8px] px-2 py-0.5 text-xs",
            statusTone(station.status),
          )}
        >
          {statusLabel(station.status)}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 border-t border-slate-200/80 pt-3 text-sm leading-5 text-slate-600">
        <div className="min-w-0">
          <SurfaceLabel>运行模式</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {modeLabel(station.mode)}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>资源规格</SurfaceLabel>
          <p className="mt-0.5 truncate font-medium text-slate-950">
            {specLabel(station)}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>节点 / WebRTC</SurfaceLabel>
          <p className="mt-0.5 truncate font-mono text-[12px] text-slate-700">
            {station.nodeName ?? "未分配节点"} ·{" "}
            {station.endpoint ?? "入口待分配"}
          </p>
        </div>
        <div className="min-w-0">
          <SurfaceLabel>镜像</SurfaceLabel>
          <p
            className="mt-0.5 truncate font-mono text-[12px] text-slate-700"
            title={station.image}
          >
            {station.image}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-[9px] border border-slate-200/85 bg-slate-50/75 px-2.5 py-2 text-[12px] leading-5 text-slate-600">
        <div className="flex items-center gap-2">
          <RadioTowerIcon className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 truncate">
            TCP {station.webrtcPort} · /streaming/webrtc-client
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          WebRTC 模式使用 hostNetwork，远程客户端连接节点 IP，不经过
          Xvnc/软件 GL。
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:justify-end">
        {station.streamingUrl ? (
          <a
            href={station.streamingUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-7 rounded-[8px] px-2.5 text-[12px]",
            )}
          >
            <ArrowUpRightIcon data-icon="inline-start" />
            打开 WebRTC
          </a>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-[8px] px-2.5 text-[12px] text-slate-500"
            disabled
          >
            打开 WebRTC
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-[8px] border-rose-200/80 bg-white px-2.5 text-[12px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
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

function IsaacStationDialog(props: {
  open: boolean;
  available: boolean;
  capabilityReason: string | null;
  draft: IsaacStationDraft;
  imageOptions: IsaacStationImageOption[];
  selectedImage: IsaacStationImageOption | null;
  canCreate: boolean;
  submitDisabledReason: string | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (
    updater: (current: IsaacStationDraft) => IsaacStationDraft,
  ) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-slate-200/85 bg-white shadow-[0_28px_68px_rgba(15,23,42,0.14)] sm:max-w-2xl">
        <DialogHeader className="gap-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              Isaac Station
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/90"
            >
              Kubernetes GPU Pod
            </Badge>
          </div>
          <DialogTitle>创建 Isaac Station</DialogTitle>
          <DialogDescription>
            新建一个 Isaac Sim headless 实例，使用 NVIDIA GPU 执行仿真和远程可视化。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="Station 名称">
            <Input
              className={dialogControlClassName}
              value={props.draft.name}
              onChange={(event) =>
                props.onDraftChange((current) => ({
                  ...current,
                  name: sanitizeDnsNameInput(event.target.value),
                }))
              }
              placeholder="例如：office-sim-01"
            />
          </Field>

          <Field
            label="Isaac Sim 镜像"
            hint={props.selectedImage?.description ?? "镜像可通过环境变量配置。"}
          >
            <Select
              value={props.draft.image}
              onValueChange={(value) => {
                if (!value) return;
                props.onDraftChange((current) => ({
                  ...current,
                  image: value,
                }));
              }}
            >
              <SelectTrigger className={dialogControlClassName}>
                <SelectValue placeholder="选择 Isaac Sim 镜像" />
              </SelectTrigger>
              <SelectContent className={selectContentClassName}>
                <SelectGroup>
                  {props.imageOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className={selectItemClassName}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="CPU">
              <Input
                inputMode="decimal"
                className={dialogControlClassName}
                value={props.draft.cpu}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    cpu: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="内存 Gi">
              <Input
                inputMode="numeric"
                className={dialogControlClassName}
                value={props.draft.memoryGi}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    memoryGi: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
            <Field label="模式">
              <Select
                value={props.draft.mode}
                onValueChange={(value) => {
                  if (!value) return;
                  props.onDraftChange((current) => ({
                    ...current,
                    mode: value,
                  }));
                }}
              >
                <SelectTrigger className={dialogControlClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[10px]">
                  <SelectGroup>
                    <SelectItem
                      value="headless-webrtc"
                      className={selectItemClassName}
                    >
                      Headless WebRTC
                    </SelectItem>
                    <SelectItem
                      value="headless-egl"
                      className={selectItemClassName}
                    >
                      Headless EGL
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="GPU 模式">
              <Select
                value={props.draft.gpuAllocationMode}
                onValueChange={(value) => {
                  if (!value) return;
                  props.onDraftChange((current) => ({
                    ...current,
                    gpuAllocationMode: value,
                    gpuCount:
                      value === "memory" && current.gpuCount === "0"
                        ? "1"
                        : current.gpuCount,
                  }));
                }}
              >
                <SelectTrigger className={dialogControlClassName}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[10px]">
                  <SelectGroup>
                    {gpuAllocationModeValues.map((mode) => (
                      <SelectItem
                        key={mode}
                        value={mode}
                        className={selectItemClassName}
                      >
                        {gpuAllocationModeLabels[mode]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="GPU 数量">
              <Input
                inputMode="numeric"
                className={dialogControlClassName}
                value={props.draft.gpuCount}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    gpuCount: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
            <Field
              label="每份显存 Gi"
              hint={
                props.draft.gpuAllocationMode === "memory"
                  ? "显存份额调度依赖 HAMi。"
                  : "整卡模式无需填写。"
              }
            >
              <Input
                inputMode="numeric"
                className={dialogControlClassName}
                value={props.draft.gpuMemoryGi}
                disabled={props.draft.gpuAllocationMode !== "memory"}
                onChange={(event) =>
                  props.onDraftChange((current) => ({
                    ...current,
                    gpuMemoryGi: event.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
          </div>

          <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/80 px-3 py-2.5 text-[12px] leading-5 text-slate-600">
            WebRTC 模式会使用 hostNetwork 暴露 Isaac streaming 端口；EGL
            模式只保留 headless 仿真运行，不提供浏览器画面入口。
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="rounded-[10px]"
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            className="rounded-[10px]"
            disabled={!props.canCreate || props.isPending}
            title={props.submitDisabledReason ?? undefined}
            onClick={props.onSubmit}
          >
            {props.isPending ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {props.isPending ? "创建中" : "创建 Station"}
          </Button>
        </DialogFooter>

        {!props.available && props.capabilityReason ? (
          <p className="text-[12px] leading-5 text-rose-600">
            {props.capabilityReason}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function IsaacStationShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pendingDeletedNames, setPendingDeletedNames] = useState<string[]>([]);
  const [draft, setDraft] = useState<IsaacStationDraft>(defaultDraft);

  const stationQuery = api.isaacStation.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: STATUS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const createStation = api.isaacStation.create.useMutation({
    onSuccess: async () => {
      await utils.isaacStation.list.invalidate();
      setIsCreateOpen(false);
      setDraft((current) => ({
        ...defaultDraft,
        image: current.image,
      }));
    },
    onError: (error) => notifyError(error.message),
  });

  const deleteStation = api.isaacStation.delete.useMutation({
    onMutate: ({ name }) => {
      setPendingDeletedNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: async () => {
      await utils.isaacStation.list.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      notifyError(error.message);
    },
  });

  const imageOptions = useMemo(
    () => stationQuery.data?.imageOptions ?? [],
    [stationQuery.data?.imageOptions],
  );

  useEffect(() => {
    if (draft.image || imageOptions.length === 0) return;
    setDraft((current) => ({
      ...current,
      image: imageOptions[0]?.value ?? "",
    }));
  }, [draft.image, imageOptions]);

  const rows = (stationQuery.data?.items ?? []).filter(
    (station) => !pendingDeletedNames.includes(station.name),
  );
  const capabilityReason =
    stationQuery.data?.reason ?? stationQuery.error?.message ?? null;
  const clusterStatus =
    stationQuery.isLoading && !stationQuery.error
      ? "checking"
      : stationQuery.data?.available === true
        ? "connected"
        : "error";
  const available = clusterStatus === "connected";
  const parsedMemoryGi = Number.parseInt(draft.memoryGi, 10);
  const parsedGpuCount = Number.parseInt(draft.gpuCount, 10);
  const parsedGpuMemoryGi = Number.parseInt(draft.gpuMemoryGi, 10);
  const stationNameValid = draft.name.length >= 2;
  const imageValid = draft.image.trim().length > 0;
  const cpuValid = Number(draft.cpu) > 0;
  const memoryValid = Number.isInteger(parsedMemoryGi) && parsedMemoryGi > 0;
  const gpuCountValid =
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= 1 &&
    parsedGpuCount <= 16;
  const gpuMemoryValid =
    draft.gpuAllocationMode !== "memory" ||
    (Number.isInteger(parsedGpuMemoryGi) &&
      parsedGpuMemoryGi >= 1 &&
      parsedGpuMemoryGi <= 1024);
  const canCreate =
    available &&
    stationNameValid &&
    imageValid &&
    cpuValid &&
    memoryValid &&
    gpuCountValid &&
    gpuMemoryValid;
  const submitDisabledReason = !available
    ? (capabilityReason ?? "K8s 当前不可用")
    : !stationNameValid
      ? "名称至少 2 个字符"
      : !imageValid
        ? "请选择 Isaac Sim 镜像"
        : !cpuValid
          ? "CPU 必须大于 0"
          : !memoryValid
            ? "内存必须是正整数"
            : !gpuCountValid
              ? "Isaac Station 至少需要 1 个 GPU"
              : !gpuMemoryValid
                ? "显存必须是 1-1024 Gi"
                : null;
  const selectedImage =
    imageOptions.find((option) => option.value === draft.image) ?? null;

  useEffect(() => {
    if (!capabilityReason) return;
    notifyError({
      title: "Kubernetes 访问异常",
      message: capabilityReason,
    });
  }, [capabilityReason]);

  useEffect(() => {
    const liveNames = new Set(
      (stationQuery.data?.items ?? []).map((station) => station.name),
    );

    setPendingDeletedNames((current) => {
      const next = current.filter((name) => liveNames.has(name));
      return next.length === current.length ? current : next;
    });
  }, [stationQuery.data?.items]);

  const handleCreate = async () => {
    await createStation.mutateAsync({
      name: draft.name,
      image: draft.image,
      cpu: draft.cpu,
      memoryGi: parsedMemoryGi,
      gpuAllocationMode: draft.gpuAllocationMode,
      gpuCount: parsedGpuCount,
      gpuMemoryGi:
        draft.gpuAllocationMode === "memory" ? parsedGpuMemoryGi : null,
      mode: draft.mode,
    });
  };

  const handleDelete = async (name: string) => {
    const confirmed = await confirm({
      title: `确认删除 Isaac Station ${name}？`,
      description:
        "删除后会释放对应的 Isaac Sim GPU Pod 和 streaming 入口，运行中的仿真会立即停止。",
      confirmLabel: "删除 Station",
    });
    if (!confirmed) return;

    await deleteStation.mutateAsync({ name });
  };

  return (
    <ModulePageShell className="gap-5 xl:gap-6">
      <ModuleHero
        size="compact"
        density="tight"
        eyebrow="Simulation Station"
        title="Isaac Station"
        description="以 Kubernetes GPU Pod 运行 Isaac Sim headless 仿真，并通过 WebRTC 远程查看画面。"
        icon={CpuIcon}
        badges={
          <>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              Isaac Sim
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              Headless
            </Badge>
            <Badge
              variant="outline"
              className="hidden border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] md:inline-flex"
            >
              WebRTC
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "px-2.5 py-0.5 text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
                clusterStatus === "checking"
                  ? "border-sky-200 bg-sky-50/92 text-sky-800"
                  : available
                    ? "border-emerald-200 bg-emerald-50/92 text-emerald-800"
                    : "border-rose-200 bg-rose-50/92 text-rose-800",
              )}
            >
              {clusterStatus === "checking" ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {clusterStatus === "checking"
                ? "K8s 检查中"
                : available
                  ? "K8s 已连接"
                  : "K8s 访问异常"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/78 px-2.5 py-0.5 text-[12px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
            >
              {stationQuery.isFetching && !stationQuery.isLoading ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {stationQuery.isFetching && !stationQuery.isLoading
                ? "状态刷新中"
                : `自动刷新 · ${STATUS_POLL_INTERVAL_MS / 1000}s`}
            </Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-[var(--radius-card)] border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50"
              disabled={stationQuery.isFetching}
              onClick={() => void stationQuery.refetch()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              刷新
            </Button>
            <Button
              className="rounded-[var(--radius-card)]"
              disabled={!available}
              title={
                !available ? (capabilityReason ?? "K8s 当前不可用") : undefined
              }
              onClick={() => setIsCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              创建 Station
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <StatusStrip stations={rows} />
          <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/88 px-3.5 py-3 text-[12px] leading-5 text-slate-600">
            Isaac Station 不复用 KasmVNC 桌面的 DISPLAY=:1。WebRTC Station
            在 GPU 节点上 headless 渲染，客户端连接节点 IP 和 Isaac streaming
            端口。
          </div>
        </div>
      </ModuleHero>

      <ModuleSection
        title="Station 列表"
        description="查看 Isaac Sim 实例、GPU 规格、所在节点和 WebRTC 入口。"
        className="border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]"
        action={
          <Badge
            variant="outline"
            className="border-slate-200/90 bg-white/90 text-slate-600"
          >
            {rows.length} 个实例
          </Badge>
        }
      >
        {stationQuery.isLoading ? (
          <LoadingCards />
        ) : rows.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-950">
                还没有 Isaac Station
              </p>
              <p className="mt-0.5 text-[13px] leading-5 text-slate-500">
                创建一个 headless WebRTC Station 后，就能在 GPU 节点上运行
                Isaac Sim。
              </p>
            </div>
            <Button
              className="w-fit rounded-[10px]"
              disabled={!available}
              onClick={() => setIsCreateOpen(true)}
            >
              <PlusIcon data-icon="inline-start" />
              创建 Station
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {rows.map((station) => (
              <StationCard
                key={station.id}
                station={station}
                isDeleting={
                  pendingDeletedNames.includes(station.name) ||
                  (deleteStation.isPending &&
                    deleteStation.variables?.name === station.name)
                }
                onDelete={() => void handleDelete(station.name)}
              />
            ))}
          </div>
        )}
      </ModuleSection>

      <ModuleSection
        title="连接参数"
        description="WebRTC 客户端需要连接 Isaac 所在节点，而不是当前 Xvnc 云桌面。"
        className="border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/75 px-3 py-2.5">
            <SurfaceLabel>Display</SurfaceLabel>
            <p className="mt-1 font-mono text-[13px] text-slate-900">
              headless / EGL
            </p>
          </div>
        <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/75 px-3 py-2.5">
          <SurfaceLabel>Signaling</SurfaceLabel>
          <p className="mt-1 font-mono text-[13px] text-slate-900">
            TCP 8211
          </p>
        </div>
        <div className="rounded-[10px] border border-slate-200/90 bg-slate-50/75 px-3 py-2.5">
          <SurfaceLabel>Client path</SurfaceLabel>
          <p className="mt-1 font-mono text-[13px] text-slate-900">
            /streaming/webrtc-client
          </p>
        </div>
        </div>
      </ModuleSection>

      <IsaacStationDialog
        open={isCreateOpen}
        available={available}
        capabilityReason={capabilityReason}
        draft={draft}
        imageOptions={imageOptions}
        selectedImage={selectedImage}
        canCreate={canCreate}
        submitDisabledReason={submitDisabledReason}
        isPending={createStation.isPending}
        onOpenChange={setIsCreateOpen}
        onDraftChange={(updater) => setDraft((current) => updater(current))}
        onSubmit={() => void handleCreate()}
      />

      {confirmDialog}
    </ModulePageShell>
  );
}
