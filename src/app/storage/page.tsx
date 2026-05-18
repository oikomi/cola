import {
  ArchiveIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Code2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  FilesIcon,
  HardDriveIcon,
  KeyRoundIcon,
  NetworkIcon,
  PackageIcon,
  RouteIcon,
  Settings2Icon,
  TerminalIcon,
  UploadCloudIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import clusterConfig from "../../../infra/k8s/cluster/config.json";
import clusterNodes from "../../../infra/k8s/cluster/nodes.json";
import {
  ModuleHero,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_NAMESPACE = "storage";
const SEAWEEDFS_SERVICE = "seaweedfs-s3";
const SEAWEEDFS_FILER_SERVICE = "seaweedfs-filer";
const SEAWEEDFS_PORT = "8333";
const SEAWEEDFS_FILER_PORT = "8888";
const SEAWEEDFS_ADMIN_NODE_PORT = "32246";
const SEAWEEDFS_S3_NODE_PORT = "32247";
const SEAWEEDFS_FUSE_IMAGE = "chrislusf/seaweedfs:4.23";
const DEFAULT_BUCKET = "xdream";
const SEAWEEDFS_DATA_ROOT = "/var/lib/cola/seaweedfs";
const SEAWEEDFS_VOLUME_ROOT = `${SEAWEEDFS_DATA_ROOT}/volume`;
const INTERNAL_ENDPOINT = `http://${SEAWEEDFS_SERVICE}.${STORAGE_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_PORT}`;
const INTERNAL_FILER_ENDPOINT = `${SEAWEEDFS_FILER_SERVICE}.${STORAGE_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_FILER_PORT}`;
const DEFAULT_BUCKET_FILER_PATH = `/buckets/${DEFAULT_BUCKET}`;
const TRAINING_WORKDIR = "/shared-dist-storage";
const TRAINING_DATASET_DIR = `${TRAINING_WORKDIR}/datasets`;
const TRAINING_CHECKPOINT_DIR = `${TRAINING_WORKDIR}/checkpoints`;
const TRAINING_MODEL_DIR = `${TRAINING_WORKDIR}/models`;
const TRAINING_OUTPUT_ROOT = `${TRAINING_WORKDIR}/cola-training`;

const clusterNodeNames = clusterNodes
  .map((node) => node.name)
  .filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );

type StepItem = {
  title: string;
  description: string;
};

type FactItem = {
  label: string;
  value: string;
};

type RouteNode = {
  label: string;
  value: string;
  icon: LucideIcon;
};

export default function StoragePage() {
  const namespace =
    typeof clusterConfig.workspaceNamespace === "string" &&
    clusterConfig.workspaceNamespace.trim().length > 0
      ? clusterConfig.workspaceNamespace.trim()
      : "remote-work";
  const controllerIp =
    typeof clusterConfig.controllerIp === "string" &&
    clusterConfig.controllerIp.trim().length > 0
      ? clusterConfig.controllerIp.trim()
      : "172.16.60.198";
  const clusterName =
    typeof clusterConfig.clusterName === "string" &&
    clusterConfig.clusterName.trim().length > 0
      ? clusterConfig.clusterName.trim()
      : "xdream-cloud";
  const kubernetesVersion =
    typeof clusterConfig.kubernetesVersion === "string" &&
    clusterConfig.kubernetesVersion.trim().length > 0
      ? clusterConfig.kubernetesVersion.trim()
      : "1.34";
  const adminUiUrl = `http://${controllerIp}:${SEAWEEDFS_ADMIN_NODE_PORT}`;
  const lanS3Endpoint = `http://${controllerIp}:${SEAWEEDFS_S3_NODE_PORT}`;
  const nodeSummary = clusterNodeNames.join(" / ") || "master-01 / node-01";
  const lanUploadExample = `# 在局域网应用服务器或开发机上执行，不需要进 Kubernetes 集群。
# endpoint 来自 infra/k8s/cluster/config.json 的 controllerIp + SeaweedFS NodePort。
export AWS_ENDPOINT_URL="${lanS3Endpoint}"
export AWS_ACCESS_KEY_ID="从 infra/seaweedfs/seaweedfs.env 读取"
export AWS_SECRET_ACCESS_KEY="从 infra/seaweedfs/seaweedfs.env 读取"
export AWS_DEFAULT_REGION="us-east-1"
export COLA_BUCKET="${DEFAULT_BUCKET}"

aws --endpoint-url "$AWS_ENDPOINT_URL" s3 cp \\
  ./dataset.jsonl "s3://$COLA_BUCKET/datasets/dataset.jsonl"

aws --endpoint-url "$AWS_ENDPOINT_URL" s3 ls \\
  "s3://$COLA_BUCKET/datasets/"`;
  const appUploadExample = `# 外部局域网应用上传时只要按 S3 API 写入约定前缀。
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="${lanS3Endpoint}",
    aws_access_key_id="从 infra/seaweedfs/seaweedfs.env 读取",
    aws_secret_access_key="从 infra/seaweedfs/seaweedfs.env 读取",
    region_name="us-east-1",
)

s3.upload_file(
    "dataset.jsonl",
    "${DEFAULT_BUCKET}",
    "datasets/my-app/dataset.jsonl",
)`;
  const internalMountExample = `# 平台创建远程桌面、训练 Job、JupyterLab、Unsloth Studio 时自动完成。
# 业务容器启动后，把 SeaweedFS Filer 路径挂成本地目录：
COLA_SEAWEEDFS_FILER="${INTERNAL_FILER_ENDPOINT}"
COLA_SEAWEEDFS_FILER_PATH="${DEFAULT_BUCKET_FILER_PATH}"
COLA_SEAWEEDFS_MOUNT_DIR="${TRAINING_WORKDIR}"

# 容器里的业务代码直接按本地文件系统使用：
ls ${TRAINING_WORKDIR}
python train.py \\
  --data ${TRAINING_DATASET_DIR}/my-app/dataset.jsonl \\
  --output ${TRAINING_CHECKPOINT_DIR}/run-001

# 训练平台默认产物根目录：
${TRAINING_OUTPUT_ROOT}/<job-id>/<runtime-job-name>`;
  const fallbackExample = `# 默认走 SeaweedFS FUSE。如需临时切换，必须先关闭自动挂载。
COLA_SEAWEEDFS_MOUNT_ENABLED=false

# 方案 A：节点已经预挂载共享目录。
COLA_TRAINING_WORKDIR_HOST_PATH=/mnt/cola-training
COLA_TRAINING_WORKDIR_MOUNT_PATH=${TRAINING_WORKDIR}

# 方案 B：已有可用 PVC。只部署 infra/seaweedfs 不会创建 PVC。
COLA_TRAINING_PVC_NAME=cola-training-workspace
COLA_TRAINING_PVC_MOUNT_PATH=${TRAINING_WORKDIR}`;

  return (
    <ModulePageShell className="gap-4">
      <ModuleHero
        eyebrow="Storage Ops"
        title="存储管理"
        description="外部应用通过 SeaweedFS S3 NodePort 上传数据；集群内部工作负载通过 Filer/FUSE 把同一份 bucket 挂成本地目录。"
        icon={DatabaseIcon}
        badges={
          <>
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              SeaweedFS S3
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {clusterName}
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {STORAGE_NAMESPACE}
            </Badge>
          </>
        }
        actions={
          <a
            href={adminUiUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ size: "sm" }), "h-8 gap-1.5")}
          >
            <ExternalLinkIcon className="size-3.5" />
            打开 Admin UI
          </a>
        }
        density="dense"
        size="compact"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <StorageRouteMap
            external={[
              { label: "外部应用", value: "S3 API", icon: UploadCloudIcon },
              {
                label: "NodePort",
                value: `:${SEAWEEDFS_S3_NODE_PORT}`,
                icon: NetworkIcon,
              },
              {
                label: "S3 gateway",
                value: SEAWEEDFS_SERVICE,
                icon: RouteIcon,
              },
              { label: "Bucket", value: DEFAULT_BUCKET, icon: ArchiveIcon },
            ]}
            internal={[
              { label: "业务 Pod", value: "训练 / 桌面", icon: PackageIcon },
              {
                label: "Filer",
                value: `:${SEAWEEDFS_FILER_PORT}`,
                icon: DatabaseIcon,
              },
              { label: "FUSE", value: "自动挂载", icon: Settings2Icon },
              {
                label: "本地目录",
                value: TRAINING_WORKDIR,
                icon: HardDriveIcon,
              },
            ]}
          />
          <StorageSummaryPanel
            title="当前参数"
            facts={[
              ["LAN S3", lanS3Endpoint],
              ["Pod S3", INTERNAL_ENDPOINT],
              ["Filer", INTERNAL_FILER_ENDPOINT],
              ["Mount", TRAINING_WORKDIR],
            ]}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        title="外部上传"
        description="局域网应用只关心 S3 endpoint、bucket、凭据和对象前缀。"
        density="compact"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
            <FlowCard
              icon={NetworkIcon}
              title="入口约定"
              description="可信局域网应用 -> Kubernetes NodePort -> SeaweedFS S3 gateway -> xdream bucket。"
              facts={[
                ["LAN endpoint", lanS3Endpoint],
                ["Bucket", DEFAULT_BUCKET],
                [
                  "推荐前缀",
                  "datasets/<source>/..., checkpoints/..., models/...",
                ],
                ["凭据来源", "infra/seaweedfs/seaweedfs.env"],
              ]}
            />
            <StepList
              label="Upload Runbook"
              steps={[
                {
                  title: "打通网络",
                  description: `外部机器先确认能访问 ${controllerIp}:${SEAWEEDFS_S3_NODE_PORT}。不通时优先查节点防火墙、交换机 ACL 和 seaweedfs-s3-nodeport Service。`,
                },
                {
                  title: "配置 S3 凭据",
                  description:
                    "从 infra/seaweedfs/seaweedfs.env 读取 SEAWEEDFS_S3_ACCESS_KEY 和 SEAWEEDFS_S3_SECRET_KEY，不把凭据写进前端页面或代码仓库。",
                },
                {
                  title: "写入约定前缀",
                  description: `数据集放 s3://${DEFAULT_BUCKET}/datasets/...，模型放 models/...，训练归档和 checkpoint 放 checkpoints/...。`,
                },
              ]}
            />
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <StorageExampleCard
              title="命令行导入"
              status="局域网机器直接通过 S3 NodePort 上传数据集。"
              icon={TerminalIcon}
              code={lanUploadExample}
            />
            <StorageExampleCard
              title="应用代码导入"
              status="外部服务按 S3 SDK 写入 SeaweedFS。"
              icon={Code2Icon}
              code={appUploadExample}
            />
          </div>
        </div>
      </ModuleSection>

      <ModuleSection
        title="内部挂载"
        description="平台在 Pod 启动时完成 SeaweedFS Filer/FUSE 挂载，业务容器按本地文件路径读写。"
        density="compact"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="grid gap-3 md:grid-cols-2">
            <StorageBindingCard
              title="远程工作区"
              status="桌面容器启动时挂载共享目录"
              icon={FilesIcon}
              rows={[
                ["启用变量", "REMOTE_WORKSPACE_SEAWEEDFS_MOUNT_ENABLED"],
                ["默认目录", TRAINING_WORKDIR],
                [
                  "回退配置",
                  "REMOTE_WORKSPACE_WORKDIR_HOST_PATH / REMOTE_WORKSPACE_PVC_NAME",
                ],
              ]}
            />
            <StorageBindingCard
              title="训练任务"
              status="训练脚本按本地文件路径读写"
              icon={CheckCircle2Icon}
              rows={[
                ["启用变量", "COLA_TRAINING_SEAWEEDFS_MOUNT_ENABLED"],
                ["数据集", TRAINING_DATASET_DIR],
                ["checkpoint", TRAINING_CHECKPOINT_DIR],
                ["模型目录", TRAINING_MODEL_DIR],
                ["产物根目录", TRAINING_OUTPUT_ROOT],
              ]}
            />
            <StorageBindingCard
              title="JupyterLab"
              status="Notebook 里看到同一个共享目录"
              icon={PackageIcon}
              rows={[
                ["启用变量", "COLA_JUPYTERLAB_SEAWEEDFS_MOUNT_ENABLED"],
                ["目录覆盖", "COLA_JUPYTERLAB_WORKDIR_MOUNT_PATH"],
                ["用途", "上传数据、调试脚本、查看训练产物"],
              ]}
            />
            <StorageBindingCard
              title="Unsloth Studio"
              status="模型导出和调试产物写入共享目录"
              icon={Settings2Icon}
              rows={[
                ["启用变量", "COLA_UNSLOTH_STUDIO_SEAWEEDFS_MOUNT_ENABLED"],
                ["目录覆盖", "COLA_UNSLOTH_STUDIO_WORKDIR_MOUNT_PATH"],
                [
                  "PVC 回退",
                  "COLA_UNSLOTH_STUDIO_PVC_NAME / COLA_TRAINING_PVC_NAME",
                ],
              ]}
            />
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <FlowCard
              icon={HardDriveIcon}
              title="挂载机制"
              description="平台给业务 Pod 注入 init container、/dev/fuse、fusermount 和挂载脚本；业务命令执行前先完成挂载。"
              facts={[
                ["ClusterIP S3", INTERNAL_ENDPOINT],
                ["Filer", INTERNAL_FILER_ENDPOINT],
                ["Filer path", DEFAULT_BUCKET_FILER_PATH],
                ["FUSE image", SEAWEEDFS_FUSE_IMAGE],
                ["默认缓存", "/var/cache/seaweedfs"],
                ["默认权限", "root + SYS_ADMIN + /dev/fuse"],
              ]}
            />
            <StorageExampleCard
              title="容器内看到的路径"
              status="业务代码只依赖本地路径，不需要拼 S3 URL。"
              icon={HardDriveIcon}
              code={internalMountExample}
            />
            <StorageExampleCard
              title="临时回退方式"
              status="关闭自动 FUSE 后，才会使用节点 hostPath 或 PVC。"
              icon={TerminalIcon}
              code={fallbackExample}
            />
          </div>
        </div>
      </ModuleSection>

      <ModuleSection
        title="运维边界"
        description="这些信息用于判断当前存储能不能稳定承载训练数据，不是业务侧上传或挂载的主流程。"
        density="compact"
      >
        <div className="grid gap-3 xl:grid-cols-3">
          <StorageBindingCard
            title="当前集群"
            status="页面信息来自 infra/k8s/cluster"
            icon={DatabaseIcon}
            rows={[
              ["集群", clusterName],
              ["Kubernetes", kubernetesVersion],
              ["工作 namespace", namespace],
              ["控制节点", controllerIp],
              ["节点", nodeSummary],
            ]}
          />
          <StorageBindingCard
            title="SeaweedFS 部署"
            status="infra/seaweedfs 只部署对象存储"
            icon={ArchiveIcon}
            rows={[
              ["Namespace", STORAGE_NAMESPACE],
              ["S3 Service", `${SEAWEEDFS_SERVICE}:${SEAWEEDFS_PORT}`],
              ["Admin UI", adminUiUrl],
              ["数据根目录", SEAWEEDFS_DATA_ROOT],
              ["Volume hostPath", SEAWEEDFS_VOLUME_ROOT],
            ]}
          />
          <StorageBindingCard
            title="边界说明"
            status="避免把对象存储和 PVC 混在一起"
            icon={KeyRoundIcon}
            rows={[
              ["默认模式", "SeaweedFS FUSE 本地挂载"],
              ["PVC", "infra/seaweedfs 不创建 PVC"],
              ["独立数据盘", "当前节点信息未声明独立数据盘"],
              ["公网暴露", "不建议；NodePort 只给可信局域网"],
            ]}
          />
        </div>
      </ModuleSection>
    </ModulePageShell>
  );
}

