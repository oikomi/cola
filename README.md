# Cola Virtual Office

`cola` 是一个基于 Next.js、tRPC、Drizzle 和 PostgreSQL 的多角色 Agent 控制面。当前仓库聚焦 Virtual Office 场景：用单页面办公室视图展示角色、任务、设备、审批和事件，并支持通过 Docker 接入 OpenClaw / Hermes Agent runner。

## 当前能力

- 单页面办公室控制台，支持实时刷新 office 快照
- 角色、任务、审批、设备、事件、执行会话的数据模型与 API
- 新增人物后异步拉起 Docker runner，不再阻塞前端请求
- OpenClaw / Hermes Agent runner 注册、心跳、拉任务、会话回报
- 原生页面链接支持本地直连和远程模板 URL

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 准备环境变量

```bash
cp .env.example .env
```

3. 初始化数据库和样例办公室数据

```bash
npm run db:setup:office
```

4. 启动控制面

```bash
./restart.sh -f
```

默认控制面地址是 `http://localhost:50038`。

## Docker Runner

新增人物后，系统会先落库，再在后台尝试 `docker pull` + `docker run` 对应 runner 镜像。状态通过 `agent/device/event + SSE` 反映到前端：

- `waiting_device` / `maintenance`：容器正在启动或等待 runner 注册
- `online` / `idle`：runner 已就绪
- `unhealthy` / `blocked`：镜像拉取、容器启动或 runner 自检失败

详细接入方式见：

- [Docker OpenClaw Runner 接入说明](./docs/docker-openclaw-runner.md)
- [Docker Hermes Agent Runner 接入说明](./docs/docker-hermes-runner.md)

## 远程部署

如果控制面部署在远程主机，不应该再让浏览器打开 `127.0.0.1` 原生页。请至少配置原生页模板：

```env
NEXT_PUBLIC_OPENCLAW_NATIVE_URL="https://cola.example.com/openclaw-native?agentId={agentId}&deviceId={deviceId}&engine={engine}"
NEXT_PUBLIC_HERMES_NATIVE_URL="https://cola.example.com/hermes-native?agentId={agentId}&deviceId={deviceId}&engine={engine}"
```

如果你要直接暴露 runner dashboard 端口而不是走反向代理，再额外配置：

```env
COLA_DASHBOARD_BIND_HOST="0.0.0.0"
COLA_DASHBOARD_ALLOWED_ORIGINS="https://cola.example.com,https://openclaw.example.com"
```

## 相关文档

- [Virtual Office 多角色 Agent 系统 PRD](./docs/virtual-office-agent-prd.md)
- [Virtual Office 多角色 Agent 系统技术架构](./docs/virtual-office-agent-architecture.md)
- [Cola Virtual Office MVP 实施计划](./docs/virtual-office-mvp-implementation-plan.md)
- [AI-Native 公司环境 1.0 PRD](./docs/ai-native-company-prd.md)
