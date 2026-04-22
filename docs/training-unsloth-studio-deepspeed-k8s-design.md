# Unsloth Studio + DeepSpeed + Kubernetes 设计方案

## 0. 文档状态

- 更新时间：2026-04-22
- 目标：给当前 `cola` 仓库补一条可落地的 `Unsloth Studio -> Cola -> K8s DeepSpeed` 训练方案
- 结论先行：
  - `Unsloth Studio` 可以作为训练入口和配置界面
  - `Cola` 继续作为任务控制面、Kubernetes 编排层和状态回写层
  - 多机多卡运行时不建议继续沿用当前单 Pod `Job` 实现，建议升级为 `Indexed Job + Headless Service + torchrun + DeepSpeed`

## 1. 当前仓库现状

当前训练平台已经有一条最小可运行链路，但它是单机单作业模式：

- 后端 `training.startJob` 只会创建一个 Kubernetes `batch/v1 Job`
- Job 里只有一个训练容器
- 启动命令是普通 `python -u /tmp/cola_unsloth_train.py`
- 训练脚本直接执行 `SFTTrainer(...); trainer.train()`
- 页面只有 `gpuCount`，没有 `nodeCount`、`gpusPerNode`、`launcherType`、`deepspeedConfig` 等分布式字段

因此，当前实现更接近：

```text
Cola Form -> Single K8s Job -> Single Pod -> Single Python Process
```

而不是：

```text
Unsloth Studio -> Cola Control Plane -> Distributed K8s Runtime -> DeepSpeed Training
```

## 2. 目标架构

目标是把训练链路拆成两层：

- 配置层：`Unsloth Studio`
- 控制层：`Cola`

推荐形态：

```text
Browser
  -> Cola Training Page
  -> Unsloth Studio
       -> 用户配置模型 / 数据集 / LoRA / QLoRA / 训练超参
  -> Cola Import / Submit
       -> 保存配置快照
       -> 创建训练任务记录
       -> 生成 K8s 分布式运行时
  -> Kubernetes
       -> Headless Service
       -> Indexed Job
       -> torchrun
       -> Unsloth + TRL + DeepSpeed
  -> PVC / Artifact Path
       -> checkpoints
       -> adapter or merged model
       -> job-result.json
```

职责边界：

- `Unsloth Studio`
  - 负责用户入口
  - 负责可视化配置和调参体验
  - 负责数据集预处理、训练参数编辑、训练意图表达
- `Cola`
  - 负责配置快照持久化
  - 负责 Kubernetes 资源生成与删除
  - 负责作业状态、事件、错误回写
  - 负责日志、产物路径、停止与清理动作
- `Kubernetes`
  - 负责多节点调度
  - 负责 GPU 资源申请
  - 负责分布式 Pod 网络寻址
  - 负责 PVC / Secret / ConfigMap 挂载

## 3. 为什么让 Studio 当入口，而不是直接当调度器

这是基于当前官方资料和仓库现状做的工程选择。

截至 2026-04-22，我查到的官方资料明确说明：

- `Unsloth Studio` 是官方浏览器界面，支持通过 `unsloth studio -H 0.0.0.0 -p 8888` 或 Docker 镜像运行
- Unsloth 当前多 GPU 仍主要通过 `Accelerate`、`DeepSpeed`、`torchrun` 这类分布式训练库接入
- 官方 DDP 文档明确给出的启动方式是 `torchrun`

但我没有在当前公开文档里看到稳定的“Studio 直接提交远端 K8s 分布式任务”的公开 API 约定。因此，本方案不把 Studio 当成 Kubernetes 控制面，而是把它当成：

- 训练入口
- 配置界面
- 人机交互层

然后由 Cola 把配置转换成自己的运行时规范再提交到 Kubernetes。

这样做的好处：

- 不依赖 Studio 内部未文档化接口
- 不需要把训练状态和资源生命周期交给第三方 UI 自己管理
- 能和当前 Cola 的数据库、事件流、K8s 连接方式保持一致
- 能逐步上线，先做导入，再做更深集成

