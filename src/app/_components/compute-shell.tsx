"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  BoxesIcon,
  GaugeIcon,
  GpuIcon,
  HardDriveIcon,
  RefreshCwIcon,
  ServerIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  ComputeOwner,
  ComputeSnapshot,
  ComputeSourceState,
  ComputeWorkloadKind,
  ComputeWorkloadSnapshot,
  ComputeWorkloadStatus,
} from "@/server/compute/model";
import { api } from "@/trpc/react";

type Props = {
  snapshot: ComputeSnapshot;
};

type WorkloadFilter = "all" | "running" | "attention" | "unassigned";

const workloadFilterLabels: Record<WorkloadFilter, string> = {
  all: "全部工作负载",
  running: "仅运行中",
  attention: "需要关注",
  unassigned: "归属未识别",
};

const sourceLabels = {
  hami: "HAMi",
  kubernetes: "Kubernetes",
  metrics: "Prometheus",
  database: "用户目录",
} satisfies Record<keyof ComputeSnapshot["sources"], string>;

const sourceStateLabels: Record<ComputeSourceState, string> = {
  live: "实时",
  partial: "部分可用",
  unavailable: "不可用",
};

const workloadKindLabels: Record<ComputeWorkloadKind, string> = {
  workspace: "云桌面",
  training: "训练任务",
  inference: "推理服务",
  isaac: "Isaac",
  notebook: "Notebook",
  agent: "Agent",
  other: "其他",
};

const workloadStatusLabels: Record<ComputeWorkloadStatus, string> = {
  running: "运行中",
  pending: "等待中",
  failed: "异常",
  completed: "已完成",
  unknown: "未知",
};

function isWorkloadFilter(value: string): value is WorkloadFilter {
  return value in workloadFilterLabels;
}

function statusVariant(status: ComputeSourceState) {
  if (status === "unavailable") return "destructive" as const;
  if (status === "partial") return "secondary" as const;
  return "default" as const;
}

function workloadStatusVariant(status: ComputeWorkloadStatus) {
  if (status === "failed") return "destructive" as const;
  if (status === "pending" || status === "unknown") return "secondary" as const;
  return status === "running" ? ("default" as const) : ("outline" as const);
}

function formatPercent(value: number | null) {
  return value === null ? "暂无" : `${value.toFixed(1)}%`;
}

function formatCpu(value: number | null) {
  if (value === null) return "暂无";
  if (value < 0.01) return `${Math.round(value * 1000)}m`;
  return `${value.toFixed(value < 10 ? 2 : 1)} Core`;
}

