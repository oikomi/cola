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
    description: "统一查看 agent、任务、审批、执行状态和 workspace 路由。",
  },
  {
    key: "workspace",
    href: "/workspace",
    title: "远程工作区",
    description: "集中管理 remote workspace、浏览器桌面、入口地址与节点资源。",
  },
  {
    key: "training",
    href: "/training",
    title: "训练作业",
    description: "统一管理训练任务、数据集、优先级和 GPU 消耗。",
  },
  {
    key: "deployments",
    href: "/deployments",
    title: "推理部署",
    description: "管理模型服务、规格、入口地址和服务状态。",
  },
  {
    key: "system",
    href: "/system",
    title: "集群管理",
    description: "跳转 Kubernetes Dashboard 查看集群对象与工作负载。",
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
