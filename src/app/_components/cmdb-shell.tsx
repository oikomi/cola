"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  InfoIcon,
  KeyRoundIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  Minimize2Icon,
  MonitorCogIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ScrollTextIcon,
  HistoryIcon,
  StopCircleIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import {
  Fragment,
  type ReactNode,
  useCallback,
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
  SelectSeparator,
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
type CancelReleaseResult = RouterOutputs["cmdb"]["cancelRelease"];
type ProjectOperationAction =
  | "dockerStatus"
  | "dockerLogs"
  | "containerMonitor"
  | "sshInfo";
type AssetServiceRow = {
  project: ProjectRow;
  latestRelease: ProjectRow["latestRelease"];
  targetAssetName: string;
};
type TopicReleaseGroup = {
  topic: string;
  releases: ReleaseRow[];
  latestRelease: ReleaseRow;
  releaseTotal: number;
  projectTotal: number;
  projectIds: number[];
  successTotal: number;
  runningTotal: number;
  failedTotal: number;
  canceledTotal: number;
  refs: string[];
  deployEnvs: string[];
  projectLabels: string[];
};
type TopicReleaseProjectSummary = {
  key: string;
  projectId: number;
  projectName: string;
  gitlabPath: string;
  latestRelease: ReleaseRow;
  releases: ReleaseRow[];
  releaseTotal: number;
  successTotal: number;
  runningTotal: number;
  failedTotal: number;
  canceledTotal: number;
  refs: string[];
  deployEnvs: string[];
};
type DockerStatusPort = {
  containerPort: string;
  protocol: string | null;
  hostIp: string | null;
  hostPort: string | null;
  label: string;
};
type DockerStatusResult = {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  health: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  restartCount: number;
  exitCode: number | null;
  ports: DockerStatusPort[];
};
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
type TerminalDimensions = {
  cols: number;
  rows: number;
};

const UNASSIGNED_VALUE = "__unassigned__";
const UNSET_ARCH_VALUE = "__unset_arch__";
const CUSTOM_ARCH_VALUE = "__custom_arch__";
const CUSTOM_BRANCH_VALUE = "__custom_branch__";
const STICKY_ACTION_HEAD_CLASS =
  "sticky right-0 z-20 border-l border-slate-200 bg-slate-50 text-right";
const STICKY_ACTION_CELL_CLASS =
  "sticky right-0 z-10 border-l border-slate-200 bg-white group-hover:bg-muted/50";
const CMDB_ACTION_GROUP_CLASS =
  "inline-flex shrink-0 overflow-hidden rounded-[9px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const CMDB_ACTION_ICON_CLASS =
  "size-8 rounded-none border-0 border-r border-slate-200 bg-transparent text-slate-700 shadow-none last:border-r-0 hover:bg-slate-50 hover:text-slate-950";
const TERMINAL_OUTPUT_LIMIT = 120_000;
const TERMINAL_INPUT_CHUNK_SIZE = 8_000;
const TERMINAL_INPUT_FLUSH_MS = 16;
const TERMINAL_RESIZE_FLUSH_MS = 120;
const TERMINAL_CONNECTING_MESSAGE = "正在建立 SSH 会话...\r\n";
const TOPIC_RELEASE_PLANS_STORAGE_KEY = "cola.cmdb.topicReleasePlans";
const ANSI_ESCAPE_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
type CmdbAreaKey = "assets" | "projects" | "topicReleases";
type ProjectDraftPanelKey = "basic" | "deploy" | "observe" | "variables";
type ProjectBranchMode = "catalog" | "custom";
type TopicReleaseDialogMode = "createPlan" | "triggerNow";

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
    summary: "构建与部署",
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
  deployTarget: ProjectRow["deployTarget"] | "";
  dockerImage: string;
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
type TopicReleasePlan = {
  id: string;
  topic: string;
  projectIds: number[];
  ref: string;
  deployEnv: string;
  variablesText: string;
  createdAt: string;
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
    deployTarget: "",
    dockerImage: "",
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

function parseStoredTopicReleasePlans(raw: string | null) {
  if (!raw) return [];

  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];

    return value.flatMap((item): TopicReleasePlan[] => {
      if (!isRecord(item)) return [];
      if (
        typeof item.id !== "string" ||
        typeof item.topic !== "string" ||
        !Array.isArray(item.projectIds) ||
        typeof item.ref !== "string" ||
        typeof item.deployEnv !== "string" ||
        typeof item.variablesText !== "string" ||
        typeof item.createdAt !== "string"
      ) {
        return [];
      }

      const projectIds = item.projectIds.filter(
        (projectId): projectId is number =>
          typeof projectId === "number" && Number.isInteger(projectId),
      );
      if (projectIds.length === 0) return [];

      return [
        {
          id: item.id,
          topic: item.topic,
          projectIds,
          ref: item.ref,
          deployEnv: item.deployEnv,
          variablesText: item.variablesText,
          createdAt: item.createdAt,
        },
      ];
    });
  } catch {
    return [];
  }
}

function loadStoredTopicReleasePlans() {
  if (typeof window === "undefined") return [];
  return parseStoredTopicReleasePlans(
    window.localStorage.getItem(TOPIC_RELEASE_PLANS_STORAGE_KEY),
  );
}

function topicReleasePlanTitle(draft: TopicReleaseDraft) {
  const topic = draft.topic.trim();
  if (topic.length > 0) return topic;

  return `主题发布 ${formatTime(new Date())}`;
}

