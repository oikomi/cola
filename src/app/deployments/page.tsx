import Link from "next/link";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";

export default function DeploymentsPage() {
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(252,187,151,0.2),transparent_24%),linear-gradient(180deg,#fbf4ef_0%,#f4ede8_46%,#ece4dc_100%)] text-[#221814]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 overflow-hidden rounded-[34px] border border-[#ead7cc] bg-[linear-gradient(135deg,#261813_0%,#3d241e_50%,#6f473a_100%)] text-[#fff3ec] shadow-[0_34px_120px_rgba(82,48,36,0.2)]">
          <div className="grid gap-10 px-6 py-7 md:px-8 md:py-9 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
            <div className="space-y-5">
              <Badge className="border-0 bg-white/10 text-white hover:bg-white/10">
                Inference Deploy
              </Badge>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.06em] md:text-5xl">
                  把模型上线、流量切换和回滚从 Office 中单独拉出来。
                </h1>
                <p className="max-w-3xl text-base leading-8 text-white/74">
                  推理部署平台负责 endpoint 目录、版本灰度、容量管理与回滚决策。
                  Office 继续负责协作和审批，而真正的发布面在这里闭环。
                </p>
              </div>
            </div>

            <div className="grid gap-4 self-stretch sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  发布流量
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  Canary / Full
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  观测
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  SLA / Error Budget
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  状态
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  规划中
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
          <div className="grid gap-6">
            <article className="rounded-[30px] border border-[#ead8cd] bg-white/88 p-6 shadow-[0_24px_80px_rgba(92,57,44,0.08)]">
              <p className="text-[11px] tracking-[0.3em] text-[#8f6656] uppercase">
                Endpoint Catalog
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#221814]">
                每个模型服务都应该有清晰的 endpoint 目录
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#6d5549]">
                包括模型版本、推理镜像、GPU 规格、环境变量和访问域名。这样
                Office 的审批流只需引用部署条目，而不再承载全部发布细节。
              </p>
            </article>

            <article className="rounded-[30px] border border-[#ead8cd] bg-white/88 p-6 shadow-[0_24px_80px_rgba(92,57,44,0.08)]">
              <p className="text-[11px] tracking-[0.3em] text-[#8f6656] uppercase">
                Release Lane
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#221814]">
                灰度、放量和回滚都应该成为一等能力
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-[22px] bg-[#f8f1ec] px-4 py-4 text-sm leading-6 text-[#6d5549]">
                  Canary
                </div>
                <div className="rounded-[22px] bg-[#f8f1ec] px-4 py-4 text-sm leading-6 text-[#6d5549]">
                  Weighted Traffic
                </div>
                <div className="rounded-[22px] bg-[#f8f1ec] px-4 py-4 text-sm leading-6 text-[#6d5549]">
                  One-click Rollback
                </div>
              </div>
            </article>
          </div>

          <aside className="rounded-[30px] border border-[#ead8cd] bg-white/88 p-6 shadow-[0_24px_80px_rgba(92,57,44,0.08)]">
            <p className="text-[11px] tracking-[0.3em] text-[#8f6656] uppercase">
              Platform Note
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#221814]">
              与 Office 和训练平台的关系
            </h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-[#6d5549]">
              <p>Office 负责任务编排、审批和人物状态，训练平台负责模型产出。</p>
              <p>
                推理部署平台则负责把产物变成真实的在线服务，并暴露灰度与回滚控制面。
              </p>
              <p>
                这让三条链路边界更清楚，也方便后续分别接入 K8s
                runtime、网关和监控系统。
              </p>
            </div>

            <div className="mt-6 grid gap-3">
              <Link
                href="/training"
                className="inline-flex items-center justify-center rounded-full border border-[#e5cbbd] bg-[#f8f1ec] px-4 py-3 text-sm font-medium text-[#4a2c22] transition hover:bg-white"
              >
                查看训练平台
              </Link>
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full border border-[#4a2c22] bg-[#4a2c22] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#391f18]"
              >
                返回虚拟 Office
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
