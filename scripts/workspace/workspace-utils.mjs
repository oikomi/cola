import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WORKSPACE_MANIFEST_DIR,
  ensureWorkspaceManifestDir,
} from "./paths.mjs";

const WORKSPACE_NODE_PORT_START = Number(
  process.env.COLA_WORKSPACE_NODE_PORT_START ??
    process.env.REMOTE_WORKSPACE_NODE_PORT_START ??
    "31480",
);
const WORKSPACE_NODE_PORT_END = Number(
  process.env.COLA_WORKSPACE_NODE_PORT_END ??
    process.env.REMOTE_WORKSPACE_NODE_PORT_END ??
    "31579",
);

function yamlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function indentBlock(value, spaces) {
  const prefix = " ".repeat(spaces);
  return String(value)
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function defaultCodexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}

function defaultCodexAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function buildCodexSecretData({
  codexConfigPath = "",
  codexAuthPath = "",
  codexSecretName = "",
}) {
  if (codexSecretName) {
    return {
      codexSecretName,
      codexSecretManifest: [],
    };
  }

  const configPath = codexConfigPath || defaultCodexConfigPath();
  const authPath = codexAuthPath || defaultCodexAuthPath();

  if (!fs.existsSync(configPath) || !fs.existsSync(authPath)) {
    throw new Error(
      `缺少 Codex 配置或认证文件：${configPath} / ${authPath}。请确认宿主机 ~/.codex/config.toml 和 ~/.codex/auth.json 存在，或传 --codex-secret-name 使用已有 Secret。`,
    );
  }

  return {
    codexSecretName: "",
    codexSecretManifest: [
      `stringData:`,
      `  config.toml: |-`,
      indentBlock(fs.readFileSync(configPath, "utf8"), 4),
      `  auth.json: |-`,
      indentBlock(fs.readFileSync(authPath, "utf8"), 4),
    ],
  };
}

export function validateWorkspaceName(name) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error("工作区名称必须符合 DNS-1123 简单命名规则。");
  }
}

function isReady(node) {
  const conditions = node?.status?.conditions ?? [];
  return conditions.some(
    (condition) => condition.type === "Ready" && condition.status === "True",
  );
}

function hasGpu(nodeConfig, nodeLive, gpuLabelKey) {
  if (nodeConfig.roles.includes("gpu")) {
    return true;
  }

  if (
    nodeLive?.metadata?.labels?.[gpuLabelKey] === "true" ||
    Number(nodeLive?.status?.allocatable?.["nvidia.com/gpu"] ?? 0) > 0
  ) {
    return true;
  }

  return false;
}

