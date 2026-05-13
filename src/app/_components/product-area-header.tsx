"use client";

import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  DatabaseIcon,
  MonitorSmartphoneIcon,
  ServerIcon,
  Settings2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  storage: DatabaseIcon,
  deployments: BlocksIcon,
  system: Settings2Icon,
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

const areaEyebrows: Record<ProductAreaKey, string> = {
  office: "Operations Control",
  workspace: "Workspace Control",
  cmdb: "CMDB Ops",
  training: "Training Ops",
  storage: "Storage Ops",
  deployments: "Inference Ops",
  system: "Cluster Surface",
};

export function ProductAreaHeader({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);
  const activeAreaMeta =
    PRODUCT_AREAS.find((area) => area.key === activeArea) ?? PRODUCT_AREAS[0]!;
  const Icon = areaIcons[activeAreaMeta.key];
  const contextBadges = (
    <>
      <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
        Kubernetes
      </Badge>
      <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
        Dashboard Host
      </Badge>
      <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
        XDream Cloud
      </Badge>
    </>
  );
  const content = (
    <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-slate-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.1)]">
          <Icon className="size-5" />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium tracking-[0.3em] text-slate-600 uppercase">
            {areaEyebrows[activeAreaMeta.key]}
          </p>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold tracking-normal text-slate-950 md:text-2xl">
              {activeAreaMeta.title}
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              {activeAreaMeta.description}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">{contextBadges}</div>
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-slate-950 text-white shadow-[0_8px_20px_rgba(15,23,42,0.1)]">
            <Icon className="size-4" />
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-[0.24em] text-slate-500 uppercase">
              {areaEyebrows[activeAreaMeta.key]}
            </p>
            <h2 className="mt-1 text-[1.02rem] leading-none font-semibold tracking-normal text-slate-950">
              {activeAreaMeta.title}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 [&_[data-slot=badge]]:h-6 [&_[data-slot=badge]]:px-2.5 [&_[data-slot=badge]]:text-[11px]">
          {contextBadges}
        </div>
      </div>
    );
  }

  return (
    <header className="border-border bg-card relative shrink-0 overflow-hidden rounded-[var(--radius-shell)] border px-6 py-6 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      {content}
    </header>
  );
}
