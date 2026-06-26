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
  PackageIcon,
  Settings2Icon,
  TerminalIcon,
  UploadCloudIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import clusterConfig from "../../../infra/k8s/cluster/config.json";
import nasConfig from "../../../infra/k8s/cluster/nas.json";
import clusterNodes from "../../../infra/k8s/cluster/nodes.json";
import { ModulePageShell } from "@/app/_components/module-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_NAMESPACE = "storage";
const SEAWEEDFS_SERVICE = "seaweedfs-s3";
const SEAWEEDFS_FILER_SERVICE = "seaweedfs-filer";
const SEAWEEDFS_PORT = "8333";
const SEAWEEDFS_FILER_PORT = "8888";
const SEAWEEDFS_ADMIN_NODE_PORT = "32246";
const SEAWEEDFS_S3_NODE_PORT = "32247";
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
const DEFAULT_SMB_SHARE = "nas-share";
const NAS_IP =
  typeof nasConfig.ip === "string" && nasConfig.ip.trim().length > 0
    ? nasConfig.ip.trim()
    : "172.16.60.47";
const SMB_URL = `smb://${NAS_IP}`;
const SMB_SOURCE = `//${NAS_IP}/${DEFAULT_SMB_SHARE}`;

const clusterNodeNames = clusterNodes
  .map((node) => node.name)
  .filter(
    (name): name is string => typeof name === "string" && name.length > 0,
  );

type FactItem = {
  label: string;
  value: string;
};

type MatrixRow = {
  label: string;
  description: string;
  icon: LucideIcon;
  tone: "emerald" | "sky";
  source: string;
  entry: string;
  service: string;
  result: string;
};

