"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  ChevronRightIcon,
  DatabaseIcon,
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
import { CurrentUserBadge } from "./current-user-badge";

const areaIcons = {
  office: Building2Icon,
  workspace: MonitorSmartphoneIcon,
  cmdb: ServerIcon,
  training: BrainCircuitIcon,
  storage: DatabaseIcon,
  deployments: BlocksIcon,
  system: Settings2Icon,
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

type ProductArea = (typeof PRODUCT_AREAS)[number];

const areaChrome = {
  office: {
    label: "Agent Hub",
    tag: "协作",
    signal: "Agent / Task",
    marker: "bg-cyan-300",
    active:
      "border-cyan-200/22 bg-cyan-300/[0.075] shadow-[inset_2px_0_0_rgba(103,232,249,0.92),0_18px_42px_rgba(8,47,73,0.22)]",
    icon: "bg-cyan-300/18 text-cyan-50 ring-cyan-100/22 shadow-[0_0_22px_rgba(103,232,249,0.1)]",
    hover: "hover:border-cyan-200/14 hover:bg-cyan-100/[0.055]",
  },
  workspace: {
    label: "Remote",
    tag: "桌面",
    signal: "Desktop / Node",
    marker: "bg-teal-300",
    active:
      "border-teal-200/22 bg-teal-300/[0.075] shadow-[inset_2px_0_0_rgba(94,234,212,0.92),0_18px_42px_rgba(13,148,136,0.18)]",
    icon: "bg-teal-300/18 text-teal-50 ring-teal-100/22 shadow-[0_0_22px_rgba(94,234,212,0.1)]",
    hover: "hover:border-teal-200/14 hover:bg-teal-100/[0.055]",
  },
  training: {
    label: "GPU Queue",
    tag: "队列",
    signal: "Job / Dataset",
    marker: "bg-violet-300",
    active:
      "border-violet-200/22 bg-violet-300/[0.075] shadow-[inset_2px_0_0_rgba(196,181,253,0.92),0_18px_42px_rgba(76,29,149,0.2)]",
    icon: "bg-violet-300/18 text-violet-50 ring-violet-100/22 shadow-[0_0_22px_rgba(196,181,253,0.1)]",
    hover: "hover:border-violet-200/14 hover:bg-violet-100/[0.055]",
  },
  storage: {
    label: "Storage",
    tag: "对象",
    signal: "SeaweedFS / S3",
    marker: "bg-lime-300",
    active:
      "border-lime-200/22 bg-lime-300/[0.075] shadow-[inset_2px_0_0_rgba(190,242,100,0.92),0_18px_42px_rgba(77,124,15,0.16)]",
    icon: "bg-lime-300/18 text-lime-50 ring-lime-100/22 shadow-[0_0_22px_rgba(190,242,100,0.1)]",
    hover: "hover:border-lime-200/14 hover:bg-lime-100/[0.055]",
  },
  deployments: {
    label: "Serving",
    tag: "服务",
    signal: "Model / Route",
    marker: "bg-amber-300",
    active:
      "border-amber-200/22 bg-amber-300/[0.075] shadow-[inset_2px_0_0_rgba(252,211,77,0.92),0_18px_42px_rgba(146,64,14,0.18)]",
    icon: "bg-amber-300/18 text-amber-50 ring-amber-100/22 shadow-[0_0_22px_rgba(252,211,77,0.1)]",
    hover: "hover:border-amber-200/14 hover:bg-amber-100/[0.055]",
  },
  system: {
    label: "Cluster",
    tag: "K8s",
    signal: "Dashboard / Host",
    marker: "bg-sky-300",
    active:
      "border-sky-200/22 bg-sky-300/[0.075] shadow-[inset_2px_0_0_rgba(125,211,252,0.92),0_18px_42px_rgba(30,64,175,0.18)]",
    icon: "bg-sky-300/18 text-sky-50 ring-sky-100/22 shadow-[0_0_22px_rgba(125,211,252,0.1)]",
    hover: "hover:border-sky-200/14 hover:bg-sky-100/[0.055]",
  },
  cmdb: {
    label: "Assets",
    tag: "资产",
    signal: "Server / GitLab",
    marker: "bg-emerald-300",
    active:
      "border-emerald-200/22 bg-emerald-300/[0.075] shadow-[inset_2px_0_0_rgba(110,231,183,0.92),0_18px_42px_rgba(6,95,70,0.2)]",
    icon: "bg-emerald-300/18 text-emerald-50 ring-emerald-100/22 shadow-[0_0_22px_rgba(110,231,183,0.1)]",
    hover: "hover:border-emerald-200/14 hover:bg-emerald-100/[0.055]",
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
      <div className="mx-auto grid min-h-dvh w-full max-w-[1880px] grid-rows-[auto_minmax(0,1fr)] gap-2 px-2 py-2 md:h-full md:min-h-0 md:grid-cols-[64px_minmax(0,1fr)] md:grid-rows-1 md:gap-2.5 md:px-3 md:py-3 2xl:grid-cols-[360px_minmax(0,1fr)] 2xl:gap-4 2xl:px-5 2xl:py-5">
        <aside className="text-sidebar-foreground relative z-30 min-h-0 min-w-0 overflow-visible rounded-[var(--radius-shell)] border border-white/[0.12] bg-[linear-gradient(180deg,#12202a_0%,#0e1822_48%,#0a1119_100%)] shadow-[0_24px_70px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(125,211,252,0.13),transparent_28%),radial-gradient(circle_at_90%_18%,rgba(52,211,153,0.09),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_36%)]" />
            <div className="control-shell-scan absolute inset-x-0 -top-1/2 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(125,211,252,0.09),transparent)]" />
            <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
            <div className="absolute inset-y-0 left-0 w-px bg-white/18" />
          </div>

          <div className="relative flex h-full min-h-0 flex-col">
            <div className="border-b border-white/[0.08] px-3.5 py-2.5 min-[1700px]:py-5 md:px-2.5 md:py-3 2xl:px-6 2xl:py-4">
              <div className="flex items-center gap-3.5 md:justify-center 2xl:justify-start">
                <div className="relative shrink-0">
                  <span className="absolute -inset-2 rounded-2xl bg-sky-300/10 blur-xl" />
                  <Image
                    src="/xdream-cloud-mark.svg"
                    alt="XDream Cloud"
                    width={48}
                    height={48}
                    priority
                    className="relative size-[42px] rounded-[10px] shadow-[0_10px_24px_rgba(15,23,42,0.3)] ring-1 ring-white/16 2xl:size-[52px] 2xl:rounded-xl"
                  />
                </div>
                <div className="min-w-0 md:hidden 2xl:block">
                  <p className="text-[10px] leading-none font-semibold tracking-[0.32em] text-sky-100/48 uppercase">
                    XDREAM
                  </p>
                  <p className="mt-1.5 truncate text-[18px] leading-none font-semibold text-white">
                    Cloud Console
                  </p>
                  <div className="mt-2.5 flex items-center gap-2 text-[12px] text-slate-300/70">
                    <span
                      className={cn(
                        "size-2 rounded-full shadow-[0_0_0_5px_rgba(52,211,153,0.09)]",
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
              className="flex min-h-0 flex-1 flex-col px-2.5 py-2 min-[1700px]:py-4 md:min-w-0 md:px-2 md:py-2.5 2xl:px-4 2xl:py-3"
            >
              <div className="mb-3.5 hidden items-center justify-between px-1.5 2xl:flex">
                <span className="text-[10px] font-semibold tracking-[0.32em] text-slate-300/54 uppercase">
                  Operations
                </span>
                <span className="rounded-full border border-white/[0.095] bg-white/[0.045] px-3 py-1.5 text-[10px] leading-none font-medium text-slate-200/72">
                  {PRODUCT_AREAS.length} modules
                </span>
              </div>

              <div className="scrollbar-none relative flex gap-1 overflow-x-auto pb-0.5 min-[1700px]:gap-2.5 min-[1700px]:pb-4 md:min-h-0 md:flex-1 md:flex-col md:gap-1.5 md:overflow-visible md:pb-0 2xl:gap-2 2xl:overflow-y-auto 2xl:pr-1.5 2xl:pb-3">
                <span className="pointer-events-none absolute top-5 bottom-8 left-[42px] hidden w-px bg-gradient-to-b from-transparent via-slate-200/13 to-transparent 2xl:block" />
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
          "group relative block overflow-hidden rounded-[var(--radius-card)] border px-2.5 py-2 text-left transition-all duration-200 min-[1700px]:min-h-[94px] min-[1700px]:py-3 md:flex md:min-h-11 md:items-center md:justify-center md:px-2 2xl:min-h-[66px] 2xl:justify-start 2xl:px-4 2xl:py-2",
          active
            ? cn("text-white", chrome.active)
            : cn(
                "border-transparent text-slate-200/68 hover:text-white",
                chrome.hover,
              ),
        )}
      >
        {active ? (
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0.085),transparent_46%)]" />
        ) : null}
        <span
          className={cn(
            "pointer-events-none absolute top-3 bottom-3 left-0 hidden w-0.5 rounded-full min-[1700px]:top-4 min-[1700px]:bottom-4 2xl:block",
            active ? chrome.marker : "bg-white/0 group-hover:bg-white/16",
          )}
        />

        <div className="relative flex w-full items-center gap-2.5 md:justify-center 2xl:justify-start 2xl:gap-3">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] ring-1 transition-all duration-200 min-[1700px]:size-11 2xl:size-9",
              active
                ? chrome.icon
                : "bg-slate-950/16 text-slate-200/70 ring-white/[0.07] group-hover:bg-white/[0.065] group-hover:text-white",
            )}
          >
            <Icon className="size-[15px] min-[1700px]:size-5 2xl:size-4" />
          </span>

          <div className="min-w-0 flex-1 md:hidden 2xl:block">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[15px] leading-5 font-semibold text-slate-100">
                    {area.title}
                  </span>
                  {active ? (
                    <Badge className="hidden shrink-0 border border-white/10 bg-white/[0.115] px-1.5 py-0 text-[10px] leading-4 text-white shadow-none 2xl:inline-flex">
                      当前
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-1.5 flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      chrome.marker,
                    )}
                  />
                  <span className="truncate text-[10px] font-semibold tracking-[0.18em] text-slate-300/58 uppercase">
                    {chrome.label}
                  </span>
                  <span className="text-[10px] text-slate-500/60">/</span>
                  <span className="truncate text-[11px] text-slate-300/64">
                    {chrome.signal}
                  </span>
                </div>
              </div>

              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-none font-medium",
                  active
                    ? "border-white/14 bg-white/[0.105] text-white"
                    : "border-white/8 bg-white/[0.035] text-slate-300/58 group-hover:border-white/10 group-hover:bg-white/[0.055] group-hover:text-slate-200/76",
                )}
              >
                {chrome.tag}
              </span>
            </div>

            <p className="mt-2 hidden overflow-hidden text-[12px] leading-[1.45] text-slate-300/68 min-[1700px]:[display:-webkit-box] min-[1700px]:[-webkit-box-orient:vertical] min-[1700px]:[-webkit-line-clamp:2]">
              {area.description}
            </p>
          </div>

          <div className="absolute top-1/2 right-0 hidden -translate-y-1/2 items-center 2xl:flex">
            <ChevronRightIcon
              className={cn(
                "size-4 transition-all duration-200",
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
