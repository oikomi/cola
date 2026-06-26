# 远程工作环境部署脚本

这套脚本把 GPU 远程工作环境拆成四层：

1. 用 `kubeasz` 初始化和扩容 Kubernetes 集群
2. 在 GPU 节点上安装 `nvidia-container-toolkit`，并在集群里启用 HAMi GPU 共享调度
3. 构建一个基于 Ubuntu 24.04 GNOME/ubuntu-session + KasmVNC 的远程桌面镜像
4. 通过脚本在指定节点上创建独立工作区，每个工作区都有自己的 NodePort、密码和宿主机持久目录

推荐拓扑：

- `172.16.60.198`：`rw-node-022`，`amd64`，`master + etcd + worker`
- `192.168.5.178`：`rw-gpu-178`，`Jetson AGX / arm64`，可作为自动接力加入的 `worker + gpu`

仓库默认仍然以当前部署机同架构节点先拉起控制面，但如果 `cluster/nodes.json` 里同时声明了 Jetson 这类异构 `arm64` worker，`./bin/cluster.sh cluster install` 会在首轮安装完成后自动导出 bundle、同步仓库，并在次级架构节点上继续执行 `secondary-arch import + add-node`。当前自动接力仅覆盖 `worker` / `worker,gpu`，不自动扩容异构 `master/etcd`。

## 目录结构

```text
infra/k8s
├── bin
│   ├── cluster.sh        # 用户入口
│   └── internal          # 内部实现脚本
├── cluster
├── manifests
└── runtime            # 运行期生成，已被 .gitignore 忽略

workloads/remote-workspace   # 工作区镜像运行时资产
runtime/workspace            # 工作区业务运行时产物
```

## 前提

- 本地部署机能 SSH 到所有服务器
- 本地部署机需要可用的 `sudo`
- `./bin/cluster.sh cluster bootstrap` 需要：`git`、`node`、`curl` 或 `wget`
- `./bin/cluster.sh cluster install` 与 `./bin/cluster.sh cluster add-node` 会自动准备一套独立的现代版 Ansible 运行时
- `./scripts/workspace-image.sh build-and-load` 额外需要：`docker`
- GPU 节点已经安装 NVIDIA 驱动，`nvidia-smi` 可正常执行
- SSH 用户具备 `sudo` 权限

`cluster install` 准备 Ansible 运行时时会安装 Python 包。脚本默认使用清华 PyPI 镜像：

```text
https://pypi.tuna.tsinghua.edu.cn/simple
```

如果当前网络访问这个源不稳定，可以临时切换其他国内镜像：

```bash
K8S_PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple ./bin/cluster.sh cluster install
```

需要使用 HTTP 源或内网源时，可以补充：

```bash
K8S_PIP_INDEX_URL=http://your-pypi-mirror/simple \
K8S_PIP_TRUSTED_HOST=your-pypi-mirror \
./bin/cluster.sh cluster install
```

## 用户入口

用户侧只需要记一个入口：

```bash
./bin/cluster.sh <group> <action> [options]
```

旧的编号脚本已经下沉到 `bin/internal/`，作为实现细节保留，不再作为外部调用入口。`./bin/remote-work.sh` 仍可用，但只作为兼容别名转发到 `./bin/cluster.sh`。

常用命令：

- `./bin/cluster.sh cluster bootstrap`
- `./bin/cluster.sh cluster install`
- `./bin/cluster.sh gpu enable`
- `./bin/cluster.sh stack up`
- `./bin/cluster.sh dashboard deploy`
- `./bin/cluster.sh dashboard port-forward`
- `./bin/cluster.sh monitoring deploy`
- `./bin/cluster.sh monitoring port-forward`
- `./scripts/workspace-image.sh build-and-load`

如果你只是想把基础设施一次拉起来，可以直接执行：

```bash
./bin/cluster.sh stack up
```

它等价于依次执行：

