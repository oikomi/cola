import path from "node:path";

type RuntimeEnv = Record<string, string | undefined>;

export const DEFAULT_ISAAC_LAB_SSH_GATEWAY_PORT = 2222;
export const DEFAULT_ISAAC_LAB_SSH_GATEWAY_LISTEN_HOST = "0.0.0.0";

function envValue(env: RuntimeEnv, name: string) {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function parseTcpPort(value: string | null, name: string) {
  if (!value) return null;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1-65535 之间的 TCP 端口。`);
  }

  return port;
}

export function resolveIsaacLabSshGatewayListenHost(
  env: RuntimeEnv = process.env,
) {
  return (
    envValue(env, "COLA_ISAAC_LAB_SSH_GATEWAY_HOST") ??
    DEFAULT_ISAAC_LAB_SSH_GATEWAY_LISTEN_HOST
  );
}

export function resolveIsaacLabSshGatewayPort(env: RuntimeEnv = process.env) {
  return (
    parseTcpPort(
      envValue(env, "COLA_ISAAC_LAB_SSH_GATEWAY_PORT"),
      "COLA_ISAAC_LAB_SSH_GATEWAY_PORT",
    ) ?? DEFAULT_ISAAC_LAB_SSH_GATEWAY_PORT
  );
}

export function resolveIsaacLabSshGatewayPublicPort(
  env: RuntimeEnv = process.env,
) {
  return (
    parseTcpPort(
      envValue(env, "COLA_ISAAC_LAB_SSH_PUBLIC_PORT"),
      "COLA_ISAAC_LAB_SSH_PUBLIC_PORT",
    ) ?? resolveIsaacLabSshGatewayPort(env)
  );
}

export function resolveIsaacLabSshGatewayPublicHost(input: {
  env?: RuntimeEnv;
  controllerIp?: string | null;
}) {
  const env = input.env ?? process.env;
  const explicitHost = envValue(env, "COLA_ISAAC_LAB_SSH_PUBLIC_HOST");
  if (explicitHost) return explicitHost;

  const publicBaseUrl = envValue(env, "AUTH_PUBLIC_BASE_URL");
  if (publicBaseUrl) {
    try {
      const url = new URL(publicBaseUrl);
      if (url.hostname) return url.hostname;
    } catch {
      // Ignore malformed base URL and fall back to infra/k8s/cluster config.
    }
  }

  return input.controllerIp?.trim() ?? null;
}

export function resolveIsaacLabSshGatewayPassword(
  env: RuntimeEnv = process.env,
) {
  return (
    envValue(env, "COLA_ISAAC_LAB_SSH_PASSWORD") ??
    envValue(env, "COLA_ISAAC_LAB_SSH_GATEWAY_PASSWORD")
  );
}

export function resolveIsaacLabSshGatewayHostKeyPath(
  env: RuntimeEnv = process.env,
) {
  return (
    envValue(env, "COLA_ISAAC_LAB_SSH_HOST_KEY_PATH") ??
    path.join(process.cwd(), "runtime", "isaac-lab-ssh-gateway", "host_key")
  );
}

export function buildIsaacLabSshCommand(input: {
  jobName: string;
  host: string | null;
  port: number | null;
}) {
  if (!input.host || !input.port) return null;

  const host = input.host.includes(":") ? `[${input.host}]` : input.host;
  if (input.port === 22) {
    return `ssh ${input.jobName}@${host}`;
  }

  return `ssh -p ${input.port} ${input.jobName}@${host}`;
}

export function buildIsaacLabSshCommandForJob(input: {
  jobName: string;
  status: "running" | "pending" | "completed" | "failed";
  podName: string | null;
  controllerIp?: string | null;
  env?: RuntimeEnv;
}) {
  if (input.status !== "running" || !input.podName) return null;

  const env = input.env ?? process.env;
  return buildIsaacLabSshCommand({
    jobName: input.jobName,
    host: resolveIsaacLabSshGatewayPublicHost({
      env,
      controllerIp: input.controllerIp,
    }),
    port: resolveIsaacLabSshGatewayPublicPort(env),
  });
}
