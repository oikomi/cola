import fs from "node:fs";
import path from "node:path";
import {
  WORKSPACE_DIR,
  ensureRuntimeDirs,
  readClusterData,
} from "./cluster-utils.mjs";

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`无法解析参数: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${token} 缺少值`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

function yamlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const args = parseArgs(process.argv);

for (const key of ["name", "node", "image", "node-port"]) {
  if (!args[key]) {
    throw new Error(`缺少必要参数 --${key}`);
  }
}

if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(args.name)) {
  throw new Error("工作区名称必须符合 DNS-1123 简单命名规则。");
}

const { config, nodes } = readClusterData();
const targetNode = nodes.find((node) => node.name === args.node);
if (!targetNode) {
  throw new Error(`目标节点不存在: ${args.node}`);
}

const gpu = Number(args.gpu ?? "0");
if (!Number.isInteger(gpu) || gpu < 0) {
  throw new Error("--gpu 必须是大于等于 0 的整数");
}
if (
  gpu > 0 &&
  !targetNode.roles.includes("gpu") &&
  args["allow-gpu-node"] !== "1"
) {
  throw new Error(`节点 ${targetNode.name} 不是 GPU 节点，不能申请 GPU 资源。`);
}

const cpuRequest = args["cpu-request"] ?? "2";
const cpuLimit = args["cpu-limit"] ?? "4";
const memoryRequest = args["memory-request"] ?? "4Gi";
const memoryLimit = args["memory-limit"] ?? "8Gi";
const resolution = args.resolution ?? "1920x1080x24";
const timezone = args.timezone ?? "Asia/Shanghai";
const workspaceRoot = args["workspace-root"] ?? "/var/lib/remote-work/workspaces";
const nodePort = Number(args["node-port"]);
if (!Number.isInteger(nodePort) || nodePort < 30000 || nodePort > 32767) {
  throw new Error("--node-port 必须处于 Kubernetes NodePort 范围内");
}

const deploymentName = `workspace-${args.name}`;
const secretName = `${deploymentName}-secret`;
const serviceName = `${deploymentName}-svc`;
const ingressName = `${deploymentName}-ing`;
const basePath = path.posix.join(workspaceRoot, args.name);
const disablePassword = args["disable-password"] === "1";

const manifest = [
  ...(!disablePassword
    ? [
        `apiVersion: v1`,
        `kind: Secret`,
        `metadata:`,
        `  name: ${secretName}`,
        `  namespace: ${config.workspaceNamespace}`,
        `  labels:`,
        `    app.kubernetes.io/name: remote-workspace`,
        `    remote-work/name: ${args.name}`,
        `type: Opaque`,
        `stringData:`,
        `  VNC_PASSWORD: ${yamlQuote(args.password ?? "")}`,
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
  `    remote-work/name: ${args.name}`,
  `spec:`,
  `  replicas: 1`,
  `  selector:`,
  `    matchLabels:`,
  `      remote-work/name: ${args.name}`,
  `  template:`,
  `    metadata:`,
  `      labels:`,
  `        app.kubernetes.io/name: remote-workspace`,
  `        remote-work/name: ${args.name}`,
  `    spec:`,
  ...(gpu > 0 ? [`      runtimeClassName: nvidia`] : []),
  `      nodeSelector:`,
  `        kubernetes.io/hostname: ${yamlQuote(targetNode.name)}`,
  `      containers:`,
  `        - name: desktop`,
  `          image: ${yamlQuote(args.image)}`,
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
  `            - name: NOVNC_PORT`,
  `              value: '6080'`,
  `            - name: VNC_PORT`,
  `              value: '5901'`,
  `            - name: VNC_DISABLE_PASSWORD`,
  `              value: ${disablePassword ? "'1'" : "'0'"}`,
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
  `            httpGet:`,
  `              path: /vnc.html`,
  `              port: 6080`,
  `            initialDelaySeconds: 10`,
  `            periodSeconds: 10`,
  `          livenessProbe:`,
  `            httpGet:`,
  `              path: /vnc.html`,
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
  ...(gpu > 0 ? [`              nvidia.com/gpu: ${gpu}`] : []),
  `          volumeMounts:`,
  `            - name: home`,
  `              mountPath: /home/worker`,
  `            - name: workspace`,
  `              mountPath: /workspace`,
  `      volumes:`,
  `        - name: home`,
  `          hostPath:`,
  `            path: ${yamlQuote(path.posix.join(basePath, "home"))}`,
  `            type: DirectoryOrCreate`,
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
  `    remote-work/name: ${args.name}`,
  `spec:`,
  `  type: NodePort`,
  `  selector:`,
  `    remote-work/name: ${args.name}`,
  `  ports:`,
  `    - name: http`,
  `      port: 6080`,
  `      targetPort: 6080`,
  `      nodePort: ${nodePort}`,
  ...(args["ingress-host"]
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
        ...(args["tls-secret"]
          ? [
              `  tls:`,
              `    - hosts:`,
              `        - ${args["ingress-host"]}`,
              `      secretName: ${args["tls-secret"]}`,
            ]
          : []),
        `  rules:`,
        `    - host: ${args["ingress-host"]}`,
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

ensureRuntimeDirs();
const outFile =
  args.out ?? path.join(WORKSPACE_DIR, `${args.name}.yaml`);
fs.writeFileSync(outFile, `${manifest}\n`, "utf8");

console.log(outFile);
