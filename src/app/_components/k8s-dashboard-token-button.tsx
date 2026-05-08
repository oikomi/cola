"use client";

import {
  CopyCheckIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DashboardTokenResponse =
  | {
      token: string;
      error?: never;
    }
  | {
      token?: never;
      error: string;
    };

type ButtonVariant = NonNullable<
  Parameters<typeof buttonVariants>[0]
>["variant"];
type ButtonSize = NonNullable<Parameters<typeof buttonVariants>[0]>["size"];

export function K8sDashboardTokenButton({
  dashboardUrl,
  className,
  variant = "default",
  size = "lg",
  label = "复制 Token 并打开 Dashboard",
}: {
  dashboardUrl: string;
  className?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "copied" | "failed">(
    "idle",
  );

  async function copyTokenAndOpenDashboard() {
    if (typeof window === "undefined") return;

    const openedWindow = window.open("about:blank", "_blank");

    if (!openedWindow) {
      setState("failed");
      return;
    }

    openedWindow.opener = null;
    openedWindow.document.title = "Opening Kubernetes Dashboard";
    openedWindow.document.body.textContent =
      "正在读取 Dashboard Token，稍后会打开 Kubernetes Dashboard。";

    setState("loading");

    try {
      const response = await fetch("/api/system/k8s-dashboard-token", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json()) as DashboardTokenResponse;

      if (!response.ok || !payload.token) {
        throw new Error(
          payload.error ?? "读取 Kubernetes Dashboard Token 失败。",
        );
      }

      await navigator.clipboard.writeText(payload.token);
      openedWindow.location.replace(dashboardUrl);
      setState("copied");
      window.setTimeout(() => setState("idle"), 3200);
    } catch {
      openedWindow.close();
      setState("failed");
      window.setTimeout(() => setState("idle"), 4200);
    }
  }

  const text =
    state === "loading"
      ? "正在复制 Token..."
      : state === "copied"
        ? "Token 已复制"
        : state === "failed"
          ? "复制失败，请重试"
          : label;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("rounded-[12px]", className)}
      onClick={() => void copyTokenAndOpenDashboard()}
      disabled={state === "loading"}
    >
      {state === "loading" ? (
        <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
      ) : state === "copied" ? (
        <CopyCheckIcon data-icon="inline-start" />
      ) : (
        <ExternalLinkIcon data-icon="inline-start" />
      )}
      {text}
    </Button>
  );
}
