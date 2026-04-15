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
- 状态回传：通过 `worker` API 注册、心跳和会话上报

## 4. 已落地后端接口

当前仓库已经提供以下 worker 接口：

- `worker.registerDockerRunner`
- `worker.heartbeat`
- `worker.reportSession`

用途分别是：

- 注册 Docker OpenClaw runner 到设备池
- 周期性上报在线状态和健康状态
- 上报执行会话状态、日志路径和产物路径

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

该文件是示意模板，不直接假设某个固定 OpenClaw 镜像命令。你需要根据实际 OpenClaw 镜像的启动方式替换 `command`。

## 8. 建议的 runner 生命周期

1. 容器启动
2. 读取 `/root/.codex/config.toml` 和 `/root/.codex/auth.json`
3. 调用 `worker.registerDockerRunner`
4. 定期调用 `worker.heartbeat`
5. 执行任务时调用 `worker.reportSession`
6. 会话结束后继续心跳等待下一次调度

## 9. 安全建议

- 容器内只读挂载 `auth.json`
- 不在日志中打印完整认证信息
- 不在仓库中保存任何真实 token
- 后续应为 worker API 增加签名或 token 校验

## 10. 下一步建议

如果继续推进，建议下一步实现：

- 一个最小的 OpenClaw worker bootstrap 脚本
- Docker runner 的任务拉取协议
- 基于 WebSocket 的实时状态推送