type WorkloadItem = {
  name: string;
  description: string;
  icon: LucideIcon;
  enable: string;
  mount: string;
  detail: string;
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
  const internalMountExample = `# 云桌面、Isaac Lab Jobs 和 JupyterLab 由平台在容器启动时自动挂载。
COLA_SMB_URL="${SMB_URL}"
COLA_SMB_SHARE_NAME="${DEFAULT_SMB_SHARE}"
COLA_SMB_USERNAME="${DEFAULT_SMB_SHARE}"
COLA_SMB_PASSWORD="从部署环境读取"
COLA_SMB_MOUNT_DIR="${TRAINING_WORKDIR}"
COLA_SMB_MOUNT_OPTIONS="vers=3.0,iocharset=utf8,uid=1000,gid=1000,file_mode=0777,dir_mode=0777,noperm"

# 容器里的业务代码直接按本地文件系统使用：
ls ${TRAINING_WORKDIR}
python train.py \\
  --data ${TRAINING_DATASET_DIR}/my-app/dataset.jsonl \\
  --output ${TRAINING_CHECKPOINT_DIR}/run-001

# 训练平台默认产物根目录：
${TRAINING_OUTPUT_ROOT}/<job-id>/<runtime-job-name>`;
  const fallbackExample = `# 如需临时切回旧路径，可把对应入口的挂载模式改成 legacy。
REMOTE_WORKSPACE_WORK_VOLUME_MOUNT_MODE=legacy
COLA_JUPYTERLAB_WORK_VOLUME_MOUNT_MODE=legacy
COLA_ISAAC_LAB_WORK_VOLUME_MOUNT_MODE=legacy

# 方案 A：节点已经预挂载共享目录。
COLA_TRAINING_WORKDIR_HOST_PATH=/mnt/cola-training
COLA_TRAINING_WORKDIR_MOUNT_PATH=${TRAINING_WORKDIR}

# 方案 B：已有可用 PVC。只部署 infra/seaweedfs 不会创建 PVC。
COLA_TRAINING_PVC_NAME=cola-training-workspace
COLA_TRAINING_PVC_MOUNT_PATH=${TRAINING_WORKDIR}`;
  const matrixRows: MatrixRow[] = [
    {
      label: "外部上传",
      description: "局域网应用通过 S3 API 写入对象",
      icon: UploadCloudIcon,
      tone: "emerald",
      source: "可信局域网应用",
      entry: lanS3Endpoint,
      service: `${SEAWEEDFS_SERVICE}:${SEAWEEDFS_PORT}`,
      result: `s3://${DEFAULT_BUCKET}/datasets/...`,
    },
    {
      label: "内部挂载",
      description: "Pod 启动时挂载成普通目录",
      icon: HardDriveIcon,
      tone: "sky",
      source: "桌面 / Lab Jobs / Notebook",
      entry: SMB_URL,
      service: "SMB / CIFS",
      result: TRAINING_WORKDIR,
    },
  ];
  const workloads: WorkloadItem[] = [
    {
      name: "云桌面",
      description: "桌面容器启动时挂载共享目录",
      icon: FilesIcon,
      enable: "REMOTE_WORKSPACE_WORK_VOLUME_MOUNT_MODE=smb",
      mount: TRAINING_WORKDIR,
      detail: SMB_SOURCE,
    },
    {
      name: "训练任务",
      description: "训练脚本按本地文件路径读写",
      icon: CheckCircle2Icon,
      enable: "COLA_TRAINING_SEAWEEDFS_MOUNT_ENABLED",
      mount: TRAINING_DATASET_DIR,
      detail: `${TRAINING_CHECKPOINT_DIR} / ${TRAINING_MODEL_DIR} / ${TRAINING_OUTPUT_ROOT}`,
    },
    {
      name: "JupyterLab",
      description: "Notebook 里看到同一个共享目录",
      icon: PackageIcon,
      enable: "COLA_JUPYTERLAB_WORK_VOLUME_MOUNT_MODE=smb",
      mount: TRAINING_WORKDIR,
      detail: SMB_SOURCE,
    },
    {
      name: "Lab Jobs",
      description: "Isaac Lab Job 输出写入 NAS 共享目录",
      icon: TerminalIcon,
      enable: "COLA_ISAAC_LAB_WORK_VOLUME_MOUNT_MODE=smb",
      mount: TRAINING_WORKDIR,
      detail: SMB_SOURCE,
    },
    {
      name: "Unsloth Studio",
      description: "模型导出和调试产物写入共享目录",
      icon: Settings2Icon,
      enable: "COLA_UNSLOTH_STUDIO_SEAWEEDFS_MOUNT_ENABLED",
      mount: "COLA_UNSLOTH_STUDIO_WORKDIR_MOUNT_PATH",
      detail: "COLA_UNSLOTH_STUDIO_PVC_NAME / COLA_TRAINING_PVC_NAME",
    },
  ];

  return (
    <ModulePageShell className="gap-3">
      <section className="overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <header className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-4 md:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                SeaweedFS S3
              </span>
              <MetaPill>{clusterName}</MetaPill>
              <MetaPill>{STORAGE_NAMESPACE}</MetaPill>
              <MetaPill>Kubernetes {kubernetesVersion}</MetaPill>
            </div>
            <h1 className="mt-2 text-[1.55rem] leading-tight font-semibold tracking-normal text-slate-950 md:text-[1.72rem]">
              存储管理
            </h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-6 text-slate-600">
              管理对象上传入口、容器挂载路径和训练数据目录约定。
            </p>
          </div>

          <a
            href={adminUiUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-9 shrink-0 gap-1.5 rounded-[10px] border-slate-300 bg-white px-3.5 text-[13px] text-slate-800 hover:bg-slate-50",
            )}
          >
            <ExternalLinkIcon className="size-3.5" />
            打开 Admin UI
          </a>
        </header>

        <div className="grid gap-px bg-slate-200/80 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <ConnectionMatrix rows={matrixRows} />
          <div className="grid content-start gap-px bg-slate-200/80">
            <CompactFact label="LAN S3" value={lanS3Endpoint} />
            <CompactFact label="Bucket" value={DEFAULT_BUCKET} />
            <CompactFact label="Mount" value={TRAINING_WORKDIR} />
            <CompactFact label="Controller" value={controllerIp} />
            <CompactFact label="Nodes" value={nodeSummary} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <OperationPanel
          title="上传数据"
          description="局域网机器或业务服务只需要 S3 endpoint、bucket、凭据和对象前缀。"
          icon={UploadCloudIcon}
        >
          <FactTable
            facts={[
              ["Endpoint", lanS3Endpoint],
              ["Bucket", DEFAULT_BUCKET],
              [
                "推荐前缀",
                "datasets/<source>/..., checkpoints/..., models/...",
              ],
              ["凭据来源", "infra/seaweedfs/seaweedfs.env"],
            ]}
          />
          <div className="mt-3 grid gap-2">
            <CodeDetails
              title="命令行导入"
              description="aws cli 通过 NodePort 写入数据集。"
              icon={TerminalIcon}
              code={lanUploadExample}
            />
            <CodeDetails
              title="应用代码导入"
              description="外部服务按 S3 SDK 写入 SeaweedFS。"
              icon={Code2Icon}
              code={appUploadExample}
            />
          </div>
        </OperationPanel>

        <OperationPanel
          title="挂载使用"
          description="平台在 Pod 启动时完成 SMB 挂载，业务代码按普通本地路径读写。"
          icon={HardDriveIcon}
        >
          <FactTable
            facts={[
              ["SMB URL", SMB_URL],
              ["SMB source", SMB_SOURCE],
              ["挂载目录", TRAINING_WORKDIR],
              ["账号", DEFAULT_SMB_SHARE],
              ["默认权限", "root + SYS_ADMIN + 0777"],
            ]}
          />
          <div className="mt-3 grid gap-2">
            <CodeDetails
              title="容器内路径"
              description="训练、Notebook 和远程桌面看到同一份目录。"
              icon={HardDriveIcon}
              code={internalMountExample}
            />
            <CodeDetails
              title="临时回退方式"
              description="改成 legacy 后才会使用 hostPath 或 PVC。"
              icon={TerminalIcon}
              code={fallbackExample}
            />
          </div>
        </OperationPanel>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <SectionTitle
          title="工作负载挂载策略"
          description="云桌面、Lab Jobs 和 JupyterLab 使用 SMB；其他训练入口保留原有存储模式。"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead className="border-b border-slate-200/90 bg-slate-50/70">
              <tr>
                <TableHead>入口</TableHead>
                <TableHead>启用变量</TableHead>
                <TableHead>目录</TableHead>
                <TableHead>补充</TableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {workloads.map((workload) => (
                <WorkloadRow key={workload.name} workload={workload} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <SectionTitle
          title="运维边界"
          description="页面数据以 infra/k8s/cluster 为准；对象存储、PVC 和公网暴露不要混在一起。"
        />
        <div className="grid gap-px bg-slate-200/80 md:grid-cols-3">
          <BoundaryColumn
            icon={DatabaseIcon}
            title="集群来源"
            facts={[
              ["集群", clusterName],
              ["Kubernetes", kubernetesVersion],
              ["工作 namespace", namespace],
              ["控制节点", controllerIp],
              ["节点", nodeSummary],
            ]}
          />
          <BoundaryColumn
            icon={ArchiveIcon}
            title="SeaweedFS 部署"
            facts={[
              ["Namespace", STORAGE_NAMESPACE],
              ["S3 Service", `${SEAWEEDFS_SERVICE}:${SEAWEEDFS_PORT}`],
              ["Admin UI", adminUiUrl],
              ["数据根目录", SEAWEEDFS_DATA_ROOT],
              ["Volume hostPath", SEAWEEDFS_VOLUME_ROOT],
            ]}
          />
          <BoundaryColumn
            icon={KeyRoundIcon}
            title="边界说明"
            facts={[
              ["默认模式", "SMB/CIFS 本地挂载"],
              ["NAS 来源", "infra/k8s/cluster/nas.json"],
              ["PVC", "infra/seaweedfs 不创建 PVC"],
              ["独立数据盘", "当前节点信息未声明独立数据盘"],
              ["公网暴露", "不建议；NodePort 只给可信局域网"],
            ]}
          />
        </div>
      </section>
    </ModulePageShell>
  );
}

function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[12px] text-slate-600">
      {children}
    </span>
  );
}

