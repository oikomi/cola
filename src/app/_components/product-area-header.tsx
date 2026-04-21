"use client";

import { usePathname } from "next/navigation";
import {
  BlocksIcon,
  BrainCircuitIcon,
  Building2Icon,
  MonitorSmartphoneIcon,
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
  training: BrainCircuitIcon,
  deployments: BlocksIcon,
  system: Settings2Icon,
} satisfies Record<ProductAreaKey, typeof Building2Icon>;

const areaEyebrows: Record<ProductAreaKey, string> = {
  office: "Operations Control",
  workspace: "Workspace Control",
  training: "Training Ops",
  deployments: "Inference Ops",
  system: "Cluster Surface",
};

export function ProductAreaHeader() {
  const pathname = usePathname();
  const activeArea = productAreaForPath(pathname);
  const activeAreaMeta =
    PRODUCT_AREAS.find((area) => area.key === activeArea) ?? PRODUCT_AREAS[0]!;
  const Icon = areaIcons[activeAreaMeta.key];

  return (
    <header className="relative shrink-0 overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.84))] px-6 py-6 shadow-[0_14px_38px_rgba(15,23,42,0.045)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.1),transparent_28%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_24%)]" />

      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-slate-950 text-white shadow-[0_18px_36px_rgba(15,23,42,0.1)]">
            <Icon className="size-5" />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-[0.3em] text-slate-600 uppercase">
              {areaEyebrows[activeAreaMeta.key]}
            </p>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-[-0.05em] text-slate-950 md:text-2xl">
                {activeAreaMeta.title}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                {activeAreaMeta.description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
            Kubernetes
          </Badge>
          <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
            Master Node
          </Badge>
          <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
            Cola Admin Surface
          </Badge>
        </div>
      </div>
    </header>
  );
}
