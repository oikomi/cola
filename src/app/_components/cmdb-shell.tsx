"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  BoxesIcon,
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
} from "lucide-react";
import { type ReactNode, useDeferredValue, useState } from "react";

import {
  ModuleEmptyState,
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
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

function emptyReleaseDraft(): ReleaseDraft {
  return {
    projectName: "",
    ref: "main",
    deployEnv: "prod",
    variablesText: "",
  };
}

function serializeVariables(variables: Record<string, string> | null | undefined) {
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

function GitLabCandidateCard(props: {
  item: GitLabCatalogRow;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onPick}
      className={cn(
        "grid gap-1 rounded-[18px] border px-4 py-3 text-left transition",
        props.active
          ? "border-sky-300 bg-sky-50 shadow-[0_16px_34px_rgba(56,189,248,0.08)]"
          : "border-slate-200/90 bg-white hover:border-sky-200 hover:bg-slate-50",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-950">{props.item.name}</span>
        <GitBranchIcon className="size-4 text-slate-400" />
      </div>
      <p className="text-[12px] text-slate-600">{props.item.path}</p>
      <p className="line-clamp-2 text-[12px] leading-5 text-slate-500">
        {props.item.description ?? "GitLab 项目元数据可直接带入默认分支和描述。"}
      </p>
    </button>
  );
}

function LoadingBlock() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`cmdb-metric-${index}`} className="h-32 rounded-[24px]" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-[28px]" />
      <Skeleton className="h-[340px] rounded-[28px]" />
      <Skeleton className="h-[300px] rounded-[28px]" />
    </div>
  );
}

