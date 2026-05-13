# Rook-Ceph 本地分布式存储方案

这个目录用于在当前 Kubernetes 集群内部署 Rook-Ceph，作为训练平台的本地分布式存储层。

目标不是单节点 `hostPath`，而是让多个 Kubernetes 节点上的独立数据盘作为 Ceph OSD 参与存储：

```text
Kubernetes workers
  -> Rook-Ceph Operator
  -> Ceph MON / MGR / OSD
  -> cola-cephfs StorageClass  # RWX，给训练平台共享数据集和产物
  -> cola-rbd StorageClass     # RWO，给普通块存储
```

当前集群信息只以 `../k8s/cluster/config.json` 和 `../k8s/cluster/nodes.json` 为准。

## 重要前提

生产部署前必须准备专用数据盘：

- 至少 3 个 worker/storage 节点。
- 每个存储节点至少 1 块独立数据盘，例如 `/dev/sdb` 或 `/dev/nvme1n1`。
- 不要把系统盘、已有数据盘、Kubernetes/containerd 根目录所在磁盘交给 Ceph。
- Ceph 三副本 `size=3` 时，可用容量大约是裸盘容量的 1/3。
- 当前仓库的 `nodes.json` 只有 `master-01` 和 `node-01` 两个节点，不适合生产级 Ceph；需要先扩容节点和磁盘。

## 推荐用途

训练平台优先使用 CephFS：

```yaml
accessModes:
  - ReadWriteMany
storageClassName: cola-cephfs
```

原因：

- JupyterLab、Unsloth Studio、训练 Job 可以挂同一个 PVC。
- 多机训练 Pod 可以跨节点读写同一个 `/workspace`。
- 数据集、checkpoint、adapter、model 产物可以在同一个共享目录中流转。

## 快速开始

先复制配置：

```bash
cd infra/rook-ceph
cp rook-ceph.env.example rook-ceph.env
vim rook-ceph.env
```

至少要配置 `ROOK_STORAGE_NODES`：

```bash
ROOK_STORAGE_NODES='[
  {"name":"node-01","devices":[{"name":"sdb"}]},
  {"name":"node-02","devices":[{"name":"sdb"}]},
  {"name":"node-03","devices":[{"name":"sdb"}]}
]'
```

不要直接使用 `rook-ceph.env.minimal.example` 安装；它里面的 `node-02`、`node-03`、`sdb` 只是示例，必须替换成真实节点和真实空闲数据盘。

节点名来自：

```bash
kubectl get nodes -o wide
```

磁盘名在每台节点上确认：

```bash
lsblk -f
```

确认渲染内容：

```bash
./deploy.sh render-values --env-file rook-ceph.env
./deploy.sh render-training-pvc --env-file rook-ceph.env
./deploy.sh install --dry-run --env-file rook-ceph.env
```

部署：

```bash
./deploy.sh install --env-file rook-ceph.env
```

查看状态：

```bash
./deploy.sh status --env-file rook-ceph.env
```

## 创建训练平台 PVC

如果只想渲染 PVC：

```bash
./deploy.sh render-training-pvc --env-file rook-ceph.env
```

默认模板：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cola-training-workspace
  namespace: remote-work
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: cola-cephfs
  resources:
    requests:
      storage: 500Gi
```

如果希望脚本部署时自动创建这个 PVC：

```bash
ROOK_CREATE_TRAINING_PVC=1 ./deploy.sh install --env-file rook-ceph.env
```

训练平台服务侧建议配置：

```bash
COLA_TRAINING_PVC_NAME=cola-training-workspace
COLA_TRAINING_PVC_MOUNT_PATH=/workspace
COLA_TRAINING_OUTPUT_ROOT=/workspace/cola-training

COLA_JUPYTERLAB_PVC_NAME=cola-training-workspace
COLA_JUPYTERLAB_PVC_MOUNT_PATH=/workspace

COLA_UNSLOTH_STUDIO_PVC_NAME=cola-training-workspace
COLA_UNSLOTH_STUDIO_PVC_MOUNT_PATH=/workspace
```

## StorageClass

本方案创建两个 StorageClass：

- `cola-cephfs`：CephFS，支持 `ReadWriteMany`，用于训练平台共享工作空间。
- `cola-rbd`：RBD，通常用于 `ReadWriteOnce` 块存储。

不要同时把两个 StorageClass 都设为默认。默认配置不会设置默认 StorageClass。

## 卸载

```bash
./deploy.sh uninstall --env-file rook-ceph.env
```

注意：

- `uninstall` 只卸载 Helm release。
- 它不会清理 OSD 磁盘数据。
- 如果要重装或释放磁盘，必须按 Ceph/Rook 官方清理流程确认数据不再需要。

## 和 JuiceFS 的关系

Rook-Ceph 是底层本地分布式存储。训练平台可以直接用 `cola-cephfs`，不需要 JuiceFS。

如果后续仍想使用 JuiceFS，可以让 JuiceFS 的对象存储后端接 Ceph RGW S3，但这不是训练平台共享目录的第一优先方案。