- `./bin/cluster.sh cluster bootstrap`
- `./bin/cluster.sh cluster install`
- `./bin/cluster.sh gpu enable`
- `./bin/cluster.sh monitoring deploy`
- `./bin/cluster.sh monitoring port-forward`
- `./bin/cluster.sh dashboard deploy`
- `./bin/cluster.sh dashboard port-forward`

如果你还想在 bring-up 完成后顺手构建并分发工作区镜像，再额外执行：

```bash
./scripts/workspace-image.sh build-and-load
```

常用可选项：

- `--with-images`：传给 `cluster bootstrap`
- `--with-workspace-image`：在 `stack up` 里额外执行工作区镜像构建和分发
- `--skip-monitoring`：跳过 Prometheus 和 HAMi-WebUI 安装
- `--skip-dashboard`：跳过 Dashboard 安装与 port-forward
- `--skip-port-forward`：安装 Dashboard，但不启动 port-forward
- `--port-forward-foreground`：以前台模式运行 Dashboard port-forward

## 工作区业务入口

工作区创建和删除不再挂在 infra CLI 下，统一改为业务脚本：

```bash
./scripts/workspace.sh <command> [options]
```

常用命令：

- `./scripts/workspace.sh create --name alice --gpu 1`
- `./scripts/workspace.sh delete --name alice`
- `./scripts/workspace-image.sh build-and-load`

兼容性说明：

- `./bin/cluster.sh workspace create`
- `./bin/cluster.sh workspace delete`

这两个旧入口仍会跳转到 `./scripts/workspace.sh`，但不再作为主入口展示。

## Notebook 内 HTTP 服务入口

JupyterLab 只默认暴露 8888。Notebook 里启动 Gradio、Streamlit、`python -m http.server` 这类额外 HTTP 服务时，需要在训练页面的 JupyterLab 卡片里填写内部端口并点击“公开”。平台会为该端口创建独立 NodePort Service，外部访问地址使用 `infra/k8s/cluster/config.json` 里的 `controllerIp` 加自动分配的 NodePort。

Notebook 内服务必须监听 `0.0.0.0`，不能只绑定 `127.0.0.1`。例如：

```bash
python -m http.server 7860 --bind 0.0.0.0
```

```python
demo.launch(server_name="0.0.0.0", server_port=7860)
```

默认公开端口 NodePort 区间是 `32180-32199`，可通过 `COLA_JUPYTERLAB_PUBLIC_NODE_PORT_START` 和 `COLA_JUPYTERLAB_PUBLIC_NODE_PORT_END` 调整；该区间不要与其他业务 NodePort 区间重叠。

## Isaac

左侧菜单的 `Isaac` 是 Isaac Sim 和 Isaac Lab 在当前 K8s 下的推荐入口。它不复用
`KasmVNC + Xvnc` 桌面显示层，而是创建独立的 GPU 工作负载：

- `Headless WebRTC`：Pod 申请 GPU、启用 `runtimeClassName: nvidia`，使用 `hostNetwork` 暴露 Isaac streaming，客户端连接实际 GPU 节点 IP。
- `Headless EGL`：只运行 headless 仿真，不暴露浏览器画面入口，适合批量仿真、数据生成和脚本验证。
- `Lab Jobs`：创建 Kubernetes Job 跑 Isaac Lab 训练或实验任务，默认使用 Isaac Lab 镜像、共享工作目录和 HAMi/NVIDIA GPU 调度；可在创建时选择 `Headless` 或 `WebRTC`。

Isaac Station 和 Isaac Lab WebRTC 模式默认客户端端点：

```text
TCP 8011
```

该入口使用 GPU 节点网络，不走普通 NodePort。需要确认安全组、防火墙和云桌面网络允许访问对应节点 IP 的 `8011/TCP`。Isaac Sim 5.0.0 容器暴露的是 `/v1/streaming/*` 服务 API，不内置旧版 `/streaming/webrtc-client` 浏览器页面；需要用 Isaac Sim WebRTC Streaming Client 连接节点 IP 和端口。

