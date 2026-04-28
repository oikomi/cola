import {
  ActivityIcon,
  ExternalLinkIcon,
  NetworkIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "lucide-react";

import {
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { env } from "@/env";
import { cn } from "@/lib/utils";

const DEFAULT_K8S_DASHBOARD_URL = "https://192.168.5.22:8443/";

function dashboardUrl() {
  return env.NEXT_PUBLIC_K8S_DASHBOARD_URL ?? DEFAULT_K8S_DASHBOARD_URL;
}

function hostLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return "192.168.5.22:8443";
  }
}

export default function SystemPage() {
  const url = dashboardUrl();
  const host = hostLabel(url);

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Cluster Surface"
        title="集群管理"
        description="在控制台内保留 Kubernetes 入口、连接地址和日常排障提示，外部 Dashboard 会在新标签页打开。"
        icon={NetworkIcon}
        badges={
          <>
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              Master Node
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {host}
            </Badge>
          </>
        }
        actions={
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ size: "lg" }), "rounded-[12px]")}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            打开 Kubernetes Dashboard
          </a>
        }
        size="compact"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <ModuleMetricCard
            size="compact"
            label="Dashboard"
            value="外部入口"
            description="保持当前控制台页面，不再整页跳走。"
            icon={ExternalLinkIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Master"
            value={host}
            description="默认指向项目约定的 K8s master 地址。"
            icon={ServerIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Access"
            value="HTTPS"
            description="如使用自签证书，请在新标签页内确认信任。"
            icon={ShieldCheckIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        title="集群入口"
        description="常用集群管理动作集中在这里，避免从控制台导航时丢失上下文。"
        density="compact"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="rounded-[16px] border border-slate-200/90 bg-slate-50/70 px-5 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-slate-500">
                  Dashboard URL
                </p>
                <p className="mt-1 font-mono text-sm break-all text-slate-800">
                  {url}
                </p>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "rounded-[12px] border-slate-300 bg-white",
                )}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                新标签页打开
              </a>
            </div>
          </div>

          <div className="rounded-[16px] border border-slate-200/90 bg-white px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                <ActivityIcon className="size-4" />
              </div>
              <div>
                <p className="font-semibold text-slate-950">体验修正</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  当前页面保留在 XDream Cloud 内，Dashboard 只通过明确操作打开。
                </p>
              </div>
            </div>
          </div>
        </div>
      </ModuleSection>
    </ModulePageShell>
  );
}
