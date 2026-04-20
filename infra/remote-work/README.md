# 远程工作环境部署脚本

这套脚本把 GPU 远程工作环境拆成四层：

1. 用 `kubeasz` 初始化和扩容 Kubernetes 集群
2. 在 GPU 节点上安装 `nvidia-container-toolkit`，并在集群里启用 NVIDIA device plugin
3. 构建一个基于 Ubuntu + XFCE + x11vnc + noVNC 的远程桌面镜像
4. 通过脚本在指定节点上创建独立工作区，每个工作区都有自己的 NodePort、密码和宿主机持久目录

当前默认拓扑：

- `192.168.5.178`：`rw-gpu-178`，`master + etcd + worker + gpu`
- `192.168.5.22`：`rw-node-022`，`worker`

后续增加新机器时，直接使用 `bin/60-add-node.sh` 加入为新的 `worker` 或 `worker,gpu` 节点即可。

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
- `10-install-cluster.sh` 额外需要：`ansible-playbook`
- `30-build-and-load-image.sh` 额外需要：`docker`
- GPU 节点已经安装 NVIDIA 驱动，`nvidia-smi` 可正常执行
- SSH 用户具备 `sudo` 权限

如果部署机是 Ubuntu / Debian，缺少 Ansible 时可执行：

```bash
sudo apt-get update
sudo apt-get install -y ansible
```

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

`roles` 当前支持：

- `master`
- `etcd`
- `worker`
- `gpu`

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
- 根据 `cluster/nodes.json` 生成 kubeasz `hosts` 文件

## 3. 安装集群

```bash
./bin/10-install-cluster.sh
```

执行完成后，控制平面会落在 `rw-gpu-178`，`rw-node-022` 会作为工作节点加入。

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

## 9. 已知边界

- 桌面显示层使用 `Xvfb + XFCE + x11vnc + noVNC`，Pod 能拿到 GPU 资源，但桌面本身不是 VirtualGL 硬件加速栈
- 工作区持久化依赖目标节点本地目录，所以工作区会固定到指定节点
- `bin/20-enable-gpu.sh` 假设节点是 Debian/Ubuntu 或 RHEL 系发行版
- 这套脚本没有在当前仓库 CI 中接真实服务器执行，交付的是静态校验通过的部署资产
