# Cola Virtual Office

`cola` 是一个基于 Next.js 15、tRPC、Drizzle 和 PostgreSQL 的 Virtual Office 控制面。仓库当前实现的是一个可运行的 MVP：用空间化办公室界面展示角色、任务、设备、审批和事件，并通过 Kubernetes 异步拉起 OpenClaw / Hermes Agent runner 执行真实任务。

## 当前实现

- `/` 使用 `OfficeBetaShell` 渲染等距办公室主视图，支持人物创建、工位扩容、任务与审批流转、设备状态观察和执行结果回放
- `/control` 提供偏传统的控制台视图，适合做列表式查看和操作
- 快照优先读取 PostgreSQL；数据库不可用时，页面会退回只读空快照并明确提示原因
- `createAgent` 会先写入角色和设备记录，再在后台执行 Kubernetes provisioning，不阻塞前端请求
- `/api/office/stream` 通过 SSE 推送版本变化，前端自动失效并刷新 office 快照
- Worker 协议已落地：`/api/worker/register`、`/api/worker/heartbeat`、`/api/worker/tasks/next`、`/api/worker/session`
- 内置角色工作区页面为 `/openclaw/[agentId]` 和 `/hermes/[agentId]`；也可以用 `NEXT_PUBLIC_OPENCLAW_NATIVE_URL` / `NEXT_PUBLIC_HERMES_NATIVE_URL` 覆盖为远程地址

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 复制环境变量模板

```bash
cp .env.example .env
```

3. 启动本地 PostgreSQL 容器

```bash
./start-database.sh
```

4. 执行 migration 并注入 Virtual Office 示例数据

```bash
npm run db:setup:office
```

5. 启动控制面

```bash
./restart.sh -f
```

默认地址：

- 主视图：`http://localhost:50038/`
- 控制台：`http://localhost:50038/control`

如果只想一键清空并重建本地演示数据，可以直接执行：

```bash
./reset-database.sh --seed-office
```

## Kubernetes Runner

新增人物时，系统会立即创建数据库记录，并在后台尝试创建对应的 Kubernetes runner。常见状态含义如下：

- `waiting_device` / `maintenance`：设备已排队或 runner 正在启动
- `idle` / `online`：runner 已注册，可以接任务
- `blocked` / `unhealthy`：runner 资源创建、镜像拉取、就绪检查或任务执行失败

当前支持两种执行引擎：

- `openclaw`
- `hermes-agent`

- [Kubernetes Runner 部署说明](./docs/kubernetes-runner-deployment.md)

## 远程访问

如果控制面部署在远程主机，优先使用可被浏览器直接访问的工作区模板，而不是把用户导向 `127.0.0.1`。

推荐做法一：使用仓库内置工作区页面

```env
NEXT_PUBLIC_OPENCLAW_NATIVE_URL="https://cola.example.com/openclaw/{agentId}"
NEXT_PUBLIC_HERMES_NATIVE_URL="https://cola.example.com/hermes/{agentId}"
```

推荐做法二：直接暴露 runner dashboard 域名

```env
COLA_DASHBOARD_BIND_HOST="0.0.0.0"
COLA_OPENCLAW_DASHBOARD_PUBLIC_HOST="openclaw.example.com"
COLA_HERMES_DASHBOARD_PUBLIC_HOST="hermes.example.com"
COLA_DASHBOARD_ALLOWED_ORIGINS="https://cola.example.com,https://openclaw.example.com,https://hermes.example.com"
NEXT_PUBLIC_OPENCLAW_NATIVE_URL="https://openclaw.example.com/"
NEXT_PUBLIC_HERMES_NATIVE_URL="https://hermes.example.com/"
```

如果训练模块也希望跳到单独部署的 Unsloth 原生页面，可以额外配置：

```env
NEXT_PUBLIC_UNSLOTH_STUDIO_URL="https://unsloth.example.com/"
```

OpenClaw 在没有域名、只做内网临时调试时，还可以显式开启：

```env
COLA_OPENCLAW_DISABLE_DEVICE_IDENTITY="1"
```

这属于 break-glass 配置，只建议短期排障使用。

## 常用脚本

- `./restart.sh`：重启本地 Next.js 开发服务；会先检查数据库连通性，必要时自动启动数据库容器并执行 migration
- `./start-database.sh`：启动本地 PostgreSQL 容器
- `./reset-database.sh --seed-office`：清空数据库、重新迁移并重建示例办公室数据
- `./cleanup-containers.sh --all`：清理本地数据库和 runner 容器
- `npm run db:setup:office`：执行 migration 并注入示例办公室数据

## 文档索引

- [Virtual Office 多角色 Agent 系统 PRD](./docs/virtual-office-agent-prd.md)
- [Virtual Office 多角色 Agent 系统技术架构](./docs/virtual-office-agent-architecture.md)
- [Cola Virtual Office MVP 实施计划](./docs/virtual-office-mvp-implementation-plan.md)
- [AI-Native 公司环境 1.0 PRD](./docs/ai-native-company-prd.md)
- [AI-Native 公司环境运营模型](./docs/ai-native-operating-model.md)
- [AI-Native 公司环境风险与治理](./docs/ai-native-risk-and-governance.md)
- [AI-Native 公司环境路线图](./docs/ai-native-roadmap.md)
- [AI-Native 公司环境指标体系](./docs/ai-native-metrics.md)
- [AI-Native 公司环境工作流模板](./docs/ai-native-workflow-templates.md)
- [训练平台 Unsloth on Kubernetes 说明](./docs/training-unsloth-k8s.md)
