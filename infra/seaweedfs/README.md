# SeaweedFS 轻量分布式对象存储

这个目录只部署 SeaweedFS，不部署 JuiceFS、CSI Driver、StorageClass 或 PVC。

它给当前 Kubernetes 集群提供一个 S3-compatible 对象存储，适合保存：

- 数据集压缩包、JSONL、Parquet 等训练输入
- checkpoint、模型权重、训练产物归档
- JupyterLab / Unsloth Studio 需要通过 S3 API 读写的文件

纯 SeaweedFS 不会直接提供 `500Gi` 这种 Kubernetes PVC 工作目录。如果训练平台需要把 `/workspace` 挂成 `ReadWriteMany` 文件系统，仍然需要 JuiceFS、CephFS、Longhorn/NFS 这一类 CSI 存储。

## 架构

```text
SeaweedFS
  master: 元数据调度
  volume: 数据块存储，使用节点 hostPath
  filer: 文件命名空间
  s3: S3-compatible API
  admin: 官方 Web Admin UI

训练平台 / JupyterLab / Unsloth Studio
  通过 S3 endpoint + bucket + AK/SK 访问 SeaweedFS
```

当前集群信息以 `infra/k8s/cluster` 为准：

- cluster: `xdream-cloud`
- namespace: `storage`
- nodes: `master-01`, `node-01`

你当前两台机器都只有系统盘，没有独立数据盘。默认配置可以跑通和验证，但不是生产级可靠存储；生产环境建议至少 3 个 volume 节点，并把 `SEAWEEDFS_DATA_ROOT` 指到独立数据盘。

## 部署

复制配置：

```bash
cd infra/seaweedfs
cp seaweedfs.env.example seaweedfs.env
vim seaweedfs.env
```

至少修改默认 S3 凭据：

```bash
SEAWEEDFS_S3_ACCESS_KEY=...
SEAWEEDFS_S3_SECRET_KEY=...
```

当前两节点测试可以先保留：

```bash
SEAWEEDFS_VOLUME_NODES='[
  {"name":"master-01","path":"/var/lib/cola/seaweedfs/volume"},
  {"name":"node-01","path":"/var/lib/cola/seaweedfs/volume"}
]'
SEAWEEDFS_REPLICATION=001
SEAWEEDFS_S3_BUCKET=cola-training
SEAWEEDFS_ADMIN_PASSWORD=...
SEAWEEDFS_ADMIN_NODE_PORT=32246
```

先 dry-run：

```bash
./deploy.sh render-values --env-file seaweedfs.env
./deploy.sh render-admin-service --env-file seaweedfs.env
./deploy.sh render-bucket-job --env-file seaweedfs.env
./deploy.sh render-smoke-test --env-file seaweedfs.env
./deploy.sh install --dry-run --env-file seaweedfs.env
```

正式部署：

```bash
./deploy.sh install --env-file seaweedfs.env
```

状态检查：

```bash
./deploy.sh status --env-file seaweedfs.env
kubectl -n storage get pods -o wide
kubectl -n storage get svc
```

## Admin UI

SeaweedFS 官方 `weed admin` UI 默认开启，并通过 NodePort 暴露：

```bash
SEAWEEDFS_ADMIN_ENABLED=true
SEAWEEDFS_ADMIN_SERVICE_NAME=seaweedfs-admin-ui
SEAWEEDFS_ADMIN_USER=admin
SEAWEEDFS_ADMIN_PASSWORD=...
SEAWEEDFS_ADMIN_NODE_PORT=32246
SEAWEEDFS_ADMIN_TARGET_PORT=23646
SEAWEEDFS_ADMIN_GRPC_PORT=33646
```

部署后可以打开：

```text
http://172.16.60.198:32246
```

这个地址使用的是 `infra/k8s/cluster/config.json` 里的 `controllerIp`。如果以后控制节点 IP 或 NodePort 改了，同步改 `seaweedfs.env` 和前端存储管理页里的入口配置。

`SEAWEEDFS_ADMIN_PASSWORD` 必须改掉示例值。SeaweedFS chart 里 admin 密码为空时会关闭 UI 认证，不建议在 NodePort 暴露场景下这么做。

## 验证 S3

部署完成后运行集群内 smoke test：

```bash
./deploy.sh smoke-test --env-file seaweedfs.env
```

它会在 `cola-training` bucket 下写入并读回：

```text
_smoke/seaweedfs-smoke.txt
```

## 集群内访问参数

给训练任务、JupyterLab 或 Unsloth Studio 注入类似环境变量：

```bash
AWS_ENDPOINT_URL=http://seaweedfs-s3.storage.svc.cluster.local:8333
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1
COLA_TRAINING_S3_BUCKET=cola-training
```

容器内可以用 `awscli` 验证：

```bash
aws --endpoint-url "$AWS_ENDPOINT_URL" s3 ls "s3://$COLA_TRAINING_S3_BUCKET"
aws --endpoint-url "$AWS_ENDPOINT_URL" s3 cp ./dataset.jsonl "s3://$COLA_TRAINING_S3_BUCKET/datasets/dataset.jsonl"
```

如果容器在集群外访问，需要额外暴露 S3 Service，例如 NodePort、Ingress 或端口转发；默认方案只暴露集群内 ClusterIP。

## 和训练平台的关系

当前训练平台代码已经支持 PVC 挂载：

- `COLA_TRAINING_PVC_NAME`
- `COLA_JUPYTERLAB_PVC_NAME`
- `COLA_UNSLOTH_STUDIO_PVC_NAME`

只部署 SeaweedFS 后，不要配置这些 PVC 变量，除非你另外部署了可用的 StorageClass/PVC。

纯 SeaweedFS 的推荐用法是把数据集和模型产物放到 S3：

```text
s3://cola-training/datasets/...
s3://cola-training/checkpoints/...
s3://cola-training/models/...
```

训练代码或 Notebook 通过 S3 SDK、`awscli`、`s5cmd`、`rclone` 等工具读写对象。

## 卸载

```bash
./deploy.sh uninstall --env-file seaweedfs.env
```

注意：卸载 Helm release 不会删除节点上的 hostPath 数据目录。默认根路径：

```text
/var/lib/cola/seaweedfs
```
