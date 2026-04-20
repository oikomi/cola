# Docker Hermes Agent Runner 接入说明

## 0. 文档状态

- 更新时间：2026-04-17
- 适用范围：当前 `cola` 仓库的 Hermes Docker runner 接入方式
- 当前实现：已支持在创建人物时异步拉起 Hermes 容器，并完成注册、心跳、拉任务与执行会话回报

## 1. 文档目的

本文件说明如何把 `hermes-agent` 作为 Cola Virtual Office 的第二种 Docker 执行引擎接入系统。

当前目标不是独立维护一套 Hermes 配置体系，而是尽量复用宿主机现有的 Codex 配置和认证信息。

## 2. 当前接入方式

当前链路已经落地：

1. 前端调用 `office.createAgent`，并选择 `Hermes Agent`
2. 后端先创建 `agent` 与 `device` 记录
3. `src/server/office/provision-docker-runner.ts` 在后台启动 Hermes 容器
4. 容器内执行 `scripts/hermes-runner/bootstrap.mjs`
5. bootstrap 调用 `/api/worker/*` 完成注册、心跳、拉任务和会话回报

关键文件：

- `src/server/api/routers/office.ts`
- `src/server/api/routers/worker.ts`
- `src/server/office/provision-docker-runner.ts`
- `scripts/hermes-runner/bootstrap.mjs`
- `docker/hermes-runner.compose.yml`

## 3. 宿主机准备

宿主机至少需要：

- Docker 已安装并运行
- `~/.codex/config.toml`
- `~/.codex/auth.json`
- 仓库目录可挂载到容器

当前实现不会依赖宿主机已有的 `~/.hermes`。bootstrap 会在容器里生成临时的 `config.yaml` 和 `.env`，并把从 Codex 配置中解析出的模型、`OPENAI_API_KEY`、`OPENAI_BASE_URL` 写进去。

## 4. 推荐环境变量

```env
HERMES_AGENT_IMAGE=nousresearch/hermes-agent:latest
HERMES_CODEX_CONFIG_PATH=/Users/your-user/.codex/config.toml
HERMES_CODEX_AUTH_PATH=/Users/your-user/.codex/auth.json
HERMES_WORKSPACE_ROOT=/absolute/path/to/cola
COLA_API_BASE_URL=http://host.docker.internal:50038
COLA_RUNNER_HOST=host.docker.internal
COLA_DASHBOARD_BIND_HOST=127.0.0.1
NEXT_PUBLIC_HERMES_NATIVE_URL=https://cola.example.com/hermes/{agentId}
```

说明：

- `HERMES_AGENT_IMAGE`：控制 runner 镜像
- `HERMES_CODEX_CONFIG_PATH` / `HERMES_CODEX_AUTH_PATH`：控制需要挂载进容器的 Codex 配置
- `HERMES_WORKSPACE_ROOT`：容器内 `/workspace` 的宿主机目录
- `COLA_API_BASE_URL`：容器回调控制面的地址
- `COLA_RUNNER_HOST`：记录 runner 来源主机
- `COLA_DASHBOARD_BIND_HOST`：控制 Hermes dashboard 端口对外暴露方式
- `NEXT_PUBLIC_HERMES_NATIVE_URL`：控制浏览器点击人物工作区时使用的地址模板

常见扩展变量：

- `HERMES_READY_COMMAND`
- `HERMES_TASK_COMMAND`
- `HERMES_BOOT_COMMAND`
- `HERMES_BIN`
- `HERMES_HOME`
- `HERMES_CONFIG_PATH`
- `HERMES_ENV_PATH`

## 5. 默认 runner 行为

`scripts/hermes-runner/bootstrap.mjs` 默认会：

- 执行 `${HERMES_BIN:-/opt/hermes/.venv/bin/hermes} --version` 做就绪检查
- 解析 Codex 配置中的 provider、model、API key 和 base URL
- 在容器内生成临时 `config.yaml` 与 `.env`
- 注册设备并周期性发送 heartbeat
- 空闲时轮询下一个任务
- 使用 `hermes chat --model <model> --quiet --yolo -q "<prompt>"` 执行任务
- 把日志写到 `/workspace/.hermes-runner`
- 把最近一次执行结果写到 `/workspace/.hermes-runner/last-result.json`

如果设置了 `HERMES_TASK_COMMAND`，bootstrap 会优先执行自定义命令；如果设置了 `HERMES_BOOT_COMMAND`，则会在容器启动后额外执行启动命令并上报一次会话状态。

## 6. 角色创建后的状态流转

Hermes 与 OpenClaw 共用同一套设备接入状态模型：

- `agent.waiting_device` + `device.maintenance`：容器正在拉起或等待注册
- `agent.idle` + `device.online`：runner 已就绪
- `agent.blocked` + `device.unhealthy`：就绪检查或任务执行失败

状态推进由以下入口维护：

- `office.createAgent`
- `provisionDockerRunnerInBackground`
- `worker.registerDockerRunner`
- `worker.heartbeat`

## 7. 本地调试方式

### 7.1 通过人物创建自动拉起

这是当前主路径：

1. 启动 Cola 控制面
2. 新建一个引擎为 `Hermes Agent` 的人物
3. 等待设备状态切换到 `online`
4. 给该人物分配任务

### 7.2 通过 compose 手动调试

仓库提供：

- `docker/hermes-runner.compose.yml`

对应 bootstrap：

- `scripts/hermes-runner/bootstrap.mjs`

适合单独验证 runner 与控制面之间的协议链路。

## 8. 远程访问与工作区地址

推荐两种地址模板：

### 8.1 使用 Cola 自带工作区页面

```env
NEXT_PUBLIC_HERMES_NATIVE_URL=https://cola.example.com/hermes/{agentId}
```

这会落到 `src/app/hermes/[agentId]/page.tsx`。

### 8.2 直接使用 Hermes dashboard 域名

```env
COLA_DASHBOARD_BIND_HOST=0.0.0.0
COLA_HERMES_DASHBOARD_PUBLIC_HOST=hermes.example.com
NEXT_PUBLIC_HERMES_NATIVE_URL=https://hermes.example.com/
```

远程部署时，优先用这两种公开地址之一，不要把浏览器导向容器本地 `127.0.0.1`。

## 9. HTTPS 反向代理

Hermes dashboard 和 OpenClaw dashboard 可以共用同一套 Caddy 反向代理配置。

仓库提供：

- `docker/runner-dashboard-proxy.Caddyfile.example`
- `docker/runner-dashboard-proxy.compose.yml`
- `scripts/setup-runner-dashboard-proxy.sh`

示例：

```bash
./scripts/setup-runner-dashboard-proxy.sh openclaw.example.com hermes.example.com https://cola.example.com
docker compose -f docker/runner-dashboard-proxy.compose.yml up -d
```

## 10. 已知缺口

当前 Hermes 链路已经可用，但仍有这些未完成项：

- Worker 鉴权与签名校验
- 更丰富的人工接管和中断控制
- 任务产物的独立存储与索引
- 多 runner 并发调度策略
