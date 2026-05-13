import {
  CheckCircle2Icon,
  DatabaseIcon,
  FolderSyncIcon,
  HardDriveIcon,
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

const DEFAULT_STORAGE_CLASS = "juicefs-sc";
const DEFAULT_TRAINING_PVC = "cola-training-workspace";
const DEFAULT_MOUNT_PATH = "/workspace";
const DEFAULT_OUTPUT_ROOT = "/workspace/cola-training";

export default function StoragePage() {
  const namespace =
    typeof clusterConfig.workspaceNamespace === "string" &&
    clusterConfig.workspaceNamespace.trim().length > 0
      ? clusterConfig.workspaceNamespace.trim()
      : "remote-work";

  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Storage Ops"
        title="存储管理"
        description="集中管理训练平台需要的 JuiceFS StorageClass、PVC 工作空间、数据集目录和训练产物路径。"
        icon={DatabaseIcon}
        badges={
          <>
            <Badge className="border border-lime-200 bg-lime-50 text-lime-700">
              JuiceFS
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {namespace}
            </Badge>
            <Badge className="border border-slate-200 bg-white text-slate-700">
              {DEFAULT_STORAGE_CLASS}
            </Badge>
          </>
        }
        size="compact"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <ModuleMetricCard
            size="compact"
            label="StorageClass"
            value={DEFAULT_STORAGE_CLASS}
            description="JuiceFS CSI 部署后，PVC 默认从这个 StorageClass 动态创建。"
            icon={DatabaseIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Namespace"
            value={namespace}
            description="训练平台、JupyterLab 和 Unsloth Studio 默认工作 namespace。"
            icon={RouteIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Workspace PVC"
            value={DEFAULT_TRAINING_PVC}
            description="可作为训练任务和交互式工具共享的数据与产物卷。"
            icon={HardDriveIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Mount Path"
            value={DEFAULT_MOUNT_PATH}
            description="容器内统一挂载路径，便于数据集和 checkpoint 复用。"
            icon={FolderSyncIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        title="训练平台存储"
        description="这里先作为 JuiceFS 部署后的前端入口；下一步可以接入 PVC 列表、创建、扩容和绑定到 JupyterLab / Unsloth Studio。"
        density="compact"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-3 md:grid-cols-2">
            <StorageBindingCard
              title="训练任务"
              status="已支持 PVC 挂载"
              icon={CheckCircle2Icon}
              rows={[
                ["环境变量", "COLA_TRAINING_PVC_NAME"],
                ["默认 PVC", DEFAULT_TRAINING_PVC],
                ["挂载路径", DEFAULT_MOUNT_PATH],
                ["产物根目录", DEFAULT_OUTPUT_ROOT],
              ]}
            />
            <StorageBindingCard
              title="JupyterLab"
              status="可独立指定 PVC"
              icon={PackageIcon}
              rows={[
                ["环境变量", "COLA_JUPYTERLAB_PVC_NAME"],
                ["建议 PVC", DEFAULT_TRAINING_PVC],
                ["建议挂载", DEFAULT_MOUNT_PATH],
                ["用途", "准备数据集与调试脚本"],
              ]}
            />
            <StorageBindingCard
              title="Unsloth Studio"
              status="可复用训练 PVC"
              icon={Settings2Icon}
              rows={[
                ["优先变量", "COLA_UNSLOTH_STUDIO_PVC_NAME"],
                ["回退变量", "COLA_TRAINING_PVC_NAME"],
                ["建议挂载", DEFAULT_MOUNT_PATH],
                ["用途", "共享配置、数据集和输出目录"],
              ]}
            />
            <StorageBindingCard
              title="动态申请"
              status="待接入"
              icon={HardDriveIcon}
              rows={[
                ["表单字段", "存储大小，例如 500Gi"],
                ["StorageClass", DEFAULT_STORAGE_CLASS],
                ["访问模式", "ReadWriteMany"],
                ["绑定范围", "Studio / JupyterLab / 训练任务"],
              ]}
            />
          </div>

          <div className="rounded-[var(--radius-card)] border border-lime-200/80 bg-lime-50/50 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-white text-lime-700 ring-1 ring-lime-100">
                <DatabaseIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">JuiceFS 接入目标</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  用 JuiceFS 提供 ReadWriteMany 工作空间，让 JupyterLab
                  写入的数据、Unsloth Studio 配置和训练任务产物在同一个 PVC
                  内流转。
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-[12px] border border-white/80 bg-white/82 p-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                PVC Template
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                <StorageFact
                  label="metadata.name"
                  value={DEFAULT_TRAINING_PVC}
                />
                <StorageFact label="metadata.namespace" value={namespace} />
                <StorageFact
                  label="storageClassName"
                  value={DEFAULT_STORAGE_CLASS}
                />
                <StorageFact label="accessModes" value="ReadWriteMany" />
                <StorageFact label="requests.storage" value="500Gi" />
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
    <div className="grid gap-1 rounded-[10px] bg-slate-50/80 px-3 py-2 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-center">
      <dt className="text-[12px] font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 font-mono text-[12px] break-all text-slate-800">
        {value}
      </dd>
    </div>
  );
}
