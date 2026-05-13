import {
  ArchiveIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  HardDriveIcon,
  KeyRoundIcon,
  PackageIcon,
  RouteIcon,
  Settings2Icon,
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
const SEAWEEDFS_PORT = "8333";
const SEAWEEDFS_ADMIN_NODE_PORT = "32246";
const DEFAULT_BUCKET = "cola-training";
const INTERNAL_ENDPOINT = `http://${SEAWEEDFS_SERVICE}.${STORAGE_NAMESPACE}.svc.cluster.local:${SEAWEEDFS_PORT}`;
const DEFAULT_DATASET_PREFIX = `s3://${DEFAULT_BUCKET}/datasets/`;
const DEFAULT_CHECKPOINT_PREFIX = `s3://${DEFAULT_BUCKET}/checkpoints/`;
const DEFAULT_MODEL_PREFIX = `s3://${DEFAULT_BUCKET}/models/`;

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
            label="Admin UI"
            value={`:${SEAWEEDFS_ADMIN_NODE_PORT}`}
            description="SeaweedFS 官方 Web 管理入口，点击按钮新窗口打开。"
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
        description="当前方案只部署对象存储，不创建 JuiceFS StorageClass 或 500Gi PVC；训练代码和交互式工具通过 S3 API 读写数据。"
        density="compact"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2">
            <StorageBindingCard
              title="训练任务"
              status="通过 S3 读取数据集"
              icon={CheckCircle2Icon}
              rows={[
                ["Endpoint", "AWS_ENDPOINT_URL"],
                ["Bucket", "COLA_TRAINING_S3_BUCKET"],
                ["数据集前缀", DEFAULT_DATASET_PREFIX],
                ["产物前缀", DEFAULT_CHECKPOINT_PREFIX],
              ]}
            />
            <StorageBindingCard
              title="JupyterLab"
              status="用 awscli / SDK 管理对象"
              icon={PackageIcon}
              rows={[
                ["Endpoint", INTERNAL_ENDPOINT],
                ["Bucket", DEFAULT_BUCKET],
                ["用途", "上传数据集与调试脚本"],
                ["认证", "AWS_ACCESS_KEY_ID"],
              ]}
            />
            <StorageBindingCard
              title="Unsloth Studio"
              status="保存模型和导出产物"
              icon={Settings2Icon}
              rows={[
                ["Endpoint", INTERNAL_ENDPOINT],
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
                <p className="font-semibold text-slate-950">集群内访问参数</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  把这些变量注入到训练容器或 Notebook 后，即可通过标准 S3
                  工具访问 SeaweedFS。
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
