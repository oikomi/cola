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

- Cola：任务概览、最小模板、K8s 作业状态、产物路径
- Unsloth Studio：数据集选择、训练超参、原生训练配置

## 最小示例：Unsloth + LoRA 微调 Qwen

下面这个示例适合先做链路验收，目标不是把模型训到最优，而是确认训练平台表单、Kubernetes Job、数据读取和 LoRA 产物落盘都正常。

### 页面填写示例

- 任务标题：`Qwen2.5-0.5B 最小 LoRA 示例`
- 训练目标：`使用 Unsloth + LoRA 验证训练平台链路，基于 4-bit Qwen2.5-0.5B Instruct 对最小中文客服问答样本做快速 smoke test，产出 adapter 权重。`
- 训练类型：`lora`
- 优先级：`medium`
- GPU 数量：`1`
- 基础模型：`unsloth/Qwen2.5-0.5B-Instruct-bnb-4bit`
- 数据集：`/workspace/cola-training/datasets/qwen2.5-0.5b-lora-minimal.jsonl`

仓库里已经附了一个模板文件：

- [`docs/examples/qwen2.5-0.5b-lora-minimal.jsonl`](./examples/qwen2.5-0.5b-lora-minimal.jsonl)

注意：

- 上面这个 `docs/examples/...` 文件只是模板，不会自动挂载进训练 Pod
- 真正提交任务前，需要把它复制到训练容器能读取的路径，例如 `/workspace/cola-training/datasets/qwen2.5-0.5b-lora-minimal.jsonl`
- 当前默认读取字段名 `text`；如果你的字段名不同，需要设置 `COLA_TRAINING_DATASET_TEXT_FIELD`

### 示例数据内容

```json
{"text":"你是客服助手。用户：退款一般多久到账？\n助手：原路退款通常 1 到 3 个工作日到账，如遇银行处理延迟可再等待 1 到 2 个工作日。"}
{"text":"你是客服助手。用户：我想修改收货地址怎么办？\n助手：如果订单还未出库，请尽快提供新的详细地址和联系电话，我们会优先帮你修改。"}
{"text":"你是客服助手。用户：你们支持开增值税专票吗？\n助手：支持。请提供开票抬头、税号、开户行、账号和注册地址，我们会在审核后开具。"}
```

这个数据格式是最小 smoke test 版本，适合先验证流程。正式做对话微调时，建议先把样本预处理成更稳定的训练文本格式，例如按 Qwen 的 chat template 展平后再写入 `text` 字段。

### 当前内置默认参数

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
- `COLA_SAVE_STEPS=20`

这些默认值更适合做链路验收，不代表正式训练配置。

### 产物位置

- 作业产物根目录默认是 `COLA_TRAINING_OUTPUT_ROOT` 或 `/workspace/cola-training`
- LoRA 任务完成后，adapter 会保存到：

```text
/workspace/cola-training/<jobId>/<runtimeJobName>/adapter
```

- 同目录下还会生成一个 `job-result.json`，记录任务 ID、模型名、数据集和最终产物目录
