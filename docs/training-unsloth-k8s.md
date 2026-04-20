# Unsloth Training On Kubernetes

## 当前实现

- `training.startJob` 会创建一个 Kubernetes `Job`
- 训练容器默认使用 `unsloth/unsloth:latest`
- `training.stopJob` 会删除对应的 Kubernetes `Job`
- `training.listJobs` 会回读 Job 状态，把完成/失败同步回数据库

## 调度位置

- 默认 namespace：`COLA_TRAINING_K8S_NAMESPACE`
- 未设置时回退到 `infra/remote-work/cluster/config.json` 里的 `workspaceNamespace`
- GPU 节点选择器默认使用 `infra/remote-work/cluster/config.json` 里的 `gpuLabelKey`

## Kubernetes 连接

- 如果 Web 运行在集群内 Pod 中，优先使用 in-cluster kubeconfig
- 否则回退到：
  - `COLA_TRAINING_KUBECONFIG_PATH`
  - `REMOTE_WORK_KUBECONFIG_PATH`
  - `WORKSPACE_KUBECONFIG`
  - `/etc/kubeasz/clusters/<clusterName>/kubectl.kubeconfig`

## 常用环境变量

- `COLA_TRAINING_K8S_NAMESPACE`
- `COLA_TRAINING_KUBECONFIG_PATH`
- `COLA_TRAINING_K8S_IMAGE`
- `COLA_TRAINING_SERVICE_ACCOUNT`
- `COLA_TRAINING_PVC_NAME`
- `COLA_TRAINING_PVC_MOUNT_PATH`
- `COLA_TRAINING_OUTPUT_ROOT`
- `COLA_TRAINING_HF_SECRET_NAME`
- `COLA_TRAINING_HF_SECRET_KEY`
- `COLA_TRAINING_DATASET_SPLIT`
- `COLA_TRAINING_DATASET_TEXT_FIELD`
- `COLA_TRAINING_CPU_REQUEST`
- `COLA_TRAINING_CPU_LIMIT`
- `COLA_TRAINING_MEMORY_REQUEST`
- `COLA_TRAINING_MEMORY_LIMIT`

## 数据集约定

- `datasetName` 支持 Hugging Face 数据集名
- `datasetName` 也支持挂载卷里的本地文件路径
- 当前内置读取器支持：
  - `.json`
  - `.jsonl`
  - `.csv`
  - `.tsv`
  - `.parquet`

## 任务类型约定

- 当前 K8s Unsloth 执行器支持：
  - `sft`
  - `lora`
  - `pretrain`
- `dpo` 会在启动阶段直接报错

## 持久化说明

- 设置 `COLA_TRAINING_PVC_NAME` 时，训练输出和 Hugging Face 缓存会写入挂载卷
- 未设置 PVC 时，任务使用 `emptyDir`，Pod 删除后产物不会保留

## 权限要求

- Web 所在的 ServiceAccount 或 kubeconfig 用户需要具备：
  - `namespaces` 的 `get/create`
  - `jobs.batch` 的 `get/create/delete`

## 页面可见信息

- 每条训练任务会显示：
  - Kubernetes namespace / job name
  - 产物目录
  - 最后错误信息
