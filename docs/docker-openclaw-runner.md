# Docker OpenClaw Runner 接入说明

## 0. 文档状态

- 更新时间：2026-04-17
- 适用范围：当前 `cola` 仓库的 OpenClaw Docker runner 接入方式
- 当前实现：已支持本地创建人物后异步拉起 OpenClaw 容器、runner 注册、心跳、拉任务、执行任务和回报执行会话

## 1. 文档目的

本文件说明如何把 Docker 里的 OpenClaw runner 接入到 Cola Virtual Office，使角色不仅显示在界面里，还能占用真实执行资源处理任务。

当前实现遵循两个原则：

- 不把真实模型配置和认证文件提交进仓库
- 尽量直接复用宿主机现有的 `~/.codex/config.toml` 与 `~/.codex/auth.json`

## 2. 当前实现概览

当前链路已经落地到代码：

1. 前端调用 `office.createAgent`
2. 后端先写入 `agent` 与 `device` 记录，状态分别变为 `waiting_device` 和 `maintenance`
3. 后台调用 `src/server/office/provision-docker-runner.ts` 执行 `docker pull` 与 `docker run`
4. 容器内运行 `scripts/openclaw-runner/bootstrap.mjs`
5. bootstrap 通过 `/api/worker/*` 接口完成注册、心跳、拉任务和会话回报
6. `/api/office/stream` 把状态变化通过 SSE 推到前端

关键代码位置：

- `src/server/api/routers/office.ts`
- `src/server/api/routers/worker.ts`
- `src/server/office/provision-docker-runner.ts`
- `scripts/openclaw-runner/bootstrap.mjs`
- `src/app/api/worker/register/route.ts`
- `src/app/api/worker/heartbeat/route.ts`
- `src/app/api/worker/tasks/next/route.ts`
- `src/app/api/worker/session/route.ts`

## 3. Worker 协议

当前仓库已经提供以下 REST 路由，供容器里的 bootstrap 脚本直接调用：

- `POST /api/worker/register`
- `POST /api/worker/heartbeat`
- `POST /api/worker/tasks/next`
- `POST /api/worker/session`
- `GET /api/office/stream`

它们分别用于：

- 注册设备到 Cola 设备池
- 周期性上报设备状态与健康摘要
- 空闲时拉取下一个待执行任务
- 回报执行会话与产物路径
- 让前端在人物、设备、任务状态变化时自动刷新

## 4. 宿主机准备

宿主机至少需要：

- 已安装并启动 Docker
- 存在 `~/.codex/config.toml`
- 存在 `~/.codex/auth.json`
- 仓库工作目录可被 Docker 挂载进容器

推荐挂载：

```yaml
volumes:
  - .:/workspace
  - ${HOME}/.codex:/home/node/.codex:ro
```

## 5. 推荐环境变量

最常用的一组变量如下：

```env
OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:latest
OPENCLAW_CONFIG_PATH=/Users/your-user/.codex/config.toml
OPENCLAW_AUTH_PATH=/Users/your-user/.codex/auth.json
OPENCLAW_WORKSPACE_ROOT=/absolute/path/to/cola
COLA_API_BASE_URL=http://host.docker.internal:50038
COLA_RUNNER_HOST=host.docker.internal
COLA_DASHBOARD_BIND_HOST=127.0.0.1
COLA_DASHBOARD_ALLOWED_ORIGINS=https://cola.example.com,https://openclaw.example.com
NEXT_PUBLIC_OPENCLAW_NATIVE_URL=https://cola.example.com/openclaw/{agentId}
```

说明：

- `OPENCLAW_IMAGE`：控制使用的容器镜像
- `OPENCLAW_CONFIG_PATH` / `OPENCLAW_AUTH_PATH`：告诉 provisioner 宿主机上哪份 Codex 配置需要挂进容器
- `OPENCLAW_WORKSPACE_ROOT`：挂载到容器 `/workspace` 的目录
- `COLA_API_BASE_URL`：容器回调控制面的地址；本地 Docker 默认可用 `host.docker.internal`
- `COLA_RUNNER_HOST`：写入设备元数据，便于界面展示和排障
- `COLA_DASHBOARD_BIND_HOST`：控制 dashboard 端口只绑本机还是暴露到公网
- `COLA_DASHBOARD_ALLOWED_ORIGINS`：OpenClaw Control UI 允许的浏览器来源
- `NEXT_PUBLIC_OPENCLAW_NATIVE_URL`：浏览器打开人物工作区时使用的地址模板

除上述变量外，bootstrap 也兼容：

- `COLA_CODEX_CONFIG_PATH`
- `OPENCLAW_CODEX_CONFIG_PATH`
- `COLA_CODEX_AUTH_PATH`
- `OPENCLAW_CODEX_AUTH_PATH`
- `OPENCLAW_READY_COMMAND`
- `OPENCLAW_TASK_COMMAND`
- `OPENCLAW_BOOT_COMMAND`

