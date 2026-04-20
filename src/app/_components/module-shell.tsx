import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function ModulePageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(107,138,173,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(255,210,155,0.18),transparent_22%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_42%,#edf2f7_100%)] text-foreground",
        className,
      )}
    >
      <div className="mx-auto flex max-w-[1640px] flex-col gap-6 px-4 py-4 md:px-6 md:py-6">
        {children}
      </div>
    </div>
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
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-border/60 bg-background/78 py-0 shadow-[0_24px_90px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <CardHeader className="gap-6 px-6 py-6 md:px-8 md:py-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
              <Icon />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-border/80 bg-background/60">
                  {eyebrow}
                </Badge>
                {badges}
              </div>
              <div className="flex flex-col gap-2">
                <CardTitle className="text-3xl tracking-[-0.06em] md:text-5xl">
                  {title}
                </CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
                  {description}
                </CardDescription>
              </div>
            </div>
          </div>

          {actions ? <CardAction className="static">{actions}</CardAction> : null}
        </div>
      </CardHeader>

      {children ? (
        <>
          <Separator className="bg-border/70" />
          <CardContent className="px-6 py-6 md:px-8">{children}</CardContent>
        </>
      ) : null}
    </Card>
  );
}

export function ModuleMetricCard({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border-border/60 bg-background/78 shadow-[0_18px_56px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <CardDescription className="text-[11px] tracking-[0.28em] uppercase">
              {label}
            </CardDescription>
            <CardTitle className="text-3xl tracking-[-0.06em]">{value}</CardTitle>
          </div>
          <div className="flex size-11 items-center justify-center rounded-2xl border border-border/80 bg-muted/60 text-muted-foreground">
            <Icon />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm leading-6 text-muted-foreground">
        {description}
      </CardContent>
    </Card>
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
    <Card
      className={cn(
        "overflow-hidden border-border/60 bg-background/78 py-0 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl",
        className,
      )}
    >
      <CardHeader className="gap-4 px-6 py-5 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-2xl tracking-[-0.05em]">{title}</CardTitle>
            <CardDescription className="max-w-2xl text-sm leading-6">
              {description}
            </CardDescription>
          </div>
          {action ? <CardAction className="static">{action}</CardAction> : null}
        </div>
      </CardHeader>
      <Separator className="bg-border/70" />
      <CardContent className="px-6 py-6 md:px-8">{children}</CardContent>
    </Card>
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
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-muted/35 px-6 py-14 text-center">
      <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">
        {title}
      </p>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

