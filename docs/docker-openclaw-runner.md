# Docker OpenClaw Runner 接入说明

## 1. 文档目的

本文件说明如何在没有 Mac mini 的情况下，使用 Docker 容器承载 OpenClaw 作为 Virtual Office 的执行层 worker。

目标不是把敏感配置复制进仓库，而是让 OpenClaw runner 直接复用本机已有的 Codex 配置与认证信息。

## 2. 当前参考配置

根据本机配置，OpenClaw runner 应参考以下模型与鉴权结构：

- 模型提供方：`OpenAI`
- 主模型：`gpt-5.4`
- Review 模型：`gpt-5.4`
- reasoning effort：`xhigh`
- wire API：`responses`
- base URL：自定义 OpenAI 兼容入口
- 认证方式：`apikey`

这些配置目前已经存在于：

- `~/.codex/config.toml`
- `~/.codex/auth.json`

注意：

- 不要把真实 `auth.json` 提交进仓库
- 不要把 API key 写进 `.env.example` 或文档
- 推荐把这两个文件以只读 volume 的方式挂进容器

## 3. 推荐接入方式

当前建议采用：

- 控制面：`cola` Next.js 应用
- 执行面：Docker 容器中的 OpenClaw runner
- 配置来源：直接挂载宿主机的 `~/.codex/config.toml` 和 `~/.codex/auth.json`
- 状态回传：通过 `/api/worker/*` REST API 或 `worker` tRPC 接口注册、心跳和会话上报

## 4. 已落地后端接口

当前仓库已经提供以下 worker 接口：

- `worker.registerDockerRunner`
- `worker.heartbeat`
- `worker.pullNextTask`
- `worker.reportSession`
- `POST /api/worker/register`
- `POST /api/worker/heartbeat`
- `POST /api/worker/tasks/next`
- `POST /api/worker/session`
- `GET /api/office/stream`

用途分别是：

- 注册 Docker OpenClaw runner 到设备池
- 周期性上报在线状态和健康状态
- 空闲 runner 拉取下一个可执行任务
- 上报执行会话状态、日志路径和产物路径
- 单页面前端订阅办公室状态变化并触发实时刷新

对应代码位置：

- `src/server/worker/service.ts`
- `src/server/worker/schemas.ts`
- `src/app/api/worker/register/route.ts`
- `src/app/api/worker/heartbeat/route.ts`
- `src/app/api/worker/tasks/next/route.ts`
- `src/app/api/worker/session/route.ts`

## 5. 推荐容器挂载方式

容器应至少挂载：

- 项目工作目录
- `~/.codex` 目录

推荐只读挂载认证与模型配置：

```yaml
volumes:
  - .:/workspace
  - ${HOME}/.codex:/home/node/.codex:ro
```

## 6. 推荐环境变量

```env
OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:latest
OPENCLAW_CONFIG_PATH=/Users/your-user/.codex/config.toml
OPENCLAW_AUTH_PATH=/Users/your-user/.codex/auth.json
OPENCLAW_WORKSPACE_ROOT=/absolute/path/to/cola
COLA_API_BASE_URL=http://host.docker.internal:50038
COLA_RUNNER_NAME=OpenClaw Runner-01
COLA_RESOURCE_POOL=docker-core
COLA_RUNNER_HOST=host.docker.internal
COLA_DASHBOARD_BIND_HOST=127.0.0.1
COLA_DASHBOARD_ALLOWED_ORIGINS=https://cola.example.com,https://openclaw.example.com
NEXT_PUBLIC_OPENCLAW_NATIVE_URL=https://cola.example.com/openclaw-native?agentId={agentId}&deviceId={deviceId}&engine={engine}
```

说明：

- `OPENCLAW_IMAGE` 控制使用的 runner 镜像
- `OPENCLAW_CONFIG_PATH` 与 `OPENCLAW_AUTH_PATH` 指向宿主机的 Codex 配置
- `OPENCLAW_WORKSPACE_ROOT` 是挂进容器的项目目录
- `COLA_API_BASE_URL` 指向本地控制面
- `COLA_RUNNER_NAME` 是设备池中显示的 runner 名称
- `COLA_RESOURCE_POOL` 用于区分 runner 池
- `COLA_RUNNER_HOST` 便于记录来源主机
- `COLA_DASHBOARD_BIND_HOST` 控制 dashboard 端口绑定到 `127.0.0.1` 还是 `0.0.0.0`
- `COLA_DASHBOARD_ALLOWED_ORIGINS` 控制 OpenClaw dashboard 允许的浏览器来源
- `NEXT_PUBLIC_OPENCLAW_NATIVE_URL` 用于远程部署时生成浏览器可访问的原生页地址

## 7. Docker Compose 示例

仓库中已提供示例文件：

- `docker/openclaw-runner.compose.yml`

该文件现在默认会执行仓库里的 bootstrap 脚本：

- `scripts/openclaw-runner/bootstrap.mjs`

默认逻辑是：

