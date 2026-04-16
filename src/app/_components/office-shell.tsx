"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  CpuIcon,
  PackageIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  agentRoleValues,
  agentStatusLabels,
  dockerRunnerEngineLabels,
  dockerRunnerEngineValues,
  deviceStatusLabels,
  deviceTypeLabels,
  priorityLabels,
  riskLevelLabels,
  roleLabels,
  taskStatusLabels,
  taskTypeValues,
  type AgentRole,
  type ApprovalType,
  type DockerRunnerEngine,
  type RiskLevel,
  type TaskStatus,
} from "@/server/office/catalog";
import type { OfficeSnapshot } from "@/server/office/types";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

type Props = {
  snapshot: OfficeSnapshot;
};

const taskTypeLabels: Record<(typeof taskTypeValues)[number], string> = {
  feature: "功能开发",
  bugfix: "缺陷修复",
  campaign: "运营活动",
  recruiting: "招聘推进",
  procurement: "采购流转",
  coordination: "跨部门协调",
};

const roleIcons: Record<AgentRole, typeof BriefcaseBusinessIcon> = {
  product: BriefcaseBusinessIcon,
  engineering: CpuIcon,
  operations: SparklesIcon,
  hr: UsersIcon,
  procurement: PackageIcon,
  ceo_office: Building2Icon,
};

function isAgentRole(value: string): value is AgentRole {
  return agentRoleValues.includes(value as AgentRole);
}

function isTaskType(value: string): value is (typeof taskTypeValues)[number] {
  return taskTypeValues.includes(value as (typeof taskTypeValues)[number]);
}

function isDockerRunnerEngine(value: string): value is DockerRunnerEngine {
  return dockerRunnerEngineValues.includes(value as DockerRunnerEngine);
}

function isPriority(value: string): value is keyof typeof priorityLabels {
  return value in priorityLabels;
}

function isRiskLevel(value: string): value is keyof typeof riskLevelLabels {
  return value in riskLevelLabels;
}

const badgeTone = {
  idle: "secondary",
  planning: "outline",
  waiting_device: "outline",
  executing: "default",
  waiting_handoff: "secondary",
  waiting_approval: "secondary",
  blocked: "destructive",
  error: "destructive",
} as const;

const statusDotTone = {
  idle: "bg-stone-400",
  planning: "bg-amber-500",
  waiting_device: "bg-amber-500",
  executing: "bg-emerald-500",
  waiting_handoff: "bg-sky-500",
  waiting_approval: "bg-amber-500",
  blocked: "bg-rose-500",
  error: "bg-rose-500",
} as const;

const agentStatusSortOrder: Record<keyof typeof statusDotTone, number> = {
  executing: 0,
  planning: 1,
  waiting_handoff: 2,
  waiting_approval: 3,
  waiting_device: 4,
  idle: 5,
  blocked: 6,
  error: 7,
};

const executionStatusLabels = {
  pending: "待启动",
  starting: "启动中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  canceled: "已取消",
} as const;

const eventSeverityLabels = {
  info: "信息",
  warning: "提醒",
  critical: "严重",
} as const;

type FeedbackState = {
  message: string;
  tone: "success" | "error";
};

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium tracking-[0.22em] text-stone-600 uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

function canStartTask(status: TaskStatus) {
  return (
    status === "created" ||
    status === "queued" ||
    status === "assigned" ||
    status === "handed_off"
  );
}

function canCompleteTask(status: TaskStatus) {
  return status === "in_progress";
}

function canRequestTaskApproval(
  status: TaskStatus,
  riskLevel: RiskLevel,
) {
  if (riskLevel === "low") return false;

  return (
    status === "created" ||
    status === "queued" ||
    status === "assigned" ||
    status === "in_progress"
  );
}

type ZoneCardProps = {
  zone: OfficeSnapshot["zones"][number];
  agents: OfficeSnapshot["agents"];
  active: boolean;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  className?: string;
  style?: CSSProperties;
};

