# Cola Virtual Office MVP 实施计划

## 1. 文档目的

本文件用于把 `Virtual Office 多角色 Agent 系统` 的概念设计收敛为当前仓库可执行的 MVP 路径，明确本期范围、代码边界、交付顺序和后续扩展方向。

## 2. 当前仓库现状

当前 `cola` 仓库基于 Next.js + tRPC + Drizzle + PostgreSQL 的最小模板，适合作为 Virtual Office MVP 的控制面起点，但距离完整系统仍有明显缺口：

- 还没有 Virtual Office 的业务实体
- 还没有任务、角色、设备的真实数据模型
- 还没有审批和审计的后端闭环
- 还没有实时通信层

本次改造的目标不是一步到位，而是把最重要的基础层先立起来。

## 3. 本期目标

本期 MVP 聚焦以下三件事：

- 用统一数据结构描述角色、任务、设备、审批和事件
- 用首页把 Virtual Office 的核心信息结构可视化
- 为后续接入真实数据库、真实 worker 和实时事件流预留稳定接口

当前阶段已经额外完成：

- Drizzle migration 已生成并成功执行
- 本地 Docker Postgres 已完成 Virtual Office 初始 seed
- `office` router 已切到“优先读真实数据库，异常时回退样例快照”
- 首页已接入任务创建、任务状态推进、审批创建与审批处理
- 前端已重构为单页面 office 主场景，并使用 `shadcn/ui`
- 新增人物已接入 `createAgent`，会尝试直接拉起 Docker OpenClaw runner
- 已接入 SSE 实时流，单页面可自动刷新 office 快照
- 已支持人物 inspector 查看最近一次执行结果回放

## 4. 本期范围

### 4.1 已纳入

- 数据枚举与共享类型
- Drizzle schema 扩展
- Drizzle migration
- 初始 seed 脚本
- `office` tRPC router
- 基于真实快照数据的单页面 office 首页
- 实施计划文档

### 4.2 未纳入

- WebSocket 实时状态推送
- 登录、权限和组织隔离
- 更细粒度的审计与回放

## 5. 已落地代码范围

### 5.1 共享定义

- `src/server/office/catalog.ts`
- `src/server/office/types.ts`
- `src/server/office/sample-data.ts`

用途：

- 统一 Agent、任务、设备、审批、事件等枚举与中文标签
- 定义首页和 API 共用的 `OfficeSnapshot` 数据结构
- 提供不依赖数据库的安全样例数据

### 5.2 数据模型

- `src/server/db/schema.ts`
- `drizzle/0000_flawless_miracleman.sql`

已加入表设计：

- `agents`
- `tasks`
- `devices`
- `executionSessions`
- `approvals`
- `events`

这些表已经完成第一版 migration，并已写入初始 Virtual Office 数据。

### 5.3 API 层

- `src/server/api/routers/office.ts`
- `src/server/api/root.ts`
- `src/server/api/routers/worker.ts`

当前提供：

- `office.getSnapshot`
- `office.getAgentById`
- `office.getTaskById`
- `office.createTask`
- `office.updateTaskStatus`
- `office.requestApproval`
- `office.resolveApproval`
- `office.createAgent`
- `worker.registerDockerRunner`
- `worker.heartbeat`
- `worker.pullNextTask`
- `worker.reportSession`

设计原则：

- 先保证结构稳定
- 优先使用真实数据库
- 在本地未迁移或数据库异常时仍能回退样例快照

### 5.4 前端展示层

- `src/app/page.tsx`
- `src/app/layout.tsx`
- `src/styles/globals.css`
- `src/app/_components/office-shell.tsx`

当前首页已经从模板页替换为：

- 顶部轻量控制条与状态指标
- office 主场景
- 人物选中高亮与 inspector
- 新增人物 Dialog
- 下发任务 Dialog
- 移动端 Sheet 总控面板
- SSE 实时状态刷新
- 最近一次执行结果回放

其中单页面控制面已经支持：

- 创建任务
- 更新任务状态
- 发起审批
- 批准或驳回审批
- 新增角色并尝试 provision Docker OpenClaw runner

### 5.5 初始化与种子脚本

- `scripts/seed-virtual-office.mjs`
- `package.json` 中的 `db:seed:office`
- `package.json` 中的 `db:setup:office`

