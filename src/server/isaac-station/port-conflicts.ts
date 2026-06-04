import net from "node:net";

import { ISAAC_STATION_WEBRTC_PORT } from "./streaming-url.ts";

type KubeMetadata = {
  name?: string | null;
  labels?: Record<string, string> | null;
  annotations?: Record<string, string> | null;
  deletionTimestamp?: string | Date | null;
};

type KubeContainerPort = {
  containerPort?: number | null;
  hostPort?: number | null;
  protocol?: string | null;
};

type KubeContainer = {
  ports?: KubeContainerPort[] | null;
};

type KubePodSpec = {
  nodeName?: string | null;
  hostNetwork?: boolean | null;
  containers?: KubeContainer[] | null;
};

type KubePod = {
  metadata?: KubeMetadata | null;
  spec?: KubePodSpec | null;
  status?: { phase?: string | null } | null;
};

type KubeDeployment = {
  metadata?: KubeMetadata | null;
  spec?: {
    replicas?: number | null;
    template?: {
      metadata?: KubeMetadata | null;
      spec?: KubePodSpec | null;
    } | null;
  } | null;
};

type KubeJob = {
  metadata?: KubeMetadata | null;
  spec?: {
    completions?: number | null;
    parallelism?: number | null;
    template?: {
      metadata?: KubeMetadata | null;
      spec?: KubePodSpec | null;
    } | null;
  } | null;
  status?: {
    active?: number | null;
    succeeded?: number | null;
    failed?: number | null;
  } | null;
};

type WebrtcOwner =
  | {
      type: "station";
      name: string;
    }
  | {
      type: "lab";
      name: string;
    }
  | {
      type: "resource";
      kind: "Deployment" | "Job" | "Pod";
      name: string;
    };

export type HeadlessWebrtcPortConflict = {
  kind: "Deployment" | "Job" | "Pod";
  resourceName: string;
  owner: WebrtcOwner;
  nodeName: string;
  port: number;
};

