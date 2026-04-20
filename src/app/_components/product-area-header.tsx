"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  MonitorSmartphoneIcon,
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
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

export function ProductAreaHeader() {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);

  return (
    <header className="rounded-[24px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,251,244,0.94),rgba(251,241,221,0.88))] px-4 py-3 shadow-[0_18px_60px_rgba(78,55,28,0.1)] md:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-[16px] bg-[#20160f] px-3 py-2 text-[#fff8ef] shadow-[0_10px_24px_rgba(32,22,15,0.16)]">
            <p className="text-[10px] tracking-[0.28em] text-white/56 uppercase">
              Cola
            </p>
            <p className="text-sm font-semibold tracking-[-0.03em]">Modules</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#26190f]">功能菜单栏</p>
            <p className="text-xs leading-5 text-[#7b624d]">
              四个模块独立，通过菜单切换入口。
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
