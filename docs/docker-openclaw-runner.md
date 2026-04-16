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
- `~/.codex/config.toml`
- `~/.codex/auth.json`

推荐只读挂载认证与模型配置：

```yaml
volumes:
  - .:/workspace
  - ${HOME}/.codex/config.toml:/root/.codex/config.toml:ro
  - ${HOME}/.codex/auth.json:/root/.codex/auth.json:ro
```

## 6. 推荐环境变量

```env
COLA_API_BASE_URL=http://host.docker.internal:3000
COLA_RUNNER_NAME=OpenClaw Runner-01
COLA_RESOURCE_POOL=docker-core
COLA_RUNNER_HOST=host.docker.internal
```

说明：

- `COLA_API_BASE_URL` 指向本地控制面
- `COLA_RUNNER_NAME` 是设备池中显示的 runner 名称
- `COLA_RESOURCE_POOL` 用于区分 runner 池
- `COLA_RUNNER_HOST` 便于记录来源主机

## 7. Docker Compose 示例

仓库中已提供示例文件：

- `docker/openclaw-runner.compose.yml`

该文件现在默认会执行仓库里的 bootstrap 脚本：

- `scripts/openclaw-runner/bootstrap.mjs`

默认逻辑是：

- 注册 runner
- 从 `~/.codex/config.toml` 与 `~/.codex/auth.json` 派生一份临时 OpenClaw JSON 配置
- 执行 OpenClaw 就绪检查
- 周期性发送 heartbeat
- 空闲时轮询下一个任务
- 默认优先使用 `openclaw infer model run --local --model provider/model` 执行任务
- 如果设置了 `OPENCLAW_BOOT_COMMAND`，则在容器内执行启动命令并上报会话状态

## 8. 建议的 runner 生命周期

1. 容器启动
2. 读取 `/root/.codex/config.toml` 和 `/root/.codex/auth.json`
3. 运行 `scripts/openclaw-runner/bootstrap.mjs`
4. bootstrap 调用 `/api/worker/register`
5. bootstrap 定期调用 `/api/worker/heartbeat`
6. bootstrap 空闲时调用 `/api/worker/tasks/next`
7. 认领到任务后调用 `/api/worker/session`
8. 会话结束后继续心跳并等待下一次调度

## 8.1 当前已验证的本地联调结果

当前仓库已经完成一条真实联调：

- 控制面运行在本地 `3000`
- 新增人物后，服务端成功 `docker run` OpenClaw runner
- runner 自动注册并持续心跳
- runner 自动轮询 `/api/worker/tasks/next`
- runner 自动认领任务并执行
- 执行成功后，任务状态更新为 `completed`
- 执行会话写入 `cola_execution_session`
- 前端 inspector 可直接读取最近一次执行结果回放

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
