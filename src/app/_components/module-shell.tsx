import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AdminChrome } from "@/app/_components/admin-chrome";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ModulePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <AdminChrome>
      <div className={cn("flex flex-col gap-4", className)}>{children}</div>
    </AdminChrome>
  );
}

export function ModuleHero({
  eyebrow,
  title,
  description,
  icon: Icon,
  badges,
  actions,
  children,
  size = "default",
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  size?: "default" | "compact";
}) {
  if (size === "compact") {
    return (
      <>
        <section className="relative overflow-hidden rounded-[22px] border border-slate-900/80 bg-[linear-gradient(135deg,#0f172a_0%,#172033_42%,#1e293b_100%)] px-3.5 py-2.5 text-slate-50 shadow-[0_14px_30px_rgba(15,23,42,0.09)] md:px-4 md:py-3">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(96,165,250,0.14),transparent_18%),radial-gradient(circle_at_88%_14%,rgba(14,165,233,0.1),transparent_16%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />

          <div className="relative flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <div className="flex size-[30px] shrink-0 items-center justify-center rounded-[11px] bg-white/8 text-slate-50 ring-1 ring-white/10">
                  <Icon className="size-3" />
                </div>
                <h1 className="truncate text-[1.28rem] leading-none font-semibold tracking-[-0.05em] text-white md:text-[1.55rem]">
                  {title}
                </h1>
                <Badge className="border-0 bg-white/10 text-white">
                  {eyebrow}
                </Badge>
                {badges}
              </div>

              <p className="max-w-[44rem] pl-[38px] text-[11px] leading-4 text-slate-300">
                {description}
              </p>
            </div>

            {actions ? (
              <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end [&_[data-slot=button]]:h-[30px] [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:px-3 [&_[data-slot=button]]:text-[13px]">
                {actions}
              </div>
            ) : null}
          </div>
        </section>

        {children ? <div className="mt-1.5">{children}</div> : null}
      </>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden rounded-[24px] border border-slate-900/80 bg-[linear-gradient(135deg,#0f172a_0%,#172033_42%,#1e293b_100%)] px-4 py-3 text-slate-50 shadow-[0_18px_42px_rgba(15,23,42,0.11)] md:px-[18px] md:py-3.5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(96,165,250,0.18),transparent_18%),radial-gradient(circle_at_88%_14%,rgba(14,165,233,0.14),transparent_16%),linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />

        <div className="relative flex flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start xl:gap-3.5">
          <div className="flex items-start gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-white/8 text-slate-50 ring-1 ring-white/10">
              <Icon className="size-[14px]" />
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-0 bg-white/10 text-white">
                  {eyebrow}
                </Badge>
                {badges}
              </div>

              <div className="space-y-0.5">
                <h1 className="max-w-4xl text-[1.58rem] leading-tight font-semibold tracking-[-0.05em] md:text-[2rem]">
                  {title}
                </h1>
                <p className="max-w-3xl text-[13px] leading-5 text-slate-300 md:max-w-2xl">
                  {description}
                </p>
              </div>
            </div>
          </div>

          {actions ? (
            <div className="flex shrink-0 flex-wrap gap-2 xl:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      </section>

      {children ? <div className="mt-2.5">{children}</div> : null}
    </>
  );
}

export function ModuleMetricCard({
  label,
  value,
  description,
  icon: Icon,
  size = "default",
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  size?: "default" | "compact";
}) {
  const isCompact = size === "compact";

  return (
    <div
      className={cn(
        "border border-slate-200/90 bg-white/88",
        isCompact
          ? "rounded-[16px] px-3 py-2 shadow-[0_6px_14px_rgba(15,23,42,0.032)]"
          : "rounded-[18px] px-3.5 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.16em] text-slate-500 uppercase">
            {label}
          </p>
          <p
            className={cn(
              "font-semibold tracking-[-0.05em] text-slate-950",
              isCompact
                ? "mt-0.5 text-[1.32rem] leading-none"
                : "mt-1.5 text-[1.85rem]",
            )}
          >
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex items-center justify-center bg-slate-100 text-slate-600 ring-1 ring-slate-200",
            isCompact ? "size-[26px] rounded-[11px]" : "size-8 rounded-[14px]",
          )}
        >
          <Icon className={cn(isCompact ? "size-3" : "size-[14px]")} />
        </div>
      </div>
      <p
        className={cn(
          "text-slate-500",
          isCompact
            ? "mt-0.5 text-[11px] leading-4"
            : "mt-1.5 text-[13px] leading-[1.15rem]",
        )}
      >
        {description}
      </p>
    </div>
  );
}

export function ModuleSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[30px] border border-slate-200/90 bg-white/86 shadow-[0_18px_56px_rgba(15,23,42,0.06)]",
        className,
      )}
    >
      <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 md:flex-row md:items-start md:justify-between md:px-7">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">
            {title}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-500">
            {description}
          </p>
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
        ) : null}
      </div>

      <div className="px-6 py-6 md:px-7">{children}</div>
    </section>
  );
}

export function ModuleEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-14 text-center">
      <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950">
        {title}
      </p>
      <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
