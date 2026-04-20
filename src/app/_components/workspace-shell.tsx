"use client";

import {
  ActivityIcon,
  GlobeIcon,
  LoaderCircleIcon,
  MonitorSmartphoneIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

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

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-muted-foreground text-[11px] font-medium tracking-[0.28em] uppercase">
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
          className="border-border/70 bg-background/70 rounded-3xl border p-4"
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
              <Skeleton className="h-9 w-20 rounded-full" />
              <Skeleton className="h-9 w-20 rounded-full" />
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
  const [feedback, setFeedback] = useState<string | null>(null);
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
      setFeedback("远程桌面已提交创建。");
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
    onError: (error) => setFeedback(error.message),
  });

  const deleteWorkspace = api.workspace.delete.useMutation({
    onSuccess: async () => {
      await utils.workspace.list.invalidate();
      setFeedback("远程桌面已删除。");
    },
    onError: (error) => setFeedback(error.message),
  });

  const rows = workspaceQuery.data?.items ?? [];
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
    <ModulePageShell>
      <ProductAreaHeader />

      <ModuleHero
        size="compact"
        eyebrow="Remote Desktop"
        title="远程桌面"
        description="统一管理远程工作区、节点分配、访问入口和启动状态。"
        icon={MonitorSmartphoneIcon}
        badges={
          <>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[12px]",
                available
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700",
              )}
            >
              {available ? "K8s 已连接" : "K8s 不可用"}
            </Badge>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60 rounded-full px-2.5 py-0.5 text-[12px]"
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
            className="h-[30px] rounded-full px-3.5 text-[13px]"
            disabled={!available}
            onClick={() => setIsCreateOpen(true)}
          >
            <PlusIcon data-icon="inline-start" />
            创建远程桌面
          </Button>
        }
      >
        <div className="grid gap-2 md:grid-cols-3">
          <ModuleMetricCard
            size="compact"
            label="工作区总数"
            value={String(rows.length)}
            description="当前纳入远程桌面控制面的全部 workspace。"
            icon={MonitorSmartphoneIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="运行中"
            value={String(runningCount)}
            description="已经拿到访问入口，可以直接登录的工作区。"
            icon={ActivityIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="待就绪"
            value={String(startingCount)}
            description="容器正在拉起或探针尚未完成。"
            icon={GlobeIcon}
          />
        </div>
      </ModuleHero>

      {capabilityReason ? (
        <Alert variant="destructive">
          <AlertTitle>Kubernetes 访问异常</AlertTitle>
          <AlertDescription>{capabilityReason}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert>
          <AlertTitle>执行结果</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="Workspace 列表"
        description="按统一表格查看状态、资源规格、节点地址和访问入口。"
        action={
          <Badge
            variant="outline"
            className="border-border/80 bg-background/60"
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
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>规格</TableHead>
                <TableHead>节点 / 地址</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((workspace) => (
                <TableRow key={workspace.id} className="border-border/70">
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1">
                      <p className="text-foreground font-medium">
                        {workspace.name}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Workspace ID: {workspace.id}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full",
                        statusTone(workspace.status),
                      )}
                    >
                      {statusLabel(workspace.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-foreground align-top font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{specLabel(workspace)}</span>
                      <span className="text-muted-foreground text-sm font-normal">
                        {workspace.resolution}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-1">
                      <span className="text-foreground font-medium">
                        {workspace.nodeName ?? "-"}
                      </span>
                      <span className="text-muted-foreground text-sm break-all">
                        {workspace.endpoint ?? "-"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top">
                    {workspace.updatedAt ?? "-"}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex justify-end gap-2">
                      {workspace.loginUrl ? (
                        <a
                          href={workspace.loginUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            buttonVariants({ variant: "outline" }),
                            "rounded-full",
                          )}
                        >
                          登录
                        </a>
                      ) : (
                        <Button
                          variant="outline"
                          className="rounded-full"
                          disabled
                        >
                          登录
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        className="rounded-full"
                        disabled={deleteWorkspace.isPending}
                        onClick={() => void handleDelete(workspace.name)}
                      >
                        {deleteWorkspace.isPending ? (
                          <LoaderCircleIcon
                            className="animate-spin"
                            data-icon="inline-start"
                          />
                        ) : (
                          <Trash2Icon data-icon="inline-start" />
                        )}
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
                    <SelectTrigger className="w-full min-w-0 bg-white">
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
