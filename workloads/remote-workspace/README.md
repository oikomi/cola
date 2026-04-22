# Remote Workspace Runtime

这个目录只保存远程工作区镜像本身的运行时资产：

- `Dockerfile`
- `scripts/`
- `config/`
- `assets/`

它不负责 Kubernetes 集群安装、GPU 启用或 Dashboard 部署。
镜像仍由 `infra/k8s/bin/internal/image-build-and-load.sh` 构建并分发到集群节点。
