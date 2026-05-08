# JuiceFS 一键部署

这个目录用于把 JuiceFS CSI Driver 部署到当前项目的 Kubernetes 集群，并按本地配置创建 JuiceFS Secret 和 StorageClass。

集群信息只读取 `../k8s/cluster/config.json`，脚本会使用其中的 `clusterName` 解析 kubeconfig：

1. 优先使用当前环境变量 `KUBECONFIG`
2. 然后使用 `~/.kube/<clusterName>.config`
3. 最后回退到 `/etc/kubeasz/clusters/<clusterName>/kubectl.kubeconfig`

## 使用

```bash
cd infra/juicefs
cp juicefs.env.example juicefs.env
vim juicefs.env
./deploy.sh
```

默认动作等价于：

```bash
./deploy.sh install --env-file juicefs.env
```

脚本会执行：

- 添加并更新 JuiceFS 官方 Helm 仓库
- 安装或升级 `juicefs/juicefs-csi-driver`
- 根据 `juicefs.env` 创建 Kubernetes Secret
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

真实连接信息只放在本地 `juicefs.env`，该文件已被当前目录 `.gitignore` 忽略。

必须配置：

- `JUICEFS_NAME`：JuiceFS 文件系统名称
- `JUICEFS_METAURL`：元数据引擎地址，例如 Redis/MySQL/PostgreSQL
- `JUICEFS_STORAGE`：对象存储类型，例如 `s3`、`oss`、`minio`
- `JUICEFS_BUCKET`：对象存储 bucket 地址

如果 JuiceFS 文件系统已经在集群外格式化过，可以设置 `JUICEFS_EXISTING_VOLUME=1`，脚本就只要求 `JUICEFS_NAME` 和 `JUICEFS_METAURL`。

常用可选项：

- `JUICEFS_ACCESS_KEY` / `JUICEFS_SECRET_KEY`：对象存储访问凭据
- `JUICEFS_FORMAT_OPTIONS`：传给 `juicefs format` 的额外参数
- `JUICEFS_MOUNT_OPTIONS`：逗号分隔的 StorageClass mountOptions
- `JUICEFS_SET_DEFAULT_STORAGECLASS=1`：设为默认 StorageClass
- `JUICEFS_CHART_VERSION`：固定 JuiceFS CSI Helm chart 版本

## 参考

- JuiceFS CSI Driver: https://juicefs.com/docs/csi/
- Helm 安装: https://juicefs.com/docs/csi/getting_started/
- PV/StorageClass 配置: https://juicefs.com/docs/csi/guide/pv/
