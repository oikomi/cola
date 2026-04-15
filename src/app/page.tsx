import { OfficeCommandPanel } from "@/app/_components/office-command-panel";
import {
  agentStatusLabels,
  deviceStatusLabels,
  deviceTypeLabels,
  priorityLabels,
  riskLevelLabels,
  roleLabels,
  taskStatusLabels,
} from "@/server/office/catalog";
import { api } from "@/trpc/server";

const agentStatusStyles = {
  idle: "bg-white/70 text-stone-700",
  planning: "bg-sky-100 text-sky-700",
  waiting_device: "bg-amber-100 text-amber-700",
  executing: "bg-emerald-100 text-emerald-700",
  waiting_handoff: "bg-violet-100 text-violet-700",
  waiting_approval: "bg-orange-100 text-orange-700",
  blocked: "bg-rose-100 text-rose-700",
  error: "bg-red-100 text-red-700",
} as const;

const eventSeverityStyles = {
  info: "border-white/70 bg-white/75",
  warning: "border-amber-200 bg-amber-50/80",
  critical: "border-rose-200 bg-rose-50/80",
} as const;

const deviceStatusStyles = {
  online: "bg-emerald-100 text-emerald-700",
  busy: "bg-sky-100 text-sky-700",
  offline: "bg-stone-200 text-stone-600",
  unhealthy: "bg-rose-100 text-rose-700",
  maintenance: "bg-amber-100 text-amber-700",
} as const;

const zoneStyles = {
  command:
    "from-[#f7efe1] to-[#e6d2b1] border-[#d6b487] shadow-[0_24px_60px_rgba(80,55,36,0.14)]",
  product:
    "from-[#f8ead6] to-[#ecd4b0] border-[#d7b17d] shadow-[0_26px_70px_rgba(108,76,45,0.16)]",
  engineering:
    "from-[#e7efe8] to-[#c0d7c8] border-[#7da18a] shadow-[0_30px_70px_rgba(70,94,78,0.18)]",
  growth:
    "from-[#fff0cf] to-[#ffdc93] border-[#e5ba63] shadow-[0_30px_70px_rgba(138,104,38,0.18)]",
  people:
    "from-[#f2e6ef] to-[#ddc7d9] border-[#b896b0] shadow-[0_28px_70px_rgba(110,77,101,0.16)]",
  vendor:
    "from-[#efe5dc] to-[#ddc7b2] border-[#bc9777] shadow-[0_28px_70px_rgba(116,84,60,0.16)]",
} as const;

