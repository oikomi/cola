"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  KeyRoundIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ScrollTextIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import { ModulePageShell, ModuleSection } from "@/app/_components/module-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";

type DashboardData = RouterOutputs["cmdb"]["dashboard"];
type AssetRow = DashboardData["assets"][number];
type ProjectRow = DashboardData["projects"][number];
type ReleaseRow = DashboardData["releases"][number];
type GitLabCatalogRow = RouterOutputs["cmdb"]["gitlabCatalog"][number];
type TopicReleaseResult = RouterOutputs["cmdb"]["triggerTopicRelease"];
type ProjectOperationResult = RouterOutputs["cmdb"]["projectOperation"];
type ProjectOperationAction = "dockerStatus" | "dockerLogs" | "sshInfo";
type TerminalSessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";
type TerminalSessionInfo = {
  sessionId: string;
  projectId: number;
  projectName: string;
  deployTarget: ProjectRow["deployTarget"];
  targetAssetName: string;
  host: string;
  sshUser: string;
  sshPort: number;
  containerName: string | null;
  startedAt: string;
};
type TerminalSessionEvent =
  | {
      type: "output";
      data: string;
    }
  | {
      type: "status";
      status: Exclude<TerminalSessionStatus, "idle" | "error">;
      message: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "exit";
      code: number | null;
      signal: string | null;
      message: string;
    };

const UNASSIGNED_VALUE = "__unassigned__";
const UNSET_ARCH_VALUE = "__unset_arch__";
const CUSTOM_ARCH_VALUE = "__custom_arch__";
const STICKY_ACTION_HEAD_CLASS =
  "sticky right-0 z-20 bg-slate-50/95 text-right shadow-[-18px_0_24px_-24px_rgba(15,23,42,0.55)] backdrop-blur";
const STICKY_ACTION_CELL_CLASS =
  "sticky right-0 z-10 bg-white/96 shadow-[-18px_0_24px_-24px_rgba(15,23,42,0.45)] backdrop-blur group-hover:bg-sky-50/95";
const CMDB_ACTION_GROUP_CLASS =
  "inline-flex overflow-hidden rounded-[9px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const CMDB_ACTION_ICON_CLASS =
  "size-8 rounded-none border-0 border-r border-slate-200 bg-transparent text-slate-700 shadow-none last:border-r-0 hover:bg-slate-50 hover:text-slate-950";
const TERMINAL_OUTPUT_LIMIT = 120_000;
const ANSI_ESCAPE_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
type CmdbAreaKey = "assets" | "projects" | "deployments";
type ProjectDraftPanelKey = "basic" | "deploy" | "observe" | "variables";

const projectDraftPanels: Array<{
  key: ProjectDraftPanelKey;
  label: string;
  summary: string;
  icon: LucideIcon;
}> = [
  {
    key: "basic",
    label: "基础",
    summary: "名称与路径",
    icon: GitBranchIcon,
  },
  {
    key: "deploy",
    label: "部署",
    summary: "目标与参数",
    icon: RocketIcon,
  },
  {
    key: "observe",
    label: "观测",
    summary: "健康与监控",
    icon: ActivityIcon,
  },
  {
    key: "variables",
    label: "变量",
    summary: "流水线默认值",
    icon: CircleDotIcon,
  },
];

type ProjectDraft = {
  id?: number;
  name: string;
  gitlabPath: string;
  description: string;
  defaultBranch: string;
  enabled: "true" | "false";
  deployTarget: "k8s" | "ssh" | "docker" | "none";
  targetAssetNames: string[];
  deployEnv: string;
  healthUrl: string;
  monitorUrl: string;
  k8sNamespace: string;
  k8sDeployment: string;
  dockerImage: string;
  sshPath: string;
  sshDeployCommand: string;
  triggerToken: string;
  customVariablesText: string;
};

type AssetDraft = {
  id?: number;
  name: string;
  ip: string;
  sshUser: string;
  sshPassword: string;
  sshPort: string;
  rolesText: string;
  arch: string;
  status: "connected" | "planned" | "unknown";
};

type ReleaseDraft = {
  projectId?: number;
  projectName: string;
  ref: string;
  deployEnv: string;
  variablesText: string;
};

type TopicReleaseDraft = {
  topic: string;
  projectIds: number[];
  ref: string;
  deployEnv: string;
  variablesText: string;
};

function emptyProjectDraft(): ProjectDraft {
  return {
    name: "",
    gitlabPath: "",
    description: "",
    defaultBranch: "main",
    enabled: "true",
    deployTarget: "docker",
    targetAssetNames: [],
    deployEnv: "prod",
    healthUrl: "",
    monitorUrl: "",
    k8sNamespace: "default",
    k8sDeployment: "",
    dockerImage: "",
    sshPath: "",
    sshDeployCommand: "",
    triggerToken: "",
    customVariablesText: "",
  };
}

function emptyAssetDraft(): AssetDraft {
  return {
    name: "",
    ip: "",
    sshUser: "",
    sshPassword: "",
    sshPort: "22",
    rolesText: "",
    arch: "",
    status: "planned",
  };
}

function emptyReleaseDraft(): ReleaseDraft {
  return {
    projectName: "",
    ref: "main",
    deployEnv: "prod",
    variablesText: "",
  };
}

function emptyTopicReleaseDraft(): TopicReleaseDraft {
  return {
    topic: "",
    projectIds: [],
    ref: "",
    deployEnv: "",
    variablesText: "",
  };
}

