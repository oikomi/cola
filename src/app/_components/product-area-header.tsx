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

function ColaLogo() {
  return (
    <div className="relative flex h-[90px] w-[122px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(30,41,59,0.96))] shadow-[0_20px_40px_rgba(15,23,42,0.16)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_22%,rgba(148,163,184,0.2),transparent_26%),radial-gradient(circle_at_78%_78%,rgba(245,158,11,0.18),transparent_28%)]" />
      <svg
        viewBox="0 0 72 72"
        aria-hidden="true"
        className="relative h-11 w-11"
      >
        <defs>
          <linearGradient id="cola-logo-accent" x1="10" y1="12" x2="62" y2="60">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="52%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <path
          d="M36 17 47 23.5V36L36 42.5 25 36V23.5Z"
          fill="url(#cola-logo-accent)"
          opacity="0.95"
        />
        <path
          d="M36 9v7M57 21l-6 3.5M57 51l-6-3.5M36 63v-7M15 51l6-3.5M15 21l6 3.5"
          stroke="url(#cola-logo-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.82"
        />
        <circle cx="36" cy="9" r="5" fill="#e2e8f0" />
        <circle cx="57" cy="21" r="5" fill="#94a3b8" />
        <circle cx="57" cy="51" r="5" fill="#f8fafc" />
        <circle cx="36" cy="63" r="5" fill="#f59e0b" />
        <circle cx="15" cy="51" r="5" fill="#cbd5e1" />
        <circle cx="15" cy="21" r="5" fill="#e2e8f0" />
      </svg>
      <span className="relative mt-2 text-[10px] font-semibold tracking-[0.34em] text-slate-100">
        COLA
      </span>
    </div>
  );
}

export function ProductAreaHeader() {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);
  const activeAreaMeta = PRODUCT_AREAS.find((area) => area.key === activeArea);

  return (
    <header className="rounded-[28px] border border-white/60 bg-background/72 px-4 py-4 shadow-[0_20px_64px_rgba(15,23,42,0.08)] backdrop-blur-xl md:px-5 md:py-5">
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
        <div className="rounded-[24px] border border-border/70 bg-background/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
          <div className="flex items-center gap-4 xl:flex-col xl:items-start">
            <ColaLogo />
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.28em] text-muted-foreground uppercase">
                Cola Modules
              </p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-foreground">
                功能菜单栏
              </p>
              <p className="mt-2 max-w-[24ch] text-sm leading-6 text-muted-foreground">
                五个模块拆成独立工作面，按当前任务直接切换，不再挤在一条横向按钮带里。
              </p>
              {activeAreaMeta ? (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted px-3 py-1 text-xs text-muted-foreground">
                  <span>当前</span>
                  <span className="font-medium text-foreground">
                    {activeAreaMeta.title}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <nav className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {PRODUCT_AREAS.map((area) => {
            const Icon = areaIcons[area.key];
            const active = area.key === activeArea;

            return (
              <Link
                key={area.key}
                href={area.href}
                className={cn(
                  "group rounded-[24px] border px-4 py-4 transition-all duration-200",
                  active
                    ? "border-transparent bg-primary text-primary-foreground shadow-[0_14px_36px_rgba(15,23,42,0.16)]"
                    : "border-border/80 bg-background/70 text-foreground hover:-translate-y-0.5 hover:border-border hover:bg-background hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
                )}
                aria-current={active ? "page" : undefined}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full",
                      active
                        ? "bg-white/10 text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold tracking-[-0.02em]">
                        {area.title}
                      </span>
                      {active ? (
                        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] tracking-[0.18em] uppercase text-primary-foreground/76">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 text-xs leading-5",
                        active ? "text-primary-foreground/68" : "text-muted-foreground",
                      )}
                    >
                      {area.description}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