function ZoneCard({
  zone,
  agents,
  active,
  selectedAgentId,
  onSelectAgent,
  className,
  style,
}: ZoneCardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[28px] border bg-white/52 shadow-[0_20px_44px_rgba(88,60,25,0.09)] backdrop-blur-sm",
        active
          ? "border-[#d39b42]/75 bg-white/72 shadow-[0_22px_56px_rgba(181,122,28,0.16)]"
          : "border-white/55",
        className,
      )}
      style={style}
    >
      <div className="flex h-full flex-col gap-4 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] tracking-[0.28em] text-stone-500 uppercase">
              {zone.id}
            </p>
            <h3 className="mt-2 text-base font-semibold text-stone-950 md:text-lg">
              {zone.label}
            </h3>
            <p className="mt-1 max-w-[26ch] text-xs leading-5 text-stone-500">
              {zone.summary}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-stone-600">
            {zone.activeCount}/{zone.headcount}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {agents.length > 0 ? (
            <div className="flex flex-wrap gap-2.5">
              {agents.map((agent) => {
                const Icon = roleIcons[agent.role];
                const selected = selectedAgentId === agent.id;

                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectAgent(agent.id)}
                    className={cn(
                      "flex min-w-0 flex-1 basis-[148px] items-center gap-3 rounded-[20px] border px-3 py-3 text-left transition-all duration-200",
                      selected
                        ? "border-[#d39b42]/70 bg-[#fff8eb] shadow-[0_12px_26px_rgba(181,122,28,0.14)]"
                        : "border-white/70 bg-white/86 hover:border-[#d39b42]/45 hover:bg-white",
                    )}
                  >
                    <div
                      className={cn(
                        "relative flex size-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold text-stone-900",
                        selected ? "bg-[#f4deb0]" : "bg-stone-900/[0.05]",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-white",
                          statusDotTone[agent.status],
                        )}
                      />
                      {agent.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-stone-900">
                          {agent.name}
                        </span>
                        {selected ? (
                          <span className="rounded-full bg-[#e8c98d] px-2 py-0.5 text-[10px] font-semibold text-[#5b3507]">
                            当前
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-500">
                        <Icon className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {agentStatusLabels[agent.status]}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full items-end">
              <p className="text-xs text-stone-400">当前没有在岗人物。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ColaLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-full border border-white/70 bg-white/74 text-stone-900 shadow-[0_14px_30px_rgba(92,63,23,0.12)] backdrop-blur-sm",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        className,
      )}
    >
      <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[linear-gradient(145deg,#2f2214_0%,#8d5f21_52%,#efce8f_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
        <div className="absolute inset-[1px] rounded-[15px] bg-[radial-gradient(circle_at_top,rgba(255,250,239,0.28),transparent_58%)]" />
        <svg
          viewBox="0 0 48 48"
          aria-hidden="true"
          className="relative z-10 size-8 text-[#fff7ea]"
          fill="none"
        >
          <path
            d="M33 14.5c-2.1-2.6-5.3-4-9-4-6.6 0-11.5 5.2-11.5 13.5S17.4 37.5 24 37.5c3.7 0 6.8-1.3 9-3.8"
            stroke="currentColor"
            strokeWidth="4.2"
            strokeLinecap="round"
          />
          <path
            d="M30.8 17.2H23.5"
            stroke="currentColor"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <path
            d="M28.5 30.8H20.2"
            stroke="currentColor"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium tracking-[0.32em] text-stone-500 uppercase">
          Cola Systems
        </p>
        <p
          className={cn(
            "truncate font-semibold tracking-[-0.04em] text-stone-950",
            compact ? "text-base" : "text-lg",
          )}
        >
          Cola Virtual Office
        </p>
      </div>
    </div>
  );
}

export function OfficeShell({ snapshot }: Props) {
  const utils = api.useUtils();
  const [streamState, setStreamState] = useState<
    "connecting" | "live" | "reconnecting"
  >("connecting");
  const lastVersionRef = useRef<string | null>(null);
  const snapshotQuery = api.office.getSnapshot.useQuery(undefined, {
    initialData: snapshot,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const liveSnapshot = snapshotQuery.data ?? snapshot;
  const [selectedAgentId, setSelectedAgentId] = useState(
    liveSnapshot.agents.find((agent) => agent.role === "engineering")?.id ??
      liveSnapshot.agents[0]?.id ??
      null,
  );
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [assignTaskOpen, setAssignTaskOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [agentDraft, setAgentDraft] = useState({
    name: "",
    role: "engineering" as AgentRole,
    engine: "openclaw" as DockerRunnerEngine,
  });
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    summary: "",
    ownerAgentId:
      liveSnapshot.agents.find((agent) => agent.id === selectedAgentId)?.id ??
      liveSnapshot.agents[0]?.id ??
      "",
    taskType: "feature" as (typeof taskTypeValues)[number],
    priority: "medium" as keyof typeof priorityLabels,
    riskLevel: "medium" as keyof typeof riskLevelLabels,
  });

  const selectedAgent =
    liveSnapshot.agents.find((agent) => agent.id === selectedAgentId) ??
    liveSnapshot.agents[0] ??
    null;

  const selectedAgentDevice = selectedAgent
    ? (liveSnapshot.devices.find(
        (device) => device.id === selectedAgent.deviceId,
      ) ?? null)
    : null;
  const selectedZone = selectedAgent
    ? (liveSnapshot.zones.find((zone) => zone.id === selectedAgent.zoneId) ??
      null)
    : null;
  const generatedAtLabel = new Date(
    liveSnapshot.generatedAt,
  ).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const hasWorkspaceContent = liveSnapshot.zones.length > 0;
  const canCreateTask = liveSnapshot.agents.length > 0;

  const selectedAgentTasks = useMemo(() => {
    if (!selectedAgent) return [];
    return liveSnapshot.tasks.filter(
      (task) => task.ownerAgentId === selectedAgent.id,
    );
  }, [selectedAgent, liveSnapshot.tasks]);

  const selectedAgentApprovals = useMemo(() => {
    if (!selectedAgent) return [];
    return liveSnapshot.approvals.filter(
      (approval) => approval.requestedByAgentId === selectedAgent.id,
    );
  }, [selectedAgent, liveSnapshot.approvals]);

  const selectedAgentReports = useMemo(() => {
    if (!selectedAgent) return [];
    return liveSnapshot.executionReports.filter(
      (report) => report.agentId === selectedAgent.id,
    );
  }, [selectedAgent, liveSnapshot.executionReports]);

  const agentsByZone = useMemo(() => {
    const grouped = new Map<string, OfficeSnapshot["agents"]>();

    for (const zone of liveSnapshot.zones) {
      grouped.set(zone.id, []);
    }

    for (const agent of liveSnapshot.agents) {
      grouped.set(agent.zoneId, [...(grouped.get(agent.zoneId) ?? []), agent]);
    }

    for (const agents of grouped.values()) {
      agents.sort((left, right) => {
        if (left.id === selectedAgentId) return -1;
        if (right.id === selectedAgentId) return 1;

        const statusDelta =
          agentStatusSortOrder[left.status] -
          agentStatusSortOrder[right.status];

        if (statusDelta !== 0) return statusDelta;

        return left.name.localeCompare(right.name, "zh-CN");
      });
    }

    return grouped;
  }, [liveSnapshot.agents, liveSnapshot.zones, selectedAgentId]);

  useEffect(() => {
    if (
      selectedAgentId &&
      liveSnapshot.agents.some((agent) => agent.id === selectedAgentId)
    ) {
      return;
    }

    setSelectedAgentId(
      liveSnapshot.agents.find((agent) => agent.role === "engineering")?.id ??
        liveSnapshot.agents[0]?.id ??
        null,
    );
  }, [liveSnapshot.agents, selectedAgentId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const eventSource = new EventSource("/api/office/stream");

    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { version?: string };
        if (payload.version && payload.version !== lastVersionRef.current) {
          lastVersionRef.current = payload.version;
          setStreamState("live");
          void utils.office.getSnapshot.invalidate();
        }
      } catch {
        setStreamState("reconnecting");
      }
    };

    const handleHeartbeat = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { version?: string };
        if (payload.version) lastVersionRef.current = payload.version;
        setStreamState("live");
      } catch {
        setStreamState("reconnecting");
      }
    };

    eventSource.addEventListener("snapshot", handleSnapshot as EventListener);
    eventSource.addEventListener("heartbeat", handleHeartbeat as EventListener);
    eventSource.onerror = () => {
      setStreamState("reconnecting");
    };

    return () => {
      eventSource.close();
    };
  }, [utils.office.getSnapshot]);

  useEffect(() => {
    if (!feedback) return;

    const timeout = window.setTimeout(
      () => setFeedback(null),
      feedback.tone === "error" ? 5200 : 3600,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [feedback]);

  const pushFeedback = (
    message: string,
    tone: FeedbackState["tone"] = "success",
  ) => {
    setFeedback({ message, tone });
  };

  const createAgent = api.office.createAgent.useMutation({
    onSuccess: (result) => {
      pushFeedback(result.message);
      setSelectedAgentId(result.agentId);
      setAddAgentOpen(false);
      setAgentDraft({ name: "", role: "engineering", engine: "openclaw" });
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });

  const createTask = api.office.createTask.useMutation({
    onSuccess: () => {
      pushFeedback("任务已分派，角色会在 office 中继续处理。");
      setAssignTaskOpen(false);
      setTaskDraft((current) => ({ ...current, title: "", summary: "" }));
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });

  const updateTaskStatus = api.office.updateTaskStatus.useMutation({
    onSuccess: () => {
      pushFeedback("任务状态已更新。");
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });

  const requestApproval = api.office.requestApproval.useMutation({
    onSuccess: () => {
      pushFeedback("审批请求已发出。");
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });

  const resolveApproval = api.office.resolveApproval.useMutation({
    onSuccess: () => {
      pushFeedback("审批结果已写入系统。");
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });

  const busy =
    createAgent.isPending ||
    createTask.isPending ||
    updateTaskStatus.isPending ||
    requestApproval.isPending ||
    resolveApproval.isPending;

  const openAssignTaskDialog = (agentId?: string) => {
    if (!canCreateTask) {
      pushFeedback("请先新增人物，再下发任务。", "error");
      return;
    }

    setTaskDraft((current) => ({
      ...current,
      ownerAgentId:
        agentId ?? selectedAgent?.id ?? liveSnapshot.agents[0]?.id ?? "",
    }));
    setAssignTaskOpen(true);
  };

  return (
    <div className="min-h-dvh bg-[linear-gradient(180deg,#f7edd8_0%,#ecd7ad_52%,#debc82_100%)] px-3 py-3 text-stone-900 md:px-5 md:py-4 xl:h-dvh xl:overflow-hidden">
      <main className="mx-auto flex max-w-[1700px] flex-col gap-4 xl:h-full">
        <header className="shrink-0 rounded-[30px] border border-white/65 bg-white/62 px-4 py-5 backdrop-blur md:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <ColaLogo className="w-fit" />
              <div className="space-y-2">
                <p className="text-[11px] tracking-[0.32em] text-stone-500 uppercase">
                  Control Surface
                </p>
                <h1 className="text-3xl font-semibold tracking-[-0.05em] text-stone-950 md:text-[3.4rem]">
                  Cola Virtual Office
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-stone-600 md:text-[15px]">
                  {liveSnapshot.headline}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                <Badge
                  variant={streamState === "live" ? "default" : "secondary"}
                >
                  {streamState === "live" ? "实时流已连接" : "实时流重连中"}
                </Badge>
                <span>快照更新时间 {generatedAtLabel}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 xl:max-w-[340px] xl:justify-end">
              <Button
                variant="outline"
                onClick={() => setMobileInspectorOpen(true)}
                className="lg:hidden"
              >
                <ActivityIcon data-icon="inline-start" />
                打开总控
              </Button>
              <Button
                variant="outline"
                onClick={() => openAssignTaskDialog()}
                disabled={!canCreateTask}
              >
                <SendIcon data-icon="inline-start" />
                下发任务
              </Button>
              <Button onClick={() => setAddAgentOpen(true)}>
                <UserPlusIcon data-icon="inline-start" />
                新增人物
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2 xl:grid-cols-4">
            {liveSnapshot.metrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <p className="text-[11px] tracking-[0.22em] text-stone-400 uppercase">
                  {metric.label}
                </p>
                <p className="mt-2 text-3xl font-semibold text-stone-950">
                  {metric.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {metric.delta}
                </p>
              </div>
            ))}
          </div>
        </header>

        <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[minmax(0,1fr)]">
          <section className="flex min-h-[560px] flex-col overflow-hidden rounded-[30px] border border-white/60 bg-white/22 p-4 shadow-[0_24px_80px_rgba(72,45,19,0.12)] md:p-5 xl:h-full xl:min-h-0">
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
              <div>
                <p className="text-[11px] tracking-[0.28em] text-stone-500 uppercase">
                  Workspace
                </p>
                <h2 className="mt-1 text-xl font-semibold text-stone-950 md:text-2xl">
                  Office floor
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-stone-600 lg:justify-self-end">
                {hasWorkspaceContent
                  ? "只显示分区、在岗人物和活跃人数。详细任务、设备与审批统一收进右侧总控。"
                  : "数据库已清空。创建角色后，办公分区和人物才会重新出现。"}
              </p>
            </div>

            {hasWorkspaceContent ? (
              <div className="mt-4 grid gap-3 md:hidden">
                {liveSnapshot.zones.map((zone) => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}
                    agents={agentsByZone.get(zone.id) ?? []}
                    active={selectedZone?.id === zone.id}
                    selectedAgentId={selectedAgent?.id ?? null}
                    onSelectAgent={setSelectedAgentId}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-4 flex min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-white/50 bg-white/28 px-6 text-center md:hidden">
                <div className="max-w-sm">
                  <p className="text-[11px] tracking-[0.28em] text-stone-400 uppercase">
                    Empty workspace
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold text-stone-950">
                    办公区已清空
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-stone-500">
                    当前没有任何分区或人物数据，所以这里不再显示默认布局。
                  </p>
                </div>
              </div>
            )}

            <div className="relative mt-4 hidden flex-1 overflow-hidden rounded-[28px] border border-white/45 bg-[linear-gradient(180deg,rgba(255,249,238,0.96)_0%,rgba(238,221,188,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] md:block">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30" />
              <div className="absolute inset-[18px] rounded-[24px] border border-white/35" />

              {hasWorkspaceContent ? (
                liveSnapshot.zones.map((zone) => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}
                    agents={agentsByZone.get(zone.id) ?? []}
                    active={selectedZone?.id === zone.id}
                    selectedAgentId={selectedAgent?.id ?? null}
                    onSelectAgent={setSelectedAgentId}
                    className="absolute transition-all duration-200"
                    style={{
                      left: `${zone.x}%`,
                      top: `${zone.y}%`,
                      width: `${zone.width}%`,
                      height: `${zone.height}%`,
                    }}
                  />
                ))
              ) : (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <div className="max-w-md text-center">
                    <p className="text-[11px] tracking-[0.28em] text-stone-400 uppercase">
                      Empty workspace
                    </p>
                    <h3 className="mt-3 text-3xl font-semibold text-stone-950">
                      办公区已清空
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-stone-500">
                      当前数据库没有任何分区或人物数据，所以这里不再显示默认布局。新增人物后再恢复真实办公画布。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="hidden xl:block xl:h-full xl:min-h-0">
            <InspectorPanel
              agent={selectedAgent}
              zone={selectedZone}
              device={selectedAgentDevice}
              tasks={selectedAgentTasks}
              approvals={selectedAgentApprovals}
              events={liveSnapshot.events}
              reports={selectedAgentReports}
              onStatusChange={(taskId, status) =>
                updateTaskStatus.mutate({ taskId, status })
              }
              onRequestApproval={(taskId, title, summary, approvalType) =>
                requestApproval.mutate({ taskId, title, summary, approvalType })
              }
              onResolveApproval={(approvalId, decision) =>
                resolveApproval.mutate({ approvalId, decision })
              }
              busy={busy}
            />
          </aside>
        </div>
      </main>

      <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>办公室总控</SheetTitle>
            <SheetDescription>
              查看当前选中角色的状态、任务与审批。
            </SheetDescription>
          </SheetHeader>
          <InspectorPanel
            agent={selectedAgent}
            zone={selectedZone}
            device={selectedAgentDevice}
            tasks={selectedAgentTasks}
            approvals={selectedAgentApprovals}
            events={liveSnapshot.events}
            reports={selectedAgentReports}
            onStatusChange={(taskId, status) =>
              updateTaskStatus.mutate({ taskId, status })
            }
            onRequestApproval={(taskId, title, summary, approvalType) =>
              requestApproval.mutate({ taskId, title, summary, approvalType })
            }
            onResolveApproval={(approvalId, decision) =>
              resolveApproval.mutate({ approvalId, decision })
            }
            busy={busy}
          />
        </SheetContent>
      </Sheet>

      <Dialog open={addAgentOpen} onOpenChange={setAddAgentOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] max-w-md overflow-y-auto rounded-[28px] border border-white/75 bg-[#fffdf8]/95 p-5 shadow-[0_32px_80px_rgba(74,46,16,0.18)]">
          <DialogHeader>
            <DialogTitle>新增人物</DialogTitle>
            <DialogDescription className="leading-6">
              创建角色后，系统会先落库，再在后台尝试用本机 Docker 拉起一个
              runner。OpenClaw 和 Hermes Agent 都会复用 `~/.codex` 里的模型配置与认证信息。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 rounded-[24px] bg-[#fbf4e4] p-4">
            <FormField label="人物名称">
              <Input
                aria-label="人物名称"
                className="h-11 rounded-xl bg-white/86"
                value={agentDraft.name}
                onChange={(event) =>
                  {
                    createAgent.reset();
                    setAgentDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }));
                  }
                }
                placeholder="例如：陈产品 / 周运营 / 何HR"
              />
            </FormField>
            <FormField label="角色职责">
              <Select
                value={agentDraft.role}
                onValueChange={(value) => {
                  if (!value || !isAgentRole(value)) return;
                  createAgent.reset();
                  setAgentDraft((current) => ({
                    ...current,
                    role: value,
                  }));
                }}
              >
                <SelectTrigger
                  aria-label="角色职责"
                  className="h-11 w-full rounded-xl bg-white/86"
                >
                  <SelectValue placeholder="选择角色">
                    {(value) =>
                      typeof value === "string" && isAgentRole(value)
                        ? roleLabels[value]
                        : "选择角色"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {agentRoleValues.map((role) => (
                      <SelectItem key={role} value={role}>
                        {roleLabels[role]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="执行引擎">
              <Select
                value={agentDraft.engine}
                onValueChange={(value) => {
                  if (!value || !isDockerRunnerEngine(value)) return;
                  createAgent.reset();
                  setAgentDraft((current) => ({
                    ...current,
                    engine: value,
                  }));
                }}
              >
                <SelectTrigger
                  aria-label="执行引擎"
                  className="h-11 w-full rounded-xl bg-white/86"
                >
                  <SelectValue placeholder="选择执行引擎">
                    {(value) =>
                      typeof value === "string" && isDockerRunnerEngine(value)
                        ? dockerRunnerEngineLabels[value]
                        : "选择执行引擎"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {dockerRunnerEngineValues.map((engine) => (
                      <SelectItem key={engine} value={engine}>
                        {dockerRunnerEngineLabels[engine]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          {createAgent.error ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
              {createAgent.error.message}
            </p>
          ) : null}
          <DialogFooter className="-mx-5 -mb-5 bg-[#fff8ea] px-5">
            <Button variant="outline" onClick={() => setAddAgentOpen(false)}>
              取消
            </Button>
            <Button
              disabled={busy || !agentDraft.name.trim()}
              onClick={() => createAgent.mutate(agentDraft)}
            >
              <PlusIcon data-icon="inline-start" />
              {createAgent.isPending ? "正在创建..." : "创建并后台拉起 Runner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignTaskOpen} onOpenChange={setAssignTaskOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] max-w-2xl overflow-y-auto rounded-[28px] border border-white/75 bg-[#fffdf8]/95 p-5 shadow-[0_32px_80px_rgba(74,46,16,0.18)]">
          <DialogHeader>
            <DialogTitle>给人物下发任务</DialogTitle>
            <DialogDescription className="leading-6">
              任务会直接进入所选角色的待办；如果该角色空闲，会立刻开始进入规划状态。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 rounded-[24px] bg-[#fbf4e4] p-4">
            <FormField label="任务标题">
              <Input
                aria-label="任务标题"
                className="h-11 rounded-xl bg-white/86"
                value={taskDraft.title}
                onChange={(event) =>
                  {
                    createTask.reset();
                    setTaskDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }));
                  }
                }
                placeholder="例如：补审批回放页面 / 整理 HR 入职清单"
              />
            </FormField>
            <FormField label="任务说明">
              <Textarea
                aria-label="任务说明"
                className="min-h-[120px] rounded-2xl bg-white/86"
                value={taskDraft.summary}
                onChange={(event) =>
                  {
                    createTask.reset();
                    setTaskDraft((current) => ({
                      ...current,
                      summary: event.target.value,
                    }));
                  }
                }
                placeholder="写清输出物、上下文和限制条件"
                rows={4}
              />
            </FormField>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="执行角色">
                <Select
                  value={taskDraft.ownerAgentId}
                  onValueChange={(value) => {
                    if (!value) return;
                    createTask.reset();
                    setTaskDraft((current) => ({
                      ...current,
                      ownerAgentId: value,
                    }));
                  }}
                >
                  <SelectTrigger
                    aria-label="执行角色"
                    className="h-11 w-full rounded-xl bg-white/86"
                  >
                    <SelectValue placeholder="选择角色">
                      {(value) => {
                        const agent = liveSnapshot.agents.find(
                          (candidate) => candidate.id === value,
                        );

                        return agent
                          ? `${agent.name} · ${roleLabels[agent.role]}`
                          : "选择角色";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {liveSnapshot.agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name} / {roleLabels[agent.role]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="任务类型">
                <Select
                  value={taskDraft.taskType}
                  onValueChange={(value) => {
                    if (!value || !isTaskType(value)) return;
                    createTask.reset();
                    setTaskDraft((current) => ({
                      ...current,
                      taskType: value,
                    }));
                  }}
                >
                  <SelectTrigger
                    aria-label="任务类型"
                    className="h-11 w-full rounded-xl bg-white/86"
                  >
                    <SelectValue placeholder="选择任务类型">
                      {(value) =>
                        typeof value === "string" && isTaskType(value)
                          ? taskTypeLabels[value]
                          : "选择任务类型"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {taskTypeValues.map((taskType) => (
                        <SelectItem key={taskType} value={taskType}>
                          {taskTypeLabels[taskType]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="优先级">
                <Select
                  value={taskDraft.priority}
                  onValueChange={(value) => {
                    if (!value || !isPriority(value)) return;
                    createTask.reset();
                    setTaskDraft((current) => ({
                      ...current,
                      priority: value,
                    }));
                  }}
                >
                  <SelectTrigger
                    aria-label="优先级"
                    className="h-11 w-full rounded-xl bg-white/86"
                  >
                    <SelectValue placeholder="选择优先级">
                      {(value) =>
                        typeof value === "string" && isPriority(value)
                          ? priorityLabels[value]
                          : "选择优先级"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(priorityLabels).map(([priority, label]) => (
                        <SelectItem key={priority} value={priority}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="风险等级">
                <Select
                  value={taskDraft.riskLevel}
                  onValueChange={(value) => {
                    if (!value || !isRiskLevel(value)) return;
                    createTask.reset();
                    setTaskDraft((current) => ({
                      ...current,
                      riskLevel: value,
                    }));
                  }}
                >
                  <SelectTrigger
                    aria-label="风险等级"
                    className="h-11 w-full rounded-xl bg-white/86"
                  >
                    <SelectValue placeholder="选择风险等级">
                      {(value) =>
                        typeof value === "string" && isRiskLevel(value)
                          ? riskLevelLabels[value]
                          : "选择风险等级"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(riskLevelLabels).map(([risk, label]) => (
                        <SelectItem key={risk} value={risk}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          </div>
          {createTask.error ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
              {createTask.error.message}
            </p>
          ) : null}
          <DialogFooter className="-mx-5 -mb-5 bg-[#fff8ea] px-5">
            <Button variant="outline" onClick={() => setAssignTaskOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                busy || !taskDraft.title.trim() || !taskDraft.summary.trim()
              }
              onClick={() => createTask.mutate(taskDraft)}
            >
              <ArrowRightIcon data-icon="inline-start" />
              {createTask.isPending ? "正在下发..." : "下发任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {feedback ? (
        <div
          aria-live="polite"
          className={cn(
            "pointer-events-none fixed bottom-4 left-1/2 z-[90] flex w-[min(560px,calc(100%-1.5rem))] -translate-x-1/2 items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-[0_18px_50px_rgba(50,30,15,0.16)] backdrop-blur",
            feedback.tone === "error"
              ? "border border-rose-200/80 bg-rose-50/95 text-rose-950"
              : "border border-white/70 bg-white/94 text-stone-800",
          )}
        >
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-[0.18em] uppercase",
              feedback.tone === "error"
                ? "bg-rose-100 text-rose-700"
                : "bg-[#f0debb] text-[#7b4a10]",
            )}
          >
            {feedback.tone === "error" ? "异常" : "已更新"}
          </span>
          <p className="leading-6">{feedback.message}</p>
        </div>
      ) : null}
    </div>
  );
}

function InspectorPanel({
  agent,
  zone,
  device,
  tasks,
  approvals,
  events,
  reports,
  onStatusChange,
  onRequestApproval,
  onResolveApproval,
  busy,
}: {
  agent: OfficeSnapshot["agents"][number] | null;
  zone: OfficeSnapshot["zones"][number] | null;
  device: OfficeSnapshot["devices"][number] | null;
  tasks: OfficeSnapshot["tasks"];
  approvals: OfficeSnapshot["approvals"];
  events: OfficeSnapshot["events"];
  reports: OfficeSnapshot["executionReports"];
  onStatusChange: (
    taskId: string,
    status: OfficeSnapshot["tasks"][number]["status"],
  ) => void;
  onRequestApproval: (
    taskId: string,
    title: string,
    summary: string,
    approvalType: ApprovalType,
  ) => void;
  onResolveApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
  ) => void;
  busy: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-white/60 bg-white/72 p-4 shadow-[0_24px_80px_rgba(65,42,23,0.1)] backdrop-blur">
      <ScrollArea className="min-h-0 flex-1 pr-3">
        {agent ? (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback>{agent.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-semibold text-stone-950">
                    {agent.name}
                  </p>
                  <p className="text-sm text-stone-500">
                    {roleLabels[agent.role]}
                  </p>
                </div>
              </div>
              <Badge variant={badgeTone[agent.status]}>
                {agentStatusLabels[agent.status]}
              </Badge>
            </div>

            <p className="text-sm leading-6 text-stone-600">{agent.focus}</p>

            <div className="rounded-[24px] bg-[#f7ecd5] px-4 py-4">
              <p className="text-[11px] tracking-[0.2em] text-stone-600 uppercase">
                当前工位
              </p>
              <div className="mt-2 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-stone-950">
                    {zone?.label ?? "未分配区域"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-stone-700">
                    {zone?.summary ?? "等待系统分配工作区。"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] tracking-[0.2em] text-stone-600 uppercase">
                    能量
                  </p>
                  <p className="mt-1 text-lg font-semibold text-stone-950">
                    {agent.energy}%
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/70 bg-white/78 p-3">
                <p className="text-[11px] tracking-[0.2em] text-stone-600 uppercase">
                  设备会话
                </p>
                <p className="mt-2 text-sm font-medium text-stone-900">
                  {device?.name ?? "尚未绑定会话"}
                </p>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {device
                    ? `${deviceTypeLabels[device.type]} / ${deviceStatusLabels[device.status]}`
                    : "等待下一次 Docker 调度或执行会话"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/78 p-3">
                <p className="text-[11px] tracking-[0.2em] text-stone-600 uppercase">
                  活跃状态
                </p>
                <p className="mt-2 text-sm font-medium text-stone-900">
                  {tasks.length} 项任务
                </p>
                <p className="mt-1 text-xs leading-5 text-stone-500">
                  {reports.length} 条执行记录，{approvals.length}{" "}
                  项审批挂在此角色上
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-950">任务清单</p>
              <Badge variant="outline">{tasks.length}</Badge>
            </div>
            <div className="space-y-3">
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-white/70 bg-white/82 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {taskStatusLabels[task.status]}
                      </Badge>
                      <Badge variant="secondary">
                        {priorityLabels[task.priority]}
                      </Badge>
                      <Badge variant="outline">
                        {riskLevelLabels[task.riskLevel]}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm font-medium text-stone-900">
                      {task.title}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-stone-500">
                      {task.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canStartTask(task.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onStatusChange(task.id, "in_progress")}
                        >
                          开始执行
                        </Button>
                      ) : null}
                      {canCompleteTask(task.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => onStatusChange(task.id, "completed")}
                        >
                          标记完成
                        </Button>
                      ) : null}
                      {canRequestTaskApproval(task.status, task.riskLevel) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            onRequestApproval(
                              task.id,
                              `审批：${task.title}`,
                              `由 inspector 发起审批，请确认任务「${task.title}」是否继续执行。`,
                              task.type === "procurement"
                                ? "vendor_quote"
                                : task.type === "recruiting"
                                  ? "offer_release"
                                  : "production_release",
                            )
                          }
                        >
                          请求审批
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/70 bg-white/60 p-6 text-sm leading-6 text-stone-500">
                  当前角色还没有任务。可以直接用顶部“下发任务”给它分派工作。
                </div>
              )}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-950">
                最近一次执行结果
              </p>
              <Badge variant="outline">{reports.length}</Badge>
            </div>
            <div className="space-y-3">
              {reports.length > 0 ? (
                reports.slice(0, 1).map((report) => (
                  <div
                    key={report.sessionId}
                    className="rounded-2xl border border-white/70 bg-white/82 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          report.status === "succeeded"
                            ? "default"
                            : report.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {executionStatusLabels[report.status] ?? report.status}
                      </Badge>
                      {report.completedAt ? (
                        <span className="text-[11px] text-stone-600">
                          {new Date(report.completedAt).toLocaleString("zh-CN")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm font-medium text-stone-900">
                      {report.title}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-stone-500">
                      {report.summary}
                    </p>
                    <div className="mt-3 rounded-2xl bg-stone-950 px-4 py-3 text-xs leading-6 text-stone-200">
                      {report.outputText ?? "本次执行还没有可展示的输出内容。"}
                    </div>
                    {report.artifactPath ? (
                      <p className="mt-3 truncate text-[11px] text-stone-600">
                        artifact: {report.artifactPath}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/70 bg-white/60 p-6 text-sm text-stone-500">
                  当前角色还没有执行结果回放。
                </div>
              )}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-950">待处理审批</p>
              <Badge variant="outline">{approvals.length}</Badge>
            </div>
            <div className="space-y-3">
              {approvals.length > 0 ? (
                approvals.map((approval) => (
                  <div
                    key={approval.id}
                    className="rounded-2xl border border-white/70 bg-white/82 p-4"
                  >
                    <p className="text-sm font-medium text-stone-900">
                      {approval.title}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-stone-500">
                      {approval.summary}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          onResolveApproval(approval.id, "approved")
                        }
                      >
                        批准
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          onResolveApproval(approval.id, "rejected")
                        }
                      >
                        驳回
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/70 bg-white/60 p-6 text-sm text-stone-500">
                  当前角色没有挂起审批。
                </div>
              )}
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-950">Office feed</p>
              <Badge variant="outline">{events.length}</Badge>
            </div>
            <div className="space-y-3">
              {events.length > 0 ? (
                events.slice(0, 6).map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-white/70 bg-white/78 p-3"
                  >
                    <div className="flex items-start gap-3">
                      <Badge
                        variant={
                          event.severity === "critical"
                            ? "destructive"
                            : event.severity === "warning"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {eventSeverityLabels[event.severity] ?? event.severity}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900">
                          {event.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          {event.description}
                        </p>
                        <p className="mt-2 text-[11px] text-stone-600">
                          {event.at}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/70 bg-white/60 p-6 text-sm text-stone-500">
                  当前没有新的办公室事件。
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-[24px] border border-dashed border-white/70 bg-white/60 p-6 text-sm leading-6 text-stone-500">
              先从办公室中选择一个人物，再查看它的设备、任务、审批和执行结果。
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-950">Office feed</p>
              <Badge variant="outline">{events.length}</Badge>
            </div>
            <div className="space-y-3">
              {events.slice(0, 6).map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-white/70 bg-white/78 p-3"
                >
                  <div className="flex items-start gap-3">
                    <Badge
                      variant={
                        event.severity === "critical"
                          ? "destructive"
                          : event.severity === "warning"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {event.severity}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900">
                        {event.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-stone-500">
                        {event.description}
                      </p>
                      <p className="mt-2 text-[11px] text-stone-400">
                        {event.at}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
