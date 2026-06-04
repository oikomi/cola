"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  DatabaseIcon,
  CpuIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  ServerIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  PRODUCT_AREAS,
  productAreaForPath,
  type ProductAreaKey,
} from "@/lib/product-areas";
import { CurrentUserBadge } from "./current-user-badge";

const areaIcons = {
  office: Building2Icon,
  workspace: MonitorSmartphoneIcon,
  isaacStation: CpuIcon,
  cmdb: ServerIcon,
  training: BrainCircuitIcon,
  storage: DatabaseIcon,
  deployments: BlocksIcon,
  system: NetworkIcon,
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

type ProductArea = (typeof PRODUCT_AREAS)[number];

const areaChrome = {
  office: {
    label: "Agent Hub",
    tag: "协作",
    signal: "Agent / Task",
    marker: "bg-cyan-300",
  },
  workspace: {
    label: "Remote",
    tag: "桌面",
    signal: "Desktop / Node",
    marker: "bg-cyan-300",
  },
  isaacStation: {
    label: "Isaac",
    tag: "仿真",
    signal: "Sim / WebRTC",
    marker: "bg-emerald-300",
  },
  training: {
    label: "GPU Queue",
    tag: "队列",
    signal: "Job / Dataset",
    marker: "bg-cyan-300",
  },
  storage: {
    label: "Storage",
    tag: "对象",
    signal: "SeaweedFS / S3",
    marker: "bg-cyan-300",
  },
  deployments: {
    label: "Serving",
    tag: "服务",
    signal: "Model / Route",
    marker: "bg-cyan-300",
  },
  system: {
    label: "Cluster",
    tag: "K8s",
    signal: "Dashboard / Host",
    marker: "bg-cyan-300",
  },
  cmdb: {
    label: "Assets",
    tag: "资产",
    signal: "Server / GitLab",
    marker: "bg-cyan-300",
  },
} satisfies Record<
  ProductAreaKey,
  {
    label: string;
    tag: string;
    signal: string;
    marker: string;
  }
>;

const areaGroupLabels: Partial<Record<ProductAreaKey, string>> = {
  office: "Workspace",
  training: "Platform",
};

const NAV_ACTIVE_MARKER_CLASS = "bg-amber-300";
const NAV_ACTIVE_CLASS =
  "border-amber-200/28 bg-[linear-gradient(90deg,rgba(245,158,11,0.20),rgba(34,211,238,0.075))] text-white shadow-[inset_3px_0_0_rgba(251,191,36,0.96),0_18px_42px_rgba(15,23,42,0.22)]";
const NAV_ACTIVE_ICON_CLASS =
  "bg-amber-300/22 text-amber-50 ring-amber-100/34 shadow-[0_0_24px_rgba(252,211,77,0.14)]";
const NAV_HOVER_CLASS = "hover:border-cyan-100/14 hover:bg-cyan-100/[0.055]";

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);
  const activeAreaMeta =
    PRODUCT_AREAS.find((area) => area.key === activeArea) ?? PRODUCT_AREAS[0]!;
  const activeAreaChrome = areaChrome[activeArea];

  return (
    <div className="text-foreground bg-background min-h-dvh overflow-x-hidden md:h-dvh md:overflow-hidden">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1840px] grid-rows-[auto_minmax(0,1fr)] gap-2 px-2 py-2 md:h-full md:min-h-0 md:grid-cols-[64px_minmax(0,1fr)] md:grid-rows-1 md:gap-2.5 md:px-3 md:py-3 2xl:grid-cols-[228px_minmax(0,1fr)] 2xl:gap-3 2xl:px-4 2xl:py-4">
        <aside className="text-sidebar-foreground relative z-30 min-h-0 min-w-0 overflow-visible rounded-[var(--radius-shell)] border border-white/[0.12] bg-[linear-gradient(180deg,#12202a_0%,#0e1822_48%,#0a1119_100%)] shadow-[0_24px_70px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(125,211,252,0.13),transparent_28%),radial-gradient(circle_at_90%_18%,rgba(52,211,153,0.09),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_36%)]" />
            <div className="control-shell-scan absolute inset-x-0 -top-1/2 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(125,211,252,0.09),transparent)]" />
            <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <div className="absolute inset-y-0 left-0 w-px bg-white/18" />
          </div>

          <div className="relative flex h-full min-h-0 flex-col">
            <div className="border-b border-white/[0.09] px-3.5 py-2.5 md:px-2.5 md:py-3 2xl:px-3.5 2xl:py-3">
              <div className="flex items-center gap-2.5 md:justify-center 2xl:justify-start">
                <div className="relative shrink-0">
                  <span className="absolute -inset-2 rounded-2xl bg-sky-300/10 blur-xl" />
                  <Image
                    src="/xdream-cloud-mark.svg"
                    alt="XDream Cloud"
                    width={48}
                    height={48}
                    priority
                    className="relative size-[42px] rounded-[10px] shadow-[0_10px_24px_rgba(15,23,42,0.3)] ring-1 ring-white/16 2xl:size-11 2xl:rounded-[10px]"
                  />
                </div>
                <div className="min-w-0 md:hidden 2xl:block">
                  <p className="text-[8px] leading-none font-semibold tracking-[0.28em] text-sky-100/58 uppercase">
                    XDREAM
                  </p>
                  <p className="mt-1 truncate text-[16px] leading-5 font-semibold text-white">
                    Cloud Console
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-4 text-slate-300/76">
                    <span
                      className={cn(
                        "size-2 rounded-full shadow-[0_0_0_5px_rgba(34,211,238,0.08)]",
                        activeAreaChrome.marker,
                      )}
                    />
                    <span className="truncate">{activeAreaMeta.title}</span>
                  </div>
                </div>
              </div>
            </div>

            <nav
              aria-label="产品区域导航"
              className="flex min-h-0 flex-1 flex-col px-2.5 py-2 md:min-w-0 md:px-2 md:py-2.5 2xl:px-2.5 2xl:py-2"
            >
              <div className="mb-1.5 hidden items-center gap-2 px-1.5 2xl:flex">
                <span className="text-[8px] font-semibold tracking-[0.26em] text-slate-300/60 uppercase">
                  Operations
                </span>
                <span className="h-px flex-1 bg-white/[0.09]" />
              </div>

              <div className="scrollbar-none relative flex gap-1 overflow-x-auto pb-0.5 md:min-h-0 md:flex-1 md:flex-col md:gap-1 md:overflow-visible md:pb-0 2xl:gap-1 2xl:overflow-y-auto 2xl:pr-1 2xl:pb-2">
                <span className="pointer-events-none absolute top-4 bottom-4 left-[25px] hidden w-px bg-gradient-to-b from-transparent via-slate-200/13 to-transparent 2xl:block" />
                {PRODUCT_AREAS.map((area) => {
                  const active = area.key === activeArea;
                  const groupLabel = areaGroupLabels[area.key];

                  return (
                    <Fragment key={area.key}>
                      {groupLabel ? (
                        <div className="hidden px-2 pt-2 pb-0.5 text-[8px] leading-3 font-semibold tracking-[0.18em] text-slate-400/52 uppercase first:pt-0 2xl:block">
                          {groupLabel}
                        </div>
                      ) : null}
                      <ProductAreaNavItem area={area} active={active} />
                    </Fragment>
                  );
                })}
              </div>
            </nav>

            <CurrentUserBadge />
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
          "group relative block overflow-hidden rounded-[var(--radius-card)] border px-2.5 py-2 text-left transition-all duration-200 md:flex md:min-h-11 md:items-center md:justify-center md:px-2 2xl:min-h-[52px] 2xl:justify-start 2xl:px-2.5 2xl:py-2.5",
          active
            ? NAV_ACTIVE_CLASS
            : cn(
                "border-transparent text-slate-200/68 hover:text-white",
                NAV_HOVER_CLASS,
              ),
        )}
      >
        {active ? (
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0.085),transparent_46%)]" />
        ) : null}
        <span
          className={cn(
            "pointer-events-none absolute top-2 bottom-2 left-0 hidden w-0.5 rounded-full 2xl:block",
            active
              ? NAV_ACTIVE_MARKER_CLASS
              : "bg-white/0 group-hover:bg-white/16",
          )}
        />

        <div className="relative flex w-full items-center gap-2 md:justify-center 2xl:grid 2xl:grid-cols-[2.25rem_minmax(0,1fr)_2.5rem] 2xl:gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] ring-1 transition-all duration-200 2xl:size-9",
              active
                ? NAV_ACTIVE_ICON_CLASS
                : "bg-slate-950/22 text-slate-200/78 ring-white/[0.08] group-hover:bg-cyan-100/[0.065] group-hover:text-white",
            )}
          >
            <Icon className="size-[14px] 2xl:size-[15px]" />
          </span>

          <div className="min-w-0 flex-1 md:hidden 2xl:block">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full shadow-[0_0_0_4px_rgba(34,211,238,0.05)]",
                    active ? NAV_ACTIVE_MARKER_CLASS : chrome.marker,
                  )}
                />
                <span
                  className={cn(
                    "truncate text-[13px] leading-5 transition-colors",
                    active
                      ? "font-semibold text-white"
                      : "font-medium text-slate-100/88 group-hover:text-white",
                  )}
                >
                  {area.title}
                </span>
              </div>
            </div>

            <p className="sr-only">{area.description}</p>
          </div>

          <span
            className={cn(
              "hidden shrink-0 justify-center justify-self-end text-[8px] leading-3 font-medium transition-colors md:hidden 2xl:inline-flex",
              active
                ? "rounded-full border border-amber-100/22 bg-amber-100/[0.12] px-1.5 py-0.5 text-amber-50"
                : "px-1 text-slate-200/82 group-hover:text-slate-100",
            )}
          >
            {chrome.tag}
          </span>
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
            "flex size-7 items-center justify-center rounded-[var(--radius-card)] bg-cyan-100 text-slate-950 ring-1 ring-cyan-200",
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
