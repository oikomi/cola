# LocateAnything-3B on SGLang

Cola 通过 SGLang 部署 `nvidia/LocateAnything-3B`，用于图片中的目标检测、短语定位、GUI 定位、文本定位和指向任务。

## 固定版本

- SGLang 镜像：`lmsysorg/sglang:v0.5.15.post1-cu129`
- Hugging Face 模型：`nvidia/LocateAnything-3B`
- 模型 revision：`c32291ca5e996f5a7a485845b4f57a233936bba0`
- 模型实现：SGLang 原生 `LocateAnythingForConditionalGeneration`

该模型的 Hugging Face processor 需要执行仓库中的自定义代码。Cola 只对白名单中的精确模型 ID 添加 `--trust-remote-code`，同时固定 revision；其他 SGLang 模型不会自动获得远程代码执行权限。

出于安全考虑，服务端没有启用 `--enable-custom-logit-processor`。基础定位功能不依赖该选项；客户端必须设置 `skip_special_tokens=false`，否则响应中的 `<ref>` 和 `<box>` 定位标记会被移除。

## 创建部署

在 `/deployments` 中使用以下配置创建部署：

- 运行时：`SGLang`
- 模型引用：`nvidia/LocateAnything-3B`
- 镜像：保留默认值
- CPU：`8`
- 内存：`32 Gi`
- GPU 分配方式：`整卡`
- GPU：`1`
- 副本：`1`

创建后部署处于草稿状态。确认配置后点击“上线”。首次启动需要拉取 SGLang 镜像和约 7.8 GB 的模型文件；后续会复用节点上的 Hugging Face 缓存。

如果集群不能直接访问 Hugging Face，可在控制面配置：

```env
INFERENCE_HF_ENDPOINT=https://hf-mirror.com
```

## API 调用

SGLang 暴露 OpenAI 兼容的 `/v1/chat/completions`。请求中的 `model` 使用 Cola 部署名称，而不是 Hugging Face 模型 ID。

以下示例假设部署名称为 `locate-anything`：

```bash
curl -X POST http://<master-ip>:<node-port>/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "locate-anything",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Locate all the instances that match the following description: person</c>car."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/street.jpg"
            }
          }
        ]
      }
    ],
    "max_tokens": 2048,
    "temperature": 0,
    "skip_special_tokens": false
  }'
```

返回文本包含归一化到 `0..1000` 的坐标，例如：

```text
<ref>person</ref><box><120><80><430><920></box>
```

调用方需要按照原图宽高把坐标换算为像素坐标。

## 验收

1. `GET /v1/models` 返回部署名称。
2. 图片和文本请求返回 HTTP 200。
3. 响应保留 `<ref>` 和 `<box>` 标记。
4. 同一张图片连续请求不会触发模型重复加载。
5. Pod 显存占用和响应耗时满足实际业务要求。

## 使用限制

LocateAnything-3B 当前 NVIDIA License 只允许学术和非营利研究用途，不允许普通商业使用。上线到业务环境前需要先确认使用场景符合模型许可证。