Isaac Lab Job 选择 `Headless` 时平台默认追加 `--headless`；选择 `WebRTC` 时平台默认追加 `--livestream 2`，并为 Job Pod 启用 `hostNetwork`，客户端同样连接实际 GPU 节点 IP 的 `8011/TCP`。`Custom runner` 会直接执行用户填写的命令，平台只负责 WebRTC 网络暴露，命令里是否传 `--livestream` 由用户自己控制。

常用环境变量：

```text
COLA_ISAAC_STATION_IMAGE=nvcr.io/nvidia/isaac-sim:5.0.0
COLA_ISAAC_STATION_IMAGES=nvcr.io/nvidia/isaac-sim:5.0.0,nvcr.io/nvidia/isaac-sim:4.5.0
COLA_ISAAC_STATION_GPU_RUNTIME=nvidia
COLA_ISAAC_STATION_RUNTIME_CLASS_NAME=nvidia
COLA_ISAAC_STATION_NVIDIA_DRIVER_HOST_PATH=/tmp/cola-nvidia-run-570.211.01/NVIDIA-Linux-x86_64-570.211.01
COLA_ISAAC_STATION_COMMAND=<自定义 Isaac 启动命令>
COLA_ISAAC_STATION_EXTRA_ARGS=<附加 Isaac 参数>
COLA_ISAAC_STATION_SEAWEEDFS_MOUNT_ENABLED=false
COLA_ISAAC_STATION_WORKDIR_HOST_PATH=/var/lib/remote-work/isaac-station
COLA_ISAAC_STATION_WORKDIR_MOUNT_PATH=/shared-dist-storage
COLA_ISAAC_STATION_PVC_NAME=<可选 PVC>
```

Isaac Station 默认使用官方 Isaac Sim 镜像和节点的 `nvidia` runtime，不再为 Isaac Sim 自行构建镜像。
如果 GPU 节点没有通过系统包或 NVIDIA runfile 安装匹配驱动版本的 GL/EGL/Vulkan/OptiX 用户态库，
可以把官方 NVIDIA runfile 的解压目录配置到 `COLA_ISAAC_STATION_NVIDIA_DRIVER_HOST_PATH`。该目录必须和节点内核驱动版本一致，
例如节点 `nvidia-smi` 显示 `570.211.01` 时使用同版本 runfile 解压目录。

当前 Isaac Sim 镜像内的 `fusermount` 可能和节点侧 `fusermount3` 存在 glibc 版本不匹配。遇到 `GLIBC_2.38 not found` 时，先将 `COLA_ISAAC_STATION_SEAWEEDFS_MOUNT_ENABLED=false`，让 Isaac Station 使用节点 `hostPath` 工作目录；已有 Pod 需要删除并重新创建。

Isaac Lab Job 常用环境变量：

```text
COLA_ISAAC_LAB_IMAGE=nvcr.io/nvidia/isaac-lab:2.2.0
COLA_ISAAC_LAB_IMAGES=registry.local/isaac-lab:2.3.2,registry.local/isaac-lab:2.2.0
COLA_ISAAC_LAB_EXTRA_ARGS=<附加训练参数>
COLA_ISAAC_LAB_ROOT=/workspace/isaaclab
COLA_ISAAC_LAB_EXECUTABLE='${ISAACLAB_PATH:-/workspace/isaaclab}/isaaclab.sh'
COLA_ISAAC_LAB_RUNTIME_CLASS_NAME=nvidia
COLA_ISAAC_LAB_WORK_VOLUME_MOUNT_MODE=smb
COLA_SMB_URL=smb://172.16.60.47
COLA_SMB_SHARE_NAME=nas-share
COLA_SMB_USERNAME=nas-share
COLA_SMB_PASSWORD=NAS-a1@123
COLA_SMB_MOUNT_OPTIONS=vers=3.0,iocharset=utf8,uid=1000,gid=1000,file_mode=0777,dir_mode=0777,noperm
COLA_ISAAC_LAB_WORKDIR_MOUNT_PATH=/shared-dist-storage
COLA_ISAAC_LAB_PVC_NAME=<可选 PVC>
COLA_ISAAC_LAB_GITLAB_TOKEN_SECRET_NAME=isaac-gitlab-token
COLA_ISAAC_LAB_GITLAB_TOKEN_SECRET_KEY=GITLAB_TOKEN
COLA_ISAAC_LAB_GITLAB_TOKEN_ENV_NAME=GITLAB_TOKEN
```