function StorageRouteMap({
  external,
  internal,
}: {
  external: RouteNode[];
  internal: RouteNode[];
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-slate-200/90 bg-slate-50/75 p-3.5 shadow-[0_1px_0_rgba(15,23,42,0.035)]">
      <div className="grid gap-3 lg:grid-cols-2">
        <StoragePathLine title="外部上传路径" tone="emerald" nodes={external} />
        <StoragePathLine title="内部挂载路径" tone="sky" nodes={internal} />
      </div>
    </div>
  );
}

function StoragePathLine({
  title,
  tone,
  nodes,
}: {
  title: string;
  tone: "emerald" | "sky";
  nodes: RouteNode[];
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200/80 bg-emerald-50/60 text-emerald-700 ring-emerald-100"
      : "border-sky-200/80 bg-sky-50/60 text-sky-700 ring-sky-100";

  return (
    <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white p-3.5">
      <p className="text-[12px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
        {title}
      </p>
      <div className="mt-3 grid gap-2">
        {nodes.map((node, index) => (
          <div
            key={`${node.label}-${node.value}`}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2"
          >
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-[8px] border ring-1",
                toneClass,
              )}
            >
              <node.icon className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] leading-4 font-medium text-slate-500">
                {node.label}
              </p>
              <p className="truncate font-mono text-[12px] leading-5 font-semibold text-slate-900">
                {node.value}
              </p>
            </div>
            {index < nodes.length - 1 ? (
              <span className="text-[13px] text-slate-300">{"->"}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StorageSummaryPanel({
  title,
  facts,
}: {
  title: string;
  facts: Array<[string, string]>;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-4 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.035)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
          {title}
        </p>
        <div className="flex size-7 items-center justify-center rounded-[8px] bg-slate-100 text-slate-600 ring-1 ring-slate-200">
          <DatabaseIcon className="size-3.5" />
        </div>
      </div>
      <dl className="mt-3 grid gap-2">
        {facts.map(([label, value]) => (
          <StorageFact
            key={label}
            label={label}
            value={value}
            compact
            stacked
          />
        ))}
      </dl>
    </div>
  );
}

function FlowCard({
  icon: Icon,
  title,
  description,
  facts,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  facts: Array<[string, string]>;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-emerald-200/80 bg-emerald-50/45 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-white text-emerald-700 ring-1 ring-emerald-100">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-[13px] leading-5 text-slate-600">
            {description}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid gap-2">
        {facts.map(([label, value]) => (
          <StorageFact key={label} label={label} value={value} compact />
        ))}
      </dl>
    </div>
  );
}

function StepList({ label, steps }: { label: string; steps: StepItem[] }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.035)]">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
        {label}
      </p>
      <div className="mt-3 grid gap-3">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3"
          >
            <div className="flex size-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-600">
              {index + 1}
            </div>
            <div className="min-w-0 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
              <p className="text-sm font-semibold text-slate-950">
                {step.title}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-slate-600">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StorageBindingCard({
  title,
  status,
  icon: Icon,
  rows,
}: {
  title: string;
  status: string;
  icon: LucideIcon;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_0_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-950">{title}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-500">
            {status}
          </p>
        </div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-600 ring-1 ring-slate-200">
          <Icon className="size-4" />
        </div>
      </div>
      <dl className="mt-3 grid gap-2">
        {rows.map(([label, value]) => (
          <StorageFact key={label} label={label} value={value} compact />
        ))}
      </dl>
    </div>
  );
}

function StorageFact({
  label,
  value,
  compact = false,
  stacked = false,
}: FactItem & { compact?: boolean; stacked?: boolean }) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-[8px] bg-slate-50/85 sm:items-start",
        stacked ? "" : "sm:grid-cols-[104px_minmax(0,1fr)]",
        compact ? "px-2.5 py-1.5" : "px-3 py-2",
      )}
    >
      <dt className="text-[12px] leading-5 font-medium text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 font-mono text-[12px] leading-5 break-all text-slate-800">
        {value}
      </dd>
    </div>
  );
}

function StorageExampleCard({
  title,
  status,
  icon: Icon,
  code,
}: {
  title: string;
  status: string;
  icon: LucideIcon;
  code: string;
}) {
  return (
    <details className="group min-w-0 rounded-[var(--radius-card)] border border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.035)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 transition-colors outline-none hover:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-slate-300 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-600 ring-1 ring-slate-200">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-slate-950">
              {title}
            </span>
            <span className="mt-0.5 block text-[13px] leading-5 text-slate-500">
              {status}
            </span>
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200/80 px-4 py-4">
        <pre className="max-h-[min(38vh,360px)] w-full min-w-0 overflow-auto rounded-[10px] border border-slate-200 bg-slate-950 p-4 text-[12px] leading-5 text-slate-100 shadow-inner">
          <code>{code}</code>
        </pre>
      </div>
    </details>
  );
}
