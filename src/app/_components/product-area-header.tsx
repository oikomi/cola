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
    <header className="relative shrink-0 overflow-hidden rounded-[26px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] px-4 py-4 shadow-[0_14px_40px_rgba(15,23,42,0.05)] md:px-5 md:py-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_24%)]" />

      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[20px] bg-slate-950 text-white shadow-[0_18px_36px_rgba(15,23,42,0.14)]">
            <Icon className="size-5" />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] tracking-[0.34em] text-slate-500 uppercase">
              {areaEyebrows[activeAreaMeta.key]}
            </p>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-[-0.05em] text-slate-950 md:text-2xl">
                {activeAreaMeta.title}
              </h2>
              <p className="max-w-3xl text-sm leading-6 text-slate-500">
                {activeAreaMeta.description}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge className="border border-slate-200 bg-white text-slate-700">
            Kubernetes
          </Badge>
          <Badge className="border border-slate-200 bg-white text-slate-700">
            Master Node
          </Badge>
          <Badge className="border border-slate-200 bg-white text-slate-700">
            Cola Admin Surface
          </Badge>
        </div>
      </div>
    </header>
  );
}
