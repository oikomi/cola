"use client";

import {
  CrownIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserRoundCheckIcon,
  UsersRoundIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notifyError, notifySuccess } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";

type PermissionUser = RouterOutputs["auth"]["permissions"]["users"][number];
type UserRole = PermissionUser["role"];
type UserStatus = PermissionUser["status"];

const roleLabels = {
  admin: "管理员",
  operator: "操作员",
  viewer: "只读用户",
} satisfies Record<UserRole, string>;

const statusLabels = {
  active: "启用",
  disabled: "禁用",
} satisfies Record<UserStatus, string>;

function userFallback(
  user: Pick<PermissionUser, "name" | "email" | "feishuOpenId">,
) {
  const source = user.name ?? user.email ?? user.feishuOpenId;
  return source.slice(0, 1).toUpperCase();
}

function formatDate(value: Date | string | null) {
  if (!value) return "从未登录";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function roleBadgeClass(role: UserRole) {
  switch (role) {
    case "admin":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "operator":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function statusBadgeClass(status: UserStatus) {
  return status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function SelectControl({
  value,
  disabled,
  options,
  ariaLabel,
  testId,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  options: Array<{ label: string; value: string }>;
  ariaLabel: string;
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 min-w-28 rounded-[10px] border border-slate-200 bg-white px-2.5 text-sm text-slate-800 shadow-none transition outline-none focus:border-sky-300 focus:ring-3 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function PermissionManagementPanel() {
  const utils = api.useUtils();
  const permissionsQuery = api.auth.permissions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const bootstrapAdmin = api.auth.bootstrapAdmin.useMutation({
    onSuccess: async () => {
      notifySuccess("当前账号已初始化为管理员。");
      await utils.auth.permissions.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });
  const updateUser = api.auth.updateUser.useMutation({
    onSuccess: async (result) => {
      notifySuccess(
        `${result.label} 已更新为 ${roleLabels[result.role]} / ${statusLabels[result.status]}。`,
      );
      await utils.auth.permissions.invalidate();
    },
    onError: (error) => notifyError(error.message),
  });

  const permissions = permissionsQuery.data;
  const currentUser = permissions?.currentUser ?? null;
  const users = permissions?.users ?? [];
  const isMutating = bootstrapAdmin.isPending || updateUser.isPending;

  if (permissionsQuery.isLoading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-24 rounded-[var(--radius-card)]" />
        <Skeleton className="h-72 rounded-[var(--radius-card)]" />
      </div>
    );
  }

  if (permissionsQuery.isError) {
    return (
      <div className="rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
        权限信息读取失败：{permissionsQuery.error.message}
      </div>
    );
  }

  if (!permissions || !currentUser) return null;

  return (
    <div className="grid gap-4" data-testid="permission-management-panel">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-5 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                <ShieldIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">
                  当前账号：
                  {currentUser.name ??
                    currentUser.email ??
                    currentUser.feishuOpenId}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge
                    className={cn("border", roleBadgeClass(currentUser.role))}
                  >
                    {roleLabels[currentUser.role]}
                  </Badge>
                  <Badge
                    className={cn(
                      "border",
                      statusBadgeClass(currentUser.status),
                    )}
                  >
                    {statusLabels[currentUser.status]}
                  </Badge>
                  <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
                    {permissions.canManageUsers ? "可管理用户" : "无管理权限"}
                  </Badge>
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-[var(--radius-card)]"
              disabled={permissionsQuery.isFetching}
              onClick={() => void permissionsQuery.refetch()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              刷新
            </Button>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-slate-50/70 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <UsersRoundIcon className="size-4" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">权限层级</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                管理员可授权用户；操作员可创建和删除资源；只读用户只能查看。
              </p>
            </div>
          </div>
        </div>
      </div>

      {permissions.canBootstrapAdmin ? (
        <div className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <CrownIcon className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <p className="font-semibold text-amber-950">
                  还没有启用状态的管理员
                </p>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  当前登录用户可以初始化为管理员，之后只有管理员能继续调整权限。
                </p>
              </div>
            </div>
            <Button
              type="button"
              className="rounded-[var(--radius-card)] bg-amber-600 text-white hover:bg-amber-700"
              data-testid="bootstrap-admin-button"
              disabled={bootstrapAdmin.isPending}
              onClick={() => bootstrapAdmin.mutate()}
            >
              <ShieldCheckIcon data-icon="inline-start" />
              初始化当前用户为管理员
            </Button>
          </div>
        </div>
      ) : null}

      {!permissions.canManageUsers ? (
        <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-5 py-5">
          <div className="flex items-start gap-3">
            <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-slate-500" />
            <div>
              <p className="font-semibold text-slate-950">需要管理员权限</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                当前账号不能查看或修改用户权限。请让管理员把你的角色调整为管理员或操作员。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
            <div>
              <p className="font-semibold text-slate-950">用户权限</p>
              <p className="mt-1 text-sm text-slate-600">
                共 {users.length} 个飞书登录用户。
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table
              className="min-w-[860px]"
              data-testid="permission-user-table"
            >
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5">用户</TableHead>
                  <TableHead>租户</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近登录</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const isCurrentUser = user.id === currentUser.id;

                  return (
                    <TableRow
                      key={user.id}
                      data-testid={`permission-row-${user.id}`}
                    >
                      <TableCell className="px-5">
                        <div className="flex min-w-64 items-center gap-3">
                          <Avatar className="size-9">
                            {user.avatarUrl ? (
                              <AvatarImage
                                src={user.avatarUrl}
                                alt={user.name ?? ""}
                              />
                            ) : null}
                            <AvatarFallback>
                              {userFallback(user)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-950">
                                {user.name ?? user.email ?? user.feishuOpenId}
                              </p>
                              {isCurrentUser ? (
                                <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                                  <UserRoundCheckIcon data-icon="inline-start" />
                                  当前用户
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 max-w-[22rem] truncate font-mono text-xs text-slate-500">
                              {user.feishuOpenId}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {user.tenantKey}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn("border", roleBadgeClass(user.role))}
                          >
                            {roleLabels[user.role]}
                          </Badge>
                          <SelectControl
                            value={user.role}
                            disabled={isMutating}
                            ariaLabel={`调整 ${user.name ?? user.feishuOpenId} 的角色`}
                            testId={`role-select-${user.id}`}
                            options={[
                              { value: "admin", label: "管理员" },
                              { value: "operator", label: "操作员" },
                              { value: "viewer", label: "只读用户" },
                            ]}
                            onChange={(role) =>
                              updateUser.mutate({
                                userId: user.id,
                                role: role as UserRole,
                              })
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              "border",
                              statusBadgeClass(user.status),
                            )}
                          >
                            {statusLabels[user.status]}
                          </Badge>
                          <SelectControl
                            value={user.status}
                            disabled={isMutating || isCurrentUser}
                            ariaLabel={`调整 ${user.name ?? user.feishuOpenId} 的状态`}
                            testId={`status-select-${user.id}`}
                            options={[
                              { value: "active", label: "启用" },
                              { value: "disabled", label: "禁用" },
                            ]}
                            onChange={(status) =>
                              updateUser.mutate({
                                userId: user.id,
                                status: status as UserStatus,
                              })
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {formatDate(user.lastLoginAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
