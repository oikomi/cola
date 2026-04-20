import Link from "next/link";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";
import { api } from "@/trpc/server";

export default async function WorkspacePage() {
  const snapshot = await api.office.getSnapshot();
  const openclawCount = snapshot.agents.filter(
    (agent) => agent.engine !== "hermes-agent",
  ).length;
  const hermesCount = snapshot.agents.filter(
    (agent) => agent.engine === "hermes-agent",
  ).length;

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(168,201,255,0.24),transparent_24%),linear-gradient(180deg,#f5f8ff_0%,#edf2fc_44%,#e8edf8_100%)] text-[#142033]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 overflow-hidden rounded-[34px] border border-[#dbe5f6] bg-[linear-gradient(135deg,#11203a_0%,#1c3557_54%,#335784_100%)] text-[#eef5ff] shadow-[0_34px_120px_rgba(38,64,105,0.22)]">
          <div className="grid gap-10 px-6 py-7 md:px-8 md:py-9 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-5">
              <Badge className="border-0 bg-white/10 text-white hover:bg-white/10">
                Remote Workspace
              </Badge>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.06em] md:text-5xl">
                  统一管理远程桌面、K8s workspace 和 GPU 会话。
                </h1>
                <p className="max-w-3xl text-base leading-8 text-white/74">
                  这个入口承接 remote workspace 的生命周期、Ingress
                  地址和节点放置。 Virtual Office 里的 OpenClaw / Hermes
                  也会按同样的 workspace 范式接到 k8s
                  工作区，而不是继续作为单独的本地运行面。
                </p>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-white/76">
                <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5">
                  `./scripts/workspace.sh create`
                </span>
                <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5">
                  Deployment + Service + Ingress
                </span>
                <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1.5">
                  GPU / Node Affinity
                </span>
              </div>
            </div>

            <div className="grid gap-4 self-stretch sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  当前工作区入口
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                  {snapshot.agents.length}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/62">
                  当前已有的人物都可以按角色与引擎映射到对应工作区。
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  引擎分布
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  OpenClaw K8s {openclawCount}
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-white">
                  Hermes K8s {hermesCount}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
          <div className="grid gap-6">
            <article className="rounded-[30px] border border-[#d8e2f3] bg-white/88 p-6 shadow-[0_24px_80px_rgba(59,87,126,0.1)]">
              <p className="text-[11px] tracking-[0.3em] text-[#6d82a7] uppercase">
                Lifecycle
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#152133]">
                K8s 生命周期与桌面入口收拢到一处
              </h2>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-[22px] bg-[#f4f7fd] px-4 py-4">
                  <p className="text-sm font-medium text-[#152133]">创建</p>
                  <p className="mt-2 text-sm leading-6 text-[#5b6d89]">
                    使用 `./scripts/workspace.sh create` 生成
                    Deployment、Service、 Secret 和可选 Ingress。
                  </p>
                </div>
                <div className="rounded-[22px] bg-[#f4f7fd] px-4 py-4">
                  <p className="text-sm font-medium text-[#152133]">放置</p>
                  <p className="mt-2 text-sm leading-6 text-[#5b6d89]">
                    依赖 `remote-work/workspace=true` 标签与 Ready
                    节点选择策略，把工作区落到合适节点。
                  </p>
                </div>
                <div className="rounded-[22px] bg-[#f4f7fd] px-4 py-4">
                  <p className="text-sm font-medium text-[#152133]">回收</p>
                  <p className="mt-2 text-sm leading-6 text-[#5b6d89]">
                    使用 `./scripts/workspace.sh delete` 清理 K8s 资源，并可选
                    purge 节点数据。
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-[30px] border border-[#d8e2f3] bg-white/88 p-6 shadow-[0_24px_80px_rgba(59,87,126,0.1)]">
              <p className="text-[11px] tracking-[0.3em] text-[#6d82a7] uppercase">
                Office Binding
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#152133]">
                Virtual Office 的执行面改成 workspace 视角
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#596c87]">
                人物从办公室里被点击后，应该进入对应的 K8s workspace，而不是把
                OpenClaw / Hermes 当作孤立的 runner
                页面。这样编排、远程桌面和部署基线都能复用同一套工作区机制。
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-[22px] bg-[#eef4ff] px-4 py-4">
                  <p className="text-sm font-medium text-[#152133]">
                    OpenClaw Workspace
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#5b6d89]">
                    对应 `/openclaw/[agentId]` 入口，后续对齐到 workspace 的 K8s
                    部署方式。
                  </p>
                </div>
                <div className="rounded-[22px] bg-[#eef4ff] px-4 py-4">
                  <p className="text-sm font-medium text-[#152133]">
                    Hermes Workspace
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#5b6d89]">
                    对应 `/hermes/[agentId]` 入口，沿用同样的 workspace、Ingress
                    与状态同步模型。
                  </p>
                </div>
              </div>
            </article>
          </div>

          <aside className="rounded-[30px] border border-[#d8e2f3] bg-white/88 p-6 shadow-[0_24px_80px_rgba(59,87,126,0.1)]">
            <p className="text-[11px] tracking-[0.3em] text-[#6d82a7] uppercase">
              Baseline
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#152133]">
              当前前端约定
            </h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-[#596c87]">
              <p>
                工作区文件持久化在
                `/var/lib/remote-work/workspaces/&lt;name&gt;/`，
                容器内统一挂载到 `/workspace`。
              </p>
              <p>
                Ingress、公开访问域名和 GPU 节点标签都在 workspace
                生命周期里管理， Office 只保留人物、任务和状态编排。
              </p>
              <p>
                训练平台与推理部署平台后续也会沿用同一套 K8s
                基础设施，而不是各自复制入口。
              </p>
            </div>

            <div className="mt-6 grid gap-3">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full border border-[#c6d5ef] bg-[#eef4ff] px-4 py-3 text-sm font-medium text-[#173255] transition hover:bg-white"
              >
                返回虚拟 Office
              </Link>
              <Link
                href="/control"
                className="inline-flex items-center justify-center rounded-full border border-[#173255] bg-[#173255] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#10233b]"
              >
                打开控制台
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