## 6. 默认 runner 行为

`scripts/openclaw-runner/bootstrap.mjs` 的默认行为如下：

- 启动后执行 `openclaw config validate` 做就绪检查
- 注册 runner，并把状态推进到 `online`、`maintenance` 或 `unhealthy`
- 每 15 秒发送一次 heartbeat
- 每 10 秒轮询一次下一个任务
- 使用 `openclaw infer model run --local --json --model <model> --prompt <prompt>` 执行任务
- 把日志写到 `/workspace/.openclaw-runner`
- 为每个任务生成 `result-<taskId>.json`，并把路径通过 session 回报给控制面

如果设置了 `OPENCLAW_TASK_COMMAND`，bootstrap 会优先执行自定义命令；如果设置了 `OPENCLAW_BOOT_COMMAND`，容器启动后会额外执行一次启动命令并上报对应会话状态。

## 7. 角色创建后的状态流转

当前 `createAgent` 是异步 provisioning，状态推进通常如下：

- `agent.waiting_device` + `device.maintenance`：数据库记录已创建，后台正在拉起容器
- `agent.idle` + `device.online`：runner 已注册并可接任务
- `agent.blocked` + `device.unhealthy`：镜像拉取、容器启动、就绪检查或任务执行失败

这部分状态由以下链路协同维护：

- `office.createAgent`
- `provisionDockerRunnerInBackground`
- `worker.registerDockerRunner`
- `worker.heartbeat`

## 8. 本地启动方式

### 8.1 通过人物创建自动拉起

这是当前仓库的主路径：

1. 启动 Cola 控制面
2. 在 `/` 或 `/control` 中创建一个使用 `OpenClaw` 引擎的人物
3. 等待设备状态从 `maintenance` 变成 `online`
4. 给该人物下发任务

### 8.2 通过 compose 手动调试

仓库提供了调试用 compose 文件：

- `docker/openclaw-runner.compose.yml`

对应 bootstrap 文件：

- `scripts/openclaw-runner/bootstrap.mjs`

如果只想单独验证 runner 链路，可以先启动控制面，再用 compose 起容器。

## 9. 远程访问与工作区地址

浏览器点击人物工作区时，当前仓库有两类可选地址：

### 9.1 使用 Cola 自带工作区页面

```env
NEXT_PUBLIC_OPENCLAW_NATIVE_URL=https://cola.example.com/openclaw/{agentId}
```

这会落到仓库内置页面 `src/app/openclaw/[agentId]/page.tsx`，适合把控制面和工作区统一托管在同一域名下。

### 9.2 直接使用 OpenClaw dashboard 域名

```env
COLA_DASHBOARD_BIND_HOST=0.0.0.0
COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST=openclaw.example.com
COLA_DASHBOARD_ALLOWED_ORIGINS=https://cola.example.com,https://openclaw.example.com
NEXT_PUBLIC_OPENCLAW_NATIVE_URL=https://openclaw.example.com/
```

这时前端会尽量保留 OpenClaw dashboard 返回的 token/hash，并把 `gatewayUrl` 修正到可公开访问的主机名。

## 10. HTTPS 反向代理

如果需要把 OpenClaw dashboard 暴露给外部浏览器，推荐加反向代理而不是直接暴露裸端口。

仓库已提供：

- `docker/runner-dashboard-proxy.Caddyfile.example`
- `docker/runner-dashboard-proxy.compose.yml`
- `scripts/setup-runner-dashboard-proxy.sh`

典型做法：

1. 复制 `docker/runner-dashboard-proxy.Caddyfile.example` 为 `docker/runner-dashboard-proxy.Caddyfile`
2. 把域名替换成真实值
3. 执行：

```bash
docker compose -f docker/runner-dashboard-proxy.compose.yml up -d
```

或者直接：

```bash
./scripts/setup-runner-dashboard-proxy.sh openclaw.example.com hermes.example.com https://cola.example.com
```

## 11. Break-Glass：关闭 Device Identity 检查

如果没有域名、只在内网临时调试 OpenClaw Control UI，可以设置：

```env
COLA_OPENCLAW_DISABLE_DEVICE_IDENTITY=1
```

这会把 `gateway.controlUi.dangerouslyDisableDeviceAuth=true` 注入 OpenClaw 配置。注意：

- 这是显式降级，不适合长期暴露
- 需要重新创建 runner 才会生效
- 排障完成后应关闭该配置

## 12. 已知缺口

当前实现已经能跑通最小闭环，但以下能力仍未完成：

- Worker 鉴权与签名校验
- 更细粒度的人工接管和中断控制
- 独立对象存储，而不是直接读工作目录产物
- 更完整的任务调度与多设备池策略
