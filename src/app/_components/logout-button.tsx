"use client";

import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
      });
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
      className="h-7 border border-white/8 bg-white/[0.045] px-2 text-xs text-slate-200/78 hover:bg-white/[0.075] hover:text-white"
      disabled={pending}
      onClick={logout}
      aria-label="退出登录"
    >
      <LogOutIcon data-icon="inline-start" />
      {compact ? null : "退出"}
    </Button>
  );
}
