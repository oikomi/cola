# Virtual Office 多角色 Agent 系统技术架构

## 0. 文档状态

- 更新时间：2026-04-17
- 文档类型：目标架构文档
- 与当前仓库关系：本文描述目标形态，同时已经按当前实现补充了“已落地 vs. 规划中”的边界；当前仓库的实时层仍以 SSE 为主，编排层和治理层只完成了最小骨架

## 1. 文档目的

本文件定义 Virtual Office 多角色 Agent 系统的技术实现方式，重点回答以下问题：

- 前端如何展示一个“活”的虚拟办公室
- Agent 如何被编排、调度和协作
- Kubernetes OpenClaw runner 如何作为真实执行资源接入系统
- 权限、审批、审计和观测如何落地
- 当前仓库如何演进到一个可运行的 MVP

## 2. 架构目标

- 支持多角色 Agent 的实时可视化运行
- 支持任务驱动的 Agent 编排和跨角色交接
- 支持设备资源池化，而不是角色永久占机
- 支持真实执行、实时回传、人工接管
- 支持治理、审计、可观测和后续扩展

## 3. 非目标

- 不做游戏服务器架构
- 不做强一致的复杂协作编辑系统
- 不在第一阶段支持无限角色和无限设备
- 不在第一阶段引入复杂微服务拆分

## 4. 总体架构

系统分为六层：

### 4.1 展示层

- Next.js Web 前端
- 地图视图、指挥中心、审批台、事件流

### 4.2 实时协同层

- 当前实现：SSE 推送 office 版本变化，前端收到后重拉快照
- 后续可演进为 WebSocket 或更细粒度的增量推送

### 4.3 应用服务层

- 任务服务
- Agent 服务
- 设备服务
- 审批服务
- 事件服务

### 4.4 编排层

- Agent 调度器
- 工作流引擎
- 规则引擎

### 4.5 执行层

- Kubernetes OpenClaw Worker
- 浏览器自动化
- 终端命令执行
- IDE / 桌面自动化

### 4.6 数据与治理层

- PostgreSQL
- 本地工作目录中的日志与执行产物
- 审批、事件与执行会话构成的最小审计链路
- Redis / 队列、对象存储和独立日志系统仍属于后续演进项

## 5. 推荐技术栈

结合当前仓库已有技术，建议采用：

- 前端：Next.js App Router + React 19
- 数据访问：tRPC + TanStack Query
- 数据库：PostgreSQL + Drizzle ORM
- 实时层：当前使用 SSE；如果后续出现更高频的局部更新需求，再升级到 WebSocket
- 任务队列：当前由 runner 主动轮询 `/api/worker/tasks/next`；后续可引入 Postgres queue 或 Redis/BullMQ
- 地图渲染：Canvas / PixiJS
- Worker：Node.js daemon
- 自动化执行：Playwright + Shell + 受控本地脚本

## 6. 为什么采用“角色与设备解耦”

不建议一个角色永久绑定一个固定执行节点，原因包括：

- 设备利用率低
- 成本高
- 调度不灵活
- 某角色空闲时机器浪费
- 故障迁移复杂

推荐方式：

- 角色 Agent 是逻辑身份
- Kubernetes OpenClaw runner 是资源池节点
- Agent 在任务执行时动态申请设备
- 执行会话结束后释放设备

## 7. 核心服务划分

## 7.1 Task Service

职责：

- 创建任务
- 更新任务状态
- 建立交接关系
- 记录输入输出
- 维护任务时间线

## 7.2 Agent Service

职责：

- 管理角色定义
- 管理角色能力标签
- 维护角色实时状态
- 为角色分配任务

## 7.3 Device Service

职责：

- 管理 Kubernetes OpenClaw runner 注册
- 跟踪设备在线状态
- 分配和回收执行会话
- 维护设备健康数据

## 7.4 Orchestrator Service

职责：

- 选择合适角色处理任务
- 根据规则决定是否自动流转
- 触发审批、升级和重试
- 协调多 Agent 协作

## 7.5 Approval Service

职责：

- 根据风险规则创建审批
- 阻断高风险动作
- 记录批准、驳回和接管操作

## 7.6 Event Service

职责：

- 汇总系统事件
- 推送到前端
- 供审计和回放查询

## 8. 数据模型建议

## 8.1 agents

- `id`
- `name`
- `role_type`
- `status`
- `capabilities`
- `risk_scope`
- `memory_profile_id`
- `created_at`
- `updated_at`

## 8.2 tasks

- `id`
- `title`
- `task_type`
- `status`
- `priority`
- `risk_level`
- `created_by`
- `current_agent_id`
- `parent_task_id`
- `input_payload`
- `output_payload`
- `summary`
- `created_at`
- `updated_at`

## 8.3 zone_settings

- `zone_id`
- `workstation_capacity`
- `created_at`
- `updated_at`

## 8.4 task_handoffs

说明：这是目标模型，当前仓库尚未落地独立的 handoff 表。

- `id`
- `task_id`
- `from_agent_id`
- `to_agent_id`
- `summary`
- `created_at`

## 8.5 devices

- `id`
- `name`
- `device_type`
- `host`
- `status`
- `resource_pool`
- `last_heartbeat_at`
- `metadata`

## 8.6 execution_sessions

- `id`
- `task_id`
- `agent_id`
- `device_id`
- `status`
- `started_at`
- `ended_at`
- `log_path`
- `artifact_path`

## 8.7 approvals

- `id`
- `task_id`
- `approval_type`
- `status`
- `requested_by_agent_id`
- `approved_by_user_id`
- `reason`
- `created_at`
- `resolved_at`

