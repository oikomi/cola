# SAM 2 推理运行时

推理部署模块提供独立的 `sam2` 运行时，用于 SAM 2 / SAM 2.1 图片提示分割和有状态视频目标跟踪。默认模型为 `facebook/sam2.1-hiera-tiny`，默认镜像为 `cola-sam2:local`。

## 实现基线

- 上游仓库：`https://github.com/facebookresearch/sam2`
- 固定提交：`2b90b9f5ceec907a1c18123530e92e794ad901a4`
- Python：3.10+
- PyTorch 基础镜像：`pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime`
- 服务端口：`8000`

镜像构建时固定上游提交，并设置 `SAM2_BUILD_CUDA=0`。SAM 2 的可选 CUDA 后处理扩展不会编译，核心图片与视频推理不受影响，镜像也不依赖构建节点安装 `nvcc`。

## 构建镜像

只在本地构建：

```bash
./scripts/sam2-inference-image.sh build
```

构建并分发到集群节点：

```bash
./scripts/sam2-inference-image.sh build-and-load
```

脚本只从 `infra/k8s/cluster/nodes.json` 读取节点和架构信息，不会修改远程机器上的代码。需要交叉构建时可显式指定：

```bash
./scripts/sam2-inference-image.sh build-and-load --target-arch amd64
```

## 创建部署

在 `/deployments` 中选择：

- 运行时：`SAM 2 分割`
- 模型：建议先使用 `facebook/sam2.1-hiera-tiny`
- 镜像：`cola-sam2:local`
- 资源：建议从 8 CPU、32 Gi 内存、1 张整卡 GPU 开始
- 副本：固定为 1

视频 predictor 会在进程内保存会话状态，因此控制面和服务端都会拒绝多副本 SAM 2 部署。Service 同时启用 `ClientIP` session affinity，避免后续扩展时意外破坏会话路由。

可用的官方模型：

- `facebook/sam2.1-hiera-tiny`
- `facebook/sam2.1-hiera-small`
- `facebook/sam2.1-hiera-base-plus`
- `facebook/sam2.1-hiera-large`
- 对应的 SAM 2.0 `facebook/sam2-hiera-*` 模型

首次启动会从 Hugging Face 下载 checkpoint 到推理缓存。无法直连 Hugging Face 时可在控制面环境中设置 `INFERENCE_HF_ENDPOINT`。

## 图片分割 API

健康检查及 OpenAPI：

```bash
curl http://<master-ip>:<node-port>/health
```

浏览器打开 `http://<master-ip>:<node-port>/docs` 可查看完整请求结构。

使用前景点分割：

```bash
curl -X POST http://<master-ip>:<node-port>/predict \
  -F image=@/path/to/image.jpg \
  -F 'points=[[320,240]]' \
  -F 'labels=[1]'
```

使用边界框分割：

```bash
curl -X POST http://<master-ip>:<node-port>/predict \
  -F image=@/path/to/image.jpg \
  -F 'box=[100,80,540,420]'
```

`labels` 中 `1` 表示前景点，`0` 表示背景点。坐标使用原图像素。响应中的每个 mask 包含：

- `png_base64`：8 位灰度 PNG，前景值为 255
- `size`：`[height, width]`
- `area`：前景像素数
- `bbox`：`[x, y, width, height]`
- `score`：SAM 2 预测质量分数

## 视频会话 API

创建会话并上传 MP4：

```bash
curl -X POST http://<master-ip>:<node-port>/video/sessions \
  -F video=@/path/to/video.mp4 \
  -F offload_video_to_cpu=true
```

为第 0 帧中的对象 `1` 添加提示框：

```bash
curl -X POST http://<master-ip>:<node-port>/video/sessions/<session-id>/prompts \
  -H 'content-type: application/json' \
  -d '{"frame_index":0,"object_id":1,"box":[100,80,540,420]}'
```

向前和向后传播 mask：

```bash
curl -N -X POST http://<master-ip>:<node-port>/video/sessions/<session-id>/propagate \
  -H 'content-type: application/json' \
  -d '{"direction":"both"}'
```

传播响应为 `application/x-ndjson`，逐帧返回 `frame` 事件，最后返回 `complete`。长任务可以取消，完成后应关闭会话释放内存和临时视频：

```bash
curl -X POST http://<master-ip>:<node-port>/video/sessions/<session-id>/cancel
curl -X DELETE http://<master-ip>:<node-port>/video/sessions/<session-id>
```

默认最多同时保留 2 个视频会话，会话空闲 1 小时后清理，单个 MP4 最大 512 MiB。可以通过 `SAM2_MAX_VIDEO_SESSIONS`、`SAM2_SESSION_TTL_SECONDS` 和 `SAM2_MAX_VIDEO_BYTES` 调整。