function serializeVariables(
  variables: Record<string, string> | null | undefined,
) {
  return Object.entries(variables ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseVariables(raw: string) {
  return Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map<[string, string]>((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex < 0) {
          return [line, ""];
        }

        return [
          line.slice(0, separatorIndex).trim(),
          line.slice(separatorIndex + 1).trim(),
        ];
      })
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function serializeAssetRoles(roles: string[] | null | undefined) {
  return (roles ?? []).join(", ");
}

function parseAssetRoles(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeTargetAssetNames(
  assetNames: string[] | null | undefined,
  fallbackName?: string | null,
) {
  const normalized = [
    ...(assetNames ?? []),
    ...(fallbackName ? [fallbackName] : []),
  ]
    .map((assetName) => assetName.trim())
    .filter(
      (assetName) => assetName.length > 0 && assetName !== UNASSIGNED_VALUE,
    );

  return Array.from(new Set(normalized));
}

function parseSshPort(raw: string) {
  const normalized = raw.trim();
  if (normalized.length === 0) return 22;
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number.parseInt(normalized, 10);
  return parsed >= 1 && parsed <= 65535 ? parsed : null;
}

function assetDraftFromRow(asset: AssetRow): AssetDraft {
  return {
    id: asset.id,
    name: asset.name,
    ip: asset.ip,
    sshUser: asset.sshUser ?? "",
    sshPassword: asset.sshPassword ?? "",
    sshPort: String(asset.sshPort ?? 22),
    rolesText: serializeAssetRoles(asset.roles),
    arch: asset.arch ?? "",
    status: asset.status,
  };
}

function projectDraftFromRow(project: ProjectRow): ProjectDraft {
  return {
    id: project.id,
    name: project.name,
    gitlabPath: project.gitlabPath,
    description: project.description ?? "",
    defaultBranch: project.defaultBranch,
    enabled: project.enabled ? "true" : "false",
    deployTarget: project.deployTarget,
    targetAssetNames: normalizeTargetAssetNames(
      project.config?.targetAssetNames,
      project.config?.targetAssetName,
    ),
    deployEnv: project.config?.deployEnv ?? "prod",
    healthUrl: project.config?.healthUrl ?? "",
    monitorUrl: project.config?.monitorUrl ?? "",
    k8sNamespace: project.config?.k8sNamespace ?? "default",
    k8sDeployment: project.config?.k8sDeployment ?? "",
    dockerImage: project.config?.dockerImage ?? "",
    sshPath: project.config?.sshPath ?? "",
    sshDeployCommand: project.config?.sshDeployCommand ?? "",
    triggerToken: project.config?.triggerToken ?? "",
    customVariablesText: serializeVariables(project.config?.customVariables),
  };
}

function releaseDraftFromRow(project: ProjectRow): ReleaseDraft {
  return {
    projectId: project.id,
    projectName: project.name,
    ref: project.defaultBranch,
    deployEnv: project.config?.deployEnv ?? "prod",
    variablesText: "",
  };
}

function formatTime(value: Date | string | number | null | undefined) {
  if (!value) return "刚刚";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deployTargetLabel(value: ProjectRow["deployTarget"]) {
  switch (value) {
    case "k8s":
      return "Kubernetes";
    case "ssh":
      return "SSH";
    case "docker":
      return "Docker";
    default:
      return "未指定";
  }
}

function assetStatusTone(status: AssetRow["status"]) {
  switch (status) {
    case "connected":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "planned":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function assetStatusLabel(status: AssetRow["status"]) {
  switch (status) {
    case "connected":
      return "已接入";
    case "planned":
      return "待接入";
    default:
      return "未知";
  }
}

function monitorTone(status: ProjectRow["monitor"]["status"]) {
  switch (status) {
    case "healthy":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "degraded":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function monitorLabel(status: ProjectRow["monitor"]["status"]) {
  switch (status) {
    case "healthy":
      return "健康";
    case "degraded":
      return "异常";
    default:
      return "未配置";
  }
}

function releaseTone(status: ReleaseRow["status"]) {
  switch (status) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function releaseLabel(status: ReleaseRow["status"]) {
  switch (status) {
    case "success":
      return "成功";
    case "running":
      return "运行中";
    case "pending":
      return "排队中";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return status;
  }
}

function releaseTopic(release: Pick<ReleaseRow, "variables">) {
  const topic = release.variables?.CMDB_RELEASE_TOPIC?.trim();
  return topic && topic.length > 0 ? topic : null;
}

function topicReleaseStatusTone(status: ReleaseRow["status"] | "skipped") {
  if (status === "skipped") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }

  return releaseTone(status);
}

function topicReleaseStatusLabel(status: ReleaseRow["status"] | "skipped") {
  if (status === "skipped") return "已跳过";
  return releaseLabel(status);
}

function projectStatusLabel(value: ProjectDraft["enabled"]) {
  return value === "true" ? "启用" : "禁用";
}

function draftDeployTargetLabel(value: ProjectDraft["deployTarget"]) {
  switch (value) {
    case "k8s":
      return "Kubernetes";
    case "ssh":
      return "SSH";
    case "docker":
      return "Docker";
    default:
      return "未指定";
  }
}

function targetAssetsLabel(assetNames: string[]) {
  if (assetNames.length === 0) return "未指定资产";
  if (assetNames.length === 1) return assetNames[0]!;
  return `${assetNames.length} 台资产`;
}

function isGitLabProjectPath(value: string) {
  return /^[^\s/]+(?:\/[^\s/]+)+$/.test(value.trim());
}

function projectTargetAssetNames(config: ProjectRow["config"]) {
  return normalizeTargetAssetNames(
    config?.targetAssetNames,
    config?.targetAssetName,
  );
}

function projectTargetAssetsLabel(config: ProjectRow["config"]) {
  const assetNames = projectTargetAssetNames(config);
  return assetNames.length > 0 ? assetNames.join(", ") : "未指定资产";
}

function projectDraftSshDeploymentIssue(draft: ProjectDraft) {
  if (draft.deployTarget !== "ssh") return null;

  if (draft.targetAssetNames.length === 0) {
    return "SSH 发布需要至少选择一台目标资产。";
  }

  return null;
}

function savedProjectSshDeploymentIssue(project: ProjectRow) {
  if (project.deployTarget !== "ssh") return null;

  if (projectTargetAssetNames(project.config).length === 0) {
    return "SSH 发布需要至少选择一台目标资产。";
  }

  return null;
}

function projectReleaseIssue(
  project: ProjectRow,
  canTriggerPipelines: boolean,
) {
  if (!canTriggerPipelines) {
    return "GitLab 未配置，无法触发 .gitlab-ci.yml。";
  }

  return savedProjectSshDeploymentIssue(project);
}

function projectOperationIssue(
  project: ProjectRow,
  action: ProjectOperationAction,
) {
  if (projectTargetAssetNames(project.config).length === 0) {
    return "项目未配置目标资产。";
  }

  if (action !== "sshInfo" && project.deployTarget !== "docker") {
    return "当前仅 Docker 部署项目支持查看容器状态和日志。";
  }

  return null;
}

function releaseOperationIssue(
  release: ReleaseRow,
  action: ProjectOperationAction,
) {
  if (!release.project) {
    return "发布记录缺少项目信息。";
  }

  if (action !== "sshInfo" && release.project.deployTarget !== "docker") {
    return "当前仅 Docker 部署项目支持查看容器状态和日志。";
  }

  return null;
}

function projectOperationLabel(
  action: ProjectOperationAction,
  deployTarget?: ProjectRow["deployTarget"],
) {
  switch (action) {
    case "dockerStatus":
      return "容器状态";
    case "dockerLogs":
      return "运行日志";
    case "sshInfo":
      return deployTarget === "docker" ? "容器登录" : "远程登录";
  }
}

function projectOperationDescription(
  action: ProjectOperationAction,
  deployTarget?: ProjectRow["deployTarget"],
) {
  switch (action) {
    case "dockerStatus":
      return "通过目标资产 SSH 执行 docker ps / docker inspect，查看当前容器运行状态。";
    case "dockerLogs":
      return "通过目标资产 SSH 执行 docker logs，读取最近运行日志。";
    case "sshInfo":
      return deployTarget === "docker"
        ? "自动登录目标资产并执行 docker exec，打开容器内终端。"
        : "自动登录目标资产，打开远程终端。";
  }
}

function remoteLoginLabel(deployTarget?: ProjectRow["deployTarget"]) {
  return deployTarget === "docker" ? "容器登录" : "远程登录";
}

function operationResultText(result: ProjectOperationResult | null) {
  if (!result) return "";

  const parts = [
    result.stdout.trim(),
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
  ].filter(Boolean);

  return parts.join("\n\n");
}

function normalizeTerminalOutput(value: string) {
  return value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\u0007/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function terminalStatusLabel(status: TerminalSessionStatus) {
  switch (status) {
    case "connecting":
      return "登录中";
    case "connected":
      return "已登录";
    case "closed":
      return "已断开";
    case "error":
      return "失败";
    case "idle":
      return "-";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTerminalSessionEvent(data: string): TerminalSessionEvent {
  const value = JSON.parse(data) as unknown;

  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid terminal event");
  }

  switch (value.type) {
    case "output":
      if (typeof value.data !== "string") {
        throw new Error("Invalid terminal output event");
      }
      return { type: "output", data: value.data };
    case "status":
      if (
        value.status !== "connecting" &&
        value.status !== "connected" &&
        value.status !== "closed"
      ) {
        throw new Error("Invalid terminal status event");
      }
      return {
        type: "status",
        status: value.status,
        message: typeof value.message === "string" ? value.message : "",
      };
    case "error":
      return {
        type: "error",
        message: typeof value.message === "string" ? value.message : "终端错误",
      };
    case "exit":
      return {
        type: "exit",
        code: typeof value.code === "number" ? value.code : null,
        signal: typeof value.signal === "string" ? value.signal : null,
        message:
          typeof value.message === "string"
            ? value.message
            : "远程终端已退出。",
      };
    default:
      throw new Error("Unknown terminal event");
  }
}

function ratioLabel(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function CmdbOverviewCard(props: {
  label: string;
  value: string;
  description: string;
  icon: LucideIcon;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  const Icon = props.icon;
  const toneClassName = {
    neutral: "bg-slate-100 text-slate-600 ring-slate-200",
    good: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
  }[props.tone ?? "neutral"];

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[10.5px] leading-4 font-medium text-slate-500">
          {props.label}
        </p>
        <div className="mt-1 flex min-w-0 items-baseline gap-2">
          <p className="text-[1.18rem] leading-none font-semibold tracking-[-0.03em] text-slate-950">
            {props.value}
          </p>
          <p className="truncate text-[11.5px] leading-5 text-slate-500">
            {props.description}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[8px] ring-1",
          toneClassName,
        )}
      >
        <Icon className="size-3.5" />
      </div>
    </div>
  );
}

function CmdbErrorPanel({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <section className="rounded-[16px] border border-rose-200/90 bg-rose-50/70 px-5 py-4 text-rose-950">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white text-rose-700 ring-1 ring-rose-200">
            <AlertTriangleIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">CMDB 数据暂不可用</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-rose-800/86">
              {message}
            </p>
            <p className="mt-2 text-xs leading-5 text-rose-700/78">
              页面会保留当前操作入口；确认数据库连接、迁移状态或服务日志后可以手动重试。
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="rounded-[10px] border-rose-200 bg-white text-rose-800 hover:bg-rose-100"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? (
            <LoaderCircleIcon
              className="animate-spin"
              data-icon="inline-start"
            />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          重新加载
        </Button>
      </div>
    </section>
  );
}

function CmdbOfflineWorkspace({
  onCreateAsset,
  onCreateProject,
  onRetry,
  isRetrying,
}: {
  onCreateAsset: () => void;
  onCreateProject: () => void;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <section className="grid gap-4 rounded-[18px] border border-slate-200/90 bg-white/88 px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.04)] md:px-6">
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.03em] text-slate-950">
            CMDB 工作区离线
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            数据库恢复后会显示资产、项目和发布记录。当前仍可打开录入表单准备配置。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-[10px]"
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            重新加载
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[10px]"
            onClick={onCreateAsset}
          >
            <ServerIcon data-icon="inline-start" />
            新增资产
          </Button>
          <Button
            size="sm"
            className="rounded-[10px]"
            onClick={onCreateProject}
          >
            <PlusIcon data-icon="inline-start" />
            纳管项目
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {[
          {
            title: "数据库连接",
            description:
              "当前请求返回连接聚合错误，优先确认本地 Postgres 容器或 DATABASE_URL 指向的服务是否可达。",
          },
          {
            title: "迁移状态",
            description:
              "数据库恢复后运行迁移，确保 cmdb_asset、cmdb_project 和 cmdb_release 表已创建。",
          },
          {
            title: "页面行为",
            description:
              "失败后停止自动轮询，避免持续刷错；点击重新加载会再次请求最新 CMDB 状态。",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-[14px] border border-slate-200/90 bg-slate-50 px-4 py-4"
          >
            <p className="text-sm font-semibold text-slate-950">{item.title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CmdbStatusDot({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      <CircleDotIcon className={cn("size-3", className)} />
      {label}
    </span>
  );
}

function ProjectDraftField(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const isAsciiLabel = /^[\x00-\x7F\s()/+._-]+$/.test(props.label);

  return (
    <label className={cn("grid gap-2", props.className)}>
      <span
        className={cn(
          "font-medium text-slate-700",
          isAsciiLabel
            ? "text-[11px] tracking-[0.12em] uppercase"
            : "text-[13px] tracking-normal",
        )}
      >
        {props.label}
      </span>
      {props.children}
      {props.hint ? (
        <span className="text-xs leading-5 text-slate-500">{props.hint}</span>
      ) : null}
    </label>
  );
}

function assetConnectivityTone(
  status: "connected" | "planned" | "unknown",
  tested: boolean,
) {
  if (!tested) {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }

  switch (status) {
    case "connected":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "unknown":
    case "planned":
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function AssetReadinessItem(props: {
  ok: boolean;
  label: string;
  description: string;
}) {
  const Icon = props.ok ? CheckCircle2Icon : CircleDotIcon;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-[12px] border px-3 py-3",
        props.ok
          ? "border-emerald-200 bg-emerald-50/70"
          : "border-slate-200 bg-white",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          props.ok
            ? "bg-emerald-100 text-emerald-700"
            : "bg-slate-100 text-slate-400",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            props.ok ? "text-emerald-900" : "text-slate-800",
          )}
        >
          {props.label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs leading-5",
            props.ok ? "text-emerald-700" : "text-slate-500",
          )}
        >
          {props.description}
        </p>
      </div>
    </div>
  );
}

function CmdbEmptyState(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  hints?: string[];
}) {
  const Icon = props.icon;
  const hints = props.hints ?? [
    "确认数据源和权限配置",
    "补齐必要的运行参数",
    "保存后回到列表检查状态",
  ];

  return (
    <div className="grid gap-5 rounded-[14px] border border-dashed border-slate-300/90 bg-slate-50/72 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
      <div className="flex min-w-0 gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950">
            {props.title}
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {props.description}
          </p>
          {props.action ? <div className="mt-4">{props.action}</div> : null}
        </div>
      </div>

      <div className="rounded-[12px] border border-slate-200/90 bg-white px-4 py-4">
        <p className="text-xs font-semibold tracking-[0.08em] text-slate-500 uppercase">
          下一步
        </p>
        <div className="mt-3 grid gap-2.5">
          {hints.map((hint, index) => (
            <div
              key={hint}
              className="flex items-start gap-2 text-sm leading-5 text-slate-600"
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                {index + 1}
              </span>
              <span>{hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="rounded-[var(--radius-shell)] border border-slate-200/90 bg-white/84 px-5 py-5 shadow-[0_18px_56px_rgba(15,23,42,0.055)] md:px-6">
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="grid gap-2">
          <Skeleton className="h-6 w-32 rounded-md" />
          <Skeleton className="h-4 w-72 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-8 w-28 rounded-[10px]" />
      </div>
      <div className="grid gap-3 pt-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={`cmdb-row-${index}`} className="h-16 rounded-[12px]" />
        ))}
      </div>
    </div>
  );
}

export function CmdbShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [topicReleaseDialogOpen, setTopicReleaseDialogOpen] = useState(false);
  const [operationDialogOpen, setOperationDialogOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<CmdbAreaKey>("assets");
  const [projectDraftPanel, setProjectDraftPanel] =
    useState<ProjectDraftPanelKey>("basic");
  const [assetDraft, setAssetDraft] = useState<AssetDraft>(emptyAssetDraft);
  const [assetRoleInput, setAssetRoleInput] = useState("");
  const [assetConnectionResult, setAssetConnectionResult] = useState<{
    status: "connected" | "unknown";
    message: string;
    durationMs: number;
  } | null>(null);
  const [projectDraft, setProjectDraft] =
    useState<ProjectDraft>(emptyProjectDraft);
  const [releaseDraft, setReleaseDraft] =
    useState<ReleaseDraft>(emptyReleaseDraft);
  const [topicReleaseDraft, setTopicReleaseDraft] = useState<TopicReleaseDraft>(
    emptyTopicReleaseDraft,
  );
  const [topicReleaseResult, setTopicReleaseResult] =
    useState<TopicReleaseResult | null>(null);
  const [operationProject, setOperationProject] = useState<ProjectRow | null>(
    null,
  );
  const [operationAction, setOperationAction] =
    useState<ProjectOperationAction>("dockerStatus");
  const [operationResult, setOperationResult] =
    useState<ProjectOperationResult | null>(null);
  const [operationCopied, setOperationCopied] = useState(false);
  const [operationDialogMaximized, setOperationDialogMaximized] =
    useState(false);
  const [terminalSession, setTerminalSession] =
    useState<TerminalSessionInfo | null>(null);
  const [terminalStatus, setTerminalStatus] =
    useState<TerminalSessionStatus>("idle");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const terminalEventSourceRef = useRef<EventSource | null>(null);
  const terminalSessionIdRef = useRef<string | null>(null);
  const terminalStartTokenRef = useRef(0);
  const terminalWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const terminalScrollRef = useRef<HTMLPreElement | null>(null);
  const [gitlabSearch, setGitlabSearch] = useState("");
  const deferredGitlabSearch = useDeferredValue(gitlabSearch.trim());

  const dashboardQuery = api.cmdb.dashboard.useQuery(undefined, {
    refetchOnWindowFocus: true,
    retry: 1,
    refetchInterval: (query) => (query.state.error ? false : 15000),
    refetchIntervalInBackground: false,
  });

  const gitlabCatalogQuery = api.cmdb.gitlabCatalog.useQuery(
    { query: deferredGitlabSearch || undefined },
    {
      enabled:
        projectDialogOpen &&
        Boolean(dashboardQuery.data?.gitlab.canBrowseCatalog),
      refetchOnWindowFocus: false,
    },
  );

  const saveProject = api.cmdb.saveProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.cmdb.dashboard.invalidate(),
        utils.cmdb.gitlabCatalog.invalidate(),
      ]);
      setProjectDialogOpen(false);
      setProjectDraft(emptyProjectDraft());
      setProjectDraftPanel("basic");
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const saveAsset = api.cmdb.saveAsset.useMutation({
    onSuccess: async () => {
      await utils.cmdb.dashboard.invalidate();
      setAssetDialogOpen(false);
      setAssetDraft(emptyAssetDraft());
      setAssetRoleInput("");
      setAssetConnectionResult(null);
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const testAssetConnectivity = api.cmdb.testAssetConnectivity.useMutation({
    onSuccess: (result) => {
      setAssetConnectionResult(result);
      setAssetDraft((current) => ({
        ...current,
        status: result.status,
      }));
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const deleteAsset = api.cmdb.deleteAsset.useMutation({
    onSuccess: async () => {
      await utils.cmdb.dashboard.invalidate();
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const deleteProject = api.cmdb.deleteProject.useMutation({
    onSuccess: async () => {
      await utils.cmdb.dashboard.invalidate();
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const triggerRelease = api.cmdb.triggerRelease.useMutation({
    onSuccess: async () => {
      await utils.cmdb.dashboard.invalidate();
      setReleaseDialogOpen(false);
      setReleaseDraft(emptyReleaseDraft());
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const triggerTopicRelease = api.cmdb.triggerTopicRelease.useMutation({
    onSuccess: async (result) => {
      await utils.cmdb.dashboard.invalidate();
      setTopicReleaseResult(result);
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const projectOperation = api.cmdb.projectOperation.useMutation({
    onSuccess: (result) => {
      setOperationResult(result);
      setOperationCopied(false);
      setErrorMessage(null);
    },
    onError: (error) => {
      setOperationResult(null);
      setErrorMessage(error.message);
    },
  });

  useEffect(() => {
    if (operationAction !== "sshInfo") return;
    terminalScrollRef.current?.scrollTo({
      top: terminalScrollRef.current.scrollHeight,
    });
  }, [operationAction, terminalOutput]);

  useEffect(() => {
    if (operationAction !== "sshInfo" || terminalStatus !== "connected") {
      return;
    }

    terminalScrollRef.current?.focus({ preventScroll: true });
  }, [operationAction, terminalStatus]);

  useEffect(() => {
    return () => {
      terminalStartTokenRef.current += 1;
      terminalEventSourceRef.current?.close();
      const sessionId = terminalSessionIdRef.current;
      if (sessionId) {
        void fetch(`/api/cmdb/terminal-session/${sessionId}`, {
          method: "DELETE",
        });
      }
    };
  }, []);

  const data = dashboardQuery.data;
  const dashboardUnavailable = Boolean(dashboardQuery.error && !data);
  const assets = data?.assets ?? [];
  const projects = data?.projects ?? [];
  const releases = data?.releases ?? [];
  const gitlabCatalogItems = gitlabCatalogQuery.data ?? [];
  const visibleGitLabCatalogItems = gitlabCatalogItems.slice(0, 20);
  const manualGitLabPath = gitlabSearch.trim();
  const canUseManualGitLabPath = isGitLabProjectPath(manualGitLabPath);
  const manualGitLabPathIsSelected =
    manualGitLabPath.length > 0 &&
    projectDraft.gitlabPath.trim() === manualGitLabPath;
  const manualGitLabPathMatchesCatalog = gitlabCatalogItems.some(
    (item) => item.path === manualGitLabPath,
  );
  const operationText = operationResultText(operationResult);
  const OperationIcon =
    operationAction === "dockerStatus"
      ? ActivityIcon
      : operationAction === "dockerLogs"
        ? ScrollTextIcon
        : TerminalIcon;
  const operationExitCode = operationResult?.code ?? 0;
  const isTerminalOperation = operationAction === "sshInfo";
  const operationPending = isTerminalOperation
    ? terminalStatus === "connecting"
    : projectOperation.isPending;
  const operationTargetAssetName =
    operationResult?.targetAssetName ??
    terminalSession?.targetAssetName ??
    (operationProject
      ? projectTargetAssetsLabel(operationProject.config)
      : "-");
  const operationHost = operationResult?.host ?? terminalSession?.host ?? "-";
  const operationContainerName =
    operationResult?.containerName ??
    terminalSession?.containerName ??
    operationProject?.name ??
    "-";
  const operationStatusText = isTerminalOperation
    ? terminalStatusLabel(terminalStatus)
    : operationResult
      ? `${operationResult.durationMs}ms`
      : projectOperation.isPending
        ? "执行中"
        : "-";
  const operationStatusFailed = isTerminalOperation
    ? terminalStatus === "error"
    : operationExitCode !== 0;
  const operationHasStatus = isTerminalOperation
    ? terminalStatus !== "idle" && terminalStatus !== "connecting"
    : Boolean(operationResult);
  const operationCopyText = isTerminalOperation
    ? terminalOutput
    : operationText.length > 0
      ? operationText
      : (operationResult?.sshCommand ?? "");
  const selectedGitLabCandidate =
    gitlabCatalogItems.find((item) => item.path === projectDraft.gitlabPath) ??
    null;
  const selectedRepoSummary = projectDraft.gitlabPath.trim().length
    ? {
        name:
          (selectedGitLabCandidate?.name ?? projectDraft.name.trim()) ||
          "手动录入仓库",
        path: projectDraft.gitlabPath.trim(),
        defaultBranch:
          selectedGitLabCandidate?.defaultBranch ?? projectDraft.defaultBranch,
        description:
          selectedGitLabCandidate?.description ?? projectDraft.description,
        webUrl: selectedGitLabCandidate?.webUrl ?? null,
      }
    : null;
  const projectPathMissing = projectDraft.gitlabPath.trim().length === 0;
  const projectSshDeploymentIssue =
    projectDraftSshDeploymentIssue(projectDraft);
  const projectSaveDisabled =
    saveProject.isPending ||
    projectPathMissing ||
    Boolean(projectSshDeploymentIssue);
  const projectDeploymentSummary =
    projectDraft.deployTarget === "none"
      ? "不触发部署"
      : `${draftDeployTargetLabel(projectDraft.deployTarget)} · ${
          projectDraft.deployEnv.trim() || "未指定环境"
        } · ${targetAssetsLabel(projectDraft.targetAssetNames)}`;
  const gitlabConfigured = Boolean(data?.gitlab.baseUrl);
  const gitlabBadgeLabel = data
    ? gitlabConfigured
      ? "GitLab 已接入"
      : "GitLab 未配置"
    : dashboardUnavailable
      ? "数据源不可用"
      : "检查中";
  const gitlabBadgeTone = data
    ? gitlabConfigured
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-amber-200 bg-amber-50 text-amber-700"
    : dashboardUnavailable
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-slate-50 text-slate-700";
  const assetRoleTags = parseAssetRoles(assetDraft.rolesText);
  const assetSshPortPreview = parseSshPort(assetDraft.sshPort);
  const assetSshPortValid = assetSshPortPreview !== null;
  const assetNameReady = assetDraft.name.trim().length > 0;
  const assetHostReady = assetDraft.ip.trim().length > 0;
  const assetSshUserReady = assetDraft.sshUser.trim().length > 0;
  const assetSshPasswordReady = assetDraft.sshPassword.length > 0;
  const assetRolesReady = assetRoleTags.length > 0;
  const assetCanTestConnectivity =
    assetHostReady &&
    assetSshUserReady &&
    assetSshPasswordReady &&
    assetSshPortValid;
  const assetDetectedStatus =
    assetConnectionResult?.status ??
    (assetDraft.id ? assetDraft.status : "planned");
  const assetConnectivityReady = assetConnectionResult
    ? assetConnectionResult.status === "connected"
    : assetDraft.id
      ? assetDraft.status === "connected"
      : false;
  const assetConnectivityLabel = assetConnectionResult
    ? assetStatusLabel(assetConnectionResult.status)
    : assetDraft.id
      ? assetStatusLabel(assetDraft.status)
      : "未检测";
  const assetConnectionMessage =
    assetConnectionResult?.message ??
    (assetDraft.id
      ? `当前记录状态：${assetStatusLabel(assetDraft.status)}`
      : "建议保存前做一次 SSH 登录测试，确认账号密码可用。");
  const assetArchSelectValue =
    assetDraft.arch === "amd64" || assetDraft.arch === "arm64"
      ? assetDraft.arch
      : assetDraft.arch.trim().length > 0
        ? CUSTOM_ARCH_VALUE
        : null;
  const enabledProjectTotal = projects.filter(
    (project) => project.enabled,
  ).length;
  const canTriggerPipelines = Boolean(data?.gitlab.canTriggerPipelines);
  const topicReleaseSelectedIds = new Set(topicReleaseDraft.projectIds);
  const releasableProjects = projects.filter(
    (project) => !projectReleaseIssue(project, canTriggerPipelines),
  );
  const selectedTopicProjects = projects.filter((project) =>
    topicReleaseSelectedIds.has(project.id),
  );
  const topicReleaseCanSubmit =
    topicReleaseDraft.projectIds.length > 0 && !triggerTopicRelease.isPending;
  const connectedAssetTotal =
    data?.overview.connectedAssetTotal ??
    assets.filter((asset) => asset.status === "connected").length;
  const gpuAssetTotal =
    data?.overview.gpuAssetTotal ??
    assets.filter((asset) => asset.hasGpu).length;
  const monitoredProjectTotal =
    data?.overview.monitoredProjectTotal ??
    projects.filter((project) => Boolean(project.config?.healthUrl)).length;
  const healthyProjectTotal =
    data?.overview.healthyProjectTotal ??
    projects.filter((project) => project.monitor.status === "healthy").length;
  const runningReleaseTotal = data?.overview.runningReleaseTotal ?? 0;
  const failedReleaseTotal = data?.overview.failedReleaseTotal ?? 0;
  const lastSyncedLabel = dashboardQuery.dataUpdatedAt
    ? formatTime(dashboardQuery.dataUpdatedAt)
    : dashboardUnavailable
      ? "未完成同步"
      : "等待首次同步";
  const dashboardErrorMessage =
    dashboardQuery.error?.message?.trim() ??
    "无法读取 CMDB 数据，请检查 DATABASE_URL、数据库服务和 Drizzle 迁移状态。";
  const overviewCards = [
    {
      label: "服务器资产",
      value: dashboardUnavailable
        ? "--"
        : String(data?.overview.assetTotal ?? assets.length),
      description: dashboardUnavailable
        ? "等待数据源恢复"
        : `${connectedAssetTotal} 已接入 · ${gpuAssetTotal} GPU`,
      icon: ServerIcon,
      tone:
        dashboardUnavailable ||
        !(connectedAssetTotal > 0 && connectedAssetTotal === assets.length)
          ? assets.length > 0 && !dashboardUnavailable
            ? ("warning" as const)
            : ("neutral" as const)
          : ("good" as const),
    },
    {
      label: "纳管项目",
      value: dashboardUnavailable
        ? "--"
        : `${enabledProjectTotal}/${data?.overview.projectTotal ?? projects.length}`,
      description: dashboardUnavailable
        ? "等待数据源恢复"
        : "启用中 / 项目总数",
      icon: GitBranchIcon,
      tone:
        !dashboardUnavailable && enabledProjectTotal > 0
          ? ("good" as const)
          : ("neutral" as const),
    },
    {
      label: "健康检查",
      value: dashboardUnavailable
        ? "--"
        : monitoredProjectTotal
          ? ratioLabel(healthyProjectTotal, monitoredProjectTotal)
          : "0%",
      description: dashboardUnavailable
        ? "等待数据源恢复"
        : `${healthyProjectTotal} 健康 · ${monitoredProjectTotal} 已配置`,
      icon: ActivityIcon,
      tone:
        dashboardUnavailable || monitoredProjectTotal === 0
          ? ("neutral" as const)
          : healthyProjectTotal === monitoredProjectTotal
            ? ("good" as const)
            : ("danger" as const),
    },
    {
      label: "发布队列",
      value: dashboardUnavailable ? "--" : String(runningReleaseTotal),
      description: dashboardUnavailable
        ? "等待数据源恢复"
        : `${failedReleaseTotal} 条失败记录`,
      icon: RocketIcon,
      tone: dashboardUnavailable
        ? ("neutral" as const)
        : failedReleaseTotal > 0
          ? ("danger" as const)
          : runningReleaseTotal > 0
            ? ("warning" as const)
            : ("neutral" as const),
    },
  ];
  const areaCards = [
    {
      key: "assets" as const,
      label: "服务器资产",
      description: "手动维护服务器、角色、SSH 信息和项目挂载情况。",
      countLabel: dashboardUnavailable
        ? "无数据"
        : `${data?.overview.assetTotal ?? assets.length} 台资产`,
      icon: ServerIcon,
    },
    {
      key: "projects" as const,
      label: "GitLab 项目管理",
      description: "集中维护仓库、部署目标、健康检查和默认变量。",
      countLabel: dashboardUnavailable
        ? "无数据"
        : `${data?.overview.projectTotal ?? projects.length} 个项目`,
      icon: GitBranchIcon,
    },
    {
      key: "deployments" as const,
      label: "部署管理",
      description: "追踪最近发布、Pipeline 状态和部署环境。",
      countLabel: dashboardUnavailable
        ? "无数据"
        : `${data?.overview.runningReleaseTotal ?? 0} 个进行中`,
      icon: RocketIcon,
    },
  ];
  const activeAreaMeta =
    areaCards.find((item) => item.key === activeArea) ?? areaCards[0]!;

  function openCreateAssetDialog() {
    setAssetDraft(emptyAssetDraft());
    setAssetRoleInput("");
    setAssetConnectionResult(null);
    setAssetDialogOpen(true);
  }

  function openEditAssetDialog(asset: AssetRow) {
    setAssetDraft(assetDraftFromRow(asset));
    setAssetRoleInput("");
    setAssetConnectionResult(null);
    setAssetDialogOpen(true);
  }

  function openCreateDialog() {
    setProjectDraft(emptyProjectDraft());
    setProjectDraftPanel("basic");
    setGitlabSearch("");
    setProjectDialogOpen(true);
  }

  function openEditDialog(project: ProjectRow) {
    setProjectDraft(projectDraftFromRow(project));
    setProjectDraftPanel("basic");
    setGitlabSearch(project.gitlabPath);
    setProjectDialogOpen(true);
  }

  function openReleaseModal(project: ProjectRow) {
    const releaseIssue = projectReleaseIssue(project, canTriggerPipelines);
    if (releaseIssue) {
      setErrorMessage(releaseIssue);
      return;
    }

    setReleaseDraft(releaseDraftFromRow(project));
    setReleaseDialogOpen(true);
  }

  function closeTerminalSession(options: { reset?: boolean } = {}) {
    terminalStartTokenRef.current += 1;
    terminalEventSourceRef.current?.close();
    terminalEventSourceRef.current = null;
    terminalWriteQueueRef.current = Promise.resolve();

    const sessionId = terminalSessionIdRef.current;
    terminalSessionIdRef.current = null;

    if (sessionId) {
      void fetch(`/api/cmdb/terminal-session/${sessionId}`, {
        method: "DELETE",
      });
    }

    if (options.reset ?? true) {
      setTerminalSession(null);
      setTerminalStatus("idle");
      setTerminalOutput("");
      setTerminalError(null);
    }
  }

  function closeOperationDialog() {
    setOperationDialogOpen(false);
    setOperationDialogMaximized(false);
    setOperationCopied(false);
    projectOperation.reset();
    closeTerminalSession();
  }

  function appendTerminalOutput(value: string) {
    const normalized = normalizeTerminalOutput(value);
    if (!normalized) return;

    setTerminalOutput((current) => {
      const next = `${current}${normalized}`;
      return next.length > TERMINAL_OUTPUT_LIMIT
        ? next.slice(-TERMINAL_OUTPUT_LIMIT)
        : next;
    });
  }

  function applyTerminalEvent(
    event: TerminalSessionEvent,
    source: EventSource,
  ) {
    switch (event.type) {
      case "output":
        appendTerminalOutput(event.data);
        break;
      case "status":
        setTerminalStatus(event.status);
        if (event.status === "connected") {
          setTerminalError(null);
        }
        if (event.status === "closed") {
          source.close();
          terminalEventSourceRef.current = null;
        }
        break;
      case "error":
        setTerminalStatus("error");
        setTerminalError(event.message);
        appendTerminalOutput(`\n${event.message}\n`);
        break;
      case "exit":
        setTerminalStatus("closed");
        appendTerminalOutput(`\n${event.message}\n`);
        source.close();
        terminalEventSourceRef.current = null;
        break;
    }
  }

  async function responseErrorMessage(response: Response, fallback: string) {
    try {
      const payload: unknown = await response.json();
      if (
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
      ) {
        return payload.error;
      }
    } catch {
      // Ignore invalid error bodies and use the caller-provided fallback.
    }

    return fallback;
  }

  async function startTerminalLogin(project: ProjectRow) {
    closeTerminalSession();
    const token = terminalStartTokenRef.current + 1;
    terminalStartTokenRef.current = token;
    setTerminalSession(null);
    setTerminalStatus("connecting");
    setTerminalOutput("正在建立 SSH 会话...\n");
    terminalWriteQueueRef.current = Promise.resolve();
    setTerminalError(null);

    try {
      const response = await fetch("/api/cmdb/terminal-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });

      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(response, "容器登录会话创建失败。"),
        );
      }

      const session = (await response.json()) as TerminalSessionInfo;
      if (terminalStartTokenRef.current !== token) {
        void fetch(`/api/cmdb/terminal-session/${session.sessionId}`, {
          method: "DELETE",
        });
        return;
      }

      terminalSessionIdRef.current = session.sessionId;
      setTerminalSession(session);

      const source = new EventSource(
        `/api/cmdb/terminal-session/${session.sessionId}/stream`,
      );
      terminalEventSourceRef.current = source;

      source.onmessage = (message) => {
        if (terminalSessionIdRef.current !== session.sessionId) return;

        try {
          const eventData =
            typeof message.data === "string" ? message.data : "";
          applyTerminalEvent(parseTerminalSessionEvent(eventData), source);
        } catch {
          setTerminalStatus("error");
          setTerminalError("终端返回了无法解析的数据。");
        }
      };

      source.onerror = () => {
        if (terminalSessionIdRef.current !== session.sessionId) return;
        source.close();
        terminalEventSourceRef.current = null;
        setTerminalStatus("error");
        setTerminalError("终端输出流已中断。");
      };
    } catch (error) {
      if (terminalStartTokenRef.current !== token) return;

      const message = error instanceof Error ? error.message : "容器登录失败";
      setTerminalStatus("error");
      setTerminalError(message);
      appendTerminalOutput(`\n${message}\n`);
    }
  }

  async function sendTerminalData(data: string) {
    const sessionId = terminalSessionIdRef.current;
    if (!sessionId || terminalStatus !== "connected") return;

    const write = terminalWriteQueueRef.current.then(async () => {
      if (terminalSessionIdRef.current !== sessionId) return;

      try {
        const response = await fetch(
          `/api/cmdb/terminal-session/${sessionId}/input`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data }),
          },
        );

        if (!response.ok) {
          throw new Error(
            await responseErrorMessage(response, "终端输入发送失败。"),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "终端输入发送失败。";
        setTerminalStatus("error");
        setTerminalError(message);
        appendTerminalOutput(`\n${message}\n`);
      }
    });

    terminalWriteQueueRef.current = write.catch(() => undefined);
    await terminalWriteQueueRef.current;
  }

  function terminalKeyData(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.altKey) return null;

    if (event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key.length === 1 && key >= "a" && key <= "z") {
        return String.fromCharCode(key.charCodeAt(0) - 96);
      }
      if (key === "[") return "\u001b";
      if (key === "]") return "\u001d";
      if (key === "\\") return "\u001c";
      if (key === "^") return "\u001e";
      if (key === "_") return "\u001f";
      if (key === " ") return "\u0000";
      return null;
    }

    switch (event.key) {
      case "Enter":
        return "\r";
      case "Backspace":
        return "\u007f";
      case "Tab":
        return "\t";
      case "Escape":
        return "\u001b";
      case "ArrowUp":
        return "\u001b[A";
      case "ArrowDown":
        return "\u001b[B";
      case "ArrowRight":
        return "\u001b[C";
      case "ArrowLeft":
        return "\u001b[D";
      case "Home":
        return "\u001b[H";
      case "End":
        return "\u001b[F";
      case "Delete":
        return "\u001b[3~";
      case "PageUp":
        return "\u001b[5~";
      case "PageDown":
        return "\u001b[6~";
      default:
        return event.key.length === 1 ? event.key : null;
    }
  }

  function handleTerminalKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (terminalStatus !== "connected") return;

    const data = terminalKeyData(event);
    if (!data) return;

    event.preventDefault();
    void sendTerminalData(data);
  }

  function openProjectOperation(
    project: ProjectRow,
    action: ProjectOperationAction,
  ) {
    const issue = projectOperationIssue(project, action);
    if (issue) {
      setErrorMessage(issue);
      return;
    }

    setOperationProject(project);
    setOperationAction(action);
    setOperationResult(null);
    setOperationCopied(false);
    setOperationDialogOpen(true);

    if (action === "sshInfo") {
      projectOperation.reset();
      void startTerminalLogin(project);
      return;
    }

    closeTerminalSession();
    projectOperation.mutate({
      projectId: project.id,
      action,
      tail: action === "dockerLogs" ? 200 : undefined,
    });
  }

  function openReleaseOperation(
    release: ReleaseRow,
    action: ProjectOperationAction,
  ) {
    const issue = releaseOperationIssue(release, action);
    if (issue) {
      setErrorMessage(issue);
      return;
    }

    const project = projects.find((item) => item.id === release.project?.id);
    if (!project) {
      setErrorMessage("项目数据尚未加载，无法执行运维操作。");
      return;
    }

    openProjectOperation(project, action);
  }

  async function copyOperationOutput() {
    const text = operationCopyText;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setOperationCopied(true);
    } catch {
      setOperationCopied(false);
    }
  }

  function openTopicReleaseDialog(initialProjectIds: number[] = []) {
    setTopicReleaseDraft({
      ...emptyTopicReleaseDraft(),
      projectIds: initialProjectIds,
    });
    setTopicReleaseResult(null);
    setTopicReleaseDialogOpen(true);
  }

  function toggleTopicReleaseProject(projectId: number) {
    setTopicReleaseDraft((current) => {
      const exists = current.projectIds.includes(projectId);

      return {
        ...current,
        projectIds: exists
          ? current.projectIds.filter((item) => item !== projectId)
          : [...current.projectIds, projectId],
      };
    });
    setTopicReleaseResult(null);
  }

  function selectAllTopicReleaseProjects() {
    setTopicReleaseDraft((current) => ({
      ...current,
      projectIds: releasableProjects.map((project) => project.id),
    }));
    setTopicReleaseResult(null);
  }

  function clearTopicReleaseProjects() {
    setTopicReleaseDraft((current) => ({
      ...current,
      projectIds: [],
    }));
    setTopicReleaseResult(null);
  }

  function applyGitLabCandidate(candidate: GitLabCatalogRow) {
    setProjectDraft((current) => ({
      ...current,
      name: candidate.name,
      gitlabPath: candidate.path,
      description: candidate.description ?? current.description,
      defaultBranch: candidate.defaultBranch,
    }));
  }

  function applyManualGitLabPath() {
    if (!canUseManualGitLabPath) return;

    const pathParts = manualGitLabPath.split("/").filter(Boolean);
    const fallbackName = pathParts[pathParts.length - 1] ?? manualGitLabPath;

    setProjectDraft((current) => ({
      ...current,
      name: current.name.trim() || fallbackName,
      gitlabPath: manualGitLabPath,
      defaultBranch: current.defaultBranch.trim() || "main",
    }));
    setProjectDraftPanel("basic");
  }

  async function handleDeleteProject(project: ProjectRow) {
    const accepted = await confirm({
      title: "删除 CMDB 项目",
      description: `将删除 ${project.name} 的纳管配置及其发布记录。`,
      confirmLabel: "删除",
      confirmVariant: "destructive",
    });

    if (!accepted) return;
    deleteProject.mutate({ id: project.id });
  }

  async function handleDeleteAsset(asset: AssetRow) {
    const accepted = await confirm({
      title: "删除服务器资产",
      description: `将删除资产 ${asset.name}。如果它仍被项目引用，系统会阻止删除。`,
      confirmLabel: "删除",
      confirmVariant: "destructive",
    });

    if (!accepted) return;
    deleteAsset.mutate({ id: asset.id });
  }

  function replaceAssetRoles(nextRoles: string[]) {
    setAssetDraft((current) => ({
      ...current,
      rolesText: serializeAssetRoles(nextRoles),
    }));
  }

  function addAssetRole(rawRole: string) {
    const normalizedRole = rawRole.trim().replace(/,+$/, "");
    if (normalizedRole.length === 0) return;

    replaceAssetRoles(Array.from(new Set([...assetRoleTags, normalizedRole])));
    setAssetRoleInput("");
  }

  function removeAssetRole(role: string) {
    replaceAssetRoles(assetRoleTags.filter((item) => item !== role));
  }

  function addProjectTargetAsset(assetName: string) {
    if (assetName === UNASSIGNED_VALUE) return;

    setProjectDraft((current) => ({
      ...current,
      targetAssetNames: Array.from(
        new Set([...current.targetAssetNames, assetName]),
      ),
    }));
  }

  function removeProjectTargetAsset(assetName: string) {
    setProjectDraft((current) => ({
      ...current,
      targetAssetNames: current.targetAssetNames.filter(
        (item) => item !== assetName,
      ),
    }));
  }

  function clearProjectTargetAssets() {
    setProjectDraft((current) => ({
      ...current,
      targetAssetNames: [],
    }));
  }

  function runAssetConnectivityTest() {
    const parsedSshPort = parseSshPort(assetDraft.sshPort);

    if (parsedSshPort === null) {
      setErrorMessage("SSH 端口必须是 1-65535 的整数。");
      return;
    }

    testAssetConnectivity.mutate({
      ip: assetDraft.ip,
      sshUser: assetDraft.sshUser,
      sshPassword: assetDraft.sshPassword,
      sshPort: parsedSshPort,
    });
  }

  function saveAssetDraft() {
    const parsedSshPort = parseSshPort(assetDraft.sshPort);

    if (parsedSshPort === null) {
      setErrorMessage("SSH 端口必须是 1-65535 的整数。");
      return;
    }

    saveAsset.mutate({
      id: assetDraft.id,
      name: assetDraft.name,
      ip: assetDraft.ip,
      sshUser: assetDraft.sshUser || undefined,
      sshPassword: assetDraft.sshPassword || undefined,
      sshPort: parsedSshPort,
      roles: assetRoleTags,
      arch: assetDraft.arch || undefined,
      status:
        assetConnectionResult?.status ??
        (assetDraft.id ? assetDraft.status : "planned"),
    });
  }

  function saveProjectDraft() {
    if (projectPathMissing) {
      setProjectDraftPanel("basic");
      setErrorMessage("请填写 GitLab 项目路径。");
      return;
    }

    if (projectSshDeploymentIssue) {
      setProjectDraftPanel("deploy");
      setErrorMessage(projectSshDeploymentIssue);
      return;
    }

    saveProject.mutate({
      id: projectDraft.id,
      name: projectDraft.name || undefined,
      gitlabPath: projectDraft.gitlabPath,
      description: projectDraft.description || undefined,
      defaultBranch: projectDraft.defaultBranch || undefined,
      enabled: projectDraft.enabled === "true",
      deployTarget: projectDraft.deployTarget,
      syncWithGitLab: Boolean(data?.gitlab.canBrowseCatalog),
      config: {
        targetAssetName: projectDraft.targetAssetNames[0],
        targetAssetNames:
          projectDraft.targetAssetNames.length > 0
            ? projectDraft.targetAssetNames
            : undefined,
        deployEnv: projectDraft.deployEnv || undefined,
        healthUrl: projectDraft.healthUrl || undefined,
        monitorUrl: projectDraft.monitorUrl || undefined,
        k8sNamespace: projectDraft.k8sNamespace || undefined,
        k8sDeployment: projectDraft.k8sDeployment || undefined,
        dockerImage: projectDraft.dockerImage || undefined,
        sshPath: projectDraft.sshPath || undefined,
        sshDeployCommand: projectDraft.sshDeployCommand || undefined,
        triggerToken: projectDraft.triggerToken || undefined,
        customVariables: parseVariables(projectDraft.customVariablesText),
      },
    });
  }

  function triggerReleaseDraftAction() {
    if (!releaseDraft.projectId) {
      setErrorMessage("请选择要发布的项目。");
      return;
    }

    triggerRelease.mutate({
      projectId: releaseDraft.projectId,
      ref: releaseDraft.ref || undefined,
      deployEnv: releaseDraft.deployEnv || undefined,
      variables: parseVariables(releaseDraft.variablesText),
    });
  }

  function triggerTopicReleaseDraftAction() {
    if (topicReleaseDraft.projectIds.length === 0) {
      setErrorMessage("请选择至少一个要发布的项目。");
      return;
    }

    triggerTopicRelease.mutate({
      topic: topicReleaseDraft.topic || undefined,
      projectIds: topicReleaseDraft.projectIds,
      ref: topicReleaseDraft.ref || undefined,
      deployEnv: topicReleaseDraft.deployEnv || undefined,
      variables: parseVariables(topicReleaseDraft.variablesText),
    });
  }

  return (
    <ModulePageShell className="gap-3">
      <section className="overflow-hidden rounded-[12px] border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col">
          <div className="flex flex-col gap-3 border-b border-slate-200/80 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                <ServerIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-slate-200/90 bg-white text-slate-700">
                    CMDB Ops
                  </Badge>
                  <Badge className={cn("border", gitlabBadgeTone)}>
                    {gitlabBadgeLabel}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    最近同步 {lastSyncedLabel}
                  </span>
                </div>
                <h1 className="mt-1.5 text-[1.28rem] leading-tight font-semibold tracking-[-0.03em] text-slate-950 md:text-[1.45rem]">
                  资产与发布管理
                </h1>
                <p className="mt-0.5 max-w-3xl text-[13px] leading-5 text-slate-600">
                  统一维护服务器、GitLab 项目和 Pipeline
                  发布记录，优先暴露连通性、健康检查和发布风险。
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end [&_[data-slot=button]]:h-8 [&_[data-slot=button]]:rounded-[9px]">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 bg-white"
                onClick={() => void dashboardQuery.refetch()}
                disabled={dashboardQuery.isFetching}
              >
                {dashboardQuery.isFetching ? (
                  <LoaderCircleIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                刷新状态
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 bg-white"
                onClick={openCreateAssetDialog}
              >
                <ServerIcon data-icon="inline-start" />
                新增资产
              </Button>
              <Button
                size="sm"
                className="bg-slate-900 text-white hover:bg-slate-800"
                onClick={openCreateDialog}
              >
                <PlusIcon data-icon="inline-start" />
                纳管项目
              </Button>
            </div>
          </div>

          {!data && dashboardQuery.isLoading ? (
            <div className="grid gap-0 bg-slate-50/45 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-slate-200/80">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton
                  key={`cmdb-overview-${index}`}
                  className="m-3 h-[66px] rounded-[10px]"
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-0 bg-slate-50/45 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-slate-200/80">
              {overviewCards.map((card) => (
                <CmdbOverviewCard key={card.label} {...card} />
              ))}
            </div>
          )}

          <div className="border-t border-slate-200/80 px-3 py-2.5 lg:px-4">
            <div
              role="tablist"
              aria-label="CMDB 区域切换"
              className="scrollbar-none flex gap-1 overflow-x-auto rounded-[10px] border border-slate-200/90 bg-slate-100/80 p-1"
            >
              {areaCards.map((area) => {
                const isActive = area.key === activeArea;
                const Icon = area.icon;

                return (
                  <button
                    key={area.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`cmdb-panel-${area.key}`}
                    onClick={() => setActiveArea(area.key)}
                    className={cn(
                      "flex min-h-10 min-w-[220px] items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:outline-none lg:min-w-0 lg:flex-1",
                      isActive
                        ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                        : "text-slate-600 hover:bg-white/64 hover:text-slate-950",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-[8px]",
                          isActive
                            ? "bg-slate-100 text-slate-700"
                            : "bg-transparent text-slate-500",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold">
                          {area.label}
                        </span>
                        <span className="hidden truncate text-[11px] text-slate-500 xl:block">
                          {area.description}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                      {area.countLabel}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[12px] leading-5 text-slate-500">
              当前视图：{activeAreaMeta.description}
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <Alert className="border-rose-200 bg-rose-50 text-rose-900">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {dashboardQuery.error ? (
        <CmdbErrorPanel
          message={dashboardErrorMessage}
          onRetry={() => void dashboardQuery.refetch()}
          isRetrying={dashboardQuery.isFetching}
        />
      ) : null}

      {dashboardUnavailable ? (
        <CmdbOfflineWorkspace
          onCreateAsset={openCreateAssetDialog}
          onCreateProject={openCreateDialog}
          onRetry={() => void dashboardQuery.refetch()}
          isRetrying={dashboardQuery.isFetching}
        />
      ) : null}

      {!dashboardQuery.data && dashboardQuery.isLoading ? (
        <LoadingBlock />
      ) : null}

      {data && activeArea !== "assets" ? (
        !gitlabConfigured ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>GitLab 还没打通</AlertTitle>
            <AlertDescription>
              先在环境变量里配置
              `GITLAB_URL`。如果还希望在页面里搜索仓库和回填实时流水线状态，再补上
              `GITLAB_API_TOKEN`。
            </AlertDescription>
          </Alert>
        ) : !data.gitlab.hasApiToken ? (
          <Alert className="border-sky-200 bg-sky-50 text-sky-900">
            <CheckCircle2Icon className="size-4" />
            <AlertTitle>GitLab 地址已接入</AlertTitle>
            <AlertDescription>
              当前已可通过项目级 Trigger Token 触发发布，但没有
              `GITLAB_API_TOKEN`
              时，无法浏览仓库目录，也无法自动刷新流水线状态。
            </AlertDescription>
          </Alert>
        ) : null
      ) : null}

      {data && activeArea === "assets" ? (
        <ModuleSection
          id="cmdb-panel-assets"
          title="服务器资产"
          description="手动维护部署所需的 IP、SSH、角色与架构信息。"
          density="compact"
          className="rounded-[12px] border-slate-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          action={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-500">
                <span className="font-semibold text-slate-950">
                  {assets.length}
                </span>{" "}
                台已纳管
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-[9px] border-slate-300 bg-white"
                onClick={openCreateAssetDialog}
              >
                <PlusIcon data-icon="inline-start" />
                新增资产
              </Button>
            </div>
          }
        >
          {assets.length === 0 ? (
            <CmdbEmptyState
              icon={ServerIcon}
              title="还没有可展示的服务器资产"
              description="从上方入口新增资产，录入服务器 IP、SSH、角色和架构信息后即可在项目配置中引用。"
              hints={[
                "录入服务器 IP、SSH 用户和端口",
                "添加 master、worker、gpu 等角色标签",
                "保存后在项目部署目标中引用这台资产",
              ]}
              action={
                <Button
                  size="sm"
                  className="rounded-[10px]"
                  onClick={openCreateAssetDialog}
                >
                  <PlusIcon data-icon="inline-start" />
                  新增第一台资产
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 2xl:hidden">
                {assets.map((asset) => (
                  <article
                    key={`asset-card-${asset.name}`}
                    className="grid gap-3 rounded-[12px] border border-slate-200/90 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:grid-cols-[minmax(0,1.3fr)_minmax(120px,0.55fr)_minmax(120px,0.55fr)_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold tracking-[-0.02em] text-slate-950">
                          {asset.name}
                        </h3>
                        {asset.isController ? (
                          <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                            Master
                          </Badge>
                        ) : null}
                        {asset.hasGpu ? (
                          <Badge className="border border-violet-200 bg-violet-50 text-violet-700">
                            GPU
                          </Badge>
                        ) : null}
                        <Badge
                          className={cn(
                            "border md:hidden",
                            assetStatusTone(asset.status),
                          )}
                        >
                          {assetStatusLabel(asset.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[13px] text-slate-500">
                        {asset.ip} · {asset.sshUser ?? "root"}:{asset.sshPort}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-slate-50/80 px-3 py-2 text-[13px] text-slate-600 md:block md:bg-transparent md:px-0 md:py-0">
                      <span className="text-slate-500 md:block md:text-[11px]">
                        架构
                      </span>
                      <span className="font-medium text-slate-900 md:mt-1 md:block">
                        {asset.arch ?? "-"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-slate-50/80 px-3 py-2 text-[13px] text-slate-600 md:block md:bg-transparent md:px-0 md:py-0">
                      <span className="text-slate-500 md:block md:text-[11px]">
                        挂载服务
                      </span>
                      <span className="font-medium text-slate-900 md:mt-1 md:block">
                        {asset.attachedProjectCount}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end">
                      <div className="flex flex-wrap gap-1.5 md:mr-auto md:hidden">
                        {asset.roles.map((role) => (
                          <Badge
                            key={`asset-card-${asset.name}-${role}`}
                            className="border border-slate-200 bg-white text-slate-700"
                          >
                            {role}
                          </Badge>
                        ))}
                      </div>
                      <Badge
                        className={cn(
                          "hidden border md:inline-flex",
                          assetStatusTone(asset.status),
                        )}
                      >
                        {assetStatusLabel(asset.status)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-[9px] border-slate-300 bg-white"
                        onClick={() => openEditAssetDialog(asset)}
                      >
                        <PencilIcon data-icon="inline-start" />
                        编辑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-[9px] border-rose-200 bg-white text-rose-700"
                        onClick={() => void handleDeleteAsset(asset)}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        删除
                      </Button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-hidden rounded-[12px] border border-slate-200/90 2xl:block">
                <Table className="min-w-[840px]">
                  <TableHeader className="bg-slate-50/90">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>资产</TableHead>
                      <TableHead>IP / SSH</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>架构</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">挂载服务</TableHead>
                      <TableHead className={STICKY_ACTION_HEAD_CLASS}>
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => (
                      <TableRow key={asset.name} className="group">
                        <TableCell>
                          <div className="grid gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-950">
                                {asset.name}
                              </span>
                              {asset.isController ? (
                                <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                                  Master
                                </Badge>
                              ) : null}
                              {asset.hasGpu ? (
                                <Badge className="border border-violet-200 bg-violet-50 text-violet-700">
                                  GPU
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          <div>{asset.ip}</div>
                          <div>
                            {asset.sshUser ?? "root"}:{asset.sshPort}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {asset.roles.map((role) => (
                              <Badge
                                key={`${asset.name}-${role}`}
                                className="border border-slate-200 bg-white text-slate-700"
                              >
                                {role}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {asset.arch ?? "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "border",
                              assetStatusTone(asset.status),
                            )}
                          >
                            {assetStatusLabel(asset.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium text-slate-700">
                          {asset.attachedProjectCount}
                        </TableCell>
                        <TableCell className={STICKY_ACTION_CELL_CLASS}>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="icon-sm"
                              className="rounded-[10px]"
                              onClick={() => openEditAssetDialog(asset)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              className="rounded-[10px] text-rose-700"
                              onClick={() => void handleDeleteAsset(asset)}
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </ModuleSection>
      ) : null}

      {data && activeArea === "projects" ? (
        <ModuleSection
          id="cmdb-panel-projects"
          title="GitLab 项目管理"
          description="统一维护仓库、部署目标、健康检查和默认变量。"
          density="compact"
          className="rounded-[12px] border-slate-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          action={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-500">
                启用中{" "}
                <span className="font-semibold text-slate-950">
                  {enabledProjectTotal}
                </span>
                /{projects.length}
              </span>
              {data.gitlab.baseUrl ? (
                <a
                  href={data.gitlab.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "rounded-[9px] border-slate-300 bg-white",
                  )}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  GitLab
                </a>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="rounded-[9px] border-slate-300 bg-white"
                onClick={() => openTopicReleaseDialog()}
                disabled={releasableProjects.length === 0}
                title={
                  releasableProjects.length === 0
                    ? "当前没有可发布的项目。"
                    : undefined
                }
              >
                <ListChecksIcon data-icon="inline-start" />
                主题发布
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-[9px] border-slate-300 bg-white"
                onClick={openCreateDialog}
              >
                <PlusIcon data-icon="inline-start" />
                纳管项目
              </Button>
            </div>
          }
        >
          {projects.length === 0 ? (
            <CmdbEmptyState
              icon={GitBranchIcon}
              title="还没有纳管任何 GitLab 项目"
              description="从上方入口纳管 GitLab 项目，补齐部署目标、健康检查和默认变量。"
              hints={[
                "选择 GitLab 仓库，或手动输入 group/project",
                "指定部署目标、目标资产和默认环境",
                "补充健康检查 URL 与流水线变量",
              ]}
              action={
                <Button
                  size="sm"
                  className="rounded-[10px]"
                  onClick={openCreateDialog}
                >
                  <PlusIcon data-icon="inline-start" />
                  新建项目
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 xl:hidden">
                {projects.map((project) => (
                  <article
                    key={`project-card-${project.id}`}
                    className="rounded-[12px] border border-slate-200/90 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-slate-950">
                            {project.name}
                          </h3>
                          {!project.enabled ? (
                            <Badge className="border border-slate-200 bg-slate-100 text-slate-700">
                              已禁用
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[13px] break-all text-slate-500">
                          {project.gitlabPath}
                        </p>
                      </div>
                      <Badge className="border border-slate-200 bg-white text-slate-700">
                        {deployTargetLabel(project.deployTarget)}
                      </Badge>
                    </div>

                    <div className="mt-3 grid gap-x-5 gap-y-2 rounded-[10px] bg-slate-50/80 px-3 py-2.5 text-[13px] md:grid-cols-[minmax(0,1.45fr)_minmax(90px,0.55fr)_minmax(110px,0.62fr)]">
                      <div className="min-w-0">
                        <span className="block text-[11px] text-slate-500">
                          目标位置
                        </span>
                        <span className="mt-1 block font-medium break-words text-slate-800">
                          {projectTargetAssetsLabel(project.config)}
                          <br />
                          <span className="font-normal text-slate-500">
                            {project.deployTarget === "k8s"
                              ? `${project.config?.k8sNamespace ?? "default"} / ${project.config?.k8sDeployment ?? "-"}`
                              : project.deployTarget === "docker"
                                ? (project.config?.dockerImage ?? "-")
                                : (project.config?.sshPath ?? "-")}
                          </span>
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] text-slate-500">
                          默认分支
                        </span>
                        <span className="mt-1 block font-medium text-slate-800">
                          {project.defaultBranch}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] text-slate-500">
                          监控
                        </span>
                        <div className="mt-1">
                          <CmdbStatusDot
                            className={cn(
                              project.monitor.status === "healthy"
                                ? "text-emerald-600"
                                : project.monitor.status === "degraded"
                                  ? "text-rose-600"
                                  : "text-slate-400",
                            )}
                            label={monitorLabel(project.monitor.status)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-slate-200/80 bg-white px-3 py-2">
                      <p className="text-[11px] font-medium text-slate-500">
                        最近发布
                      </p>
                      {project.latestRelease ? (
                        <>
                          <Badge
                            className={cn(
                              "border",
                              releaseTone(project.latestRelease.status),
                            )}
                          >
                            {releaseLabel(project.latestRelease.status)}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            {formatTime(project.latestRelease.createdAt)}
                          </span>
                          <span className="text-sm text-slate-700">
                            {project.latestRelease.ref}
                            {project.latestRelease.deployEnv
                              ? ` -> ${project.latestRelease.deployEnv}`
                              : ""}
                          </span>
                          {releaseTopic(project.latestRelease) ? (
                            <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                              主题 {releaseTopic(project.latestRelease)}
                            </Badge>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">暂无发布</p>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-2.5">
                      <Button
                        size="sm"
                        className="h-8 rounded-[9px] bg-slate-900 text-white hover:bg-slate-800"
                        onClick={() => openReleaseModal(project)}
                        disabled={Boolean(
                          projectReleaseIssue(
                            project,
                            data.gitlab.canTriggerPipelines,
                          ),
                        )}
                        title={
                          projectReleaseIssue(
                            project,
                            data.gitlab.canTriggerPipelines,
                          ) ?? undefined
                        }
                      >
                        <RocketIcon data-icon="inline-start" />
                        发布
                      </Button>
                      <div className={CMDB_ACTION_GROUP_CLASS}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() =>
                            openProjectOperation(project, "dockerStatus")
                          }
                          disabled={Boolean(
                            projectOperationIssue(project, "dockerStatus"),
                          )}
                          title={
                            projectOperationIssue(project, "dockerStatus") ??
                            "容器状态"
                          }
                        >
                          <ActivityIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() =>
                            openProjectOperation(project, "dockerLogs")
                          }
                          disabled={Boolean(
                            projectOperationIssue(project, "dockerLogs"),
                          )}
                          title={
                            projectOperationIssue(project, "dockerLogs") ??
                            "运行日志"
                          }
                        >
                          <ScrollTextIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() =>
                            openProjectOperation(project, "sshInfo")
                          }
                          disabled={Boolean(
                            projectOperationIssue(project, "sshInfo"),
                          )}
                          title={
                            projectOperationIssue(project, "sshInfo") ??
                            remoteLoginLabel(project.deployTarget)
                          }
                        >
                          <TerminalIcon />
                        </Button>
                        {project.gitlabWebUrl ? (
                          <a
                            href={project.gitlabWebUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="打开 GitLab"
                            className={cn(
                              buttonVariants({
                                variant: "ghost",
                                size: "icon-sm",
                              }),
                              CMDB_ACTION_ICON_CLASS,
                            )}
                          >
                            <ExternalLinkIcon />
                          </a>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() => openEditDialog(project)}
                          title="编辑项目"
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={cn(
                            CMDB_ACTION_ICON_CLASS,
                            "text-rose-600 hover:text-rose-700",
                          )}
                          onClick={() => void handleDeleteProject(project)}
                          title="删除项目"
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-hidden rounded-[12px] border border-slate-200/90 xl:block">
                <Table className="min-w-[940px]">
                  <TableHeader className="bg-slate-50/90">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>项目</TableHead>
                      <TableHead>部署目标</TableHead>
                      <TableHead>位置 / 配置</TableHead>
                      <TableHead>最近发布</TableHead>
                      <TableHead>监控</TableHead>
                      <TableHead className={STICKY_ACTION_HEAD_CLASS}>
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((project) => (
                      <TableRow key={project.id} className="group">
                        <TableCell>
                          <div className="grid gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-950">
                                {project.name}
                              </span>
                              {!project.enabled ? (
                                <Badge className="border border-slate-200 bg-slate-100 text-slate-700">
                                  已禁用
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-sm text-slate-600">
                              {project.gitlabPath}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            <Badge className="w-fit border border-slate-200 bg-white text-slate-700">
                              {deployTargetLabel(project.deployTarget)}
                            </Badge>
                            <span className="text-xs text-slate-500">
                              默认分支 {project.defaultBranch}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          <div>{projectTargetAssetsLabel(project.config)}</div>
                          <div>
                            {project.deployTarget === "k8s"
                              ? `${project.config?.k8sNamespace ?? "default"} / ${project.config?.k8sDeployment ?? "-"}`
                              : project.deployTarget === "docker"
                                ? (project.config?.dockerImage ?? "-")
                                : (project.config?.sshPath ?? "-")}
                          </div>
                        </TableCell>
                        <TableCell>
                          {project.latestRelease ? (
                            <div className="grid gap-1">
                              <div className="flex items-center gap-2">
                                <Badge
                                  className={cn(
                                    "border",
                                    releaseTone(project.latestRelease.status),
                                  )}
                                >
                                  {releaseLabel(project.latestRelease.status)}
                                </Badge>
                                <span className="text-xs text-slate-500">
                                  {formatTime(project.latestRelease.createdAt)}
                                </span>
                              </div>
                              <div className="text-sm text-slate-600">
                                {project.latestRelease.ref}
                                {project.latestRelease.deployEnv
                                  ? ` -> ${project.latestRelease.deployEnv}`
                                  : ""}
                              </div>
                              {releaseTopic(project.latestRelease) ? (
                                <div className="text-xs text-sky-700">
                                  主题 {releaseTopic(project.latestRelease)}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-sm text-slate-500">
                              暂无发布
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            <Badge
                              className={cn(
                                "w-fit border",
                                monitorTone(project.monitor.status),
                              )}
                            >
                              {monitorLabel(project.monitor.status)}
                            </Badge>
                            <span className="text-xs text-slate-500">
                              {project.monitor.message}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className={STICKY_ACTION_CELL_CLASS}>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              className="h-8 rounded-[9px] bg-slate-900 text-white hover:bg-slate-800"
                              onClick={() => openReleaseModal(project)}
                              disabled={Boolean(
                                projectReleaseIssue(
                                  project,
                                  data.gitlab.canTriggerPipelines,
                                ),
                              )}
                              title={
                                projectReleaseIssue(
                                  project,
                                  data.gitlab.canTriggerPipelines,
                                ) ?? undefined
                              }
                            >
                              <RocketIcon data-icon="inline-start" />
                              发布
                            </Button>
                            <div className={CMDB_ACTION_GROUP_CLASS}>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() =>
                                  openProjectOperation(project, "dockerStatus")
                                }
                                disabled={Boolean(
                                  projectOperationIssue(
                                    project,
                                    "dockerStatus",
                                  ),
                                )}
                                title={
                                  projectOperationIssue(
                                    project,
                                    "dockerStatus",
                                  ) ?? "容器状态"
                                }
                              >
                                <ActivityIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() =>
                                  openProjectOperation(project, "dockerLogs")
                                }
                                disabled={Boolean(
                                  projectOperationIssue(project, "dockerLogs"),
                                )}
                                title={
                                  projectOperationIssue(
                                    project,
                                    "dockerLogs",
                                  ) ?? "运行日志"
                                }
                              >
                                <ScrollTextIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() =>
                                  openProjectOperation(project, "sshInfo")
                                }
                                disabled={Boolean(
                                  projectOperationIssue(project, "sshInfo"),
                                )}
                                title={
                                  projectOperationIssue(project, "sshInfo") ??
                                  remoteLoginLabel(project.deployTarget)
                                }
                              >
                                <TerminalIcon />
                              </Button>
                              {project.gitlabWebUrl ? (
                                <a
                                  href={project.gitlabWebUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="打开 GitLab"
                                  className={cn(
                                    buttonVariants({
                                      variant: "ghost",
                                      size: "icon-sm",
                                    }),
                                    CMDB_ACTION_ICON_CLASS,
                                  )}
                                >
                                  <ExternalLinkIcon />
                                </a>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() => openEditDialog(project)}
                                title="编辑项目"
                              >
                                <PencilIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={cn(
                                  CMDB_ACTION_ICON_CLASS,
                                  "text-rose-600 hover:text-rose-700",
                                )}
                                onClick={() =>
                                  void handleDeleteProject(project)
                                }
                                title="删除项目"
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </ModuleSection>
      ) : null}

      {data && activeArea === "deployments" ? (
        <ModuleSection
          id="cmdb-panel-deployments"
          title="部署管理"
          description="查看最近发布记录、环境和 Pipeline 状态。"
          density="compact"
          className="rounded-[12px] border-slate-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          action={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-500">
                运行中{" "}
                <span className="font-semibold text-slate-950">
                  {data.overview.runningReleaseTotal}
                </span>
              </span>
              {projects.length > 0 ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-[9px] border-slate-300 bg-white"
                    onClick={() => openTopicReleaseDialog()}
                    disabled={releasableProjects.length === 0}
                    title={
                      releasableProjects.length === 0
                        ? "当前没有可发布的项目。"
                        : undefined
                    }
                  >
                    <ListChecksIcon data-icon="inline-start" />
                    主题发布
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-[9px] border-slate-300 bg-white"
                    onClick={() => setActiveArea("projects")}
                  >
                    <GitBranchIcon data-icon="inline-start" />
                    去项目区
                  </Button>
                </>
              ) : null}
            </div>
          }
        >
          {releases.length === 0 ? (
            <CmdbEmptyState
              icon={RocketIcon}
              title="还没有发布记录"
              description="从项目管理视图触发发布后，这里会显示最近的部署记录和 Pipeline 状态。"
              hints={[
                "先在项目管理中纳管 GitLab 项目",
                "确认 GitLab URL、API Token 或 Trigger Token",
                "触发发布后在这里跟踪 Pipeline 状态",
              ]}
              action={
                projects.length > 0 ? (
                  <Button
                    size="sm"
                    className="rounded-[10px]"
                    onClick={() => setActiveArea("projects")}
                  >
                    <GitBranchIcon data-icon="inline-start" />
                    去项目区查看
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 xl:hidden">
                {releases.map((release) => (
                  <article
                    key={`release-card-${release.id}`}
                    className="rounded-[12px] border border-slate-200/90 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-slate-950">
                          {release.project?.name ?? "未知项目"}
                        </h3>
                        <p className="mt-1 text-[13px] break-all text-slate-500">
                          {release.project?.gitlabPath ?? "-"}
                        </p>
                        {releaseTopic(release) ? (
                          <Badge className="mt-1.5 border border-sky-200 bg-sky-50 text-sky-700">
                            主题 {releaseTopic(release)}
                          </Badge>
                        ) : null}
                      </div>
                      <Badge
                        className={cn("border", releaseTone(release.status))}
                      >
                        {releaseLabel(release.status)}
                      </Badge>
                    </div>

                    <div className="mt-3 grid gap-x-5 gap-y-2 rounded-[10px] bg-slate-50/80 px-3 py-2.5 text-[13px] md:grid-cols-3">
                      <div>
                        <span className="block text-[11px] text-slate-500">
                          时间
                        </span>
                        <span className="mt-1 block font-medium text-slate-800">
                          {formatTime(release.createdAt)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] text-slate-500">
                          Ref
                        </span>
                        <span className="mt-1 block font-medium text-slate-800">
                          {release.ref}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] text-slate-500">
                          环境
                        </span>
                        <span className="mt-1 block font-medium text-slate-800">
                          {release.deployEnv ?? "-"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3">
                      {release.gitlabPipelineUrl ? (
                        <a
                          href={release.gitlabPipelineUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "h-8 rounded-[9px]",
                          )}
                        >
                          Pipeline #{release.gitlabPipelineId ?? release.id}
                          <ExternalLinkIcon data-icon="inline-end" />
                        </a>
                      ) : (
                        <p className="text-sm text-slate-500">
                          {release.lastError ?? "尚未返回流水线链接"}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex justify-end border-t border-slate-100 pt-2.5">
                      <div className={CMDB_ACTION_GROUP_CLASS}>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() =>
                            openReleaseOperation(release, "dockerStatus")
                          }
                          disabled={Boolean(
                            releaseOperationIssue(release, "dockerStatus"),
                          )}
                          title={
                            releaseOperationIssue(release, "dockerStatus") ??
                            "容器状态"
                          }
                        >
                          <ActivityIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() =>
                            openReleaseOperation(release, "dockerLogs")
                          }
                          disabled={Boolean(
                            releaseOperationIssue(release, "dockerLogs"),
                          )}
                          title={
                            releaseOperationIssue(release, "dockerLogs") ??
                            "运行日志"
                          }
                        >
                          <ScrollTextIcon />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={CMDB_ACTION_ICON_CLASS}
                          onClick={() =>
                            openReleaseOperation(release, "sshInfo")
                          }
                          disabled={Boolean(
                            releaseOperationIssue(release, "sshInfo"),
                          )}
                          title={
                            releaseOperationIssue(release, "sshInfo") ??
                            remoteLoginLabel(release.project?.deployTarget)
                          }
                        >
                          <TerminalIcon />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-hidden rounded-[12px] border border-slate-200/90 xl:block">
                <Table className="min-w-[900px]">
                  <TableHeader className="bg-slate-50/90">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>时间</TableHead>
                      <TableHead>项目</TableHead>
                      <TableHead>主题</TableHead>
                      <TableHead>Ref</TableHead>
                      <TableHead>环境</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>流水线</TableHead>
                      <TableHead className={STICKY_ACTION_HEAD_CLASS}>
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {releases.map((release) => (
                      <TableRow key={release.id} className="group">
                        <TableCell className="text-sm text-slate-600">
                          {formatTime(release.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            <span className="font-medium text-slate-950">
                              {release.project?.name ?? "未知项目"}
                            </span>
                            <span className="text-xs text-slate-500">
                              {release.project?.gitlabPath ?? "-"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {releaseTopic(release) ? (
                            <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                              {releaseTopic(release)}
                            </Badge>
                          ) : (
                            <span className="text-sm text-slate-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {release.ref}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {release.deployEnv ?? "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "border",
                              releaseTone(release.status),
                            )}
                          >
                            {releaseLabel(release.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {release.gitlabPipelineUrl ? (
                            <a
                              href={release.gitlabPipelineUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900"
                            >
                              Pipeline #{release.gitlabPipelineId ?? release.id}
                              <ExternalLinkIcon className="size-3.5" />
                            </a>
                          ) : (
                            <span className="text-sm text-slate-500">
                              {release.lastError ?? "尚未返回流水线链接"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={STICKY_ACTION_CELL_CLASS}>
                          <div className="flex justify-end gap-2">
                            <div className={CMDB_ACTION_GROUP_CLASS}>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() =>
                                  openReleaseOperation(release, "dockerStatus")
                                }
                                disabled={Boolean(
                                  releaseOperationIssue(
                                    release,
                                    "dockerStatus",
                                  ),
                                )}
                                title={
                                  releaseOperationIssue(
                                    release,
                                    "dockerStatus",
                                  ) ?? "容器状态"
                                }
                              >
                                <ActivityIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() =>
                                  openReleaseOperation(release, "dockerLogs")
                                }
                                disabled={Boolean(
                                  releaseOperationIssue(release, "dockerLogs"),
                                )}
                                title={
                                  releaseOperationIssue(
                                    release,
                                    "dockerLogs",
                                  ) ?? "运行日志"
                                }
                              >
                                <ScrollTextIcon />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className={CMDB_ACTION_ICON_CLASS}
                                onClick={() =>
                                  openReleaseOperation(release, "sshInfo")
                                }
                                disabled={Boolean(
                                  releaseOperationIssue(release, "sshInfo"),
                                )}
                                title={
                                  releaseOperationIssue(release, "sshInfo") ??
                                  remoteLoginLabel(
                                    release.project?.deployTarget,
                                  )
                                }
                              >
                                <TerminalIcon />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </ModuleSection>
      ) : null}

      <Dialog
        open={operationDialogOpen}
        onOpenChange={(open) => {
          if (open) setOperationDialogOpen(true);
          else closeOperationDialog();
        }}
      >
        <DialogContent
          className={cn(
            "grid grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border border-slate-200/90 bg-white p-0 shadow-[0_28px_70px_rgba(15,23,42,0.16)]",
            operationDialogMaximized
              ? "h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] rounded-[14px] sm:max-h-[calc(100dvh-0.75rem)] sm:max-w-[calc(100vw-0.75rem)]"
              : "max-h-[min(90vh,820px)] max-w-[calc(100vw-1rem)] rounded-[18px] sm:max-w-[1040px]",
          )}
        >
          <DialogHeader className="gap-0 border-b border-slate-200/80 bg-white px-4 py-3 pr-12 sm:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
                  <OperationIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <DialogTitle className="text-base leading-6 font-semibold tracking-[-0.02em] text-slate-950">
                    {projectOperationLabel(
                      operationAction,
                      operationProject?.deployTarget,
                    )}
                  </DialogTitle>
                  <DialogDescription className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">
                    {projectOperationDescription(
                      operationAction,
                      operationProject?.deployTarget,
                    )}
                  </DialogDescription>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {operationProject ? (
                  <Badge className="max-w-full truncate border border-slate-200 bg-slate-50 text-slate-700 md:max-w-[240px]">
                    {operationProject.name}
                  </Badge>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0 rounded-[10px]"
                  aria-label={
                    operationDialogMaximized ? "还原弹窗" : "最大化弹窗"
                  }
                  title={operationDialogMaximized ? "还原" : "最大化"}
                  onClick={() =>
                    setOperationDialogMaximized((current) => !current)
                  }
                >
                  {operationDialogMaximized ? (
                    <Minimize2Icon className="size-4" />
                  ) : (
                    <Maximize2Icon className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div
            className={cn(
              "grid min-h-0 gap-3 overflow-y-auto bg-slate-50/60 p-3 sm:p-4",
              operationDialogMaximized &&
                operationAction === "sshInfo" &&
                "grid-rows-[auto_minmax(0,1fr)]",
            )}
          >
            <div className="grid overflow-hidden rounded-[12px] border border-slate-200 bg-slate-200 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-white px-3 py-2.5">
                <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  目标资产
                </div>
                <div className="mt-1 truncate font-medium text-slate-950">
                  {operationTargetAssetName}
                </div>
              </div>
              <div className="bg-white px-3 py-2.5">
                <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  主机
                </div>
                <div className="mt-1 truncate font-medium text-slate-950">
                  {operationHost}
                </div>
              </div>
              <div className="bg-white px-3 py-2.5">
                <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  容器
                </div>
                <div className="mt-1 truncate font-medium text-slate-950">
                  {operationContainerName}
                </div>
              </div>
              <div className="bg-white px-3 py-2.5">
                <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  状态
                </div>
                <div className="mt-1 flex items-center gap-2 font-medium text-slate-950">
                  {operationHasStatus ? (
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        operationStatusFailed
                          ? "bg-rose-500"
                          : "bg-emerald-500",
                      )}
                    />
                  ) : operationPending ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin text-slate-500" />
                  ) : null}
                  {operationStatusText}
                </div>
              </div>
            </div>

            {operationAction === "sshInfo" ? (
              <div
                className={cn(
                  "grid gap-3",
                  operationDialogMaximized && "min-h-0",
                )}
              >
                {terminalError ? (
                  <Alert className="border-rose-200 bg-rose-50 text-rose-900">
                    <AlertTriangleIcon className="size-4" />
                    <AlertTitle>登录失败</AlertTitle>
                    <AlertDescription>{terminalError}</AlertDescription>
                  </Alert>
                ) : null}
                <div
                  className={cn(
                    "overflow-hidden rounded-[14px] border border-slate-900 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]",
                    operationDialogMaximized && "flex min-h-0 flex-col",
                  )}
                >
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex shrink-0 gap-1.5">
                        <span className="size-2 rounded-full bg-rose-400" />
                        <span className="size-2 rounded-full bg-amber-300" />
                        <span className="size-2 rounded-full bg-emerald-400" />
                      </span>
                      <span className="truncate font-mono text-xs text-slate-300">
                        {terminalSession?.containerName
                          ? `docker exec ${terminalSession.containerName}`
                          : `${terminalSession?.sshUser ?? ""}@${terminalSession?.host ?? operationHost}`}
                      </span>
                    </div>
                    <Badge
                      className={cn(
                        "shrink-0 border text-xs",
                        terminalStatus === "connected"
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                          : terminalStatus === "error"
                            ? "border-rose-400/25 bg-rose-400/10 text-rose-200"
                            : "border-slate-400/25 bg-slate-400/10 text-slate-200",
                      )}
                    >
                      {terminalStatusLabel(terminalStatus)}
                    </Badge>
                  </div>
                  <pre
                    ref={terminalScrollRef}
                    role="textbox"
                    aria-label="容器终端"
                    aria-readonly="false"
                    tabIndex={0}
                    onClick={() => terminalScrollRef.current?.focus()}
                    onKeyDown={handleTerminalKeyDown}
                    onPaste={(event) => {
                      if (terminalStatus !== "connected") return;

                      const text = event.clipboardData.getData("text");
                      if (!text) return;

                      event.preventDefault();
                      void sendTerminalData(text);
                    }}
                    className={cn(
                      "cursor-text overflow-auto px-3.5 py-3 font-mono text-[12px] leading-[1.65] whitespace-pre-wrap text-slate-100 outline-none [scrollbar-color:rgba(148,163,184,0.55)_transparent] focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:ring-inset",
                      operationDialogMaximized
                        ? "min-h-0 flex-1"
                        : "max-h-[min(58vh,620px)] min-h-[420px]",
                    )}
                  >
                    {terminalOutput || "正在建立 SSH 会话...\n"}
                  </pre>
                </div>
              </div>
            ) : projectOperation.isPending ? (
              <div className="flex min-h-[260px] items-center justify-center gap-2 rounded-[14px] border border-dashed border-slate-300 bg-white text-sm text-slate-600">
                <LoaderCircleIcon className="size-4 animate-spin" />
                正在连接目标资产并执行操作
              </div>
            ) : projectOperation.error ? (
              <Alert className="border-rose-200 bg-rose-50 text-rose-900">
                <AlertTriangleIcon className="size-4" />
                <AlertTitle>执行失败</AlertTitle>
                <AlertDescription>
                  {projectOperation.error.message}
                </AlertDescription>
              </Alert>
            ) : operationResult ? (
              <div className="grid gap-3">
                <div className="overflow-hidden rounded-[14px] border border-slate-900 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex shrink-0 gap-1.5">
                        <span className="size-2 rounded-full bg-rose-400" />
                        <span className="size-2 rounded-full bg-amber-300" />
                        <span className="size-2 rounded-full bg-emerald-400" />
                      </span>
                      <span className="truncate font-mono text-xs text-slate-300">
                        {operationAction === "dockerLogs"
                          ? "docker logs --tail 200"
                          : "docker ps / docker inspect"}
                      </span>
                    </div>
                    <Badge
                      className={cn(
                        "shrink-0 border text-xs",
                        operationExitCode === 0
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                          : "border-rose-400/25 bg-rose-400/10 text-rose-200",
                      )}
                    >
                      exit {operationExitCode}
                    </Badge>
                  </div>
                  <pre className="max-h-[min(54vh,520px)] min-h-[300px] overflow-auto px-3.5 py-3 font-mono text-[12px] leading-[1.65] whitespace-pre text-slate-100 [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
                    {operationText || "无输出"}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter
            bleed={false}
            className="border-t border-slate-200/90 bg-white px-4 py-3 sm:items-center sm:justify-between"
          >
            <div className="hidden text-xs text-slate-500 sm:block">
              {operationAction === "sshInfo"
                ? "终端由服务端实时连接目标资产，关闭弹窗会断开会话。"
                : "结果来自目标资产实时查询，不写入发布记录。"}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                className="rounded-[10px]"
                onClick={() => void copyOperationOutput()}
                disabled={!operationCopyText}
              >
                <ClipboardIcon data-icon="inline-start" />
                {operationCopied ? "已复制" : "复制"}
              </Button>
              {operationProject ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-[10px]"
                  onClick={() =>
                    openProjectOperation(operationProject, operationAction)
                  }
                  disabled={projectOperation.isPending}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  刷新
                </Button>
              ) : null}
              <Button
                size="sm"
                className="rounded-[10px]"
                onClick={closeOperationDialog}
              >
                关闭
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent
          initialFocus={false}
          className="flex max-h-[calc(100vh-1rem)] max-w-[1120px] flex-col gap-0 overflow-hidden border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
        >
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4 pr-12">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-lg leading-6 font-semibold tracking-[-0.03em]">
                  {assetDraft.id ? "编辑服务器资产" : "新增服务器资产"}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  维护服务器身份、SSH
                  端口可达性和运行画像，供部署目标选择与筛选使用。
                </DialogDescription>
              </div>
              <Badge className="w-fit border border-slate-200 bg-slate-50 text-slate-700">
                真实 SSH 登录
              </Badge>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid content-start gap-5">
                <section className="rounded-[14px] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-950">
                        资产身份与 SSH 登录
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        记录主机地址、SSH 用户和密码，并用真实登录验证部署入口。
                      </p>
                    </div>
                    <Badge className="w-fit border border-slate-200 bg-white text-slate-700">
                      必填
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <ProjectDraftField label="资产名称">
                      <Input
                        value={assetDraft.name}
                        onChange={(event) =>
                          setAssetDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="例如 prod-web-01"
                        autoComplete="off"
                      />
                    </ProjectDraftField>
                    <ProjectDraftField label="IP / 主机地址">
                      <Input
                        value={assetDraft.ip}
                        onChange={(event) =>
                          setAssetDraft((current) => ({
                            ...current,
                            ip: event.target.value,
                          }))
                        }
                        placeholder="192.168.5.23"
                        autoComplete="off"
                      />
                    </ProjectDraftField>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_150px]">
                    <ProjectDraftField label="SSH 用户">
                      <Input
                        value={assetDraft.sshUser}
                        onChange={(event) =>
                          setAssetDraft((current) => ({
                            ...current,
                            sshUser: event.target.value,
                          }))
                        }
                        placeholder="root"
                        autoComplete="off"
                      />
                    </ProjectDraftField>
                    <ProjectDraftField label="SSH 密码">
                      <Input
                        type="password"
                        value={assetDraft.sshPassword}
                        onChange={(event) =>
                          setAssetDraft((current) => ({
                            ...current,
                            sshPassword: event.target.value,
                          }))
                        }
                        placeholder="服务器登录密码"
                        autoComplete="new-password"
                      />
                    </ProjectDraftField>
                    <ProjectDraftField
                      label="SSH 端口"
                      hint={
                        assetSshPortValid ? "默认 22" : "请输入 1-65535 的整数"
                      }
                    >
                      <Input
                        value={assetDraft.sshPort}
                        onChange={(event) =>
                          setAssetDraft((current) => ({
                            ...current,
                            sshPort: event.target.value,
                          }))
                        }
                        placeholder="22"
                        autoComplete="off"
                        aria-invalid={!assetSshPortValid}
                        className={cn(
                          !assetSshPortValid &&
                            "border-rose-300 text-rose-900 focus-visible:ring-rose-200",
                        )}
                      />
                    </ProjectDraftField>
                  </div>

                  <div className="mt-4 rounded-[12px] border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white text-slate-600 ring-1 ring-slate-200">
                          <RefreshCwIcon className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-900">
                              SSH 登录验证
                            </p>
                            <Badge
                              className={cn(
                                "border",
                                assetConnectivityTone(
                                  assetDetectedStatus,
                                  Boolean(assetConnectionResult),
                                ),
                              )}
                            >
                              {assetConnectivityLabel}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {assetConnectionMessage}
                            {assetConnectionResult ? (
                              <span className="ml-2 text-slate-500">
                                · {assetConnectionResult.durationMs} ms
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit rounded-[10px]"
                        onClick={runAssetConnectivityTest}
                        disabled={
                          testAssetConnectivity.isPending ||
                          !assetCanTestConnectivity
                        }
                      >
                        {testAssetConnectivity.isPending ? (
                          <LoaderCircleIcon
                            className="animate-spin"
                            data-icon="inline-start"
                          />
                        ) : (
                          <RefreshCwIcon data-icon="inline-start" />
                        )}
                        登录测试
                      </Button>
                    </div>
                  </div>
                </section>

                <section className="rounded-[14px] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-950">
                      运行画像
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      用角色标签和架构信息描述这台机器，方便后续筛选和分配部署目标。
                    </p>
                  </div>

                  <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.18fr)_minmax(220px,0.82fr)]">
                    <ProjectDraftField
                      label="角色标签"
                      hint="输入后按 Enter 或逗号确认，支持快速删除和常用角色补全。"
                    >
                      <div className="grid gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="flex min-h-7 flex-wrap gap-2">
                          {assetRoleTags.length > 0 ? (
                            assetRoleTags.map((role) => (
                              <Badge
                                key={role}
                                className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700"
                              >
                                {role}
                                <button
                                  type="button"
                                  className="text-slate-400 hover:text-slate-700"
                                  onClick={() => removeAssetRole(role)}
                                  aria-label={`移除角色 ${role}`}
                                >
                                  <XIcon className="size-3.5" />
                                </button>
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-slate-400">
                              还没有添加角色标签
                            </span>
                          )}
                        </div>

                        <Input
                          value={assetRoleInput}
                          onChange={(event) =>
                            setAssetRoleInput(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === ",") {
                              event.preventDefault();
                              addAssetRole(assetRoleInput);
                            }

                            if (
                              event.key === "Backspace" &&
                              assetRoleInput.length === 0 &&
                              assetRoleTags.length > 0
                            ) {
                              removeAssetRole(
                                assetRoleTags[assetRoleTags.length - 1]!,
                              );
                            }
                          }}
                          placeholder="输入角色后按 Enter，例如 master"
                        />

                        <div className="flex flex-wrap gap-2">
                          {["master", "worker", "gpu", "etcd"].map((role) => (
                            <Button
                              key={role}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-[10px]"
                              onClick={() => addAssetRole(role)}
                              disabled={assetRoleTags.includes(role)}
                            >
                              + {role}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </ProjectDraftField>

                    <div className="grid content-start gap-4">
                      <ProjectDraftField label="架构">
                        <Select
                          value={assetArchSelectValue ?? undefined}
                          onValueChange={(value) => {
                            if (!value) return;

                            if (value === UNSET_ARCH_VALUE) {
                              setAssetDraft((current) => ({
                                ...current,
                                arch: "",
                              }));
                              return;
                            }

                            if (value === CUSTOM_ARCH_VALUE) {
                              setAssetDraft((current) => ({
                                ...current,
                                arch:
                                  current.arch.trim().length > 0 &&
                                  current.arch !== "amd64" &&
                                  current.arch !== "arm64"
                                    ? current.arch
                                    : "other",
                              }));
                              return;
                            }

                            setAssetDraft((current) => ({
                              ...current,
                              arch: value,
                            }));
                          }}
                        >
                          <SelectTrigger className="w-full rounded-[10px]">
                            <SelectValue placeholder="选择架构">
                              {(value) =>
                                value === UNSET_ARCH_VALUE
                                  ? "未指定"
                                  : value === CUSTOM_ARCH_VALUE
                                    ? "其他"
                                    : value === "amd64"
                                      ? "amd64 / x86_64"
                                      : value === "arm64"
                                        ? "arm64 / aarch64"
                                        : "选择架构"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="rounded-[12px]">
                            <SelectGroup>
                              <SelectItem value={UNSET_ARCH_VALUE}>
                                未指定
                              </SelectItem>
                              <SelectItem value="amd64">
                                amd64 / x86_64
                              </SelectItem>
                              <SelectItem value="arm64">
                                arm64 / aarch64
                              </SelectItem>
                              <SelectItem value={CUSTOM_ARCH_VALUE}>
                                其他
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </ProjectDraftField>

                      {assetArchSelectValue === CUSTOM_ARCH_VALUE ? (
                        <ProjectDraftField label="自定义架构">
                          <Input
                            value={assetDraft.arch}
                            onChange={(event) =>
                              setAssetDraft((current) => ({
                                ...current,
                                arch: event.target.value,
                              }))
                            }
                            placeholder="例如 riscv64"
                          />
                        </ProjectDraftField>
                      ) : null}
                    </div>
                  </div>
                </section>
              </div>

              <aside className="grid content-start gap-4 xl:sticky xl:top-0">
                <section className="rounded-[14px] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-700">
                      <ShieldCheckIcon className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">
                        保存前检查
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        必填项补齐后即可保存，登录测试用于提前暴露账号或网络问题。
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <AssetReadinessItem
                      ok={assetNameReady}
                      label="资产名称"
                      description={
                        assetNameReady
                          ? "已填写唯一识别名"
                          : "用于列表检索和部署目标选择"
                      }
                    />
                    <AssetReadinessItem
                      ok={assetHostReady}
                      label="主机地址"
                      description={
                        assetHostReady
                          ? "已填写 IP 或主机名"
                          : "需要一个可访问的 IP 或 DNS 名称"
                      }
                    />
                    <AssetReadinessItem
                      ok={assetSshPortValid}
                      label="SSH 端口"
                      description={
                        assetSshPortValid
                          ? `将使用 ${assetSshPortPreview} 端口`
                          : "端口必须是 1-65535 的整数"
                      }
                    />
                    <AssetReadinessItem
                      ok={assetSshUserReady}
                      label="SSH 用户"
                      description={
                        assetSshUserReady
                          ? "已填写登录用户"
                          : "用于 GitLab Pipeline 登录目标机器"
                      }
                    />
                    <AssetReadinessItem
                      ok={assetSshPasswordReady}
                      label="SSH 密码"
                      description={
                        assetSshPasswordReady
                          ? "已填写登录密码"
                          : "需要密码才能完成真实 SSH 登录"
                      }
                    />
                    <AssetReadinessItem
                      ok={assetConnectivityReady}
                      label="SSH 登录测试"
                      description={
                        assetConnectionResult
                          ? `最近一次结果：${assetConnectivityLabel}`
                          : assetDraft.id
                            ? `当前记录状态：${assetConnectivityLabel}`
                            : "建议保存前完成一次真实登录"
                      }
                    />
                    <AssetReadinessItem
                      ok={assetRolesReady}
                      label="角色标签"
                      description={
                        assetRolesReady
                          ? `${assetRoleTags.length} 个标签已添加`
                          : "可选，但建议标记 master、worker 或 gpu"
                      }
                    />
                  </div>
                </section>

                <section className="rounded-[14px] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                      <KeyRoundIcon className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">
                        SSH 部署凭据
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        后续发布会把这里保存的账号密码注入 GitLab Pipeline。
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[12px] border border-sky-100 bg-sky-50/70 px-3 py-3 text-sm leading-6 text-slate-700">
                    当前 CMDB 会保存 SSH 用户、密码和端口；“登录测试”会真正建立
                    SSH 会话。部署目标选择 SSH 时，会把目标资产整理为
                    DEPLOY_TARGETS_JSON，并由仓库里的 .gitlab-ci.yml 执行发布。
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-slate-50 px-3 py-2">
                      <span>当前测试</span>
                      <span className="font-medium text-slate-800">
                        SSH 登录
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-slate-50 px-3 py-2">
                      <span>部署使用</span>
                      <span className="font-medium text-slate-800">
                        Pipeline 变量
                      </span>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </div>

          <DialogFooter
            bleed={false}
            className="border-slate-200/90 bg-white px-5 py-4"
          >
            <Button
              variant="outline"
              className="rounded-[10px]"
              onClick={() => setAssetDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              className="rounded-[10px]"
              onClick={saveAssetDraft}
              disabled={
                saveAsset.isPending ||
                testAssetConnectivity.isPending ||
                !assetNameReady ||
                !assetHostReady ||
                !assetSshUserReady ||
                !assetSshPasswordReady ||
                !assetSshPortValid
              }
            >
              {saveAsset.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              保存资产
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent
          initialFocus={false}
          className="flex max-h-[calc(100vh-1rem)] max-w-[1040px] flex-col gap-0 overflow-hidden border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
        >
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4 pr-12">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-lg leading-6 font-semibold tracking-[-0.03em]">
                  {projectDraft.id ? "编辑 CMDB 项目" : "纳管 GitLab 项目"}
                </DialogTitle>
                <DialogDescription className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  先定仓库，再按步骤补齐部署、观测和变量。保存前底部会显示关键配置。
                </DialogDescription>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Badge className={cn("border", gitlabBadgeTone)}>
                  {gitlabBadgeLabel}
                </Badge>
                {data?.gitlab.baseUrl ? (
                  <Badge className="max-w-[260px] truncate border border-slate-200 bg-slate-50 text-slate-700">
                    {data.gitlab.baseUrl}
                  </Badge>
                ) : null}
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid items-start gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
              <section className="grid content-start gap-3 self-start rounded-[12px] border border-slate-200 bg-white p-3 shadow-[0_8px_22px_rgba(15,23,42,0.04)] md:sticky md:top-0">
                <ProjectDraftField label="搜索仓库" className="gap-1.5">
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={gitlabSearch}
                      onChange={(event) => setGitlabSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || !canUseManualGitLabPath) {
                          return;
                        }

                        event.preventDefault();
                        applyManualGitLabPath();
                      }}
                      placeholder="搜索项目或输入 group/project"
                      className="h-8 rounded-[9px] bg-white pr-8 pl-8 text-sm"
                    />
                    {gitlabSearch.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setGitlabSearch("")}
                        className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label="清空仓库搜索"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                </ProjectDraftField>

                {manualGitLabPath.length > 0 &&
                !manualGitLabPathMatchesCatalog &&
                !manualGitLabPathIsSelected ? (
                  <button
                    type="button"
                    onClick={applyManualGitLabPath}
                    disabled={
                      !canUseManualGitLabPath || manualGitLabPathIsSelected
                    }
                    className={cn(
                      "flex min-h-9 items-center gap-2 rounded-[10px] border px-3 py-2 text-left text-xs transition",
                      canUseManualGitLabPath
                        ? "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 hover:bg-sky-100/70"
                        : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400",
                    )}
                  >
                    <GitBranchIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {manualGitLabPathIsSelected
                        ? "已使用当前路径"
                        : canUseManualGitLabPath
                          ? `使用 ${manualGitLabPath}`
                          : "输入 group/project 后可手动使用"}
                    </span>
                    {manualGitLabPathIsSelected ? (
                      <CheckCircle2Icon className="size-3.5 shrink-0" />
                    ) : null}
                  </button>
                ) : null}

                {data?.gitlab.canBrowseCatalog ? (
                  gitlabCatalogQuery.isLoading ? (
                    <div className="grid gap-1.5 rounded-[10px] border border-slate-200 bg-slate-50/70 p-1.5">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <Skeleton
                          key={`gitlab-candidate-${index}`}
                          className="h-10 rounded-[8px]"
                        />
                      ))}
                    </div>
                  ) : gitlabCatalogItems.length > 0 ? (
                    <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50/70">
                      <div className="flex h-8 items-center justify-between gap-3 border-b border-slate-200/80 px-3 text-xs text-slate-500">
                        <span>候选仓库</span>
                        <span>{gitlabCatalogItems.length} 个结果</span>
                      </div>
                      <div className="max-h-[220px] overflow-x-hidden overflow-y-auto p-1 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin] md:max-h-[280px] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
                        <div className="grid gap-1">
                          {visibleGitLabCatalogItems.map((item) => {
                            const active =
                              projectDraft.gitlabPath === item.path;

                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  applyGitLabCandidate(item);
                                  setGitlabSearch(item.path);
                                  setProjectDraftPanel("basic");
                                }}
                                className={cn(
                                  "group flex min-h-10 w-full items-center gap-3 rounded-[8px] px-2.5 py-1.5 text-left transition",
                                  active
                                    ? "bg-sky-50 text-slate-950 ring-1 ring-sky-200"
                                    : "text-slate-800 hover:bg-white hover:shadow-[0_2px_8px_rgba(15,23,42,0.04)]",
                                )}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">
                                    {item.name}
                                  </p>
                                  <p className="truncate text-[12px] leading-5 text-slate-500">
                                    {item.path}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "max-w-20 truncate rounded-full px-2 py-0.5 text-[11px]",
                                      active
                                        ? "bg-white text-sky-700 ring-1 ring-sky-100"
                                        : "bg-slate-100 text-slate-500 group-hover:bg-slate-50",
                                    )}
                                  >
                                    {item.defaultBranch}
                                  </span>
                                  {active ? (
                                    <CheckCircle2Icon className="size-3.5 text-sky-600" />
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : selectedRepoSummary &&
                    manualGitLabPathIsSelected ? null : (
                    <div className="rounded-[10px] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm leading-5 text-slate-500">
                      没有匹配结果。可使用上方路径，或继续输入缩小范围。
                    </div>
                  )
                ) : (
                  <Alert className="border-slate-200 bg-slate-50 text-slate-800">
                    <AlertTriangleIcon className="size-4" />
                    <AlertTitle>GitLab 目录浏览不可用</AlertTitle>
                    <AlertDescription>
                      配置 GITLAB_API_TOKEN
                      后会显示候选仓库；当前仍可手动使用路径。
                    </AlertDescription>
                  </Alert>
                )}

                <div
                  className={cn(
                    "rounded-[12px] border px-3 py-3",
                    selectedRepoSummary
                      ? "border-slate-200 bg-slate-50/70"
                      : "border-dashed border-slate-300 bg-slate-50/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-medium tracking-[0.12em] text-slate-500 uppercase">
                      当前仓库
                    </p>
                    {selectedRepoSummary ? (
                      <Badge className="border border-slate-200 bg-white text-slate-700">
                        {selectedRepoSummary.defaultBranch}
                      </Badge>
                    ) : null}
                  </div>
                  {selectedRepoSummary ? (
                    <div className="mt-2 flex min-w-0 gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white text-sky-700 ring-1 ring-sky-100">
                        <GitBranchIcon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {selectedRepoSummary.name}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 break-all text-slate-600">
                          {selectedRepoSummary.path}
                        </p>
                        <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">
                          {selectedRepoSummary.description ||
                            "已选仓库会用于发布和检索。"}
                        </p>
                        {selectedRepoSummary.webUrl ? (
                          <a
                            href={selectedRepoSummary.webUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                          >
                            打开 GitLab
                            <ExternalLinkIcon className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      点选候选仓库，或输入 group/project 后点击“使用”。
                    </p>
                  )}
                </div>
              </section>

              <div className="flex min-w-0 flex-col gap-4 self-start">
                <div className="flex gap-1 overflow-x-auto rounded-[12px] border border-slate-200 bg-slate-50/90 p-1">
                  {projectDraftPanels.map((panel) => {
                    const Icon = panel.icon;
                    const active = projectDraftPanel === panel.key;

                    return (
                      <button
                        key={panel.key}
                        type="button"
                        onClick={() => setProjectDraftPanel(panel.key)}
                        className={cn(
                          "flex h-10 min-w-[112px] flex-1 items-center justify-center gap-2 rounded-[9px] px-3 text-left transition",
                          active
                            ? "bg-white text-slate-950 shadow-[0_4px_14px_rgba(15,23,42,0.08)] ring-1 ring-slate-200"
                            : "text-slate-600 hover:bg-white/70 hover:text-slate-950",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            active ? "text-sky-700" : "text-slate-500",
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {panel.label}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                {projectDraftPanel === "basic" ? (
                  <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-950">
                        基础信息
                      </h3>
                      <p className="text-sm leading-6 text-slate-500">
                        名称、路径、状态和默认分支。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <ProjectDraftField label="项目名称">
                        <Input
                          value={projectDraft.name}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          placeholder="例如 CMDB Console"
                        />
                      </ProjectDraftField>
                      <ProjectDraftField label="项目状态">
                        <Select
                          value={projectDraft.enabled}
                          onValueChange={(value) => {
                            if (!value) return;
                            setProjectDraft((current) => ({
                              ...current,
                              enabled: value,
                            }));
                          }}
                        >
                          <SelectTrigger className="w-full rounded-[10px]">
                            <SelectValue>
                              {projectStatusLabel(projectDraft.enabled)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="rounded-[12px]">
                            <SelectGroup>
                              <SelectItem value="true">启用</SelectItem>
                              <SelectItem value="false">禁用</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </ProjectDraftField>
                    </div>

                    <ProjectDraftField
                      label="GitLab 路径"
                      hint="格式为 group/project，可自动回填后手动修正。"
                    >
                      <Input
                        value={projectDraft.gitlabPath}
                        onChange={(event) =>
                          setProjectDraft((current) => ({
                            ...current,
                            gitlabPath: event.target.value,
                          }))
                        }
                        placeholder="xdream/cola"
                        aria-invalid={projectPathMissing}
                      />
                    </ProjectDraftField>

                    <ProjectDraftField label="描述">
                      <Textarea
                        value={projectDraft.description}
                        onChange={(event) =>
                          setProjectDraft((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        placeholder="描述这个项目在 CMDB 中负责什么服务。"
                        className="min-h-[104px]"
                      />
                    </ProjectDraftField>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,240px)]">
                      <ProjectDraftField label="默认分支">
                        <Input
                          value={projectDraft.defaultBranch}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              defaultBranch: event.target.value,
                            }))
                          }
                          placeholder="main"
                        />
                      </ProjectDraftField>
                    </div>
                  </section>
                ) : null}

                {projectDraftPanel === "deploy" ? (
                  <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-950">
                        部署配置
                      </h3>
                      <p className="text-sm leading-6 text-slate-500">
                        默认触发仓库里的 .gitlab-ci.yml，并注入部署目标变量。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <ProjectDraftField label="部署目标">
                        <Select
                          value={projectDraft.deployTarget}
                          onValueChange={(value) => {
                            if (!value) return;
                            setProjectDraft((current) => ({
                              ...current,
                              deployTarget: value,
                            }));
                          }}
                        >
                          <SelectTrigger className="w-full rounded-[10px]">
                            <SelectValue>
                              {draftDeployTargetLabel(
                                projectDraft.deployTarget,
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="rounded-[12px]">
                            <SelectGroup>
                              <SelectItem value="k8s">Kubernetes</SelectItem>
                              <SelectItem value="ssh">SSH</SelectItem>
                              <SelectItem value="docker">Docker</SelectItem>
                              <SelectItem value="none">None</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </ProjectDraftField>
                      <ProjectDraftField
                        label="目标资产"
                        hint="可选择多台服务器，发布时会作为 DEPLOY_TARGETS_JSON 传入 Pipeline。"
                      >
                        <div className="grid gap-2 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
                          <div className="flex min-h-7 flex-wrap gap-2">
                            {projectDraft.targetAssetNames.length > 0 ? (
                              projectDraft.targetAssetNames.map((assetName) => (
                                <Badge
                                  key={`target-asset-${assetName}`}
                                  className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700"
                                >
                                  {assetName}
                                  <button
                                    type="button"
                                    className="text-slate-400 hover:text-slate-700"
                                    onClick={() =>
                                      removeProjectTargetAsset(assetName)
                                    }
                                    aria-label={`移除目标资产 ${assetName}`}
                                  >
                                    <XIcon className="size-3.5" />
                                  </button>
                                </Badge>
                              ))
                            ) : (
                              <span className="text-sm text-slate-400">
                                还没有选择目标资产
                              </span>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <Select
                              value={UNASSIGNED_VALUE}
                              onValueChange={(value) => {
                                if (!value) return;
                                addProjectTargetAsset(value);
                              }}
                            >
                              <SelectTrigger className="w-full rounded-[10px] bg-white">
                                <SelectValue placeholder="添加目标资产">
                                  添加目标资产
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent className="rounded-[12px]">
                                <SelectGroup>
                                  <SelectItem value={UNASSIGNED_VALUE}>
                                    选择资产
                                  </SelectItem>
                                  {assets
                                    .filter(
                                      (asset) =>
                                        !projectDraft.targetAssetNames.includes(
                                          asset.name,
                                        ),
                                    )
                                    .map((asset) => (
                                      <SelectItem
                                        key={`cmdb-asset-${asset.name}`}
                                        value={asset.name}
                                      >
                                        {asset.name} ({asset.ip})
                                      </SelectItem>
                                    ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            {projectDraft.targetAssetNames.length > 0 ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-[10px] bg-white"
                                onClick={clearProjectTargetAssets}
                              >
                                清空
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </ProjectDraftField>
                      <ProjectDraftField label="部署环境">
                        <Input
                          value={projectDraft.deployEnv}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              deployEnv: event.target.value,
                            }))
                          }
                          placeholder="prod"
                        />
                      </ProjectDraftField>
                      <ProjectDraftField
                        label="Trigger Token"
                        hint="可选；用于触发 .gitlab-ci.yml，未配置则使用全局 GitLab API Token。"
                      >
                        <Input
                          value={projectDraft.triggerToken}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              triggerToken: event.target.value,
                            }))
                          }
                          placeholder="GitLab Pipeline Trigger Token"
                        />
                      </ProjectDraftField>
                    </div>

                    {projectDraft.deployTarget === "none" ? (
                      <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                        当前项目只保存 CMDB 记录，不触发部署。
                      </div>
                    ) : null}

                    {projectDraft.deployTarget === "k8s" ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <ProjectDraftField label="K8s Namespace">
                          <Input
                            value={projectDraft.k8sNamespace}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                k8sNamespace: event.target.value,
                              }))
                            }
                            placeholder="default"
                          />
                        </ProjectDraftField>
                        <ProjectDraftField label="K8s Deployment">
                          <Input
                            value={projectDraft.k8sDeployment}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                k8sDeployment: event.target.value,
                              }))
                            }
                            placeholder="cola-web"
                          />
                        </ProjectDraftField>
                      </div>
                    ) : null}

                    {projectDraft.deployTarget === "docker" ? (
                      <ProjectDraftField label="Docker 镜像">
                        <Input
                          value={projectDraft.dockerImage}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              dockerImage: event.target.value,
                            }))
                          }
                          placeholder="registry.local/cola/web:latest"
                        />
                      </ProjectDraftField>
                    ) : null}

                    {projectDraft.deployTarget === "ssh" ? (
                      <div className="grid gap-4">
                        <Alert className="border-sky-200 bg-sky-50 text-sky-900">
                          <GitBranchIcon className="size-4" />
                          <AlertTitle>默认使用 .gitlab-ci.yml 发布</AlertTitle>
                          <AlertDescription>
                            发布时会触发 GitLab Pipeline，并注入
                            DEPLOY_HOST、DEPLOY_SSH_USER、DEPLOY_SSH_PASSWORD、DEPLOY_SSH_PORT
                            等变量。部署路径和部署命令可留空，由仓库里的
                            .gitlab-ci.yml 决定。
                          </AlertDescription>
                        </Alert>

                        <div className="grid gap-4 md:grid-cols-2">
                          <ProjectDraftField
                            label="部署路径变量"
                            hint="可选；会作为 DEPLOY_PATH 传入 Pipeline。"
                          >
                            <Input
                              value={projectDraft.sshPath}
                              onChange={(event) =>
                                setProjectDraft((current) => ({
                                  ...current,
                                  sshPath: event.target.value,
                                }))
                              }
                              placeholder="/srv/cola"
                            />
                          </ProjectDraftField>
                          <ProjectDraftField
                            label="部署命令变量"
                            hint="可选；会作为 DEPLOY_COMMAND 传入 Pipeline。"
                          >
                            <Input
                              value={projectDraft.sshDeployCommand}
                              onChange={(event) =>
                                setProjectDraft((current) => ({
                                  ...current,
                                  sshDeployCommand: event.target.value,
                                }))
                              }
                              placeholder="docker compose up -d --build"
                            />
                          </ProjectDraftField>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {projectDraftPanel === "observe" ? (
                  <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-950">
                        运行与观测
                      </h3>
                      <p className="text-sm leading-6 text-slate-500">
                        健康检查入口和监控面板链接。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <ProjectDraftField label="健康检查 URL">
                        <Input
                          value={projectDraft.healthUrl}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              healthUrl: event.target.value,
                            }))
                          }
                          placeholder="http://service.local/healthz"
                        />
                      </ProjectDraftField>
                      <ProjectDraftField label="监控面板 URL">
                        <Input
                          value={projectDraft.monitorUrl}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              monitorUrl: event.target.value,
                            }))
                          }
                          placeholder="https://grafana.local/d/..."
                        />
                      </ProjectDraftField>
                    </div>
                  </section>
                ) : null}

                {projectDraftPanel === "variables" ? (
                  <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-950">
                        默认流水线变量
                      </h3>
                      <p className="text-sm leading-6 text-slate-500">
                        每行一个 KEY=VALUE，发布时可追加覆盖。
                      </p>
                    </div>

                    <ProjectDraftField label="自定义变量">
                      <Textarea
                        value={projectDraft.customVariablesText}
                        onChange={(event) =>
                          setProjectDraft((current) => ({
                            ...current,
                            customVariablesText: event.target.value,
                          }))
                        }
                        placeholder={"APP_NAME=cola\nNODE_ENV=production"}
                        className="min-h-[154px]"
                      />
                    </ProjectDraftField>
                  </section>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter
            bleed={false}
            className="shrink-0 flex-col items-stretch border-slate-200/90 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center"
          >
            <div className="mr-auto flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <Badge
                className={cn(
                  "border",
                  projectPathMissing
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700",
                )}
              >
                {projectPathMissing ? "缺少 GitLab 路径" : "路径已填写"}
              </Badge>
              <span className="max-w-[280px] truncate text-slate-600">
                {selectedRepoSummary?.path ?? "未选择仓库"}
              </span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-600">{projectDeploymentSummary}</span>
            </div>
            <Button
              variant="outline"
              className="rounded-[10px]"
              onClick={() => setProjectDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              className="rounded-[10px]"
              onClick={saveProjectDraft}
              disabled={projectSaveDisabled}
            >
              {saveProject.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              保存项目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>触发代码发布</DialogTitle>
            <DialogDescription>
              当前发布将触发 GitLab Pipeline，默认由仓库里的 .gitlab-ci.yml
              执行部署，并自动注入 CMDB 部署目标变量。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <ProjectDraftField label="项目">
              <Input value={releaseDraft.projectName} readOnly />
            </ProjectDraftField>
            <div className="grid gap-4 md:grid-cols-2">
              <ProjectDraftField label="Ref / Branch / Tag">
                <Input
                  value={releaseDraft.ref}
                  onChange={(event) =>
                    setReleaseDraft((current) => ({
                      ...current,
                      ref: event.target.value,
                    }))
                  }
                  placeholder="main"
                />
              </ProjectDraftField>
              <ProjectDraftField label="部署环境">
                <Input
                  value={releaseDraft.deployEnv}
                  onChange={(event) =>
                    setReleaseDraft((current) => ({
                      ...current,
                      deployEnv: event.target.value,
                    }))
                  }
                  placeholder="prod"
                />
              </ProjectDraftField>
            </div>
            <ProjectDraftField
              label="本次附加变量"
              hint="每行一个 KEY=VALUE，会覆盖项目默认变量。"
            >
              <Textarea
                value={releaseDraft.variablesText}
                onChange={(event) =>
                  setReleaseDraft((current) => ({
                    ...current,
                    variablesText: event.target.value,
                  }))
                }
                placeholder={"IMAGE_TAG=2026.04.24\nROLLOUT_BATCH=blue"}
                className="min-h-[140px]"
              />
            </ProjectDraftField>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReleaseDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={triggerReleaseDraftAction}
              disabled={triggerRelease.isPending || !releaseDraft.projectId}
            >
              {triggerRelease.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RocketIcon data-icon="inline-start" />
              )}
              触发发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={topicReleaseDialogOpen}
        onOpenChange={(open) => {
          setTopicReleaseDialogOpen(open);
          if (!open) {
            setTopicReleaseResult(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100vh-1rem)] max-w-[920px] flex-col gap-0 overflow-hidden border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4 pr-12">
            <DialogTitle className="text-lg leading-6 font-semibold tracking-[-0.03em]">
              主题发布
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              圈选多个项目后统一触发 GitLab Pipeline。Ref
              留空时使用各项目默认分支，环境留空时使用项目默认环境。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <section className="grid content-start gap-4 rounded-[14px] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    发布主题
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    本次批量发布会写入 CMDB_RELEASE_TOPIC
                    变量，便于流水线和发布记录追踪。
                  </p>
                </div>

                <ProjectDraftField label="主题名称">
                  <Input
                    value={topicReleaseDraft.topic}
                    onChange={(event) => {
                      setTopicReleaseDraft((current) => ({
                        ...current,
                        topic: event.target.value,
                      }));
                      setTopicReleaseResult(null);
                    }}
                    placeholder="例如 Vision MVP 发布"
                  />
                </ProjectDraftField>

                <div className="grid gap-4 md:grid-cols-2">
                  <ProjectDraftField
                    label="Ref / Branch / Tag"
                    hint="留空使用各项目默认分支。"
                  >
                    <Input
                      value={topicReleaseDraft.ref}
                      onChange={(event) => {
                        setTopicReleaseDraft((current) => ({
                          ...current,
                          ref: event.target.value,
                        }));
                        setTopicReleaseResult(null);
                      }}
                      placeholder="main / v1.2.0"
                    />
                  </ProjectDraftField>
                  <ProjectDraftField
                    label="部署环境"
                    hint="留空使用项目默认环境。"
                  >
                    <Input
                      value={topicReleaseDraft.deployEnv}
                      onChange={(event) => {
                        setTopicReleaseDraft((current) => ({
                          ...current,
                          deployEnv: event.target.value,
                        }));
                        setTopicReleaseResult(null);
                      }}
                      placeholder="prod"
                    />
                  </ProjectDraftField>
                </div>

                <ProjectDraftField
                  label="附加变量"
                  hint="每行一个 KEY=VALUE，会覆盖各项目默认变量。"
                >
                  <Textarea
                    value={topicReleaseDraft.variablesText}
                    onChange={(event) => {
                      setTopicReleaseDraft((current) => ({
                        ...current,
                        variablesText: event.target.value,
                      }));
                      setTopicReleaseResult(null);
                    }}
                    placeholder={"IMAGE_TAG=2026.04.27\nROLLOUT_BATCH=blue"}
                    className="min-h-[120px]"
                  />
                </ProjectDraftField>

                {topicReleaseResult ? (
                  <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-950">
                        发布结果
                      </p>
                      <span className="text-xs text-slate-500">
                        成功 {topicReleaseResult.successTotal} / 总计{" "}
                        {topicReleaseResult.total}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {topicReleaseResult.results.map((result) => (
                        <div
                          key={`${result.projectId}-${result.releaseId ?? "none"}`}
                          className="flex items-start justify-between gap-3 rounded-[10px] bg-white px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {result.projectName ?? `项目 ${result.projectId}`}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {result.gitlabPath ?? result.error ?? "-"}
                            </p>
                          </div>
                          <Badge
                            className={cn(
                              "border",
                              topicReleaseStatusTone(result.status),
                            )}
                          >
                            {topicReleaseStatusLabel(result.status)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="grid content-start gap-4 rounded-[14px] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">
                      选择项目
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      当前可发布 {releasableProjects.length} 个，已选择{" "}
                      {selectedTopicProjects.length} 个。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-[9px]"
                      onClick={selectAllTopicReleaseProjects}
                      disabled={releasableProjects.length === 0}
                    >
                      全选
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-[9px]"
                      onClick={clearTopicReleaseProjects}
                      disabled={topicReleaseDraft.projectIds.length === 0}
                    >
                      清空
                    </Button>
                  </div>
                </div>

                <div className="grid max-h-[430px] gap-2 overflow-y-auto pr-1">
                  {projects.map((project) => {
                    const selected = topicReleaseSelectedIds.has(project.id);
                    const releaseIssue = projectReleaseIssue(
                      project,
                      canTriggerPipelines,
                    );

                    return (
                      <label
                        key={`topic-release-${project.id}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-3 transition",
                          selected
                            ? "border-sky-200 bg-sky-50/70"
                            : "border-slate-200 bg-white hover:border-slate-300",
                          releaseIssue &&
                            "cursor-not-allowed bg-slate-50 opacity-70 hover:border-slate-200",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selected}
                          disabled={Boolean(releaseIssue)}
                          onChange={() => toggleTopicReleaseProject(project.id)}
                        />
                        <span
                          className={cn(
                            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                            selected
                              ? "border-sky-300 bg-white text-sky-700"
                              : "border-slate-200 bg-slate-50 text-slate-400",
                          )}
                        >
                          {selected ? (
                            <CheckCircle2Icon className="size-4" />
                          ) : (
                            <CircleDotIcon className="size-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-950">
                              {project.name}
                            </span>
                            <Badge className="border border-slate-200 bg-white text-slate-700">
                              {deployTargetLabel(project.deployTarget)}
                            </Badge>
                            {!project.enabled ? (
                              <Badge className="border border-slate-200 bg-slate-100 text-slate-700">
                                已禁用
                              </Badge>
                            ) : null}
                          </span>
                          <span className="mt-1 block truncate text-xs text-slate-500">
                            {project.gitlabPath}
                          </span>
                          <span className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                            <span>默认分支 {project.defaultBranch}</span>
                            <span>环境 {project.config?.deployEnv ?? "-"}</span>
                            {releaseIssue ? (
                              <span className="text-rose-600">
                                {releaseIssue}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>

          <DialogFooter
            bleed={false}
            className="border-slate-200/90 bg-white px-5 py-4"
          >
            <div className="mr-auto hidden items-center gap-2 text-sm text-slate-500 md:flex">
              <ListChecksIcon className="size-4 text-slate-400" />
              <span>{selectedTopicProjects.length} 个项目已圈选</span>
            </div>
            <Button
              variant="outline"
              className="rounded-[10px]"
              onClick={() => setTopicReleaseDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              className="rounded-[10px]"
              onClick={triggerTopicReleaseDraftAction}
              disabled={!topicReleaseCanSubmit}
            >
              {triggerTopicRelease.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RocketIcon data-icon="inline-start" />
              )}
              一键发布
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </ModulePageShell>
  );
}
