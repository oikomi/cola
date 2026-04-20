import type { DockerRunnerEngine } from "@/server/office/catalog";

export type ProductAreaKey =
  | "office"
  | "workspace"
  | "training"
  | "deployments";

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
      "空间化编排、人物协作与任务流转，OpenClaw / Hermes 按 K8s workspace 范式接入。",
  },
  {
    key: "workspace",
    href: "/workspace",
    title: "远程桌面",
    description:
      "统一承载 remote workspace、浏览器桌面、Ingress 地址与节点级 GPU 会话。",
  },
  {
    key: "training",
    href: "/training",
    title: "训练平台",
    description:
      "管理训练作业、数据集与实验轨迹，把 GPU 训练链路收拢到同一层入口。",
  },
  {
    key: "deployments",
    href: "/deployments",
    title: "推理部署平台",
    description:
      "管理推理服务、版本灰度、流量切换与回滚，把上线面从 Office 中拆出。",
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
  if (!pathname || pathname === "/" || pathname.startsWith("/control")) {
    return "office";
  }

  if (
    pathname.startsWith("/workspace") ||
    pathname.startsWith("/openclaw") ||
    pathname.startsWith("/hermes")
  ) {
    return "workspace";
  }

  if (pathname.startsWith("/training")) {
    return "training";
  }

  if (pathname.startsWith("/deployments")) {
    return "deployments";
  }

  return "office";
}
