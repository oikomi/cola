import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const TOKEN_COMMAND_TIMEOUT_MS = 90_000;
const CLUSTER_DIR = path.join(process.cwd(), "infra", "k8s", "cluster");
const DASHBOARD_NAMESPACE = "kubernetes-dashboard";
const DASHBOARD_SERVICE_ACCOUNT = "admin-user";
const DASHBOARD_SECRET_NAME = "admin-user-token";
const REMOTE_TOKEN_SCRIPT = `
set -eu

KUBECTL="/opt/kube/bin/kubectl --kubeconfig /root/.kube/config"
NAMESPACE="${DASHBOARD_NAMESPACE}"
SECRET_NAME="${DASHBOARD_SECRET_NAME}"

cat <<'YAML' | $KUBECTL apply -f - >/dev/null
apiVersion: v1
kind: ServiceAccount
metadata:
  name: admin-user
  namespace: kubernetes-dashboard
---
apiVersion: v1
kind: Secret
metadata:
  name: admin-user-token
  namespace: kubernetes-dashboard
  annotations:
    kubernetes.io/service-account.name: admin-user
type: kubernetes.io/service-account-token
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kubernetes-dashboard-admin-user
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: admin-user
    namespace: kubernetes-dashboard
YAML

elapsed=0
while [ "$elapsed" -lt 60 ]; do
  token_b64="$($KUBECTL -n "$NAMESPACE" get secret "$SECRET_NAME" -o jsonpath='{.data.token}' 2>/dev/null || true)"
  if [ -n "$token_b64" ]; then
    printf '\\n__COLA_DASHBOARD_TOKEN_BEGIN__\\n'
    printf '%s' "$token_b64"
    printf '\\n__COLA_DASHBOARD_TOKEN_END__\\n'
    exit 0
  fi

  sleep 3
  elapsed=$((elapsed + 3))
done

echo "Secret $SECRET_NAME was not populated with a dashboard token." >&2
exit 1
`.trim();

type ClusterConfig = {
  controllerIp?: unknown;
};

type ClusterNode = {
  ip?: unknown;
  sshUser?: unknown;
  sshPassword?: unknown;
  sshPort?: unknown;
};

