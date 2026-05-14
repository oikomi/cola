"use client";

import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { notifyError } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

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
      className={cn(
        "h-9 rounded-[var(--radius-card)] border border-white/10 bg-slate-950/20 px-2.5 text-[12px] text-slate-200/86 hover:bg-white/[0.075] hover:text-white [&_svg:not([class*='size-'])]:size-4",
        compact && "size-8 px-0",
      )}
      disabled={pending}
      onClick={logout}
      aria-label="退出登录"
    >
      <LogOutIcon data-icon="inline-start" />
      {compact ? null : "退出"}
    </Button>
  );
}