GitLab 私有仓库训练代码可以通过 Kubernetes Secret 注入 token。默认 Secret 创建方式：

```bash
kubectl -n remote-work create secret generic isaac-gitlab-token \
  --from-literal=GITLAB_TOKEN='<your-gitlab-token>'
```

然后在 `Lab Jobs` 里选择 `Runner = custom`，启动命令里使用 `${GITLAB_TOKEN}` clone 仓库，再执行训练脚本。
默认 runner 会在镜像内 Isaac Lab 根目录 `/workspace/isaaclab` 执行，输出目录仍挂载到 `/shared-dist-storage`。

Isaac 的验收重点不是 `DISPLAY=:1 glxinfo -B`，而是 Pod 内 `nvidia-smi`、Vulkan/EGL 用户态、Isaac headless 启动日志、WebRTC 客户端连接，以及 Isaac Lab Job 的 Pod phase、训练日志和输出目录是否正常。

## 1. 调整机器清单

编辑：

- `cluster/config.json`
- `cluster/nodes.json`

`nodes.json` 里每台机器都要包含：

- `name`：Kubernetes 节点名
- `ip`：SSH 地址
- `sshUser`
- `sshPassword`
- `sshPort`
- `roles`
- `arch`

`roles` 当前支持：

- `master`
- `etcd`
- `worker`
- `gpu`

`arch` 当前支持：

- `amd64`
- `arm64`

`cluster/config.json` 里的 `kubernetesVersion` 最稳妥的写法，是与当前 kubeasz `ezdown` 中的 `K8S_BIN_VER` 保持一致。
例如当前仓库固定的 kubeasz `3.6.8`，默认对应的是 `v1.34.1`。

额外可选字段：

- `controllerIp`：控制机 IP，用于让各节点把 `easzlab.io.local` 解析到正确地址
- `enableChrony`：默认 `false`，因为 `chrony` 在 kubeasz 里本身是可选项
- `chronyServerNode`：仅当 `enableChrony=true` 时使用，可指定哪台节点做内部时间源
- `proxyMode`：可选 `iptables` 或 `ipvs`；未显式设置时，混合架构集群默认使用 `iptables`，单架构集群默认使用 `ipvs`
- `sandboxImage`：可选；未显式设置时，secondary-arch 接力默认使用官方多架构 `registry.k8s.io/pause:3.10`

## 2. 下载 kubeasz 并渲染集群 inventory

```bash
cd infra/k8s
./bin/cluster.sh cluster bootstrap
```

这个脚本会：

- 克隆指定版本的 `kubeasz`
- 预下载 Docker 静态包，并在清华镜像 403 时自动 fallback 到官方地址
- 默认只准备二进制和 `/etc/kubeasz` 资产，不强制推送默认镜像到本地 registry
- 在不依赖本机 Ansible 的前提下初始化 cluster 目录
- 自动给 kubeasz 的 `prepare` 角色打一层兼容补丁，避免依赖 `SSH_CLIENT` 环境变量
- 如果你配置的 `kubernetesVersion` 对应镜像 tag 不存在，会自动回退到 kubeasz 自带版本
- 根据 `cluster/nodes.json` 生成 kubeasz `hosts` 文件
- 生成的 inventory 默认带 `sudo` 提权、`/usr/bin/python3` 解释器配置，以及 `local_registry_host`

如果你确实想在 bootstrap 阶段顺手预热 kubeasz 默认镜像，再显式执行：

```bash
./bin/cluster.sh cluster bootstrap --with-images
```

