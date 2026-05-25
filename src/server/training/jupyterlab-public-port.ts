import type { V1Service } from "@kubernetes/client-node";

export const JUPYTERLAB_PUBLIC_PORT_LABEL =
  "cola.training/jupyterlab-public-port";
export const JUPYTERLAB_PUBLIC_PORT_COMPONENT = "notebook-public-port";
export const JUPYTERLAB_RESERVED_PORT = 8888;
export const JUPYTERLAB_PUBLIC_PORT_MIN = 1024;
export const JUPYTERLAB_PUBLIC_PORT_MAX = 65535;

export type JupyterLabPublishedPortItem = {
  id: string;
  serviceName: string;
  targetPort: number;
  nodePort: number;
  url: string | null;
  createdAt: string | null;
};

export function normalizeJupyterLabPublicPort(input: number) {
  if (!Number.isInteger(input)) {
    throw new Error("公开端口必须是整数。");
  }

  if (
    input < JUPYTERLAB_PUBLIC_PORT_MIN ||
    input > JUPYTERLAB_PUBLIC_PORT_MAX
  ) {
    throw new Error(
      `公开端口范围必须是 ${JUPYTERLAB_PUBLIC_PORT_MIN}-${JUPYTERLAB_PUBLIC_PORT_MAX}。`,
    );
  }

  if (input === JUPYTERLAB_RESERVED_PORT) {
    throw new Error(
      "8888 已用于 JupyterLab 入口，请选择 Notebook 内部服务端口。",
    );
  }

  return input;
}

export function jupyterLabPublicPortServiceName(
  labName: string,
  targetPort: number,
) {
  return `jlab-${labName}-p-${targetPort}`;
}

export function isJupyterLabPublicPortService(
  service: Pick<V1Service, "metadata">,
  labName?: string,
) {
  const labels = service.metadata?.labels ?? {};
  if (
    labels["app.kubernetes.io/name"] !== "cola-jupyterlab" ||
    labels["app.kubernetes.io/component"] !== JUPYTERLAB_PUBLIC_PORT_COMPONENT
  ) {
    return false;
  }

  return labName ? labels["cola.training/jupyterlab-name"] === labName : true;
}

export function jupyterLabPublicPortTarget(
  service: Pick<V1Service, "metadata" | "spec">,
) {
  const raw =
    service.metadata?.labels?.[JUPYTERLAB_PUBLIC_PORT_LABEL] ??
    service.metadata?.annotations?.[JUPYTERLAB_PUBLIC_PORT_LABEL];
  const fromLabel = Number(raw);
  if (Number.isInteger(fromLabel)) return fromLabel;

  const servicePort = service.spec?.ports?.[0];
  if (typeof servicePort?.targetPort === "number") {
    return servicePort.targetPort;
  }

  return typeof servicePort?.port === "number" ? servicePort.port : null;
}
