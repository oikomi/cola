"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  MonitorSmartphoneIcon,
  Settings2Icon,
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
  training: BrainCircuitIcon,
  deployments: BlocksIcon,
  system: Settings2Icon,
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

function ColaMark() {
  return (
    <div className="flex size-16 items-center justify-center rounded-[26px] bg-[linear-gradient(135deg,#60a5fa,#1d4ed8_52%,#0f172a)] text-xl font-semibold tracking-[0.12em] text-white shadow-[0_16px_36px_rgba(37,99,235,0.34)]">
      C
    </div>
  );
}

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);

  return (
    <div className="text-foreground h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_22%),linear-gradient(180deg,#f4f7fb_0%,#eff4f9_46%,#edf2f7_100%)]">
      <div className="mx-auto grid h-full w-full max-w-[1760px] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 px-3 py-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5 lg:px-5 lg:py-5 xl:grid-cols-[296px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-hidden rounded-[28px] border border-slate-800/80 bg-[linear-gradient(180deg,#0f172a_0%,#111827_54%,#172033_100%)] text-slate-50 shadow-[0_26px_80px_rgba(15,23,42,0.24)]">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 lg:justify-center lg:px-5 lg:py-6">
              <ColaMark />
              <div className="lg:hidden">
                <p className="text-[11px] tracking-[0.28em] text-slate-400 uppercase">
                  Cola
                </p>
                <p className="mt-1 text-sm font-medium tracking-[-0.02em] text-white">
                  Admin Surface
                </p>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4 px-3 py-3 lg:gap-6 lg:px-4 lg:py-5">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none lg:grid lg:gap-1.5 lg:overflow-visible lg:pb-0">
                {PRODUCT_AREAS.map((area) => {
                  const Icon = areaIcons[area.key];
                  const active = area.key === activeArea;

                  return (
                    <Link
                      key={area.key}
                      href={area.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group min-w-[148px] shrink-0 rounded-[18px] border px-3 py-3 transition-all duration-200 lg:min-w-0 lg:rounded-[20px] lg:px-3.5",
                        active
                          ? "border-white/12 bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                          : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/6 hover:text-white",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl",
                            active
                              ? "bg-white/12 text-white"
                              : "bg-slate-800/80 text-slate-300 group-hover:bg-white/10 group-hover:text-white",
                          )}
                        >
                          <Icon className="size-4" />
                        </span>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium tracking-[-0.02em]">
                              {area.title}
                            </span>
                            {active ? (
                              <Badge className="border-0 bg-sky-400/16 text-sky-100">
                                Active
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 hidden text-xs leading-5 text-inherit/72 lg:block">
                            {area.description}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 min-h-0">
          <div className="h-full min-h-0 overflow-hidden rounded-[30px] border border-white/72 bg-white/64 shadow-[0_24px_72px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="h-full min-h-0 overflow-y-auto p-4 scrollbar-none md:p-5 xl:p-6">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