function allocatableGpuCount(nodeLive) {
  const raw = nodeLive?.status?.allocatable?.["nvidia.com/gpu"];
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function selectWorkspaceNode({
  configuredNodes,
  clusterNodes,
  deployments,
  requestGpu,
  requestedNode,
  gpuLabelKey,
  workspaceLabelKey,
}) {
  if (!Number.isInteger(requestGpu) || requestGpu < 0) {
    throw new Error("--gpu 必须是大于等于 0 的整数");
  }

  const liveNodeMap = new Map(
    (clusterNodes.items ?? []).map((node) => [node.metadata?.name, node]),
  );

  const workspaceCounts = new Map();
  for (const item of deployments.items ?? []) {
    if (!item?.metadata?.name?.startsWith("workspace-")) {
      continue;
    }
    const nodeName =
      item?.spec?.template?.spec?.nodeSelector?.["kubernetes.io/hostname"];
    if (!nodeName) {
      continue;
    }
    workspaceCounts.set(nodeName, (workspaceCounts.get(nodeName) ?? 0) + 1);
  }

  let candidates = configuredNodes.filter((node) =>
    node.roles.includes("worker"),
  );
  let requestedNodeName = null;

  if (requestedNode) {
    candidates = candidates.filter(
      (node) => node.name === requestedNode || node.ip === requestedNode,
    );
    if (candidates.length === 0) {
      throw new Error(`指定节点不存在或未配置为 worker: ${requestedNode}`);
    }
    requestedNodeName = candidates[0].name;
  }

  candidates = candidates
    .map((node) => {
      const live = liveNodeMap.get(node.name);
      return {
        node,
        live,
        ready: live ? isReady(live) : false,
        workspaceCount: workspaceCounts.get(node.name) ?? 0,
        gpuCapable: hasGpu(node, live, gpuLabelKey),
        allocatableGpu: allocatableGpuCount(live),
        workspaceLabeled:
          live?.metadata?.labels?.[workspaceLabelKey] === "true",
      };
    })
    .filter((entry) => entry.live && entry.ready);

  if (requestGpu > 0) {
    candidates = candidates.filter(
      (entry) => entry.allocatableGpu >= requestGpu,
    );
  }

  const labeledCandidates = candidates.filter(
    (entry) => entry.workspaceLabeled,
  );
  if (labeledCandidates.length > 0) {
    candidates = labeledCandidates;
  }

  if (candidates.length === 0) {
    if (requestGpu > 0 && requestedNodeName) {
      const requestedLive = liveNodeMap.get(requestedNodeName);
      const allocatable = allocatableGpuCount(requestedLive);
      const ready = requestedLive ? isReady(requestedLive) : false;
      throw new Error(
        `显式指定节点 ${requestedNodeName} 当前不满足 GPU 工作区调度条件：Ready=${ready}，allocatable nvidia.com/gpu=${allocatable}，请求值=${requestGpu}。请先确认 nvidia-device-plugin 已就绪且该节点已向 Kubernetes 上报 GPU 资源。`,
      );
    }
    throw new Error(
      requestGpu > 0
        ? "没有找到 Ready 且 allocatable GPU 足够的候选节点。"
        : "没有找到 Ready 的候选 worker 节点。",
    );
  }

  const minWorkspaceCount = Math.min(
    ...candidates.map((entry) => entry.workspaceCount),
  );
  const leastLoaded = candidates.filter(
    (entry) => entry.workspaceCount === minWorkspaceCount,
  );
  const chosen =
    leastLoaded[Math.floor(Math.random() * leastLoaded.length)] ??
    leastLoaded[0];

  return {
    nodeName: chosen.node.name,
    allowGpuNode:
      requestGpu > 0 && !chosen.node.roles.includes("gpu") && chosen.gpuCapable,
    autoSelected: !requestedNode,
    workspaceCount: chosen.workspaceCount,
    candidateCount: candidates.length,
    reason: requestedNode
      ? `使用显式指定节点 ${chosen.node.name}。`
      : `自动选择 ${chosen.node.name}，在 ${candidates.length} 个候选 Ready 节点中它的现有工作区数量最少（${chosen.workspaceCount}）。`,
  };
}

export function collectUsedNodePorts(services) {
  const ports = new Set();

  for (const item of services.items ?? []) {
    for (const port of item.spec?.ports ?? []) {
      if (port.nodePort) {
        ports.add(Number(port.nodePort));
      }
    }
  }

  return ports;
}

export function resolveWorkspaceNodePort(services, requestedPort) {
  const usedPorts = collectUsedNodePorts(services);

  if (
    requestedPort !== undefined &&
    requestedPort !== null &&
    requestedPort !== ""
  ) {
    const nodePort = Number(requestedPort);
    if (
      !Number.isInteger(nodePort) ||
      nodePort < WORKSPACE_NODE_PORT_START ||
      nodePort > WORKSPACE_NODE_PORT_END
    ) {
      throw new Error(
        `--node-port 必须处于远程桌面 NodePort 区间 ${WORKSPACE_NODE_PORT_START}-${WORKSPACE_NODE_PORT_END}`,
      );
    }
    if (usedPorts.has(nodePort)) {
      throw new Error(`NodePort ${nodePort} 已被占用，请改用其他端口。`);
    }
    return nodePort;
  }

  for (
    let candidate = WORKSPACE_NODE_PORT_START;
    candidate <= WORKSPACE_NODE_PORT_END;
    candidate += 1
  ) {
    if (!usedPorts.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("无法自动分配 NodePort，请手动传 --node-port");
}

export function buildWorkspaceManifest({
  config,
  nodes,
  name,
  nodeName,
  image,
  gpu = 0,
  nodePort,
  resolution = "1600x900x24",
  cpuRequest = "2",
  cpuLimit = "4",
  memoryRequest = "4Gi",
  memoryLimit = "8Gi",
  timezone = "Asia/Shanghai",
  workspaceRoot = "/var/lib/remote-work/workspaces",
  password = "",
  disablePassword = false,
  allowGpuNode = false,
  ingressHost = "",
  tlsSecret = "",
  codexConfigPath = "",
  codexAuthPath = "",
  codexSecretName = "",
  cameraDevicePath = "",
}) {
  validateWorkspaceName(name);

  const targetNode =
    nodes.find((node) => node.name === nodeName) ??
    nodes.find((node) => node.roles.includes("master")) ??
    nodes[0];
  if (!targetNode) {
    throw new Error("没有可用于生成远程桌面访问地址的集群节点。");
  }

  const normalizedGpu = Number(gpu);
  if (!Number.isInteger(normalizedGpu) || normalizedGpu < 0) {
    throw new Error("--gpu 必须是大于等于 0 的整数");
  }
  if (normalizedGpu > 0 && !targetNode.roles.includes("gpu") && !allowGpuNode) {
    throw new Error(
      `节点 ${targetNode.name} 不是 GPU 节点，不能申请 GPU 资源。`,
    );
  }

  const normalizedNodePort = Number(nodePort);
  if (
    !Number.isInteger(normalizedNodePort) ||
    normalizedNodePort < 30000 ||
    normalizedNodePort > 32767
  ) {
    throw new Error("--node-port 必须处于 Kubernetes NodePort 范围内");
  }

  const deploymentName = `workspace-${name}`;
  const secretName = `${deploymentName}-secret`;
  const workspaceCodexSecretName = codexSecretName || `${deploymentName}-codex`;
  const serviceName = `${deploymentName}-svc`;
  const ingressName = `${deploymentName}-ing`;
  const basePath = path.posix.join(workspaceRoot, name);
  const normalizedCameraDevicePath = String(cameraDevicePath).trim();
  if (
    normalizedCameraDevicePath &&
    !/^\/dev\/video\d+$/.test(normalizedCameraDevicePath)
  ) {
    throw new Error(
      "--camera-device-path 只支持 /dev/videoN，例如 /dev/video0",
    );
  }
  const codexSecret = buildCodexSecretData({
    codexConfigPath,
    codexAuthPath,
    codexSecretName,
  });

  const manifest = [
    ...(codexSecret.codexSecretManifest.length > 0
      ? [
          `apiVersion: v1`,
          `kind: Secret`,
          `metadata:`,
          `  name: ${workspaceCodexSecretName}`,
          `  namespace: ${config.workspaceNamespace}`,
          `  labels:`,
          `    app.kubernetes.io/name: remote-workspace`,
          `    remote-work/name: ${name}`,
          `type: Opaque`,
          ...codexSecret.codexSecretManifest,
          `---`,
        ]
      : []),
    ...(!disablePassword
      ? [
          `apiVersion: v1`,
          `kind: Secret`,
          `metadata:`,
          `  name: ${secretName}`,
          `  namespace: ${config.workspaceNamespace}`,
          `  labels:`,
          `    app.kubernetes.io/name: remote-workspace`,
          `    remote-work/name: ${name}`,
          `type: Opaque`,
          `stringData:`,
          `  VNC_PASSWORD: ${yamlQuote(password)}`,
          `---`,
        ]
      : []),
    `apiVersion: apps/v1`,
    `kind: Deployment`,
    `metadata:`,
    `  name: ${deploymentName}`,
    `  namespace: ${config.workspaceNamespace}`,
    `  labels:`,
    `    app.kubernetes.io/name: remote-workspace`,
    `    remote-work/name: ${name}`,
    `spec:`,
    `  replicas: 1`,
    `  selector:`,
    `    matchLabels:`,
    `      remote-work/name: ${name}`,
    `  template:`,
    `    metadata:`,
    `      labels:`,
    `        app.kubernetes.io/name: remote-workspace`,
    `        remote-work/name: ${name}`,
    `    spec:`,
    ...(normalizedGpu > 0 ? [`      runtimeClassName: nvidia`] : []),
    ...(normalizedGpu > 0 ? [`      schedulerName: hami-scheduler`] : []),
    ...(normalizedCameraDevicePath
      ? [
          `      nodeSelector:`,
          `        kubernetes.io/hostname: ${targetNode.name}`,
        ]
      : []),
    `      containers:`,
    `        - name: desktop`,
    `          image: ${yamlQuote(image)}`,
    `          imagePullPolicy: IfNotPresent`,
    `          ports:`,
    `            - containerPort: 6080`,
    `              name: http`,
    `          env:`,
    `            - name: TZ`,
    `              value: ${yamlQuote(timezone)}`,
    `            - name: DISPLAY`,
    `              value: ':1'`,
    `            - name: RESOLUTION`,
    `              value: ${yamlQuote(resolution)}`,
    `            - name: KASMVNC_PORT`,
    `              value: '6080'`,
    `            - name: KASMVNC_SEND_CUT_TEXT`,
    `              value: '1'`,
    `            - name: KASMVNC_ACCEPT_CUT_TEXT`,
    `              value: '1'`,
    `            - name: VNC_DISABLE_PASSWORD`,
    `              value: ${disablePassword ? "'1'" : "'0'"}`,
    `            - name: COLA_CODEX_CONFIG_SOURCE`,
    `              value: /opt/remote-work/codex/config.toml`,
    `            - name: COLA_CODEX_AUTH_SOURCE`,
    `              value: /opt/remote-work/codex/auth.json`,
    ...(!disablePassword
      ? [
          `            - name: VNC_PASSWORD`,
          `              valueFrom:`,
          `                secretKeyRef:`,
          `                  name: ${secretName}`,
          `                  key: VNC_PASSWORD`,
        ]
      : []),
    `          readinessProbe:`,
    `            tcpSocket:`,
    `              port: 6080`,
    `            initialDelaySeconds: 10`,
    `            periodSeconds: 10`,
    `          livenessProbe:`,
    `            tcpSocket:`,
    `              port: 6080`,
    `            initialDelaySeconds: 30`,
    `            periodSeconds: 15`,
    `          resources:`,
    `            requests:`,
    `              cpu: ${yamlQuote(cpuRequest)}`,
    `              memory: ${yamlQuote(memoryRequest)}`,
    `            limits:`,
    `              cpu: ${yamlQuote(cpuLimit)}`,
    `              memory: ${yamlQuote(memoryLimit)}`,
    ...(normalizedGpu > 0
      ? [`              nvidia.com/gpu: ${normalizedGpu}`]
      : []),
    ...(normalizedCameraDevicePath
      ? [
          `          securityContext:`,
          `            privileged: true`,
          `            allowPrivilegeEscalation: true`,
        ]
      : []),
    `          volumeMounts:`,
    `            - name: home`,
    `              mountPath: /home/worker`,
    `            - name: codex`,
    `              mountPath: /opt/remote-work/codex`,
    `              readOnly: true`,
    ...(normalizedCameraDevicePath
      ? [
          `            - name: host-camera`,
          `              mountPath: ${normalizedCameraDevicePath}`,
        ]
      : []),
    `            - name: workspace`,
    `              mountPath: /workspace`,
    `      volumes:`,
    `        - name: home`,
    `          hostPath:`,
    `            path: ${yamlQuote(path.posix.join(basePath, "home"))}`,
    `            type: DirectoryOrCreate`,
    `        - name: codex`,
    `          secret:`,
    `            secretName: ${workspaceCodexSecretName}`,
    ...(normalizedCameraDevicePath
      ? [
          `        - name: host-camera`,
          `          hostPath:`,
          `            path: ${normalizedCameraDevicePath}`,
          `            type: CharDevice`,
        ]
      : []),
    `        - name: workspace`,
    `          hostPath:`,
    `            path: ${yamlQuote(path.posix.join(basePath, "workspace"))}`,
    `            type: DirectoryOrCreate`,
    `---`,
    `apiVersion: v1`,
    `kind: Service`,
    `metadata:`,
    `  name: ${serviceName}`,
    `  namespace: ${config.workspaceNamespace}`,
    `  labels:`,
    `    app.kubernetes.io/name: remote-workspace`,
    `    remote-work/name: ${name}`,
    `spec:`,
    `  type: NodePort`,
    `  selector:`,
    `    remote-work/name: ${name}`,
    `  ports:`,
    `    - name: http`,
    `      port: 6080`,
    `      targetPort: 6080`,
    `      nodePort: ${normalizedNodePort}`,
    ...(ingressHost
      ? [
          `---`,
          `apiVersion: networking.k8s.io/v1`,
          `kind: Ingress`,
          `metadata:`,
          `  name: ${ingressName}`,
          `  namespace: ${config.workspaceNamespace}`,
          `  annotations:`,
          `    nginx.ingress.kubernetes.io/proxy-read-timeout: '86400'`,
          `    nginx.ingress.kubernetes.io/proxy-send-timeout: '86400'`,
          `spec:`,
          `  ingressClassName: nginx`,
          ...(tlsSecret
            ? [
                `  tls:`,
                `    - hosts:`,
                `        - ${ingressHost}`,
                `      secretName: ${tlsSecret}`,
              ]
            : []),
          `  rules:`,
          `    - host: ${ingressHost}`,
          `      http:`,
          `        paths:`,
          `          - path: /`,
          `            pathType: Prefix`,
          `            backend:`,
          `              service:`,
          `                name: ${serviceName}`,
          `                port:`,
          `                  number: 6080`,
        ]
      : []),
  ].join("\n");

  return {
    manifest,
    targetNode,
    normalizedGpu,
    normalizedNodePort,
  };
}

export function buildWorkspaceAccessUrl({
  ingressHost,
  tlsSecret,
  nodeIp,
  nodePort,
}) {
  if (ingressHost) {
    return `${tlsSecret ? "https" : "http"}://${ingressHost}/`;
  }

  return `http://${nodeIp}:${nodePort}/`;
}

export function prepareWorkspace({
  config,
  nodes,
  clusterNodes,
  deployments,
  services,
  request,
}) {
  const normalizedGpu = Number(request.gpu ?? "0");
  const selection = selectWorkspaceNode({
    configuredNodes: nodes,
    clusterNodes,
    deployments,
    requestGpu: normalizedGpu,
    requestedNode: request.requestedNode,
    gpuLabelKey: request.gpuLabelKey,
    workspaceLabelKey: request.workspaceLabelKey,
  });

  const nodePort = resolveWorkspaceNodePort(services, request.nodePort);
  const disablePassword = request.disablePassword === true;
  const password = request.password ?? "";

  const { manifest, targetNode } = buildWorkspaceManifest({
    config,
    nodes,
    name: request.name,
    nodeName: selection.nodeName,
    image: request.image,
    gpu: normalizedGpu,
    nodePort,
    resolution: request.resolution,
    cpuRequest: request.cpuRequest,
    cpuLimit: request.cpuLimit,
    memoryRequest: request.memoryRequest,
    memoryLimit: request.memoryLimit,
    timezone: request.timezone,
    workspaceRoot: request.workspaceRoot,
    password,
    disablePassword,
    allowGpuNode: selection.allowGpuNode,
    ingressHost: request.ingressHost,
    tlsSecret: request.tlsSecret,
    codexConfigPath: request.codexConfigPath,
    codexAuthPath: request.codexAuthPath,
    codexSecretName: request.codexSecretName,
  });

  ensureWorkspaceManifestDir();
  const manifestPath =
    request.out ?? path.join(WORKSPACE_MANIFEST_DIR, `${request.name}.yaml`);
  fs.writeFileSync(manifestPath, `${manifest}\n`, "utf8");

  return {
    ...selection,
    nodeIp: targetNode.ip,
    nodePort,
    manifestPath,
    accessUrl: buildWorkspaceAccessUrl({
      ingressHost: request.ingressHost,
      tlsSecret: request.tlsSecret,
      nodeIp: targetNode.ip,
      nodePort,
    }),
  };
}
