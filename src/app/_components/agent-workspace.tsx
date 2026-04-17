"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CpuIcon,
  LoaderCircleIcon,
  RadarIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import {
  agentStatusLabels,
  dockerRunnerEngineLabels,
  roleLabels,
  taskStatusLabels,
  zoneLabels,
  type AgentRole,
  type DockerRunnerEngine,
  type TaskStatus,
} from "@/server/office/catalog";
import type { OfficeSnapshot } from "@/server/office/types";

type Props = {
  snapshot: OfficeSnapshot;
  agentId: string;
  engine: DockerRunnerEngine;
};

const panelClass =
  "overflow-hidden rounded-[30px] border border-black/8 bg-white/80 shadow-[0_24px_80px_rgba(24,19,14,0.1)] backdrop-blur-xl";

const roleIcons = {
  product: SparklesIcon,
  engineering: CpuIcon,
  operations: RadarIcon,
  hr: UsersIcon,
  procurement: BotIcon,
  ceo_office: BriefcaseBusinessIcon,
} satisfies Record<AgentRole, typeof SparklesIcon>;

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

function statusTone(status: TaskStatus) {
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

function formatGeneratedAt(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initialsFromName(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "AI";
}

export function AgentWorkspace({ snapshot, agentId, engine }: Props) {
  const utils = api.useUtils();
  const lastVersionRef = useRef<string | null>(null);
  const [streamState, setStreamState] = useState<"live" | "reconnecting">(
    "reconnecting",
  );

  const snapshotQuery = api.office.getSnapshot.useQuery(undefined, {
    initialData: snapshot,
    refetchOnWindowFocus: false,
  });

  const liveSnapshot = snapshotQuery.data ?? snapshot;
  const agent = liveSnapshot.agents.find((item) => item.id === agentId) ?? null;
  const device = liveSnapshot.devices.find((item) => item.id === agent?.deviceId) ?? null;
  const tasks = liveSnapshot.tasks
    .filter((task) => task.ownerAgentId === agentId)
    .sort((left, right) => taskStatusOrder[left.status] - taskStatusOrder[right.status]);
  const approvals = liveSnapshot.approvals.filter(
    (approval) => approval.requestedByAgentId === agentId,
  );
  const reports = liveSnapshot.executionReports.filter(
    (report) => report.agentId === agentId,
  );
  const generatedAt = formatGeneratedAt(liveSnapshot.generatedAt);

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

    return () => eventSource.close();
  }, [utils.office.getSnapshot]);

  if (!agent) {
    return (
      <div className="min-h-dvh bg-[#f5f1e9] px-4 py-8 text-[#17120d] md:px-8">
        <main className="mx-auto max-w-4xl rounded-[32px] border border-black/8 bg-white/82 px-6 py-8 shadow-[0_24px_80px_rgba(24,19,14,0.1)]">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[#6f5f52] transition-colors hover:text-[#17120d]"
          >
            <ArrowLeftIcon className="size-4" />
            返回首页
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-[-0.05em] text-[#17120d]">
            人物不存在
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#6f5f52]">
            当前人物可能已被删除或快照尚未同步完成。
          </p>
        </main>
      </div>
    );
  }

  const RoleIcon = roleIcons[agent.role];
  const theme =
    engine === "hermes-agent"
      ? {
          page:
            "bg-[radial-gradient(circle_at_top_left,rgba(149,179,231,0.24),transparent_28%),linear-gradient(180deg,#f4f7fc_0%,#eef3fb_45%,#e7edf8_100%)]",
          hero: "bg-[#111827] text-[#eff6ff]",
          badge: "bg-[#dbeafe] text-[#1d4ed8]",
          summary: "Hermes Agent 运行页",
          description:
            "当前人物绑定 Hermes Agent。这里集中展示设备、任务和最近执行结果。",
        }
      : {
          page:
            "bg-[radial-gradient(circle_at_top_left,rgba(255,206,138,0.26),transparent_28%),linear-gradient(180deg,#f9f5ef_0%,#f5efe6_45%,#ede2d4_100%)]",
          hero: "bg-[#1f170f] text-[#fff7ed]",
          badge: "bg-[#ffedd5] text-[#c2410c]",
          summary: "OpenClaw 运行页",
          description:
            "当前人物绑定 OpenClaw。这里集中展示设备、任务和最近执行结果。",
        };

  return (
    <div
      className={cn(
        "min-h-dvh text-[#17120d] xl:h-dvh xl:overflow-hidden",
        theme.page,
      )}
    >
      <main className="mx-auto flex max-w-[1460px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8 xl:h-full xl:overflow-y-auto xl:[scrollbar-width:none] xl:[&::-webkit-scrollbar]:hidden">
        <section
          className={cn(
            "relative overflow-hidden rounded-[36px] shadow-[0_36px_120px_rgba(23,18,13,0.18)]",
            theme.hero,
          )}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.1),transparent_18%),radial-gradient(circle_at_84%_14%,rgba(255,255,255,0.08),transparent_16%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0))]" />
          <div className="relative grid gap-10 px-6 py-7 md:px-8 md:py-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
            <div className="space-y-6">
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-sm text-white/72 transition-colors hover:text-white"
              >
                <ArrowLeftIcon className="size-4" />
                返回人物总览
              </Link>

              <div className="flex flex-wrap items-center gap-3">
                <Badge className="bg-white/10 text-white hover:bg-white/10">
                  {theme.summary}
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

              <div className="flex flex-col gap-5 md:flex-row md:items-center">
                <div className="flex size-20 items-center justify-center rounded-[24px] bg-white/10 text-xl font-semibold tracking-[0.12em] text-white">
                  {initialsFromName(agent.name)}
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-4xl font-semibold tracking-[-0.06em] md:text-5xl">
                      {agent.name}
                    </h1>
                    <Badge className={cn("border-0", theme.badge)}>
                      {dockerRunnerEngineLabels[engine]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-white/72">
                    <Badge className="bg-white/10 text-white hover:bg-white/10">
                      <RoleIcon />
                      {roleLabels[agent.role]}
                    </Badge>
                    <Badge className="bg-white/10 text-white hover:bg-white/10">
                      {agentStatusLabels[agent.status]}
                    </Badge>
                    <Badge className="bg-white/10 text-white hover:bg-white/10">
                      {zoneLabels[agent.zoneId]}
                    </Badge>
                  </div>
                  <p className="max-w-3xl text-base leading-8 text-white/72">
                    {theme.description}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 self-stretch">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                  当前焦点
                </p>
                <p className="mt-3 text-base leading-7 text-white/82">{agent.focus}</p>
              </div>

              <div className="grid gap-4 rounded-[28px] border border-white/10 bg-white/8 px-5 py-5 sm:grid-cols-3 xl:grid-cols-1">
                <div>
                  <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                    任务数
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-white">
                    {tasks.length}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                    审批数
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-white">
                    {approvals.length}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                    执行回报
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-white">
                    {reports.length}
                  </p>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/46 uppercase">
                  更新时间
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  {generatedAt}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <div className="grid gap-6">
            <div className={panelClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <p className="text-[11px] tracking-[0.32em] text-[#7d6858] uppercase">
                  Persona Summary
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#17120d]">
                  人物与设备
                </h2>
              </div>

              <div className="grid gap-4 px-5 py-5 text-sm leading-6 text-[#6f5f52]">
                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    角色
                  </p>
                  <p className="mt-2 font-medium text-[#17120d]">
                    {roleLabels[agent.role]}
                  </p>
                </div>
                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    设备健康
                  </p>
                  <p className="mt-2 font-medium text-[#17120d]">
                    {device?.healthSummary ?? "Runner 还在初始化"}
                  </p>
                </div>
                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    当前路由
                  </p>
                  <p className="mt-2 font-medium text-[#17120d]">
                    /{engine === "hermes-agent" ? "hermes" : "openclaw"}/{agent.id}
                  </p>
                </div>
                <div className="rounded-[24px] bg-[#faf7f2] px-4 py-4">
                  <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                    快速返回
                  </p>
                  <Link
                    href="/"
                    className="mt-2 inline-flex items-center gap-2 font-medium text-[#17120d] transition-colors hover:text-[#7d5518]"
                  >
                    回到人物列表
                    <ArrowRightIcon className="size-4" />
                  </Link>
                </div>
              </div>
            </div>

            <div className={panelClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <p className="text-[11px] tracking-[0.32em] text-[#7d6858] uppercase">
                  System Events
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#17120d]">
                  最近动态
                </h2>
              </div>

              <div className="grid gap-3 px-5 py-5">
                {liveSnapshot.events.slice(0, 6).map((event) => (
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

          <div className="grid gap-6">
            <div className={panelClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <p className="text-[11px] tracking-[0.32em] text-[#7d6858] uppercase">
                  Task Queue
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#17120d]">
                  当前任务
                </h2>
              </div>

              <div className="grid gap-3 px-5 py-5">
                {tasks.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-[#d9ccbf] bg-[#fbf8f3] px-5 py-6 text-sm leading-6 text-[#6f5f52]">
                    这个人物当前还没有任务。
                  </div>
                ) : (
                  tasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-[24px] border border-[#ece2d7] bg-[#fffdf9] px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium",
                            statusTone(task.status),
                          )}
                        >
                          {taskStatusLabels[task.status]}
                        </span>
                        <span className="rounded-full bg-[#f6f1e8] px-2.5 py-1 text-xs font-medium text-[#725e4f]">
                          {task.riskLevel}
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

            <div className={panelClass}>
              <div className="border-b border-black/6 px-5 py-5">
                <p className="text-[11px] tracking-[0.32em] text-[#7d6858] uppercase">
                  Execution Reports
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#17120d]">
                  最近执行结果
                </h2>
              </div>

              <div className="grid gap-4 px-5 py-5">
                {reports.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-[#d9ccbf] bg-[#fbf8f3] px-5 py-6 text-sm leading-6 text-[#6f5f52]">
                    Runner 还没有为这个人物回传执行会话。
                  </div>
                ) : (
                  reports.map((report) => (
                    <div
                      key={report.sessionId}
                      className="rounded-[24px] border border-[#ece2d7] bg-[#fffdf9] px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{report.status}</Badge>
                        {report.completedAt ? (
                          <Badge variant="outline">{report.completedAt}</Badge>
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

                      <div className="mt-4 grid gap-3 text-sm text-[#6f5f52]">
                        {report.artifactPath ? (
                          <div className="rounded-[18px] bg-[#faf7f2] px-4 py-3">
                            <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                              Artifact
                            </p>
                            <p className="mt-2 break-all font-mono text-xs text-[#17120d]">
                              {report.artifactPath}
                            </p>
                          </div>
                        ) : null}
                        {report.logPath ? (
                          <div className="rounded-[18px] bg-[#faf7f2] px-4 py-3">
                            <p className="text-[11px] tracking-[0.28em] text-[#7d6858] uppercase">
                              Log
                            </p>
                            <p className="mt-2 break-all font-mono text-xs text-[#17120d]">
                              {report.logPath}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
