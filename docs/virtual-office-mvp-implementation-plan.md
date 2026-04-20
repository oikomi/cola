# Cola Virtual Office MVP 实施计划

## 0. 文档状态

- 更新时间：2026-04-17
- 文档定位：当前仓库已落地 MVP 的实现对照与下一步推进顺序
- 说明：本文件描述的是已经存在于仓库里的实现边界，不再把仓库当作“尚未开始改造”的空模板

## 1. 当前 MVP 摘要

当前 `cola` 仓库已经完成了 Virtual Office 的第一条可运行闭环：

- 前端有两个入口：`/` 的等距办公室主视图，以及 `/control` 的控制台视图
- 数据模型已经覆盖角色、任务、设备、执行会话、审批、事件和工位配置
- `office` router 已支持创建角色、扩容工位、创建任务、推进任务、发起审批、处理审批和刷新原生工作区地址
- `worker` router 与 `/api/worker/*` 路由已经支持 runner 注册、心跳、拉任务和会话回报
- 新增人物时会异步拉起 Docker OpenClaw / Hermes runner
- `/api/office/stream` 已通过 SSE 让前端自动刷新快照
- 前端可查看最近一次执行结果回放

## 2. 已落地能力

### 2.1 页面与交互

- `/`：`OfficeBetaShell`，等距办公室主视图
- `/control`：`OfficeShell`，传统控制台视图
- `/openclaw/[agentId]`：OpenClaw 角色工作区
- `/hermes/[agentId]`：Hermes 角色工作区

当前主视图已经支持：

- 创建人物并选择执行引擎
- 按办公区扩容工位
- 给角色派发任务
- 推进任务状态
- 发起和处理审批
- 通过 SSE 自动刷新界面

### 2.2 数据模型

已在 `src/server/db/schema.ts` 中落地：

- `cola_agent`
- `cola_zone_setting`
- `cola_task`
- `cola_device`
- `cola_execution_session`
- `cola_approval`
- `cola_event`

这些表由以下 migration 支撑：

- `drizzle/0000_flawless_miracleman.sql`
- `drizzle/0001_unusual_ben_urich.sql`
- `drizzle/0002_bright_sif.sql`
- `drizzle/0003_tidy_zone_settings.sql`

### 2.3 服务与接口

当前 API 入口分为两层：

- tRPC：`src/server/api/routers/office.ts`、`src/server/api/routers/worker.ts`
- REST 包装路由：`src/app/api/worker/*`、`src/app/api/office/stream/route.ts`

`office` 当前已提供：

- `getSnapshot`
- `getAgentById`
- `getTaskById`
- `getNativeDashboardUrl`
- `createAgent`
- `addWorkstation`
- `createTask`
- `updateTaskStatus`
- `requestApproval`
- `resolveApproval`

`worker` 当前已提供：

- `registerDockerRunner`
- `heartbeat`
- `pullNextTask`
- `reportSession`

### 2.4 Docker 执行层

当前仓库已经不是“只有 mock worker”的阶段，而是真实接入了两种 Docker runner：

- `openclaw`
- `hermes-agent`

关键文件：

- `src/server/office/provision-docker-runner.ts`
- `scripts/openclaw-runner/bootstrap.mjs`
- `scripts/hermes-runner/bootstrap.mjs`
- `docker/openclaw-runner.compose.yml`
- `docker/hermes-runner.compose.yml`

当前链路支持：

- 后台异步拉起容器
- 设备注册与心跳
- 任务轮询和自动认领
- 执行会话状态回报
- 最近一次执行结果在前端回放

## 3. 现阶段架构选择

### 3.1 为什么仍使用“快照 + SSE 刷新”

当前实现不是 WebSocket 推部分字段，而是：

- 服务端生成完整 office 快照
- `/api/office/stream` 推送版本变化
- 客户端收到后失效并重拉 `office.getSnapshot`

这套设计当前的优点是：

- 前后端数据模型一致，调试成本低
- 不需要在多个页面维护复杂的增量合并逻辑
- 对 MVP 来说已经足够实时

### 3.2 为什么保留数据库异常时的只读回退

当前系统在数据库不可用时不会直接让首页崩掉，而是返回只读空快照并明确写出原因。这样做是为了：

- 保持页面结构可用
- 让前端和演示环境在数据库故障时仍能启动
- 让 `restart.sh` 的自动修复和故障提示更清晰

### 3.3 为什么先支持两种 runner，而不是先做复杂编排

当前仓库的重点不是多 Agent 自动拆解，而是先把“角色创建 -> runner 接入 -> 任务执行 -> 结果回传”的最小闭环跑通。这个顺序更合理，因为：

- 执行层不稳定时，编排层无法验证真实价值
- 任务和会话的状态机需要先被真实 runner 驱动一遍
- 前端工作区和设备状态需要有真实数据才能收敛

## 4. 已完成与未完成

### 4.1 已完成

- 角色、任务、设备、审批、事件、工位配置的数据模型
- 单页办公室主视图与控制台视图
- 任务与审批的最小写操作闭环
- OpenClaw / Hermes Docker runner 接入
- SSE 驱动的实时刷新
- 原生工作区地址模板与内置工作区页面

### 4.2 未完成

- 登录、权限、组织隔离
- Worker 鉴权与签名校验
- 多角色自动编排和 handoff 记录表
- 独立对象存储和可检索执行产物索引
- 更完整的人工接管、中断和重试控制
- 自动化测试覆盖与 CI 护栏

## 5. 推荐的下一步顺序

### Phase 1：Worker 安全与身份校验

目标：

- 让 `/api/worker/*` 不再完全匿名

建议内容：

- 为 runner 注册和 heartbeat 增加签名或 token
- 区分“人物创建出来的设备记录”和“真正合法的 runner”
- 明确失败重试与吊销策略

### Phase 2：任务调度与状态机收敛

目标：

- 让多个 runner 并发执行时状态更稳定

建议内容：

- 收敛任务领取规则
- 明确设备繁忙、任务超时、失败重试的状态推进
- 为 handoff 与 orchestration 预留独立实体

### Phase 3：执行产物与回放增强

目标：

- 让执行记录可追溯，而不是只依赖工作目录文件

建议内容：

- 独立保存日志与结果产物
- 在 session 里区分 stdout、stderr、artifact、summary
- 提供按任务和按设备查询的历史回放

### Phase 4：人工接管与治理

目标：

- 让高风险动作真正可控

建议内容：

- 增加人工接管入口
- 增加会话终止、重试、重新分派操作
- 把审批和执行会话更紧密地串起来

## 6. 本地运行建议

当前最稳定的一条本地路径是：

1. `cp .env.example .env`
2. `npm install`
3. `./start-database.sh`
4. `npm run db:setup:office`
5. `./restart.sh -f`
6. 在首页创建一个 OpenClaw 或 Hermes 人物，并观察其 runner 状态

如果需要重建演示环境：

```bash
./reset-database.sh --seed-office
```
