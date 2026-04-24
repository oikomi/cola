"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RocketIcon,
  ServerIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useDeferredValue, useState } from "react";

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

const UNASSIGNED_VALUE = "__unassigned__";
const UNSET_ARCH_VALUE = "__unset_arch__";
const CUSTOM_ARCH_VALUE = "__custom_arch__";
type CmdbAreaKey = "assets" | "projects" | "deployments";

type ProjectDraft = {
  id?: number;
  name: string;
  gitlabPath: string;
  description: string;
  defaultBranch: string;
  enabled: "true" | "false";
  deployTarget: "k8s" | "ssh" | "docker" | "none";
  targetAssetName: string;
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

function emptyProjectDraft(): ProjectDraft {
  return {
    name: "",
    gitlabPath: "",
    description: "",
    defaultBranch: "main",
    enabled: "true",
    deployTarget: "k8s",
    targetAssetName: UNASSIGNED_VALUE,
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

function assetDraftFromRow(asset: AssetRow): AssetDraft {
  return {
    id: asset.id,
    name: asset.name,
    ip: asset.ip,
    sshUser: asset.sshUser ?? "",
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
    targetAssetName: project.config?.targetAssetName ?? UNASSIGNED_VALUE,
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

function formatTime(value: Date | string | null | undefined) {
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

function targetAssetLabel(value: string) {
  return value === UNASSIGNED_VALUE ? "未指定资产" : value;
}

function ProjectDraftField(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2", props.className)}>
      <span className="text-[11px] font-medium tracking-[0.16em] text-slate-600 uppercase">
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

function CmdbEmptyState(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const Icon = props.icon;

  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] bg-slate-50 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
        <Icon className="size-5" />
      </div>
      <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-slate-950">
        {props.title}
      </p>
      <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
        {props.description}
      </p>
      {props.action ? <div className="mt-5">{props.action}</div> : null}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="grid gap-6">
      <div className="rounded-[16px] border border-slate-200/95 bg-white px-5 py-4 shadow-[0_10px_26px_rgba(15,23,42,0.045)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-5 w-28 rounded-md" />
            <Skeleton className="h-8 w-64 rounded-md md:w-80" />
            <Skeleton className="h-4 w-full max-w-[42rem] rounded-md" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-28 rounded-[10px]" />
            <Skeleton className="h-9 w-28 rounded-[10px]" />
            <Skeleton className="h-9 w-28 rounded-[10px]" />
          </div>
        </div>
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton
                key={`cmdb-area-${index}`}
                className="h-10 w-36 rounded-[10px]"
              />
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-[360px] rounded-[16px]" />
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
  const [activeArea, setActiveArea] = useState<CmdbAreaKey>("assets");
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
  const [gitlabSearch, setGitlabSearch] = useState("");
  const deferredGitlabSearch = useDeferredValue(gitlabSearch.trim());

  const dashboardQuery = api.cmdb.dashboard.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
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

  const data = dashboardQuery.data;
  const assets = data?.assets ?? [];
  const projects = data?.projects ?? [];
  const releases = data?.releases ?? [];
  const gitlabCatalogItems = gitlabCatalogQuery.data ?? [];
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
  const gitlabConfigured = Boolean(data?.gitlab.baseUrl);
  const assetRoleTags = parseAssetRoles(assetDraft.rolesText);
  const assetDetectedStatus =
    assetConnectionResult?.status ??
    (assetDraft.id ? assetDraft.status : "planned");
  const assetConnectivityLabel = assetConnectionResult
    ? assetStatusLabel(assetConnectionResult.status)
    : assetDraft.id
      ? assetStatusLabel(assetDraft.status)
      : "未检测";
  const assetConnectionMessage =
    assetConnectionResult?.message ??
    (assetDraft.id
      ? `当前记录状态：${assetStatusLabel(assetDraft.status)}`
      : "新增资产时建议先做一次 SSH 端口连通性测试。");
  const assetArchSelectValue =
    assetDraft.arch === "amd64" || assetDraft.arch === "arm64"
      ? assetDraft.arch
      : assetDraft.arch.trim().length > 0
        ? CUSTOM_ARCH_VALUE
        : null;
  const enabledProjectTotal = projects.filter(
    (project) => project.enabled,
  ).length;
  const areaCards = [
    {
      key: "assets" as const,
      label: "服务器资产",
      description: "手动维护服务器、角色、SSH 信息和项目挂载情况。",
      countLabel: `${data?.overview.assetTotal ?? assets.length} 台资产`,
      icon: ServerIcon,
    },
    {
      key: "projects" as const,
      label: "GitLab 项目管理",
      description: "集中维护仓库、部署目标、健康检查和默认变量。",
      countLabel: `${data?.overview.projectTotal ?? projects.length} 个项目`,
      icon: GitBranchIcon,
    },
    {
      key: "deployments" as const,
      label: "部署管理",
      description: "追踪最近发布、Pipeline 状态和部署环境。",
      countLabel: `${data?.overview.runningReleaseTotal ?? 0} 个进行中`,
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
    setGitlabSearch("");
    setProjectDialogOpen(true);
  }

  function openEditDialog(project: ProjectRow) {
    setProjectDraft(projectDraftFromRow(project));
    setGitlabSearch(project.gitlabPath);
    setProjectDialogOpen(true);
  }

  function openReleaseModal(project: ProjectRow) {
    setReleaseDraft(releaseDraftFromRow(project));
    setReleaseDialogOpen(true);
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

  function runAssetConnectivityTest() {
    const normalizedSshPort = assetDraft.sshPort.trim();
    const parsedSshPort =
      normalizedSshPort.length > 0
        ? Number.parseInt(normalizedSshPort, 10)
        : 22;

    if (!Number.isInteger(parsedSshPort) || parsedSshPort <= 0) {
      setErrorMessage("SSH 端口必须是大于 0 的整数。");
      return;
    }

    testAssetConnectivity.mutate({
      ip: assetDraft.ip,
      sshPort: parsedSshPort,
    });
  }

  function saveAssetDraft() {
    const normalizedSshPort = assetDraft.sshPort.trim();
    const parsedSshPort =
      normalizedSshPort.length > 0
        ? Number.parseInt(normalizedSshPort, 10)
        : 22;

    if (!Number.isInteger(parsedSshPort) || parsedSshPort <= 0) {
      setErrorMessage("SSH 端口必须是大于 0 的整数。");
      return;
    }

    saveAsset.mutate({
      id: assetDraft.id,
      name: assetDraft.name,
      ip: assetDraft.ip,
      sshUser: assetDraft.sshUser || undefined,
      sshPort: parsedSshPort,
      roles: assetRoleTags,
      arch: assetDraft.arch || undefined,
      status:
        assetConnectionResult?.status ??
        (assetDraft.id ? assetDraft.status : "planned"),
    });
  }

  function saveProjectDraft() {
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
        targetAssetName:
          projectDraft.targetAssetName === UNASSIGNED_VALUE
            ? undefined
            : projectDraft.targetAssetName,
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

  return (
    <ModulePageShell>
      <section className="overflow-hidden rounded-[16px] border border-slate-200/95 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.045)]">
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
                CMDB
              </Badge>
              <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
                {gitlabConfigured ? "GitLab 已接入" : "GitLab 未配置"}
              </Badge>
            </div>
            <div className="space-y-1">
              <h1 className="text-[1.42rem] leading-tight font-semibold tracking-[-0.04em] text-slate-950 md:text-[1.72rem]">
                资产与发布管理
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                手动维护服务器资产、GitLab
                项目与部署流水线，面向日常运维和发布操作。
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="rounded-[10px]"
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
              className="rounded-[10px]"
              onClick={openCreateAssetDialog}
            >
              <ServerIcon data-icon="inline-start" />
              新增资产
            </Button>
            <Button
              size="sm"
              className="rounded-[10px]"
              onClick={openCreateDialog}
            >
              <PlusIcon data-icon="inline-start" />
              纳管项目
            </Button>
          </div>
        </div>

        {data ? (
          <div className="border-t border-slate-200/90 px-4 py-3 md:px-5">
            <div
              role="tablist"
              aria-label="CMDB 区域切换"
              className="inline-flex flex-wrap gap-1 rounded-[12px] bg-slate-100 p-1"
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
                      "inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:outline-none",
                      isActive
                        ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                        : "text-slate-600 hover:text-slate-950",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-[8px]",
                        isActive
                          ? "bg-slate-100 text-slate-700"
                          : "bg-transparent text-slate-500",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="font-medium">{area.label}</span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                      {area.countLabel}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {activeAreaMeta.description}
            </p>
          </div>
        ) : (
          <div className="border-t border-slate-200/90 px-4 py-3 md:px-5">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton
                  key={`cmdb-switch-skeleton-${index}`}
                  className="h-10 w-36 rounded-[10px]"
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {errorMessage ? (
        <Alert className="border-rose-200 bg-rose-50 text-rose-900">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {dashboardQuery.error ? (
        <Alert className="border-rose-200 bg-rose-50 text-rose-900">
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>CMDB 加载失败</AlertTitle>
          <AlertDescription>{dashboardQuery.error.message}</AlertDescription>
        </Alert>
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
          className="rounded-[16px] border-slate-200/95 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.045)]"
          action={
            <div className="flex flex-wrap gap-2">
              <Badge className="border border-slate-200 bg-white text-slate-700">
                已纳管 {assets.length} 台
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="rounded-[10px]"
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
            <div className="overflow-hidden rounded-[12px] border border-slate-200/90">
              <Table>
                <TableHeader className="bg-slate-50/90">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>资产</TableHead>
                    <TableHead>IP / SSH</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>架构</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">挂载服务</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((asset) => (
                    <TableRow key={asset.name}>
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
                      <TableCell>
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
          )}
        </ModuleSection>
      ) : null}

      {data && activeArea === "projects" ? (
        <ModuleSection
          id="cmdb-panel-projects"
          title="GitLab 项目管理"
          description="统一维护仓库、部署目标、健康检查和默认变量。"
          density="compact"
          className="rounded-[16px] border-slate-200/95 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.045)]"
          action={
            <div className="flex flex-wrap gap-2">
              <Badge className="border border-slate-200 bg-white text-slate-700">
                启用中 {enabledProjectTotal} / {projects.length}
              </Badge>
              {data.gitlab.baseUrl ? (
                <a
                  href={data.gitlab.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "rounded-[10px]",
                  )}
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  GitLab
                </a>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="rounded-[10px]"
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
            <div className="overflow-hidden rounded-[12px] border border-slate-200/90">
              <Table>
                <TableHeader className="bg-slate-50/90">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>项目</TableHead>
                    <TableHead>部署目标</TableHead>
                    <TableHead>位置 / 配置</TableHead>
                    <TableHead>最近发布</TableHead>
                    <TableHead>监控</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((project) => (
                    <TableRow key={project.id}>
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
                        <div>
                          {project.config?.targetAssetName ?? "未指定资产"}
                        </div>
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
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-[10px]"
                            onClick={() => openReleaseModal(project)}
                            disabled={!data.gitlab.canTriggerPipelines}
                          >
                            <RocketIcon data-icon="inline-start" />
                            发布
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            className="rounded-[10px]"
                            onClick={() => openEditDialog(project)}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            className="rounded-[10px] text-rose-700"
                            onClick={() => void handleDeleteProject(project)}
                          >
                            <Trash2Icon />
                          </Button>
                          {project.gitlabWebUrl ? (
                            <a
                              href={project.gitlabWebUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={cn(
                                buttonVariants({
                                  variant: "outline",
                                  size: "icon-sm",
                                }),
                                "rounded-[10px]",
                              )}
                            >
                              <ExternalLinkIcon />
                            </a>
                          ) : null}
                          {project.config?.monitorUrl ? (
                            <a
                              href={project.config.monitorUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={cn(
                                buttonVariants({
                                  variant: "outline",
                                  size: "icon-sm",
                                }),
                                "rounded-[10px]",
                              )}
                            >
                              <ActivityIcon />
                            </a>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
          className="rounded-[16px] border-slate-200/95 bg-white shadow-[0_10px_26px_rgba(15,23,42,0.045)]"
          action={
            <div className="flex flex-wrap gap-2">
              <Badge className="border border-slate-200 bg-white text-slate-700">
                运行中 {data.overview.runningReleaseTotal}
              </Badge>
              {projects.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-[10px]"
                  onClick={() => setActiveArea("projects")}
                >
                  <GitBranchIcon data-icon="inline-start" />
                  去项目区发起发布
                </Button>
              ) : null}
            </div>
          }
        >
          {releases.length === 0 ? (
            <CmdbEmptyState
              icon={RocketIcon}
              title="还没有发布记录"
              description="从项目管理视图触发发布后，这里会显示最近的部署记录和 Pipeline 状态。"
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
            <div className="overflow-hidden rounded-[12px] border border-slate-200/90">
              <Table>
                <TableHeader className="bg-slate-50/90">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>时间</TableHead>
                    <TableHead>项目</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead>环境</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>流水线</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {releases.map((release) => (
                    <TableRow key={release.id}>
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
                      <TableCell className="text-sm text-slate-600">
                        {release.ref}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {release.deployEnv ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn("border", releaseTone(release.status))}
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ModuleSection>
      ) : null}

      <Dialog open={assetDialogOpen} onOpenChange={setAssetDialogOpen}>
        <DialogContent
          initialFocus={false}
          className="max-w-[920px] gap-0 overflow-hidden border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
        >
          <DialogHeader className="gap-2 border-b border-slate-200/90 px-5 py-4">
            <DialogTitle>
              {assetDraft.id ? "编辑服务器资产" : "新增服务器资产"}
            </DialogTitle>
            <DialogDescription className="max-w-3xl text-sm leading-6 text-slate-600">
              维护服务器资产的基础身份、SSH
              连通性和运行画像，供项目部署目标选择与筛选使用。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-5 py-5">
            <div className="grid gap-5">
              <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-950">
                    资产身份与连通性
                  </h3>
                  <p className="text-sm leading-6 text-slate-500">
                    记录资产名称、主机地址和 SSH 信息，并在保存前确认连通性。
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
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
                    />
                  </ProjectDraftField>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,180px)_120px_140px_auto] md:items-end">
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
                    />
                  </ProjectDraftField>
                  <ProjectDraftField label="SSH 端口">
                    <Input
                      value={assetDraft.sshPort}
                      onChange={(event) =>
                        setAssetDraft((current) => ({
                          ...current,
                          sshPort: event.target.value,
                        }))
                      }
                      placeholder="22"
                    />
                  </ProjectDraftField>
                  <ProjectDraftField label="检测结果">
                    <div className="flex h-8 items-center">
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
                  </ProjectDraftField>
                  <div className="flex justify-start md:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-[10px]"
                      onClick={runAssetConnectivityTest}
                      disabled={
                        testAssetConnectivity.isPending ||
                        assetDraft.ip.trim().length === 0
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
                      测试连接
                    </Button>
                  </div>
                </div>

                <div className="rounded-[10px] bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                  {assetConnectionMessage}
                  {assetConnectionResult ? (
                    <span className="ml-2 text-slate-500">
                      · {assetConnectionResult.durationMs} ms
                    </span>
                  ) : null}
                </div>
              </section>

              <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-950">
                    运行画像
                  </h3>
                  <p className="text-sm leading-6 text-slate-500">
                    用角色标签和架构信息描述这台机器，方便后续筛选和分配部署目标。
                  </p>
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(240px,0.85fr)]">
                  <ProjectDraftField
                    label="角色标签"
                    hint="输入后按 Enter 或逗号确认，支持快速删除和常用角色补全。"
                  >
                    <div className="grid gap-3 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap gap-2">
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
                          <SelectValue placeholder="选择架构" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[12px]">
                          <SelectItem value={UNSET_ARCH_VALUE}>
                            未指定
                          </SelectItem>
                          <SelectItem value="amd64">amd64 / x86_64</SelectItem>
                          <SelectItem value="arm64">arm64 / aarch64</SelectItem>
                          <SelectItem value={CUSTOM_ARCH_VALUE}>
                            其他
                          </SelectItem>
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
          </div>

          <DialogFooter
            bleed={false}
            className="border-slate-200/90 bg-slate-50 px-5 py-4"
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
                assetDraft.name.trim().length === 0 ||
                assetDraft.ip.trim().length === 0
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
          className="max-w-[1040px] gap-0 overflow-hidden border border-slate-200/95 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.12)]"
        >
          <DialogHeader className="gap-2 border-b border-slate-200/90 px-5 py-4">
            <DialogTitle>
              {projectDraft.id ? "编辑 CMDB 项目" : "纳管 GitLab 项目"}
            </DialogTitle>
            <DialogDescription className="max-w-3xl text-sm leading-6 text-slate-600">
              先选择 GitLab
              仓库，再补齐部署目标、健康检查和默认变量。整体采用标准后台表单布局，便于快速录入和复核。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-5 py-5">
            <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
              <section className="grid content-start gap-4 self-start rounded-[12px] border border-slate-200 bg-slate-50/70 p-4 xl:sticky xl:top-0">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-950">
                    GitLab 仓库
                  </h3>
                  <p className="text-sm leading-6 text-slate-500">
                    {data?.gitlab.canBrowseCatalog
                      ? "先搜索并选择仓库，减少手动输入错误。"
                      : "未配置 API Token 时，仅支持手动输入 group/project。"}
                  </p>
                </div>

                {data?.gitlab.baseUrl ? (
                  <Badge className="w-fit border border-slate-200 bg-white text-slate-700">
                    {data.gitlab.baseUrl}
                  </Badge>
                ) : null}

                <ProjectDraftField label="搜索仓库">
                  <Input
                    value={gitlabSearch}
                    onChange={(event) => setGitlabSearch(event.target.value)}
                    placeholder="搜索 GitLab 项目，或直接输入 group/project"
                  />
                </ProjectDraftField>

                {data?.gitlab.canBrowseCatalog ? (
                  gitlabCatalogQuery.isLoading ? (
                    <div className="grid gap-2">
                      {Array.from({ length: 2 }).map((_, index) => (
                        <Skeleton
                          key={`gitlab-candidate-${index}`}
                          className="h-11 rounded-[10px]"
                        />
                      ))}
                    </div>
                  ) : gitlabCatalogItems.length > 0 ? (
                    <div className="grid gap-2 rounded-[10px] border border-slate-200 bg-white p-2">
                      {gitlabCatalogItems.slice(0, 6).map((item) => {
                        const active = projectDraft.gitlabPath === item.path;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              applyGitLabCandidate(item);
                              setGitlabSearch(item.path);
                            }}
                            className={cn(
                              "grid gap-1 rounded-[10px] border px-3 py-2 text-left transition",
                              active
                                ? "border-sky-300 bg-sky-50"
                                : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-slate-950">
                                {item.name}
                              </span>
                              {active ? (
                                <Badge className="border border-sky-200 bg-white text-sky-700">
                                  已选中
                                </Badge>
                              ) : null}
                            </div>
                            <span className="text-[12px] text-slate-500">
                              {item.path}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                      没有找到匹配的 GitLab 项目，可以直接在右侧手动录入
                      `group/project`。
                    </div>
                  )
                ) : (
                  <Alert className="border-slate-200 bg-white text-slate-800">
                    <AlertTriangleIcon className="size-4" />
                    <AlertTitle>GitLab 目录浏览不可用</AlertTitle>
                    <AlertDescription>
                      配置 `GITLAB_API_TOKEN` 后，这里会显示最近访问的 GitLab
                      仓库列表。
                    </AlertDescription>
                  </Alert>
                )}

                <div className="rounded-[10px] border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-medium tracking-[0.16em] text-slate-500 uppercase">
                    当前仓库
                  </p>
                  {selectedRepoSummary ? (
                    <div className="mt-3 grid gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-slate-950">
                          {selectedRepoSummary.name}
                        </span>
                        <Badge className="border border-slate-200 bg-slate-50 text-slate-700">
                          {selectedRepoSummary.defaultBranch}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600">
                        {selectedRepoSummary.path}
                      </p>
                      <p className="text-sm leading-6 text-slate-500">
                        {selectedRepoSummary.description ||
                          "已选仓库信息会自动回填到右侧表单。"}
                      </p>
                      {selectedRepoSummary.webUrl ? (
                        <a
                          href={selectedRepoSummary.webUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900"
                        >
                          查看 GitLab 项目
                          <ExternalLinkIcon className="size-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      先搜索仓库，再从候选列表中选择项目。
                    </p>
                  )}
                </div>
              </section>

              <div className="grid gap-5">
                <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-950">
                      基础信息
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      填写项目名称、路径和基础说明，便于后续检索和运维交接。
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
                          <SelectItem value="true">启用</SelectItem>
                          <SelectItem value="false">禁用</SelectItem>
                        </SelectContent>
                      </Select>
                    </ProjectDraftField>
                  </div>

                  <ProjectDraftField
                    label="GitLab 路径"
                    hint="格式为 group/project，也支持自动回填后继续手工修改。"
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

                  <div className="grid gap-4 md:grid-cols-2">
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
                </section>

                <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-950">
                      部署配置
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      将部署目标、目标资产和运行参数放在一组，方便保存前统一检查。
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
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
                            {draftDeployTargetLabel(projectDraft.deployTarget)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-[12px]">
                          <SelectItem value="k8s">Kubernetes</SelectItem>
                          <SelectItem value="ssh">SSH</SelectItem>
                          <SelectItem value="docker">Docker</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </ProjectDraftField>
                    <ProjectDraftField label="目标资产">
                      <Select
                        value={projectDraft.targetAssetName}
                        onValueChange={(value) => {
                          if (!value) return;
                          setProjectDraft((current) => ({
                            ...current,
                            targetAssetName: value,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-full rounded-[10px]">
                          <SelectValue placeholder="选择资产">
                            {targetAssetLabel(projectDraft.targetAssetName)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-[12px]">
                          <SelectItem value={UNASSIGNED_VALUE}>
                            未指定资产
                          </SelectItem>
                          {assets.map((asset) => (
                            <SelectItem
                              key={`cmdb-asset-${asset.name}`}
                              value={asset.name}
                            >
                              {asset.name} ({asset.ip})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ProjectDraftField>
                    <ProjectDraftField
                      label="Trigger Token"
                      hint="可选；未配置则使用全局 GitLab API Token。"
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <ProjectDraftField label="部署路径">
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
                      <ProjectDraftField label="部署命令">
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
                  ) : null}
                </section>

                <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-950">
                      运行与观测
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      健康检查和监控面板单独成组，避免与部署参数混排。
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

                <section className="grid gap-4 rounded-[12px] border border-slate-200 bg-white p-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-950">
                      默认流水线变量
                    </h3>
                    <p className="text-sm leading-6 text-slate-500">
                      每行一个
                      `KEY=VALUE`，用于注入默认流水线变量，发布时仍可追加覆盖。
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
              </div>
            </div>
          </div>

          <DialogFooter
            bleed={false}
            className="border-slate-200/90 bg-slate-50 px-5 py-4"
          >
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
              disabled={
                saveProject.isPending ||
                projectDraft.gitlabPath.trim().length === 0
              }
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
              当前发布将直接触发 GitLab Pipeline，并自动注入部署目标和默认变量。
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

      {confirmDialog}
    </ModulePageShell>
  );
}