- 每次新增人物都会先 `docker pull` 镜像；远程 `latest` 没更新时只做 manifest 检查，不会整包重下
- 注册 runner
- 从 `~/.codex/config.toml` 与 `~/.codex/auth.json` 派生一份临时 OpenClaw JSON 配置
- 执行 OpenClaw 就绪检查
- 周期性发送 heartbeat
- 空闲时轮询下一个任务
- 默认优先使用 `openclaw infer model run --local --model provider/model` 执行任务
- 如果设置了 `OPENCLAW_BOOT_COMMAND`，则在容器内执行启动命令并上报会话状态

## 8. 建议的 runner 生命周期

1. 容器启动
2. 读取 `/home/node/.codex/config.toml` 和 `/home/node/.codex/auth.json`
3. 运行 `scripts/openclaw-runner/bootstrap.mjs`
4. bootstrap 调用 `/api/worker/register`
5. bootstrap 定期调用 `/api/worker/heartbeat`
6. bootstrap 空闲时调用 `/api/worker/tasks/next`
7. 认领到任务后调用 `/api/worker/session`
8. 会话结束后继续心跳并等待下一次调度

## 8.1 控制面中的启动状态

当前 `createAgent` 已改为异步 provisioning：

- 请求返回时，人物和设备已经写入数据库
- Docker 启动在后台继续进行，不会阻塞前端
- 前端通过 SSE 观察状态推进

常见状态含义：

- `waiting_device` / `maintenance`：容器已排队或正在启动
- `idle` / `online`：runner 已注册，可接任务
- `blocked` / `unhealthy`：镜像拉取、容器启动或就绪检查失败

## 8.2 当前已验证的本地联调结果

当前仓库已经完成一条真实联调：

- 控制面运行在本地 `50038`
- 新增人物后，控制面请求会立即返回，后台继续 `docker pull` + `docker run` OpenClaw runner
- runner 自动注册并持续心跳
- runner 自动轮询 `/api/worker/tasks/next`
- runner 自动认领任务并执行
- 执行成功后，任务状态更新为 `completed`
- 执行会话写入 `cola_execution_session`
- 前端 inspector 可直接读取最近一次执行结果回放

## 8.3 远程部署建议

如果控制面部署在远程服务器，不要让浏览器直接打开 `127.0.0.1`：

- 优先配置 `NEXT_PUBLIC_OPENCLAW_NATIVE_URL`
- 如果直接暴露 runner dashboard 端口，把 `COLA_DASHBOARD_BIND_HOST` 设为 `0.0.0.0`
- 同时把控制面域名加入 `COLA_DASHBOARD_ALLOWED_ORIGINS`

## 8.4 HTTPS 反向代理

推荐做法是给 OpenClaw dashboard 加一个 HTTPS 反向代理，而不是直接暴露裸端口。

仓库中已提供：

- `docker/runner-dashboard-proxy.Caddyfile.example`
- `docker/runner-dashboard-proxy.compose.yml`

使用方式：

1. 复制 `docker/runner-dashboard-proxy.Caddyfile.example` 为
   `docker/runner-dashboard-proxy.Caddyfile`
2. 把 `openclaw.example.com` 改成你的真实域名
3. 启动 Caddy：

```bash
docker compose -f docker/runner-dashboard-proxy.compose.yml up -d
```

4. `.env` 中至少配置：

```env
COLA_DASHBOARD_BIND_HOST=0.0.0.0
COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST=openclaw.example.com
COLA_DASHBOARD_ALLOWED_ORIGINS=https://cola.example.com,https://openclaw.example.com
NEXT_PUBLIC_OPENCLAW_NATIVE_URL=https://openclaw.example.com/
```

这样 Cola 打开人物原生页时，会保留 OpenClaw dashboard token，并把访问地址替换成 HTTPS 域名。

## 8.5 Break-Glass：关闭 Device Identity 检查

如果你没有域名，也不打算走 SSH 隧道，可以临时关闭 OpenClaw Control UI 的
device identity 检查：

```env
COLA_OPENCLAW_DISABLE_DEVICE_IDENTITY=1
```

这会把 `gateway.controlUi.dangerouslyDisableDeviceAuth=true` 写进 runner 配置。

注意：

- 这是显式的危险降级
- 只建议在内网临时调试使用
- 重新创建人物 runner 后才会生效
- 建议问题排完后改回 `0` 并重建 runner

也可以直接用脚本自动生成配置：

```bash
./scripts/setup-runner-dashboard-proxy.sh openclaw.example.com hermes.example.com https://cola.example.com
```

当前实际使用的模型路径为：

- provider: `openai`
- model: `gpt-5.4`
- base URL: 由 Codex 配置中的自定义 OpenAI 兼容入口派生

## 9. 安全建议

- 容器内只读挂载 `auth.json`
- 不在日志中打印完整认证信息
- 不在仓库中保存任何真实 token
- 后续应为 worker API 增加签名或 token 校验

## 10. 下一步建议

如果继续推进，建议下一步实现：

- 基于 WebSocket 的实时状态推送
- Worker 鉴权与签名校验
- 真正的任务结果回传与产物索引
