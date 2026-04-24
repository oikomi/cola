"use client";

import {
  LoaderCircleIcon,
  MonitorSmartphoneIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatGpuAllocationLabel,
  gpuAllocationModeLabels,
  gpuAllocationModeValues,
} from "@/lib/gpu-allocation";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type WorkspaceRow = RouterOutputs["workspace"]["list"]["items"][number];
type WorkspaceDraft = {
  name: string;
  cpu: string;
  memoryGi: string;
  gpuAllocationMode: (typeof gpuAllocationModeValues)[number];
  gpuCount: string;
  gpuMemoryGi: string;
  resolution: string;
  resolutionPreset: string;
};

const WORKSPACE_STATUS_POLL_INTERVAL_MS = 5000;
const CUSTOM_RESOLUTION_VALUE = "__custom__";
const RESOLUTION_PRESETS = [
  "1366x768x24",
  "1600x900x24",
  "1920x1080x24",
] as const;
const PRIMARY_ACTION_CLASS =
  "rounded-full border border-[#7cc0ff]/80 bg-[linear-gradient(135deg,#2f73ff_0%,#63a8ff_100%)] text-white shadow-[0_22px_38px_rgba(47,115,255,0.22),0_10px_18px_rgba(55,107,171,0.16),inset_0_1px_0_rgba(255,255,255,0.24)] hover:border-[#92d0ff] hover:brightness-[1.03]";
const SECONDARY_ACTION_CLASS =
  "rounded-full border border-[#d8e4f6] bg-white/92 text-[#21406f] shadow-[0_12px_24px_rgba(15,23,42,0.06)] hover:border-[#bfd7fb] hover:bg-[#f8fbff]";
const ALERT_SURFACE_CLASS =
  "rounded-[22px] border px-4 py-3 shadow-[0_18px_32px_rgba(15,23,42,0.05)]";

const METRIC_TONE_STYLES = {
  sky: {
    container:
      "border-sky-200/80 bg-[linear-gradient(180deg,rgba(247,251,255,0.96),rgba(255,255,255,0.92))] shadow-[0_12px_24px_rgba(59,130,246,0.07),0_3px_10px_rgba(15,23,42,0.03)]",
    glow: "bg-sky-100/90 shadow-[0_0_0_6px_rgba(219,234,254,0.52)]",
    dot: "bg-sky-500",
  },
  emerald: {
    container:
      "border-emerald-200/85 bg-[linear-gradient(180deg,rgba(237,252,245,0.96),rgba(255,255,255,0.92))] shadow-[0_12px_24px_rgba(16,185,129,0.08),0_3px_10px_rgba(15,23,42,0.03)]",
    glow: "bg-emerald-100/90 shadow-[0_0_0_6px_rgba(209,250,229,0.54)]",
    dot: "bg-emerald-500",
  },
  amber: {
    container:
      "border-amber-200/85 bg-[linear-gradient(180deg,rgba(255,249,235,0.96),rgba(255,255,255,0.92))] shadow-[0_12px_24px_rgba(245,158,11,0.09),0_3px_10px_rgba(15,23,42,0.03)]",
    glow: "bg-amber-100/90 shadow-[0_0_0_6px_rgba(254,243,199,0.58)]",
    dot: "bg-amber-500",
  },
} as const;

type WorkspaceMetricTone = keyof typeof METRIC_TONE_STYLES;

