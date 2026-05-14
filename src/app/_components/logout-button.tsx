"use client";

import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { notifyError } from "@/components/ui/toast";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        notifyError("退出登录请求失败，仍将返回登录页。");
      }
    } catch {
      notifyError("退出登录请求失败，仍将返回登录页。");
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon-sm" : "sm"}
      className="h-8 border border-white/8 bg-white/[0.045] px-2 text-[11px] text-slate-200/82 hover:bg-white/[0.075] hover:text-white [&_svg:not([class*='size-'])]:size-3.5"
      disabled={pending}
      onClick={logout}
      aria-label="退出登录"
    >
      <LogOutIcon data-icon="inline-start" />
      {compact ? null : "退出"}
    </Button>
  );
}
