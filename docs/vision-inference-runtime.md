# 视觉推理运行时

推理部署模块支持 `vision-detection` 运行时，用于 RT-DETR、DETR 等 Hugging Face 目标检测模型。默认模型引用为 `PekingU/rtdetr_v2_r50vd`，默认镜像为 `cola-vision-tensorrt:local`。

## 构建并分发镜像

```bash
./scripts/vision-inference-image.sh build-and-load
```

这会在本机构建 `docker/vision-inference.Dockerfile`，再根据 `infra/k8s/cluster/nodes.json` 分发到同架构 Kubernetes 节点。不要在远程机器上修改代码。

默认基础镜像是 NVIDIA TensorRT 容器：

```bash
nvcr.io/nvidia/tensorrt:24.07-py3
```

如需切换 TensorRT 版本：

```bash
./scripts/vision-inference-image.sh build-and-load --base-image nvcr.io/nvidia/tensorrt:<tag>-py3
```

默认 pip 镜像源使用清华 PyPI：

```bash
https://pypi.tuna.tsinghua.edu.cn/simple
```

如需切换：

```bash
./scripts/vision-inference-image.sh build-and-load \
  --pip-index-url https://pypi.org/simple \
  --pip-trusted-host pypi.org
```

## 创建部署

在 `/deployments` 中创建推理部署：

- 运行时：`视觉检测`
- 模型引用：`PekingU/rtdetr_v2_r50vd`，或其他兼容 `AutoModelForObjectDetection` 的 Hugging Face 模型 ID
- 镜像：`cola-vision-tensorrt:local`
- 资源：默认 4 CPU、16 Gi 内存、1 GPU

创建后部署先处于草稿状态，点击“上线”后拉起 Pod。服务通过 master NodePort 暴露，入口会显示在部署列表里。

## 远程 API

健康检查：

```bash
curl http://<master-ip>:<node-port>/health
```

URL 图片预测：

```bash
curl -X POST http://<master-ip>:<node-port>/predict \
  -H 'content-type: application/json' \
  -d '{"image_url":"https://example.com/image.jpg","threshold":0.5}'
```

上传本地图片：

```bash
curl -X POST http://<master-ip>:<node-port>/predict \
  -F threshold=0.5 \
  -F image=@/path/to/image.jpg
```

返回字段包含：

- `model`：模型引用
- `device`：`cuda` 或 `cpu`
- `width` / `height`：输入图片尺寸
- `detections`：检测框数组，包含 `label_id`、`label`、`score`、`box`

`box` 为 `[x_min, y_min, x_max, y_max]`，坐标单位为像素。
