# 远程工作环境部署脚本

这套脚本把 GPU 远程工作环境拆成四层：

1. 用 `kubeasz` 初始化和扩容 Kubernetes 集群
2. 在 GPU 节点上安装 `nvidia-container-toolkit`，并在集群里启用 NVIDIA device plugin
3. 构建一个基于 Ubuntu + XFCE + x11vnc + noVNC 的远程桌面镜像
4. 通过脚本在指定节点上创建独立工作区，每个工作区都有自己的 NodePort、密码和宿主机持久目录

推荐拓扑：

- `192.168.5.22`：`rw-node-022`，`amd64`，`master + etcd + worker`
- `192.168.5.178`：`rw-gpu-178`，`Jetson AGX / arm64`，建议作为二阶段加入的 `worker + gpu`

仓库默认 `cluster/nodes.json` 只预置首轮引导节点 `rw-node-022`。后续增加同架构节点时，直接使用 `bin/60-add-node.sh`；如果要加入 Jetson 这类异构 `arm64` 节点，走本文后面的“混合架构接入”流程。

## 目录结构

```text
infra/remote-work
├── bin
├── cluster
├── images/remote-workspace
├── manifests
└── runtime            # 运行期生成，已被 .gitignore 忽略
```

## 前提

- 本地部署机能 SSH 到所有服务器
- 本地部署机需要可用的 `sudo`
- `00-bootstrap-kubeasz.sh` 需要：`git`、`node`、`curl` 或 `wget`
- `10-install-cluster.sh` 与 `60-add-node.sh` 会自动准备一套独立的现代版 Ansible 运行时
- `30-build-and-load-image.sh` 额外需要：`docker`
- GPU 节点已经安装 NVIDIA 驱动，`nvidia-smi` 可正常执行
- SSH 用户具备 `sudo` 权限

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

## 2. 下载 kubeasz 并渲染集群 inventory

```bash
cd infra/remote-work
./bin/00-bootstrap-kubeasz.sh
```

这个脚本会：

- 克隆指定版本的 `kubeasz`
- 预下载 Docker 静态包，并在清华镜像 403 时自动 fallback 到官方地址
- 通过 `sudo ./ezdown -D -k <k8s version>` 初始化 `/etc/kubeasz`
- 在不依赖本机 Ansible 的前提下初始化 cluster 目录
- 自动给 kubeasz 的 `prepare` 角色打一层兼容补丁，避免依赖 `SSH_CLIENT` 环境变量
- 如果你配置的 `kubernetesVersion` 对应镜像 tag 不存在，会自动回退到 kubeasz 自带版本
- 根据 `cluster/nodes.json` 生成 kubeasz `hosts` 文件
- 生成的 inventory 默认带 `sudo` 提权、`/usr/bin/python3` 解释器配置，以及 `local_registry_host`

## 3. 安装集群

```bash
./bin/10-install-cluster.sh
```

首轮安装只会纳入与当前部署机同架构的节点。
按当前默认配置，从 `192.168.5.22` 这台 `amd64` 部署机执行时，会先拉起一个单节点控制面：`rw-node-022`。

## 4. 启用 GPU 支持

```bash
./bin/20-enable-gpu.sh
```

这个脚本会：

- SSH 到所有 `gpu` 角色节点
- 安装 `nvidia-container-toolkit`
- 配置 containerd 的 `nvidia` runtime
- 重启 containerd
- 给节点打上 `remote-work/workspace=true` 与 `remote-work/gpu=true`
- 在集群里部署 `nvidia-device-plugin`

## 5. 构建并分发 noVNC 工作区镜像

```bash
./bin/30-build-and-load-image.sh
```

默认镜像名会写入 `runtime/latest-image.txt`。后续创建工作区如果不显式传 `--image`，就会自动使用它。

## 6. 创建一个远程工作区

```bash
./bin/50-create-workspace.sh \
  --name alice \
  --node rw-gpu-178 \
  --password 'ChangeMe-123!' \
  --gpu 1
```

常用参数：

