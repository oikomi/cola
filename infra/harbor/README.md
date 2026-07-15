# Harbor 镜像仓库部署

这个目录用于把 Harbor 部署到当前 Kubernetes 集群中。Harbor 本体版本固定为用户指定的 `v2.14.4`。

当前集群信息只以 `../k8s/cluster/config.json` 和 `../k8s/cluster/nodes.json` 为准：

- cluster: `xdream-cloud`
- controllerIp: `172.16.60.198`
- nodes: `master-01`, `node-01`

## 部署方式

Harbor 官方仓库是 `https://github.com/goharbor/harbor`，Kubernetes Helm 部署入口使用官方 `harbor-helm` chart：

- Helm repo: `https://helm.goharbor.io`
- 默认 chart version: `1.18.3`
- Harbor image tag: `v2.14.4`

脚本会用 Helm 安装 chart，并把 Harbor 各组件镜像 tag 统一覆盖成 `v2.14.4`。如果后续官方发布了专门对应 `v2.14.4` 的 harbor-helm patch 版本，只需要调整 `HARBOR_CHART_VERSION`。

## 快速开始

复制配置并修改密码：

```bash
cd infra/harbor
cp harbor.env.example harbor.env
vim harbor.env
```

必须修改这些值：

```bash
HARBOR_ADMIN_PASSWORD=...
HARBOR_SECRET_KEY=...
HARBOR_REGISTRY_CREDENTIAL_PASSWORD=...
```

先渲染和 dry-run：

```bash
./deploy.sh render-values --env-file harbor.env
./deploy.sh render-service --env-file harbor.env
./deploy.sh install --dry-run --env-file harbor.env
```

正式部署：

```bash
./deploy.sh install --env-file harbor.env
```

查看状态：

```bash
./deploy.sh status --env-file harbor.env
```

健康检查：

```bash
./deploy.sh smoke-test --env-file harbor.env
```

## 访问地址

默认使用 NodePort 暴露给局域网：

```text
http://172.16.60.198:32248
```

登录账号：

```text
admin
```

密码来自 `HARBOR_ADMIN_PASSWORD`。

Docker 登录：

```bash
docker login 172.16.60.198:32248
```

因为默认是 HTTP，Docker/containerd 客户端需要把 `172.16.60.198:32248` 配成 insecure registry。不要把这个 HTTP NodePort 暴露到公网。

## 作为集群镜像代理

Harbor 的部署入口和集群实际使用的 Harbor 可以不同。Kubernetes 节点的镜像加速地址只以 `../k8s/cluster/config.json` 中的 `harbor` 配置为准；当前集群使用的是已有实例 `http://172.16.60.198:21726`，不会由本目录的 Helm 默认值覆盖。

配置已有 Harbor 的 proxy cache 项目并下发 containerd 镜像源：

```bash
cd ../k8s
read -r -s COLA_HARBOR_PASSWORD
export COLA_HARBOR_PASSWORD
./bin/cluster.sh registry configure
./bin/cluster.sh registry status
unset COLA_HARBOR_PASSWORD
```

密码只通过进程环境传递，不应写入 `cluster/config.json`。命令会保留原始公网 registry 作为 Harbor 故障时的回退源。

## 存储

默认开启持久化：

```bash
HARBOR_PERSISTENCE_ENABLED=true
HARBOR_REGISTRY_SIZE=200Gi
HARBOR_DATABASE_SIZE=10Gi
HARBOR_REDIS_SIZE=5Gi
HARBOR_TRIVY_SIZE=10Gi
```

如果集群有可用 StorageClass，可以显式设置：

```bash
HARBOR_STORAGE_CLASS=cola-rbd
```

如果没有默认 StorageClass，安装会卡在 PVC Pending，需要先部署可用存储，例如 Rook-Ceph 或其他 CSI。

## 卸载

```bash
./deploy.sh uninstall --env-file harbor.env
```

注意：卸载 Helm release 不会删除 PVC。确认镜像仓库数据不再需要后，再手工清理 PVC。
