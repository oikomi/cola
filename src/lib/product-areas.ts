import type { DockerRunnerEngine } from "@/server/office/catalog";

export type ProductAreaKey =
  | "office"
  | "workspace"
  | "training"
  | "deployments"
  | "system";

export const PRODUCT_AREAS: Array<{
  key: ProductAreaKey;
  href: string;
  title: string;
  description: string;
}> = [
  {
    key: "office",
    href: "/",
    title: "虚拟 Office",
    description:
      "空间化展示人物、任务、设备与事件状态，OpenClaw / Hermes 在模块内以 K8s 方式部署。",
  },
  {
    key: "workspace",
    href: "/workspace",
    title: "远程桌面",
    description:
      "独立管理 remote workspace、浏览器桌面、Ingress 地址与节点级 GPU 会话。",
  },
  {
    key: "training",
    href: "/training",
    title: "训练平台",
    description: "独立管理训练作业、数据集、实验轨迹与训练产物。",
  },
  {
    key: "deployments",
    href: "/deployments",
    title: "推理部署平台",
    description: "独立管理推理服务、版本灰度、流量切换、发布与回滚。",
  },
  {
    key: "system",
    href: "/system",
    title: "系统管理",
    description: "进入 K8s Dashboard，查看集群对象、命名空间与工作负载状态。",
  },
];

export const k8sWorkspaceEngineLabels: Record<DockerRunnerEngine, string> = {
  openclaw: "OpenClaw K8s",
  "hermes-agent": "Hermes K8s",
};

export const k8sWorkspaceSurfaceLabels: Record<DockerRunnerEngine, string> = {
  openclaw: "OpenClaw K8s Workspace",
  "hermes-agent": "Hermes K8s Workspace",
};

export function productAreaForPath(
  pathname: string | null | undefined,
): ProductAreaKey {
  if (
    !pathname ||
    pathname === "/" ||
    pathname.startsWith("/control") ||
    pathname.startsWith("/openclaw") ||
    pathname.startsWith("/hermes")
  ) {
    return "office";
  }

  if (pathname.startsWith("/workspace")) {
    return "workspace";
  }

  if (pathname.startsWith("/training")) {
    return "training";
  }

  if (pathname.startsWith("/deployments")) {
    return "deployments";
  }

  if (pathname.startsWith("/system")) {
    return "system";
  }

  return "office";
}
