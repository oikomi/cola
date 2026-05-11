"use client";

import { useEffect } from "react";

import { notifyError } from "@/components/ui/toast";

export function LoginErrorToast({ message }: { message: string | null }) {
  useEffect(() => {
    if (!message) return;
    notifyError({
      title: "登录失败",
      message,
    });
  }, [message]);

  return null;
}
