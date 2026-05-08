import {
  ActivityIcon,
  ExternalLinkIcon,
  GaugeIcon,
  GpuIcon,
  NetworkIcon,
  ServerIcon,
  ShieldCheckIcon,
} from "lucide-react";

import clusterConfig from "../../../infra/k8s/cluster/config.json";
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

const clusterControllerIp =
  typeof clusterConfig.controllerIp === "string" &&
  clusterConfig.controllerIp.trim().length > 0
    ? clusterConfig.controllerIp.trim()
    : "172.16.60.198";
const DEFAULT_K8S_DASHBOARD_URL = `https://${clusterControllerIp}:8443/`;
const DEFAULT_HAMI_WEBUI_URL = `http://${clusterControllerIp}:3000/`;

function dashboardUrl() {
  return env.NEXT_PUBLIC_K8S_DASHBOARD_URL ?? DEFAULT_K8S_DASHBOARD_URL;
}

function hamiWebUiUrl() {
  return env.NEXT_PUBLIC_HAMI_WEBUI_URL ?? DEFAULT_HAMI_WEBUI_URL;
}

function hostLabel(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return clusterControllerIp;
  }
}

export default function SystemPage() {
  const k8sDashboardUrl = dashboardUrl();
  const k8sDashboardHost = hostLabel(k8sDashboardUrl);
  const hamiUrl = hamiWebUiUrl();
  const hamiHost = hostLabel(hamiUrl);

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Cluster Surface"
        title="集群管理"
        description="在控制台内保留 Kubernetes 入口、连接地址和日常排障提示，外部 Dashboard 会在新标签页打开。"
        icon={NetworkIcon}
        badges={
          <>
            <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
              Dashboard 入口
            </Badge>
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              HAMi-WebUI
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {k8sDashboardHost}
            </Badge>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={k8sDashboardUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ size: "lg" }), "rounded-[12px]")}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              打开 Kubernetes Dashboard
            </a>
            <a
              href={hamiUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "rounded-[12px] border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800",
              )}
            >
              <GaugeIcon data-icon="inline-start" />
              打开 HAMi-WebUI
            </a>
          </div>
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
            label="Dashboard Host"
            value={k8sDashboardHost}
            description="默认指向 Kubernetes Dashboard 外部入口。"
            icon={ServerIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Access"
            value="HTTPS"
            description="如使用自签证书，请在新标签页内确认信任。"
            icon={ShieldCheckIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="HAMi-WebUI"
            value={hamiHost}
            description="默认指向 GPU 监控端口转发入口。"
            icon={GpuIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        title="集群入口"
        description="常用集群管理动作集中在这里，避免从控制台导航时丢失上下文。"
        density="compact"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-3">
            <div className="rounded-[16px] border border-slate-200/90 bg-slate-50/70 px-5 py-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-slate-500">
                    Kubernetes Dashboard URL
                  </p>
                  <p className="mt-1 font-mono text-sm break-all text-slate-800">
                    {k8sDashboardUrl}
                  </p>
                </div>
                <a
                  href={k8sDashboardUrl}
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

            <div className="rounded-[16px] border border-emerald-200/80 bg-emerald-50/50 px-5 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-slate-500">
                  HAMi-WebUI URL
                </p>
                <p className="mt-1 font-mono text-sm break-all text-slate-800">
                  {hamiUrl}
                </p>
              </div>
              <a
                href={hamiUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "rounded-[12px] border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800",
                )}
              >
                <GaugeIcon data-icon="inline-start" />
                新标签页打开
              </a>
            </div>
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
                  当前页面保留在 XDream Cloud 内，Dashboard 和 HAMi-WebUI
                  都只通过明确操作打开。
                </p>
              </div>
            </div>
          </div>
        </div>
      </ModuleSection>
    </ModulePageShell>
  );
}
