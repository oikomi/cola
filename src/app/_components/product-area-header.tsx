"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRightIcon,
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
    <header className="rounded-[28px] border border-white/55 bg-[radial-gradient(circle_at_top_left,rgba(255,251,244,0.98),rgba(255,244,223,0.92)_42%,rgba(248,228,195,0.86))] p-4 shadow-[0_24px_80px_rgba(78,55,28,0.12)] md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-4xl">
          <p className="text-[10px] tracking-[0.34em] text-[#9d7b58] uppercase">
            Cola Platform
          </p>
          <p className="mt-2 text-lg font-semibold tracking-[-0.04em] text-[#26190f] md:text-xl">
            四个功能区统一入口
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6d5544]">
            Virtual Office、Workspace、Training 和 Inference Deploy
            共享同一层导航。 Office 中的 OpenClaw / Hermes 入口也按 workspace
            方式对齐为 K8s 工作区。
          </p>
        </div>

        <div className="inline-flex w-fit items-center rounded-full border border-[#e3c59c] bg-white/72 px-3 py-1.5 text-[11px] font-medium tracking-[0.24em] text-[#8c673f] uppercase">
          4 Functional Areas
        </div>
      </div>

      <nav className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PRODUCT_AREAS.map((area) => {
          const Icon = areaIcons[area.key];
          const active = area.key === activeArea;

          return (
            <Link
              key={area.key}
              href={area.href}
              className={cn(
                "group rounded-[22px] border px-4 py-4 transition-all duration-200",
                active
                  ? "border-[#c9924b] bg-[#1f170f] text-[#fff7ed] shadow-[0_18px_40px_rgba(62,39,16,0.18)]"
                  : "border-[#ead8bf] bg-white/72 text-[#22170f] hover:-translate-y-0.5 hover:border-[#d8b27a] hover:bg-white",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={cn(
                    "flex size-11 items-center justify-center rounded-[16px]",
                    active
                      ? "bg-white/10 text-[#ffd79d]"
                      : "bg-[#f4e5d0] text-[#8a5d2a]",
                  )}
                >
                  <Icon className="size-5" />
                </div>

                {active ? (
                  <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[11px] font-medium text-white/82">
                    当前区域
                  </span>
                ) : (
                  <ArrowUpRightIcon className="size-4 text-[#9d7750] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                )}
              </div>

              <p
                className={cn(
                  "mt-4 text-base font-semibold tracking-[-0.03em]",
                  active ? "text-white" : "text-[#26190f]",
                )}
              >
                {area.title}
              </p>
              <p
                className={cn(
                  "mt-1 text-sm leading-6",
                  active ? "text-white/72" : "text-[#6d5544]",
                )}
              >
                {area.description}
              </p>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