当前可直接使用：

- 启动本地数据库容器
- 执行 migration
- 注入初始 Virtual Office 种子数据

## 6. 本期架构选择说明

## 6.1 为什么保留样例快照回退机制

原因：

- 本地开发环境不一定总是有数据库
- 新环境初始化前仍需要可展示的安全默认态
- 页面结构和 API 契约需要在异常情况下保持可用

这意味着当前系统是“优先真实数据，异常时回退样例快照”，而不是完全依赖演示数据。

## 6.2 为什么先建 schema 再建 worker

如果没有统一的数据结构，后续接 Docker OpenClaw worker 会出现：

- 状态字段不统一
- 任务和会话无法关联
- 审计和事件回放无法落地
- 前后端各自定义一套模型

所以本期优先把数据库边界和 API 快照做对。

## 7. 下一阶段实施顺序

## Phase 1：任务与审批写入能力

状态：已完成第一版

目标：

- 让系统从“只读看板”升级为“可操作控制面”

任务：

- 新增任务创建 mutation
- 新增任务状态流转 mutation
- 新增审批创建与批准 mutation
- 记录操作审计日志

完成标准：

- 可以在系统里创建任务、推进任务、产生审批

当前结果：

- 首页指挥台已经具备最小写操作闭环
- 写操作会同步落库并生成事件记录
- 页面刷新后能看到真实数据库状态变化

## Phase 2：设备接入

状态：已完成最小骨架

目标：

- 让 Virtual Office 不只显示状态，而是具备真实执行能力

任务：

- 定义 Docker OpenClaw worker 协议
- 建立设备注册和心跳机制
- 建立执行会话创建与结束机制
- 上传日志、截图和产物

完成标准：

- 至少 1 个真实 Docker OpenClaw runner 可以接入并执行一类任务

当前结果：

- 新增人物时会尝试直接 `docker run` OpenClaw runner
- 已提供 worker 注册、心跳和会话回报接口
- 已提供任务拉取协议和容器内 bootstrap 脚本
- 已支持挂载 `~/.codex/config.toml` 与 `~/.codex/auth.json` 的设计
- 已本地验证“新增人物 -> runner 注册 -> 自动认领任务 -> 执行成功 -> 回报 session”闭环

## Phase 3：实时化

状态：已完成第一版

目标：

- 从静态刷新视图升级为实时办公室控制台

任务：

- 建立 WebSocket 事件流
- 推送角色状态、设备状态、审批状态和任务状态变化
- 支持页面实时刷新和局部状态更新

完成标准：

- 首页状态变化可以在不刷新的情况下实时反映

当前结果：

- 已提供 `/api/office/stream` SSE 接口
- 前端单页通过 EventSource 自动失效并刷新 office 快照
- 任务、审批、设备和执行结果更新会自动反映到页面

## Phase 4：治理与接管

目标：

- 让高风险角色和设备执行真正可控

任务：

- 建立人工接管入口
- 建立审批执行闭环
- 建立会话审计和历史回放
- 加入权限与角色隔离

完成标准：

- 高风险任务可以被批准、驳回、接管和回放

## 8. 推荐优先级

如果只做最短路径，我建议下一步按这个顺序继续：

1. 先做实时事件流
2. 再补人工接管和治理闭环
3. 然后做登录、权限和组织隔离
4. 最后补任务结果回放和资产索引

原因：

- 真实数据层已经具备最小闭环
- 任务与审批已经可写
- 现在已经具备最小执行闭环
- 当前真正的缺口是“可实时”和“可治理”

## 9. 风险提示

- 如果过早接设备而不先收敛数据结构，后续重构成本会很高
- 如果只做炫酷地图而没有任务写入与审批闭环，系统会停留在 demo 层
- 如果高风险动作没有审计和人工接管，HR / 采购 / 发布等流程无法上线

## 10. 建议的下一个实际动作

从工程推进角度，最合理的下一步是：

- 给首页加上真实事件推送
- 增加人工接管入口和执行会话控制
- 增加任务执行结果的历史回放与产物索引

完成这一步之后，Virtual Office 就会从“数据库驱动的空间化控制台”迈向“真实可执行的多 Agent 系统”。