补充约束：

- 如果后续要把 Studio UI 直接内嵌、改造或深度再分发，需要先评估 `AGPL-3.0` 对 Studio UI 部分的影响
- 如果官方之后公开了稳定的 Studio submit/export API，可以把本方案的“导入适配层”替换成原生对接

## 4. 推荐的集成方式

### 4.1 Phase 1：跳转 + 导入快照

这是最稳的首发形态。

- Cola 页面继续保留 `进入 Unsloth Studio`
- 用户在 Studio 内完成模型、数据集、LoRA、精度、批大小等配置
- 用户把一份“解析后的训练配置”交给 Cola
- Cola 保存配置快照，并提交分布式训练

这里的“训练配置”不要求等于 Studio 内部原始工程文件，可以是 Cola 自己定义的一份标准化 JSON：

```json
{
  "configSource": "unsloth_studio",
  "jobType": "lora",
  "baseModel": "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
  "dataset": {
    "name": "/workspace/cola-training/datasets/support.jsonl",
    "split": "train",
    "textField": "text"
  },
  "model": {
    "loadIn4bit": true,
    "maxSeqLength": 4096
  },
  "lora": {
    "rank": 16,
    "alpha": 16,
    "dropout": 0.0
  },
  "trainer": {
    "perDeviceTrainBatchSize": 1,
    "gradientAccumulationSteps": 8,
    "learningRate": 0.0002,
    "maxSteps": 1000,
    "saveSteps": 100
  },
  "distributed": {
    "nodeCount": 2,
    "gpusPerNode": 4,
    "launcher": "torchrun",
    "backend": "deepspeed",
    "deepspeedStage": 2,
    "precision": "bf16"
  }
}
```

### 4.2 Phase 2：Studio Bridge

如果 Phase 1 需要更顺的用户体验，再加一个 Cola 自己维护的桥接层：

- 新增 `/training/studio-bridge`
- 页面内同时显示：
  - `打开 Studio`
  - `导入 Studio 配置`
  - `预览将提交到 K8s 的解析后配置`
- 真正提交时，永远提交的是 Cola 标准化配置，而不是直接透传 Studio 内部对象

### 4.3 不推荐：深度改 Studio 前端

现阶段不建议：

- 直接篡改 Studio 前端资源
- 假设 Studio 已经提供稳定的远端训练提交 API
- 把 Cola 训练页面完全改造成 Studio 内部页面的一部分

原因：

- 风险大
- 升级成本高
- 许可证边界更复杂
- 当前仓库还没有必要承受这类耦合

## 5. Kubernetes 运行时设计

### 5.1 推荐运行时：Indexed Job + Headless Service

不建议继续沿用当前单容器单 Pod `Job` 形态。

当前更适合的分布式批处理方案是：

- 一个 `Headless Service`
- 一个 `batch/v1 Job`
- `completionMode: Indexed`
- `parallelism = completions = nodeCount`

这样每个 Pod 都有稳定的索引和可预测的 DNS 名称。Kubernetes 官方文档明确指出：

- Indexed Job 会给每个 Pod 注入 `JOB_COMPLETION_INDEX`
- Pod 主机名会遵循 `$(job-name)-$(index)` 的形式
- Indexed Job 配合 Service 可用于 Pod 之间的稳定寻址

这非常适合 `torchrun` / PyTorch 多节点训练。

### 5.2 为什么不用 StatefulSet 作为首选

`StatefulSet` 的稳定身份很好，但它天然更偏长期服务，而不是一次性训练任务。

训练任务需要：

- 成功后自动进入完成态
- 失败后有 Job 级别状态
- TTL 清理
- 失败重试与回收

这些都是 `Job` 语义更擅长的事情。

### 5.3 为什么暂时不强依赖 Kubeflow Trainer

`Kubeflow Trainer` 或 `PyTorchJob` 是后续可选增强方向，但当前仓库和集群信息里没有现成 training operator 接入痕迹。

