"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  ChevronRightIcon,
  CircleDotIcon,
  MonitorSmartphoneIcon,
  NetworkIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from "lucide-react";
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

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);

  return (
    <div className="text-foreground bg-background min-h-dvh overflow-x-hidden md:h-dvh md:overflow-hidden">
      <div className="mx-auto grid min-h-dvh w-full max-w-[1840px] grid-rows-[auto_minmax(0,1fr)] gap-2 px-2 py-2 md:h-full md:min-h-0 md:grid-cols-[64px_minmax(0,1fr)] md:grid-rows-1 md:gap-2.5 md:px-3 md:py-3 2xl:grid-cols-[256px_minmax(0,1fr)] 2xl:gap-3 2xl:px-5 2xl:py-5">
        <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground relative z-30 min-h-0 min-w-0 overflow-visible rounded-[var(--radius-shell)] border shadow-[0_12px_34px_rgba(15,23,42,0.18)]">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/18" />

          <div className="relative flex h-full min-h-0 flex-col">
            <div className="border-b border-white/8 px-3.5 py-2.5 md:px-2.5 md:py-3 2xl:px-4">
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
                    <span className="size-1.5 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(52,211,153,0.1)]" />
                    <span>Workspace Control</span>
                  </div>
                </div>
              </div>
            </div>

            <nav
              aria-label="产品区域导航"
              className="flex min-h-0 flex-1 flex-col px-2.5 py-2 md:min-w-0 md:px-2 md:py-2.5 2xl:px-3 2xl:py-3"
            >
              <div className="mb-2.5 hidden items-center justify-between px-2 2xl:flex">
                <span className="text-[10px] font-medium tracking-[0.28em] text-slate-300/58 uppercase">
                  Operations
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-200/70">
                  {PRODUCT_AREAS.length} modules
                </span>
              </div>

              <div className="scrollbar-none relative flex gap-1 overflow-x-auto pb-0.5 md:min-h-0 md:flex-1 md:flex-col md:overflow-visible md:pb-0 2xl:overflow-y-auto">
                <span className="pointer-events-none absolute top-5 bottom-5 left-[31px] hidden w-px bg-gradient-to-b from-transparent via-white/9 to-transparent 2xl:block" />
                {PRODUCT_AREAS.map((area) => {
                  const Icon = areaIcons[area.key];
                  const active = area.key === activeArea;

                  return (
                    <div
                      key={area.key}
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
                          "group relative block overflow-hidden rounded-[var(--radius-card)] border px-2.5 py-2 transition-all duration-200 md:flex md:min-h-11 md:items-center md:justify-center md:px-2 2xl:justify-start 2xl:px-3 2xl:py-2.5",
                          active
                            ? "border-sky-200/20 bg-white/[0.105] text-white shadow-[inset_3px_0_0_rgba(125,211,252,0.9)]"
                            : "border-transparent text-slate-200/72 hover:border-white/8 hover:bg-white/[0.055] hover:text-white",
                        )}
                      >
                        <div className="relative flex items-center gap-2.5 md:justify-center 2xl:justify-start">
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-card)] ring-1 transition-all duration-200",
                              active
                                ? "bg-sky-100/14 text-white ring-sky-100/16"
                                : "bg-slate-950/14 text-slate-200/78 ring-white/7 group-hover:bg-white/7",
                            )}
                          >
                            <Icon className="size-[15px]" />
                          </span>

                          <div className="min-w-0 flex-1 md:hidden 2xl:block">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium">
                                {area.title}
                              </span>
                              {active ? (
                                <Badge className="hidden border-0 bg-sky-200/16 px-1.5 py-0 text-[10px] leading-4 text-sky-100 shadow-none 2xl:inline-flex">
                                  当前
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 [display:-webkit-box] hidden overflow-hidden text-[11px] leading-[1.4] text-slate-300/72 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] 2xl:block 2xl:text-[11.5px]">
                              {area.description}
                            </p>
                          </div>

                          <ChevronRightIcon
                            className={cn(
                              "absolute top-1 right-0 hidden size-3.5 transition-all duration-200 2xl:block",
                              active
                                ? "translate-x-0 text-sky-100/80 opacity-100"
                                : "-translate-x-1 text-slate-300/40 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
                            )}
                          />
                        </div>
                      </Link>

                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-[calc(100%+0.625rem)] z-50 hidden w-56 translate-x-1 -translate-y-1/2 rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-3 py-2 text-slate-900 opacity-0 shadow-[0_14px_32px_rgba(15,23,42,0.12)] ring-1 ring-slate-950/5 transition duration-150 md:block md:group-focus-within/navitem:translate-x-0 md:group-focus-within/navitem:opacity-100 md:group-hover/navitem:translate-x-0 md:group-hover/navitem:opacity-100 2xl:hidden"
                      >
                        <div className="text-[13px] leading-5 font-semibold">
                          {area.title}
                        </div>
                        <div className="mt-0.5 text-[12px] leading-5 text-slate-500">
                          {area.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 hidden 2xl:block">
                <Link
                  href="/system"
                  className="group relative block overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-3 text-slate-100 transition-all duration-200 hover:border-sky-200/18 hover:bg-white/[0.075]"
                >
                  <div className="relative flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-slate-950/18 text-sky-100 ring-1 ring-white/8">
                      <NetworkIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold text-white">
                          Kubernetes
                        </p>
                        <ChevronRightIcon className="size-3.5 text-slate-300/45 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-100/80" />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-300/68">
                        172.16.60.198:8443
                      </p>
                    </div>
                  </div>

                  <div className="relative mt-2 flex gap-2">
                    <div className="min-w-0 flex-1 rounded-full border border-white/8 bg-slate-950/12 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-100/84">
                        <ShieldCheckIcon className="size-3" />
                        Host
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 rounded-full border border-white/8 bg-slate-950/12 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-sky-100/84">
                        <CircleDotIcon className="size-3" />
                        Dashboard
                      </div>
                    </div>
                  </div>
                </Link>
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