## 3. 安装集群

```bash
./bin/cluster.sh cluster install
```

首轮安装仍只会纳入与当前部署机同架构的节点。
按当前默认配置，从 `172.16.60.198` 这台 `amd64` 部署机执行时，会先拉起单节点控制面 `rw-node-022`，随后如果 `cluster/nodes.json` 中存在异构 `worker` / `worker,gpu` 节点，则脚本会自动继续 secondary-arch 接力，把这些节点一并加入集群。

安装完成后，脚本会自动：

- 同步一份用户可读的 kubeconfig 到 `~/.kube/<clusterName>.config`
- 让 `/etc/kubeasz/clusters/<clusterName>/kubectl.kubeconfig` 对当前用户组可读
- 在混合架构场景下，自动刷新本地 kubeasz inventory，并为异构节点预拉官方多架构的 Calico 镜像

## 4. 启用 GPU 支持

```bash
./bin/cluster.sh gpu enable
```

这个脚本会：

- SSH 到所有 `gpu` 角色节点
- 安装 `nvidia-container-toolkit`
- 配置 containerd 的 `nvidia` runtime
- 重启 containerd
- 给节点打上 `remote-work/workspace=true`、`remote-work/gpu=true` 和 `gpu=on`
- 保留 `RuntimeClass nvidia`
- 使用 Helm 在集群里部署 HAMi（device plugin + scheduler）

可选项：

- `--chart-version <ver>`：指定 HAMi chart 版本

## 5. 构建并分发 KasmVNC 工作区镜像

```bash
./scripts/workspace-image.sh build-and-load
```

镜像构建上下文位于仓库根目录的 `workloads/remote-workspace/`。
默认基础镜像为 Ubuntu 24.04，可以通过 `--ubuntu-version <ver>` 临时切换。
脚本默认按集群首个节点架构构建镜像；在 Apple Silicon 等非集群架构机器上也可以显式使用 `--target-arch amd64`。
amd64 镜像默认会 bake 与当前 GPU 节点匹配的 NVIDIA `570.211.01` 图形/Vulkan 用户态文件，避免新建 GPU 云桌面后
`vulkaninfo` 或 Isaac Sim 因容器内 GLX/EGL/Vulkan 用户态缺失或版本不匹配而失败。宿主机 NVIDIA 驱动版本变化后，
需要用匹配版本重新构建，例如 `--nvidia-driver-version 570.211.01`；如使用内网 runfile 缓存，可加
`--nvidia-driver-runfile-url <url>`。
默认镜像名会写入 `runtime/workspace/latest-image.txt`。后续创建工作区如果不显式传 `--image`，就会自动使用它。

兼容性说明：

- `./bin/cluster.sh image build-and-load`

这个旧入口仍可用，但会跳转到 `./scripts/workspace-image.sh build-and-load`。

## 6. 部署 Kubernetes Dashboard

如果你希望有一个图形化集群管理入口，可以部署 Kubernetes Dashboard：

```bash
./bin/cluster.sh dashboard deploy
```

默认行为：

- 通过官方 Helm chart 安装 `kubernetes-dashboard`
- 保持官方 chart 的默认 `ClusterIP`
- 创建一个 `admin-user` ServiceAccount 和长期保存的 `admin-user-token` Secret
- 如果官方 Helm repo 在当前网络环境里返回 `404` 或不可达，会自动回退到官方 GitHub release 的 `.tgz` chart 包

按官方文档方式启动 `port-forward`：

```bash
./bin/cluster.sh dashboard port-forward
```

默认行为：

- 监听 `0.0.0.0:8443`
- 在后台运行
- 日志写到 `runtime/k8s-dashboard-port-forward.log`

浏览器地址：

```text
https://<部署机IP>:8443/
```

常用控制命令：

```bash
./bin/cluster.sh dashboard port-forward --status
./bin/cluster.sh dashboard port-forward --stop
./bin/cluster.sh dashboard port-forward --foreground
```

获取登录 Token：