因此：

- Phase 1 先用原生 Kubernetes 资源完成
- Phase 2 如有需要，再接 `Kubeflow Trainer` / `PyTorchJob`

## 6. 分布式启动约定

每个训练 Pod 内都启动相同命令：

```bash
torchrun \
  --nnodes="${COLA_NODE_COUNT}" \
  --nproc_per_node="${COLA_GPUS_PER_NODE}" \
  --node_rank="${JOB_COMPLETION_INDEX}" \
  --master_addr="${COLA_MASTER_ADDR}" \
  --master_port="${COLA_MASTER_PORT}" \
  /workspace/cola-training/train.py
```

运行时约定：

- `COLA_NODE_COUNT=nodeCount`
- `COLA_GPUS_PER_NODE=gpusPerNode`
- `JOB_COMPLETION_INDEX` 由 Indexed Job 提供
- `COLA_MASTER_ADDR=<job-name>-0.<headless-service>`
- `COLA_MASTER_PORT` 默认 `29500`

建议额外注入：

- `NCCL_DEBUG=warn`
- `NCCL_SOCKET_IFNAME`
- `TORCH_DISTRIBUTED_DEBUG=DETAIL`
- `HF_HOME`
- `TRANSFORMERS_CACHE`

## 7. 训练脚本设计

训练脚本继续使用现有的 `Unsloth + TRL`，但要补分布式和 DeepSpeed 配置。

建议保留这一层：

- `FastLanguageModel.from_pretrained(...)`
- `FastLanguageModel.get_peft_model(...)`
- `SFTTrainer(...)`

建议改动：

- 使用 `torchrun` 启动
- 在 `SFTConfig` 中显式传 `deepspeed=<path>`
- 显式设置 `ddp_find_unused_parameters=false`
- 仅 `rank 0` 导出最终产物

示例骨架：

```python
from unsloth import FastLanguageModel
from trl import SFTTrainer, SFTConfig
import os
import torch
import torch.distributed as dist

local_rank = int(os.environ.get("LOCAL_RANK", "0"))
rank = int(os.environ.get("RANK", "0"))

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=job["baseModel"],
    max_seq_length=max_seq_length,
    load_in_4bit=load_in_4bit,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=lora_rank,
    lora_alpha=lora_alpha,
    lora_dropout=lora_dropout,
    use_gradient_checkpointing="unsloth",
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    args=SFTConfig(
        output_dir=artifact_dir,
        per_device_train_batch_size=per_device_train_batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
        learning_rate=learning_rate,
        max_steps=max_steps,
        bf16=torch.cuda.is_bf16_supported(),
        fp16=not torch.cuda.is_bf16_supported(),
        deepspeed=deepspeed_config_path,
        ddp_find_unused_parameters=False,
        report_to="none",
    ),
)

trainer.train()

if rank == 0:
    trainer.save_model(final_output_dir)
    tokenizer.save_pretrained(final_output_dir)
```

实现注意点：

- 首发建议先支持 `LoRA/QLoRA + ZeRO-2`
- `ZeRO-3` 可以保留为后续增强，因为 checkpoint 合并和保存路径更复杂
- `rank 0` 负责写最终 `adapter/` 或 `model/`
- 非 `rank 0` 只参与训练，不做最终导出

## 8. DeepSpeed 配置策略

首发推荐：

- `bf16 + ZeRO-2 + LoRA/QLoRA`

默认模板建议：

```json
{
  "bf16": { "enabled": "auto" },
  "zero_optimization": {
    "stage": 2,
    "overlap_comm": true,
    "contiguous_gradients": true,
    "reduce_scatter": true,
    "allgather_partitions": true
  },
  "gradient_clipping": "auto",
  "train_micro_batch_size_per_gpu": "auto",
  "train_batch_size": "auto",
  "gradient_accumulation_steps": "auto"
}
```

建议分两档：

- 安全默认档：`ZeRO-2`
- 大模型档：`ZeRO-3`

首发不建议默认启用：

