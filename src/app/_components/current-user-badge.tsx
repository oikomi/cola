"use client";

import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
      });

    return () => {
      canceled = true;
    };
  }, []);

  if (!user) return null;

  return (
    <div className="relative border-t border-white/[0.08] px-2.5 py-2.5 2xl:px-3.5">
      <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/[0.08] bg-white/[0.045] px-2.5 py-2">
        <Avatar className="size-8">
          {user.avatarUrl ? (
            <AvatarImage src={user.avatarUrl} alt={user.name ?? ""} />
          ) : null}
          <AvatarFallback>{userFallback(user.name, user.email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 md:hidden 2xl:block">
          <p className="truncate text-[12px] leading-4 font-semibold text-white">
            {user.name ?? user.email ?? "Feishu User"}
          </p>
          <p className="truncate text-[10px] leading-4 text-slate-300/62">
            {user.role}
          </p>
        </div>
        <div className="hidden 2xl:block">
          <LogoutButton />
        </div>
        <div className="2xl:hidden">
          <LogoutButton compact />
        </div>
      </div>
    </div>
  );
}