function formatBytes(value: number | null) {
  if (value === null) return "暂无";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = Math.max(0, value);
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex >= 3 ? 2 : 1)} ${units[unitIndex]}`;
}

function formatGpuMemory(memoryMi: number) {
  if (memoryMi >= 1024) return `${(memoryMi / 1024).toFixed(1)} GiB`;
  return `${Math.round(memoryMi)} MiB`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function ownerInitials(owner: ComputeOwner | null) {
  if (!owner) return "?";
  const label = owner.displayName.trim();
  if (!label) return "?";
  return Array.from(label).slice(0, 2).join("").toUpperCase();
}

function shortDeviceId(deviceId: string) {
  if (deviceId.length <= 18) return deviceId;
  return `${deviceId.slice(0, 8)}...${deviceId.slice(-6)}`;
}

function loadBarTone(value: number | null) {
  if (value === null) return "bg-muted-foreground/30";
  if (value >= 90) return "bg-destructive";
  if (value >= 70) return "bg-chart-4";
  return "bg-chart-2";
}

function MetricBar({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail: string;
}) {
  const normalized = value === null ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div className="flex min-w-0 flex-col gap-2 py-2.5">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground truncate text-[13px] font-medium">
            {label}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {detail}
          </p>
        </div>
        <span className="text-foreground shrink-0 font-mono text-sm font-semibold">
          {formatPercent(value)}
        </span>
      </div>
      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            loadBarTone(value),
          )}
          style={{ width: `${normalized}%` }}
        />
      </div>
    </div>
  );
}

function OwnerIdentity({ owner }: { owner: ComputeOwner | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar size="sm">
        {owner?.avatarUrl ? (
          <AvatarImage src={owner.avatarUrl} alt={owner.displayName} />
        ) : null}
        <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-foreground truncate text-[13px] font-medium">
          {owner?.displayName ?? "未标记使用者"}
        </p>
        <p className="text-muted-foreground truncate text-[11px]">
          {owner?.email ?? "Pod 未写入有效用户归属"}
        </p>
      </div>
    </div>
  );
}

function workloadNeedsAttention(workload: ComputeWorkloadSnapshot) {
  return (
    workload.status === "failed" ||
    workload.status === "pending" ||
    (workload.gpuUtilizationPercent ?? 0) >= 90 ||
    (workload.gpuMemoryUtilizationPercent ?? 0) >= 90 ||
    (workload.cpuUtilizationPercent ?? 0) >= 90 ||
    (workload.memoryUtilizationPercent ?? 0) >= 90 ||
    (workload.restartCount ?? 0) > 0
  );
}

function workloadMatchesFilter(
  workload: ComputeWorkloadSnapshot,
  filter: WorkloadFilter,
) {
  if (filter === "running") return workload.status === "running";
  if (filter === "attention") return workloadNeedsAttention(workload);
  if (filter === "unassigned") return !workload.ownerUserId;
  return true;
}

function WorkloadGpuLoad({ workload }: { workload: ComputeWorkloadSnapshot }) {
  return (
    <div className="flex min-w-[150px] flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">实际负载</span>
        <span className="text-foreground font-mono font-medium">
          {formatPercent(workload.gpuUtilizationPercent)}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full",
            loadBarTone(workload.gpuUtilizationPercent),
          )}
          style={{
            width: `${Math.min(100, workload.gpuUtilizationPercent ?? 0)}%`,
          }}
        />
      </div>
      <p className="text-muted-foreground text-[11px]">
        分配 {workload.allocatedGpuCoresPercent}% Core /{" "}
        {formatGpuMemory(workload.allocatedGpuMemoryMi)}
      </p>
    </div>
  );
}

function WorkloadResourceLoad({
  value,
  percent,
  secondary,
}: {
  value: string;
  percent: number | null;
  secondary: string;
}) {
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-foreground font-mono text-[13px] font-medium">
          {value}
        </span>
        {percent !== null ? (
          <span className="text-muted-foreground font-mono text-[11px]">
            {percent.toFixed(0)}%
          </span>
        ) : null}
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", loadBarTone(percent))}
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </div>
      <p className="text-muted-foreground truncate text-[11px]">{secondary}</p>
    </div>
  );
}

export function ComputeShell({ snapshot }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<WorkloadFilter>("all");
  const snapshotQuery = api.compute.getSnapshot.useQuery(undefined, {
    initialData: snapshot,
    refetchInterval: 15_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const liveSnapshot = snapshotQuery.data ?? snapshot;
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const workloads = useMemo(
    () =>
      liveSnapshot.workloads.filter((workload) => {
        if (!workloadMatchesFilter(workload, filter)) return false;
        if (!normalizedSearch) return true;
        return [
          workload.displayName,
          workload.podName,
          workload.containerName,
          workload.namespace,
          workload.nodeName,
          workload.owner?.displayName,
          workload.owner?.email,
          ...workload.gpuModels,
        ].some((value) =>
          value?.toLocaleLowerCase("zh-CN").includes(normalizedSearch),
        );
      }),
    [filter, liveSnapshot.workloads, normalizedSearch],
  );
  const summary = liveSnapshot.summary;
  const gpuAllocationDetail =
    summary.gpuCardsTotal > 0
      ? `${summary.gpuCardsAllocated} 张有任务 / ${summary.gpuCardsTotal} 张物理卡`
      : "等待 HAMi 返回物理卡信息";
  const workloadDetail = `${summary.activeOwnerCount} 位已识别使用者`;

  return (
    <ModulePageShell className="gap-4">
      <ModuleHero
        eyebrow="GPU Operations"
        title="算力使用情况分析"
        description="统一查看当前 GPU 分配与实际负载，并追踪每位使用者正在运行的容器、节点和资源消耗。"
        icon={GaugeIcon}
        size="compact"
        density="tight"
        badges={
          <>
            <Badge variant={statusVariant(liveSnapshot.status)}>
              {sourceStateLabels[liveSnapshot.status]}
            </Badge>
            <Badge variant="outline">{liveSnapshot.cluster.name}</Badge>
            <Badge variant="outline">
              {liveSnapshot.cluster.gpuNodeCount} 个 GPU 节点
            </Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            disabled={snapshotQuery.isFetching}
            onClick={() => void snapshotQuery.refetch()}
          >
            <RefreshCwIcon
              data-icon="inline-start"
              className={cn(snapshotQuery.isFetching && "animate-spin")}
            />
            {snapshotQuery.isFetching ? "刷新中" : "刷新数据"}
          </Button>
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <ModuleMetricCard
            size="compact"
            label="GPU 卡"
            value={`${summary.gpuCardsAllocated}/${summary.gpuCardsTotal}`}
            description={gpuAllocationDetail}
            icon={GpuIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="GPU 实际负载"
            value={formatPercent(summary.gpuUtilizationPercent)}
            description={`算力分配率 ${formatPercent(summary.computeAllocationPercent)}`}
            icon={ActivityIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="显存实际负载"
            value={formatPercent(summary.gpuMemoryUtilizationPercent)}
            description={`显存分配率 ${formatPercent(summary.memoryAllocationPercent)}`}
            icon={HardDriveIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="GPU 工作负载"
            value={`${summary.workloadCount}`}
            description={workloadDetail}
            icon={BoxesIcon}
          />
        </div>
      </ModuleHero>

      {liveSnapshot.warnings.length > 0 ? (
        <Alert
          variant={
            liveSnapshot.status === "unavailable" ? "destructive" : "default"
          }
        >
          <AlertTriangleIcon />
          <AlertTitle>当前数据处于降级状态</AlertTitle>
          <AlertDescription>{liveSnapshot.warnings.join(" ")}</AlertDescription>
        </Alert>
      ) : null}

      <ModuleSection
        title="资源总览"
        description={`最近快照 ${formatTime(liveSnapshot.generatedAt)}，每 15 秒自动更新。`}
        density="compact"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(liveSnapshot.sources).map(([source, state]) => (
              <Badge
                key={source}
                variant={statusVariant(state)}
                className="font-normal"
              >
                {sourceLabels[source as keyof ComputeSnapshot["sources"]]}{" "}
                {sourceStateLabels[state]}
              </Badge>
            ))}
          </div>
        }
      >
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.85fr)]">
          <div className="min-w-0">
            <div className="border-border flex items-center justify-between gap-3 border-b pb-3">
              <div>
                <h3 className="text-foreground text-sm font-semibold">
                  分配与实际利用率
                </h3>
                <p className="text-muted-foreground mt-1 text-xs">
                  分配率反映调度占用，实际负载来自 Prometheus 遥测。
                </p>
              </div>
              <Badge variant="outline">
                {summary.vgpuSlotsUsed}/{summary.vgpuSlotsTotal} vGPU 槽位
              </Badge>
            </div>
            <div className="grid gap-x-6 md:grid-cols-2">
              <MetricBar
                label="GPU 算力分配"
                value={summary.computeAllocationPercent}
                detail={`${summary.gpuCardsAllocated} 张卡承载任务`}
              />
              <MetricBar
                label="GPU 实际负载"
                value={summary.gpuUtilizationPercent}
                detail="各 GPU 节点实时利用率加权"
              />
              <MetricBar
                label="显存分配"
                value={summary.memoryAllocationPercent}
                detail="容器申请显存 / 集群显存总量"
              />
              <MetricBar
                label="显存实际负载"
                value={summary.gpuMemoryUtilizationPercent}
                detail="当前 GPU 显存真实使用比例"
              />
            </div>
            <div className="border-border mt-2 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">容器 CPU</p>
                <p className="text-foreground mt-1 font-mono text-sm font-semibold">
                  {formatCpu(summary.cpuUsageCores)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">容器内存</p>
                <p className="text-foreground mt-1 font-mono text-sm font-semibold">
                  {formatBytes(summary.memoryUsageBytes)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">运行容器</p>
                <p className="text-foreground mt-1 font-mono text-sm font-semibold">
                  {summary.workloadCount}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">已识别使用者</p>
                <p className="text-foreground mt-1 font-mono text-sm font-semibold">
                  {summary.activeOwnerCount}
                </p>
              </div>
            </div>
          </div>

          <div className="border-border min-w-0 border-t pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5">
            <div className="flex items-center justify-between gap-3 pb-3">
              <div>
                <h3 className="text-foreground text-sm font-semibold">
                  GPU 节点
                </h3>
                <p className="text-muted-foreground mt-1 text-xs">
                  仅显示集群配置中登记的 GPU 节点。
                </p>
              </div>
              <ServerIcon className="text-muted-foreground size-4" />
            </div>
            <div className="divide-border border-border divide-y border-y">
              {liveSnapshot.nodes.map((node) => (
                <div
                  key={node.name}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          node.ready === true
                            ? "bg-chart-2"
                            : node.ready === false
                              ? "bg-destructive"
                              : "bg-muted-foreground/40",
                        )}
                      />
                      <p className="text-foreground truncate text-[13px] font-semibold">
                        {node.name}
                      </p>
                      <span className="text-muted-foreground truncate font-mono text-[11px]">
                        {node.ip}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate text-[11px]">
                      {node.gpuModels.join(" / ") || "GPU 型号待同步"}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-muted-foreground">
                        实际负载 {formatPercent(node.gpuUtilizationPercent)}
                      </span>
                      <span className="text-muted-foreground">
                        显存 {formatPercent(node.gpuMemoryUtilizationPercent)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-foreground font-mono text-sm font-semibold">
                      {node.gpuCardsAllocated}/{node.gpuCardsTotal} 卡
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {node.workloadCount} 个容器
                    </span>
                    <Badge
                      variant={
                        node.ready === false
                          ? "destructive"
                          : node.ready === true
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {node.ready === true
                        ? "Ready"
                        : node.ready === false
                          ? "Not Ready"
                          : "未同步"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-border mt-5 border-t pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                使用者占用
              </h3>
              <p className="text-muted-foreground mt-1 text-xs">
                按 GPU 显存分配量排序，未写入归属的 Pod 单独汇总。
              </p>
            </div>
            <UsersIcon className="text-muted-foreground size-4" />
          </div>
          {liveSnapshot.owners.length > 0 ? (
            <div className="border-border grid border-y sm:grid-cols-2 xl:grid-cols-4">
              {liveSnapshot.owners.map((entry) => (
                <div
                  key={entry.id}
                  className="border-border min-w-0 border-b px-3 py-3 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
                >
                  <OwnerIdentity owner={entry.owner} />
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <p className="text-muted-foreground">容器</p>
                      <p className="text-foreground mt-0.5 font-mono font-semibold">
                        {entry.workloadCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">GPU</p>
                      <p className="text-foreground mt-0.5 font-mono font-semibold">
                        {entry.gpuCards}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">显存</p>
                      <p className="text-foreground mt-0.5 truncate font-mono font-semibold">
                        {formatGpuMemory(entry.allocatedMemoryMi)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="border-border text-muted-foreground border-y py-6 text-center text-sm">
              当前没有 GPU 使用者记录。
            </p>
          )}
        </div>
      </ModuleSection>

      <ModuleSection
        title="运行容器负载"
        description="逐个容器对照使用者、GPU 卡、算力、显存、CPU、内存与运行状态。"
        density="compact"
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              aria-label="搜索工作负载"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索使用者、容器、节点"
              className="w-full sm:w-60"
            />
            <Select
              value={filter}
              onValueChange={(value) => {
                if (value && isWorkloadFilter(value)) setFilter(value);
              }}
            >
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="筛选状态">
                  {() => workloadFilterLabels[filter]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(workloadFilterLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        }
      >
        {workloads.length > 0 ? (
          <div className="border-border min-w-0 border-y">
            <Table className="min-w-[1080px] table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[175px] px-3">使用者</TableHead>
                  <TableHead className="w-[235px] px-3">
                    工作负载 / 容器
                  </TableHead>
                  <TableHead className="w-[180px] px-3">节点 / GPU</TableHead>
                  <TableHead className="w-[190px] px-3">GPU 负载</TableHead>
                  <TableHead className="w-[135px] px-3">CPU</TableHead>
                  <TableHead className="w-[150px] px-3">内存</TableHead>
                  <TableHead className="w-[100px] px-3 text-right">
                    状态
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workloads.map((workload) => (
                  <TableRow key={workload.id}>
                    <TableCell className="px-3 py-3 whitespace-normal">
                      <OwnerIdentity owner={workload.owner} />
                    </TableCell>
                    <TableCell className="px-3 py-3 whitespace-normal">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline">
                            {workloadKindLabels[workload.kind]}
                          </Badge>
                          <p className="text-foreground truncate text-[13px] font-semibold">
                            {workload.displayName}
                          </p>
                        </div>
                        <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
                          {workload.namespace}/{workload.podName}
                        </p>
                        <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
                          {workload.containerName} ·{" "}
                          {workload.image ?? "镜像未知"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3 whitespace-normal">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <ServerIcon className="text-muted-foreground size-3.5" />
                          <span className="text-foreground truncate text-[13px] font-medium">
                            {workload.nodeName}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 truncate text-[11px]">
                          {workload.gpuModels.join(" / ") || "GPU 型号待同步"}
                        </p>
                        <p
                          className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]"
                          title={workload.deviceIds.join(", ")}
                        >
                          {workload.deviceIds.map(shortDeviceId).join(" / ") ||
                            "未分配设备"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3 whitespace-normal">
                      <WorkloadGpuLoad workload={workload} />
                    </TableCell>
                    <TableCell className="px-3 py-3 whitespace-normal">
                      <WorkloadResourceLoad
                        value={formatCpu(workload.cpuUsageCores)}
                        percent={workload.cpuUtilizationPercent}
                        secondary={
                          workload.cpuLimitCores !== null
                            ? `上限 ${formatCpu(workload.cpuLimitCores)}`
                            : "未读取到配额"
                        }
                      />
                    </TableCell>
                    <TableCell className="px-3 py-3 whitespace-normal">
                      <WorkloadResourceLoad
                        value={formatBytes(workload.memoryUsageBytes)}
                        percent={workload.memoryUtilizationPercent}
                        secondary={
                          workload.memoryLimitBytes !== null
                            ? `上限 ${formatBytes(workload.memoryLimitBytes)}`
                            : "未读取到配额"
                        }
                      />
                    </TableCell>
                    <TableCell className="px-3 py-3 text-right whitespace-normal">
                      <div className="flex flex-col items-end gap-1.5">
                        <Badge variant={workloadStatusVariant(workload.status)}>
                          {workloadStatusLabels[workload.status]}
                        </Badge>
                        <span className="text-muted-foreground text-[11px]">
                          {workload.restartCount === null
                            ? "重启未知"
                            : `${workload.restartCount} 次重启`}
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                          {workload.createdAt
                            ? formatTime(workload.createdAt)
                            : "启动时间未知"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <ModuleEmptyState
            title={
              liveSnapshot.workloads.length === 0
                ? "当前没有运行中的 GPU 容器"
                : "没有符合筛选条件的容器"
            }
            description={
              liveSnapshot.workloads.length === 0
                ? "HAMi 当前未返回 GPU 工作负载，节点资源仍可在上方查看。"
                : "调整搜索词或筛选条件后重新查看。"
            }
            action={
              liveSnapshot.workloads.length > 0 ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        )}
      </ModuleSection>
    </ModulePageShell>
  );
}