function ConnectionMatrix({ rows }: { rows: MatrixRow[] }) {
  return (
    <div className="min-w-0 bg-white">
      <div className="hidden grid-cols-[13rem_repeat(4,minmax(0,1fr))] border-b border-slate-200/90 bg-slate-50/70 xl:grid">
        <MatrixHead>路径</MatrixHead>
        <MatrixHead>来源</MatrixHead>
        <MatrixHead>入口</MatrixHead>
        <MatrixHead>服务</MatrixHead>
        <MatrixHead>结果</MatrixHead>
      </div>
      <div className="divide-y divide-slate-200/90">
        {rows.map((row) => (
          <MatrixLine key={row.label} row={row} />
        ))}
      </div>
    </div>
  );
}

function MatrixHead({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-2.5 text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
      {children}
    </div>
  );
}

function MatrixLine({ row }: { row: MatrixRow }) {
  const Icon = row.icon;
  const toneClass =
    row.tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-sky-50 text-sky-700";

  return (
    <div className="grid gap-0 xl:grid-cols-[13rem_repeat(4,minmax(0,1fr))]">
      <div className="flex min-w-0 items-center gap-3 border-b border-slate-100 px-4 py-3 xl:border-b-0">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[9px]",
            toneClass,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-slate-950">
            {row.label}
          </p>
          <p className="truncate text-[12px] leading-5 text-slate-500">
            {row.description}
          </p>
        </div>
      </div>
      <MatrixCell label="来源" value={row.source} />
      <MatrixCell label="入口" value={row.entry} />
      <MatrixCell label="服务" value={row.service} />
      <MatrixCell label="结果" value={row.result} />
    </div>
  );
}