```bash
./bin/cluster.sh dashboard token
```

这个 token 不是默认 `24h` 临时 token，而是从 `admin-user-token` Secret 里读取的长期 token。

说明：

- 这里按 Kubernetes 官方文档推荐的方式接入：Helm 安装 + `port-forward`
- 不再默认改成 `NodePort`
- 如果当前网络环境下 Dashboard Pod 拉镜像失败，可先执行 `./bin/cluster.sh dashboard prepull-images` 再重跑安装

## 6.1 GPU 监控（Prometheus + HAMi-WebUI）

如果你希望在项目内直接部署 GPU 监控面板，可以执行：

```bash
./bin/cluster.sh monitoring deploy
```

`./bin/cluster.sh stack up` 现在默认也会执行这一步；如果你只想拉起基础集群和 Dashboard，可以改用 `--skip-monitoring`。

默认行为：

- 在 `monitoring` namespace 安装 `kube-prometheus-stack`
- 默认关闭 `Grafana` 和 `Alertmanager`
- 在 `kube-system` 安装 `HAMi-WebUI`
- 自动把 HAMi-WebUI 的 Prometheus 地址指向
  `http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090`

可选项：

- `--prom-chart-version <ver>`：指定 `kube-prometheus-stack` chart 版本
- `--webui-chart-version <ver>`：指定 `HAMi-WebUI` chart 版本
- `--enable-grafana`：同时启用 Grafana
- `--enable-alertmanager`：同时启用 Alertmanager

启动 HAMi-WebUI 端口转发：

```bash
./bin/cluster.sh monitoring port-forward
```

默认行为：

- 监听 `0.0.0.0:3000`
- 在后台运行
- 日志写到 `runtime/hami-webui-port-forward.log`

浏览器地址：

```text
http://<部署机IP>:3000/
```

常用控制命令：

```bash
./bin/cluster.sh monitoring port-forward --status
./bin/cluster.sh monitoring port-forward --stop
./bin/cluster.sh monitoring port-forward --foreground
```

## 7. 创建一个远程工作区

```bash
./scripts/workspace.sh create \
  --name alice \
  --gpu 1
```

常用参数：

- `--name`：工作区名字
- `--node`：可选。显式指定目标节点名，必须是 `nodes.json` 里的 `name`
- `--password`：可选。传入时启用 VNC 密码；默认免密码访问
- `--gpu`：默认 `0`，设为 `1` 后会为 Pod 申请一张 GPU 并启用 `runtimeClassName: nvidia`
- `--resolution`：默认 `1920x1080x24`
- `--ingress-host`：可选，若集群已经有 ingress-nginx，可为工作区额外生成 Ingress

脚本会自动：

- 如果未传 `--node`，从 Ready 节点里自动选择一台合适机器
- 选择未占用的 NodePort
- 生成 Secret / Deployment / Service / Ingress
- 把用户目录持久化到目标节点的 `/var/lib/remote-work/workspaces/<name>/`

自动选节点规则：

- `--gpu 1` 时优先挑选可提供 GPU 的 Ready 节点
- 非 GPU 工作区时在 Ready worker 节点中选择
- 如果已经打了 `remote-work/workspace=true` 标签，会优先从已打标签节点里选
- 多台候选节点时，优先选现有工作区数量最少的一组，再在其中随机选一台

如果没有配置 Ingress，访问地址形如：

```text
http://<节点IP>:<自动分配端口>/
```

## 8. 删除工作区

```bash
./scripts/workspace.sh delete --name alice
```

如果还要连宿主机持久目录一起删掉：

```bash
./scripts/workspace.sh delete --name alice --node rw-gpu-178 --purge-data
```

## 9. 新增节点

新增普通工作节点：

```bash
./bin/cluster.sh cluster add-node \
  --name rw-node-023 \
  --ip 192.168.5.23 \
  --ssh-user root \
  --ssh-password 'secret' \
  --roles worker
```

新增 GPU 节点：

