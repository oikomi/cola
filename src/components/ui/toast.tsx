"use client";

import {
  CheckCircle2Icon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Toaster, toast } from "sonner";

type ToastMessage = {
  title?: string;
  message: string;
};

function normalizeToastMessage(input: string | ToastMessage): ToastMessage {
  return typeof input === "string" ? { message: input } : input;
}

function notify(
  tone: "success" | "error" | "info",
  input: string | ToastMessage,
) {
  const { title, message } = normalizeToastMessage(input);
  const defaults = {
    success: "操作完成",
    error: "操作失败",
    info: "系统通知",
  } satisfies Record<typeof tone, string>;

  toast.custom(
    (id) => (
      <div
        className="border-border bg-popover text-popover-foreground grid w-[min(420px,calc(100vw-2rem))] grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-[var(--radius-card)] border px-4 py-3 shadow-[0_18px_54px_rgba(15,23,42,0.18)]"
        role={tone === "error" ? "alert" : "status"}
      >
        <span
          className={
            tone === "success"
              ? "mt-0.5 text-emerald-600"
              : tone === "error"
                ? "text-destructive mt-0.5"
                : "mt-0.5 text-sky-600"
          }
        >
          {tone === "success" ? (
            <CheckCircle2Icon className="size-4" />
          ) : tone === "error" ? (
            <TriangleAlertIcon className="size-4" />
          ) : (
            <InfoIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm leading-5 font-semibold tracking-normal">
            {title ?? defaults[tone]}
          </p>
          <p className="text-muted-foreground mt-1 text-sm leading-5 break-words">
            {message}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭通知"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-[var(--radius-control)] transition"
          onClick={() => toast.dismiss(id)}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    ),
    {
      duration: tone === "error" ? 5600 : 3200,
    },
  );
}

export function notifySuccess(input: string | ToastMessage) {
  notify("success", input);
}

export function notifyError(input: string | ToastMessage) {
  notify("error", input);
}

export function notifyInfo(input: string | ToastMessage) {
  notify("info", input);
}

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      closeButton={false}
      expand
      richColors={false}
      visibleToasts={4}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "group",
        },
      }}
    />
  );
}
