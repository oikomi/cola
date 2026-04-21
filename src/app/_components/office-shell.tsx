"use client";

import {
  type LucideIcon,
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CpuIcon,
  LoaderCircleIcon,
  RadarIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  UserRoundPlusIcon,
  UsersIcon,
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import { AdminChrome } from "@/app/_components/admin-chrome";
import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { k8sWorkspaceEngineLabels } from "@/lib/product-areas";
import { cn } from "@/lib/utils";
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
import { Textarea } from "@/components/ui/textarea";
import {
  agentRoleValues,
  agentStatusLabels,
  dockerRunnerEngineValues,
  priorityLabels,
  riskLevelLabels,
  roleLabels,
  taskStatusLabels,
  taskTypeValues,
  zoneLabels,
  type AgentRole,
  type DockerRunnerEngine,
  type TaskStatus,
} from "@/server/office/catalog";
import type { OfficeSnapshot } from "@/server/office/types";
import { api } from "@/trpc/react";

type Props = {
  snapshot: OfficeSnapshot;
};

type FeedbackState = {
  message: string;
  tone: "success" | "error";
};

const taskTypeLabels: Record<(typeof taskTypeValues)[number], string> = {
  feature: "功能开发",
  bugfix: "缺陷修复",
  campaign: "运营活动",
  recruiting: "招聘推进",
  procurement: "采购流转",
  coordination: "跨部门协作",
};

const roleHints: Record<AgentRole, string> = {
  product: "负责拆解目标、整理需求和界面策略。",
  engineering: "负责实现、调试和交付执行结果。",
  operations: "负责增长动作、投放节奏和运营响应。",
  hr: "负责招聘推进、候选人协同和组织动作。",
  procurement: "负责报价、供应商沟通和采购节奏。",
  ceo_office: "负责跨团队编排和关键节点对齐。",
};

const roleIcons: Record<AgentRole, LucideIcon> = {
  product: SparklesIcon,
  engineering: CpuIcon,
  operations: RadarIcon,
  hr: UsersIcon,
  procurement: BotIcon,
  ceo_office: BriefcaseBusinessIcon,
};

const agentStatusOrder: Record<
  OfficeSnapshot["agents"][number]["status"],
  number
> = {
  executing: 0,
  planning: 1,
  waiting_handoff: 2,
  waiting_approval: 3,
  waiting_device: 4,
  idle: 5,
  blocked: 6,
  error: 7,
};

const taskStatusOrder: Record<TaskStatus, number> = {
  in_progress: 0,
  assigned: 1,
  queued: 2,
  created: 3,
  pending_approval: 4,
  handed_off: 5,
  completed: 6,
  failed: 7,
  canceled: 8,
};

const eventTone = {
  info: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
} as const;

const panelClass =
  "overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/88 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl";
const panelShellClass = `${panelClass} xl:flex xl:min-h-0 xl:flex-col`;

function engineTone(engine: DockerRunnerEngine | null | undefined) {
  if (engine === "hermes-agent") {
    return {
      badge: "bg-sky-50 text-sky-700",
      panel:
        "border-sky-100 bg-[linear-gradient(135deg,rgba(240,249,255,0.96),rgba(255,255,255,0.98))]",
      hero: "border-sky-200 bg-[#0f172a] text-slate-50",
    };
  }

  return {
    badge: "bg-emerald-50 text-emerald-700",
    panel:
      "border-emerald-100 bg-[linear-gradient(135deg,rgba(240,253,250,0.96),rgba(255,255,255,0.98))]",
    hero: "border-emerald-200 bg-[#111827] text-slate-50",
  };
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
      <span className="text-[11px] font-medium tracking-[0.28em] text-slate-500 uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] tracking-[0.32em] text-slate-500 uppercase">
        {eyebrow}
      </p>
      <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
        {title}
      </h2>
      <p className="max-w-2xl text-sm leading-6 text-slate-500">
        {description}
      </p>
    </div>
  );
}

function EmptyBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-6">
      <p className="text-sm font-medium text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function initialsFromName(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "AI";
}

function formatGeneratedAt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function surfaceClassForEngine(
  engine: DockerRunnerEngine | null | undefined,
  highlighted = false,
) {
  if (engine === "hermes-agent") {
    return highlighted
      ? "border-[#6d91d4]/30 bg-[linear-gradient(135deg,rgba(233,241,255,0.94),rgba(250,252,255,0.98))] shadow-[0_24px_60px_rgba(80,112,166,0.14)]"
      : "border-[#d7e2f6] bg-[linear-gradient(135deg,rgba(244,248,255,0.95),rgba(255,255,255,0.98))]";
  }

  return highlighted
    ? "border-[#e7b86a]/40 bg-[linear-gradient(135deg,rgba(255,244,224,0.95),rgba(255,250,242,0.98))] shadow-[0_24px_60px_rgba(186,124,27,0.14)]"
    : "border-[#eedfc7] bg-[linear-gradient(135deg,rgba(255,248,236,0.94),rgba(255,255,255,0.98))]";
}

