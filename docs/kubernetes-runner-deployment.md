# Kubernetes Runner 部署说明

## 适用范围

当 Cola Web 控制面部署在 Kubernetes 集群附近，并希望在创建人物时把
OpenClaw / Hermes runner 作为 Kubernetes Deployment 拉起时，使用本说明。

当前实现不会替换 worker 协议或前端页面，只替换 runner 的 provision 方式。

## 启用方式

当前人物管理默认就走 `kubernetes` 运行时。

只有在你显式设置下面的值时，才会退回 Docker：

```env
COLA_RUNNER_RUNTIME=docker
```

## 必要条件

- Web 控制面所在环境能读取 kubeconfig 或具备 in-cluster auth
- Web 控制面对目标集群具备 Deployment、Service、Secret、ConfigMap 的读写权限
- runner pod 能访问 Cola 控制面 `/api/worker/*`
- runner pod 能拿到 Codex 配置与认证信息

## 推荐环境变量

```env
COLA_K8S_RUNNER_NAMESPACE=cola-runners
COLA_K8S_KUBECONFIG=/etc/kubeasz/clusters/remote-work/kubectl.kubeconfig
COLA_K8S_API_BASE_URL=http://cola-web.default.svc.cluster.local:3000
COLA_K8S_RUNNER_PUBLIC_HOST=your-node-or-domain.example.com
COLA_K8S_CODEX_SECRET_NAME=cola-codex
```

说明：

- `COLA_K8S_RUNNER_NAMESPACE`
  runner Deployment / Service / Secret / ConfigMap 的目标命名空间
- `COLA_K8S_KUBECONFIG`
  如果不走 in-cluster auth，指定 kubeconfig 路径
- `COLA_K8S_API_BASE_URL`
  runner pod 回调 Cola 控制面的地址
- `COLA_K8S_RUNNER_PUBLIC_HOST`
  用于拼接 NodePort dashboard URL
- `COLA_K8S_CODEX_SECRET_NAME`
  已存在的 Secret，需包含 `config.toml` 和 `auth.json`

## 可选环境变量

```env
COLA_K8S_RUNNER_NODE_NAME=rw-node-022
COLA_K8S_WORKSPACE_HOST_PATH=/home/charles/remotework/cola
COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST=openclaw.example.com
COLA_HERMES_DASHBOARD_PUBLIC_HOST=hermes.example.com
COLA_OPENCLAW_DISABLE_DEVICE_IDENTITY=1
```

说明：

- `COLA_K8S_RUNNER_NODE_NAME`
  强制把 runner 调度到指定节点
- `COLA_K8S_WORKSPACE_HOST_PATH`
  使用 hostPath 挂载真实工作目录到 `/workspace`
  未设置时会回退到 `emptyDir`
- `COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST` / `COLA_HERMES_DASHBOARD_PUBLIC_HOST`
  为不同引擎单独指定外部访问主机名

## 当前实现特点

- OpenClaw / Hermes bootstrap 脚本通过 ConfigMap 注入到 pod
- Codex 配置优先从已存在的 Secret 读取
- 如果没配置 `COLA_K8S_CODEX_SECRET_NAME`，控制面会尝试从本地文件创建每个 runner 自己的 Secret
- dashboard 通过 NodePort 暴露
- 如果前端配置了 `NEXT_PUBLIC_OPENCLAW_NATIVE_URL` / `NEXT_PUBLIC_HERMES_NATIVE_URL`，人物卡仍会优先打开 Cola 自带工作区页

## 当前限制

- 已支持在人物删除时清理 runner 的 Kubernetes 资源
- 如果不挂载真实工作目录，runner 会在 `emptyDir` 里工作
- 目前仍复用现有 `deviceType` 枚举，数据库里设备类型名还保留 `docker_*`