export function CmdbShell() {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(emptyProjectDraft);
  const [releaseDraft, setReleaseDraft] = useState<ReleaseDraft>(emptyReleaseDraft);
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
        projectDialogOpen && Boolean(dashboardQuery.data?.gitlab.canBrowseCatalog),
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
  const gitlabConfigured = Boolean(data?.gitlab.baseUrl);
  const monitorRate =
    data && data.overview.monitoredProjectTotal > 0
      ? Math.round(
          (data.overview.healthyProjectTotal / data.overview.monitoredProjectTotal) *
            100,
        )
      : 0;

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
      <ModuleHero
        eyebrow="CMDB"
        title="服务器资产、GitLab 项目和代码部署统一纳管"
        description="把 K8s 节点资产、GitLab 仓库、部署目标和运行监控拉到同一视图里。当前资产从 infra/k8s 清单自动汇总，发布动作直接走 GitLab Pipeline。"
        icon={BoxesIcon}
        actions={
          <>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => void dashboardQuery.refetch()}
              disabled={dashboardQuery.isFetching}
            >
              {dashboardQuery.isFetching ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              刷新状态
            </Button>
            <Button className="rounded-full" onClick={openCreateDialog}>
              <PlusIcon data-icon="inline-start" />
              纳管项目
            </Button>
          </>
        }
        badges={
          <>
            <Badge className="border border-slate-200 bg-white/88 text-slate-700">
              {data?.cluster.clusterName ? `集群 ${data.cluster.clusterName}` : "K8s"}
            </Badge>
            <Badge className="border border-slate-200 bg-white/88 text-slate-700">
              {gitlabConfigured ? "GitLab 已接入" : "GitLab 未配置"}
            </Badge>
          </>
        }
      >
        {data ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ModuleMetricCard
              label="服务器资产"
              value={String(data.overview.assetTotal)}
              description={`已接入 ${data.overview.connectedAssetTotal} 台，GPU 节点 ${data.overview.gpuAssetTotal} 台。`}
              icon={ServerIcon}
            />
            <ModuleMetricCard
              label="纳管项目"
              value={String(data.overview.projectTotal)}
              description={`其中 ${data.overview.monitoredProjectTotal} 个项目配置了健康检查。`}
              icon={GitBranchIcon}
            />
            <ModuleMetricCard
              label="发布队列"
              value={String(data.overview.runningReleaseTotal)}
              description={`失败发布 ${data.overview.failedReleaseTotal} 次，可在下方追踪最近流水线。`}
              icon={RocketIcon}
            />
            <ModuleMetricCard
              label="监控健康率"
              value={`${monitorRate}%`}
              description={
                data.overview.monitoredProjectTotal > 0
                  ? `${data.overview.healthyProjectTotal}/${data.overview.monitoredProjectTotal} 项健康检查通过。`
                  : "当前还没有配置健康检查地址。"
              }
              icon={ActivityIcon}
            />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`cmdb-top-skeleton-${index}`} className="h-32 rounded-[24px]" />
            ))}
          </div>
        )}
      </ModuleHero>

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

      {!dashboardQuery.data && dashboardQuery.isLoading ? <LoadingBlock /> : null}

      {data ? (
        <>
          {!gitlabConfigured ? (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>GitLab 还没打通</AlertTitle>
              <AlertDescription>
                先在环境变量里配置 `GITLAB_URL`。如果还希望在页面里搜索仓库和回填实时流水线状态，再补上 `GITLAB_API_TOKEN`。
              </AlertDescription>
            </Alert>
          ) : !data.gitlab.hasApiToken ? (
            <Alert className="border-sky-200 bg-sky-50 text-sky-900">
              <CheckCircle2Icon className="size-4" />
              <AlertTitle>GitLab 地址已接入</AlertTitle>
              <AlertDescription>
                当前已可通过项目级 Trigger Token 触发发布，但没有 `GITLAB_API_TOKEN` 时，无法浏览仓库目录，也无法自动刷新流水线状态。
              </AlertDescription>
            </Alert>
          ) : null}

          <ModuleSection
            title="服务器资产"
            description="资产视图直接来自 infra/k8s/cluster/nodes.json 和运行期 cluster-summary，不暴露 SSH 密码，只展示纳管必需信息。"
            action={
              data.cluster.controllerIp ? (
                <Badge className="border border-slate-200 bg-white text-slate-700">
                  Controller {data.cluster.controllerIp}
                </Badge>
              ) : null
            }
          >
            {assets.length === 0 ? (
              <ModuleEmptyState
                title="还没有可展示的服务器资产"
                description="请先完善 infra/k8s/cluster/nodes.json，或生成 runtime/generated/cluster-summary.json 后再刷新。"
              />
            ) : (
              <div className="overflow-hidden rounded-[24px] border border-slate-200/90">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>节点</TableHead>
                      <TableHead>IP / SSH</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>架构</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">挂载服务</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => (
                      <TableRow key={asset.name}>
                        <TableCell>
                          <div className="grid gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-950">{asset.name}</span>
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
                          <Badge className={cn("border", assetStatusTone(asset.status))}>
                            {assetStatusLabel(asset.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium text-slate-700">
                          {asset.attachedProjectCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </ModuleSection>

          <ModuleSection
            title="代码部署项目"
            description="每个项目绑定 GitLab 仓库、部署目标和健康检查。发布时会把目标信息注入到 GitLab Pipeline 变量。"
            action={
              <div className="flex flex-wrap gap-2">
                {data.gitlab.baseUrl ? (
                  <a
                    href={data.gitlab.baseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    GitLab
                  </a>
                ) : null}
                <Button variant="outline" size="sm" className="rounded-full" onClick={openCreateDialog}>
                  <PlusIcon data-icon="inline-start" />
                  纳管项目
                </Button>
              </div>
            }
          >
            {projects.length === 0 ? (
              <ModuleEmptyState
                title="还没有纳管任何 GitLab 项目"
                description="点击右上角“纳管项目”，录入 group/project、部署目标、健康检查地址和自定义变量。"
                action={
                  <Button className="rounded-full" onClick={openCreateDialog}>
                    <PlusIcon data-icon="inline-start" />
                    新建项目
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-[24px] border border-slate-200/90">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                              <span className="font-medium text-slate-950">{project.name}</span>
                              {!project.enabled ? (
                                <Badge className="border border-slate-200 bg-slate-100 text-slate-700">
                                  已禁用
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-sm text-slate-600">{project.gitlabPath}</div>
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
                          <div>{project.config?.targetAssetName ?? "共享集群"}</div>
                          <div>
                            {project.deployTarget === "k8s"
                              ? `${project.config?.k8sNamespace ?? "default"} / ${project.config?.k8sDeployment ?? "-"}`
                              : project.deployTarget === "docker"
                                ? project.config?.dockerImage ?? "-"
                                : project.config?.sshPath ?? "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {project.latestRelease ? (
                            <div className="grid gap-1">
                              <div className="flex items-center gap-2">
                                <Badge className={cn("border", releaseTone(project.latestRelease.status))}>
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
                            <span className="text-sm text-slate-500">暂无发布</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="grid gap-1">
                            <Badge className={cn("w-fit border", monitorTone(project.monitor.status))}>
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
                              className="rounded-full"
                              onClick={() => openReleaseModal(project)}
                              disabled={!data.gitlab.canTriggerPipelines}
                            >
                              <RocketIcon data-icon="inline-start" />
                              发布
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              className="rounded-full"
                              onClick={() => openEditDialog(project)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              className="rounded-full text-rose-700"
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
                                  buttonVariants({ variant: "outline", size: "icon-sm" }),
                                  "rounded-full",
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
                                  buttonVariants({ variant: "outline", size: "icon-sm" }),
                                  "rounded-full",
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

          <ModuleSection
            title="最近发布"
            description="这里展示最近 12 次 GitLab Pipeline 触发记录，可快速回看 ref、环境、状态和跳转链接。"
          >
            {releases.length === 0 ? (
              <ModuleEmptyState
                title="还没有发布记录"
                description="为某个纳管项目点击“发布”后，这里会出现对应的 Pipeline 追踪信息。"
              />
            ) : (
              <div className="overflow-hidden rounded-[24px] border border-slate-200/90">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </ModuleSection>
        </>
      ) : null}

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{projectDraft.id ? "编辑 CMDB 项目" : "纳管 GitLab 项目"}</DialogTitle>
            <DialogDescription>
              录入 GitLab 仓库、部署目标、运行健康检查和自定义变量。保存时会优先从 GitLab 拉取仓库元数据。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-2">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="grid gap-4 rounded-[24px] border border-slate-200/85 bg-slate-50/90 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">GitLab 仓库</h3>
                    <p className="text-xs leading-5 text-slate-500">
                      {data?.gitlab.canBrowseCatalog
                        ? "可直接从最近活跃仓库列表挑选。"
                        : "未配置 API Token 时，仅支持手动输入 group/project。"}
                    </p>
                  </div>
                  {data?.gitlab.baseUrl ? (
                    <Badge className="border border-slate-200 bg-white text-slate-700">
                      {data.gitlab.baseUrl}
                    </Badge>
                  ) : null}
                </div>

                <ProjectDraftField label="搜索仓库">
                  <Input
                    value={gitlabSearch}
                    onChange={(event) => setGitlabSearch(event.target.value)}
                    placeholder="搜索 GitLab 项目，或直接输入 group/project"
                  />
                </ProjectDraftField>

                {data?.gitlab.canBrowseCatalog ? (
                  <div className="grid max-h-[260px] gap-3 overflow-y-auto">
                    {gitlabCatalogQuery.isLoading ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <Skeleton
                          key={`gitlab-candidate-${index}`}
                          className="h-24 rounded-[18px]"
                        />
                      ))
                    ) : (gitlabCatalogQuery.data ?? []).length > 0 ? (
                      (gitlabCatalogQuery.data ?? []).map((item) => (
                        <GitLabCandidateCard
                          key={item.id}
                          item={item}
                          active={projectDraft.gitlabPath === item.path}
                          onPick={() => applyGitLabCandidate(item)}
                        />
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                        没有找到匹配的 GitLab 项目，可以直接在右侧手动录入。
                      </div>
                    )}
                  </div>
                ) : (
                  <Alert className="border-slate-200 bg-white text-slate-800">
                    <AlertTriangleIcon className="size-4" />
                    <AlertTitle>GitLab 目录浏览不可用</AlertTitle>
                    <AlertDescription>
                      配置 `GITLAB_API_TOKEN` 后，这里会显示最近访问的 GitLab 仓库列表。
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="grid gap-4 rounded-[24px] border border-slate-200/85 bg-white p-4">
                <div className="grid gap-4 md:grid-cols-2">
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
                  <ProjectDraftField label="GitLab 路径" hint="格式为 group/project">
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
                  />
                </ProjectDraftField>

                <div className="grid gap-4 md:grid-cols-3">
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
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="k8s">Kubernetes</SelectItem>
                        <SelectItem value="ssh">SSH</SelectItem>
                        <SelectItem value="docker">Docker</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
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
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">启用</SelectItem>
                        <SelectItem value="false">禁用</SelectItem>
                      </SelectContent>
                    </Select>
                  </ProjectDraftField>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <ProjectDraftField label="目标服务器">
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
                      <SelectTrigger>
                        <SelectValue placeholder="选择节点" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED_VALUE}>共享集群 / 未指定</SelectItem>
                        {assets.map((asset) => (
                          <SelectItem key={`cmdb-asset-${asset.name}`} value={asset.name}>
                            {asset.name} ({asset.ip})
                          </SelectItem>
                        ))}
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
                  <ProjectDraftField label="Trigger Token" hint="可选；未配置则使用全局 GitLab API Token">
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

                <ProjectDraftField
                  label="自定义变量"
                  hint="每行一个 KEY=VALUE，会作为默认流水线变量注入。"
                >
                  <Textarea
                    value={projectDraft.customVariablesText}
                    onChange={(event) =>
                      setProjectDraft((current) => ({
                        ...current,
                        customVariablesText: event.target.value,
                      }))
                    }
                    placeholder={"APP_NAME=cola\nNODE_ENV=production"}
                    className="min-h-[120px]"
                  />
                </ProjectDraftField>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={saveProjectDraft}
              disabled={saveProject.isPending || projectDraft.gitlabPath.trim().length === 0}
            >
              {saveProject.isPending ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
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
            <Button variant="outline" onClick={() => setReleaseDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={triggerReleaseDraftAction}
              disabled={triggerRelease.isPending || !releaseDraft.projectId}
            >
              {triggerRelease.isPending ? (
                <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
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
