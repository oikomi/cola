"use client";

import { UserRoundIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type ResourceOwnerInfo = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  displayName: string;
};

type ResourceOwnerValue = {
  ownerUserId?: string | null;
  ownerUser?: ResourceOwnerInfo | null;
};

function ownerFallback(owner: ResourceOwnerInfo | null | undefined) {
  const source = owner?.displayName ?? owner?.name ?? owner?.email ?? "U";
  return source.trim().slice(0, 1).toUpperCase() || "U";
}

function compactOwnerId(ownerUserId: string | null | undefined) {
  if (!ownerUserId) return "未记录";
  return ownerUserId.length > 12
    ? `${ownerUserId.slice(0, 8)}...${ownerUserId.slice(-4)}`
    : ownerUserId;
}

export function resourceOwnerLabel(
  value: ResourceOwnerValue | null | undefined,
) {
  return (
    value?.ownerUser?.displayName ??
    value?.ownerUser?.name ??
    value?.ownerUser?.email ??
    compactOwnerId(value?.ownerUserId)
  );
}

export function ResourceOwnerBadge({
  value,
  label = "创建人",
  compact = false,
  className,
}: {
  value: ResourceOwnerValue | null | undefined;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const owner = value?.ownerUser ?? null;
  const text = resourceOwnerLabel(value);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/90 px-2 py-0.5 text-[12px] leading-5 text-slate-600",
        className,
      )}
      title={`${label}: ${text}`}
    >
      {owner ? (
        <Avatar className="size-4 shrink-0">
          {owner.avatarUrl ? (
            <AvatarImage src={owner.avatarUrl} alt={owner.displayName} />
          ) : null}
          <AvatarFallback className="text-[9px]">
            {ownerFallback(owner)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <UserRoundIcon className="size-3.5 shrink-0 text-slate-400" />
      )}
      <span className="shrink-0 text-slate-500">
        {compact ? `${label}:` : label}
      </span>
      <span className="min-w-0 truncate font-medium text-slate-800">
        {text}
      </span>
    </span>
  );
}
