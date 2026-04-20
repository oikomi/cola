import { ExternalLinkIcon, Settings2Icon } from "lucide-react";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function SystemPage() {
  const dashboardUrl = env.NEXT_PUBLIC_K8S_DASHBOARD_URL;

  return (
    <div className="min-h-dvh bg-[linear-gradient(180deg,#f4f6f8_0%,#edf1f5_44%,#e5ebf1_100%)] text-[#18202a]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 rounded-[32px] border border-[#d8e0e8] bg-white/90 shadow-[0_24px_90px_rgba(59,87,126,0.1)]">
          <div className="flex flex-col gap-4 border-b border-[#e4ebf1] px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 items-center justify-center rounded-[18px] bg-[#223040] text-white">
                <Settings2Icon className="size-5" />
              </div>
              <div>
                <p className="text-[11px] tracking-[0.3em] text-[#728094] uppercase">
                  System Console
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#18202a]">
                  系统管理
                </h1>
                <p className="mt-2 text-sm leading-6 text-[#5f6d81]">
                  这里承接 Kubernetes Dashboard，用来查看集群、命名空间和工作负载状态。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge
                className={cn(
                  "border-0 hover:bg-inherit",
                  dashboardUrl
                    ? "bg-[#edf4ff] text-[#2f537c]"
                    : "bg-[#fff4e8] text-[#9b5a1a]",
                )}
              >
                {dashboardUrl ? "Dashboard 已配置" : "等待配置"}
              </Badge>
              {dashboardUrl ? (
                <a
                  href={dashboardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "rounded-full border-[#d8e0e8] bg-white px-4 text-[#223040] hover:bg-[#f8fafc]",
                  )}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  新窗口打开
                </a>
              ) : null}
            </div>
          </div>

          <div className="px-5 py-5 md:px-6">
            {dashboardUrl ? (
              <div className="space-y-4">
                <div className="rounded-[22px] border border-[#e4ebf1] bg-[#f7fafc] px-4 py-4 text-sm leading-6 text-[#5f6d81]">
                  当前地址：
                  <span className="ml-2 rounded bg-white px-2 py-1 font-mono text-[13px] text-[#223040]">
                    {dashboardUrl}
                  </span>
                  <p className="mt-2">
                    如果目标服务禁止被 iframe 嵌入，请直接使用右上角的“新窗口打开”。
                  </p>
                </div>

                <div className="overflow-hidden rounded-[28px] border border-[#d8e0e8] bg-[#dfe7ef]">
                  <iframe
                    title="K8s Dashboard"
                    src={dashboardUrl}
                    className="h-[calc(100dvh-260px)] min-h-[720px] w-full bg-white"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-[#d8e0e8] bg-[#f8fafc] px-6 py-12 text-center">
                <p className="text-lg font-semibold tracking-[-0.03em] text-[#18202a]">
                  还没有配置 K8s Dashboard 地址
                </p>
                <p className="mt-2 text-sm leading-6 text-[#5f6d81]">
                  请在环境变量里设置
                  <span className="mx-1 rounded bg-white px-2 py-1 font-mono text-[13px] text-[#223040]">
                    NEXT_PUBLIC_K8S_DASHBOARD_URL
                  </span>
                  ，菜单项会跳到这里并加载对应的 dashboard。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
