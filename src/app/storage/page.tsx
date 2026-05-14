import {
  ArchiveIcon,
  CheckCircle2Icon,
  Code2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  HardDriveIcon,
  KeyRoundIcon,
  PackageIcon,
  RouteIcon,
  Settings2Icon,
  TerminalIcon,
} from "lucide-react";

import clusterConfig from "../../../infra/k8s/cluster/config.json";
import {
  ModuleHero,
  ModuleMetricCard,
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
const DEFAULT_BUCKET = "cola-training";
const INTERNAL_ENDPOINT = `http://${SEAWEEDFS_SERVICE}.${STORAGE_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_PORT}`;
const INTERNAL_FILER_ENDPOINT = `${SEAWEEDFS_FILER_SERVICE}.${STORAGE_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_FILER_PORT}`;
const DEFAULT_CHECKPOINT_PREFIX = `s3://${DEFAULT_BUCKET}/checkpoints/`;
const DEFAULT_MODEL_PREFIX = `s3://${DEFAULT_BUCKET}/models/`;
const DEFAULT_BUCKET_FILER_PATH = `/buckets/${DEFAULT_BUCKET}`;
const TRAINING_WORKDIR = "/workspace";
const TRAINING_DATASET_DIR = `${TRAINING_WORKDIR}/datasets`;
const TRAINING_CHECKPOINT_DIR = `${TRAINING_WORKDIR}/checkpoints`;
const TRAINING_MODEL_DIR = `${TRAINING_WORKDIR}/models`;

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
  const adminUiUrl = `http://${controllerIp}:${SEAWEEDFS_ADMIN_NODE_PORT}`;
  const lanS3Endpoint = `http://${controllerIp}:${SEAWEEDFS_S3_NODE_PORT}`;
  const kubernetesVersion =
    typeof clusterConfig.kubernetesVersion === "string" &&
    clusterConfig.kubernetesVersion.trim().length > 0
      ? clusterConfig.kubernetesVersion.trim()
      : "1.34";
  const curlExample = `set -a
source infra/seaweedfs/seaweedfs.env
set +a

export LAN_ENDPOINT_URL="${lanS3Endpoint}"
export AWS_ACCESS_KEY_ID="$SEAWEEDFS_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SEAWEEDFS_S3_SECRET_KEY"
export COLA_TRAINING_S3_BUCKET="\${SEAWEEDFS_S3_BUCKET:-${DEFAULT_BUCKET}}"

printf '{"prompt":"hello"}\\n' > sample.jsonl

curl --aws-sigv4 "aws:amz:us-east-1:s3" \\
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \\
  -T ./sample.jsonl \\
  "$LAN_ENDPOINT_URL/$COLA_TRAINING_S3_BUCKET/datasets/sample.jsonl"

curl --aws-sigv4 "aws:amz:us-east-1:s3" \\
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \\
  "$LAN_ENDPOINT_URL/$COLA_TRAINING_S3_BUCKET?list-type=2&prefix=datasets/"`;
  const pythonExample = `set -a
source infra/seaweedfs/seaweedfs.env
set +a

export AWS_ENDPOINT_URL="${INTERNAL_ENDPOINT}"
export AWS_ACCESS_KEY_ID="$SEAWEEDFS_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SEAWEEDFS_S3_SECRET_KEY"
export AWS_DEFAULT_REGION="us-east-1"
export COLA_TRAINING_S3_BUCKET="\${SEAWEEDFS_S3_BUCKET:-${DEFAULT_BUCKET}}"

python - <<'PY'
import os
from pathlib import Path

import boto3

bucket = os.getenv("COLA_TRAINING_S3_BUCKET", "cola-training")
s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["AWS_ENDPOINT_URL"],
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
)

Path("sample.jsonl").write_text('{"prompt":"hello"}\\n', encoding="utf-8")
s3.upload_file("sample.jsonl", bucket, "datasets/sample.jsonl")

for obj in s3.list_objects_v2(Bucket=bucket, Prefix="datasets/").get("Contents", []):
    print(obj["Key"])

s3.download_file(bucket, "datasets/sample.jsonl", "sample.downloaded.jsonl")
PY`;
  const fuseExample = `# 平台创建远程桌面、训练 Job、JupyterLab、Unsloth Studio 时会自动注入：
# 1. restartable init sidecar: ${SEAWEEDFS_FUSE_IMAGE}
# 2. SeaweedFS FUSE: ${INTERNAL_FILER_ENDPOINT}${DEFAULT_BUCKET_FILER_PATH}
# 3. 主业务容器挂载: ${TRAINING_WORKDIR}

export COLA_SEAWEEDFS_MOUNT_ENABLED=true
export COLA_SEAWEEDFS_FILER="${INTERNAL_FILER_ENDPOINT}"
export COLA_SEAWEEDFS_FILER_PATH="${DEFAULT_BUCKET_FILER_PATH}"
export COLA_SEAWEEDFS_IMAGE="${SEAWEEDFS_FUSE_IMAGE}"
export COLA_TRAINING_WORKDIR_MOUNT_PATH="${TRAINING_WORKDIR}"

# 业务容器内直接按本地文件系统使用：
mkdir -p ${TRAINING_DATASET_DIR} ${TRAINING_CHECKPOINT_DIR} ${TRAINING_MODEL_DIR}
printf '{"prompt":"hello"}\\n' > ${TRAINING_DATASET_DIR}/sample.jsonl
python train.py --data ${TRAINING_DATASET_DIR}/sample.jsonl \\
  --output ${TRAINING_CHECKPOINT_DIR}
ls -lah ${TRAINING_WORKDIR}

# 兼容回退：如需暂时改用节点预挂载或 PVC，可关闭自动 FUSE。
export COLA_SEAWEEDFS_MOUNT_ENABLED=false
export COLA_TRAINING_WORKDIR_HOST_PATH=/mnt/cola-training
export COLA_TRAINING_WORKDIR_MOUNT_PATH=${TRAINING_WORKDIR}`;

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Storage Ops"
        title="存储管理"
        description="集中管理训练平台使用的 SeaweedFS S3 对象存储、数据集路径、checkpoint 和模型产物归档。"
        icon={DatabaseIcon}
        badges={
          <>
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              SeaweedFS
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {STORAGE_NAMESPACE}
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              S3 API
            </Badge>
            <a
              href={adminUiUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ size: "sm" }), "h-7 gap-1.5")}
            >
              <ExternalLinkIcon className="size-3.5" />
              打开 Admin UI
            </a>
          </>
        }
        size="compact"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <ModuleMetricCard
            size="compact"
            label="LAN S3"
            value={`:${SEAWEEDFS_S3_NODE_PORT}`}
            description="局域网内其他机器访问 SeaweedFS S3 的 NodePort。"
            icon={RouteIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Namespace"
            value={STORAGE_NAMESPACE}
            description="SeaweedFS master、volume、filer 和 S3 gateway 所在命名空间。"
            icon={DatabaseIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Bucket"
            value={DEFAULT_BUCKET}
            description="默认训练数据、checkpoint 和模型产物 bucket。"
            icon={ArchiveIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Workloads"
            value={namespace}
            description="训练任务、JupyterLab 和 Unsloth Studio 默认工作 namespace。"
            icon={HardDriveIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        title="SeaweedFS S3 接入"
        description="平台在业务创建和启动时自动挂载 SeaweedFS Filer/FUSE；业务优先把共享数据当作本地文件路径管理，S3 API 作为导入导出接口。"
        density="compact"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2">
            <StorageBindingCard
              title="训练任务"
              status="按本地路径读取数据集和写入产物"
              icon={CheckCircle2Icon}
              rows={[
                ["工作目录", TRAINING_WORKDIR],
                ["数据集目录", TRAINING_DATASET_DIR],
                ["checkpoint", TRAINING_CHECKPOINT_DIR],
                ["模型目录", TRAINING_MODEL_DIR],
                ["底层挂载", "SeaweedFS FUSE sidecar"],
              ]}
            />
            <StorageBindingCard
              title="JupyterLab"
              status="启动时自动挂载共享工作目录"
              icon={PackageIcon}
              rows={[
                ["Endpoint", INTERNAL_ENDPOINT],
                ["Filer", INTERNAL_FILER_ENDPOINT],
                ["局域网 Endpoint", lanS3Endpoint],
                ["Bucket", DEFAULT_BUCKET],
                ["文件路径", TRAINING_WORKDIR],
                ["用途", "上传数据集、调试脚本和查看产物"],
                ["认证", "AWS_ACCESS_KEY_ID"],
              ]}
            />
            <StorageBindingCard
              title="Unsloth Studio"
              status="保存模型和导出产物到共享目录"
              icon={Settings2Icon}
              rows={[
                ["Endpoint", INTERNAL_ENDPOINT],
                ["文件路径", TRAINING_WORKDIR],
                ["模型前缀", DEFAULT_MODEL_PREFIX],
                ["checkpoint", DEFAULT_CHECKPOINT_PREFIX],
                ["认证", "AWS_SECRET_ACCESS_KEY"],
              ]}
            />
            <StorageBindingCard
              title="容量说明"
              status="由 volume 节点实际磁盘决定"
              icon={HardDriveIcon}
              rows={[
                ["默认数据根", "/var/lib/cola/seaweedfs"],
                ["当前节点", "master-01 / node-01"],
                ["Filer 路径", DEFAULT_BUCKET_FILER_PATH],
                ["Admin UI", adminUiUrl],
                ["Kubernetes", kubernetesVersion],
                ["副本策略", "SEAWEEDFS_REPLICATION"],
                ["PVC", "当前方案不创建"],
              ]}
            />
          </div>

          <div className="rounded-[var(--radius-card)] border border-emerald-200/80 bg-emerald-50/50 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-white text-emerald-700 ring-1 ring-emerald-100">
                <KeyRoundIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">访问参数</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  集群内训练容器使用 ClusterIP，局域网机器使用 NodePort。 FUSE
                  挂载直接访问 Filer；S3 导入导出共用同一组凭据。
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-[12px] border border-white/80 bg-white/82 p-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                Environment
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                <StorageFact
                  label="AWS_ENDPOINT_URL"
                  value={INTERNAL_ENDPOINT}
                />
                <StorageFact label="LAN_ENDPOINT_URL" value={lanS3Endpoint} />
                <StorageFact
                  label="FILER_ENDPOINT"
                  value={INTERNAL_FILER_ENDPOINT}
                />
                <StorageFact
                  label="FILER_BUCKET_PATH"
                  value={DEFAULT_BUCKET_FILER_PATH}
                />
                <StorageFact
                  label="TRAINING_WORKDIR"
                  value={TRAINING_WORKDIR}
                />
                <StorageFact
                  label="COLA_SEAWEEDFS_IMAGE"
                  value={SEAWEEDFS_FUSE_IMAGE}
                />
                <StorageFact
                  label="MOUNT_ENABLED"
                  value="COLA_SEAWEEDFS_MOUNT_ENABLED=true"
                />
                <StorageFact label="AWS_DEFAULT_REGION" value="us-east-1" />
                <StorageFact
                  label="AWS_ACCESS_KEY_ID"
                  value="来自 infra/seaweedfs/seaweedfs.env"
                />
                <StorageFact
                  label="AWS_SECRET_ACCESS_KEY"
                  value="来自 infra/seaweedfs/seaweedfs.env"
                />
                <StorageFact
                  label="COLA_TRAINING_S3_BUCKET"
                  value={DEFAULT_BUCKET}
                />
              </dl>
            </div>
          </div>
        </div>
      </ModuleSection>

      <ModuleSection
        title="使用例子"
        description="训练脚本、Notebook、远程桌面和 Studio 使用 /workspace 下的普通文件路径；导入导出、自动化同步和外部机器访问仍可走 S3 API。"
        density="compact"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <StorageGuidanceCard />
          <StorageExampleCard
            title="curl"
            status="局域网机器通过 NodePort 上传和列出数据集对象"
            icon={TerminalIcon}
            code={curlExample}
          />
          <StorageExampleCard
            title="Python"
            status="训练容器或 Notebook 通过 ClusterIP 读写对象"
            icon={Code2Icon}
            code={pythonExample}
          />
          <StorageExampleCard
            title="Filer / FUSE"
            status="平台自动挂载为本地目录，业务按文件路径读写训练数据"
            icon={HardDriveIcon}
            code={fuseExample}
            wide
          />
        </div>
      </ModuleSection>
    </ModulePageShell>
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
  icon: typeof DatabaseIcon;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-5 py-5 shadow-[0_1px_0_rgba(15,23,42,0.035)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm text-slate-500">{status}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-600 ring-1 ring-slate-200">
          <Icon className="size-4" />
        </div>
      </div>
      <dl className="mt-4 grid gap-2">
        {rows.map(([label, value]) => (
          <StorageFact key={label} label={label} value={value} />
        ))}
      </dl>
    </div>
  );
}

function StorageFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-[10px] bg-slate-50/80 px-3 py-2 sm:grid-cols-[126px_minmax(0,1fr)] sm:items-center">
      <dt className="text-[12px] font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 font-mono text-[12px] break-all text-slate-800">
        {value}
      </dd>
    </div>
  );
}

function StorageGuidanceCard() {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-amber-200/80 bg-amber-50/45 px-5 py-5 xl:col-span-2">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-white text-amber-700 ring-1 ring-amber-100">
          <HardDriveIcon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">业务使用方式</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            远程桌面、训练任务、JupyterLab 和 Unsloth Studio 统一使用{" "}
            {TRAINING_WORKDIR} 作为共享工作目录，业务代码可以按本地文件路径管理
            datasets、checkpoints 和 models。底层由平台在 Pod 启动时自动拉起
            SeaweedFS Filer/FUSE 挂载。
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <StorageFact
          label="文件路径"
          value={`${TRAINING_DATASET_DIR}、${TRAINING_CHECKPOINT_DIR}、${TRAINING_MODEL_DIR}`}
        />
        <StorageFact
          label="自动挂载"
          value="restartable init sidecar 挂载 SeaweedFS 到 /workspace"
        />
        <StorageFact
          label="注意"
          value="临时 scratch、数据库和日志热写入继续放本地盘；共享数据和产物放 /workspace"
        />
      </div>
    </div>
  );
}

function StorageExampleCard({
  title,
  status,
  icon: Icon,
  code,
  wide = false,
}: {
  title: string;
  status: string;
  icon: typeof DatabaseIcon;
  code: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-card)] border border-slate-200/90 bg-white px-5 py-5 shadow-[0_1px_0_rgba(15,23,42,0.035)]",
        wide ? "xl:col-span-2" : undefined,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm leading-5 text-slate-500">{status}</p>
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-600 ring-1 ring-slate-200">
          <Icon className="size-4" />
        </div>
      </div>
      <pre className="mt-4 max-h-[420px] w-full min-w-0 overflow-auto rounded-[10px] border border-slate-200 bg-slate-950 p-4 text-[12px] leading-5 text-slate-100 shadow-inner">
        <code>{code}</code>
      </pre>
    </div>
  );
}
