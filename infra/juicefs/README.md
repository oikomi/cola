# JuiceFS 一键部署

这个目录用于把 JuiceFS CSI Driver 部署到当前项目的 Kubernetes 集群，并创建 JuiceFS Secret 和 StorageClass。

当前推荐把 JuiceFS 后端接到 `../seaweedfs` 部署出来的 SeaweedFS S3，而不是继续使用单节点 MinIO。旧的内置 Redis + MinIO 本地 backend 仍保留用于临时测试，但它是单节点 `hostPath`，不是真正的分布式存储。

集群信息只读取 `../k8s/cluster/config.json`，脚本会使用其中的 `clusterName` 解析 kubeconfig：

1. 优先使用当前环境变量 `KUBECONFIG`
2. 然后使用 `~/.kube/<clusterName>.config`
3. 最后回退到 `/etc/kubeasz/clusters/<clusterName>/kubectl.kubeconfig`

## 使用

推荐先部署 SeaweedFS：

```bash
cd infra/seaweedfs
cp seaweedfs.env.example seaweedfs.env
vim seaweedfs.env
./deploy.sh install --env-file seaweedfs.env
./deploy.sh render-juicefs-env --env-file seaweedfs.env
```

把 `render-juicefs-env` 输出写入 `infra/juicefs/juicefs.env` 后，再部署 JuiceFS：

```bash
cd infra/juicefs
./deploy.sh install --env-file juicefs.env
```

如果没有 `juicefs.env`，脚本会使用内置 Redis + MinIO 单节点 backend。这只适合临时测试。

脚本会执行：

- 可选：在 `storage` namespace 部署旧的 Redis 和 MinIO 本地 backend
- 添加并更新 JuiceFS 官方 Helm 仓库
- 安装或升级 `juicefs/juicefs-csi-driver`
- 创建 Kubernetes Secret
- 创建或更新 StorageClass

## 常用命令

```bash
./deploy.sh status
./deploy.sh render-storageclass --env-file juicefs.env
./deploy.sh install --dry-run --env-file juicefs.env
./deploy.sh uninstall
```

只安装 CSI Driver、不创建 Secret 和 StorageClass：

```bash
JUICEFS_CREATE_STORAGECLASS=0 ./deploy.sh install
```

## 配置说明

推荐 SeaweedFS 后端配置类似：

```bash
JUICEFS_LOCAL_BACKEND=0
JUICEFS_METADATA_REDIS=1
JUICEFS_METADATA_REDIS_NAMESPACE=storage
JUICEFS_METADATA_REDIS_NAME=juicefs-redis
JUICEFS_NAME=cola-juicefs
JUICEFS_METAURL=redis://juicefs-redis.storage.svc.cluster.local:6379/1
JUICEFS_STORAGE=s3
JUICEFS_BUCKET=http://seaweedfs-s3.storage.svc.cluster.local:8333/cola-juicefs
JUICEFS_ACCESS_KEY=...
JUICEFS_SECRET_KEY=...
JUICEFS_STORAGECLASS_NAME=juicefs-sc
```

不配置 `juicefs.env` 时会使用旧的内置 backend 默认值：

- `JUICEFS_LOCAL_BACKEND=1`
- `JUICEFS_LOCAL_BACKEND_NAMESPACE=storage`
- `JUICEFS_LOCAL_BACKEND_NODE_NAME=`：留空自动从 `../k8s/cluster/nodes.json` 选择非 master worker
- `JUICEFS_LOCAL_BACKEND_ROOT=/var/lib/cola/juicefs`
- `JUICEFS_NAME=cola-juicefs`
- `JUICEFS_STORAGECLASS_NAME=juicefs-sc`
- `JUICEFS_METAURL=redis://juicefs-redis.storage.svc.cluster.local:6379/1`
- `JUICEFS_STORAGE=minio`
- `JUICEFS_BUCKET=http://juicefs-minio.storage.svc.cluster.local:9000/cola-juicefs`

如需覆盖默认节点、目录、镜像或凭据，可以复制示例文件：

```bash
cp juicefs.env.example juicefs.env
vim juicefs.env
./deploy.sh
```

真实连接信息只放在本地 `juicefs.env`，该文件已被当前目录 `.gitignore` 忽略。

必须配置：

- `JUICEFS_NAME`：JuiceFS 文件系统名称
- `JUICEFS_METAURL`：元数据引擎地址，例如 Redis/MySQL/PostgreSQL；默认使用集群内 Redis
- `JUICEFS_STORAGE`：对象存储类型，例如 `s3`、`oss`、`minio`；默认使用集群内 MinIO
- `JUICEFS_BUCKET`：对象存储 bucket 地址；默认使用集群内 MinIO bucket

如果 JuiceFS 文件系统已经在集群外格式化过，可以设置 `JUICEFS_EXISTING_VOLUME=1`，脚本就只要求 `JUICEFS_NAME` 和 `JUICEFS_METAURL`。

如果要使用外部对象存储而不是节点硬盘，设置 `JUICEFS_LOCAL_BACKEND=0`，并在 `juicefs.env` 中填写 `JUICEFS_METAURL`、`JUICEFS_STORAGE`、`JUICEFS_BUCKET` 和访问凭据。

常用可选项：

- `JUICEFS_LOCAL_BACKEND_NODE_NAME`：指定 Redis/MinIO 固定落盘的 Kubernetes 节点名
- `JUICEFS_LOCAL_BACKEND_ROOT`：节点上的 hostPath 根目录
- `JUICEFS_ACCESS_KEY` / `JUICEFS_SECRET_KEY`：对象存储访问凭据
- `JUICEFS_FORMAT_OPTIONS`：传给 `juicefs format` 的额外参数
- `JUICEFS_MOUNT_OPTIONS`：逗号分隔的 StorageClass mountOptions
- `JUICEFS_SET_DEFAULT_STORAGECLASS=1`：设为默认 StorageClass
- `JUICEFS_CHART_VERSION`：固定 JuiceFS CSI Helm chart 版本

## 参考

- JuiceFS CSI Driver: https://juicefs.com/docs/csi/
- Helm 安装: https://juicefs.com/docs/csi/getting_started/
- PV/StorageClass 配置: https://juicefs.com/docs/csi/guide/pv/