- `--name`：工作区名字
- `--node`：目标节点名，必须是 `nodes.json` 里的 `name`
- `--password`：VNC 密码
- `--gpu`：默认 `0`，设为 `1` 后会为 Pod 申请一张 GPU 并启用 `runtimeClassName: nvidia`
- `--resolution`：默认 `1920x1080x24`
- `--ingress-host`：可选，若集群已经有 ingress-nginx，可为工作区额外生成 Ingress

脚本会自动：

- 选择未占用的 NodePort
- 生成 Secret / Deployment / Service / Ingress
- 把用户目录持久化到目标节点的 `/var/lib/remote-work/workspaces/<name>/`

如果没有配置 Ingress，访问地址形如：

```text
http://<节点IP>:<自动分配端口>/vnc.html?autoconnect=1&resize=remote
```

## 7. 删除工作区

```bash
./bin/51-delete-workspace.sh --name alice
```

如果还要连宿主机持久目录一起删掉：

```bash
./bin/51-delete-workspace.sh --name alice --node rw-gpu-178 --purge-data
```

## 8. 新增节点

新增普通工作节点：

```bash
./bin/60-add-node.sh \
  --name rw-node-023 \
  --ip 192.168.5.23 \
  --ssh-user root \
  --ssh-password 'secret' \
  --roles worker
```

新增 GPU 节点：

```bash
./bin/60-add-node.sh \
  --name rw-gpu-024 \
  --ip 192.168.5.24 \
  --ssh-user root \
  --ssh-password 'secret' \
  --roles worker,gpu
```

这个脚本当前只支持扩容 `worker` / `worker,gpu` 节点，不负责把新机器升级成 `master` 或 `etcd`。这样更稳，也更贴合“后续任意增加 node 服务器”的常见路径。

如果节点架构与当前部署机不一致，`60-add-node.sh` 会直接拒绝执行，并提示你改到同架构部署机上继续。

## 9. 混合架构接入

以当前场景为例：

- 主部署机：`192.168.5.22`，`amd64`
- 次级节点：`192.168.5.178`，Jetson AGX，`arm64`

推荐流程：

1. 在 `amd64` 部署机上完成 `00` 和 `10`，只拉起 `rw-node-022`
2. 在 `amd64` 部署机上导出 kubeasz seed bundle
3. 把 bundle 和仓库拷到 Jetson 这台 `arm64` 机器
4. 在 Jetson 上导入 bundle、补齐 `arm64` 二进制，并执行 `add-node`

导出 bundle：

```bash
./bin/70-export-secondary-arch-bundle.sh
```

在 Jetson 上导入并直接加入节点：

```bash
./bin/71-import-secondary-arch-bundle.sh \
  --bundle /path/to/remote-work-kubeasz-seed.tar.gz \
  --name rw-gpu-178 \
  --ip 192.168.5.178 \
  --ssh-user nvidia \
  --ssh-password 'nvidia' \
  --roles worker,gpu \
  --arch arm64
```

这个流程本质上对应 kubeasz 官方 `docs/setup/mix_arch.md` 的“双部署机”模式，只是把步骤收成了仓库脚本。

## 10. 一键清理

销毁当前 `remote-work` 集群，并清理本机运行态：

```bash
./bin/99-clean-all.sh --yes
```

如果还要顺手清每台节点上的工作区持久目录：

```bash
./bin/99-clean-all.sh --yes --purge-remote-data
```

如果只想删集群，但保留本地 `runtime/` 缓存：

```bash
./bin/99-clean-all.sh --yes --keep-local-cache
```

## 11. 已知边界

- 桌面显示层使用 `Xvfb + XFCE + x11vnc + noVNC`，Pod 能拿到 GPU 资源，但桌面本身不是 VirtualGL 硬件加速栈
- 工作区持久化依赖目标节点本地目录，所以工作区会固定到指定节点
- `bin/20-enable-gpu.sh` 假设节点是 Debian/Ubuntu 或 RHEL 系发行版
- 混合架构场景下，主集群初始化和次级架构 `add-node` 必须在对应架构的部署机上执行
- 这套脚本没有在当前仓库 CI 中接真实服务器执行，交付的是静态校验通过的部署资产