function mergeReleaseVariables(draft: ReleaseDraft) {
  const variables = parseVariables(draft.variablesText);
  const dockerImage = draft.dockerImage.trim();

  if (draft.deployTarget === "docker" && dockerImage.length > 0) {
    variables.DOCKER_IMAGE = dockerImage;
  }

  return variables;
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
    deployTarget: project.deployTarget,
    dockerImage: project.config?.dockerImage ?? "",
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
      return "SSH 正常";
    case "planned":
      return "待检测";
    default:
      return "SSH 异常";
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

function monitorSummary(project: ProjectRow) {
  const parts = [
    project.monitor.statusCode ? `HTTP ${project.monitor.statusCode}` : null,
    typeof project.monitor.responseTimeMs === "number"
      ? `${project.monitor.responseTimeMs}ms`
      : null,
    project.monitor.errorType,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : project.monitor.message;
}

function monitorCheckedAtLabel(project: ProjectRow) {
  return project.monitor.checkedAt
    ? formatTime(project.monitor.checkedAt)
    : "未执行";
}

function monitorDetailRows(project: ProjectRow) {
  return [
    ["项目", project.name],
    ["状态", monitorLabel(project.monitor.status)],
    ["检查地址", project.monitor.url ?? "未配置"],
    ["检查时间", monitorCheckedAtLabel(project)],
    ["请求方式", project.monitor.method ?? "GET"],
    [
      "超时阈值",
      typeof project.monitor.timeoutMs === "number"
        ? `${project.monitor.timeoutMs}ms`
        : "-",
    ],
    [
      "响应耗时",
      typeof project.monitor.responseTimeMs === "number"
        ? `${project.monitor.responseTimeMs}ms`
        : "-",
    ],
    [
      "HTTP 状态",
      project.monitor.statusCode ? String(project.monitor.statusCode) : "-",
    ],
    ["Content-Type", project.monitor.contentType ?? "-"],
    ["错误类型", project.monitor.errorType ?? "-"],
    ["错误详情", project.monitor.errorDetail ?? project.monitor.message],
  ];
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

function releaseOverrideVariables(release: Pick<ReleaseRow, "variables">) {
  return Object.fromEntries(
    Object.entries(release.variables ?? {}).filter(([key]) => {
      if (key === "CMDB_RELEASE_TOPIC") return false;
      if (key.startsWith("CMDB_")) return false;
      if (key.startsWith("DEPLOY_")) return false;
      if (key.startsWith("K8S_")) return false;
      if (key === "DOCKER_IMAGE") return false;
      return true;
    }),
  );
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

function buildTopicReleaseGroups(releases: ReleaseRow[]) {
  const grouped = new Map<string, ReleaseRow[]>();

  for (const release of releases) {
    const topic = releaseTopic(release);
    if (!topic) continue;

    const current = grouped.get(topic);
    if (current) {
      current.push(release);
    } else {
      grouped.set(topic, [release]);
    }
  }

  return Array.from(grouped.entries())
    .map(([topic, topicReleases]): TopicReleaseGroup => {
      const sortedReleases = [...topicReleases].sort(
        (first, second) =>
          new Date(second.createdAt).getTime() -
          new Date(first.createdAt).getTime(),
      );
      const latestRelease = sortedReleases[0]!;
      const projectLabels = Array.from(
        new Set(
          sortedReleases.map(
            (release) =>
              release.project?.name ??
              release.project?.gitlabPath ??
              `项目 ${release.projectId}`,
          ),
        ),
      );
      const projectIds = Array.from(
        new Set(sortedReleases.map((release) => release.projectId)),
      );

      return {
        topic,
        releases: sortedReleases,
        latestRelease,
        releaseTotal: sortedReleases.length,
        projectTotal: projectLabels.length,
        projectIds,
        successTotal: sortedReleases.filter(
          (release) => release.status === "success",
        ).length,
        runningTotal: sortedReleases.filter(
          (release) =>
            release.status === "pending" || release.status === "running",
        ).length,
        failedTotal: sortedReleases.filter(
          (release) => release.status === "failed",
        ).length,
        canceledTotal: sortedReleases.filter(
          (release) => release.status === "canceled",
        ).length,
        refs: Array.from(new Set(sortedReleases.map((release) => release.ref))),
        deployEnvs: Array.from(
          new Set(sortedReleases.map((release) => release.deployEnv ?? "-")),
        ),
        projectLabels,
      };
    })
    .sort(
      (first, second) =>
        new Date(second.latestRelease.createdAt).getTime() -
        new Date(first.latestRelease.createdAt).getTime(),
    );
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

function projectDeployConfigLabel(project: ProjectRow) {
  switch (project.deployTarget) {
    case "k8s":
      return `${project.config?.k8sNamespace ?? "default"} / ${
        project.config?.k8sDeployment ?? "-"
      }`;
    case "docker":
      return project.config?.dockerImage ?? "由 GitLab 构建产出";
    case "ssh":
      return project.config?.sshPath ?? "-";
    default:
      return "-";
  }
}

function deployTargetRequiresAsset(deployTarget: ProjectRow["deployTarget"]) {
  return deployTarget === "docker" || deployTarget === "ssh";
}

function projectReleaseIssue(
  project: ProjectRow,
  canTriggerPipelines: boolean,
) {
  if (!canTriggerPipelines) {
    return "GitLab 未配置，无法触发构建流水线。";
  }

  if (!deployTargetRequiresAsset(project.deployTarget)) return null;

  if (projectTargetAssetNames(project.config).length === 0) {
    return `${deployTargetLabel(project.deployTarget)} 发布需要至少选择一台目标资产。`;
  }

  return null;
}

function topicReleaseProjectIssue(
  project: ProjectRow,
  canTriggerPipelines: boolean,
) {
  const baseIssue = projectReleaseIssue(project, canTriggerPipelines);
  if (baseIssue) return baseIssue;

  return null;
}

function projectOperationIssue(
  project: ProjectRow,
  action: ProjectOperationAction,
) {
  if (projectTargetAssetNames(project.config).length === 0) {
    return "项目未配置目标资产。";
  }

  if (action !== "sshInfo" && project.deployTarget !== "docker") {
    return "当前仅 Docker 部署项目支持查看容器状态、日志和监控。";
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
    return "当前仅 Docker 部署项目支持查看容器状态、日志和监控。";
  }

  return null;
}

function releaseCancelIssue(release: ReleaseRow, canCancelReleases: boolean) {
  if (!canCancelReleases) {
    return "GitLab API Token 未配置，无法停止 Pipeline。";
  }

  if (!release.project) {
    return "发布记录缺少项目信息。";
  }

  if (release.status !== "pending" && release.status !== "running") {
    return "只有排队中或运行中的发布可以停止。";
  }

  if (!release.gitlabPipelineId) {
    return "发布记录缺少 GitLab Pipeline ID。";
  }

  return null;
}

function mergeCanceledRelease(
  summary: TopicReleaseProjectSummary,
  updatedRelease: CancelReleaseResult,
) {
  let previousStatus: ReleaseRow["status"] | null = null;
  let didUpdate = false;
  const releases = summary.releases.map((release) => {
    if (release.id !== updatedRelease.id) return release;

    didUpdate = true;
    previousStatus = release.status;
    return {
      ...release,
      status: updatedRelease.status,
      gitlabStatus: updatedRelease.gitlabStatus,
      gitlabPipelineUrl: updatedRelease.gitlabPipelineUrl,
      completedAt: updatedRelease.completedAt,
      lastError: updatedRelease.lastError,
    };
  });

  if (!didUpdate) return summary;

  const countDelta = (status: ReleaseRow["status"]) =>
    (updatedRelease.status === status ? 1 : 0) -
    (previousStatus === status ? 1 : 0);
  const activeDelta =
    (updatedRelease.status === "pending" || updatedRelease.status === "running"
      ? 1
      : 0) -
    (previousStatus === "pending" || previousStatus === "running" ? 1 : 0);

  return {
    ...summary,
    latestRelease:
      summary.latestRelease.id === updatedRelease.id
        ? releases.find((release) => release.id === updatedRelease.id) ??
          summary.latestRelease
        : summary.latestRelease,
    releases,
    successTotal: Math.max(0, summary.successTotal + countDelta("success")),
    runningTotal: Math.max(0, summary.runningTotal + activeDelta),
    failedTotal: Math.max(0, summary.failedTotal + countDelta("failed")),
    canceledTotal: Math.max(0, summary.canceledTotal + countDelta("canceled")),
  };
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
    case "containerMonitor":
      return "容器监控";
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
      return "查看目标容器的运行状态、镜像、端口和启动信息。";
    case "dockerLogs":
      return "读取目标容器最近运行日志。";
    case "containerMonitor":
      return "打开项目监控面板，并展示目标容器暴露端口的候选入口。";
    case "sshInfo":
      return deployTarget === "docker"
        ? "自动登录目标资产并执行 docker exec，打开容器内终端。"
        : "自动登录目标资产，打开远程终端。";
  }
}

function remoteLoginLabel(deployTarget?: ProjectRow["deployTarget"]) {
  return deployTarget === "docker" ? "容器登录" : "远程登录";
}

function dockerStatusFromResult(result: ProjectOperationResult | null) {
  if (!result || !("dockerStatus" in result) || !result.dockerStatus) {
    return null;
  }

  return result.dockerStatus as DockerStatusResult;
}

function operationMonitorUrl(result: ProjectOperationResult | null) {
  if (!result || !("monitorUrl" in result)) return null;
  return typeof result.monitorUrl === "string" &&
    result.monitorUrl.trim().length > 0
    ? result.monitorUrl.trim()
    : null;
}

function externalUrlHref(value: string) {
  const normalized = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) return normalized;
  return `http://${normalized}`;
}

function hostForUrl(host: string) {
  const normalized = host.trim();
  return normalized.includes(":") && !normalized.startsWith("[")
    ? `[${normalized}]`
    : normalized;
}

function portHostForMonitorUrl(port: DockerStatusPort, fallbackHost: string) {
  const hostIp = port.hostIp?.trim();
  if (!hostIp || hostIp === "0.0.0.0" || hostIp === "::" || hostIp === "[::]") {
    return fallbackHost;
  }

  if (hostIp === "127.0.0.1" || hostIp === "::1" || hostIp === "[::1]") {
    return fallbackHost;
  }

  return hostIp;
}

type ContainerMonitorLink = {
  key: string;
  label: string;
  url: string;
  description: string;
  source: "configured" | "port";
};

function containerMonitorLinks(
  project: ProjectRow | null,
  result: ProjectOperationResult | null,
  status: DockerStatusResult | null,
) {
  const links: ContainerMonitorLink[] = [];
  const seenUrls = new Set<string>();
  const configuredUrl =
    operationMonitorUrl(result) ?? project?.config?.monitorUrl?.trim() ?? null;

  if (configuredUrl) {
    const url = externalUrlHref(configuredUrl);
    seenUrls.add(url);
    links.push({
      key: "configured",
      label: "监控面板",
      url,
      description: "来自项目观测配置的监控面板 URL。",
      source: "configured",
    });
  }

  const host = result?.host?.trim();
  if (host && status) {
    for (const port of status.ports) {
      if (!port.hostPort) continue;
      if (port.protocol && port.protocol !== "tcp") continue;

      const targetHost = portHostForMonitorUrl(port, host);
      const url = `http://${hostForUrl(targetHost)}:${port.hostPort}`;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      links.push({
        key: `port-${port.hostPort}-${port.containerPort}-${port.protocol ?? "tcp"}`,
        label: `端口 ${port.hostPort}`,
        url,
        description: port.label,
        source: "port",
      });
    }
  }

  return links;
}

function containerMonitorCopyText(
  project: ProjectRow | null,
  result: ProjectOperationResult | null,
  status: DockerStatusResult | null,
) {
  const links = containerMonitorLinks(project, result, status);
  const lines = [
    `项目: ${result?.projectName ?? project?.name ?? "-"}`,
    `目标资产: ${
      result?.targetAssetName ??
      (project ? projectTargetAssetsLabel(project.config) : "-")
    }`,
    `主机: ${result?.host ?? "-"}`,
    `容器: ${status?.name ?? result?.containerName ?? project?.name ?? "-"}`,
    `状态: ${status ? dockerStatusLabel(status) : "-"}`,
    "监控入口:",
    ...(links.length > 0
      ? links.map((link) => `- ${link.label}: ${link.url}`)
      : ["- 未配置监控面板，且未发现可用宿主端口。"]),
  ];

  return lines.join("\n");
}

function dockerStateLabel(status: DockerStatusResult) {
  switch (status.state) {
    case "running":
      return "运行中";
    case "created":
      return "已创建";
    case "restarting":
      return "重启中";
    case "paused":
      return "已暂停";
    case "exited":
      return "已停止";
    case "dead":
      return "异常";
    default:
      return status.state.length > 0 ? status.state : "未知";
  }
}

function dockerHealthLabel(health: string | null) {
  switch (health) {
    case "healthy":
      return "健康";
    case "unhealthy":
      return "异常";
    case "starting":
      return "启动中";
    default:
      return null;
  }
}

function dockerStatusLabel(status: DockerStatusResult) {
  const parts = [dockerStateLabel(status), dockerHealthLabel(status.health)];
  return parts.filter(Boolean).join(" · ");
}

function dockerStatusIsFailed(status: DockerStatusResult) {
  return (
    status.state === "dead" ||
    status.state === "exited" ||
    status.health === "unhealthy" ||
    (!status.running && status.state !== "created")
  );
}

function dockerStatusTone(status: DockerStatusResult) {
  if (dockerStatusIsFailed(status)) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (status.state === "restarting" || status.health === "starting") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (status.running) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
}

function dockerRuntimeLabel(value: string | null) {
  if (!value) return "-";

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "-";

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes % 60} 分钟`;
  if (minutes > 0) return `${minutes} 分钟`;
  return "刚刚";
}

function dockerStatusCopyText(
  result: ProjectOperationResult,
  status: DockerStatusResult,
) {
  return [
    `项目: ${result.projectName}`,
    `目标资产: ${result.targetAssetName}`,
    `主机: ${result.host}`,
    `容器: ${status.name}`,
    `状态: ${dockerStatusLabel(status)}`,
    `镜像: ${status.image.length > 0 ? status.image : "-"}`,
    `端口: ${status.ports.length ? status.ports.map((port) => port.label).join(", ") : "未暴露"}`,
    `启动时间: ${status.startedAt ? formatTime(status.startedAt) : "-"}`,
    `运行时长: ${status.running ? dockerRuntimeLabel(status.startedAt) : "-"}`,
    `重启次数: ${status.restartCount}`,
    `退出码: ${status.running ? "-" : (status.exitCode ?? "-")}`,
    `查询耗时: ${result.durationMs}ms`,
  ].join("\n");
}

function operationResultText(result: ProjectOperationResult | null) {
  if (!result) return "";
  const dockerStatus = dockerStatusFromResult(result);

  if (dockerStatus) {
    const parts = [
      dockerStatusCopyText(result, dockerStatus),
      result.stderr.trim() ? `错误输出:\n${result.stderr.trim()}` : "",
    ].filter(Boolean);

    return parts.join("\n\n");
  }

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
          <p className="text-[1.18rem] leading-none font-semibold tracking-normal text-slate-950">
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
    <section className="rounded-[var(--radius-card)] border border-rose-200/90 bg-rose-50/70 px-5 py-4 text-rose-950">
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
    <section className="grid gap-4 rounded-[var(--radius-card)] border border-slate-200/90 bg-white/88 px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.04)] md:px-6">
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-normal text-slate-950">
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
            className="rounded-[var(--radius-card)] border border-slate-200/90 bg-slate-50 px-4 py-4"
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

function DockerStatusMetric(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[10px] border border-slate-200/90 bg-slate-50 px-3 py-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        {props.label}
      </p>
      <div className="mt-1.5 min-w-0 text-sm leading-5 font-medium break-words text-slate-950">
        {props.value}
      </div>
      {props.hint ? (
        <div className="mt-1 text-xs leading-5 break-words text-slate-500">
          {props.hint}
        </div>
      ) : null}
    </div>
  );
}

function DockerStatusPanel({
  result,
  status,
}: {
  result: ProjectOperationResult;
  status: DockerStatusResult;
}) {
  const failed = dockerStatusIsFailed(status);
  const statusLabel = dockerStatusLabel(status);
  const startedLabel = status.startedAt ? formatTime(status.startedAt) : "-";
  const finishedLabel = status.finishedAt ? formatTime(status.finishedAt) : "-";
  const runtimeLabel = status.running
    ? dockerRuntimeLabel(status.startedAt)
    : finishedLabel !== "-"
      ? `停止于 ${finishedLabel}`
      : "-";
  const exitCodeLabel = status.running ? "-" : (status.exitCode ?? "-");
  const containerId = status.id ? status.id.slice(0, 12) : "-";

  return (
    <div className="grid gap-3">
      <section className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.055)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[12px] ring-1",
                failed
                  ? "bg-rose-50 text-rose-700 ring-rose-100"
                  : status.running
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                    : "bg-slate-100 text-slate-600 ring-slate-200",
              )}
            >
              <ActivityIcon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-base leading-6 font-semibold break-words text-slate-950">
                {status.name}
              </p>
              <p className="mt-1 text-sm leading-5 break-all text-slate-600">
                {status.image || "未读取到镜像信息"}
              </p>
            </div>
          </div>
          <Badge
            className={cn("w-fit shrink-0 border", dockerStatusTone(status))}
          >
            {statusLabel}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DockerStatusMetric label="运行时长" value={runtimeLabel} />
          <DockerStatusMetric label="启动时间" value={startedLabel} />
          <DockerStatusMetric label="重启次数" value={status.restartCount} />
          <DockerStatusMetric label="退出码" value={exitCodeLabel} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">端口暴露</h3>
            <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
              {status.ports.length} 条
            </Badge>
          </div>
          {status.ports.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {status.ports.map((port, index) => (
                <span
                  key={`${port.label}-${index}`}
                  className="max-w-full rounded-[8px] border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs leading-5 break-all text-slate-700"
                >
                  {port.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-500">
              当前容器未暴露端口。
            </p>
          )}
        </div>

        <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-950">查询信息</h3>
          <div className="mt-3 grid gap-2 text-sm leading-6">
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-slate-500">容器 ID</span>
              <span className="min-w-0 font-medium break-all text-slate-900">
                {containerId}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-slate-500">查询耗时</span>
              <span className="font-medium text-slate-900">
                {result.durationMs}ms
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="shrink-0 text-slate-500">创建时间</span>
              <span className="min-w-0 text-right font-medium text-slate-900">
                {status.createdAt ? formatTime(status.createdAt) : "-"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ContainerMonitorPanel({
  project,
  result,
  status,
}: {
  project: ProjectRow | null;
  result: ProjectOperationResult;
  status: DockerStatusResult | null;
}) {
  const links = containerMonitorLinks(project, result, status);
  const configuredLink = links.find((link) => link.source === "configured");
  const portLinks = links.filter((link) => link.source === "port");
  const statusLabel = status ? dockerStatusLabel(status) : "状态不可用";
  const failed = status ? dockerStatusIsFailed(status) : result.code !== 0;

  return (
    <div className="grid gap-3">
      <section className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-4 shadow-[0_14px_36px_rgba(15,23,42,0.055)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[12px] ring-1",
                failed
                  ? "bg-amber-50 text-amber-700 ring-amber-100"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-100",
              )}
            >
              <MonitorCogIcon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-base leading-6 font-semibold break-words text-slate-950">
                {project?.name ?? result.projectName}
              </p>
              <p className="mt-1 text-sm leading-5 break-words text-slate-600">
                {status
                  ? `${status.name} · ${status.image || "未读取到镜像信息"}`
                  : "未能解析目标容器状态。"}
              </p>
            </div>
          </div>
          <Badge
            className={cn(
              "w-fit shrink-0 border",
              status
                ? dockerStatusTone(status)
                : "border-amber-200 bg-amber-50 text-amber-700",
            )}
          >
            {statusLabel}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DockerStatusMetric
            label="目标资产"
            value={result.targetAssetName}
            hint={result.host}
          />
          <DockerStatusMetric
            label="监控面板"
            value={configuredLink ? "已配置" : "未配置"}
            hint={configuredLink?.url ?? "可在项目观测配置中补充 URL"}
          />
          <DockerStatusMetric
            label="端口入口"
            value={`${portLinks.length} 个`}
            hint={
              portLinks.length > 0
                ? portLinks.map((link) => link.label).join(", ")
                : "未发现已绑定宿主端口"
            }
          />
          <DockerStatusMetric label="查询耗时" value={`${result.durationMs}ms`} />
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-950">监控入口</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              优先使用项目配置的监控面板；端口入口根据 Docker 暴露端口生成。
            </p>
          </div>
          {configuredLink ? (
            <a
              href={configuredLink.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "shrink-0 rounded-[10px]",
              )}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              打开监控面板
            </a>
          ) : null}
        </div>

        {links.length > 0 ? (
          <div className="mt-4 grid gap-2">
            {links.map((link) => (
              <a
                key={link.key}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="grid gap-2 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-3 transition-colors hover:border-sky-200 hover:bg-sky-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-950">
                      {link.label}
                    </span>
                    <Badge className="border border-slate-200 bg-white text-slate-600">
                      {link.source === "configured" ? "配置" : "端口"}
                    </Badge>
                  </span>
                  <span className="mt-1 block break-all font-mono text-xs leading-5 text-slate-600">
                    {link.url}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    {link.description}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-sky-700">
                  打开
                  <ExternalLinkIcon className="size-3.5" />
                </span>
              </a>
            ))}
          </div>
        ) : (
          <Alert className="mt-4 border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>未找到监控入口</AlertTitle>
            <AlertDescription>
              当前项目未配置监控面板 URL，目标容器也没有读取到已绑定宿主端口。
            </AlertDescription>
          </Alert>
        )}
      </section>

      {status ? (
        <section className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">容器端口</h3>
            <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
              {status.ports.length} 条
            </Badge>
          </div>
          {status.ports.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {status.ports.map((port, index) => (
                <span
                  key={`${port.label}-${index}`}
                  className="max-w-full rounded-[8px] border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs leading-5 break-all text-slate-700"
                >
                  {port.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-500">
              当前容器未暴露端口。
            </p>
          )}
        </section>
      ) : null}
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
    <div className="grid gap-5 rounded-[var(--radius-card)] border border-dashed border-slate-300/90 bg-slate-50/72 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
      <div className="flex min-w-0 gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-normal text-slate-950">
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

function ProjectReleaseHistory(props: {
  releases: ReleaseRow[];
  showProject?: boolean;
  canCancelReleases: boolean;
  cancelingReleaseId: number | null;
  onCancelRelease: (release: ReleaseRow) => void;
  onOpenOperation: (
    release: ReleaseRow,
    action: ProjectOperationAction,
  ) => void;
}) {
  if (props.releases.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
        {props.showProject
          ? "还没有主题发布记录。"
          : "这个项目还没有发布记录。"}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 xl:hidden">
        {props.releases.map((release) => {
          const topic = releaseTopic(release);

          return (
            <article
              key={`project-release-card-${release.id}`}
              className="rounded-[10px] border border-slate-200/90 bg-white px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge
                      className={cn("border", releaseTone(release.status))}
                    >
                      {releaseLabel(release.status)}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {formatTime(release.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-slate-900">
                    {release.ref}
                    {release.deployEnv ? ` -> ${release.deployEnv}` : ""}
                  </p>
                  {props.showProject ? (
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {release.project?.name ?? "未知项目"}
                      {release.project?.gitlabPath
                        ? ` · ${release.project.gitlabPath}`
                        : ""}
                    </p>
                  ) : null}
                  {topic ? (
                    <Badge className="mt-1.5 border border-sky-200 bg-sky-50 text-sky-700">
                      {topic}
                    </Badge>
                  ) : null}
                </div>
                <TopicReleaseOperationButtons
                  release={release}
                  canCancelReleases={props.canCancelReleases}
                  cancelingReleaseId={props.cancelingReleaseId}
                  onCancelRelease={props.onCancelRelease}
                  onOpenOperation={props.onOpenOperation}
                />
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
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-hidden rounded-[10px] border border-slate-200/90 xl:block">
        <Table
          className={props.showProject ? "min-w-[960px]" : "min-w-[820px]"}
        >
          <TableHeader className="bg-slate-50/90">
            <TableRow className="hover:bg-transparent">
              <TableHead>时间</TableHead>
              {props.showProject ? <TableHead>项目</TableHead> : null}
              <TableHead>主题</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>环境</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>流水线</TableHead>
              <TableHead className={STICKY_ACTION_HEAD_CLASS}>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.releases.map((release) => (
              <TableRow
                key={`project-release-row-${release.id}`}
                className="group"
              >
                <TableCell className="text-sm text-slate-600">
                  {formatTime(release.createdAt)}
                </TableCell>
                {props.showProject ? (
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {release.project?.name ?? "未知项目"}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {release.project?.gitlabPath ?? "-"}
                      </p>
                    </div>
                  </TableCell>
                ) : null}
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
                  <Badge className={cn("border", releaseTone(release.status))}>
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
                    <TopicReleaseOperationButtons
                      release={release}
                      canCancelReleases={props.canCancelReleases}
                      cancelingReleaseId={props.cancelingReleaseId}
                      onCancelRelease={props.onCancelRelease}
                      onOpenOperation={props.onOpenOperation}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TopicReleaseCountPill(props: {
  label: string;
  value: number;
  tone: "success" | "running" | "failed" | "neutral";
}) {
  const toneClass =
    props.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : props.tone === "running"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : props.tone === "failed"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-[9px] border px-2 text-[12px] leading-none font-semibold whitespace-nowrap",
        toneClass,
      )}
    >
      <span>{props.label}</span>
      <span>{props.value}</span>
    </span>
  );
}

function buildTopicReleaseProjectSummaries(releases: ReleaseRow[]) {
  const grouped = new Map<string, ReleaseRow[]>();

  for (const release of releases) {
    const key = String(release.projectId);
    const current = grouped.get(key);
    if (current) {
      current.push(release);
    } else {
      grouped.set(key, [release]);
    }
  }

  return Array.from(grouped.entries())
    .map(([key, projectReleases]): TopicReleaseProjectSummary => {
      const sortedReleases = [...projectReleases].sort(
        (first, second) =>
          new Date(second.createdAt).getTime() -
          new Date(first.createdAt).getTime(),
      );
      const latestRelease = sortedReleases[0]!;
      const projectName =
        latestRelease.project?.name ??
        latestRelease.project?.gitlabPath ??
        `项目 ${latestRelease.projectId}`;

      return {
        key,
        projectId: latestRelease.projectId,
        projectName,
        gitlabPath: latestRelease.project?.gitlabPath ?? "-",
        latestRelease,
        releases: sortedReleases,
        releaseTotal: sortedReleases.length,
        successTotal: sortedReleases.filter(
          (release) => release.status === "success",
        ).length,
        runningTotal: sortedReleases.filter(
          (release) =>
            release.status === "pending" || release.status === "running",
        ).length,
        failedTotal: sortedReleases.filter(
          (release) => release.status === "failed",
        ).length,
        canceledTotal: sortedReleases.filter(
          (release) => release.status === "canceled",
        ).length,
        refs: Array.from(new Set(sortedReleases.map((release) => release.ref))),
        deployEnvs: Array.from(
          new Set(sortedReleases.map((release) => release.deployEnv ?? "-")),
        ),
      };
    })
    .sort((first, second) => {
      const firstRelease = first.releases[0];
      const secondRelease = second.releases[0];

      return (
        new Date(secondRelease?.createdAt ?? 0).getTime() -
        new Date(firstRelease?.createdAt ?? 0).getTime()
      );
    });
}

function topicReleaseGroupState(group: TopicReleaseGroup) {
  if (group.failedTotal > 0) return "failed";
  if (group.runningTotal > 0) return "running";
  if (group.canceledTotal > 0) return "canceled";
  if (group.successTotal > 0) return "success";

  return "neutral";
}

function topicReleaseGroupStateLabel(
  state: ReturnType<typeof topicReleaseGroupState>,
) {
  switch (state) {
    case "failed":
      return "有失败";
    case "running":
      return "进行中";
    case "canceled":
      return "有取消";
    case "success":
      return "已完成";
    default:
      return "待确认";
  }
}

function topicReleaseGroupStateTone(
  state: ReturnType<typeof topicReleaseGroupState>,
) {
  switch (state) {
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "canceled":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function TopicReleaseInfoLine(props: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", props.className)}>
      <p className="text-[11px] leading-4 font-medium text-slate-500">
        {props.label}
      </p>
      <div className="mt-1 min-w-0 text-sm leading-5 text-slate-900">
        {props.children}
      </div>
    </div>
  );
}

function TopicReleaseValueChips(props: { values: string[] }) {
  const visibleValues = props.values.slice(0, 4);
  const hiddenTotal = props.values.length - visibleValues.length;

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {visibleValues.map((value) => (
        <span
          key={value}
          className="max-w-full truncate rounded-[8px] border border-slate-200 bg-white px-2 py-0.5 text-[12px] leading-5 text-slate-700"
          title={value}
        >
          {value}
        </span>
      ))}
      {hiddenTotal > 0 ? (
        <span className="rounded-[8px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-[12px] leading-5 text-slate-500">
          +{hiddenTotal}
        </span>
      ) : null}
    </div>
  );
}

function TopicReleaseActionButtons(props: {
  triggering: boolean;
  onTrigger: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] lg:grid-cols-1">
      <Button
        size="sm"
        className="h-8 rounded-[9px] px-2.5 text-[12px]"
        onClick={props.onTrigger}
        disabled={props.triggering}
      >
        {props.triggering ? (
          <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
        ) : (
          <RocketIcon data-icon="inline-start" />
        )}
        一键发布
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 rounded-[9px] border-sky-200 bg-white px-2.5 text-[12px] text-sky-700 hover:bg-sky-50 hover:text-sky-800"
        onClick={props.onRetry}
        disabled={props.triggering}
      >
        <CheckCircle2Icon data-icon="inline-start" />
        指定项目
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        className="size-8 rounded-[9px] border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:w-auto sm:px-2.5 lg:w-full"
        onClick={props.onDelete}
        title="删除主题发布记录"
      >
        <Trash2Icon />
        <span className="sr-only sm:not-sr-only lg:not-sr-only">删除</span>
      </Button>
    </div>
  );
}

function TopicReleaseOperationButtons(props: {
  release: ReleaseRow;
  canCancelReleases: boolean;
  cancelingReleaseId: number | null;
  onCancelRelease: (release: ReleaseRow) => void;
  onOpenOperation: (
    release: ReleaseRow,
    action: ProjectOperationAction,
  ) => void;
}) {
  const cancelIssue = releaseCancelIssue(
    props.release,
    props.canCancelReleases,
  );
  const isCanceling = props.cancelingReleaseId === props.release.id;

  return (
    <div className={CMDB_ACTION_GROUP_CLASS}>
      <Button
        variant="ghost"
        size="icon-sm"
        className={CMDB_ACTION_ICON_CLASS}
        onClick={() => props.onOpenOperation(props.release, "dockerStatus")}
        disabled={Boolean(releaseOperationIssue(props.release, "dockerStatus"))}
        title={
          releaseOperationIssue(props.release, "dockerStatus") ?? "容器状态"
        }
      >
        <ActivityIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={CMDB_ACTION_ICON_CLASS}
        onClick={() =>
          props.onOpenOperation(props.release, "containerMonitor")
        }
        disabled={Boolean(
          releaseOperationIssue(props.release, "containerMonitor"),
        )}
        title={
          releaseOperationIssue(props.release, "containerMonitor") ??
          "容器监控"
        }
      >
        <MonitorCogIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={CMDB_ACTION_ICON_CLASS}
        onClick={() => props.onOpenOperation(props.release, "dockerLogs")}
        disabled={Boolean(releaseOperationIssue(props.release, "dockerLogs"))}
        title={releaseOperationIssue(props.release, "dockerLogs") ?? "运行日志"}
      >
        <ScrollTextIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={CMDB_ACTION_ICON_CLASS}
        onClick={() => props.onOpenOperation(props.release, "sshInfo")}
        disabled={Boolean(releaseOperationIssue(props.release, "sshInfo"))}
        title={
          releaseOperationIssue(props.release, "sshInfo") ??
          remoteLoginLabel(props.release.project?.deployTarget)
        }
      >
        <TerminalIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={cn(
          CMDB_ACTION_ICON_CLASS,
          "text-rose-600 hover:text-rose-700 disabled:text-slate-300",
        )}
        onClick={() => props.onCancelRelease(props.release)}
        disabled={Boolean(cancelIssue) || isCanceling}
        title={cancelIssue ?? "停止发布"}
      >
        {isCanceling ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <StopCircleIcon />
        )}
      </Button>
    </div>
  );
}

function TopicReleaseReleaseRow(props: {
  release: ReleaseRow;
  canCancelReleases: boolean;
  cancelingReleaseId: number | null;
  onCancelRelease: (release: ReleaseRow) => void;
  onOpenOperation: (
    release: ReleaseRow,
    action: ProjectOperationAction,
  ) => void;
}) {
  const projectName = props.release.project?.name ?? "未知项目";
  const gitlabPath = props.release.project?.gitlabPath ?? "-";

  return (
    <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(180px,1.05fr)_minmax(150px,0.75fr)_minmax(190px,0.85fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className={cn("border", releaseTone(props.release.status))}>
            {releaseLabel(props.release.status)}
          </Badge>
          <span className="text-xs leading-5 text-slate-500">
            {formatTime(props.release.createdAt)}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-950">
          {projectName}
        </p>
        <p className="mt-0.5 truncate text-xs leading-5 text-slate-500">
          {gitlabPath}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1">
        <TopicReleaseInfoLine label="Ref">
          <span className="block truncate">{props.release.ref}</span>
        </TopicReleaseInfoLine>
        <TopicReleaseInfoLine label="环境">
          <span className="block truncate">
            {props.release.deployEnv ?? "-"}
          </span>
        </TopicReleaseInfoLine>
      </div>

      <div className="min-w-0">
        {props.release.gitlabPipelineUrl ? (
          <a
            href={props.release.gitlabPipelineUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-8 max-w-full rounded-[9px] bg-white",
            )}
          >
            <span className="truncate">
              Pipeline #{props.release.gitlabPipelineId ?? props.release.id}
            </span>
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        ) : (
          <p className="text-sm leading-5 text-slate-500">
            {props.release.lastError ?? "尚未返回流水线链接"}
          </p>
        )}
      </div>

      <div className="flex justify-start lg:justify-end">
        <TopicReleaseOperationButtons
          release={props.release}
          canCancelReleases={props.canCancelReleases}
          cancelingReleaseId={props.cancelingReleaseId}
          onCancelRelease={props.onCancelRelease}
          onOpenOperation={props.onOpenOperation}
        />
      </div>
    </div>
  );
}

function TopicReleaseProjectRow(props: {
  summary: TopicReleaseProjectSummary;
  canCancelReleases: boolean;
  cancelingReleaseId: number | null;
  onCancelRelease: (release: ReleaseRow) => void;
  onOpenOperation: (
    release: ReleaseRow,
    action: ProjectOperationAction,
  ) => void;
  onOpenHistory: (summary: TopicReleaseProjectSummary) => void;
}) {
  const latestRelease = props.summary.latestRelease;

  return (
    <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(200px,1.05fr)_minmax(180px,0.76fr)_minmax(180px,0.8fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge className={cn("border", releaseTone(latestRelease.status))}>
            {releaseLabel(latestRelease.status)}
          </Badge>
          <span className="text-xs leading-5 text-slate-500">
            最近 {formatTime(latestRelease.createdAt)}
          </span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-950">
          {props.summary.projectName}
        </p>
        <p className="mt-0.5 truncate text-xs leading-5 text-slate-500">
          {props.summary.gitlabPath}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1">
        <TopicReleaseInfoLine label="Ref">
          <TopicReleaseValueChips values={props.summary.refs} />
        </TopicReleaseInfoLine>
        <TopicReleaseInfoLine label="环境">
          <TopicReleaseValueChips values={props.summary.deployEnvs} />
        </TopicReleaseInfoLine>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <TopicReleaseCountPill
            label="成功"
            value={props.summary.successTotal}
            tone="success"
          />
          <TopicReleaseCountPill
            label="进行中"
            value={props.summary.runningTotal}
            tone="running"
          />
          <TopicReleaseCountPill
            label="失败"
            value={props.summary.failedTotal}
            tone="failed"
          />
          {props.summary.canceledTotal > 0 ? (
            <TopicReleaseCountPill
              label="取消"
              value={props.summary.canceledTotal}
              tone="neutral"
            />
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          共 {props.summary.releaseTotal} 条部署记录
        </p>
      </div>

      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-[9px] bg-white px-2.5 text-[12px]"
          onClick={() => props.onOpenHistory(props.summary)}
        >
          <HistoryIcon data-icon="inline-start" />
          部署记录
        </Button>
        <TopicReleaseOperationButtons
          release={latestRelease}
          canCancelReleases={props.canCancelReleases}
          cancelingReleaseId={props.cancelingReleaseId}
          onCancelRelease={props.onCancelRelease}
          onOpenOperation={props.onOpenOperation}
        />
      </div>
    </div>
  );
}

function TopicReleaseList(props: {
  groups: TopicReleaseGroup[];
  plans: TopicReleasePlan[];
  projects: ProjectRow[];
  triggeringPlanId: string | null;
  triggeringTopicRelease: boolean;
  canCancelReleases: boolean;
  cancelingReleaseId: number | null;
  onCancelRelease: (release: ReleaseRow) => void;
  onOpenOperation: (
    release: ReleaseRow,
    action: ProjectOperationAction,
  ) => void;
  onOpenHistory: (summary: TopicReleaseProjectSummary) => void;
  onCreate: () => void;
  onTriggerPlan: (plan: TopicReleasePlan) => void;
  onTriggerGroup: (group: TopicReleaseGroup) => void;
  onRetryGroup: (group: TopicReleaseGroup) => void;
  onDeletePlan: (plan: TopicReleasePlan) => void;
  onDeleteGroup: (group: TopicReleaseGroup) => void;
}) {
  if (props.groups.length === 0 && props.plans.length === 0) {
    return (
      <CmdbEmptyState
        icon={ListChecksIcon}
        title="还没有主题发布"
        description="新建主题发布后，系统会按主题聚合展示项目发布状态、流水线和运维入口。"
        action={
          <Button className="rounded-[10px]" onClick={props.onCreate}>
            <PlusIcon data-icon="inline-start" />
            新建主题发布
          </Button>
        }
        hints={[
          "点击新建主题发布",
          "填写主题名称并圈选项目",
          "在列表中一键发布并跟踪结果",
        ]}
      />
    );
  }

  const projectById = new Map(
    props.projects.map((project) => [project.id, project]),
  );

  return (
    <div className="grid gap-3">
      {props.plans.map((plan) => {
        const selectedProjects = plan.projectIds.map((projectId) =>
          projectById.get(projectId),
        );
        const projectLabels = selectedProjects.map(
          (project, index) =>
            project?.name ??
            project?.gitlabPath ??
            `项目 ${plan.projectIds[index]}`,
        );
        const isTriggering = props.triggeringPlanId === plan.id;

        return (
          <article
            key={`topic-release-plan-${plan.id}`}
            className="overflow-hidden rounded-[12px] border border-amber-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="grid lg:grid-cols-[290px_minmax(0,1fr)]">
              <div className="border-b border-amber-200/80 bg-amber-50/55 px-4 py-4 lg:border-r lg:border-b-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge className="border border-amber-200 bg-amber-100 text-amber-800">
                    待发布
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {formatTime(plan.createdAt)}
                  </span>
                </div>
                <h3 className="mt-2 truncate text-base font-semibold text-slate-950">
                  {plan.topic}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {plan.projectIds.length} 个项目等待触发。
                </p>
                <Button
                  size="sm"
                  className="mt-4 w-full rounded-[9px]"
                  onClick={() => props.onTriggerPlan(plan)}
                  disabled={isTriggering}
                >
                  {isTriggering ? (
                    <LoaderCircleIcon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <RocketIcon data-icon="inline-start" />
                  )}
                  一键发布
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full rounded-[9px] border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => props.onDeletePlan(plan)}
                  disabled={isTriggering}
                >
                  <Trash2Icon data-icon="inline-start" />
                  删除
                </Button>
              </div>

              <div className="px-4 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <TopicReleaseInfoLine label="Ref">
                    <span className="block truncate">
                      {plan.ref || "各项目默认分支"}
                    </span>
                  </TopicReleaseInfoLine>
                  <TopicReleaseInfoLine label="环境">
                    <span className="block truncate">
                      {plan.deployEnv || "各项目默认环境"}
                    </span>
                  </TopicReleaseInfoLine>
                </div>
                <TopicReleaseInfoLine label="计划项目" className="mt-4">
                  <TopicReleaseValueChips values={projectLabels} />
                </TopicReleaseInfoLine>
              </div>
            </div>
          </article>
        );
      })}

      {props.groups.map((group) => {
        const state = topicReleaseGroupState(group);
        const projectSummaries = buildTopicReleaseProjectSummaries(
          group.releases,
        );

        return (
          <article
            key={`topic-release-group-${group.topic}`}
            className="overflow-hidden rounded-[12px] border border-slate-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="border-b border-slate-200/85 bg-slate-50/70 px-4 py-4 lg:border-r lg:border-b-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge
                    className={cn("border", topicReleaseGroupStateTone(state))}
                  >
                    {topicReleaseGroupStateLabel(state)}
                  </Badge>
                  <span className="text-xs leading-5 text-slate-500">
                    最近 {formatTime(group.latestRelease.createdAt)}
                  </span>
                </div>
                <h3 className="mt-2 truncate text-base font-semibold text-slate-950">
                  {group.topic}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {group.projectTotal} 个项目，{group.releaseTotal} 条发布记录。
                </p>

                <div className="mt-4 grid grid-cols-3 gap-1.5">
                  <TopicReleaseCountPill
                    label="成功"
                    value={group.successTotal}
                    tone="success"
                  />
                  <TopicReleaseCountPill
                    label="进行中"
                    value={group.runningTotal}
                    tone="running"
                  />
                  <TopicReleaseCountPill
                    label="失败"
                    value={group.failedTotal}
                    tone="failed"
                  />
                </div>
                {group.canceledTotal > 0 ? (
                  <div className="mt-1.5">
                    <TopicReleaseCountPill
                      label="取消"
                      value={group.canceledTotal}
                      tone="neutral"
                    />
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3">
                  <TopicReleaseInfoLine label="Ref">
                    <TopicReleaseValueChips values={group.refs} />
                  </TopicReleaseInfoLine>
                  <TopicReleaseInfoLine label="环境">
                    <TopicReleaseValueChips values={group.deployEnvs} />
                  </TopicReleaseInfoLine>
                  <TopicReleaseInfoLine label="项目">
                    <TopicReleaseValueChips values={group.projectLabels} />
                  </TopicReleaseInfoLine>
                </div>

                <div className="mt-4">
                  <TopicReleaseActionButtons
                    triggering={props.triggeringTopicRelease}
                    onTrigger={() => props.onTriggerGroup(group)}
                    onRetry={() => props.onRetryGroup(group)}
                    onDelete={() => props.onDeleteGroup(group)}
                  />
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex flex-col gap-1 border-b border-slate-200/80 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-950">
                      发布项目
                    </p>
                    <p className="text-xs leading-5 text-slate-500">
                      每个项目显示最近状态，部署记录点击弹窗查看。
                    </p>
                  </div>
                  <span className="text-xs leading-5 text-slate-500">
                    {projectSummaries.length} 个项目
                  </span>
                </div>
                <div className="divide-y divide-slate-200/75 bg-white">
                  {projectSummaries.map((summary) => (
                    <TopicReleaseProjectRow
                      key={`topic-release-project-${group.topic}-${summary.key}`}
                      summary={summary}
                      canCancelReleases={props.canCancelReleases}
                      cancelingReleaseId={props.cancelingReleaseId}
                      onCancelRelease={props.onCancelRelease}
                      onOpenOperation={props.onOpenOperation}
                      onOpenHistory={props.onOpenHistory}
                    />
                  ))}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AssetServiceList(props: {
  assetName: string;
  services: AssetServiceRow[];
  onOpenOperation: (
    project: ProjectRow,
    action: ProjectOperationAction,
    targetAssetName?: string,
  ) => void;
}) {
  if (props.services.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-500">
        这个服务器还没有挂载服务。
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {props.services.map(({ project, latestRelease, targetAssetName }) => {
        const releaseTopicLabel = latestRelease
          ? releaseTopic(latestRelease)
          : null;

        return (
          <article
            key={`asset-service-${targetAssetName}-${project.id}`}
            className="grid gap-3 rounded-[10px] border border-slate-200/90 bg-white px-3 py-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1fr)_minmax(180px,0.75fr)_auto] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="truncate text-sm font-semibold text-slate-950">
                  {project.name}
                </h4>
                <Badge className="border border-slate-200 bg-white text-slate-700">
                  {deployTargetLabel(project.deployTarget)}
                </Badge>
                {!project.enabled ? (
                  <Badge className="border border-slate-200 bg-slate-100 text-slate-700">
                    已禁用
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {project.gitlabPath}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-slate-500">
                {projectDeployConfigLabel(project)}
              </p>
            </div>

            <div className="min-w-0 rounded-[9px] bg-slate-50/85 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">最近发布</p>
              {latestRelease ? (
                <>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <Badge
                      className={cn(
                        "shrink-0 border",
                        releaseTone(latestRelease.status),
                      )}
                    >
                      {releaseLabel(latestRelease.status)}
                    </Badge>
                    <span className="truncate text-xs text-slate-500">
                      {formatTime(latestRelease.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-700">
                    {latestRelease.ref}
                    {latestRelease.deployEnv
                      ? ` -> ${latestRelease.deployEnv}`
                      : ""}
                    {releaseTopicLabel ? ` · ${releaseTopicLabel}` : ""}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">暂无发布</p>
              )}
            </div>

            <div className="min-w-0 rounded-[9px] border border-slate-200/75 bg-white px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  className={cn(
                    "shrink-0 border",
                    monitorTone(project.monitor.status),
                  )}
                >
                  {monitorLabel(project.monitor.status)}
                </Badge>
                <span className="truncate text-xs font-medium text-slate-600">
                  {monitorSummary(project)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {project.monitor.message}
              </p>
            </div>

            <div className="flex justify-end">
              <div className={CMDB_ACTION_GROUP_CLASS}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={CMDB_ACTION_ICON_CLASS}
                  onClick={() =>
                    props.onOpenOperation(
                      project,
                      "dockerStatus",
                      props.assetName,
                    )
                  }
                  disabled={Boolean(
                    projectOperationIssue(project, "dockerStatus"),
                  )}
                  title={
                    projectOperationIssue(project, "dockerStatus") ?? "容器状态"
                  }
                >
                  <ActivityIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={CMDB_ACTION_ICON_CLASS}
                  onClick={() =>
                    props.onOpenOperation(
                      project,
                      "containerMonitor",
                      props.assetName,
                    )
                  }
                  disabled={Boolean(
                    projectOperationIssue(project, "containerMonitor"),
                  )}
                  title={
                    projectOperationIssue(project, "containerMonitor") ??
                    "容器监控"
                  }
                >
                  <MonitorCogIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={CMDB_ACTION_ICON_CLASS}
                  onClick={() =>
                    props.onOpenOperation(
                      project,
                      "dockerLogs",
                      props.assetName,
                    )
                  }
                  disabled={Boolean(
                    projectOperationIssue(project, "dockerLogs"),
                  )}
                  title={
                    projectOperationIssue(project, "dockerLogs") ?? "运行日志"
                  }
                >
                  <ScrollTextIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={CMDB_ACTION_ICON_CLASS}
                  onClick={() =>
                    props.onOpenOperation(project, "sshInfo", props.assetName)
                  }
                  disabled={Boolean(projectOperationIssue(project, "sshInfo"))}
                  title={
                    projectOperationIssue(project, "sshInfo") ??
                    remoteLoginLabel(project.deployTarget)
                  }
                >
                  <TerminalIcon />
                </Button>
              </div>
            </div>
          </article>
        );
      })}
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [topicReleaseDialogOpen, setTopicReleaseDialogOpen] = useState(false);
  const [operationDialogOpen, setOperationDialogOpen] = useState(false);
  const [monitorDialogOpen, setMonitorDialogOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<CmdbAreaKey>("assets");
  const [projectDraftPanel, setProjectDraftPanel] =
    useState<ProjectDraftPanelKey>("basic");
  const [projectBranchMode, setProjectBranchMode] =
    useState<ProjectBranchMode>("catalog");
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
  const [topicReleaseDialogMode, setTopicReleaseDialogMode] =
    useState<TopicReleaseDialogMode>("createPlan");
  const [topicReleasePlans, setTopicReleasePlans] = useState<
    TopicReleasePlan[]
  >([]);
  const [topicReleasePlansLoaded, setTopicReleasePlansLoaded] = useState(false);
  const [triggeringTopicReleasePlanId, setTriggeringTopicReleasePlanId] =
    useState<string | null>(null);
  const [topicReleaseResult, setTopicReleaseResult] =
    useState<TopicReleaseResult | null>(null);
  const [topicReleaseHistory, setTopicReleaseHistory] =
    useState<TopicReleaseProjectSummary | null>(null);
  const [expandedProjectReleaseIds, setExpandedProjectReleaseIds] = useState<
    number[]
  >([]);
  const [expandedAssetNames, setExpandedAssetNames] = useState<string[]>([]);
  const [operationProject, setOperationProject] = useState<ProjectRow | null>(
    null,
  );
  const [operationSelectedAssetName, setOperationSelectedAssetName] = useState<
    string | null
  >(null);
  const [monitorProject, setMonitorProject] = useState<ProjectRow | null>(null);
  const [operationAction, setOperationAction] =
    useState<ProjectOperationAction>("dockerStatus");
  const [operationResult, setOperationResult] =
    useState<ProjectOperationResult | null>(null);
  const [operationCopied, setOperationCopied] = useState(false);
  const [operationDialogMaximized, setOperationDialogMaximized] =
    useState(false);
  const [terminalSession, setTerminalSession] =
    useState<TerminalSessionInfo | null>(null);
  const [terminalStatusState, setTerminalStatusState] =
    useState<TerminalSessionStatus>("idle");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalHostElement, setTerminalHostElement] =
    useState<HTMLDivElement | null>(null);
  const terminalEventSourceRef = useRef<EventSource | null>(null);
  const terminalSessionIdRef = useRef<string | null>(null);
  const terminalStatusRef = useRef<TerminalSessionStatus>("idle");
  const terminalStartTokenRef = useRef(0);
  const terminalWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalFitAddonRef = useRef<FitAddon | null>(null);
  const terminalInputDisposableRef = useRef<IDisposable | null>(null);
  const terminalResizeDisposableRef = useRef<IDisposable | null>(null);
  const terminalResizeObserverRef = useRef<ResizeObserver | null>(null);
  const terminalPendingOutputRef = useRef("");
  const terminalLastResizeRef = useRef<TerminalDimensions | null>(null);
  const terminalResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const terminalInputBufferRef = useRef("");
  const terminalInputSendingRef = useRef(false);
  const terminalInputFlushTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [gitlabSearch, setGitlabSearch] = useState("");
  const deferredGitlabSearch = useDeferredValue(gitlabSearch.trim());

  const setTerminalHost = useCallback((element: HTMLDivElement | null) => {
    terminalHostRef.current = element;
    setTerminalHostElement(element);
  }, []);

  const dashboardQuery = api.cmdb.dashboard.useQuery(undefined, {
    refetchOnWindowFocus: true,
    retry: 1,
    refetchInterval: (query) => (query.state.error ? false : 15000),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    terminalStatusRef.current = terminalStatusState;
  }, [terminalStatusState]);

  useEffect(() => {
    setTopicReleasePlans(loadStoredTopicReleasePlans());
    setTopicReleasePlansLoaded(true);
  }, []);

  useEffect(() => {
    if (!topicReleasePlansLoaded || typeof window === "undefined") return;
    window.localStorage.setItem(
      TOPIC_RELEASE_PLANS_STORAGE_KEY,
      JSON.stringify(topicReleasePlans),
    );
  }, [topicReleasePlans, topicReleasePlansLoaded]);

  function setTerminalStatus(status: TerminalSessionStatus) {
    terminalStatusRef.current = status;
    setTerminalStatusState(status);
  }

  const gitlabCatalogQuery = api.cmdb.gitlabCatalog.useQuery(
    { query: deferredGitlabSearch || undefined },
    {
      enabled:
        projectDialogOpen &&
        Boolean(dashboardQuery.data?.gitlab.canBrowseCatalog),
      refetchOnWindowFocus: false,
    },
  );
  const gitlabBranchesQuery = api.cmdb.gitlabBranches.useQuery(
    { projectPath: projectDraft.gitlabPath },
    {
      enabled:
        projectDialogOpen &&
        projectDraft.gitlabPath.trim().length > 0 &&
        Boolean(dashboardQuery.data?.gitlab.canBrowseCatalog),
      refetchOnWindowFocus: false,
      retry: 1,
    },
  );

  const saveProject = api.cmdb.saveProject.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.cmdb.dashboard.invalidate(),
        utils.cmdb.gitlabCatalog.invalidate(),
        utils.cmdb.gitlabBranches.invalidate(),
      ]);
      setProjectDialogOpen(false);
      setProjectDraft(emptyProjectDraft());
      setProjectDraftPanel("basic");
      setProjectBranchMode("catalog");
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
    onSuccess: async (result) => {
      await utils.cmdb.dashboard.invalidate();
      const cleanedCount = result.cleanedContainers.length;
      setSuccessMessage(
        cleanedCount > 0
          ? `已清理 ${cleanedCount} 个远程 Docker 容器，并删除 CMDB 项目。`
          : "已删除 CMDB 项目。",
      );
      setErrorMessage(null);
    },
    onError: (error) => {
      setSuccessMessage(null);
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

  const cancelRelease = api.cmdb.cancelRelease.useMutation({
    onSuccess: async (release) => {
      await utils.cmdb.dashboard.invalidate();
      setTopicReleaseHistory((current) =>
        current ? mergeCanceledRelease(current, release) : current,
      );
      setSuccessMessage(
        release.status === "canceled"
          ? "已请求停止发布。"
          : "发布状态已更新。",
      );
      setErrorMessage(null);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setErrorMessage(error.message);
    },
  });

  const triggerTopicRelease = api.cmdb.triggerTopicRelease.useMutation({
    onSuccess: async (result) => {
      await utils.cmdb.dashboard.invalidate();
      setTopicReleaseResult(result);
      setSuccessMessage(
        result.topic
          ? `已触发主题 ${result.topic}，成功创建 ${result.successTotal} / ${result.total} 条发布。`
          : `已触发主题发布，成功创建 ${result.successTotal} / ${result.total} 条发布。`,
      );
      setErrorMessage(null);
    },
    onError: (error) => {
      setSuccessMessage(null);
      setErrorMessage(error.message);
    },
  });

  const deleteTopicReleaseGroup = api.cmdb.deleteTopicReleaseGroup.useMutation({
    onSuccess: async () => {
      await utils.cmdb.dashboard.invalidate();
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
    if (!operationDialogOpen || operationAction !== "sshInfo") return;
    if (!terminalHostElement || terminalRef.current) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorInactiveStyle: "outline",
      cursorStyle: "block",
      disableStdin: terminalStatusRef.current !== "connected",
      fontFamily:
        "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
        cursorAccent: "#020617",
        selectionBackground: "#334155",
        selectionInactiveBackground: "#1e293b",
        black: "#0f172a",
        red: "#fb7185",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#64748b",
        brightRed: "#fda4af",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostElement);
    terminalRef.current = terminal;
    terminalFitAddonRef.current = fitAddon;
    terminalInputDisposableRef.current = terminal.onData(queueTerminalInput);
    terminalResizeDisposableRef.current = terminal.onResize((dimensions) => {
      queueTerminalResize(dimensions);
    });

    const fitTerminal = () => {
      try {
        fitAddon.fit();
        queueTerminalResize({ cols: terminal.cols, rows: terminal.rows });
      } catch {
        // The xterm viewport can briefly have no measurable size during dialog transitions.
      }
    };

    const animationFrame = window.requestAnimationFrame(() => {
      fitTerminal();
      terminal.focus();
      if (terminalPendingOutputRef.current) {
        terminal.write(terminalPendingOutputRef.current);
        terminalPendingOutputRef.current = "";
      }
    });

    terminalResizeObserverRef.current = new ResizeObserver(() => {
      window.requestAnimationFrame(fitTerminal);
    });
    terminalResizeObserverRef.current.observe(terminalHostElement);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      terminalInputDisposableRef.current?.dispose();
      terminalInputDisposableRef.current = null;
      terminalResizeDisposableRef.current?.dispose();
      terminalResizeDisposableRef.current = null;
      terminalResizeObserverRef.current?.disconnect();
      terminalResizeObserverRef.current = null;
      terminalFitAddonRef.current?.dispose();
      terminalFitAddonRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      terminalLastResizeRef.current = null;
    };
  }, [operationAction, operationDialogOpen, terminalHostElement]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.disableStdin = terminalStatusState !== "connected";
    if (terminalStatusState === "connected") {
      terminal.focus();
      terminalLastResizeRef.current = null;
      queueTerminalResize({ cols: terminal.cols, rows: terminal.rows });
    }
  }, [terminalStatusState]);

  useEffect(() => {
    if (operationAction !== "sshInfo" || !operationDialogOpen) return;

    const timer = window.setTimeout(() => {
      try {
        terminalFitAddonRef.current?.fit();
        const terminal = terminalRef.current;
        if (terminal) {
          queueTerminalResize({ cols: terminal.cols, rows: terminal.rows });
          terminal.focus();
        }
      } catch {
        // The dialog can still be animating when maximized/restored.
      }
    }, 60);

    return () => window.clearTimeout(timer);
  }, [operationAction, operationDialogMaximized, operationDialogOpen]);

  useEffect(() => {
    return () => {
      terminalStartTokenRef.current += 1;
      terminalEventSourceRef.current?.close();
      if (terminalInputFlushTimerRef.current) {
        clearTimeout(terminalInputFlushTimerRef.current);
      }
      if (terminalResizeTimerRef.current) {
        clearTimeout(terminalResizeTimerRef.current);
      }
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
  const expandedProjectReleaseIdSet = new Set(expandedProjectReleaseIds);
  const expandedAssetNameSet = new Set(expandedAssetNames);
  const gitlabCatalogItems = gitlabCatalogQuery.data ?? [];
  const visibleGitLabCatalogItems = gitlabCatalogItems.slice(0, 20);
  const gitlabBranchItems = gitlabBranchesQuery.data ?? [];
  const manualGitLabPath = gitlabSearch.trim();
  const canUseManualGitLabPath = isGitLabProjectPath(manualGitLabPath);
  const manualGitLabPathIsSelected =
    manualGitLabPath.length > 0 &&
    projectDraft.gitlabPath.trim() === manualGitLabPath;
  const manualGitLabPathMatchesCatalog = gitlabCatalogItems.some(
    (item) => item.path === manualGitLabPath,
  );
  const operationDockerStatus = dockerStatusFromResult(operationResult);
  const operationText = operationResultText(operationResult);
  const selectedMonitorProject = monitorProject
    ? (projects.find((project) => project.id === monitorProject.id) ??
      monitorProject)
    : null;
  const OperationIcon =
    operationAction === "dockerStatus"
      ? ActivityIcon
      : operationAction === "dockerLogs"
        ? ScrollTextIcon
        : operationAction === "containerMonitor"
          ? MonitorCogIcon
          : TerminalIcon;
  const operationExitCode = operationResult?.code ?? 0;
  const isTerminalOperation = operationAction === "sshInfo";
  const operationPending = isTerminalOperation
    ? terminalStatusState === "connecting"
    : projectOperation.isPending;
  const operationTargetAssetName =
    operationResult?.targetAssetName ??
    terminalSession?.targetAssetName ??
    operationSelectedAssetName ??
    (operationProject
      ? projectTargetAssetsLabel(operationProject.config)
      : "-");
  const operationHost = operationResult?.host ?? terminalSession?.host ?? "-";
  const operationContainerName =
    operationDockerStatus?.name ??
    operationResult?.containerName ??
    terminalSession?.containerName ??
    operationProject?.name ??
    "-";
  const operationStatusText = isTerminalOperation
    ? terminalStatusLabel(terminalStatusState)
    : operationDockerStatus
      ? dockerStatusLabel(operationDockerStatus)
      : operationResult
        ? `${operationResult.durationMs}ms`
        : projectOperation.isPending
          ? "执行中"
          : "-";
  const operationStatusFailed = isTerminalOperation
    ? terminalStatusState === "error"
    : operationDockerStatus
      ? dockerStatusIsFailed(operationDockerStatus) || operationExitCode !== 0
      : operationExitCode !== 0;
  const operationHasStatus = isTerminalOperation
    ? terminalStatusState !== "idle" && terminalStatusState !== "connecting"
    : Boolean(operationResult);
  const operationCopyText = isTerminalOperation
    ? terminalOutput
    : operationAction === "containerMonitor" && operationResult
      ? containerMonitorCopyText(
          operationProject,
          operationResult,
          operationDockerStatus,
        )
      : operationText.length > 0
        ? operationText
        : (operationResult?.sshCommand ?? "");
  const selectedGitLabCandidate =
    gitlabCatalogItems.find((item) => item.path === projectDraft.gitlabPath) ??
    null;
  const branchNames = Array.from(
    new Set([
      ...gitlabBranchItems.map((branch) => branch.name),
      selectedGitLabCandidate?.defaultBranch,
      projectDraft.defaultBranch.trim(),
      "main",
    ]),
  ).filter((branch): branch is string => Boolean(branch));
  const selectedBranchFromList = branchNames.includes(
    projectDraft.defaultBranch.trim(),
  );
  const defaultBranchSelectValue =
    projectBranchMode === "custom" || !selectedBranchFromList
      ? CUSTOM_BRANCH_VALUE
      : projectDraft.defaultBranch.trim();
  const shouldShowCustomBranchInput =
    projectBranchMode === "custom" ||
    defaultBranchSelectValue === CUSTOM_BRANCH_VALUE ||
    gitlabBranchesQuery.isError ||
    (projectDraft.gitlabPath.trim().length > 0 &&
      !dashboardQuery.data?.gitlab.canBrowseCatalog);
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
  const projectSaveDisabled = saveProject.isPending || projectPathMissing;
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
  const canCancelReleases = Boolean(data?.gitlab.hasApiToken);
  const cancelingReleaseId = cancelRelease.isPending
    ? (cancelRelease.variables?.releaseId ?? null)
    : null;
  const topicReleaseSelectedIds = new Set(topicReleaseDraft.projectIds);
  const releasableProjects = projects.filter(
    (project) => !topicReleaseProjectIssue(project, canTriggerPipelines),
  );
  const selectedTopicProjects = projects.filter((project) =>
    topicReleaseSelectedIds.has(project.id),
  );
  const topicReleaseCanSubmit =
    topicReleaseDraft.projectIds.length > 0 && !triggerTopicRelease.isPending;
  const topicReleaseDialogTitle =
    topicReleaseDialogMode === "triggerNow" ? "再次发布主题" : "新建主题发布";
  const topicReleaseDialogDescription =
    topicReleaseDialogMode === "triggerNow"
      ? "选择本次要重新发布的项目，可只发布主题中的部分项目。提交后会立即触发构建流水线。"
      : "圈选多个项目后统一触发构建流水线，并由 CMDB 在构建成功后部署。系统会使用各项目默认分支和默认环境。";
  const topicReleaseSubmitLabel =
    topicReleaseDialogMode === "triggerNow" ? "立即发布" : "新建";
  const topicReleaseRows = releases.filter((release) =>
    Boolean(releaseTopic(release)),
  );
  const topicReleaseGroups = buildTopicReleaseGroups(releases);
  const topicReleaseSuccessTotal = topicReleaseRows.filter(
    (release) => release.status === "success",
  ).length;
  const topicReleaseRunningTotal = topicReleaseRows.filter(
    (release) => release.status === "pending" || release.status === "running",
  ).length;
  const topicReleaseFailedTotal = topicReleaseRows.filter(
    (release) => release.status === "failed",
  ).length;
  const servicesByAssetName = new Map<string, AssetServiceRow[]>();
  for (const project of projects) {
    for (const targetAssetName of projectTargetAssetNames(project.config)) {
      const service = {
        project,
        latestRelease: project.latestRelease,
        targetAssetName,
      };
      const current = servicesByAssetName.get(targetAssetName);

      if (current) {
        current.push(service);
      } else {
        servicesByAssetName.set(targetAssetName, [service]);
      }
    }
  }
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
        : `${connectedAssetTotal} SSH 正常 · ${gpuAssetTotal} GPU`,
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
      description: "维护服务器、角色、SSH 信息和登录检测状态。",
      countLabel: dashboardUnavailable
        ? "无数据"
        : `${data?.overview.assetTotal ?? assets.length} 台资产`,
      icon: ServerIcon,
    },
    {
      key: "projects" as const,
      label: "GitLab 项目管理",
      description: "集中维护仓库、部署目标、健康检查、默认变量和最近发布状态。",
      countLabel: dashboardUnavailable
        ? "无数据"
        : `${data?.overview.projectTotal ?? projects.length} 个项目 · ${
            data?.overview.runningReleaseTotal ?? 0
          } 个进行中`,
      icon: GitBranchIcon,
    },
    {
      key: "topicReleases" as const,
      label: "主题发布",
      description: "按发布主题批量圈选项目、配置变量，并集中跟踪主题发布结果。",
      countLabel: dashboardUnavailable
        ? "无数据"
        : `${topicReleaseGroups.length} 个主题 · ${topicReleaseRows.length} 条记录`,
      icon: ListChecksIcon,
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
    setProjectBranchMode("catalog");
    setGitlabSearch("");
    setProjectDialogOpen(true);
  }

  function openEditDialog(project: ProjectRow) {
    setProjectDraft(projectDraftFromRow(project));
    setProjectDraftPanel("basic");
    setProjectBranchMode("catalog");
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

  function toggleProjectReleaseHistory(projectId: number) {
    setExpandedProjectReleaseIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  function toggleAssetServices(assetName: string) {
    setExpandedAssetNames((current) =>
      current.includes(assetName)
        ? current.filter((name) => name !== assetName)
        : [...current, assetName],
    );
  }

  function closeTerminalSession(options: { reset?: boolean } = {}) {
    terminalStartTokenRef.current += 1;
    terminalEventSourceRef.current?.close();
    terminalEventSourceRef.current = null;
    terminalWriteQueueRef.current = Promise.resolve();
    terminalInputBufferRef.current = "";
    terminalInputSendingRef.current = false;
    if (terminalInputFlushTimerRef.current) {
      clearTimeout(terminalInputFlushTimerRef.current);
      terminalInputFlushTimerRef.current = null;
    }
    if (terminalResizeTimerRef.current) {
      clearTimeout(terminalResizeTimerRef.current);
      terminalResizeTimerRef.current = null;
    }
    terminalLastResizeRef.current = null;

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
      terminalPendingOutputRef.current = "";
      terminalRef.current?.reset();
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
    if (terminalRef.current) {
      terminalRef.current.write(value);
    } else {
      terminalPendingOutputRef.current += value;
    }

    const normalized = normalizeTerminalOutput(value);
    if (!normalized) return;

    setTerminalOutput((current) => {
      const next = `${current}${normalized}`;
      return next.length > TERMINAL_OUTPUT_LIMIT
        ? next.slice(-TERMINAL_OUTPUT_LIMIT)
        : next;
    });
  }

  function resetTerminalOutput(value: string) {
    const terminal = terminalRef.current;
    terminalPendingOutputRef.current = terminal ? "" : value;
    terminal?.reset();
    terminal?.write(value);
    const normalized = normalizeTerminalOutput(value);
    setTerminalOutput(
      normalized.length > TERMINAL_OUTPUT_LIMIT
        ? normalized.slice(-TERMINAL_OUTPUT_LIMIT)
        : normalized,
    );
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
          terminalLastResizeRef.current = null;
        }
        break;
      case "error":
        setTerminalStatus("error");
        setTerminalError(event.message);
        appendTerminalOutput(`\r\n${event.message}\r\n`);
        break;
      case "exit":
        setTerminalStatus("closed");
        appendTerminalOutput(`\r\n${event.message}\r\n`);
        source.close();
        terminalEventSourceRef.current = null;
        terminalLastResizeRef.current = null;
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

  async function startTerminalLogin(
    project: ProjectRow,
    targetAssetName?: string,
  ) {
    closeTerminalSession();
    const token = terminalStartTokenRef.current + 1;
    terminalStartTokenRef.current = token;
    setTerminalSession(null);
    setTerminalStatus("connecting");
    resetTerminalOutput(TERMINAL_CONNECTING_MESSAGE);
    terminalWriteQueueRef.current = Promise.resolve();
    terminalInputBufferRef.current = "";
    terminalInputSendingRef.current = false;
    setTerminalError(null);

    try {
      const response = await fetch("/api/cmdb/terminal-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, targetAssetName }),
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
      appendTerminalOutput(`\r\n${message}\r\n`);
    }
  }

  async function writeTerminalData(data: string) {
    const sessionId = terminalSessionIdRef.current;
    if (!sessionId || terminalStatusRef.current !== "connected") return;

    try {
      for (
        let start = 0;
        start < data.length;
        start += TERMINAL_INPUT_CHUNK_SIZE
      ) {
        if (terminalSessionIdRef.current !== sessionId) return;

        const response = await fetch(
          `/api/cmdb/terminal-session/${sessionId}/input`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              data: data.slice(start, start + TERMINAL_INPUT_CHUNK_SIZE),
            }),
          },
        );

        if (!response.ok) {
          throw new Error(
            await responseErrorMessage(response, "终端输入发送失败。"),
          );
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "终端输入发送失败。";
      setTerminalStatus("error");
      setTerminalError(message);
      appendTerminalOutput(`\r\n${message}\r\n`);
    }
  }

  function flushTerminalInput() {
    if (terminalInputFlushTimerRef.current) {
      clearTimeout(terminalInputFlushTimerRef.current);
      terminalInputFlushTimerRef.current = null;
    }

    const data = terminalInputBufferRef.current;
    if (!data) return;
    if (terminalInputSendingRef.current) return;

    terminalInputBufferRef.current = "";
    terminalInputSendingRef.current = true;

    const write = terminalWriteQueueRef.current
      .then(() => writeTerminalData(data))
      .finally(() => {
        terminalInputSendingRef.current = false;
        if (
          terminalInputBufferRef.current &&
          terminalStatusRef.current === "connected"
        ) {
          terminalInputFlushTimerRef.current = setTimeout(
            flushTerminalInput,
            0,
          );
        }
      });

    terminalWriteQueueRef.current = write.catch(() => undefined);
    void terminalWriteQueueRef.current;
  }

  function queueTerminalInput(data: string) {
    if (!data || terminalStatusRef.current !== "connected") return;

    terminalInputBufferRef.current += data;
    if (terminalInputSendingRef.current || terminalInputFlushTimerRef.current) {
      return;
    }

    terminalInputFlushTimerRef.current = setTimeout(
      flushTerminalInput,
      TERMINAL_INPUT_FLUSH_MS,
    );
  }

  async function resizeTerminalSession(dimensions: TerminalDimensions) {
    const sessionId = terminalSessionIdRef.current;
    if (!sessionId || terminalStatusRef.current !== "connected") return;

    try {
      await fetch(`/api/cmdb/terminal-session/${sessionId}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dimensions),
      });
    } catch {
      // Resizing improves wrapping, but failed resize sync should not break an active shell.
    }
  }

  function queueTerminalResize(dimensions: TerminalDimensions) {
    if (
      !terminalSessionIdRef.current ||
      terminalStatusRef.current !== "connected"
    ) {
      terminalLastResizeRef.current = null;
      return;
    }

    const cols = Math.max(20, Math.min(400, Math.floor(dimensions.cols)));
    const rows = Math.max(5, Math.min(200, Math.floor(dimensions.rows)));
    const next = { cols, rows };
    const previous = terminalLastResizeRef.current;

    if (previous?.cols === next.cols && previous.rows === next.rows) return;
    terminalLastResizeRef.current = next;

    if (terminalResizeTimerRef.current) {
      clearTimeout(terminalResizeTimerRef.current);
    }

    terminalResizeTimerRef.current = setTimeout(() => {
      terminalResizeTimerRef.current = null;
      void resizeTerminalSession(next);
    }, TERMINAL_RESIZE_FLUSH_MS);
  }

  function openProjectOperation(
    project: ProjectRow,
    action: ProjectOperationAction,
    targetAssetName?: string,
  ) {
    const issue = projectOperationIssue(project, action);
    if (issue) {
      setErrorMessage(issue);
      return;
    }

    setOperationProject(project);
    setOperationSelectedAssetName(targetAssetName ?? null);
    setOperationAction(action);
    setOperationResult(null);
    setOperationCopied(false);
    setOperationDialogOpen(true);

    if (action === "sshInfo") {
      projectOperation.reset();
      void startTerminalLogin(project, targetAssetName);
      return;
    }

    closeTerminalSession();
    projectOperation.mutate({
      projectId: project.id,
      action,
      targetAssetName,
      tail: action === "dockerLogs" ? 200 : undefined,
    });
  }

  function openMonitorDialog(project: ProjectRow) {
    setMonitorProject(project);
    setMonitorDialogOpen(true);
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

  function openTopicReleaseHistory(summary: TopicReleaseProjectSummary) {
    setTopicReleaseHistory(summary);
  }

  async function cancelReleaseAction(release: ReleaseRow) {
    const issue = releaseCancelIssue(release, Boolean(data?.gitlab.hasApiToken));
    if (issue) {
      setSuccessMessage(null);
      setErrorMessage(issue);
      return;
    }

    const accepted = await confirm({
      title: "停止发布",
      description: `将请求停止 ${
        release.project?.name ?? "当前项目"
      } 的 GitLab Pipeline #${release.gitlabPipelineId}。如果流水线已经完成并进入 CMDB 部署阶段，系统会拒绝停止。`,
      confirmLabel: "停止",
      confirmVariant: "destructive",
    });

    if (!accepted) return;

    cancelRelease.mutate({ releaseId: release.id });
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

  function openTopicReleaseDialog(
    initialProjectIds: number[] = [],
    mode: TopicReleaseDialogMode = "createPlan",
    initialDraft?: Partial<TopicReleaseDraft>,
  ) {
    setTopicReleaseDialogMode(mode);
    setTopicReleaseDraft({
      ...emptyTopicReleaseDraft(),
      ...initialDraft,
      projectIds: initialProjectIds,
    });
    setTopicReleaseResult(null);
    setTopicReleaseDialogOpen(true);
  }

  function retryTopicReleaseGroupAction(group: TopicReleaseGroup) {
    const groupProjectIds = group.projectIds.filter((projectId) =>
      projects.some((project) => project.id === projectId),
    );
    if (groupProjectIds.length === 0) {
      setErrorMessage("这个主题没有可重新发布的项目。");
      return;
    }

    openTopicReleaseDialog(groupProjectIds, "triggerNow", {
      topic: group.topic,
      ref: group.refs.length === 1 ? (group.refs[0] ?? "") : "",
      deployEnv:
        group.deployEnvs.length === 1 && group.deployEnvs[0] !== "-"
          ? (group.deployEnvs[0] ?? "")
          : "",
      variablesText: serializeVariables(
        releaseOverrideVariables(group.latestRelease),
      ),
    });
    setActiveArea("topicReleases");
  }

  function triggerTopicReleaseGroupAction(group: TopicReleaseGroup) {
    const groupProjectIds = group.projectIds.filter((projectId) =>
      projects.some((project) => project.id === projectId),
    );
    if (groupProjectIds.length === 0) {
      setErrorMessage("这个主题没有可重新发布的项目。");
      return;
    }

    const selectedProjects = projects.filter((project) =>
      groupProjectIds.includes(project.id),
    );
    const releaseIssue = selectedProjects
      .map((project) => topicReleaseProjectIssue(project, canTriggerPipelines))
      .find((issue): issue is string => Boolean(issue));

    if (releaseIssue) {
      setErrorMessage(releaseIssue);
      return;
    }

    triggerTopicRelease.mutate({
      topic: group.topic,
      projectIds: groupProjectIds,
      ref: group.refs.length === 1 ? (group.refs[0] ?? undefined) : undefined,
      deployEnv:
        group.deployEnvs.length === 1 && group.deployEnvs[0] !== "-"
          ? (group.deployEnvs[0] ?? undefined)
          : undefined,
      variables: releaseOverrideVariables(group.latestRelease),
    });
    setActiveArea("topicReleases");
  }

  function openTopicReleaseArea() {
    setActiveArea("topicReleases");
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
    setProjectBranchMode("catalog");
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
    setProjectBranchMode("catalog");
    setProjectDraftPanel("basic");
  }

  async function handleDeleteProject(project: ProjectRow) {
    const isDockerProject = project.deployTarget === "docker";
    const accepted = await confirm({
      title: "删除 CMDB 项目",
      description: isDockerProject
        ? `将先通过 SSH 清理 ${project.name} 在目标资产上的 Docker 容器，再删除纳管配置及发布记录。远程清理失败时不会删除项目。`
        : `将删除 ${project.name} 的纳管配置及其发布记录。`,
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

    const variables = mergeReleaseVariables(releaseDraft);

    triggerRelease.mutate({
      projectId: releaseDraft.projectId,
      ref: releaseDraft.ref || undefined,
      deployEnv: releaseDraft.deployEnv || undefined,
      variables,
    });
  }

  function createTopicReleasePlanAction() {
    if (topicReleaseDraft.projectIds.length === 0) {
      setErrorMessage("请选择至少一个要发布的项目。");
      return;
    }

    const selectedProjects = projects.filter((project) =>
      topicReleaseDraft.projectIds.includes(project.id),
    );
    const releaseIssue = selectedProjects
      .map((project) => topicReleaseProjectIssue(project, canTriggerPipelines))
      .find((issue): issue is string => Boolean(issue));

    if (releaseIssue) {
      setErrorMessage(releaseIssue);
      return;
    }

    const plan: TopicReleasePlan = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      topic: topicReleasePlanTitle(topicReleaseDraft),
      projectIds: [...topicReleaseDraft.projectIds],
      ref: topicReleaseDraft.ref.trim(),
      deployEnv: topicReleaseDraft.deployEnv.trim(),
      variablesText: topicReleaseDraft.variablesText,
      createdAt: new Date().toISOString(),
    };

    setTopicReleasePlans((current) => [plan, ...current]);
    setTopicReleaseDraft(emptyTopicReleaseDraft());
    setTopicReleaseResult(null);
    setErrorMessage(null);
    setTopicReleaseDialogOpen(false);
    setActiveArea("topicReleases");
  }

  function triggerTopicReleaseDraftAction() {
    if (topicReleaseDraft.projectIds.length === 0) {
      setErrorMessage("请选择至少一个要发布的项目。");
      return;
    }

    const selectedProjects = projects.filter((project) =>
      topicReleaseDraft.projectIds.includes(project.id),
    );
    const releaseIssue = selectedProjects
      .map((project) => topicReleaseProjectIssue(project, canTriggerPipelines))
      .find((issue): issue is string => Boolean(issue));

    if (releaseIssue) {
      setErrorMessage(releaseIssue);
      return;
    }

    triggerTopicRelease.mutate({
      topic: topicReleasePlanTitle(topicReleaseDraft),
      projectIds: topicReleaseDraft.projectIds,
      ref: topicReleaseDraft.ref.trim() || undefined,
      deployEnv: topicReleaseDraft.deployEnv.trim() || undefined,
      variables: parseVariables(topicReleaseDraft.variablesText),
    });
  }

  function submitTopicReleaseDialogAction() {
    if (topicReleaseDialogMode === "triggerNow") {
      triggerTopicReleaseDraftAction();
      return;
    }

    createTopicReleasePlanAction();
  }

  function triggerTopicReleasePlanAction(plan: TopicReleasePlan) {
    const selectedProjects = projects.filter((project) =>
      plan.projectIds.includes(project.id),
    );
    const releaseIssue = selectedProjects
      .map((project) => topicReleaseProjectIssue(project, canTriggerPipelines))
      .find((issue): issue is string => Boolean(issue));

    if (releaseIssue) {
      setErrorMessage(releaseIssue);
      return;
    }

    setTriggeringTopicReleasePlanId(plan.id);
    triggerTopicRelease.mutate(
      {
        topic: plan.topic || undefined,
        projectIds: plan.projectIds,
        ref: plan.ref || undefined,
        deployEnv: plan.deployEnv || undefined,
        variables: parseVariables(plan.variablesText),
      },
      {
        onSuccess: () => {
          setTopicReleasePlans((current) =>
            current.filter((item) => item.id !== plan.id),
          );
        },
        onSettled: () => {
          setTriggeringTopicReleasePlanId(null);
        },
      },
    );
  }

  async function deleteTopicReleasePlanAction(plan: TopicReleasePlan) {
    const accepted = await confirm({
      title: "删除主题发布",
      description: `将删除待发布主题 ${plan.topic}。`,
      confirmLabel: "删除",
      confirmVariant: "destructive",
    });

    if (!accepted) return;

    setTopicReleasePlans((current) =>
      current.filter((item) => item.id !== plan.id),
    );
  }

  async function deleteTopicReleaseGroupAction(group: TopicReleaseGroup) {
    const accepted = await confirm({
      title: "删除主题发布记录",
      description: `将删除主题 ${group.topic} 下的 ${group.releaseTotal} 条发布记录。`,
      confirmLabel: "删除",
      confirmVariant: "destructive",
    });

    if (!accepted) return;

    deleteTopicReleaseGroup.mutate({ topic: group.topic });
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
                <h1 className="mt-1.5 text-[1.28rem] leading-tight font-semibold tracking-normal text-slate-950 md:text-[1.45rem]">
                  资产与发布管理
                </h1>
                <p className="mt-0.5 max-w-3xl text-[13px] leading-5 text-slate-600">
                  统一维护服务器、GitLab
                  项目、构建与部署记录，优先暴露连通性、健康检查和发布风险。
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

      {successMessage ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <AlertTitle>操作完成</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
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
          description="手动维护部署所需的 IP、SSH、角色与架构信息，并定时检测 SSH 登录状态。"
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
                {assets.map((asset) => {
                  const assetServices =
                    servicesByAssetName.get(asset.name) ?? [];
                  const servicesExpanded = expandedAssetNameSet.has(asset.name);

                  return (
                    <article
                      key={`asset-card-${asset.name}`}
                      className="grid gap-3 rounded-[12px] border border-slate-200/90 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] md:grid-cols-[minmax(0,1.3fr)_minmax(120px,0.55fr)_minmax(120px,0.55fr)_auto] md:items-center"
                    >
                      <button
                        type="button"
                        className="min-w-0 text-left focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:outline-none"
                        onClick={() => toggleAssetServices(asset.name)}
                        aria-expanded={servicesExpanded}
                        aria-controls={`asset-services-${asset.id}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-semibold tracking-normal text-slate-950">
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
                          <ChevronDownIcon
                            className={cn(
                              "size-4 text-slate-400 transition-transform",
                              servicesExpanded ? "rotate-180" : "",
                            )}
                          />
                        </div>
                        <p className="mt-1 truncate text-[13px] text-slate-500">
                          {asset.ip} · {asset.sshUser ?? "root"}:{asset.sshPort}
                        </p>
                      </button>

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
                          onClick={() => toggleAssetServices(asset.name)}
                          aria-expanded={servicesExpanded}
                          aria-controls={`asset-services-${asset.id}`}
                        >
                          <ChevronDownIcon
                            data-icon="inline-start"
                            className={cn(
                              "transition-transform",
                              servicesExpanded ? "rotate-180" : "",
                            )}
                          />
                          服务 {assetServices.length}
                        </Button>
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

                      {servicesExpanded ? (
                        <div
                          id={`asset-services-${asset.id}`}
                          className="min-w-0 border-t border-slate-200/80 pt-3 md:col-span-4"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              部署服务
                            </p>
                            <span className="text-xs text-slate-500">
                              {assetServices.length} 个服务挂载到 {asset.name}
                            </span>
                          </div>
                          <AssetServiceList
                            assetName={asset.name}
                            services={assetServices}
                            onOpenOperation={openProjectOperation}
                          />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-hidden rounded-[12px] border border-slate-200/90 2xl:block">
                <Table className="min-w-[840px]">
                  <TableHeader className="bg-slate-50/90">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>资产</TableHead>
                      <TableHead>IP / SSH</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>架构</TableHead>
                      <TableHead>SSH 状态</TableHead>
                      <TableHead className="text-right">挂载服务</TableHead>
                      <TableHead className={STICKY_ACTION_HEAD_CLASS}>
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => {
                      const assetServices =
                        servicesByAssetName.get(asset.name) ?? [];
                      const servicesExpanded = expandedAssetNameSet.has(
                        asset.name,
                      );

                      return (
                        <Fragment key={`asset-row-${asset.name}`}>
                          <TableRow className="group">
                            <TableCell>
                              <button
                                type="button"
                                className="grid gap-1 text-left focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:outline-none"
                                onClick={() => toggleAssetServices(asset.name)}
                                aria-expanded={servicesExpanded}
                                aria-controls={`asset-services-${asset.id}`}
                              >
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
                                  <ChevronDownIcon
                                    className={cn(
                                      "size-4 text-slate-400 transition-transform",
                                      servicesExpanded ? "rotate-180" : "",
                                    )}
                                  />
                                </div>
                              </button>
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
                                  onClick={() =>
                                    toggleAssetServices(asset.name)
                                  }
                                  aria-expanded={servicesExpanded}
                                  aria-controls={`asset-services-${asset.id}`}
                                  title={
                                    servicesExpanded ? "收起服务" : "展开服务"
                                  }
                                >
                                  <ChevronDownIcon
                                    className={cn(
                                      "transition-transform",
                                      servicesExpanded ? "rotate-180" : "",
                                    )}
                                  />
                                </Button>
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
                          {servicesExpanded ? (
                            <TableRow
                              key={`${asset.name}-services`}
                              className="hover:bg-transparent"
                            >
                              <TableCell
                                colSpan={7}
                                className="bg-slate-50/60 p-3"
                              >
                                <div
                                  id={`asset-services-${asset.id}`}
                                  className="rounded-[12px] border border-slate-200/90 bg-white p-3"
                                >
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-slate-900">
                                      部署服务
                                    </p>
                                    <span className="text-xs text-slate-500">
                                      {assetServices.length} 个服务挂载到{" "}
                                      {asset.name}
                                    </span>
                                  </div>
                                  <AssetServiceList
                                    assetName={asset.name}
                                    services={assetServices}
                                    onOpenOperation={openProjectOperation}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </ModuleSection>
      ) : null}

      {data && activeArea === "projects" ? (
        <div id="cmdb-panel-projects" className="grid gap-4">
          <ModuleSection
            title="GitLab 项目管理"
            description="统一维护仓库、部署目标、健康检查、默认变量和最近发布入口。"
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
                  onClick={openTopicReleaseArea}
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
                  "补充健康检查 URL 与发布变量",
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
              <div className="grid gap-2">
                {projects.map((project) => {
                  const release = project.latestRelease;
                  const projectReleases = project.releases;
                  const releasesExpanded = expandedProjectReleaseIdSet.has(
                    project.id,
                  );
                  const releaseTopicLabel = release
                    ? releaseTopic(release)
                    : null;
                  const operationIssue = projectReleaseIssue(
                    project,
                    data.gitlab.canTriggerPipelines,
                  );

                  return (
                    <article
                      key={`project-row-${project.id}`}
                      className="grid gap-3 rounded-[12px] border border-slate-200/90 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300/90 hover:bg-slate-50/35 lg:grid-cols-[minmax(210px,0.9fr)_minmax(280px,1.35fr)_minmax(230px,0.95fr)_auto] lg:items-center lg:px-4"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="min-w-0 truncate text-[15px] leading-6 font-semibold tracking-normal text-slate-950">
                            {project.name}
                          </h3>
                          {!project.enabled ? (
                            <Badge className="border border-slate-200 bg-slate-100 text-slate-700">
                              已禁用
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[13px] leading-5 text-slate-500">
                          {project.gitlabPath}
                        </p>
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                          <Badge className="border border-slate-200 bg-white text-slate-700">
                            {deployTargetLabel(project.deployTarget)}
                          </Badge>
                          <span className="rounded-[7px] bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {project.defaultBranch}
                          </span>
                        </div>
                      </div>

                      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                        <div className="min-w-0 rounded-[10px] bg-slate-50/85 px-3 py-2">
                          <p className="text-[11px] leading-4 font-medium text-slate-500">
                            目标资产
                          </p>
                          <p className="mt-1 truncate text-sm leading-5 font-medium text-slate-900">
                            {projectTargetAssetsLabel(project.config)}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-xs leading-5 text-slate-500">
                            {projectDeployConfigLabel(project)}
                          </p>
                        </div>

                        <div className="min-w-0 rounded-[10px] bg-slate-50/85 px-3 py-2">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <p className="text-[11px] leading-4 font-medium text-slate-500">
                              最近发布
                            </p>
                            <Button
                              variant="ghost"
                              size="xs"
                              className="h-6 rounded-[7px] px-1.5 text-slate-600 hover:bg-white"
                              onClick={() =>
                                toggleProjectReleaseHistory(project.id)
                              }
                              aria-expanded={releasesExpanded}
                              aria-controls={`project-release-history-${project.id}`}
                              aria-label={
                                releasesExpanded
                                  ? "收起发布记录"
                                  : "展开发布记录"
                              }
                              title={
                                releasesExpanded
                                  ? "收起发布记录"
                                  : "展开发布记录"
                              }
                            >
                              <ChevronDownIcon
                                data-icon="inline-start"
                                className={cn(
                                  "transition-transform",
                                  releasesExpanded ? "rotate-180" : "",
                                )}
                              />
                              {projectReleases.length}
                            </Button>
                          </div>
                          {release ? (
                            <>
                              <div className="mt-1 flex min-w-0 items-center gap-2">
                                <Badge
                                  className={cn(
                                    "shrink-0 border",
                                    releaseTone(release.status),
                                  )}
                                >
                                  {releaseLabel(release.status)}
                                </Badge>
                                <span className="truncate text-xs text-slate-500">
                                  {formatTime(release.createdAt)}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-sm leading-5 text-slate-700">
                                {release.ref}
                                {release.deployEnv
                                  ? ` -> ${release.deployEnv}`
                                  : ""}
                                {releaseTopicLabel
                                  ? ` · ${releaseTopicLabel}`
                                  : ""}
                              </p>
                            </>
                          ) : (
                            <p className="mt-1 text-sm leading-5 text-slate-500">
                              暂无发布
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 rounded-[10px] border border-slate-200/75 bg-white px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge
                            className={cn(
                              "shrink-0 border",
                              monitorTone(project.monitor.status),
                            )}
                          >
                            {monitorLabel(project.monitor.status)}
                          </Badge>
                          <span className="truncate text-xs font-medium text-slate-600">
                            {monitorSummary(project)}
                          </span>
                        </div>
                        <p
                          className="mt-1 truncate text-xs leading-5 text-slate-500"
                          title={project.monitor.message}
                        >
                          {project.monitor.message}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          {project.monitor.url ? (
                            <a
                              href={project.monitor.url}
                              target="_blank"
                              rel="noreferrer"
                              className="max-w-full truncate text-sky-700 hover:text-sky-900"
                            >
                              {project.monitor.url}
                            </a>
                          ) : (
                            <span>未配置检查地址</span>
                          )}
                          <span>检查 {monitorCheckedAtLabel(project)}</span>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="h-6 rounded-[7px] px-1.5 text-slate-600 hover:bg-slate-100"
                            onClick={() => openMonitorDialog(project)}
                          >
                            <InfoIcon data-icon="inline-start" />
                            详情
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 lg:flex-col lg:items-stretch">
                        <Button
                          size="sm"
                          className="h-8 rounded-[9px] bg-slate-900 px-3 text-white hover:bg-slate-800 lg:w-full"
                          onClick={() => openReleaseModal(project)}
                          disabled={Boolean(operationIssue)}
                          title={operationIssue ?? undefined}
                        >
                          <RocketIcon data-icon="inline-start" />
                          发布
                        </Button>
                        {operationIssue ? (
                          <p className="max-w-[220px] text-right text-xs leading-5 text-rose-600 lg:max-w-none">
                            {operationIssue}
                          </p>
                        ) : null}
                        <div
                          className={cn(CMDB_ACTION_GROUP_CLASS, "justify-end")}
                        >
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
                              openProjectOperation(project, "containerMonitor")
                            }
                            disabled={Boolean(
                              projectOperationIssue(
                                project,
                                "containerMonitor",
                              ),
                            )}
                            title={
                              projectOperationIssue(
                                project,
                                "containerMonitor",
                              ) ?? "容器监控"
                            }
                          >
                            <MonitorCogIcon />
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

                      {releasesExpanded ? (
                        <div
                          id={`project-release-history-${project.id}`}
                          className="min-w-0 border-t border-slate-200/80 pt-3 lg:col-span-4"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              发布记录
                            </p>
                            <span className="text-xs text-slate-500">
                              最近 {projectReleases.length} 条
                            </span>
                          </div>
                          <ProjectReleaseHistory
                            releases={projectReleases}
                            canCancelReleases={canCancelReleases}
                            cancelingReleaseId={cancelingReleaseId}
                            onCancelRelease={(release) =>
                              void cancelReleaseAction(release)
                            }
                            onOpenOperation={openReleaseOperation}
                          />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </ModuleSection>
        </div>
      ) : null}

      {data && activeArea === "topicReleases" ? (
        <div id="cmdb-panel-topicReleases" className="grid gap-4">
          <ModuleSection
            title="主题发布"
            description="按主题集中管理批量发布记录，查看每个项目的发布结果和运维入口。"
            density="compact"
            className="rounded-[12px] border-slate-200/95 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                  成功 {topicReleaseSuccessTotal}
                </Badge>
                <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
                  进行中 {topicReleaseRunningTotal}
                </Badge>
                <Badge className="border border-rose-200 bg-rose-50 text-rose-700">
                  失败 {topicReleaseFailedTotal}
                </Badge>
                {topicReleasePlans.length > 0 ? (
                  <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
                    待发布 {topicReleasePlans.length}
                  </Badge>
                ) : null}
                <Button
                  size="sm"
                  className="rounded-[9px]"
                  onClick={() => openTopicReleaseDialog()}
                >
                  <PlusIcon data-icon="inline-start" />
                  新建主题发布
                </Button>
              </div>
            }
          >
            <TopicReleaseList
              groups={topicReleaseGroups}
              plans={topicReleasePlans}
              projects={projects}
              triggeringPlanId={triggeringTopicReleasePlanId}
              triggeringTopicRelease={triggerTopicRelease.isPending}
              canCancelReleases={canCancelReleases}
              cancelingReleaseId={cancelingReleaseId}
              onCancelRelease={(release) => void cancelReleaseAction(release)}
              onOpenOperation={openReleaseOperation}
              onOpenHistory={openTopicReleaseHistory}
              onCreate={() => openTopicReleaseDialog()}
              onTriggerPlan={triggerTopicReleasePlanAction}
              onTriggerGroup={triggerTopicReleaseGroupAction}
              onRetryGroup={retryTopicReleaseGroupAction}
              onDeletePlan={deleteTopicReleasePlanAction}
              onDeleteGroup={deleteTopicReleaseGroupAction}
            />
          </ModuleSection>
        </div>
      ) : null}

      <Dialog
        open={Boolean(topicReleaseHistory)}
        onOpenChange={(open) => {
          if (!open) setTopicReleaseHistory(null);
        }}
      >
        <DialogContent className="grid max-h-[min(90vh,820px)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border border-slate-200/90 bg-white p-0 shadow-[0_28px_70px_rgba(15,23,42,0.16)] sm:max-w-[980px]">
          <DialogHeader className="gap-0 border-b border-slate-200/80 bg-white px-4 py-3 pr-14 sm:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-base leading-6 font-semibold tracking-normal text-slate-950">
                  {topicReleaseHistory?.projectName ?? "部署记录"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-5 text-slate-600">
                  {topicReleaseHistory?.gitlabPath ?? "-"}
                </DialogDescription>
              </div>
              {topicReleaseHistory ? (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <TopicReleaseCountPill
                    label="成功"
                    value={topicReleaseHistory.successTotal}
                    tone="success"
                  />
                  <TopicReleaseCountPill
                    label="进行中"
                    value={topicReleaseHistory.runningTotal}
                    tone="running"
                  />
                  <TopicReleaseCountPill
                    label="失败"
                    value={topicReleaseHistory.failedTotal}
                    tone="failed"
                  />
                  {topicReleaseHistory.canceledTotal > 0 ? (
                    <TopicReleaseCountPill
                      label="取消"
                      value={topicReleaseHistory.canceledTotal}
                      tone="neutral"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto bg-slate-50/65 p-3 sm:p-4">
            {topicReleaseHistory ? (
              <div className="overflow-hidden rounded-[12px] border border-slate-200/90 bg-white">
                <div className="flex flex-col gap-2 border-b border-slate-200/80 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-950">
                      部署记录
                    </p>
                    <p className="text-xs leading-5 text-slate-500">
                      最近 {topicReleaseHistory.releaseTotal}{" "}
                      条，按创建时间倒序。
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <TopicReleaseValueChips values={topicReleaseHistory.refs} />
                    <TopicReleaseValueChips
                      values={topicReleaseHistory.deployEnvs}
                    />
                  </div>
                </div>
                <div className="divide-y divide-slate-200/75">
                  {topicReleaseHistory.releases.map((release) => (
                    <TopicReleaseReleaseRow
                      key={`topic-release-history-${release.id}`}
                      release={release}
                      canCancelReleases={canCancelReleases}
                      cancelingReleaseId={cancelingReleaseId}
                      onCancelRelease={(item) =>
                        void cancelReleaseAction(item)
                      }
                      onOpenOperation={openReleaseOperation}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter
            bleed={false}
            className="border-t border-slate-200/90 bg-white px-5 py-3"
          >
            <Button
              size="sm"
              className="rounded-[10px]"
              onClick={() => setTopicReleaseHistory(null)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={monitorDialogOpen} onOpenChange={setMonitorDialogOpen}>
        <DialogContent className="max-w-[720px] overflow-hidden border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.14)]">
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4 pr-14">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-lg leading-6 font-semibold tracking-normal">
                  监控诊断
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-6 text-slate-600">
                  展示最近一次健康检查请求、响应和失败原因。
                </DialogDescription>
              </div>
              {selectedMonitorProject ? (
                <Badge
                  className={cn(
                    "w-fit border",
                    monitorTone(selectedMonitorProject.monitor.status),
                  )}
                >
                  {monitorLabel(selectedMonitorProject.monitor.status)}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          {selectedMonitorProject ? (
            <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto bg-slate-50/70 px-5 py-5">
              <div className="grid gap-4">
                <Alert
                  className={cn(
                    "text-slate-900",
                    selectedMonitorProject.monitor.status === "healthy"
                      ? "border-emerald-200 bg-emerald-50"
                      : selectedMonitorProject.monitor.status === "degraded"
                        ? "border-rose-200 bg-rose-50"
                        : "border-slate-200 bg-white",
                  )}
                >
                  <AlertTriangleIcon className="size-4" />
                  <AlertTitle>
                    {selectedMonitorProject.monitor.message}
                  </AlertTitle>
                  <AlertDescription className="text-slate-600">
                    {monitorSummary(selectedMonitorProject)}
                  </AlertDescription>
                </Alert>

                <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-200/90 bg-white">
                  <dl className="divide-y divide-slate-100">
                    {monitorDetailRows(selectedMonitorProject).map(
                      ([label, value]) => (
                        <div
                          key={label}
                          className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[120px_minmax(0,1fr)]"
                        >
                          <dt className="font-medium text-slate-500">
                            {label}
                          </dt>
                          <dd className="min-w-0 font-medium break-words text-slate-900">
                            {value}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </div>

                {selectedMonitorProject.monitor.responsePreview ? (
                  <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-200/90 bg-white">
                    <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-950">
                      响应片段
                    </div>
                    <pre className="max-h-48 overflow-auto px-4 py-3 font-mono text-xs leading-6 whitespace-pre-wrap text-slate-700">
                      {selectedMonitorProject.monitor.responsePreview}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter
            bleed={false}
            className="border-t border-slate-200/90 bg-white px-5 py-3"
          >
            {selectedMonitorProject?.monitor.url ? (
              <a
                href={selectedMonitorProject.monitor.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "rounded-[10px]",
                )}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                打开检查地址
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="rounded-[10px]"
              onClick={() => void dashboardQuery.refetch()}
              disabled={dashboardQuery.isFetching}
            >
              <RefreshCwIcon data-icon="inline-start" />
              重新检查
            </Button>
            <Button
              size="sm"
              className="rounded-[10px]"
              onClick={() => setMonitorDialogOpen(false)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              ? "h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] rounded-[var(--radius-card)] sm:max-h-[calc(100dvh-0.75rem)] sm:max-w-[calc(100vw-0.75rem)]"
              : "max-h-[min(90vh,820px)] max-w-[calc(100vw-1rem)] rounded-[var(--radius-card)] sm:max-w-[1040px]",
          )}
        >
          <DialogHeader className="gap-0 border-b border-slate-200/80 bg-white px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
                  <OperationIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <DialogTitle className="text-base leading-6 font-semibold tracking-normal text-slate-950">
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
              <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
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
              "flex min-h-0 flex-col gap-3 overflow-y-auto bg-slate-50/60 p-3 sm:p-4",
              operationDialogMaximized &&
                operationAction === "sshInfo" &&
                "overscroll-contain",
            )}
          >
            <div className="grid shrink-0 overflow-hidden rounded-[12px] border border-slate-200 bg-slate-200 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
                  operationDialogMaximized && "min-h-0 flex-1",
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
                    "overflow-hidden rounded-[var(--radius-card)] border border-slate-900 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]",
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
                        terminalStatusState === "connected"
                          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                          : terminalStatusState === "error"
                            ? "border-rose-400/25 bg-rose-400/10 text-rose-200"
                            : "border-slate-400/25 bg-slate-400/10 text-slate-200",
                      )}
                    >
                      {terminalStatusLabel(terminalStatusState)}
                    </Badge>
                  </div>
                  <div
                    onClick={() => terminalRef.current?.focus()}
                    className={cn(
                      "relative overflow-hidden focus-within:ring-2 focus-within:ring-sky-500/70 focus-within:ring-inset",
                      operationDialogMaximized
                        ? "min-h-0 flex-1"
                        : "h-[min(58vh,620px)] min-h-[420px]",
                    )}
                  >
                    <div
                      ref={setTerminalHost}
                      aria-label="容器终端"
                      role="application"
                      className={cn(
                        "h-full w-full cursor-text bg-slate-950 px-3 py-3 text-slate-100",
                        "[&_.xterm]:h-full [&_.xterm-viewport]:overflow-y-auto [&_.xterm-viewport]:[scrollbar-color:rgba(148,163,184,0.55)_transparent]",
                      )}
                    />
                  </div>
                </div>
              </div>
            ) : projectOperation.isPending ? (
              <div className="flex min-h-[260px] items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-slate-300 bg-white text-sm text-slate-600">
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
              operationAction === "containerMonitor" ? (
                <ContainerMonitorPanel
                  project={operationProject}
                  result={operationResult}
                  status={operationDockerStatus}
                />
              ) : operationDockerStatus ? (
                <DockerStatusPanel
                  result={operationResult}
                  status={operationDockerStatus}
                />
              ) : operationAction === "dockerStatus" ? (
                <Alert className="border-amber-200 bg-amber-50 text-amber-950">
                  <AlertTriangleIcon className="size-4" />
                  <AlertTitle>状态不可用</AlertTitle>
                  <AlertDescription>
                    {operationText || "未能解析目标容器状态。"}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="overflow-hidden rounded-[var(--radius-card)] border border-slate-900 bg-slate-950 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
                  <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex shrink-0 gap-1.5">
                        <span className="size-2 rounded-full bg-rose-400" />
                        <span className="size-2 rounded-full bg-amber-300" />
                        <span className="size-2 rounded-full bg-emerald-400" />
                      </span>
                      <span className="truncate font-mono text-xs text-slate-300">
                        最近日志
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
              )
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
                    openProjectOperation(
                      operationProject,
                      operationAction,
                      operationSelectedAssetName ?? undefined,
                    )
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
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-lg leading-6 font-semibold tracking-normal">
                  {assetDraft.id ? "编辑服务器资产" : "新增服务器资产"}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  维护服务器身份、SSH
                  端口可达性和运行画像，供部署目标选择与筛选使用。
                </DialogDescription>
              </div>
              <Badge className="w-fit max-w-full border border-slate-200 bg-slate-50 text-slate-700">
                真实 SSH 登录
              </Badge>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid content-start gap-5">
                <section className="rounded-[var(--radius-card)] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
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

                  <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_120px]">
                    <ProjectDraftField label="SSH 用户" className="gap-1.5">
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
                        className="h-9 bg-white"
                      />
                    </ProjectDraftField>
                    <ProjectDraftField label="SSH 密码" className="gap-1.5">
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
                        className="h-9 bg-white"
                      />
                    </ProjectDraftField>
                    <ProjectDraftField
                      label="SSH 端口"
                      hint={
                        assetSshPortValid ? "默认 22" : "请输入 1-65535 的整数"
                      }
                      className="gap-1.5"
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
                          "h-9 bg-white",
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

                <section className="rounded-[var(--radius-card)] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
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
                <section className="rounded-[var(--radius-card)] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
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
                          : "用于 CMDB 登录目标机器执行部署和运维"
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

                <section className="rounded-[var(--radius-card)] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sky-50 text-sky-700 ring-1 ring-sky-100">
                      <KeyRoundIcon className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">
                        SSH 部署凭据
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        后续发布会由 CMDB 使用这里保存的账号密码登录目标资产。
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[12px] border border-sky-100 bg-sky-50/70 px-3 py-3 text-sm leading-6 text-slate-700">
                    当前 CMDB 会保存 SSH 用户、密码和端口；“登录测试”会真正建立
                    SSH 会话。部署目标选择 Docker 或 SSH 时，GitLab
                    只负责构建镜像，后续部署由 CMDB 登录目标资产执行。
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
                        CMDB 远程执行
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
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <DialogTitle className="text-lg leading-6 font-semibold tracking-normal">
                  {projectDraft.id ? "编辑 CMDB 项目" : "纳管 GitLab 项目"}
                </DialogTitle>
                <DialogDescription className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  先定仓库，再按步骤补齐部署、观测和变量。保存前底部会显示关键配置。
                </DialogDescription>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
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

                    <div className="grid gap-3 md:max-w-[520px]">
                      <ProjectDraftField
                        label="默认分支"
                        hint={
                          gitlabBranchesQuery.isError
                            ? "分支列表读取失败，可在下方手动填写。"
                            : gitlabBranchItems.length > 0
                              ? "已从 GitLab 仓库读取分支。"
                              : "未读取到分支时仍可手动填写。"
                        }
                      >
                        <Select
                          value={defaultBranchSelectValue}
                          onValueChange={(value) => {
                            if (!value) return;
                            if (value === CUSTOM_BRANCH_VALUE) {
                              setProjectBranchMode("custom");
                              setProjectDraft((current) => ({
                                ...current,
                                defaultBranch:
                                  current.defaultBranch.trim() || "main",
                              }));
                              return;
                            }

                            setProjectBranchMode("catalog");
                            setProjectDraft((current) => ({
                              ...current,
                              defaultBranch: value,
                            }));
                          }}
                          disabled={
                            gitlabBranchesQuery.isLoading &&
                            gitlabBranchItems.length === 0
                          }
                        >
                          <SelectTrigger className="w-full rounded-[10px] bg-white">
                            <SelectValue>
                              {gitlabBranchesQuery.isLoading &&
                              gitlabBranchItems.length === 0
                                ? "读取分支中"
                                : defaultBranchSelectValue ===
                                    CUSTOM_BRANCH_VALUE
                                  ? "自定义分支"
                                  : projectDraft.defaultBranch.trim() || "main"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent
                            align="start"
                            alignItemWithTrigger={false}
                            className="max-h-64 rounded-[12px]"
                            side="bottom"
                            sideOffset={6}
                          >
                            <SelectGroup>
                              <SelectItem value={CUSTOM_BRANCH_VALUE}>
                                自定义分支
                              </SelectItem>
                              <SelectSeparator />
                              {branchNames.map((branch) => {
                                const branchMeta = gitlabBranchItems.find(
                                  (item) => item.name === branch,
                                );

                                return (
                                  <SelectItem
                                    key={branch}
                                    value={branch}
                                    className="min-w-0"
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      {branch}
                                    </span>
                                    {branchMeta?.isDefault ? (
                                      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                                        默认
                                      </span>
                                    ) : null}
                                    {branchMeta?.isProtected ? (
                                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                                        保护
                                      </span>
                                    ) : null}
                                  </SelectItem>
                                );
                              })}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </ProjectDraftField>

                      {shouldShowCustomBranchInput ? (
                        <ProjectDraftField
                          label="自定义分支"
                          hint="可输入分支、Tag 或其他 GitLab ref。"
                          className="gap-1.5"
                        >
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
                      ) : null}
                    </div>

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
                  </section>
                ) : null}

                {projectDraftPanel === "deploy" ? (
                  <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-slate-950">
                        部署配置
                      </h3>
                      <p className="text-sm leading-6 text-slate-500">
                        GitLab 负责标准化构建，CMDB 负责后续部署和远程运维。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
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
                    </div>

                    <ProjectDraftField
                      label="目标资产"
                      hint="可选择多台服务器，发布时由 CMDB 依次登录目标资产执行部署。"
                    >
                      <div className="grid gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3">
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

                        <div className="flex flex-col gap-2 sm:flex-row">
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
                              className="h-9 rounded-[10px] bg-white sm:w-20"
                              onClick={clearProjectTargetAssets}
                            >
                              清空
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </ProjectDraftField>

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
                      <ProjectDraftField
                        label="Docker 镜像"
                        hint="可选；填写后会作为 DOCKER_IMAGE 传给 GitLab Pipeline，CMDB 也会用它执行远程 Docker 部署。"
                      >
                        <Input
                          value={projectDraft.dockerImage}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              dockerImage: event.target.value,
                            }))
                          }
                          placeholder="可选：registry.local/cola/web:latest"
                        />
                      </ProjectDraftField>
                    ) : null}

                    <ProjectDraftField
                      label="Trigger Token"
                      hint="可选；用于触发构建流水线，未配置则使用全局 GitLab API Token。"
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

                    {projectDraft.deployTarget === "ssh" ? (
                      <div className="grid gap-4">
                        <Alert className="border-sky-200 bg-sky-50 text-sky-900">
                          <GitBranchIcon className="size-4" />
                          <AlertTitle>由 CMDB 执行 SSH 部署</AlertTitle>
                          <AlertDescription>
                            GitLab 构建成功后，CMDB
                            会登录目标资产，并在部署路径下执行这里配置的部署命令。
                          </AlertDescription>
                        </Alert>

                        <div className="grid gap-4 md:grid-cols-2">
                          <ProjectDraftField
                            label="部署路径"
                            hint="可选；CMDB 会先切换到该目录再执行部署命令。"
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
                            label="部署命令"
                            hint="SSH 发布必填；GitLab 构建成功后由 CMDB 在目标资产上执行。"
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
                        默认发布变量
                      </h3>
                      <p className="text-sm leading-6 text-slate-500">
                        每行一个 KEY=VALUE，会传给构建流水线，并可被 CMDB
                        部署步骤使用。
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
              当前发布会先触发 GitLab 构建流水线；构建成功后，CMDB
              会根据项目配置执行部署。
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
            {releaseDraft.deployTarget === "docker" ? (
              <ProjectDraftField
                label="Docker 镜像"
                hint="可选覆盖；填写后会作为 DOCKER_IMAGE 传给 GitLab Pipeline 和 CMDB 部署步骤。"
              >
                <Input
                  value={releaseDraft.dockerImage}
                  onChange={(event) =>
                    setReleaseDraft((current) => ({
                      ...current,
                      dockerImage: event.target.value,
                    }))
                  }
                  placeholder="可选：registry.local/cola/web:latest"
                />
              </ProjectDraftField>
            ) : null}
            <ProjectDraftField
              label="本次附加变量"
              hint={
                releaseDraft.deployTarget === "docker"
                  ? "每行一个 KEY=VALUE，会覆盖项目默认变量；需要临时指定镜像时可填 DOCKER_IMAGE 或使用上方字段。"
                  : "每行一个 KEY=VALUE，会覆盖项目默认变量。"
              }
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
          <DialogHeader className="gap-0 border-b border-slate-200/90 px-5 py-4">
            <DialogTitle className="text-lg leading-6 font-semibold tracking-normal">
              {topicReleaseDialogTitle}
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {topicReleaseDialogDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <section className="grid content-start gap-4 rounded-[var(--radius-card)] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    发布主题
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    本次批量发布会写入 CMDB_RELEASE_TOPIC
                    变量，便于构建和发布记录追踪。
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <ProjectDraftField
                    label="Ref"
                    hint="留空时使用各项目默认分支。"
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
                      placeholder="main"
                    />
                  </ProjectDraftField>

                  <ProjectDraftField
                    label="环境"
                    hint="留空时使用各项目默认环境。"
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
                    id="topic-release-dialog-variables"
                    name="topicReleaseVariables"
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

                <div className="grid gap-2 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500">可发布项目</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {releasableProjects.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">已选项目</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {selectedTopicProjects.length}
                    </p>
                  </div>
                </div>

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

              <section className="grid content-start gap-4 rounded-[var(--radius-card)] border border-slate-200/95 bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.035)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">
                      选择项目
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      当前可发布 {releasableProjects.length} 个，已选择{" "}
                      {selectedTopicProjects.length} 个。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-[9px] border-slate-300 bg-white"
                      onClick={selectAllTopicReleaseProjects}
                      disabled={releasableProjects.length === 0}
                    >
                      <CheckCircle2Icon data-icon="inline-start" />
                      全选
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-[9px] border-slate-300 bg-white"
                      onClick={clearTopicReleaseProjects}
                      disabled={topicReleaseDraft.projectIds.length === 0}
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      清空
                    </Button>
                  </div>
                </div>

                <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1">
                  {projects.map((project) => {
                    const selected = topicReleaseSelectedIds.has(project.id);
                    const releaseIssue = topicReleaseProjectIssue(
                      project,
                      canTriggerPipelines,
                    );

                    return (
                      <label
                        key={`topic-release-dialog-${project.id}`}
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
                          name="topicReleaseProjectIds"
                          value={project.id}
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
              onClick={submitTopicReleaseDialogAction}
              disabled={!topicReleaseCanSubmit}
            >
              {triggerTopicRelease.isPending ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : topicReleaseDialogMode === "triggerNow" ? (
                <RocketIcon data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {topicReleaseSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </ModulePageShell>
  );
}
