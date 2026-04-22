# Unsloth Training On Kubernetes

## 当前实现

- `training.startJob` 会创建一个 Kubernetes `Job`
- 训练容器默认使用 `unsloth/unsloth:latest`
- `training.stopJob` 会删除对应的 Kubernetes `Job`
- `training.listJobs` 会回读 Job 状态，把完成/失败同步回数据库

## 调度位置

- 默认 namespace：`COLA_TRAINING_K8S_NAMESPACE`
- 未设置时回退到 `infra/k8s/cluster/config.json` 里的 `workspaceNamespace`
- GPU 节点选择器默认使用 `infra/k8s/cluster/config.json` 里的 `gpuLabelKey`
- `COLA_TRAINING_RUNTIME_CLASS_NAME` 未设置时，训练 Pod 不会强制注入 `runtimeClassName`

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
- `COLA_TRAINING_RUNTIME_CLASS_NAME`
- `COLA_TRAINING_CPU_REQUEST`
- `COLA_TRAINING_CPU_LIMIT`
- `COLA_TRAINING_MEMORY_REQUEST`
- `COLA_TRAINING_MEMORY_LIMIT`

前端跳转配置：

- `NEXT_PUBLIC_UNSLOTH_STUDIO_URL`

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

## 原生页面入口

如果你希望直接在 Unsloth 原生 UI 里配置训练任务，而不是只用 Cola 的简化表单，可以单独部署 Unsloth Studio，并在 Cola 前端配置：

```env
NEXT_PUBLIC_UNSLOTH_STUDIO_URL="https://unsloth.example.com/"
```

配置后，训练页右上角会出现可用的 `进入 Unsloth Studio` 入口。这个入口只是跳转，不会自动把 Studio 里的高级参数同步回 Cola 数据库。

建议分工：

- Cola：任务创建、K8s 作业状态、产物路径
- Unsloth Studio：数据集选择、训练超参、原生训练配置

## 如何跑一个训练任务

### 1. 启动前检查

- 确认 Web 进程能访问 Kubernetes API。
- 如果 Web 跑在集群内 Pod 中，会优先使用 in-cluster kubeconfig。
- 如果 Web 不在集群内，补齐 `COLA_TRAINING_KUBECONFIG_PATH` 或前文列出的 kubeconfig 环境变量。
- 如果希望保留训练产物和本地数据集，配置 `COLA_TRAINING_PVC_NAME`；否则任务会使用 `emptyDir`，Pod 删除后产物会消失。
- 如果基础模型需要 Hugging Face Token，配置 `COLA_TRAINING_HF_SECRET_NAME` 和 `COLA_TRAINING_HF_SECRET_KEY`。
- 提前准备好数据集来源：
  - Hugging Face 数据集名，例如 `username/dataset-name`
  - 或训练 Pod 能直接读取的本地文件路径，例如 `/workspace/datasets/support.jsonl`

如果你用的是本地文件，当前内置读取器支持 `.json`、`.jsonl`、`.csv`、`.tsv`、`.parquet`。

JSONL 常见格式是每行至少有一个训练文本字段，例如：

```jsonl
{
  "text": "用户：退款多久到账？\n助手：原路退款通常 1 到 3 个工作日到账。"
}
```

如果字段名不是 `text`，创建任务时把“文本字段”改成你的实际列名，或设置 `COLA_TRAINING_DATASET_TEXT_FIELD`。

### 2. 在训练页创建任务

进入 `/training` 后点击“创建训练任务”，至少填这些字段：

- 任务标题：方便和 Kubernetes Job 对应
- 训练目标：记录这次训练的目的、产物和预期效果
- 训练类型：当前支持 `sft`、`lora`、`pretrain`
- 基础模型：例如一个 Hugging Face 模型 ID
- 数据集：Hugging Face 数据集名，或挂载卷里的文件路径
- 数据集 Split：默认通常填 `train`
- 文本字段：默认通常填 `text`
- 节点数 / 每节点 GPU：决定分布式规格
- 启动器 / 后端 / DeepSpeed Stage：默认单机和多机都可以沿用当前表单默认值

可选项：

- 如果你从 Unsloth Studio 导出了 JSON，可以粘贴到 `Unsloth Studio JSON`，Cola 会尽量自动带入模型、数据集、GPU、精度和 DeepSpeed 设置。
- 如果只是先验证链路，建议先用 `1` 节点、`1` GPU 跑通，再放大资源。

点击“创建训练任务”后，任务会先以草稿状态写入数据库，还不会立刻提交到 Kubernetes。

### 3. 启动任务

- 在任务列表里找到刚创建的任务，点击“启动”。
- `training.startJob` 会创建一个 Kubernetes `Job`，并补齐运行态信息。
- 成功后页面里会显示：
  - Kubernetes namespace
  - runtime job name
  - 产物目录
  - 最后错误信息

如果提交失败，优先检查：

- namespace 是否可创建或可访问
- GPU 节点标签是否正确
- `runtimeClassName`、镜像、PVC、HF Secret 是否存在
- Web 所在身份是否有 `jobs.batch` 和 `namespaces` 的权限

### 4. 观察运行状态

- 点击任务行上的运行态入口，可以查看 Pod、事件和日志。
- `运行中` 表示 Kubernetes Job 已提交，训练 Pod 正在执行。
- `调度失败` 通常说明 GPU 资源、节点标签、runtime class 或镜像拉取存在问题。
- `停止` 会删除对应的 Kubernetes Job。
- `删除` 只允许在非运行态执行。

### 5. 查看产物

- 作业产物根目录默认是 `COLA_TRAINING_OUTPUT_ROOT` 或 `/workspace/cola-training`
- LoRA / SFT 任务完成后，adapter 会保存到：

```text
/workspace/cola-training/<jobId>/<runtimeJobName>/adapter
```

- `pretrain` 这类非 LoRA 任务会把完整模型写到 `model/` 子目录
- 同目录下还会生成一个 `job-result.json`，记录任务 ID、模型名、数据集和最终产物目录

## 执行器默认训练参数

当前 Unsloth 执行器会使用这些默认值，除非你通过环境变量覆盖：

- `COLA_LOAD_IN_4BIT=true`
- `COLA_DATASET_SPLIT=train`
- `COLA_DATASET_TEXT_FIELD=text`
- `COLA_MAX_SEQ_LENGTH=2048`
- `COLA_LORA_RANK=16`
- `COLA_LORA_ALPHA=16`
- `COLA_LORA_DROPOUT=0`
- `COLA_PER_DEVICE_BATCH_SIZE=2`
- `COLA_GRADIENT_ACCUMULATION_STEPS=4`
- `COLA_WARMUP_STEPS=5`
- `COLA_MAX_STEPS=60`
- `COLA_LEARNING_RATE=2e-4`
- `COLA_LOGGING_STEPS=1`
- `COLA_SAVE_STEPS=20`
- `COLA_SAVE_TOTAL_LIMIT=2`
- `COLA_RANDOM_SEED=3407`

这些默认值更适合先跑通链路，不代表正式训练配置。