function WorkspaceMetric({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone: WorkspaceMetricTone;
}) {
  const styles = METRIC_TONE_STYLES[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[20px] px-4 py-3.5",
        styles.container,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/75" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-[0.2em] text-slate-600 uppercase">
            {label}
          </p>
          <p className="mt-1.5 text-[1.85rem] leading-none font-semibold tracking-[-0.07em] text-slate-950">
            {value}
          </p>
          <p className="mt-2 text-[12px] leading-[1.2rem] text-slate-600">
            {caption}
          </p>
        </div>

        <span
          className={cn(
            "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full",
            styles.glow,
          )}
        >
          <span className={cn("size-1.5 rounded-full", styles.dot)} />
        </span>
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-medium tracking-[0.28em] text-slate-600 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function statusTone(status: WorkspaceRow["status"]) {
  switch (status) {
    case "running":
      return "border-emerald-300/80 bg-emerald-50/90 text-emerald-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]";
    case "starting":
      return "border-amber-300/80 bg-amber-50/90 text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]";
    case "error":
      return "border-rose-300/80 bg-rose-50/90 text-rose-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]";
    default:
      return "border-slate-200/80 bg-slate-100/90 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]";
  }
}

function statusDotTone(status: WorkspaceRow["status"]) {
  switch (status) {
    case "running":
      return "bg-emerald-500";
    case "starting":
      return "bg-amber-500";
    case "error":
      return "bg-rose-500";
    default:
      return "bg-slate-400";
  }
}

function statusLabel(status: WorkspaceRow["status"]) {
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

function specLabel(workspace: WorkspaceRow) {
  return `${formatGpuAllocationLabel({
    gpuAllocationMode: workspace.gpuAllocationMode,
    gpuCount: workspace.gpuCount,
    gpuMemoryGi: workspace.gpuMemoryGi,
  })} · ${workspace.cpu} CPU · ${workspace.memory}`;
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`workspace-skeleton-${index}`}
          className="rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.9))] p-5 shadow-[0_18px_34px_rgba(15,23,42,0.045)]"
        >
          <div className="grid gap-3 md:grid-cols-[1.2fr_120px_180px_1fr_140px_220px] md:items-center">
            <div className="grid gap-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-5 w-36" />
            <div className="grid gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-5 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20 rounded-[var(--radius-control)]" />
              <Skeleton className="h-8 w-8 rounded-[var(--radius-control)]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingDeletedWorkspaceNames, setPendingDeletedWorkspaceNames] =
    useState<string[]>([]);
  const [draft, setDraft] = useState<WorkspaceDraft>({
    name: "",
    cpu: "4",
    memoryGi: "16",
    gpuAllocationMode: "whole",
    gpuCount: "0",
    gpuMemoryGi: "",
    resolution: "1600x900x24",
    resolutionPreset: "1600x900x24",
  });

  const workspaceQuery = api.workspace.list.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: WORKSPACE_STATUS_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const createWorkspace = api.workspace.create.useMutation({
    onSuccess: async () => {
      await utils.workspace.list.invalidate();
      setErrorMessage(null);
      setIsCreateOpen(false);
      setDraft({
        name: "",
        cpu: "4",
        memoryGi: "16",
        gpuAllocationMode: "whole",
        gpuCount: "0",
        gpuMemoryGi: "",
        resolution: "1600x900x24",
        resolutionPreset: "1600x900x24",
      });
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const deleteWorkspace = api.workspace.delete.useMutation({
    onMutate: ({ name }) => {
      setErrorMessage(null);
      setPendingDeletedWorkspaceNames((current) =>
        current.includes(name) ? current : [...current, name],
      );
    },
    onSuccess: async () => {
      await utils.workspace.list.invalidate();
    },
    onError: (error, variables) => {
      setPendingDeletedWorkspaceNames((current) =>
        current.filter((name) => name !== variables.name),
      );
      setErrorMessage(error.message);
    },
  });

  const rows = (workspaceQuery.data?.items ?? []).filter(
    (workspace) => !pendingDeletedWorkspaceNames.includes(workspace.name),
  );
  const capabilityReason = workspaceQuery.data?.reason ?? null;
  const available = workspaceQuery.data?.available ?? true;
  const runningCount = rows.filter(
    (workspace) => workspace.status === "running",
  ).length;
  const startingCount = rows.filter(
    (workspace) => workspace.status === "starting",
  ).length;
  const readyCount = rows.filter((workspace) =>
    Boolean(workspace.loginUrl),
  ).length;
  const parsedMemoryGi = Number.parseInt(draft.memoryGi, 10);
  const parsedGpuCount = Number.parseInt(draft.gpuCount, 10);
  const parsedGpuMemoryGi = Number.parseInt(draft.gpuMemoryGi, 10);
  const gpuCountMin = draft.gpuAllocationMode === "memory" ? 1 : 0;
  const gpuCountValid =
    Number.isInteger(parsedGpuCount) &&
    parsedGpuCount >= gpuCountMin &&
    parsedGpuCount <= 16;
  const gpuMemoryValid =
    draft.gpuAllocationMode !== "memory" ||
    (Number.isInteger(parsedGpuMemoryGi) &&
      parsedGpuMemoryGi >= 1 &&
      parsedGpuMemoryGi <= 1024);
  const canSubmit =
    available &&
    draft.name.length >= 2 &&
    Number.isInteger(parsedMemoryGi) &&
    parsedMemoryGi > 0 &&
    gpuCountValid &&
    gpuMemoryValid;

  useEffect(() => {
    const liveNames = new Set(
      (workspaceQuery.data?.items ?? []).map((workspace) => workspace.name),
    );

    setPendingDeletedWorkspaceNames((current) => {
      const next = current.filter((name) => liveNames.has(name));
      return next.length === current.length ? current : next;
    });
  }, [workspaceQuery.data?.items]);

  const handleCreate = async () => {
    await createWorkspace.mutateAsync({
      name: draft.name,
      cpu: draft.cpu,
      memoryGi: parsedMemoryGi,
      gpuAllocationMode: draft.gpuAllocationMode,
      gpuCount: parsedGpuCount,
      gpuMemoryGi:
        draft.gpuAllocationMode === "memory" ? parsedGpuMemoryGi : null,
      resolution: draft.resolution,
    });
  };

  const handleDelete = async (name: string) => {
    const confirmed = await confirm({
      title: `确认删除远程桌面 ${name}？`,
      description: "删除后会释放对应的 workspace 资源和访问入口，且不能自动恢复。",
      confirmLabel: "删除桌面",
    });
    if (!confirmed) return;

    await deleteWorkspace.mutateAsync({ name });
  };

  return (
    <ModulePageShell className="gap-5 xl:gap-6">
      <ModuleHero
        size="compact"
        density="dense"
        eyebrow="Workspace Control"
        title="远程工作区"
        description="集中管理 remote workspace、浏览器桌面、入口地址与节点资源。"
        icon={MonitorSmartphoneIcon}
        badges={
          <>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              Remote Desktop
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
            >
              Kubernetes
            </Badge>
            <Badge
              variant="outline"
              className="hidden border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] md:inline-flex"
            >
              Master Node
            </Badge>
            <Badge
              variant="outline"
              className="hidden border-slate-200/90 bg-white/84 px-2.5 py-0.5 text-[12px] text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] xl:inline-flex"
            >
              XDream Cloud
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "px-2.5 py-0.5 text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]",
                available
                  ? "border-emerald-200 bg-emerald-50/92 text-emerald-800"
                  : "border-rose-200 bg-rose-50/92 text-rose-800",
              )}
            >
              {available ? "K8s 已连接" : "K8s 不可用"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/78 px-2.5 py-0.5 text-[12px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
            >
              {workspaceQuery.isFetching && !workspaceQuery.isLoading ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {workspaceQuery.isFetching && !workspaceQuery.isLoading
                ? "状态刷新中"
                : `自动刷新 · ${WORKSPACE_STATUS_POLL_INTERVAL_MS / 1000}s`}
            </Badge>
          </>
        }
        actions={
          <Button
            className={PRIMARY_ACTION_CLASS}
            disabled={!available}
            onClick={() => setIsCreateOpen(true)}
          >
            <PlusIcon data-icon="inline-start" />
            创建远程桌面
          </Button>
        }
      >
        <div className="grid gap-2.5 md:grid-cols-3">
          <WorkspaceMetric
            label="工作区总数"
            value={String(rows.length)}
            caption="当前已登记的远程桌面数量。"
            tone="sky"
          />
          <WorkspaceMetric
            label="运行中"
            value={String(runningCount)}
            caption={`可直接登录 ${readyCount} 个，优先关注已就绪入口。`}
            tone="emerald"
          />
          <WorkspaceMetric
            label="待就绪"
            value={String(startingCount)}
            caption="仍在等待容器、节点或地址分配。"
            tone="amber"
          />
        </div>
      </ModuleHero>

      {capabilityReason ? (
        <Alert
          variant="destructive"
          className={cn(
            ALERT_SURFACE_CLASS,
            "border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,247,247,0.94),rgba(255,255,255,0.9))]",
          )}
        >
          <AlertTitle>Kubernetes 访问异常</AlertTitle>
          <AlertDescription>{capabilityReason}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert
          variant="destructive"
          className={cn(
            ALERT_SURFACE_CLASS,
            "border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,247,247,0.94),rgba(255,255,255,0.9))]",
          )}
        >
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="Workspace 列表"
        description="按统一表格查看状态、资源规格、节点地址和访问入口。"
        className="border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))] shadow-[0_24px_56px_rgba(15,23,42,0.05),0_6px_16px_rgba(15,23,42,0.03)]"
        action={
          <Badge
            variant="outline"
            className="rounded-full border-slate-200/90 bg-slate-50/92 px-3 py-1 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]"
          >
            登录就绪 {readyCount}
          </Badge>
        }
      >
        {workspaceQuery.isLoading ? <LoadingRows /> : null}

        {!workspaceQuery.isLoading && rows.length === 0 ? (
          <ModuleEmptyState
            title="还没有远程桌面"
            description="先创建一个 workspace，再在这里统一查看状态、登录入口和节点落点。"
            action={
              <Button
                className={PRIMARY_ACTION_CLASS}
                disabled={!available}
                onClick={() => setIsCreateOpen(true)}
              >
                <PlusIcon data-icon="inline-start" />
                创建第一个远程桌面
              </Button>
            }
          />
        ) : null}

        {!workspaceQuery.isLoading && rows.length > 0 ? (
          <div className="overflow-hidden rounded-[24px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.9))] shadow-[0_18px_38px_rgba(15,23,42,0.05)]">
            <Table>
              <TableHeader className="bg-slate-50/90">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-12 px-4 text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    名称
                  </TableHead>
                  <TableHead className="h-12 px-4 text-center text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    状态
                  </TableHead>
                  <TableHead className="h-12 px-4 text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    规格
                  </TableHead>
                  <TableHead className="h-12 px-4 text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    节点 / 地址
                  </TableHead>
                  <TableHead className="h-12 px-4 text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    更新时间
                  </TableHead>
                  <TableHead className="h-12 px-4 text-right text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                    操作
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((workspace) => (
                  <TableRow
                    key={workspace.id}
                    className="group border-border/70 hover:bg-sky-50/55"
                  >
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-slate-200/85 bg-white/94 text-slate-600 shadow-[0_10px_18px_rgba(15,23,42,0.04)]">
                          <MonitorSmartphoneIcon className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-slate-950">
                            {workspace.name}
                          </p>
                          <p className="mt-1 text-[12px] leading-5 text-slate-500">
                            Workspace ID: {workspace.id}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-center align-middle">
                      <Badge
                        variant="outline"
                        className={cn(
                          "justify-center gap-2 rounded-full px-3 py-1 text-[12px] font-semibold",
                          statusTone(workspace.status),
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            statusDotTone(workspace.status),
                          )}
                        />
                        {statusLabel(workspace.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex flex-col gap-1">
                        <span className="text-[14px] font-medium leading-5 text-slate-950">
                          {specLabel(workspace)}
                        </span>
                        <span className="text-[12px] leading-5 font-normal text-slate-500">
                          {workspace.resolution}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex flex-col gap-2">
                        <span className="inline-flex w-fit rounded-full border border-slate-200/85 bg-slate-50/92 px-2.5 py-1 text-[12px] font-medium leading-none text-slate-700">
                          {workspace.nodeName ?? "未分配节点"}
                        </span>
                        <span className="font-mono text-[12px] leading-5 break-all text-slate-500">
                          {workspace.endpoint ?? "入口地址待分配"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle text-[13px] leading-5 text-slate-600">
                      {workspace.updatedAt ?? "-"}
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        {workspace.loginUrl ? (
                          <a
                            href={workspace.loginUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              buttonVariants({ size: "sm" }),
                              PRIMARY_ACTION_CLASS,
                              "h-9 px-4 text-[12px]",
                            )}
                          >
                            登录
                          </a>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                              SECONDARY_ACTION_CLASS,
                              "h-9 px-4 text-[12px] text-slate-500",
                            )}
                            disabled
                          >
                            登录
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="rounded-full border border-rose-200/80 bg-rose-50/75 text-rose-600 shadow-[0_10px_18px_rgba(244,63,94,0.08)] hover:bg-rose-50 hover:text-rose-700"
                          disabled={deleteWorkspace.isPending}
                          onClick={() => void handleDelete(workspace.name)}
                          title={`删除远程桌面 ${workspace.name}`}
                        >
                          {deleteWorkspace.isPending ? (
                            <LoaderCircleIcon className="animate-spin" />
                          ) : (
                            <Trash2Icon />
                          )}
                          <span className="sr-only">
                            删除远程桌面 {workspace.name}
                          </span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </ModuleSection>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="border-slate-200/80 bg-white/90 shadow-[0_28px_68px_rgba(15,23,42,0.14)] backdrop-blur-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>创建远程桌面</DialogTitle>
            <DialogDescription>
              指定 CPU、Memory、整卡或显存份额和分辨率后，系统会在
              Kubernetes 中创建新的远程工作区。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <FormField label="名称">
              <Input
                placeholder="例如：alice 或 ml-batch-01"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value.trim().toLowerCase(),
                  }))
                }
              />
            </FormField>

            <div className="grid gap-4 md:grid-cols-2 md:items-start">
              <FormField label="CPU">
                <Input
                  inputMode="decimal"
                  value={draft.cpu}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cpu: event.target.value,
                    }))
                  }
                />
              </FormField>

              <FormField label="Memory Gi">
                <Input
                  inputMode="numeric"
                  value={draft.memoryGi}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      memoryGi: event.target.value,
                    }))
                  }
                />
              </FormField>

              <FormField label="GPU 分配方式">
                <Select
                  value={draft.gpuAllocationMode}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      gpuAllocationMode: value === "memory" ? "memory" : "whole",
                      gpuCount:
                        value === "memory" && Number.parseInt(current.gpuCount, 10) < 1
                          ? "1"
                          : current.gpuCount,
                      gpuMemoryGi:
                        value === "memory" ? current.gpuMemoryGi || "8" : "",
                    }))
                  }
                >
                  <SelectTrigger className="w-full min-w-0 bg-white/80">
                    <SelectValue placeholder="选择分配方式" />
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
              </FormField>

              <FormField
                label={
                  draft.gpuAllocationMode === "memory" ? "GPU 份额" : "GPU"
                }
              >
                <Input
                  inputMode="numeric"
                  value={draft.gpuCount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuCount: event.target.value,
                    }))
                  }
                />
              </FormField>

              <FormField label="每份额显存 Gi">
                <Input
                  inputMode="numeric"
                  value={draft.gpuMemoryGi}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpuMemoryGi: event.target.value,
                    }))
                  }
                  disabled={draft.gpuAllocationMode !== "memory"}
                />
              </FormField>

              <FormField label="分辨率">
                <div className="grid gap-2">
                  <Select
                    value={draft.resolutionPreset}
                    onValueChange={(value) => {
                      if (!value) return;

                      setDraft((current) => ({
                        ...current,
                        resolutionPreset: value,
                        resolution:
                          value === CUSTOM_RESOLUTION_VALUE
                            ? current.resolution
                            : value,
                      }));
                    }}
                  >
                    <SelectTrigger className="w-full min-w-0 bg-white/80">
                      <SelectValue placeholder="选择分辨率" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {RESOLUTION_PRESETS.map((resolution) => (
                          <SelectItem key={resolution} value={resolution}>
                            {resolution}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_RESOLUTION_VALUE}>
                          自定义
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  {draft.resolutionPreset === CUSTOM_RESOLUTION_VALUE ? (
                    <Input
                      placeholder="例如：1728x1117x24"
                      value={draft.resolution}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          resolution: event.target.value,
                        }))
                      }
                    />
                  ) : null}
                </div>
              </FormField>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className={SECONDARY_ACTION_CLASS}
              onClick={() => setIsCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              className={PRIMARY_ACTION_CLASS}
              disabled={createWorkspace.isPending || !canSubmit}
              onClick={() => void handleCreate()}
            >
              {createWorkspace.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              创建远程桌面
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </ModulePageShell>
  );
}
