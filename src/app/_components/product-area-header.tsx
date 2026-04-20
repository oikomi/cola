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
    <div className="relative flex h-[98px] w-[138px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[24px] bg-[#1f1610] shadow-[0_14px_32px_rgba(32,22,15,0.2)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_22%,rgba(255,213,142,0.18),transparent_26%),radial-gradient(circle_at_78%_78%,rgba(255,241,221,0.12),transparent_28%)]" />
      <svg
        viewBox="0 0 72 72"
        aria-hidden="true"
        className="relative h-12 w-12"
      >
        <defs>
          <linearGradient id="cola-logo-accent" x1="10" y1="12" x2="62" y2="60">
            <stop offset="0%" stopColor="#fff1d8" />
            <stop offset="52%" stopColor="#f4c987" />
            <stop offset="100%" stopColor="#b97a39" />
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
        <circle cx="36" cy="9" r="5" fill="#f6d8aa" />
        <circle cx="57" cy="21" r="5" fill="#d39a5b" />
        <circle cx="57" cy="51" r="5" fill="#f0c88b" />
        <circle cx="36" cy="63" r="5" fill="#c68644" />
        <circle cx="15" cy="51" r="5" fill="#f8e6c8" />
        <circle cx="15" cy="21" r="5" fill="#e5b574" />
      </svg>
      <span className="relative mt-2 text-[11px] font-semibold tracking-[0.38em] text-[#f4d9ad]">
        COLA
      </span>
    </div>
  );
}

export function ProductAreaHeader() {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);

  return (
    <header className="rounded-[24px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,251,244,0.94),rgba(251,241,221,0.88))] px-4 py-3 shadow-[0_18px_60px_rgba(78,55,28,0.1)] md:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <ColaLogo />
          <div>
            <p className="text-sm font-semibold text-[#26190f]">功能菜单栏</p>
            <p className="text-xs leading-5 text-[#7b624d]">
              五个模块独立，通过菜单切换入口。
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2">
          {PRODUCT_AREAS.map((area) => {
            const Icon = areaIcons[area.key];
            const active = area.key === activeArea;

            return (
              <Link
                key={area.key}
                href={area.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-200",
                  active
                    ? "border-[#c9924b] bg-[#1f170f] text-[#fff7ed] shadow-[0_12px_28px_rgba(62,39,16,0.16)]"
                    : "border-[#ead8bf] bg-white/72 text-[#22170f] hover:border-[#d8b27a] hover:bg-white",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full",
                    active
                      ? "bg-white/10 text-[#ffd79d]"
                      : "bg-[#f4e5d0] text-[#8a5d2a]",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span>{area.title}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] tracking-[0.18em] uppercase",
                    active
                      ? "bg-white/10 text-white/76"
                      : "bg-[#f7ecdc] text-[#8f6b47]",
                  )}
                >
                  {active ? "Current" : "Module"}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