- CPU offload
- NVMe offload
- 复杂的 3D parallelism

原因是这些能力会显著增加排障成本，而当前仓库首先要把链路跑稳。

## 9. 数据模型调整

当前 `cola_training_job` 只够单机场景，建议扩展但保留兼容：

- 保留 `gpuCount`
  - 含义调整为总 GPU 数
  - 计算方式：`nodeCount * gpusPerNode`
- 新增 `nodeCount integer not null default 1`
- 新增 `gpusPerNode integer not null default 1`
- 新增 `configSource varchar(32) not null default 'manual'`
- 新增 `launcherType varchar(32) not null default 'python'`
- 新增 `distributedBackend varchar(32) not null default 'none'`
- 新增 `deepspeedStage integer`
- 新增 `precision varchar(16)`
- 新增 `loadIn4bit boolean not null default true`
- 新增 `studioConfigSnapshot jsonb`
- 新增 `trainingConfigSnapshot jsonb`
- 新增 `runtimeKind varchar(32)`
- 新增 `runtimeServiceName varchar(120)`
- 新增 `runtimeLeaderPodName varchar(120)`

建议新增的兼容层字段支持：

- `runtimeJobName` 继续保留，用于 Indexed Job 名称
- `artifactPath` 继续保留
- `runtimeNamespace` 继续保留
- `runtimeImage` 继续保留

这样旧页面和旧任务仍然可以展示。

## 10. API 设计调整

### 10.1 createJob 输入

当前输入：

- `title`
- `objective`
- `jobType`
- `priority`
- `baseModel`
- `datasetName`
- `gpuCount`

建议扩展为：

- `configSource`
- `nodeCount`
- `gpusPerNode`
- `launcherType`
- `distributedBackend`
- `deepspeedStage`
- `precision`
- `loadIn4bit`
- `datasetSplit`
- `datasetTextField`
- `trainingConfigSnapshot`
- `studioConfigSnapshot`

### 10.2 startJob 行为

当前 `startJob` 直接构造单个 `Job`。

建议改成：

- 解析 `trainingConfigSnapshot`
- 生成：
  - `ConfigMap`
  - `Headless Service`
  - `Indexed Job`
- 更新 runtime 元数据
- 写入事件流

### 10.3 stopJob 行为

建议停止时删除：

- `Job`
- `Headless Service`
- 与本次运行相关的临时 `ConfigMap`

删除策略：

- `Foreground`
- `gracePeriodSeconds=0`

## 11. 前端页面调整

训练页建议拆成两种入口：

### 11.1 快速创建

保留当前简化表单，用于：

- smoke test
- 单机单卡
- 最小 LoRA 验证

### 11.2 从 Studio 导入

新增一个更适合正式训练的入口：

- `进入 Unsloth Studio`
- `导入 Studio 配置`
- `预览解析后配置`
- `提交到 K8s DeepSpeed`

前端要新增的核心字段：

- `nodeCount`
- `gpusPerNode`
- `totalGpuCount`
- `distributedBackend`
- `deepspeedStage`
- `precision`
- `loadIn4bit`
- `datasetSplit`
- `datasetTextField`
- `configSource`

## 12. 镜像与依赖

不建议继续直接使用漂移的 `unsloth/unsloth:latest` 作为分布式训练镜像。

建议新增自定义镜像，例如：

```text
ghcr.io/cola/unsloth-deepspeed:<version>
```

镜像要求：

- 固定 `unsloth` 版本
- 固定 `transformers` / `trl` / `peft` / `deepspeed` 版本
- 包含 `torchrun`
- 包含 `deepspeed`
- 包含 `datasets`
- 包含常用系统依赖与 CUDA 运行时

## 13. 存储与产物

建议统一使用 PVC。

路径建议：

```text
/workspace/cola-training/
  datasets/
  cache/hf/
  jobs/<jobId>/<runName>/
    checkpoints/
    adapter/
    logs/
    job-result.json
```

规则：

