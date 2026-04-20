import Link from "next/link";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";

export default function TrainingPage() {
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(183,216,148,0.24),transparent_24%),linear-gradient(180deg,#f6f8ef_0%,#eef3e6_46%,#e5ebdb_100%)] text-[#1f2616]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 overflow-hidden rounded-[34px] border border-[#dbe5cb] bg-[linear-gradient(135deg,#23301a_0%,#324426_54%,#4f6942_100%)] text-[#f4f8ee] shadow-[0_34px_120px_rgba(64,86,46,0.2)]">
          <div className="grid gap-10 px-6 py-7 md:px-8 md:py-9 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
            <div className="space-y-5">
              <Badge className="border-0 bg-white/10 text-white hover:bg-white/10">
                Training Platform
              </Badge>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.06em] md:text-5xl">
                  训练任务、数据集和实验轨迹需要独立成平台入口。
                </h1>
                <p className="max-w-3xl text-base leading-8 text-white/74">
                  这个区域负责承载 GPU 训练作业、数据准备、checkpoint
                  产物和实验对照。 它不再混在 Virtual Office
                  的任务卡里，而是作为和 workspace 并列的平台层存在。
                </p>
              </div>
            </div>

            <div className="grid gap-4 self-stretch sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  调度面
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  GPU Batch
                </p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-5 py-5">
                <p className="text-[11px] tracking-[0.28em] text-white/48 uppercase">
                  数据面
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.05em] text-white">
                  Dataset Registry
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
            <article className="rounded-[30px] border border-[#d8e4ca] bg-white/88 p-6 shadow-[0_24px_80px_rgba(74,101,54,0.09)]">
              <p className="text-[11px] tracking-[0.3em] text-[#758a57] uppercase">
                Job Queue
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#1f2616]">
                训练任务不再通过 Office 卡片直接承载
              </h2>
              <p className="mt-3 text-sm leading-7 text-[#5e6d4d]">
                训练作业应该有自己的队列、资源配额和重试策略。Office
                只负责发起目标与审批， 真正的训练生命周期在这里展开。
              </p>
            </article>

            <article className="rounded-[30px] border border-[#d8e4ca] bg-white/88 p-6 shadow-[0_24px_80px_rgba(74,101,54,0.09)]">
              <p className="text-[11px] tracking-[0.3em] text-[#758a57] uppercase">
                Data & Artifacts
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#1f2616]">
                数据集、checkpoint 和 LoRA 产物要有独立版本面
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-[22px] bg-[#f3f7ec] px-4 py-4 text-sm leading-6 text-[#5e6d4d]">
                  数据集版本
                </div>
                <div className="rounded-[22px] bg-[#f3f7ec] px-4 py-4 text-sm leading-6 text-[#5e6d4d]">
                  模型基线
                </div>
                <div className="rounded-[22px] bg-[#f3f7ec] px-4 py-4 text-sm leading-6 text-[#5e6d4d]">
                  训练产物库
                </div>
              </div>
            </article>
          </div>

          <aside className="rounded-[30px] border border-[#d8e4ca] bg-white/88 p-6 shadow-[0_24px_80px_rgba(74,101,54,0.09)]">
            <p className="text-[11px] tracking-[0.3em] text-[#758a57] uppercase">
              Platform Note
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#1f2616]">
              建议沿用同一套 K8s 基线
            </h2>
            <div className="mt-5 space-y-4 text-sm leading-7 text-[#5e6d4d]">
              <p>
                训练平台建议复用 workspace
                已经落地的节点、镜像分发和存储挂载能力。
              </p>
              <p>
                这样训练、workspace 和推理部署可以共享 GPU 资源池与访问策略。
              </p>
              <p>当前页先把信息结构和入口留出来，后续再接具体训练作业编排。</p>
            </div>

            <div className="mt-6 grid gap-3">
              <Link
                href="/workspace"
                className="inline-flex items-center justify-center rounded-full border border-[#c9d8b7] bg-[#f3f7ec] px-4 py-3 text-sm font-medium text-[#2b3a1f] transition hover:bg-white"
              >
                查看 Workspace
              </Link>
              <Link
                href="/deployments"
                className="inline-flex items-center justify-center rounded-full border border-[#2b3a1f] bg-[#2b3a1f] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1f2918]"
              >
                前往推理部署平台
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
