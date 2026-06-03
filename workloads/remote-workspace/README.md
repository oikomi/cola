# Remote Workspace Runtime

这个目录只保存远程工作区镜像本身的运行时资产：

- `Dockerfile`
- `scripts/`
- `config/`
- `assets/`

它不负责 Kubernetes 集群安装、GPU 启用或 Dashboard 部署。
镜像仍由 `infra/k8s/bin/internal/image-build-and-load.sh` 构建并分发到集群节点。
默认基础镜像为 Ubuntu 24.04.4 对应的 Noble 官方容器 tag `ubuntu:noble-20260410`，桌面会话使用 Ubuntu 24.04 的 GNOME/ubuntu-session，并通过 KasmVNC 内置 Web 客户端暴露到浏览器。基础镜像可通过 `./scripts/workspace-image.sh build-and-load --ubuntu-version <ver>` 切换。
KasmVNC 容器内 Web 端口固定为 `6080`，避免使用默认 `8443 + display` 端口。
KasmVNC 启动时会显式开启双向文本剪贴板：外部浏览器和内部桌面之间可通过常规复制/粘贴快捷键同步文本；如浏览器拦截剪贴板权限，可在 KasmVNC 控制面板的 Clipboard 面板中手动中转。
如果外部 registry 网络不稳定，也可以用 `--base-image remote-workspace:ubuntu24` 复用本地已经构建好的 Ubuntu 24.04.4 工作区镜像层。
默认浏览器使用 Mozilla APT 仓库安装的 Firefox deb 包，避免 Ubuntu 容器内 apt 安装 Firefox 时落到 snap。构建时可通过
`--mozilla-apt-url` 和 `--mozilla-apt-fallback-url` 切换 Mozilla APT 源，默认 fallback 使用 CERNET 镜像。
如果网络不稳定，`debs/` 可保存 Firefox 及其少量运行依赖的 Noble amd64 离线包，并通过 `--offline-deb-dir /opt/remote-work-debs` 构建。
本地只验证桌面启动时可临时加 `--skip-browser-install` 跳过 Firefox 下载；正式工作区镜像不建议使用该参数。
如果只是基于已完整构建的 `remote-workspace` 镜像迭代 `scripts/`、`config/`、`assets/` 或 `bin/`，
可加 `--skip-package-install` 跳过 apt 安装阶段。
如需从 Apple Silicon 主机为 amd64 集群节点构建，可使用 `--target-arch amd64`。
amd64 工作区镜像默认会从 NVIDIA 官方 runfile bake `570.211.01` 的 GLX/EGL/Vulkan 用户态文件、
GLVND/EGL vendor 配置、Vulkan ICD 和 NVIDIA application profiles，避免容器内 `apt install libnvidia-gl-*`
拉到与宿主机内核驱动不一致的用户态版本。GPU 工作区 Pod 会把 `VK_ICD_FILENAMES` 和
`VK_DRIVER_FILES` 指向镜像内的 `/opt/nvidia-current/icd.d/nvidia_icd.json`。如果 GPU 节点宿主机驱动升级，
需要用匹配版本重新构建并分发镜像，例如：

```bash
./scripts/workspace-image.sh build-and-load --target-arch amd64 --nvidia-driver-version 570.211.01
```

如果使用内网缓存的 NVIDIA runfile，可加 `--nvidia-driver-runfile-url <url>`。
