# 远程工作环境部署脚本

这套脚本把 GPU 远程工作环境拆成四层：

1. 用 `kubeasz` 初始化和扩容 Kubernetes 集群
2. 在 GPU 节点上安装 `nvidia-container-toolkit`，并在集群里启用 NVIDIA device plugin
3. 构建一个基于 Ubuntu + XFCE + x11vnc + noVNC 的远程桌面镜像
4. 通过脚本在指定节点上创建独立工作区，每个工作区都有自己的 NodePort、密码和宿主机持久目录

推荐拓扑：

- `192.168.5.22`：`rw-node-022`，`amd64`，`master + etcd + worker`
- `192.168.5.178`：`rw-gpu-178`，`Jetson AGX / arm64`，可作为自动接力加入的 `worker + gpu`

仓库默认仍然以当前部署机同架构节点先拉起控制面，但如果 `cluster/nodes.json` 里同时声明了 Jetson 这类异构 `arm64` worker，`./bin/cluster.sh cluster install` 会在首轮安装完成后自动导出 bundle、同步仓库，并在次级架构节点上继续执行 `secondary-arch import + add-node`。当前自动接力仅覆盖 `worker` / `worker,gpu`，不自动扩容异构 `master/etcd`。

## 目录结构

```text
infra/remote-work
├── bin
│   ├── cluster.sh        # 用户入口
│   └── internal          # 内部实现脚本
├── cluster
├── images/remote-workspace
├── manifests
└── runtime            # 运行期生成，已被 .gitignore 忽略
```

## 前提

- 本地部署机能 SSH 到所有服务器
- 本地部署机需要可用的 `sudo`
- `./bin/cluster.sh cluster bootstrap` 需要：`git`、`node`、`curl` 或 `wget`
- `./bin/cluster.sh cluster install` 与 `./bin/cluster.sh cluster add-node` 会自动准备一套独立的现代版 Ansible 运行时
- `./bin/cluster.sh image build-and-load` 额外需要：`docker`
- GPU 节点已经安装 NVIDIA 驱动，`nvidia-smi` 可正常执行
- SSH 用户具备 `sudo` 权限

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
- `./bin/cluster.sh image build-and-load`
- `./bin/cluster.sh stack up`
- `./bin/cluster.sh dashboard deploy`
- `./bin/cluster.sh dashboard port-forward`

如果你只是想把基础设施一次拉起来，可以直接执行：

```bash
./bin/cluster.sh stack up
```

它等价于依次执行：

- `./bin/cluster.sh cluster bootstrap`
- `./bin/cluster.sh cluster install`
- `./bin/cluster.sh gpu enable`
- `./bin/cluster.sh image build-and-load`
- `./bin/cluster.sh dashboard deploy`
- `./bin/cluster.sh dashboard port-forward`

常用可选项：

- `--with-images`：传给 `cluster bootstrap`
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

兼容性说明：

- `./bin/cluster.sh workspace create`
- `./bin/cluster.sh workspace delete`

这两个旧入口仍会跳转到 `./scripts/workspace.sh`，但不再作为主入口展示。

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
cd infra/remote-work
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
按当前默认配置，从 `192.168.5.22` 这台 `amd64` 部署机执行时，会先拉起单节点控制面 `rw-node-022`，随后如果 `cluster/nodes.json` 中存在异构 `worker` / `worker,gpu` 节点，则脚本会自动继续 secondary-arch 接力，把这些节点一并加入集群。

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
- 给节点打上 `remote-work/workspace=true` 与 `remote-work/gpu=true`
- 优先把 `nvcr.io/nvidia/k8s-device-plugin` 同步到本地 registry，并在 GPU 节点预拉
- 在集群里部署 `nvidia-device-plugin`

## 5. 构建并分发 noVNC 工作区镜像

```bash
./bin/cluster.sh image build-and-load
```

默认镜像名会写入 `runtime/latest-image.txt`。后续创建工作区如果不显式传 `--image`，就会自动使用它。

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
http://<节点IP>:<自动分配端口>/vnc.html?autoconnect=1&resize=remote
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

- 主部署机：`192.168.5.22`，`amd64`
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

如果还要顺手清每台节点上的工作区持久目录：

```bash
./bin/cluster.sh cluster clean --yes --purge-remote-data
```

如果只想删集群，但保留本地 `runtime/` 缓存：

```bash
./bin/cluster.sh cluster clean --yes --keep-local-cache
```

## 12. 已知边界

- 桌面显示层使用 `Xvfb + XFCE + x11vnc + noVNC`，Pod 能拿到 GPU 资源，但桌面本身不是 VirtualGL 硬件加速栈
- 工作区持久化依赖目标节点本地目录，所以工作区会固定到指定节点
- `gpu enable` 假设节点是 Debian/Ubuntu 或 RHEL 系发行版
- 混合架构场景下，主集群初始化和次级架构 `add-node` 必须在对应架构的部署机上执行
- 这套脚本没有在当前仓库 CI 中接真实服务器执行，交付的是静态校验通过的部署资产