## 8.8 events

- `id`
- `event_type`
- `entity_type`
- `entity_id`
- `payload`
- `occurred_at`

## 9. 运行时状态模型

### Agent 状态

- idle
- planning
- waiting_device
- executing
- waiting_handoff
- waiting_approval
- blocked
- error

### Task 状态

- created
- queued
- assigned
- in_progress
- pending_approval
- handed_off
- completed
- failed
- canceled

### Device 状态

- online
- busy
- offline
- unhealthy
- maintenance

## 10. 核心任务生命周期

1. 任务创建
2. 编排器选择角色
3. 角色进入 planning
4. 如需设备则申请执行会话
5. 设备服务分配可用 Kubernetes OpenClaw runner
6. Worker 开始执行
7. 执行结果持续上报
8. 命中规则则交接、审批、完成或失败

## 11. 前端架构建议

## 11.1 页面结构

- `/`：虚拟办公室主视图
- `/control`：控制台视图
- `/openclaw/[agentId]`：OpenClaw 角色工作区
- `/hermes/[agentId]`：Hermes 角色工作区
- 任务、设备、审批详情当前主要以内联面板和工作区视图承载，而不是单独详情页

## 11.2 UI 分层

- 地图渲染层：负责空间场景和人物状态
- 业务面板层：负责任务、审批、事件、设备详情
- 实时同步层：负责订阅状态变化

## 11.3 场景渲染建议

- 使用 Canvas 或 PixiJS 处理等距地图和角色动画
- 业务面板继续使用标准 React 组件
- 地图只负责状态感知，不承担复杂业务逻辑

## 12. 实时通信设计

推荐单向事件推送为主，命令请求为辅。当前仓库已经落地的是 SSE 版本，事件内容很轻，只负责通知客户端重新拉快照。

### 当前 SSE 事件

- `snapshot`
- `heartbeat`
- `error`

### 后续可扩展的增量事件示例

- `agent.status.changed`
- `task.updated`
- `task.handoff.created`
- `device.heartbeat`
- `session.started`
- `session.finished`
- `approval.requested`
- `approval.resolved`

### 命令示例

- 创建任务
- 指派角色
- 批准动作
- 人工接管
- 终止会话

## 13. Kubernetes OpenClaw Worker 设计

每个 Kubernetes OpenClaw runner 运行一个常驻 Worker 进程，职责包括：

- 启动后向控制面注册
- 周期性发送心跳
- 拉取或接收执行任务
- 创建本地执行会话
- 执行浏览器、终端或本地脚本动作
- 上传日志、截图和产出物
- 支持人工接管和中断

### Worker 本地能力

- Playwright 浏览器执行
- Shell 命令执行
- 文件读写与上传
- 截图和录屏
- IDE 或桌面自动化适配层

## 14. 执行安全设计

- Worker 必须使用受控密钥接入
- Worker 只能访问授权任务与授权资源
- 敏感操作必须通过控制面下发授权
- 本地执行日志必须上传并持久化
- 必须支持紧急停机和任务撤销

## 15. Agent 编排设计

编排器不等于模型本身，它负责流程控制。

核心职责：

- 根据任务类型匹配角色
- 根据风险等级决定是否需要审批
- 根据依赖关系决定交接顺序
- 根据失败类型决定重试、改派或升级

建议第一阶段采用规则驱动编排，而不是过早引入自由自治。

## 16. 权限与审批设计

### 普通动作

- 可自动执行
- 仅记录日志

### 中风险动作

- 需人工复核
- 允许 Agent 先准备执行上下文

### 高风险动作

- 必须人工批准
- 必须保留理由和审计记录
- 可要求双人批准

## 17. 观测与审计

必须记录以下对象：

- 任务状态变化
- 角色状态变化
- 设备状态变化
- 执行会话日志
- 审批记录
- 人工接管记录
- 失败和重试原因

建议同时建设：

- 实时事件流
- 历史回放视图
- 按任务和设备的过滤查询

## 18. 当前仓库的落地情况

基于当前仓库现状，以下几步已经基本完成：

### Step 1：数据模型

- 已落地 `agents`、`tasks`、`devices`、`execution_sessions`、`approvals`、`events`、`zone_settings`
- 已提供 migration 与办公室 seed 数据

### Step 2：任务与角色 API

- 已支持创建人物、扩容工位、创建任务、更新任务状态、发起审批、处理审批
- 已提供 worker 注册、心跳、拉任务和 session 回报接口

### Step 3：虚拟办公室首页

- `/` 已切到等距办公室主视图
- `/control` 保留列表式控制台
- 已通过 SSE 驱动实时刷新
- 已支持角色工作区与最近一次执行结果回放

### Step 4：设备接入

- 已接入真实 Kubernetes OpenClaw runner
- 已接入真实 Kubernetes Hermes runner
- 当前仍缺少 worker 鉴权与更复杂的调度治理

### Step 5：审批与接管

- 审批表和审批 UI 已落地
- 人工接管入口仍是后续项

## 19. MVP 范围建议

只做一条最小闭环：

- 4 个角色：产品、研发、运营、CEO Office
- 1 种设备：Kubernetes OpenClaw runner
- 1 类任务：需求交付
- 1 套审批：生产发布批准
- 1 套事件流：任务、设备、审批三类事件

## 20. 后续演进方向

- 接入多设备池
- 接入 HR、采购等非研发流程
- 引入长期记忆
- 引入成本优化调度
- 引入多组织 / 多项目视图