function MatrixCell({ label, value }: FactItem) {
  return (
    <div className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:grid sm:grid-cols-[6rem_minmax(0,1fr)] xl:block xl:border-t-0">
      <p className="text-[11px] font-medium tracking-[0.12em] text-slate-400 uppercase xl:hidden">
        {label}
      </p>
      <p className="min-w-0 font-mono text-[12px] leading-5 font-semibold break-all text-slate-900">
        {value}
      </p>
    </div>
  );
}

function CompactFact({ label, value }: FactItem) {
  return (
    <div className="min-w-0 bg-white px-4 py-2.5">
      <p className="text-[11px] font-medium tracking-[0.14em] text-slate-400 uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-[12px] leading-5 font-semibold break-all text-slate-900">
        {value}
      </p>
    </div>
  );
}

function OperationPanel({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-shell)] border border-slate-200/90 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3 border-b border-slate-200/80 px-5 py-3.5 md:px-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-slate-100 text-slate-700">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[1.08rem] leading-6 font-semibold text-slate-950">
            {title}
          </h2>
          <p className="text-[13px] leading-5 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function FactTable({ facts }: { facts: Array<[string, string]> }) {
  return (
    <dl className="divide-y divide-slate-200/80 overflow-hidden rounded-[10px] border border-slate-200/90">
      {facts.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-1 px-3 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:items-start"
        >
          <dt className="text-[12px] leading-5 font-medium text-slate-500">
            {label}
          </dt>
          <dd className="min-w-0 font-mono text-[12px] leading-5 break-all text-slate-900">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CodeDetails({
  title,
  description,
  icon: Icon,
  code,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  code: string;
}) {
  return (
    <details className="group rounded-[10px] border border-slate-200/90 bg-slate-50/70">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 transition-colors outline-none hover:bg-slate-100/70 focus-visible:ring-2 focus-visible:ring-slate-300 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white text-slate-700 ring-1 ring-slate-200">
            <Icon className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-slate-950">
              {title}
            </span>
            <span className="block truncate text-[12px] leading-5 text-slate-500">
              {description}
            </span>
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200/80 bg-white px-3 py-3">
        <pre className="max-h-[min(42vh,360px)] overflow-auto rounded-[8px] bg-slate-950 p-4 text-[12px] leading-5 text-slate-100">
          <code>{code}</code>
        </pre>
      </div>
    </details>
  );
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-slate-200/80 px-5 py-3.5 md:px-5">
      <h2 className="text-[1.08rem] leading-6 font-semibold text-slate-950">
        {title}
      </h2>
      <p className="text-[13px] leading-5 text-slate-600">{description}</p>
    </div>
  );
}

function TableHead({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold tracking-[0.16em] text-slate-500 uppercase">
      {children}
    </th>
  );
}

function WorkloadRow({ workload }: { workload: WorkloadItem }) {
  const Icon = workload.icon;

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-slate-100 text-slate-700">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-950">
              {workload.name}
            </p>
            <p className="truncate text-[12px] text-slate-500">
              {workload.description}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-[12px] break-all text-slate-900">
        {workload.enable}
      </td>
      <td className="px-4 py-3 font-mono text-[12px] break-all text-slate-900">
        {workload.mount}
      </td>
      <td className="px-4 py-3 font-mono text-[12px] break-all text-slate-700">
        {workload.detail}
      </td>
    </tr>
  );
}

function BoundaryColumn({
  icon: Icon,
  title,
  facts,
}: {
  icon: LucideIcon;
  title: string;
  facts: Array<[string, string]>;
}) {
  return (
    <div className="min-w-0 bg-white px-5 py-4">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-slate-100 text-slate-700">
          <Icon className="size-4" />
        </div>
        <h3 className="text-[14px] font-semibold text-slate-950">{title}</h3>
      </div>
      <div className="mt-3">
        <FactTable facts={facts} />
      </div>
    </div>
  );
}
