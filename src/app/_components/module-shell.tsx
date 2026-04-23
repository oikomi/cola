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
      <div className={cn("flex flex-col gap-6", className)}>{children}</div>
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
  surfaceHeader,
  density = "default",
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  size?: "default" | "compact";
  surfaceHeader?: ReactNode;
  density?: "default" | "dense";
}) {
  const isDense = density === "dense";

  if (size === "compact") {
    return (
      <section
        className={cn(
          "relative overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.86))] shadow-[0_14px_34px_rgba(15,23,42,0.045)]",
          isDense ? "px-5 py-4" : "px-6 py-5",
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_18%,rgba(96,165,250,0.12),transparent_24%),radial-gradient(circle_at_92%_0%,rgba(14,165,233,0.08),transparent_22%)]" />

        {surfaceHeader ? (
          <div
            className={cn(
              "relative border-b border-slate-200/80",
              isDense ? "pb-4" : "pb-5",
            )}
          >
            {surfaceHeader}
          </div>
        ) : null}

        <div
          className={cn(
            "relative flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start",
            isDense ? "gap-3 lg:gap-3" : "gap-4 lg:gap-4",
            surfaceHeader ? (isDense ? "pt-4" : "pt-5") : "",
          )}
        >
          <div className="min-w-0">
            <div
              className={cn(
                "flex min-w-0 items-start",
                isDense ? "gap-2.5" : "gap-3",
              )}
            >
              <div
                className={cn(
                  "flex shrink-0 items-center justify-center bg-sky-50 text-sky-700 ring-1 ring-sky-100",
                  isDense
                    ? "size-10 rounded-[10px]"
                    : "size-11 rounded-[var(--radius-card)]",
                )}
              >
                <Icon className={cn(isDense ? "size-[15px]" : "size-4")} />
              </div>

              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "flex flex-wrap items-center",
                    isDense ? "gap-1.5" : "gap-2",
                  )}
                >
                  <Badge className="border border-slate-200/90 bg-white/86 text-slate-700">
                    {eyebrow}
                  </Badge>
                  {badges}
                </div>
                <h1
                  className={cn(
                    "truncate font-semibold tracking-[-0.05em] text-slate-950",
                    isDense
                      ? "mt-1.5 text-[1.34rem] leading-none md:text-[1.48rem]"
                      : "mt-2 text-[1.5rem] leading-none md:text-[1.7rem]",
                  )}
                >
                  {title}
                </h1>
                <p
                  className={cn(
                    "max-w-[44rem] text-slate-600",
                    isDense ? "mt-1.5 text-[13px] leading-5" : "mt-2 text-sm leading-6",
                  )}
                >
                  {description}
                </p>
              </div>
            </div>
          </div>

          {actions ? (
            <div
              className={cn(
                "flex shrink-0 flex-wrap gap-2 lg:justify-end [&_[data-slot=button]]:rounded-[var(--radius-card)] [&_[data-slot=button]]:text-[13px]",
                isDense
                  ? "[&_[data-slot=button]]:h-9 [&_[data-slot=button]]:px-3.5"
                  : "[&_[data-slot=button]]:h-10 [&_[data-slot=button]]:px-4",
              )}
            >
              {actions}
            </div>
          ) : null}
        </div>

        {children ? (
          <div
            className={cn(
              "relative border-t border-slate-200/80",
              isDense ? "mt-4 pt-4" : "mt-5 pt-5",
            )}
          >
            {children}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.88))] px-6 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.05)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(96,165,250,0.12),transparent_22%),radial-gradient(circle_at_88%_14%,rgba(14,165,233,0.08),transparent_18%)]" />

        <div className="relative flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start xl:gap-4">
          <div className="flex items-start gap-2.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
              <Icon className="size-[14px]" />
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-slate-200/90 bg-white/88 text-slate-700">
                  {eyebrow}
                </Badge>
                {badges}
              </div>

              <div className="space-y-0.5">
                <h1 className="max-w-4xl text-[1.58rem] leading-tight font-semibold tracking-[-0.05em] text-slate-950 md:text-[2rem]">
                  {title}
                </h1>
                <p className="max-w-3xl text-[13px] leading-6 text-slate-600 md:max-w-2xl">
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

      {children ? <div className="mt-3">{children}</div> : null}
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
          ? "rounded-[var(--radius-card)] px-4 py-3 shadow-[0_10px_22px_rgba(15,23,42,0.038)]"
          : "rounded-[var(--radius-card)] px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.16em] text-slate-600 uppercase">
            {label}
          </p>
          <p
            className={cn(
              "font-semibold tracking-[-0.05em] text-slate-950",
              isCompact
                ? "mt-1 text-[1.25rem] leading-none"
                : "mt-1.5 text-[1.85rem]",
            )}
          >
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex items-center justify-center bg-slate-100 text-slate-600 ring-1 ring-slate-200",
            isCompact
              ? "size-[28px] rounded-[10px]"
              : "size-8 rounded-[var(--radius-card)]",
          )}
        >
          <Icon className={cn(isCompact ? "size-3" : "size-[14px]")} />
        </div>
      </div>
      <p
        className={cn(
          "text-slate-500",
          isCompact
            ? "mt-1 text-[12px] leading-5"
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
  density = "default",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  density?: "default" | "compact";
}) {
  const isCompact = density === "compact";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/90 bg-white/84 shadow-[0_18px_56px_rgba(15,23,42,0.055)]",
        className,
      )}
    >
      <div
        className={cn(
          "border-b border-slate-200/80",
          isCompact
            ? "flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6"
            : "flex flex-col gap-4 px-6 py-6 md:flex-row md:items-start md:justify-between md:px-8",
        )}
      >
        <div
          className={cn(
            isCompact
              ? "flex min-w-0 flex-col gap-1.5 md:flex-row md:items-baseline md:gap-3"
              : "space-y-2",
          )}
        >
          <h2
            className={cn(
              "font-semibold tracking-[-0.05em] text-slate-950",
              isCompact ? "text-[1.2rem]" : "text-[1.5rem]",
            )}
          >
            {title}
          </h2>
          <p
            className={cn(
              "text-slate-600",
              isCompact
                ? "max-w-3xl text-[13px] leading-5"
                : "max-w-2xl text-sm leading-6",
            )}
          >
            {description}
          </p>
        </div>
        {action ? (
          <div
            className={cn(
              "flex shrink-0 flex-wrap gap-2",
              isCompact ? "items-center" : undefined,
            )}
          >
            {action}
          </div>
        ) : null}
      </div>

      <div className={cn(isCompact ? "px-5 py-5 md:px-6" : "px-6 py-6 md:px-8")}>
        {children}
      </div>
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
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-shell)] border border-dashed border-slate-300 bg-slate-50/80 px-8 py-16 text-center">
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