```bash
./bin/cluster.sh cluster add-node \
  --name rw-gpu-024 \
  --ip 192.168.5.24 \
  --ssh-user root \
  --ssh-password 'secret' \
  --roles worker,gpu
```

这个脚本当前只支持扩容 `worker` / `worker,gpu` 节点，不负责把新机器升级成 `master` 或 `etcd`。这样更稳，也更贴合“后续任意增加 node 服务器”的常见路径。

如果节点架构与当前部署机不一致，`cluster add-node` 会直接拒绝执行，并提示你改到同架构部署机上继续。

## 10. 混合架构接入

以当前场景为例：

- 主部署机：`172.16.60.198`，`amd64`
- 次级节点：`192.168.5.178`，Jetson AGX，`arm64`

当前默认推荐流程：

1. 在 `amd64` 部署机上完成 `cluster bootstrap`
2. 直接执行 `cluster install`
3. 脚本会在首轮控制面安装完成后，自动把 `rw-gpu-178` 这类异构 `worker` / `worker,gpu` 节点继续接力加入集群

如果你需要手工接管，仍然可以退回显式的双部署机流程：

1. 在 `amd64` 部署机上完成 `cluster bootstrap` 和 `cluster install`
2. 在 `amd64` 部署机上导出 kubeasz seed bundle
3. 把 bundle 和仓库拷到 Jetson 这台 `arm64` 机器
4. 在 Jetson 上导入 bundle、补齐 `arm64` 二进制，并执行 `add-node`

导出 bundle：

```bash
./bin/cluster.sh secondary-arch export
```

在 Jetson 上导入并直接加入节点：

```bash
./bin/cluster.sh secondary-arch import \
  --bundle /path/to/remote-work-kubeasz-seed.tar.gz \
  --name rw-gpu-178 \
  --ip 192.168.5.178 \
  --ssh-user nvidia \
  --ssh-password 'nvidia' \
  --roles worker,gpu \
  --arch arm64
```

这个流程本质上对应 kubeasz 官方 `docs/setup/mix_arch.md` 的“双部署机”模式，只是把步骤收成了仓库脚本。

## 11. 一键清理

销毁当前 `remote-work` 集群，并清理本机运行态：

```bash
./bin/cluster.sh cluster clean --yes
```

在混合架构场景下，脚本会先按 `cluster/nodes.json` 重新渲染完整 inventory，再执行 `ezctl destroy`，因此已经自动接力加入的 `arm64` worker 也会一并纳入销毁；同时会清理远端 `~/.remote-work-secondary-arch/<clusterName>` staging 目录。

清理会删除 `/etc/kubeasz/clusters/<clusterName>` 和 `/etc/kubeasz/bin`。后者是为了避免下一次 `cluster bootstrap` 因为 kubeasz 检测到旧二进制已存在而跳过下载，导致 `cluster/config.json` 里的 `kubernetesVersion` 没有真正生效。

如果还要顺手清每台节点上的工作区持久目录：

```bash
./bin/cluster.sh cluster clean --yes --purge-remote-data
```

默认会保留本地镜像归档和 `secondary-arch` 资产包，后续重装会直接复用；只有明确要求时才连缓存一起删：

```bash
./bin/cluster.sh cluster clean --yes --purge-local-cache
```

## 12. 已知边界

- 桌面显示层使用 `KasmVNC + Ubuntu GNOME/ubuntu-session`，Pod 能拿到 GPU 资源，但桌面本身不是 VirtualGL 硬件加速栈
- 工作区持久化依赖目标节点本地目录，所以工作区会固定到指定节点
- `gpu enable` 假设节点是 Debian/Ubuntu 或 RHEL 系发行版
- 训练任务和推理部署的“显存模式”依赖 HAMi；如果 Helm 仓库不可达，显存份额调度不会生效
- 混合架构场景下，主集群初始化和次级架构 `add-node` 必须在对应架构的部署机上执行
- 这套脚本没有在当前仓库 CI 中接真实服务器执行，交付的是静态校验通过的部署资产
