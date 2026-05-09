# Remote Workspace Runtime

这个目录只保存远程工作区镜像本身的运行时资产：

- `Dockerfile`
- `scripts/`
- `config/`
- `assets/`

它不负责 Kubernetes 集群安装、GPU 启用或 Dashboard 部署。
镜像仍由 `infra/k8s/bin/internal/image-build-and-load.sh` 构建并分发到集群节点。
默认基础镜像为 Ubuntu 24.04，可通过 `./scripts/workspace-image.sh build-and-load --ubuntu-version <ver>` 切换。
如需从 Apple Silicon 主机为 amd64 集群节点构建，可使用 `--target-arch amd64`。

`novnc/vnc_lite.html` 是项目维护的轻量 noVNC 入口。它保留上游 lite 页面结构，
并额外把浏览器粘贴事件同步到远端 VNC 剪贴板，方便从外部复制内容到远程桌面。
