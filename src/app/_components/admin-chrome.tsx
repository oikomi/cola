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
    <div className="text-foreground h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.13),transparent_24%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_22%),linear-gradient(180deg,#f5f8fc_0%,#eff4f9_48%,#eef3f8_100%)]">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1800px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-4 py-4 lg:grid-cols-[288px_minmax(0,1fr)] lg:grid-rows-1 lg:gap-6 lg:px-8 lg:py-8 xl:grid-cols-[304px_minmax(0,1fr)] xl:px-10 xl:py-10">
        <aside className="min-h-0 overflow-hidden rounded-[var(--radius-shell)] border border-white/14 bg-[linear-gradient(180deg,rgba(30,41,59,0.94)_0%,rgba(33,44,61,0.9)_48%,rgba(35,46,64,0.84)_100%)] text-slate-50 shadow-[0_24px_68px_rgba(15,23,42,0.18)] supports-[backdrop-filter]:backdrop-blur-xl">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4 lg:px-6 lg:py-7">
              <Image
                src="/xdream-cloud-mark.svg"
                alt="XDream Cloud"
                width={56}
                height={56}
                priority
                className="size-14 shrink-0 rounded-[18px] shadow-[0_18px_38px_rgba(56,189,248,0.18)]"
              />
              <div className="min-w-0">
                <p className="text-[11px] tracking-[0.34em] text-sky-100/72 uppercase">
                  XDream
                </p>
                <p className="mt-1 text-base font-semibold tracking-[-0.03em] text-white">
                  Cloud Console
                </p>
                <p className="mt-1 text-xs text-slate-300/78">
                  Kubernetes control surface
                </p>
              </div>
            </div>

            <div className="flex min-h-0 flex-col gap-4 px-3 py-3 lg:gap-6 lg:px-4 lg:py-5">
              <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1 lg:grid lg:gap-1.5 lg:overflow-visible lg:pb-0">
                {PRODUCT_AREAS.map((area) => {
                  const Icon = areaIcons[area.key];
                  const active = area.key === activeArea;

                  return (
                    <Link
                      key={area.key}
                      href={area.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group min-w-[148px] shrink-0 rounded-[var(--radius-card)] border px-3 py-3 transition-all duration-200 lg:min-w-0 lg:px-3.5",
                        active
                          ? "border-white/16 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(125,211,252,0.06)]"
                          : "border-transparent text-slate-200/88 hover:border-sky-200/14 hover:bg-white/8 hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(125,211,252,0.12),0_12px_22px_rgba(15,23,42,0.08)]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors",
                            active
                              ? "bg-white/12 text-white"
                              : "bg-slate-700/65 text-slate-200 group-hover:bg-sky-300/10 group-hover:text-white",
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
                              <Badge className="border-0 bg-sky-300/18 text-sky-100">
                                Active
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 hidden text-xs leading-5 text-inherit/80 lg:block">
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
          <div className="h-full min-h-0 overflow-hidden rounded-[var(--radius-shell)] border border-white/80 bg-white/70 shadow-[0_24px_72px_rgba(15,23,42,0.07)] supports-[backdrop-filter]:backdrop-blur-2xl">
            <div className="scrollbar-none h-full min-h-0 overflow-y-auto p-4 md:p-6 xl:p-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
