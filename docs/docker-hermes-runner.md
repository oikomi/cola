# Docker Hermes Agent Runner 接入说明

## 1. 文档目的

本文件说明如何把 `hermes-agent` 作为 Virtual Office 的另一种 Docker 执行引擎接入系统。

当前实现目标：

- 控制面仍由 `cola` 的 Next.js 应用承载
- 执行面改为 Docker 容器中的 Hermes Agent runner
- runner 通过 `/api/worker/*` 接口向控制面完成注册、心跳、拉任务和会话回报

## 2. 当前接入方式

仓库已提供以下落地文件：

- `docker/hermes-runner.compose.yml`
- `scripts/hermes-runner/bootstrap.mjs`
- `src/server/office/provision-docker-runner.ts`

新增角色时，如果选择执行引擎为 `Hermes Agent`，后端会尝试：

1. 使用 Docker 启动 `hermes-agent` 容器
2. 挂载宿主机 `~/.codex` 到容器内 `/home/node/.codex`
3. 在容器内运行 `scripts/hermes-runner/bootstrap.mjs`
4. bootstrap 从 `config.toml` 与 `auth.json` 派生 Hermes 配置
5. bootstrap 调用 worker API 完成注册和任务循环

## 3. 推荐宿主机准备

宿主机需要预先存在：

- `~/.codex/config.toml`
- `~/.codex/auth.json`

当前实现不会直接依赖 `~/.hermes`。Hermes runner 会在容器内临时目录生成 `config.yaml` 和 `.env`，来源统一复用已有 Codex 模型配置与 API key。

## 4. 推荐环境变量

```env
HERMES_AGENT_IMAGE=nousresearch/hermes-agent:latest
HERMES_CODEX_CONFIG_PATH=/Users/your-user/.codex/config.toml
HERMES_CODEX_AUTH_PATH=/Users/your-user/.codex/auth.json
HERMES_WORKSPACE_ROOT=/absolute/path/to/cola
COLA_API_BASE_URL=http://host.docker.internal:50038
COLA_RUNNER_HOST=host.docker.internal
COLA_DASHBOARD_BIND_HOST=127.0.0.1
NEXT_PUBLIC_HERMES_NATIVE_URL=https://cola.example.com/hermes-native?agentId={agentId}&deviceId={deviceId}&engine={engine}
```

说明：

- `HERMES_AGENT_IMAGE` 控制容器镜像
- `HERMES_CODEX_CONFIG_PATH` 与 `HERMES_CODEX_AUTH_PATH` 控制 Hermes 读取哪一套 Codex 配置
- `HERMES_WORKSPACE_ROOT` 是挂进容器的项目目录
- `COLA_DASHBOARD_BIND_HOST` 控制 Hermes dashboard 是否只绑定本机
- `NEXT_PUBLIC_HERMES_NATIVE_URL` 用于远程部署时生成浏览器可访问的原生页地址

## 5. 默认 runner 行为

Hermes runner bootstrap 当前会：

- 每次新增人物都会先 `docker pull` 镜像；远程 `latest` 没更新时只做 manifest 检查，不会整包重下
- 注册设备到 Cola
- 周期性发送心跳
- 空闲时轮询下一个任务
- 从 `~/.codex/config.toml` / `auth.json` 派生 Hermes 运行配置
- 默认通过 `hermes chat --quiet --yolo -q "<prompt>"` 执行任务
- 将日志写入 `/workspace/.hermes-runner`

如果需要替换默认执行方式，可以设置：

```env
HERMES_DOCKER_COMMAND=...
HERMES_TASK_COMMAND=...
HERMES_READY_COMMAND=...
```

## 6. 注意事项

- `createAgent` 已改成异步 provisioning：人物会先出现为 `waiting_device`，随后由 runner 注册把状态推进到 `idle` 或 `blocked`
- Hermes 当前与 OpenClaw 一样复用 `~/.codex` 作为模型与鉴权来源
- 当前默认镜像标签为 `nousresearch/hermes-agent:latest`
- 如果 Hermes 对 custom OpenAI-compatible endpoint 有额外兼容性要求，需要按实际 provider 能力调整生成的配置

## 7. HTTPS 反向代理

Hermes dashboard 也建议通过 HTTPS 域名访问。

仓库中已提供：

- `docker/runner-dashboard-proxy.Caddyfile.example`
- `docker/runner-dashboard-proxy.compose.yml`

使用方式：

1. 复制 `docker/runner-dashboard-proxy.Caddyfile.example` 为
   `docker/runner-dashboard-proxy.Caddyfile`
2. 把 `hermes.example.com` 改成真实域名
3. 启动 Caddy：

```bash
docker compose -f docker/runner-dashboard-proxy.compose.yml up -d
```

4. `.env` 中至少配置：

```env
COLA_DASHBOARD_BIND_HOST=0.0.0.0
COLA_HERMES_DASHBOARD_PUBLIC_HOST=hermes.example.com
NEXT_PUBLIC_HERMES_NATIVE_URL=https://hermes.example.com/
```

如果 OpenClaw 和 Hermes 都需要 HTTPS，可以共用同一个 Caddy 配置文件。

也可以直接用脚本自动生成配置：

```bash
./scripts/setup-runner-dashboard-proxy.sh openclaw.example.com hermes.example.com https://cola.example.com
```
- 远程部署时，建议优先配置 `NEXT_PUBLIC_HERMES_NATIVE_URL`，不要让浏览器直接打开 `127.0.0.1`
