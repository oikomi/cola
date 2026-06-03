# Cola Virtual Office

`cola` 是一个基于 Next.js 15、tRPC、Drizzle 和 PostgreSQL 的 Virtual Office 控制面。仓库当前代码仍是旧 MVP：用空间化办公室界面展示角色、任务、设备、审批和事件，并通过 Kubernetes 异步拉起 OpenClaw / Hermes Agent runner 执行真实任务。后续产品方向已调整为信息流优先，旧任务、审批、事件、runner 状态流不再作为核心模型继续扩展。

## 当前旧实现

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

Hermes 任务完成或失败后可以自动推送到飞书。群通知使用群机器人 webhook；个人私聊通知使用同一个飞书应用的机器人能力，需要在飞书开放平台开启机器人，并申请 `im:message:send_as_bot`（或 `im:message` / `im:message:send`）权限后发布版本。即使个人私聊失败，群通知仍会发送，并会在群消息里 @ 任务创建人或指定通知人。

```env
COLA_HERMES_FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
COLA_HERMES_FEISHU_WEBHOOK_SECRET="optional-signing-secret"
FEISHU_APP_ID="cli_xxx"
FEISHU_APP_SECRET="xxx"
```

如需让用户在飞书里基于任务完成通知继续追问 Hermes，或点击任务结果卡片里的「确认 / 不认可」完成归档，需要在飞书开放平台的「事件与回调」里使用长连接订阅「接收消息 v2.0 / `im.message.receive_v1`」和「卡片行为触发 / `card.action.trigger`」，并单独启动事件 worker：

```bash
./restart.sh --with-feishu-hermes
```

`restart.sh` 会在 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 和 `DATABASE_URL` 配齐时用 pm2 管理 `cola-feishu-hermes` 常驻进程；也可以设置 `FEISHU_HERMES_WORKER=0` 或传 `--no-feishu-hermes` 跳过。持续对话会优先关联用户回复的任务完成通知。如果飞书消息没有 `parent_id/root_id`，worker 会按同一 `chat_id` 和用户 `open_id` 找最近一条 Hermes 任务完成通知，并调用该任务绑定 runner metadata 里的 `hermesApiServerUrl` 继续处理。用户点击「确认」后，worker 会读取该任务的执行结果和继续对话历史，生成归档摘要并发送回原飞书群。

飞书侧需要发布包含以下配置的新版本，否则 worker 即使在线也收不到用户回复事件：

- 机器人能力已启用。
- 权限管理里已开通发送消息权限，以及读取用户发给机器人的单聊消息和群聊消息权限。
- 事件与回调使用长连接，并订阅「接收消息 v2.0 / `im.message.receive_v1`」和「卡片行为触发 / `card.action.trigger`」。

Hermes 需要分析私有 GitLab 仓库时，按 CMDB 的服务端授权模式配置受限凭据。优先配置 Hermes 专用 token；未配置时服务端能力可 fallback 到 `GITLAB_API_TOKEN`，但 runner 注入建议使用专用 token 或预建 K8s Secret。

```env
COLA_HERMES_GITLAB_URL="https://code.example.com"
COLA_HERMES_GITLAB_USERNAME="oauth2"
COLA_HERMES_GITLAB_TOKEN="glpat-xxx"
# 或者引用已有 Secret，Secret 里需包含同名三个 key
COLA_HERMES_GITLAB_SECRET_NAME="cola-hermes-gitlab"
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
- `./scripts/vision-inference-image.sh build-and-load`：基于 NVIDIA TensorRT 构建并分发视觉检测推理镜像，供 `/deployments` 的 `视觉检测` 运行时使用

## 文档索引

- [Virtual Office 信息流重设计](./docs/virtual-office-information-flow-redesign.md)
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
- [视觉推理运行时说明](./docs/vision-inference-runtime.md)