function jsonResponse(body: { token: string } | { error: string }, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function readControllerNode() {
  const config = JSON.parse(
    readFileSync(path.join(CLUSTER_DIR, "config.json"), "utf8"),
  ) as ClusterConfig;
  const nodes = JSON.parse(
    readFileSync(path.join(CLUSTER_DIR, "nodes.json"), "utf8"),
  ) as ClusterNode[];

  const controllerIp =
    typeof config.controllerIp === "string" ? config.controllerIp : "";
  const controllerNode = nodes.find((node) => node.ip === controllerIp);

  if (!controllerNode) {
    throw new Error(`未在 infra/k8s/cluster/nodes.json 中找到 controller 节点 ${controllerIp}`);
  }

  const sshUser =
    typeof controllerNode.sshUser === "string" ? controllerNode.sshUser : "";
  const sshPassword =
    typeof controllerNode.sshPassword === "string"
      ? controllerNode.sshPassword
      : "";
  const sshPort =
    typeof controllerNode.sshPort === "number"
      ? String(controllerNode.sshPort)
      : "22";

  if (!controllerIp || !sshUser || !sshPassword) {
    throw new Error("controller 节点缺少 ip、sshUser 或 sshPassword。");
  }

  return {
    ip: controllerIp,
    password: sshPassword,
    port: sshPort,
    user: sshUser,
  };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function dashboardTokenErrorMessage(error: unknown) {
  const maybeChildProcessError = error as { stderr?: unknown; stdout?: unknown };
  const stderr =
    typeof maybeChildProcessError.stderr === "string"
      ? maybeChildProcessError.stderr.trim()
      : "";
  const stdout =
    typeof maybeChildProcessError.stdout === "string"
      ? maybeChildProcessError.stdout.trim()
      : "";

  if (stderr) {
    return cleanCommandOutput(stderr);
  }

  if (stdout) {
    return cleanCommandOutput(stdout);
  }

  const message =
    error instanceof Error
      ? error.message.replace(/^Command failed:[\s\S]*?\n/, "")
      : "";

  return message.trim()
    ? cleanCommandOutput(message)
    : "读取 Kubernetes Dashboard Token 失败。";
}

function cleanCommandOutput(output: string) {
  return output
    .replace(
      /__COLA_DASHBOARD_TOKEN_BEGIN__[\s\S]*?__COLA_DASHBOARD_TOKEN_END__/g,
      "[dashboard token redacted]",
    )
    .replace(/^ERROR:\s*/, "")
    .trim();
}

async function readTokenWithLocalScript() {
  const scriptPath = path.join(
    process.cwd(),
    "infra",
    "k8s",
    "bin",
    "cluster.sh",
  );

  const { stdout } = await execFileAsync(scriptPath, ["dashboard", "token"], {
    cwd: path.join(process.cwd(), "infra", "k8s"),
    timeout: TOKEN_COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });

  return stdout.trim();
}

async function readTokenFromController() {
  const controller = readControllerNode();
  const remoteCommand = `sudo -S sh -c ${shellQuote(REMOTE_TOKEN_SCRIPT)}`;
  const expectScript = `
set timeout 90
set password $env(COLA_NODE_PASSWORD)
set user $env(COLA_NODE_USER)
set host $env(COLA_NODE_HOST)
set port $env(COLA_NODE_PORT)
set remote_command $env(COLA_REMOTE_COMMAND)
set output ""

spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -p $port "$user@$host" $remote_command
expect {
  -re "(?i)are you sure you want to continue connecting" {
    append output $expect_out(buffer)
    send -- "yes\\r"
    exp_continue
  }
  -re "(?i)password.*:" {
    append output $expect_out(buffer)
    send -- "$password\\r"
    exp_continue
  }
  eof {
    append output $expect_out(buffer)
  }
}
puts -nonewline $output

set wait_status [wait]
if {[llength $wait_status] >= 4} {
  set os_error [lindex $wait_status 2]
  set exit_status [lindex $wait_status 3]
  if {$os_error == 0} {
    exit $exit_status
  }
}
exit 1
`.trim();

  const { stdout } = await execFileAsync(
    "expect",
    ["-c", expectScript],
    {
      timeout: TOKEN_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        COLA_NODE_HOST: controller.ip,
        COLA_NODE_PASSWORD: controller.password,
        COLA_NODE_PORT: controller.port,
        COLA_NODE_USER: controller.user,
        COLA_REMOTE_COMMAND: remoteCommand,
      },
    },
  );

  const tokenMatch = stdout.match(
    /__COLA_DASHBOARD_TOKEN_BEGIN__\s*([A-Za-z0-9+/=]+)\s*__COLA_DASHBOARD_TOKEN_END__/,
  );

  if (!tokenMatch) {
    throw new Error(cleanCommandOutput(stdout) || "controller 节点未返回 Dashboard Token。");
  }

  const tokenBase64 = tokenMatch[1];
  if (!tokenBase64) {
    throw new Error("controller 节点返回了空 Dashboard Token。");
  }

  return Buffer.from(tokenBase64, "base64").toString("utf8").trim();
}

export async function POST() {
  try {
    let token = "";

    try {
      token = await readTokenWithLocalScript();
    } catch (error) {
      try {
        token = await readTokenFromController();
      } catch (fallbackError) {
        throw new Error(
          `本机 kubeconfig 不可用，controller 节点读取 Token 也失败：${dashboardTokenErrorMessage(fallbackError)}。本机错误：${dashboardTokenErrorMessage(error)}`,
        );
      }
    }

    if (!token) {
      return jsonResponse(
        { error: "Dashboard Token 为空，请检查 admin-user-token Secret。" },
        502,
      );
    }

    return jsonResponse({ token });
  } catch (error) {
    return jsonResponse(
      {
        error: dashboardTokenErrorMessage(error),
      },
      500,
    );
  }
}