export function isTcpPortOpen(params: {
  host: string;
  port: number;
  timeoutMs: number;
}) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({
      host: params.host,
      port: params.port,
    });
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(params.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function stationNameFromResourceName(name?: string | null) {
  if (!name?.startsWith("isaac-station-")) return null;
  return name.slice("isaac-station-".length);
}

function labNameFromResourceName(name?: string | null) {
  if (!name?.startsWith("isaac-lab-")) return null;
  return name.slice("isaac-lab-".length);
}

function ownerFromMetadata(
  metadata: KubeMetadata | null | undefined,
  kind: "Deployment" | "Job" | "Pod",
): WebrtcOwner {
  const stationName =
    metadata?.labels?.["cola.isaac/station-name"] ??
    stationNameFromResourceName(metadata?.name);
  if (stationName) {
    return { type: "station", name: stationName };
  }

  const labName =
    metadata?.labels?.["cola.isaac/lab-job-name"] ??
    metadata?.labels?.["batch.kubernetes.io/job-name"]?.replace(
      /^isaac-lab-/,
      "",
    ) ??
    metadata?.labels?.["job-name"]?.replace(/^isaac-lab-/, "") ??
    labNameFromResourceName(metadata?.name);
  if (labName) {
    return { type: "lab", name: labName };
  }

  return { type: "resource", kind, name: resourceName(metadata) };
}

function launchModeFromMetadata(...metadataEntries: (KubeMetadata | null | undefined)[]) {
  const mode = metadataEntries
    .map((metadata) => metadata?.annotations?.["cola.isaac/mode"])
    .find((value) => value === "headless-egl" || value === "headless-webrtc");

  return mode === "headless-egl" ? "headless-egl" : "headless-webrtc";
}

function displayModeFromMetadata(
  ...metadataEntries: (KubeMetadata | null | undefined)[]
) {
  const mode = metadataEntries
    .map((metadata) => metadata?.annotations?.["cola.isaac/display-mode"])
    .find((value) => value === "headless" || value === "webrtc");

  return mode === "webrtc" ? "webrtc" : "headless";
}

function resourceName(metadata?: KubeMetadata | null) {
  return metadata?.name ?? "unknown";
}

function exposesWebrtcPort(spec?: KubePodSpec | null) {
  return (
    spec?.containers?.some((container) =>
      container.ports?.some((port) => {
        const protocol = port.protocol ?? "TCP";
        return (
          protocol === "TCP" &&
          (port.containerPort === ISAAC_STATION_WEBRTC_PORT ||
            port.hostPort === ISAAC_STATION_WEBRTC_PORT)
        );
      }),
    ) ?? false
  );
}

function deploymentDesiredReplicas(deployment: KubeDeployment) {
  return deployment.spec?.replicas ?? 1;
}

function jobDesiredPods(job: KubeJob) {
  if ((job.status?.succeeded ?? 0) >= (job.spec?.completions ?? 1)) return 0;
  return job.spec?.parallelism ?? 1;
}

function isFinishedPod(pod: KubePod) {
  const phase = pod.status?.phase;
  return phase === "Failed" || phase === "Succeeded";
}

function isDeleting(metadata?: KubeMetadata | null) {
  return Boolean(metadata?.deletionTimestamp);
}

function podUsesWebrtc(owner: WebrtcOwner, pod: KubePod) {
  if (owner.type === "lab") {
    return displayModeFromMetadata(pod.metadata) === "webrtc";
  }
  if (owner.type === "station") {
    return launchModeFromMetadata(pod.metadata) === "headless-webrtc";
  }

  return (
    launchModeFromMetadata(pod.metadata) === "headless-webrtc" ||
    displayModeFromMetadata(pod.metadata) === "webrtc"
  );
}

export function findHeadlessWebrtcPortConflict(params: {
  deployments: KubeDeployment[];
  jobs?: KubeJob[];
  pods: KubePod[];
  requestedOwnerName: string;
  nodeName: string;
}): HeadlessWebrtcPortConflict | null {
  const requestedNodeName = params.nodeName;

  for (const deployment of params.deployments) {
    const owner = ownerFromMetadata(deployment.metadata, "Deployment");
    if (owner.name === params.requestedOwnerName) continue;
    if (deploymentDesiredReplicas(deployment) <= 0) continue;
    if (
      launchModeFromMetadata(
        deployment.metadata,
        deployment.spec?.template?.metadata,
      ) !== "headless-webrtc"
    ) {
      continue;
    }

    const templateSpec = deployment.spec?.template?.spec;
    const deploymentNodeName = templateSpec?.nodeName ?? requestedNodeName;
    if (deploymentNodeName !== requestedNodeName) continue;
    if (templateSpec?.hostNetwork === false && !exposesWebrtcPort(templateSpec)) {
      continue;
    }

    return {
      kind: "Deployment",
      resourceName: resourceName(deployment.metadata),
      owner,
      nodeName: requestedNodeName,
      port: ISAAC_STATION_WEBRTC_PORT,
    };
  }

  for (const job of params.jobs ?? []) {
    const owner = ownerFromMetadata(job.metadata, "Job");
    if (owner.name === params.requestedOwnerName) continue;
    if (jobDesiredPods(job) <= 0) continue;
    if (
      displayModeFromMetadata(job.metadata, job.spec?.template?.metadata) !==
      "webrtc"
    ) {
      continue;
    }

    const templateSpec = job.spec?.template?.spec;
    const jobNodeName = templateSpec?.nodeName ?? requestedNodeName;
    if (jobNodeName !== requestedNodeName) continue;
    if (templateSpec?.hostNetwork === false && !exposesWebrtcPort(templateSpec)) {
      continue;
    }

    return {
      kind: "Job",
      resourceName: resourceName(job.metadata),
      owner,
      nodeName: requestedNodeName,
      port: ISAAC_STATION_WEBRTC_PORT,
    };
  }

  for (const pod of params.pods) {
    const owner = ownerFromMetadata(pod.metadata, "Pod");
    if (owner.name === params.requestedOwnerName) continue;
    if (isDeleting(pod.metadata) || isFinishedPod(pod)) continue;
    if (!podUsesWebrtc(owner, pod) || pod.spec?.nodeName !== requestedNodeName) {
      continue;
    }
    if (pod.spec?.hostNetwork === false && !exposesWebrtcPort(pod.spec)) {
      continue;
    }

    return {
      kind: "Pod",
      resourceName: resourceName(pod.metadata),
      owner,
      nodeName: requestedNodeName,
      port: ISAAC_STATION_WEBRTC_PORT,
    };
  }

  return null;
}

export function formatHeadlessWebrtcPortConflict(
  conflict: HeadlessWebrtcPortConflict,
) {
  const owner =
    conflict.owner.type === "station"
      ? `Isaac Station ${conflict.owner.name}`
      : conflict.owner.type === "lab"
        ? `Isaac Lab Job ${conflict.owner.name}`
        : `${conflict.owner.kind} ${conflict.owner.name}`;

  return `节点 ${conflict.nodeName} 的 WebRTC 端口 ${conflict.port}/TCP 已被 ${owner} 占用。请先停止占用该端口的任务，或改用非 WebRTC 模式。`;
}