function toneClassForTaskStatus(status: TaskStatus) {
  switch (status) {
    case "in_progress":
      return "bg-[#edf9f3] text-[#0f6a3c]";
    case "assigned":
    case "queued":
    case "created":
      return "bg-[#f7f1df] text-[#8b5b10]";
    case "pending_approval":
      return "bg-[#fff1e2] text-[#b06200]";
    case "handed_off":
      return "bg-[#eef4ff] text-[#3458a4]";
    case "completed":
      return "bg-[#f1f5f9] text-[#334155]";
    case "failed":
    case "canceled":
      return "bg-[#fff1f2] text-[#b42318]";
    default:
      return "bg-[#f5f5f4] text-[#44403c]";
  }
}

export function OfficeShell({ snapshot }: Props) {
  const utils = api.useUtils();
  const lastVersionRef = useRef<string | null>(null);
  const [streamState, setStreamState] = useState<"live" | "reconnecting">(
    "reconnecting",
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const deferredSearch = useDeferredValue(searchValue);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(
    snapshot.agents[0]?.id ?? null,
  );
  const [agentDraft, setAgentDraft] = useState({
    name: "",
    role: "engineering" as AgentRole,
    engine: "openclaw" as DockerRunnerEngine,
  });
  const [taskDraft, setTaskDraft] = useState({
    title: "",
    summary: "",
    ownerAgentId: snapshot.agents[0]?.id ?? "",
    taskType: "feature" as (typeof taskTypeValues)[number],
    priority: "medium" as keyof typeof priorityLabels,
    riskLevel: "medium" as keyof typeof riskLevelLabels,
  });

  const snapshotQuery = api.office.getSnapshot.useQuery(undefined, {
    initialData: snapshot,
    refetchOnWindowFocus: false,
  });

  const liveSnapshot = snapshotQuery.data ?? snapshot;
  const isReadOnlyFallback = liveSnapshot.mode === "fallback";
  const generatedAt = formatGeneratedAt(liveSnapshot.generatedAt);
  const normalizedSearch = deferredSearch.trim().toLowerCase();

  useEffect(() => {
    if (
      !liveSnapshot.agents.some((agent) => agent.id === taskDraft.ownerAgentId)
    ) {
      setTaskDraft((current) => ({
        ...current,
        ownerAgentId: liveSnapshot.agents[0]?.id ?? "",
      }));
    }
  }, [liveSnapshot.agents, taskDraft.ownerAgentId]);

  useEffect(() => {
    if (
      highlightedAgentId &&
      liveSnapshot.agents.some((agent) => agent.id === highlightedAgentId)
    ) {
      return;
    }

    setHighlightedAgentId(liveSnapshot.agents[0]?.id ?? null);
  }, [highlightedAgentId, liveSnapshot.agents]);

  useEffect(() => {
    if (!feedback) return;

    const timeout = window.setTimeout(
      () => {
        setFeedback(null);
      },
      feedback.tone === "error" ? 5200 : 3200,
    );

    return () => window.clearTimeout(timeout);
  }, [feedback]);

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
    eventSource.onerror = () => setStreamState("reconnecting");

    return () => {
      eventSource.close();
    };
  }, [utils.office.getSnapshot]);

  const pushFeedback = (
    message: string,
    tone: FeedbackState["tone"] = "success",
  ) => {
    setFeedback({ message, tone });
  };

  const createAgent = api.office.createAgent.useMutation({
    onSuccess: (result) => {
      pushFeedback(result.message);
      setAgentDraft({
        name: "",
        role: "engineering",
        engine: "openclaw",
      });
      startTransition(() => {
        setHighlightedAgentId(result.agentId);
        setTaskDraft((current) => ({
          ...current,
          ownerAgentId: result.agentId,
        }));
      });
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });

  const createTask = api.office.createTask.useMutation({
    onSuccess: () => {
      pushFeedback("任务已下发，人物工作台会持续刷新执行状态。");
      setTaskDraft((current) => ({
        ...current,
        title: "",
        summary: "",
      }));
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => pushFeedback(error.message, "error"),
  });
  const getNativeDashboardUrl = api.office.getNativeDashboardUrl.useMutation();

  const agents = [...liveSnapshot.agents]
    .sort((left, right) => {
      const statusDelta =
        agentStatusOrder[left.status] - agentStatusOrder[right.status];
      if (statusDelta !== 0) return statusDelta;
      return left.name.localeCompare(right.name, "zh-CN");
    })
    .filter((agent) => {
      if (!normalizedSearch) return true;

      return [
        agent.name,
        roleLabels[agent.role],
        k8sWorkspaceEngineLabels[agent.engine ?? "openclaw"],
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });

  const taskCountByAgentId = new Map<string, number>();
  for (const task of liveSnapshot.tasks) {
    if (!task.ownerAgentId) continue;
    taskCountByAgentId.set(
      task.ownerAgentId,
      (taskCountByAgentId.get(task.ownerAgentId) ?? 0) + 1,
    );
  }

  const tasks = [...liveSnapshot.tasks].sort((left, right) => {
    const statusDelta =
      taskStatusOrder[left.status] - taskStatusOrder[right.status];
    if (statusDelta !== 0) return statusDelta;
    return left.title.localeCompare(right.title, "zh-CN");
  });

  const openclawCount = liveSnapshot.agents.filter(
    (agent) => agent.engine !== "hermes-agent",
  ).length;
  const hermesCount = liveSnapshot.agents.filter(
    (agent) => agent.engine === "hermes-agent",
  ).length;
  const activeTaskCount = liveSnapshot.tasks.filter((task) =>
    [
      "created",
      "queued",
      "assigned",
      "in_progress",
      "pending_approval",
    ].includes(task.status),
  ).length;
  const highlightedAgent =
    liveSnapshot.agents.find((agent) => agent.id === highlightedAgentId) ??
    null;
  const highlightedDevice = highlightedAgent
    ? (liveSnapshot.devices.find(
        (device) => device.id === highlightedAgent.deviceId,
      ) ?? null)
    : null;
  const highlightedTasks = highlightedAgent
    ? tasks.filter((task) => task.ownerAgentId === highlightedAgent.id)
    : [];
  const highlightedApprovals = highlightedAgent
    ? liveSnapshot.approvals.filter(
        (approval) => approval.requestedByAgentId === highlightedAgent.id,
      )
    : [];
  const highlightedReports = highlightedAgent
    ? liveSnapshot.executionReports.filter(
        (report) => report.agentId === highlightedAgent.id,
      )
    : [];
  const highlightedRoleIcon = highlightedAgent
    ? roleIcons[highlightedAgent.role]
    : null;
  const HighlightedRoleIcon = highlightedRoleIcon;
  const highlightedTone = engineTone(highlightedAgent?.engine);
  const openNativePage = async (
    agent: OfficeSnapshot["agents"][number],
  ) => {
    setHighlightedAgentId(agent.id);

    if (typeof window === "undefined") return;

    const openedWindow = window.open("about:blank", "_blank");

    if (!openedWindow) {
      pushFeedback("浏览器阻止了新窗口，请允许弹窗后重试。", "error");
      return;
    }

    const linkedDevice =
      liveSnapshot.devices.find((device) => device.id === agent.deviceId) ??
      null;
    let nativeUrl = linkedDevice?.nativeDashboardUrl ?? null;

    try {
      const refreshed = await getNativeDashboardUrl.mutateAsync({
        agentId: agent.id,
      });
      nativeUrl = refreshed.url ?? nativeUrl;
    } catch {
      nativeUrl = nativeUrl ?? null;
    }

    if (!nativeUrl) {
      openedWindow.close();
      pushFeedback(
        `${k8sWorkspaceEngineLabels[agent.engine ?? "openclaw"]} 原生页面地址未配置。`,
        "error",
      );
      return;
    }

    openedWindow.location.replace(nativeUrl);
  };

  return (
    <AdminChrome>
      <div className="flex min-h-full flex-col gap-4 xl:h-full xl:min-h-0 xl:overflow-hidden">
        <ProductAreaHeader />

        <section className="relative shrink-0 overflow-hidden rounded-[32px] border border-slate-900/80 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(23,32,51,0.96))] text-slate-50 shadow-[0_36px_110px_rgba(15,23,42,0.16)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(96,165,250,0.22),transparent_20%),radial-gradient(circle_at_86%_16%,rgba(14,165,233,0.16),transparent_18%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />
          <div className="relative grid gap-6 px-5 py-5 md:px-6 md:py-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="bg-white/10 text-white hover:bg-white/10">
                  Agent Control Plane
                </Badge>
                <Badge
                  className={cn(
                    "border-0",
                    streamState === "live"
                      ? "bg-emerald-400/14 text-emerald-100"
                      : "bg-amber-300/14 text-amber-100",
                  )}
                >
                  {streamState === "live" ? "实时同步中" : "正在重连"}
                </Badge>
                {snapshotQuery.isFetching ? (
                  <Badge className="bg-white/10 text-white hover:bg-white/10">
                    <LoaderCircleIcon className="animate-spin" />
                    刷新快照
                  </Badge>
                ) : null}
              </div>

              <div className="max-w-4xl space-y-3">
                <p className="text-[11px] tracking-[0.34em] text-white/52 uppercase">
                  Cola Operations
                </p>
                <h1 className="max-w-4xl text-3xl font-semibold tracking-[-0.06em] md:text-5xl xl:text-[3.35rem]">
                  多智能体指挥中心
                </h1>
                <p className="max-w-3xl text-sm leading-7 text-white/72 md:text-base">
                  在一个控制面里查看人物、任务、审批和引擎分布。人物卡可以直接打开对应的
                  OpenClaw / Hermes K8s
                  workspace，右侧持续保留系统摘要和执行状态。
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {liveSnapshot.metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-4"
                  >
                    <p className="text-[11px] tracking-[0.26em] text-white/48 uppercase">
                      {metric.label}
                    </p>
                    <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                      {metric.value}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-white/60">
                      {metric.delta}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 self-stretch xl:max-w-[420px]">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                  当前编排
                </p>
                <div className="mt-4 grid gap-4 text-sm text-white/72 sm:grid-cols-3 xl:grid-cols-1">
                  <div>
                    <p className="text-3xl font-semibold tracking-[-0.05em] text-white">
                      {liveSnapshot.agents.length}
                    </p>
                    <p className="mt-1">当前人物</p>
                  </div>
                  <div>
                    <p className="text-3xl font-semibold tracking-[-0.05em] text-white">
                      {activeTaskCount}
                    </p>
                    <p className="mt-1">待处理任务</p>
                  </div>
                  <div>
                    <p className="text-3xl font-semibold tracking-[-0.05em] text-white">
                      {liveSnapshot.approvals.length}
                    </p>
                    <p className="mt-1">待审批节点</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 rounded-[28px] border border-white/10 bg-white/8 px-5 py-5 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                    引擎分布
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                    OpenClaw K8s {openclawCount}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    默认执行引擎，按 workspace 方式部署到
                    k8s，适合通用型任务调度与持续轮询。
                  </p>
                </div>
                <div className="border-t border-white/10 pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                  <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                    第二执行面
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                    Hermes K8s {hermesCount}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/60">
                    作为补充运行面接入，人物卡会按实际引擎打开对应的 k8s
                    workspace。
                  </p>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                  刷新时间
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  {generatedAt}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  当前控制台和弹出的工作区共享同一套人物与任务状态。
                </p>
              </div>
            </div>
          </div>
        </section>

        {feedback ? (
          <div
            className={cn(
              "shrink-0 rounded-[22px] border px-4 py-3 text-sm",
              feedback.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900",
            )}
          >
            {feedback.message}
          </div>
        ) : null}

        {isReadOnlyFallback && liveSnapshot.readOnlyReason ? (
          <div className="shrink-0 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            当前处于只读回退模式：{liveSnapshot.readOnlyReason}
          </div>
        ) : null}

        <section className="grid gap-4 xl:min-h-0 xl:flex-[0.94] xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.04fr)_minmax(0,0.94fr)]">
          <div className={panelShellClass}>
            <div className="border-b border-black/6 px-5 py-5">
              <SectionTitle
                eyebrow="Create Agent"
                title="新增人物"
                description="创建人物时直接绑定执行引擎。创建完成后，人物会立即进入下方列表。"
              />
            </div>

            <div className="grid gap-4 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
              <FormField label="人物名称">
                <Input
                  value={agentDraft.name}
                  onChange={(event) =>
                    setAgentDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：Luna、Mika、采购官 Zero"
                />
              </FormField>

              <FormField label="角色">
                <Select
                  value={agentDraft.role}
                  onValueChange={(value) =>
                    setAgentDraft((current) => ({
                      ...current,
                      role: value!,
                    }))
                  }
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="选择角色" />
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
                  onValueChange={(value) =>
                    setAgentDraft((current) => ({
                      ...current,
                      engine: value!,
                    }))
                  }
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="选择执行引擎" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {dockerRunnerEngineValues.map((engine) => (
                        <SelectItem key={engine} value={engine}>
                          {k8sWorkspaceEngineLabels[engine]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>

              <div className="rounded-[22px] bg-[#f7f2ea] px-4 py-4 text-sm leading-6 text-[#6b5a4c]">
                {roleHints[agentDraft.role]}
              </div>

              <Button
                className="h-11 rounded-[18px] bg-[#17120d] text-white hover:bg-[#2a221b]"
                disabled={
                  isReadOnlyFallback ||
                  createAgent.isPending ||
                  agentDraft.name.trim().length < 2
                }
                onClick={() => {
                  if (isReadOnlyFallback) {
                    pushFeedback(
                      "数据库不可用，当前模式下不能创建人物。",
                      "error",
                    );
                    return;
                  }

                  createAgent.mutate(agentDraft);
                }}
              >
                {createAgent.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <UserRoundPlusIcon />
                )}
                {createAgent.isPending
                  ? "正在创建人物..."
                  : "创建人物并拉起 Runner"}
              </Button>
            </div>
          </div>

          <div className={panelShellClass}>
            <div className="border-b border-black/6 px-5 py-5">
              <SectionTitle
                eyebrow="Create Task"
                title="新增任务"
                description="直接把任务派给人物。下面的人物列表和右侧工作台会在当前页同步更新。"
              />
            </div>

            <div className="grid gap-4 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
              <FormField label="负责人">
                <Select
                  value={taskDraft.ownerAgentId}
                  onValueChange={(value) =>
                    setTaskDraft((current) => ({
                      ...current,
                      ownerAgentId: value ?? "",
                    }))
                  }
                  disabled={liveSnapshot.agents.length === 0}
                >
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue
                      placeholder={
                        liveSnapshot.agents.length === 0
                          ? "请先创建人物"
                          : "选择负责人"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {liveSnapshot.agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name} · {roleLabels[agent.role]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="任务标题">
                <Input
                  value={taskDraft.title}
                  onChange={(event) =>
                    setTaskDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="例如：整理 OpenClaw K8s 工作区发布清单"
                />
              </FormField>

              <FormField label="任务摘要">
                <Textarea
                  value={taskDraft.summary}
                  onChange={(event) =>
                    setTaskDraft((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                  placeholder="说明目标、产出和边界。"
                  className="min-h-28 resize-none"
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="任务类型">
                  <Select
                    value={taskDraft.taskType}
                    onValueChange={(value) =>
                      setTaskDraft((current) => ({
                        ...current,
                        taskType: value!,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="任务类型" />
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
                    onValueChange={(value) =>
                      setTaskDraft((current) => ({
                        ...current,
                        priority: value!,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="优先级" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.entries(priorityLabels).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="风险级别">
                  <Select
                    value={taskDraft.riskLevel}
                    onValueChange={(value) =>
                      setTaskDraft((current) => ({
                        ...current,
                        riskLevel: value!,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="风险级别" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.entries(riskLevelLabels).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              <Button
                className="h-11 rounded-[18px] bg-[#17120d] text-white hover:bg-[#2a221b]"
                disabled={
                  isReadOnlyFallback ||
                  createTask.isPending ||
                  liveSnapshot.agents.length === 0 ||
                  taskDraft.title.trim().length < 3 ||
                  taskDraft.summary.trim().length < 8
                }
                onClick={() => {
                  if (isReadOnlyFallback) {
                    pushFeedback(
                      "数据库不可用，当前模式下不能下发任务。",
                      "error",
                    );
                    return;
                  }

                  createTask.mutate(taskDraft);
                }}
              >
                {createTask.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <SendIcon />
                )}
                {createTask.isPending ? "正在下发任务..." : "下发任务"}
              </Button>
            </div>
          </div>

          <div className={panelShellClass}>
            <div className="border-b border-black/6 px-5 py-5">
              <SectionTitle
                eyebrow="System Pulse"
                title="当前运行面"
                description="当前页负责编排与状态，人物卡点击后会新窗口打开对应的 OpenClaw / Hermes K8s workspace。"
              />
            </div>

            <div className="grid gap-5 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    当前焦点
                  </p>
                  <p className="mt-3 text-lg font-semibold tracking-[-0.04em] text-[#17120d]">
                    {highlightedAgent?.name ?? "还没有人物"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                    {highlightedAgent?.focus ??
                      "创建人物后，这里会显示当前焦点。"}
                  </p>
                </div>

                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    最近执行
                  </p>
                  <p className="mt-3 text-lg font-semibold tracking-[-0.04em] text-[#17120d]">
                    {liveSnapshot.executionReports[0]?.title ?? "暂无执行记录"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                    {liveSnapshot.executionReports[0]?.summary ??
                      "一旦 runner 回传会话，这里会显示最新结果。"}
                  </p>
                </div>

                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    最近事件
                  </p>
                  <p className="mt-3 text-lg font-semibold tracking-[-0.04em] text-[#17120d]">
                    {liveSnapshot.events[0]?.title ?? "暂无事件"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                    {liveSnapshot.events[0]?.description ??
                      "系统事件会随着人物和任务变化持续滚动。"}
                  </p>
                </div>
              </div>

              <div className="rounded-[28px] border border-[#ece2d7] bg-[#fffdf9] px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                      待审批任务
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#17120d]">
                      {liveSnapshot.approvals.length}
                    </p>
                  </div>
                  <ActivityIcon className="size-5 text-[#8b735d]" />
                </div>
                <div className="mt-4 space-y-3">
                  {liveSnapshot.approvals.slice(0, 3).map((approval) => (
                    <div
                      key={approval.id}
                      className="rounded-[20px] bg-[#faf6f0] px-4 py-3"
                    >
                      <p className="text-sm font-medium text-[#17120d]">
                        {approval.title}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-[#6f5f52]">
                        {approval.summary}
                      </p>
                    </div>
                  ))}
                  {liveSnapshot.approvals.length === 0 ? (
                    <p className="text-sm leading-6 text-[#6f5f52]">
                      当前没有卡在人工审批的任务节点。
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:min-h-0 xl:flex-[1.18] xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className={cn(panelShellClass)} id="people-list">
            <div className="flex flex-col gap-4 border-b border-black/6 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
              <SectionTitle
                eyebrow="People"
                title="当前所有人物"
                description="点击人物卡片会新开窗口进入对应原生页面，当前页仍保留系统级摘要。"
              />

              <div className="w-full sm:max-w-xs">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#8b735d]" />
                  <Input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="搜索人物、角色或引擎"
                    className="h-11 rounded-[16px] bg-[#fbf8f4] pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
              {agents.length === 0 ? (
                <EmptyBlock
                  title="还没有可展示的人物"
                  description="先创建人物，列表会自动出现，之后可直接打开对应原生页面。"
                />
              ) : (
                agents.map((agent) => {
                  const RoleIcon = roleIcons[agent.role];
                  const device = liveSnapshot.devices.find(
                    (item) => item.id === agent.deviceId,
                  );
                  const isHighlighted = agent.id === highlightedAgentId;

                  return (
                    <button
                      type="button"
                      key={agent.id}
                      aria-pressed={isHighlighted}
                      onClick={() => openNativePage(agent)}
                      onMouseEnter={() => setHighlightedAgentId(agent.id)}
                      onFocus={() => setHighlightedAgentId(agent.id)}
                      className={cn(
                        "group block w-full rounded-[28px] border px-5 py-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(32,24,18,0.12)] focus-visible:ring-2 focus-visible:ring-[#b98a45]/40 focus-visible:outline-none",
                        surfaceClassForEngine(agent.engine, isHighlighted),
                      )}
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-start gap-4">
                            <div className="flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-[#17120d] text-sm font-semibold tracking-[0.12em] text-white">
                              {initialsFromName(agent.name)}
                            </div>
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-xl font-semibold tracking-[-0.04em] text-[#17120d]">
                                  {agent.name}
                                </h3>
                                <Badge
                                  variant="outline"
                                  className="bg-white/70"
                                >
                                  <RoleIcon />
                                  {roleLabels[agent.role]}
                                </Badge>
                                <Badge
                                  className={cn(
                                    "border-0",
                                    agent.engine === "hermes-agent"
                                      ? "bg-[#e7f0ff] text-[#31527f]"
                                      : "bg-[#fff0d7] text-[#8f5e11]",
                                  )}
                                >
                                  {
                                    k8sWorkspaceEngineLabels[
                                      agent.engine ?? "openclaw"
                                    ]
                                  }
                                </Badge>
                              </div>
                              <p className="max-w-3xl text-sm leading-6 text-[#66584b]">
                                {agent.focus}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-[#5f5347]">
                            <span>进入原生页面</span>
                            <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-1" />
                          </div>
                        </div>

                        <div className="grid gap-3 border-t border-black/6 pt-4 text-sm text-[#5f5347] lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,0.75fr))]">
                          <div>
                            <p className="text-[11px] tracking-[0.28em] text-[#8b735d] uppercase">
                              当前状态
                            </p>
                            <p className="mt-2 font-medium text-[#17120d]">
                              {agentStatusLabels[agent.status]}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] tracking-[0.28em] text-[#8b735d] uppercase">
                              当前任务数
                            </p>
                            <p className="mt-2 font-medium text-[#17120d]">
                              {taskCountByAgentId.get(agent.id) ?? 0}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] tracking-[0.28em] text-[#8b735d] uppercase">
                              设备状态
                            </p>
                            <p className="mt-2 font-medium text-[#17120d]">
                              {device?.healthSummary ?? "Runner 还在初始化"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] tracking-[0.28em] text-[#8b735d] uppercase">
                              工作区
                            </p>
                            <p className="mt-2 font-medium text-[#17120d]">
                              {(device?.nativeDashboardUrl ??
                              (agent.engine === "hermes-agent"
                                ? process.env.NEXT_PUBLIC_HERMES_NATIVE_URL
                                : process.env.NEXT_PUBLIC_OPENCLAW_NATIVE_URL))
                                ? "已配置"
                                : "待配置"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:min-h-0 xl:grid-rows-[minmax(0,1.18fr)_minmax(0,0.8fr)_minmax(0,0.9fr)]">
            <div className={panelShellClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <SectionTitle
                  eyebrow="Focused Workspace"
                  title="当前人物摘要"
                  description="点击左侧人物会新开原生页面，当前页右侧保留该人物的任务、设备和执行摘要。"
                />
              </div>

              <div className="grid gap-3 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
                {!highlightedAgent ? (
                  <EmptyBlock
                    title="还没有选中的人物"
                    description="从左侧选择一个人物，右侧会直接展开它的单页面工作台。"
                  />
                ) : (
                  <>
                    <div
                      className={cn(
                        "rounded-[28px] border px-5 py-5",
                        highlightedTone.hero,
                      )}
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-start gap-4">
                          <div className="flex size-16 shrink-0 items-center justify-center rounded-[20px] bg-white/10 text-base font-semibold tracking-[0.12em] text-white">
                            {initialsFromName(highlightedAgent.name)}
                          </div>
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-2xl font-semibold tracking-[-0.05em] text-white">
                                {highlightedAgent.name}
                              </h3>
                              <Badge
                                className={cn(
                                  "border-0",
                                  highlightedTone.badge,
                                )}
                              >
                                {
                                  k8sWorkspaceEngineLabels[
                                    highlightedAgent.engine ?? "openclaw"
                                  ]
                                }
                              </Badge>
                              <Badge className="bg-white/10 text-white hover:bg-white/10">
                                {HighlightedRoleIcon ? (
                                  <HighlightedRoleIcon />
                                ) : null}
                                {roleLabels[highlightedAgent.role]}
                              </Badge>
                            </div>
                            <p className="max-w-3xl text-sm leading-7 text-white/76">
                              {highlightedAgent.focus}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-white/72">
                              <Badge className="bg-white/10 text-white hover:bg-white/10">
                                {agentStatusLabels[highlightedAgent.status]}
                              </Badge>
                              <Badge className="bg-white/10 text-white hover:bg-white/10">
                                {zoneLabels[highlightedAgent.zoneId]}
                              </Badge>
                              <Badge className="bg-white/10 text-white hover:bg-white/10">
                                {highlightedDevice?.name ?? "Runner 初始化中"}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-[360px] lg:grid-cols-1">
                          <div className="rounded-[20px] bg-white/8 px-4 py-3">
                            <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                              任务数
                            </p>
                            <p className="mt-2 text-2xl font-semibold text-white">
                              {highlightedTasks.length}
                            </p>
                          </div>
                          <div className="rounded-[20px] bg-white/8 px-4 py-3">
                            <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                              审批数
                            </p>
                            <p className="mt-2 text-2xl font-semibold text-white">
                              {highlightedApprovals.length}
                            </p>
                          </div>
                          <div className="rounded-[20px] bg-white/8 px-4 py-3">
                            <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                              执行回报
                            </p>
                            <p className="mt-2 text-2xl font-semibold text-white">
                              {highlightedReports.length}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                      <div className="grid gap-4">
                        <div
                          className={cn(
                            "rounded-[24px] border px-4 py-4",
                            highlightedTone.panel,
                          )}
                        >
                          <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                            设备健康
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[#17120d]">
                            {highlightedDevice?.healthSummary ??
                              "Runner 还在初始化"}
                          </p>
                        </div>

                        <div
                          className={cn(
                            "rounded-[24px] border px-4 py-4",
                            highlightedTone.panel,
                          )}
                        >
                          <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                            当前工作台
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[#17120d]">
                            {highlightedAgent.engine === "hermes-agent"
                              ? "Hermes K8s workspace 上下文"
                              : "OpenClaw K8s workspace 上下文"}
                          </p>
                        </div>

                        <div
                          className={cn(
                            "rounded-[24px] border px-4 py-4",
                            highlightedTone.panel,
                          )}
                        >
                          <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                            待审批
                          </p>
                          {highlightedApprovals.length === 0 ? (
                            <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                              当前人物没有挂起的审批。
                            </p>
                          ) : (
                            <div className="mt-3 space-y-3">
                              {highlightedApprovals
                                .slice(0, 3)
                                .map((approval) => (
                                  <div
                                    key={approval.id}
                                    className="rounded-[18px] bg-white/70 px-4 py-3"
                                  >
                                    <p className="text-sm font-medium text-[#17120d]">
                                      {approval.title}
                                    </p>
                                    <p className="mt-1 text-sm leading-6 text-[#6f5f52]">
                                      {approval.summary}
                                    </p>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-4">
                        <div className="rounded-[24px] border border-[#ece2d7] bg-[#fffdf9] px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                              当前任务
                            </p>
                            <span className="text-sm text-[#6f5f52]">
                              {highlightedTasks.length}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-3">
                            {highlightedTasks.length === 0 ? (
                              <p className="text-sm leading-6 text-[#6f5f52]">
                                当前人物还没有任务。
                              </p>
                            ) : (
                              highlightedTasks.slice(0, 4).map((task) => (
                                <div
                                  key={task.id}
                                  className="rounded-[20px] bg-[#faf7f2] px-4 py-4"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span
                                      className={cn(
                                        "rounded-full px-2.5 py-1 text-xs font-medium",
                                        toneClassForTaskStatus(task.status),
                                      )}
                                    >
                                      {taskStatusLabels[task.status]}
                                    </span>
                                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#725e4f]">
                                      {taskTypeLabels[task.type]}
                                    </span>
                                  </div>
                                  <p className="mt-3 text-base font-semibold text-[#17120d]">
                                    {task.title}
                                  </p>
                                  <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                                    {task.summary}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-[#ece2d7] bg-[#fffdf9] px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                              最近执行结果
                            </p>
                            <span className="text-sm text-[#6f5f52]">
                              {highlightedReports.length}
                            </span>
                          </div>

                          <div className="mt-4 grid gap-3">
                            {highlightedReports.length === 0 ? (
                              <p className="text-sm leading-6 text-[#6f5f52]">
                                Runner 还没有为当前人物回传执行结果。
                              </p>
                            ) : (
                              highlightedReports.slice(0, 3).map((report) => (
                                <div
                                  key={report.sessionId}
                                  className="rounded-[20px] bg-[#faf7f2] px-4 py-4"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">
                                      {report.status}
                                    </Badge>
                                    {report.completedAt ? (
                                      <Badge variant="outline">
                                        {report.completedAt}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <p className="mt-3 text-base font-semibold text-[#17120d]">
                                    {report.title}
                                  </p>
                                  <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                                    {report.summary}
                                  </p>
                                  {report.outputText ? (
                                    <pre className="mt-4 overflow-x-auto rounded-[18px] bg-[#17120d] px-4 py-4 text-sm leading-6 whitespace-pre-wrap text-[#f8efe3]">
                                      {report.outputText}
                                    </pre>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className={panelShellClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <SectionTitle
                  eyebrow="Task Board"
                  title="系统任务总览"
                  description="系统内全部任务继续保留在同一页，方便和所选人物工作台一起对照。"
                />
              </div>

              <div className="grid gap-3 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
                {tasks.length === 0 ? (
                  <EmptyBlock
                    title="当前没有任务"
                    description="下发任务后，这里会显示系统级任务队列。"
                  />
                ) : (
                  tasks.slice(0, 8).map((task) => {
                    const owner = liveSnapshot.agents.find(
                      (agent) => agent.id === task.ownerAgentId,
                    );

                    return (
                      <div
                        key={task.id}
                        className="rounded-[24px] border border-[#ece2d7] bg-[#fffdf9] px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-medium",
                              toneClassForTaskStatus(task.status),
                            )}
                          >
                            {taskStatusLabels[task.status]}
                          </span>
                          <span className="rounded-full bg-[#f6f1e8] px-2.5 py-1 text-xs font-medium text-[#725e4f]">
                            {taskTypeLabels[task.type]}
                          </span>
                          <span className="rounded-full bg-[#f6f1e8] px-2.5 py-1 text-xs font-medium text-[#725e4f]">
                            {priorityLabels[task.priority]}
                          </span>
                        </div>
                        <p className="mt-3 text-base font-semibold text-[#17120d]">
                          {task.title}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                          {task.summary}
                        </p>
                        <p className="mt-3 text-sm text-[#6f5f52]">
                          负责人：{owner?.name ?? "未分配"}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className={panelShellClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <SectionTitle
                  eyebrow="Activity"
                  title="系统动态"
                  description="执行回报和系统事件继续保留在首页右侧，整个系统保持单页面显示。"
                />
              </div>

              <div className="grid gap-5 px-5 py-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto scrollbar-none">
                <div className="space-y-3">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    最近执行
                  </p>
                  {liveSnapshot.executionReports.slice(0, 3).map((report) => {
                    const owner = liveSnapshot.agents.find(
                      (agent) => agent.id === report.agentId,
                    );

                    return (
                      <div
                        key={report.sessionId}
                        className="rounded-[24px] bg-[#faf7f2] px-4 py-4"
                      >
                        <p className="text-sm font-medium text-[#17120d]">
                          {report.title}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[#6f5f52]">
                          {report.summary}
                        </p>
                        <p className="mt-3 text-sm text-[#6f5f52]">
                          {owner?.name ?? "未绑定人物"} · {report.status}
                        </p>
                      </div>
                    );
                  })}
                  {liveSnapshot.executionReports.length === 0 ? (
                    <p className="text-sm leading-6 text-[#6f5f52]">
                      还没有 runner 回传执行结果。
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    最近事件
                  </p>
                  {liveSnapshot.events.slice(0, 5).map((event) => (
                    <div
                      key={event.id}
                      className="flex gap-3 rounded-[22px] bg-[#faf7f2] px-4 py-4"
                    >
                      <span
                        className={cn(
                          "mt-1 size-2.5 shrink-0 rounded-full",
                          eventTone[event.severity],
                        )}
                      />
                      <div>
                        <p className="text-sm font-medium text-[#17120d]">
                          {event.title}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[#6f5f52]">
                          {event.description}
                        </p>
                        <p className="mt-2 text-xs tracking-[0.18em] text-[#8b735d] uppercase">
                          {event.at}
                        </p>
                      </div>
                    </div>
                  ))}
                  {liveSnapshot.events.length === 0 ? (
                    <p className="text-sm leading-6 text-[#6f5f52]">
                      当前没有新的系统事件。
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminChrome>
  );
}
