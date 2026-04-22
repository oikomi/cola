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
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type WorkspaceRow = RouterOutputs["workspace"]["list"]["items"][number];

const WORKSPACE_STATUS_POLL_INTERVAL_MS = 5000;
const CUSTOM_RESOLUTION_VALUE = "__custom__";
const RESOLUTION_PRESETS = [
  "1366x768x24",
  "1600x900x24",
  "1920x1080x24",
] as const;
const PRIMARY_ACTION_CLASS =
  "border-sky-500 bg-sky-600 text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)] hover:border-sky-500 hover:bg-sky-500";

function WorkspaceMetric({
  label,
  value,
  dotClassName,
}: {
  label: string;
  value: string;
  dotClassName: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white/90 px-4 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium tracking-[0.16em] text-slate-600 uppercase">
            {label}
          </p>
          <p className="mt-1 text-[1.48rem] leading-none font-semibold tracking-[-0.05em] text-slate-950">
            {value}
          </p>
        </div>

        <span className={cn("size-2 rounded-full", dotClassName)} />
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
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "starting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-border bg-muted text-muted-foreground";
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
  return `${workspace.gpu} GPU · ${workspace.cpu} CPU · ${workspace.memory}`;
}

function LoadingRows() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={`workspace-skeleton-${index}`}
          className="border-border/70 bg-background/80 rounded-[var(--radius-card)] border p-4"
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingDeletedWorkspaceNames, setPendingDeletedWorkspaceNames] =
    useState<string[]>([]);
  const [draft, setDraft] = useState({
    name: "",
    cpu: "4",
    memoryGi: "16",
    gpu: "0",
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
        gpu: "0",
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
    const memoryGi = Number.parseInt(draft.memoryGi, 10);
    const gpu = Number.parseInt(draft.gpu, 10);

    await createWorkspace.mutateAsync({
      name: draft.name,
      cpu: draft.cpu,
      memoryGi,
      gpu,
      resolution: draft.resolution,
    });
  };

  const handleDelete = async (name: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确认删除远程桌面 ${name}？`);
      if (!confirmed) return;
    }

    await deleteWorkspace.mutateAsync({ name });
  };

  return (
    <ModulePageShell className="gap-4">
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
              className="border-slate-200/90 bg-white/86 px-2.5 py-0.5 text-[12px] text-slate-700"
            >
              Remote Desktop
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/86 px-2.5 py-0.5 text-[12px] text-slate-700"
            >
              Kubernetes
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/86 px-2.5 py-0.5 text-[12px] text-slate-700"
            >
              Master Node
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-200/90 bg-white/86 px-2.5 py-0.5 text-[12px] text-slate-700"
            >
              XDream Cloud
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "px-2.5 py-0.5 text-[12px]",
                available
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700",
              )}
            >
              {available ? "K8s 已连接" : "K8s 不可用"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/70 px-2.5 py-0.5 text-[12px] text-slate-600"
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
            dotClassName="bg-sky-500"
          />
          <WorkspaceMetric
            label="运行中"
            value={String(runningCount)}
            dotClassName="bg-emerald-500"
          />
          <WorkspaceMetric
            label="待就绪"
            value={String(startingCount)}
            dotClassName="bg-amber-500"
          />
        </div>
      </ModuleHero>

      {capabilityReason ? (
        <Alert variant="destructive">
          <AlertTitle>Kubernetes 访问异常</AlertTitle>
          <AlertDescription>{capabilityReason}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="Workspace 列表"
        description="按统一表格查看状态、资源规格、节点地址和访问入口。"
        action={
          <Badge
            variant="outline"
            className="border-slate-200/90 bg-slate-50 text-slate-700"
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
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-200/90 bg-white/92">
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
                    className="group border-border/70 hover:bg-sky-50/50"
                  >
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex flex-col gap-1">
                        <p className="text-foreground font-semibold">
                          {workspace.name}
                        </p>
                        <p className="text-sm text-slate-500">
                          Workspace ID: {workspace.id}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 text-center align-middle">
                      <Badge
                        variant="outline"
                        className={cn(
                          "justify-center px-2.5",
                          statusTone(workspace.status),
                        )}
                      >
                        {statusLabel(workspace.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex flex-col gap-1 text-slate-950">
                        <span className="font-medium">
                          {specLabel(workspace)}
                        </span>
                        <span className="text-sm font-normal text-slate-500">
                          {workspace.resolution}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-950">
                          {workspace.nodeName ?? "-"}
                        </span>
                        <span className="font-mono text-[13px] break-all text-slate-500">
                          {workspace.endpoint ?? "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-4 align-middle text-sm text-slate-500">
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
                              "border-sky-500 bg-sky-600 text-white shadow-[0_10px_22px_rgba(37,99,235,0.18)] hover:bg-sky-500",
                            )}
                          >
                            登录
                          </a>
                        ) : (
                          <Button variant="outline" size="sm" disabled>
                            登录
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
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
        <DialogContent className="border-border/70 bg-background/95 backdrop-blur-xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>创建远程桌面</DialogTitle>
            <DialogDescription>
              指定 CPU、Memory、GPU 和分辨率后，系统会在 Kubernetes
              中创建新的远程工作区。
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

            <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,0.8fr)_minmax(0,1.35fr)] md:items-start">
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

              <FormField label="GPU">
                <Input
                  inputMode="numeric"
                  value={draft.gpu}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      gpu: event.target.value,
                    }))
                  }
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
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              className={PRIMARY_ACTION_CLASS}
              disabled={
                createWorkspace.isPending || !available || draft.name.length < 2
              }
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
    </ModulePageShell>
  );
}