- 训练中 checkpoint 可以按 DeepSpeed 原生方式写入
- 训练完成后只由 `rank 0` 生成最终导出目录
- `job-result.json` 由 `rank 0` 写入

## 14. 调度与网络

建议默认启用：

- GPU 节点选择器：沿用 `infra/k8s/cluster/config.json` 中的 `gpuLabelKey`
- `podAntiAffinity`：尽量让不同索引 Pod 分散到不同 GPU 节点
- `topologySpreadConstraints`：减少单节点堆叠
- `runtimeClassName: nvidia`

网络上要确保：

- 训练 Pod 之间能通过 Service DNS 互通
- `master_port` 在 Pod 网络内可达
- 不要给训练 Job 自动注入与训练无关的 sidecar

## 15. 分阶段上线建议

### Phase 1

- 保留现有单 Pod Job
- 新增分布式 schema 字段
- 新增 `Indexed Job + Headless Service`
- 新增 `torchrun + DeepSpeed ZeRO-2`
- 新增 `Studio 配置导入`

### Phase 2

- 支持 `ZeRO-3`
- 支持更完整的 Studio 配置映射
- 支持多节点日志聚合和 `rank 0` 日志优先展示

### Phase 3

- 如集群后续安装 Kubeflow Trainer，再评估切换到 `PyTorchJob` / `TrainJob`
- 提供对象存储归档和更完整的 checkpoint 生命周期治理

## 16. 对当前仓库的具体改造点

建议按下面这些文件切：

- `src/server/db/schema.ts`
  - 补训练任务字段
- `drizzle/`
  - 增加 migration
- `src/server/training/compat.ts`
  - 扩展可选 runtime 字段兼容
- `src/server/api/routers/training.ts`
  - 扩展 create/start/stop 输入输出
- `src/server/training/service.ts`
  - 从单 Pod `Job` builder 改成支持 `Indexed Job + Headless Service`
  - 新增分布式训练脚本与 DeepSpeed config 生成
- `src/app/_components/training-shell.tsx`
  - 新增 Studio 导入入口与分布式字段
- `docs/training-unsloth-k8s.md`
  - 后续补一份“当前实现 vs 新架构”对照

## 17. 最终建议

建议采用下面这个顺序：

1. 先把 `Cola` 的运行时从单 Pod `Job` 升级为 `Indexed Job + Headless Service`
2. 再把训练脚本升级为 `torchrun + DeepSpeed ZeRO-2`
3. 再把 `Unsloth Studio` 作为入口和配置界面接入
4. 最后再追求更深的 Studio 自动导入和更复杂的 ZeRO-3 能力

这样做的原因很简单：

- 先把分布式运行时打稳，比先做漂亮 UI 更重要
- 先让 Cola 持有最终配置快照，比直接依赖 Studio 内部对象更稳
- 先做 `ZeRO-2`，再做 `ZeRO-3`，能明显降低排障复杂度

## 18. 参考资料

以下链接用于支撑本设计中的关键判断：

- Unsloth 仓库 README：
  - https://github.com/unslothai/unsloth
- Unsloth Docker 文档：
  - https://docs.unsloth.ai/get-started/install-and-update/docker
- Unsloth Studio 仓库：
  - https://github.com/unslothai/unsloth-studio
- Unsloth 多 GPU 文档：
  - https://docs.unsloth.ai/basics/multi-gpu-training-with-unsloth
- Unsloth DDP 文档：
  - https://docs.unsloth.ai/basics/multi-gpu-training-with-unsloth/ddp
- Hugging Face Transformers DeepSpeed 文档：
  - https://huggingface.co/docs/transformers/en/deepspeed
- Hugging Face PEFT + DeepSpeed 文档：
  - https://huggingface.co/docs/peft/en/accelerate/deepspeed
- Kubernetes Indexed Job 官方文档：
  - https://kubernetes.io/docs/concepts/workloads/controllers/job/
- Kubeflow DeepSpeed Guide：
  - https://www.kubeflow.org/docs/components/trainer/user-guides/deepspeed/
