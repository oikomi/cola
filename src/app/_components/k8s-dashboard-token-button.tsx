"use client";

import {
  CopyCheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  const [manualToken, setManualToken] = useState("");
  const [failureReason, setFailureReason] = useState("");

  async function writeTokenToClipboard(token: string) {
    if (!navigator.clipboard?.writeText) {
      throw new Error(
        "当前浏览器环境不允许自动写入剪贴板，请在弹窗中手动复制 Token。",
      );
    }

    await navigator.clipboard.writeText(token);
  }

  function prepareDashboardWindow() {
    const openedWindow = window.open("about:blank", "_blank");

    if (!openedWindow) {
      return null;
    }

    openedWindow.opener = null;
    openedWindow.document.title = "Opening Kubernetes Dashboard";
    openedWindow.document.body.textContent =
      "正在读取 Dashboard Token，稍后会打开 Kubernetes Dashboard。";

    return openedWindow;
  }

  function openDashboard(openedWindow?: Window | null) {
    if (openedWindow && !openedWindow.closed) {
      openedWindow.location.replace(dashboardUrl);
      return;
    }

    window.open(dashboardUrl, "_blank", "noopener,noreferrer");
  }

  function failWithReason(reason: string, token = "") {
    setFailureReason(reason);
    setManualToken(token);
    setState("failed");
  }

  async function copyTokenAndOpenDashboard() {
    if (typeof window === "undefined") return;

    const openedWindow = prepareDashboardWindow();

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

      try {
        await writeTokenToClipboard(payload.token);
      } catch (error) {
        openedWindow?.close();
        failWithReason(
          error instanceof Error
            ? error.message
            : "当前浏览器没有允许自动复制 Token，请手动复制后打开 Dashboard。",
          payload.token,
        );
        return;
      }

      openDashboard(openedWindow);
      setState("copied");
      window.setTimeout(() => setState("idle"), 3200);
    } catch (error) {
      openedWindow?.close();
      failWithReason(
        error instanceof Error
          ? error.message
          : "读取 Kubernetes Dashboard Token 失败。",
      );
    }
  }

  async function copyManualToken() {
    if (!manualToken) return;

    try {
      await writeTokenToClipboard(manualToken);
      setState("copied");
      setManualToken("");
      setFailureReason("");
      window.setTimeout(() => setState("idle"), 3200);
    } catch (error) {
      setFailureReason(
        error instanceof Error
          ? error.message
          : "当前浏览器没有允许自动复制 Token，请手动选中复制。",
      );
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
    <>
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

      <Dialog
        open={state === "failed"}
        onOpenChange={(open) => {
          if (!open) {
            setState("idle");
            setManualToken("");
            setFailureReason("");
          }
        }}
      >
        <DialogContent className="max-w-[min(680px,calc(100vw-1rem))] border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.14)]">
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4">
            <DialogTitle className="text-lg leading-6 font-semibold tracking-normal">
              Dashboard Token 未能自动复制
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-slate-600">
              {failureReason ||
                "浏览器没有允许自动写入剪贴板，请手动复制 Token 后打开 Dashboard。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-5 py-4">
            {manualToken ? (
              <div className="grid gap-2">
                <label
                  htmlFor="k8s-dashboard-token"
                  className="text-[12px] font-medium tracking-[0.14em] text-slate-500 uppercase"
                >
                  Dashboard Token
                </label>
                <Textarea
                  id="k8s-dashboard-token"
                  readOnly
                  value={manualToken}
                  onFocus={(event) => event.currentTarget.select()}
                  className="max-h-[220px] min-h-[132px] resize-y bg-slate-50 font-mono text-xs leading-5 text-slate-800"
                />
                <p className="text-xs leading-5 text-slate-500">
                  如果自动复制仍被浏览器拦截，点击文本框后使用系统复制快捷键。
                </p>
              </div>
            ) : (
              <div className="rounded-[14px] border border-rose-200/80 bg-rose-50/60 px-4 py-3 text-sm leading-6 text-rose-700">
                Token 读取失败，请先处理上方错误后重试。
              </div>
            )}
          </div>

          <DialogFooter className="bg-slate-50/80 px-5 py-4">
            {manualToken ? (
              <Button variant="outline" onClick={() => void copyManualToken()}>
                <CopyIcon data-icon="inline-start" />
                再试一次复制
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => openDashboard()}
              disabled={!manualToken}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              打开 Dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
