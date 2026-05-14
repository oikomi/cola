# Remote Workspace Runtime

这个目录只保存远程工作区镜像本身的运行时资产：

- `Dockerfile`
- `scripts/`
- `config/`
- `assets/`

它不负责 Kubernetes 集群安装、GPU 启用或 Dashboard 部署。
镜像仍由 `infra/k8s/bin/internal/image-build-and-load.sh` 构建并分发到集群节点。
默认基础镜像为 Ubuntu 24.04.4 对应的 Noble 官方容器 tag `ubuntu:noble-20260410`，可通过 `./scripts/workspace-image.sh build-and-load --ubuntu-version <ver>` 切换。
如果外部 registry 网络不稳定，也可以用 `--base-image remote-workspace:ubuntu24` 复用本地已经构建好的 Ubuntu 24.04.4 工作区镜像层。
`debs/` 保存 Chrome 及其少量运行依赖的 Noble amd64 离线包；网络不稳定时可通过 `--offline-deb-dir /opt/remote-work-debs` 构建。
如需从 Apple Silicon 主机为 amd64 集群节点构建，可使用 `--target-arch amd64`。

`novnc/vnc_lite.html` 是项目维护的轻量 noVNC 入口。它保留上游 lite 页面结构，
并额外把浏览器粘贴事件同步到远端 VNC 剪贴板，方便从外部复制内容到远程桌面。
