# SeaweedFS + JuiceFS 完整部署方案

这个目录是一体化部署入口：在当前 Kubernetes 集群内部署 SeaweedFS S3、JuiceFS metadata Redis、JuiceFS CSI、`juicefs-sc` StorageClass，并可选创建训练平台共享 PVC。

```text
SeaweedFS
  master / filer / volume / s3
  数据块落在节点 hostPath

JuiceFS
  metadata: Redis
  object storage: SeaweedFS S3 bucket
  CSI StorageClass: juicefs-sc

训练平台
  PVC: remote-work/cola-training-workspace
  mountPath: /workspace
```

## 当前集群限制

根据你贴的 `lsblk -f`：

- `master-01` 只有系统盘 `nvme0n1`
- `node-01` 只有系统盘 `nvme0n1`
- 没有独立空闲数据盘

所以本方案当前只能作为轻量测试/过渡方案。数据会写到系统盘目录：

```text
/var/lib/cola/seaweedfs
/var/lib/cola/juicefs
```

生产建议至少 3 个节点，并给每个节点加独立数据盘，再把独立盘挂载到这些目录或修改配置里的路径。

## 1. 配置

```bash
cd infra/seaweedfs-juicefs
cp seaweedfs-juicefs.env.example seaweedfs-juicefs.env
vim seaweedfs-juicefs.env
```

当前两节点测试可以保留：

```bash
SEAWEEDFS_VOLUME_NODES='[
  {"name":"master-01","path":"/var/lib/cola/seaweedfs/volume"},
  {"name":"node-01","path":"/var/lib/cola/seaweedfs/volume"}
]'
SEAWEEDFS_REPLICATION=001
```

必须修改默认 S3 凭据：

```bash
SEAWEEDFS_S3_ACCESS_KEY=...
SEAWEEDFS_S3_SECRET_KEY=...
```

如果只想先试跑，至少也改成非默认字符串。

## 2. Dry-run

先看所有即将执行的动作：

```bash
./deploy.sh install --dry-run --env-file seaweedfs-juicefs.env
```

单独查看渲染内容：

```bash
./deploy.sh render-seaweedfs-values --env-file seaweedfs-juicefs.env
./deploy.sh render-juicefs-secret --env-file seaweedfs-juicefs.env
./deploy.sh render-storageclass --env-file seaweedfs-juicefs.env
./deploy.sh render-training-pvc --env-file seaweedfs-juicefs.env
```

## 3. 部署

本机需要有 `kubectl` 和 `helm`，并能访问当前集群 kubeconfig。

```bash
./deploy.sh install --env-file seaweedfs-juicefs.env
```

脚本会按 `../k8s/cluster/config.json` 解析当前集群名 `xdream-cloud`，kubeconfig 查找顺序：

```text
$KUBECONFIG
~/.kube/xdream-cloud.config
/etc/kubeasz/clusters/xdream-cloud/kubectl.kubeconfig
```

也可以显式指定：

```bash
./deploy.sh install --env-file seaweedfs-juicefs.env --kubeconfig ~/.kube/xdream-cloud.config
```

## 4. 分步部署

如需分步：

```bash
./deploy.sh seaweedfs --env-file seaweedfs-juicefs.env
./deploy.sh juicefs --env-file seaweedfs-juicefs.env
./deploy.sh pvc --env-file seaweedfs-juicefs.env
```

## 5. 状态检查

```bash
./deploy.sh status --env-file seaweedfs-juicefs.env

kubectl -n storage get pods -o wide
kubectl -n storage get svc
kubectl -n kube-system get pods | grep juicefs
kubectl get storageclass juicefs-sc
kubectl -n remote-work get pvc cola-training-workspace
```

## 6. 训练平台配置

Cola Web 服务配置：

```bash
COLA_TRAINING_PVC_NAME=cola-training-workspace
COLA_TRAINING_PVC_MOUNT_PATH=/workspace
COLA_TRAINING_OUTPUT_ROOT=/workspace/cola-training

COLA_JUPYTERLAB_PVC_NAME=cola-training-workspace
COLA_JUPYTERLAB_PVC_MOUNT_PATH=/workspace

COLA_UNSLOTH_STUDIO_PVC_NAME=cola-training-workspace
COLA_UNSLOTH_STUDIO_PVC_MOUNT_PATH=/workspace
```

统一使用路径：

```text
/workspace/datasets/train.jsonl
/workspace/cola-training/<jobId>/<runtimeJobName>
```

## 7. PVC 验证

创建临时 Pod：

```bash
kubectl -n remote-work run juicefs-test \
  --image=busybox:1.36 \
  --restart=Never \
  --overrides='
{
  "spec": {
    "containers": [
      {
        "name": "juicefs-test",
        "image": "busybox:1.36",
        "command": ["sh", "-c", "echo ok > /workspace/hello.txt && cat /workspace/hello.txt && sleep 3600"],
        "volumeMounts": [
          {"name": "work", "mountPath": "/workspace"}
        ]
      }
    ],
    "volumes": [
      {
        "name": "work",
        "persistentVolumeClaim": {
          "claimName": "cola-training-workspace"
        }
      }
    ]
  }
}'
```

查看：

```bash
kubectl -n remote-work logs juicefs-test
kubectl -n remote-work exec -it juicefs-test -- ls -lah /workspace
kubectl -n remote-work delete pod juicefs-test
```

## 8. 卸载

```bash
./deploy.sh uninstall --env-file seaweedfs-juicefs.env
```

注意：

- 不会删除 PVC。
- 不会删除 JuiceFS Secret 和 StorageClass。
- 不会清理节点上的 hostPath 数据目录。
- 删除数据目录前必须确认训练数据和 JuiceFS 数据块不再需要。