export default async function Home() {
  const snapshot = await api.office.getSnapshot();

  return (
    <main className="min-h-screen px-4 py-5 text-stone-900 md:px-6 xl:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
        <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[28px] border border-white/60 bg-white/50 p-5 shadow-[0_24px_80px_rgba(67,42,20,0.08)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.3em] text-stone-500">
                  Experimental / Agent-first org system
                </p>
                <div className="space-y-2">
                  <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-stone-900 md:text-5xl">
                    Cola Virtual Office
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-stone-600 md:text-base">
                    {snapshot.headline}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {snapshot.metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="min-w-32 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-[0_16px_40px_rgba(72,49,30,0.08)]"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-400">
                      {metric.label}
                    </p>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <span className="text-2xl font-semibold text-stone-900">
                        {metric.value}
                      </span>
                      <span className="max-w-24 text-right text-[11px] leading-4 text-stone-500">
                        {metric.delta}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <OfficeCommandPanel
              agents={snapshot.agents}
              tasks={snapshot.tasks}
              approvals={snapshot.approvals}
            />

            <section className="rounded-[28px] border border-white/60 bg-white/60 px-5 py-5 shadow-[0_24px_70px_rgba(67,42,20,0.08)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
                设备资源池
              </p>
              <div className="mt-4 space-y-3">
                {snapshot.devices.map((device) => (
                  <div
                    key={device.id}
                    className="rounded-2xl border border-white/70 bg-white/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-stone-900">{device.name}</p>
                        <p className="text-sm text-stone-500">
                          {deviceTypeLabels[device.type]} / {device.resourcePool}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs ${deviceStatusStyles[device.status]}`}
                      >
                        {deviceStatusLabels[device.status]}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-stone-600">
                      {device.healthSummary}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-[32px] border border-white/65 bg-white/45 p-4 shadow-[0_32px_80px_rgba(67,42,20,0.1)] backdrop-blur md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
                  Spatial control board
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-stone-900">
                  Virtual Office 总览
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-stone-500">
                <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1">
                  角色与设备解耦
                </span>
                <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1">
                  任务驱动编排
                </span>
                <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1">
                  人工可接管
                </span>
              </div>
            </div>

            <div className="relative min-h-[760px] overflow-hidden rounded-[30px] border border-[#d7bd92] bg-[linear-gradient(180deg,#e7cf9d_0%,#d7b77f_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.16)_1px,transparent_1px)] bg-[size:74px_74px] opacity-40" />
              <div className="absolute left-[4%] top-[4%] h-[92%] w-[92%] rounded-[40px] border border-[#c79f6b] bg-[linear-gradient(180deg,#ead7b7_0%,#dec596_100%)] shadow-[inset_0_0_0_18px_rgba(172,118,73,0.28)]" />

              {snapshot.zones.map((zone) => (
                <div
                  key={zone.id}
                  className={`absolute rounded-[34px] border bg-gradient-to-br p-5 backdrop-blur-sm ${zoneStyles[zone.id]}`}
                  style={{
                    left: `${zone.x}%`,
                    top: `${zone.y}%`,
                    width: `${zone.width}%`,
                    height: `${zone.height}%`,
                    transform: `rotate(${zone.id === "engineering" ? "-6deg" : zone.id === "growth" ? "8deg" : zone.id === "vendor" ? "-8deg" : "0deg"})`,
                  }}
                >
                  <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.32),transparent_55%)]" />
                  <div className="relative flex h-full flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                            zone
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-stone-900">
                            {zone.label}
                          </h3>
                        </div>
                        <span className="rounded-full border border-white/80 bg-white/60 px-3 py-1 text-xs text-stone-600">
                          {zone.activeCount} / {zone.headcount} 活跃
                        </span>
                      </div>
                      <p className="mt-3 max-w-xs text-sm leading-6 text-stone-600">
                        {zone.summary}
                      </p>
                    </div>
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-400">
                      {snapshot.tasks.filter((task) => task.zoneId === zone.id).length} tasks
                    </p>
                  </div>
                </div>
              ))}

              {snapshot.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="absolute w-44 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${agent.x}%`, top: `${agent.y}%` }}
                >
                  <div className="absolute left-1/2 top-full h-10 w-24 -translate-x-1/2 rounded-full bg-black/10 blur-xl" />
                  <div className="relative rounded-[22px] border border-white/75 bg-white/86 p-3 shadow-[0_20px_40px_rgba(65,42,24,0.14)] backdrop-blur">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-stone-900">
                          {agent.name}
                        </p>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">
                          {roleLabels[agent.role]}
                        </p>
                      </div>
                      <div className="h-11 w-11 rounded-2xl bg-[linear-gradient(180deg,#23170f_0%,#6f4b35_100%)] p-[2px]">
                        <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#f8e8c7_0%,#f5d8a0_100%)] text-sm font-semibold text-stone-900">
                          {agent.name.slice(0, 1)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium ${agentStatusStyles[agent.status]}`}
                      >
                        {agentStatusLabels[agent.status]}
                      </span>
                      <span className="text-[11px] text-stone-500">
                        能量 {agent.energy}
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-stone-600">
                      {agent.focus}
                    </p>
                  </div>
                </div>
              ))}

              <div className="absolute bottom-4 left-4 right-4 grid gap-3 md:grid-cols-3">
                {snapshot.tasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-white/70 bg-white/82 px-4 py-3 shadow-[0_12px_28px_rgba(67,42,20,0.08)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-stone-900">
                          {task.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          {task.summary}
                        </p>
                      </div>
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-600">
                        {taskStatusLabels[task.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-5">
            <section className="rounded-[28px] border border-white/60 bg-white/55 p-5 shadow-[0_24px_70px_rgba(67,42,20,0.08)] backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
                    Task board
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-stone-900">
                    当前任务流
                  </h2>
                </div>
                <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs text-stone-500">
                  {snapshot.tasks.length} 项
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {snapshot.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-2xl border border-white/70 bg-white/80 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-stone-900 px-3 py-1 text-[11px] text-white">
                        {priorityLabels[task.priority]}
                      </span>
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-600">
                        {riskLevelLabels[task.riskLevel]}
                      </span>
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-[11px] text-stone-600">
                        {taskStatusLabels[task.status]}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium text-stone-900">
                      {task.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      {task.summary}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/60 bg-white/55 p-5 shadow-[0_24px_70px_rgba(67,42,20,0.08)] backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
                    Event stream
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-stone-900">
                    实时事件
                  </h2>
                </div>
                <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs text-stone-500">
                  {snapshot.events.length} 条
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {snapshot.events.map((event) => (
                  <div
                    key={event.id}
                    className={`rounded-2xl border p-4 ${eventSeverityStyles[event.severity]}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-stone-900">
                          {event.title}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          {event.description}
                        </p>
                      </div>
                      <span className="whitespace-nowrap text-xs text-stone-400">
                        {event.at}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
