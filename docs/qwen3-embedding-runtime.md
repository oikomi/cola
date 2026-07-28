# Qwen3 Embedding 4B 推理运行时

推理部署模块提供独立的 `qwen3-embedding` 运行时，用于部署官方 `Qwen/Qwen3-Embedding-4B` 文本向量模型。该运行时基于固定版本的 vLLM，以 embedding 任务启动，并通过 NodePort 暴露 OpenAI 兼容接口。

## 创建部署

在 `/deployments` 中创建推理部署：

- 运行时：`Qwen3 Embedding 4B`
- 模型引用：`Qwen/Qwen3-Embedding-4B`（运行时会自动填写）；也可以填写包含该模型完整目录的 `s3://` 引用
- 镜像：`vllm/vllm-openai:v0.11.2`
- GPU：建议先使用 1 张整卡 GPU
- CPU / Memory：可先使用默认的 `8 CPU / 32 GiB`，再根据并发和输入长度调整

创建后部署保持草稿状态。确认资源配置无误后点击“上线”，Pod 才会拉取模型并启动服务。

## 调用 API

服务使用部署名称作为 OpenAI API 的模型名。假设部署名称为 `qwen3-embedding`：

```bash
curl http://<master-ip>:<node-port>/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen3-embedding",
    "input": [
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: 什么是向量数据库？"
    ]
  }'
```

查询文本建议使用 `Instruct: ...\nQuery: ...` 格式描述检索任务；文档文本不需要添加 instruction。模型支持最长 32K 上下文，默认输出 2560 维向量，并支持通过请求中的 `dimensions` 字段缩短输出维度。

## 运行约束

- Hugging Face 模型权重由 vLLM 下载；S3 模型目录会在启动前同步到本地缓存。两种来源都会复用推理部署共享的缓存目录。
- 多 GPU 部署会把 GPU 数量映射为 vLLM 的 tensor parallel size。
- 外部入口为 `POST /v1/embeddings`，不是聊天模型使用的 `/v1/chat/completions`。
- Kubernetes 集群地址、命名空间和节点信息以 `infra/k8s/cluster` 为准。
