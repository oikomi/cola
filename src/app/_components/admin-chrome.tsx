"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  ChevronRightIcon,
  MonitorSmartphoneIcon,
  ServerIcon,
  Settings2Icon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PRODUCT_AREAS,
  productAreaForPath,
  type ProductAreaKey,
} from "@/lib/product-areas";

const areaIcons = {
  office: Building2Icon,
  workspace: MonitorSmartphoneIcon,
  cmdb: ServerIcon,
  training: BrainCircuitIcon,
  deployments: BlocksIcon,
  system: Settings2Icon,
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

type ProductArea = (typeof PRODUCT_AREAS)[number];

const areaChrome = {
  office: {
    label: "Agent Hub",
    tag: "当前战场",
    signal: "Agent / Task",
    marker: "bg-cyan-300",
    active:
      "border-cyan-200/24 bg-[linear-gradient(135deg,rgba(14,165,233,0.24),rgba(255,255,255,0.09)_42%,rgba(16,185,129,0.13))] shadow-[inset_3px_0_0_rgba(103,232,249,0.95),0_14px_30px_rgba(8,47,73,0.22)]",
    icon: "bg-cyan-100/18 text-cyan-50 ring-cyan-100/24",
    hover: "hover:border-cyan-200/16 hover:bg-cyan-100/[0.07]",
  },
  workspace: {
    label: "Remote",
    tag: "入口",
    signal: "Desktop / Node",
    marker: "bg-teal-300",
    active:
      "border-teal-200/24 bg-[linear-gradient(135deg,rgba(20,184,166,0.22),rgba(255,255,255,0.09)_44%,rgba(59,130,246,0.13))] shadow-[inset_3px_0_0_rgba(94,234,212,0.95),0_14px_30px_rgba(13,148,136,0.16)]",
    icon: "bg-teal-100/18 text-teal-50 ring-teal-100/24",
    hover: "hover:border-teal-200/16 hover:bg-teal-100/[0.07]",
  },
  training: {
    label: "GPU Queue",
    tag: "训练",
    signal: "Job / Dataset",
    marker: "bg-violet-300",
    active:
      "border-violet-200/24 bg-[linear-gradient(135deg,rgba(139,92,246,0.21),rgba(255,255,255,0.09)_45%,rgba(20,184,166,0.11))] shadow-[inset_3px_0_0_rgba(196,181,253,0.95),0_14px_30px_rgba(76,29,149,0.18)]",
    icon: "bg-violet-100/18 text-violet-50 ring-violet-100/24",
    hover: "hover:border-violet-200/16 hover:bg-violet-100/[0.07]",
  },
  deployments: {
    label: "Serving",
    tag: "模型服务",
    signal: "Model / Route",
    marker: "bg-amber-300",
    active:
      "border-amber-200/24 bg-[linear-gradient(135deg,rgba(245,158,11,0.2),rgba(255,255,255,0.09)_44%,rgba(14,165,233,0.11))] shadow-[inset_3px_0_0_rgba(252,211,77,0.95),0_14px_30px_rgba(146,64,14,0.16)]",
    icon: "bg-amber-100/18 text-amber-50 ring-amber-100/24",
    hover: "hover:border-amber-200/16 hover:bg-amber-100/[0.07]",
  },
  system: {
    label: "Cluster",
    tag: "K8s",
    signal: "Dashboard / Host",
    marker: "bg-sky-300",
    active:
      "border-sky-200/24 bg-[linear-gradient(135deg,rgba(59,130,246,0.22),rgba(255,255,255,0.09)_45%,rgba(16,185,129,0.11))] shadow-[inset_3px_0_0_rgba(125,211,252,0.95),0_14px_30px_rgba(30,64,175,0.16)]",
    icon: "bg-sky-100/18 text-sky-50 ring-sky-100/24",
    hover: "hover:border-sky-200/16 hover:bg-sky-100/[0.07]",
  },
  cmdb: {
    label: "Assets",
    tag: "资产",
    signal: "Server / GitLab",
    marker: "bg-emerald-300",
    active:
      "border-emerald-200/24 bg-[linear-gradient(135deg,rgba(16,185,129,0.21),rgba(255,255,255,0.09)_44%,rgba(245,158,11,0.11))] shadow-[inset_3px_0_0_rgba(110,231,183,0.95),0_14px_30px_rgba(6,95,70,0.16)]",
    icon: "bg-emerald-100/18 text-emerald-50 ring-emerald-100/24",
    hover: "hover:border-emerald-200/16 hover:bg-emerald-100/[0.07]",
  },
} satisfies Record<
  ProductAreaKey,
  {
    label: string;
    tag: string;
    signal: string;
    marker: string;
    active: string;
    icon: string;
    hover: string;
  }
>;

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);
  const activeAreaMeta =
    PRODUCT_AREAS.find((area) => area.key === activeArea) ?? PRODUCT_AREAS[0]!;
  const activeAreaChrome = areaChrome[activeArea];

  return (
    <div className="text-foreground bg-background min-h-dvh overflow-x-hidden md:h-dvh md:overflow-hidden">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1840px] grid-rows-[auto_minmax(0,1fr)] gap-2 px-2 py-2 md:h-full md:min-h-0 md:grid-cols-[64px_minmax(0,1fr)] md:grid-rows-1 md:gap-2.5 md:px-3 md:py-3 2xl:grid-cols-[272px_minmax(0,1fr)] 2xl:gap-3 2xl:px-5 2xl:py-5">
        <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground relative z-30 min-h-0 min-w-0 overflow-visible rounded-[var(--radius-shell)] border shadow-[0_18px_42px_rgba(15,23,42,0.22)]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(56,189,248,0.12),transparent_28%),linear-gradient(235deg,rgba(16,185,129,0.1),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_38%)]" />
            <div className="control-shell-scan absolute inset-x-0 -top-1/2 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(125,211,252,0.16),transparent)]" />
            <div className="absolute inset-y-0 left-0 w-px bg-white/20" />
          </div>

          <div className="relative flex h-full min-h-0 flex-col">
            <div className="border-b border-white/8 px-3.5 py-2.5 md:px-2.5 md:py-3 2xl:px-4 2xl:py-4">
              <div className="flex items-center gap-3 md:justify-center 2xl:justify-start">
                <div className="relative shrink-0">
                  <Image
                    src="/xdream-cloud-mark.svg"
                    alt="XDream Cloud"
                    width={42}
                    height={42}
                    priority
                    className="relative size-[42px] rounded-[10px] shadow-[0_8px_18px_rgba(15,23,42,0.18)] ring-1 ring-white/12 2xl:size-[44px]"
                  />
                </div>
                <div className="min-w-0 md:hidden 2xl:block">
                  <p className="text-[9px] tracking-[0.28em] text-sky-100/50 uppercase">
                    XDream
                  </p>
                  <p className="mt-0.5 truncate text-[15px] leading-none font-semibold text-white 2xl:text-[16px]">
                    Cloud Console
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-slate-300/72">
                    <span
                      className={cn(
                        "size-1.5 rounded-full shadow-[0_0_0_4px_rgba(52,211,153,0.1)]",
                        activeAreaChrome.marker,
                      )}
                    />
                    <span>{activeAreaMeta.title}</span>
                  </div>
                </div>
              </div>
            </div>

            <nav
              aria-label="产品区域导航"
              className="flex min-h-0 flex-1 flex-col px-2.5 py-2 md:min-w-0 md:px-2 md:py-2.5 2xl:px-3 2xl:py-3.5"
            >
              <div className="mb-2.5 hidden items-center justify-between px-2 2xl:flex">
                <span className="text-[10px] font-medium tracking-[0.28em] text-slate-300/60 uppercase">
                  Operations
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.065] px-2 py-0.5 text-[10px] font-medium text-slate-200/74">
                  {PRODUCT_AREAS.length} modules
                </span>
              </div>

              <div className="scrollbar-none relative flex gap-1 overflow-x-auto pb-0.5 md:min-h-0 md:flex-1 md:flex-col md:gap-1.5 md:overflow-visible md:pb-0 2xl:overflow-y-auto">
                <span className="pointer-events-none absolute top-5 bottom-5 left-[31px] hidden w-px bg-gradient-to-b from-transparent via-cyan-100/12 to-transparent 2xl:block" />
                {PRODUCT_AREAS.map((area) => {
                  const active = area.key === activeArea;

                  return (
                    <ProductAreaNavItem
                      key={area.key}
                      area={area}
                      active={active}
                    />
                  );
                })}
              </div>
            </nav>
          </div>
        </aside>

        <main className="min-h-0 min-w-0">
          <div className="border-border bg-card relative h-full min-h-0 overflow-hidden rounded-[var(--radius-shell)] border shadow-[0_2px_12px_rgba(15,23,42,0.055)]">
            <div className="scrollbar-none relative h-full min-h-0 overflow-y-auto p-3.5 md:p-4 2xl:p-5">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ProductAreaNavItem({
  area,
  active,
}: {
  area: ProductArea;
  active: boolean;
}) {
  const Icon = areaIcons[area.key];
  const chrome = areaChrome[area.key];

  return (
    <div
      className={cn(
        "group/navitem relative min-w-[128px] shrink-0 md:min-w-0",
        active ? "order-first md:order-none" : "order-none",
      )}
    >
      <Link
        href={area.href}
        aria-current={active ? "page" : undefined}
        aria-label={`${area.title}：${area.description}`}
        className={cn(
          "group relative block overflow-hidden rounded-[var(--radius-card)] border px-2.5 py-2 text-left transition-all duration-200 md:flex md:min-h-11 md:items-center md:justify-center md:px-2 2xl:justify-start 2xl:px-3 2xl:py-2.5",
          active
            ? cn("text-white", chrome.active)
            : cn(
                "border-transparent text-slate-200/72 hover:text-white",
                chrome.hover,
              ),
        )}
      >
        {active ? (
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.1),transparent_42%)]" />
        ) : null}
        <span
          className={cn(
            "pointer-events-none absolute top-2 bottom-2 left-0 hidden w-0.5 rounded-full 2xl:block",
            active ? chrome.marker : "bg-white/0 group-hover:bg-white/18",
          )}
        />

        <div className="relative flex w-full items-center gap-2.5 md:justify-center 2xl:justify-start">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] ring-1 transition-all duration-200",
              active
                ? chrome.icon
                : "bg-slate-950/18 text-slate-200/78 ring-white/7 group-hover:bg-white/8 group-hover:text-white",
            )}
          >
            <Icon className="size-[15px]" />
          </span>

          <div className="min-w-0 flex-1 md:hidden 2xl:block">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold">
                {area.title}
              </span>
              {active ? (
                <Badge className="hidden border-0 bg-white/14 px-1.5 py-0 text-[10px] leading-4 text-white shadow-none 2xl:inline-flex">
                  当前
                </Badge>
              ) : null}
            </div>

            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", chrome.marker)}
              />
              <span className="truncate text-[10px] font-medium tracking-[0.12em] text-slate-300/58 uppercase">
                {chrome.label}
              </span>
              <span className="text-[10px] text-slate-400/50">/</span>
              <span className="truncate text-[10.5px] text-slate-300/62">
                {chrome.signal}
              </span>
            </div>

            <p className="mt-1 [display:-webkit-box] hidden overflow-hidden text-[11px] leading-[1.38] text-slate-300/72 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] 2xl:block">
              {area.description}
            </p>
          </div>

          <div className="absolute top-0 right-0 hidden flex-col items-end gap-1 2xl:flex">
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[9.5px] leading-none font-medium",
                active
                  ? "border-white/14 bg-white/12 text-white"
                  : "border-white/0 bg-transparent text-slate-400/0 group-hover:border-white/8 group-hover:bg-white/7 group-hover:text-slate-200/70",
              )}
            >
              {chrome.tag}
            </span>
            <ChevronRightIcon
              className={cn(
                "size-3.5 transition-all duration-200",
                active
                  ? "translate-x-0 text-white/82 opacity-100"
                  : "-translate-x-1 text-slate-300/40 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
              )}
            />
          </div>
        </div>
      </Link>

      <NavTooltip area={area} icon={Icon} />
    </div>
  );
}

function NavTooltip({
  area,
  icon: Icon,
}: {
  area: ProductArea;
  icon: LucideIcon;
}) {
  const chrome = areaChrome[area.key];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-[calc(100%+0.625rem)] z-50 hidden w-60 translate-x-1 -translate-y-1/2 rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-3 py-2 text-slate-900 opacity-0 shadow-[0_14px_32px_rgba(15,23,42,0.12)] ring-1 ring-slate-950/5 transition duration-150 md:block md:group-focus-within/navitem:translate-x-0 md:group-focus-within/navitem:opacity-100 md:group-hover/navitem:translate-x-0 md:group-hover/navitem:opacity-100 2xl:hidden"
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-[var(--radius-card)] text-slate-950 ring-1 ring-slate-200",
            chrome.marker,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] leading-5 font-semibold">
            {area.title}
          </div>
          <div className="truncate text-[11px] text-slate-500">
            {chrome.signal}
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-[12px] leading-5 text-slate-500">
        {area.description}
      </div>
    </div>
  );
}
