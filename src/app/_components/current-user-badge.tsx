"use client";

import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { notifyError } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { LogoutButton } from "./logout-button";

type CurrentUser = {
  avatarUrl: string | null;
  email: string | null;
  name: string | null;
  role: "admin" | "operator" | "viewer";
};

type CurrentUserResponse = {
  user?: CurrentUser;
};

function userFallback(name: string | null, email: string | null) {
  const source = name ?? email ?? "U";
  return source.slice(0, 1).toUpperCase();
}

export function CurrentUserBadge() {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let canceled = false;

    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as CurrentUserResponse;
        return payload.user ?? null;
      })
      .then((nextUser) => {
        if (!canceled) setUser(nextUser);
      })
      .catch(() => {
        if (!canceled) setUser(null);
        notifyError({
          title: "用户信息读取失败",
          message: "无法读取当前登录用户信息。",
        });
      });

    return () => {
      canceled = true;
    };
  }, []);

  const displayName = user?.name ?? user?.email ?? "Feishu User";

  return (
    <div
      className="relative shrink-0 border-t border-white/[0.1] px-2.5 py-2.5 2xl:px-2.5 2xl:py-2.5"
      aria-busy={user ? undefined : true}
    >
      <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/[0.1] bg-white/[0.05] px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex-col md:justify-center md:px-1.5 2xl:grid 2xl:grid-cols-[2.25rem_minmax(0,1fr)_auto] 2xl:px-2">
        <Avatar className="size-8">
          {user?.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
          ) : null}
          <AvatarFallback
            className={cn(!user && "bg-white/10 text-transparent")}
          >
            {user ? userFallback(user.name, user.email) : "U"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 md:hidden 2xl:block">
          <p className="truncate text-[13px] leading-5 font-semibold text-white">
            {user ? displayName : "\u00a0"}
          </p>
          <p className="truncate text-[11px] leading-4 font-medium text-slate-300/76">
            {user?.role ?? "\u00a0"}
          </p>
        </div>
        <div className="hidden 2xl:block">
          {user ? <LogoutButton /> : <LogoutButton inert />}
        </div>
        <div className="2xl:hidden">
          {user ? <LogoutButton compact /> : <LogoutButton compact inert />}
        </div>
      </div>
    </div>
  );
}
