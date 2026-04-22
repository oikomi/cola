"use client";

import Image from "next/image";
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

export function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);

  return (
    <div className="text-foreground h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_22%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_24%),linear-gradient(180deg,#f4f8fd_0%,#edf3f8_46%,#e9f0f7_100%)]">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1840px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-6 lg:px-8 lg:py-8 xl:grid-cols-[344px_minmax(0,1fr)] xl:px-10 xl:py-10 2xl:grid-cols-[356px_minmax(0,1fr)] 2xl:px-12">
        <aside className="relative min-h-0 overflow-hidden rounded-[var(--radius-shell)] border border-white/18 bg-[linear-gradient(180deg,rgba(26,38,62,0.96)_0%,rgba(30,44,71,0.92)_48%,rgba(31,44,70,0.88)_100%)] text-slate-50 shadow-[0_32px_80px_rgba(15,23,42,0.24),0_12px_32px_rgba(8,15,30,0.16)] supports-[backdrop-filter]:backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_14%,rgba(125,211,252,0.18),transparent_28%),radial-gradient(circle_at_0%_100%,rgba(96,165,250,0.14),transparent_34%)]" />
          <div className="pointer-events-none absolute inset-[1px] rounded-[calc(var(--radius-shell)-1px)] border border-white/6" />

          <div className="relative flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5 lg:px-7 lg:py-8">
              <Image
                src="/xdream-cloud-mark.svg"
                alt="XDream Cloud"
                width={56}
                height={56}
                priority
                className="size-14 shrink-0 rounded-[18px] shadow-[0_20px_42px_rgba(56,189,248,0.2)]"
              />
              <div className="min-w-0">
                <p className="text-[11px] tracking-[0.34em] text-sky-100/72 uppercase">
                  XDream
                </p>
                <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-white">
                  Cloud Console
                </p>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4 px-4 py-4 lg:gap-6 lg:px-5 lg:py-6">
              <div className="scrollbar-none flex gap-2.5 overflow-x-auto pb-1 lg:grid lg:gap-2 lg:overflow-visible lg:pb-0">
                {PRODUCT_AREAS.map((area) => {
                  const Icon = areaIcons[area.key];
                  const active = area.key === activeArea;

                  return (
                    <Link
                      key={area.key}
                      href={area.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group min-w-[160px] shrink-0 rounded-[20px] border px-4 py-4 transition-all duration-200 lg:min-w-0",
                        active
                          ? "border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.08))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_18px_34px_rgba(15,23,42,0.18)]"
                          : "border-transparent text-slate-200/88 hover:border-sky-200/14 hover:bg-white/7 hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(125,211,252,0.12),0_14px_26px_rgba(15,23,42,0.1)]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[12px] transition-colors",
                            active
                              ? "bg-white/14 text-white"
                              : "bg-slate-700/60 text-slate-200 group-hover:bg-sky-300/10 group-hover:text-white",
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
                              <Badge className="border-0 bg-sky-300/18 px-2 py-0.5 text-sky-100">
                                Active
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1.5 hidden text-xs leading-5 text-inherit/78 lg:block">
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

        <main className="min-h-0 min-w-0">
          <div className="relative h-full min-h-0 overflow-hidden rounded-[var(--radius-shell)] border border-white/78 bg-white/66 shadow-[0_32px_80px_rgba(15,23,42,0.08),0_10px_24px_rgba(15,23,42,0.04)] supports-[backdrop-filter]:backdrop-blur-[22px]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.55),transparent_48%)]" />
            <div className="scrollbar-none relative h-full min-h-0 overflow-y-auto p-5 md:p-7 xl:p-9">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
