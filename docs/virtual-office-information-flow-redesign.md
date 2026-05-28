# Virtual Office 信息流重设计

## 0. 文档状态

- 更新时间：2026-05-28
- 文档类型：替代设计
- 设计结论：原有的任务、审批、事件、runner 状态流不再作为 Virtual Office 的核心模型。新设计以“人物之间的信息互通”和“可编排的信息流走向”为中心。
- 当前仓库关系：本文是后续实现的新目标；旧实现可以临时保留以保证页面可运行，但不再作为产品方向继续扩展。

## 1. 核心判断

旧模型把 Virtual Office 做成了一个任务控制台：

- 人物接任务
- 审批阻塞任务
- 事件展示系统变化
- runner 状态驱动页面反馈

这不适合“虚拟 office 里多个人物互通信息，并由用户编排信息流走向”的目标。新的主抽象应该是信息网络，而不是任务系统。

新的 Virtual Office 应该回答三个问题：

- 谁知道了什么信息
- 信息下一步应该流向谁
- 哪个人物或工具基于这些信息产出了什么新信息

## 2. 设计目标

- 支持人物之间一对一、多对多、频道式沟通。
- 支持把信息流走向编排成图，而不是硬编码在任务状态里。
- 支持每条信息的来源、去向、上下文和派生关系可追踪。
- 支持人物使用 runner 或其他工具产出回复，但 runner 不再作为办公室主状态。
- 支持普通笔记本电脑上的紧凑布局，默认首屏展示办公室、信息流图和当前 inbox。

## 3. 非目标

- 不继续扩展旧的 task / approval / event / runner status 模型。
- 不把“审批”做成独立一级业务对象；人工确认只是信息流图中的一种节点。
- 不把 runner 心跳、设备健康、执行会话作为 Virtual Office 主界面的一等信息。
- 不改 CMDB；CMDB 与 Virtual Office 信息流无关。
- 不依赖远程机器代码修改；后续接 k8s runner 时以 `infra/k8s/cluster` 中的信息为准。

## 4. 新心智模型

### 4.1 人物 Actor

人物是信息处理节点，不是任务执行人。人物拥有：

- 名称、角色、所属区域
- inbox / outbox
- 可用工具
- 处理信息的提示词或策略
- 订阅的频道

### 4.2 信息包 Packet

信息包是系统里的最小业务单元。它可以是用户输入、人物回复、工具输出、外部系统导入或人工备注。

信息包必须包含：

- 内容
- 来源人物或来源系统
- 所属会话
- 标签
- 上下文引用
- 派生自哪条信息

信息包不可变。后续修正不是覆盖原信息，而是追加新信息。

### 4.3 投递 Delivery

投递表示某条信息被送到了某个人物或频道。投递是 inbox 的基础。

投递可以有很少的状态：

- `unread`
- `seen`
- `handled`
- `archived`

这些状态只描述收件箱处理情况，不再表达业务流程。

### 4.4 会话 Thread

会话是一组相关信息包的上下文容器。一个会话可以跨多个人物、多个频道和多个流图节点。

会话负责回答：

- 这件事从哪里开始
- 现在有哪些信息
- 哪些人物参与过
- 当前信息流处在哪些节点

### 4.5 频道 Channel

频道是一组人物共享的信息空间。常见频道：

- 产品频道
- 研发频道
- 运营频道
- CEO Office 频道
- 项目临时频道

频道不是任务队列，而是共享上下文和广播入口。

### 4.6 信息流 Flow

信息流是可编排的有向图。节点可以是人物、频道、工具、条件判断、人工输入点或归档点。

边决定信息从哪里流向哪里。边可以带条件：

- 标签匹配
- 来源人物
- 内容分类
- 用户手动选择
- 工具输出结构
- 会话上下文是否满足条件

## 5. 推荐数据模型

### 5.1 `office_actor`

- `id`
- `name`
- `role_key`
- `zone_id`
- `instruction`
- `tool_profile`
- `is_enabled`
- `created_at`
- `updated_at`

### 5.2 `office_channel`

- `id`
- `name`
- `channel_type`
- `description`
- `created_at`
- `updated_at`

### 5.3 `office_channel_member`

- `channel_id`
- `actor_id`
- `member_role`
- `created_at`

### 5.4 `office_thread`

- `id`
- `title`
- `origin`
- `summary`
- `created_by_actor_id`
- `created_at`
- `updated_at`

### 5.5 `office_packet`

- `id`
- `thread_id`
- `source_actor_id`
- `source_kind`
- `parent_packet_id`
- `content`
- `content_format`
- `tags`
- `metadata`
- `created_at`

### 5.6 `office_delivery`

- `id`
- `packet_id`
- `target_actor_id`
- `target_channel_id`
- `delivery_state`
- `delivered_by_flow_run_id`
- `seen_at`
- `handled_at`
- `created_at`

### 5.7 `office_flow_definition`

- `id`
- `name`
- `description`
- `version`
- `is_published`
- `graph`
- `created_at`
- `updated_at`

`graph` 保存节点和边的结构化定义。第一版可以用 JSONB，后续再拆表优化查询。

### 5.8 `office_flow_run`

- `id`
- `flow_definition_id`
- `thread_id`
- `start_packet_id`
- `run_state`
- `created_at`
- `updated_at`

### 5.9 `office_flow_step`

- `id`
- `flow_run_id`
- `node_id`
- `input_packet_id`
- `output_packet_id`
- `step_state`
- `created_at`
- `completed_at`

### 5.10 `office_tool_invocation`

- `id`
- `actor_id`
- `thread_id`
- `input_packet_id`
- `tool_key`
- `input_payload`
- `output_packet_id`
- `created_at`
- `completed_at`

这张表只记录人物调用工具的输入输出。runner、k8s、会话细节属于工具适配层，不进入主界面的状态流。

## 6. 信息流图 DSL

第一版可以使用 JSONB 保存流图。

```json
{
  "nodes": [
    { "id": "entry", "type": "channel", "channelKey": "inbox" },
    { "id": "product", "type": "actor", "roleKey": "product" },
    { "id": "engineering", "type": "actor", "roleKey": "engineering" },
    { "id": "operator", "type": "human_input" },
    { "id": "archive", "type": "archive" }
  ],
  "edges": [
    { "from": "entry", "to": "product" },
    {
      "from": "product",
      "to": "engineering",
      "when": { "tagsAny": ["ready_for_build"] }
    },
    {
      "from": "product",
      "to": "operator",
      "when": { "tagsAny": ["needs_user_choice"] }
    },
    {
      "from": "engineering",
      "to": "archive",
      "when": { "tagsAny": ["final_answer"] }
    }
  ]
}
```

这个 DSL 的重点是让用户控制信息走向。人物可以产出标签，但路由由流图决定。

## 7. 运行时流程

### 7.1 直接发消息

1. 用户或人物创建 `office_packet`。
2. 系统创建一条或多条 `office_delivery`。
3. 目标人物的 inbox 出现新信息。
4. 人物回复时追加新的 `office_packet`。
5. 回复可以继续投递给原发送者、频道或进入某条信息流。

### 7.2 按流图路由

1. 用户选择一个 flow，并输入初始信息。
2. 系统创建 thread、packet、flow_run。
3. flow engine 找到起始节点和下一条边。
4. 系统生成 delivery，把信息送给下一个人物或频道。
5. 人物处理后产出新 packet。
6. flow engine 根据边条件继续投递。
7. 没有后续边时归档。

### 7.3 人物调用工具

1. 人物收到信息。
2. 人物决定需要工具。
3. 系统创建 `office_tool_invocation`。
4. runner 或其他适配器执行工具。
5. 工具输出被写成新的 `office_packet`。
6. 新信息重新进入投递或流图路由。

这里不再把 runner 注册、心跳、忙闲状态展示为办公室主状态。办公室只关心工具有没有产出信息。

## 8. API 草案

### 8.1 Snapshot

- `office.getFlowSnapshot`

返回：

- 人物列表
- 频道列表
- 当前会话
- inbox 摘要
- 活跃信息流实例
- 信息流图

不返回旧任务、审批、事件、runner 状态。

### 8.2 人物与频道

- `office.createActor`
- `office.updateActor`
- `office.createChannel`
- `office.addChannelMember`
- `office.removeChannelMember`

### 8.3 消息

- `office.sendPacket`
- `office.replyPacket`
- `office.deliverPacket`
- `office.markDeliverySeen`
- `office.markDeliveryHandled`

### 8.4 信息流

- `office.createFlowDefinition`
- `office.updateFlowDefinition`
- `office.publishFlowDefinition`
- `office.startFlowRun`
- `office.routeFlowRun`

### 8.5 工具适配

- `office.requestToolInvocation`
- `office.completeToolInvocation`

runner 只接这两个适配接口，不再拥有 Virtual Office 的主状态模型。

## 9. 前端重设计

首页保留“虚拟办公室”的空间感，但内容重新组织为三块：

- 左侧：人物和频道，显示 inbox 数量和当前会话焦点。
- 中间：办公室地图或信息流图，可切换视图。
- 右侧：当前 thread 的信息包列表、投递目标和下一步路由。

移除旧入口：

- 任务列表
- 审批列表
- 事件流
- runner 状态卡
- 执行会话回放作为主模块

工具输出仍可在 thread 中查看，但表现为一条普通信息。

## 10. 最小可运行版本

第一版只需要四个能力：

- 创建人物
- 人物之间直接发消息
- 创建一个简单 flow 图
- 初始信息按 flow 图自动投递

推荐默认 flow：

```text
入口频道 -> 产品人物 -> 研发人物 -> 运营人物 -> 归档
```

CEO Office 不默认拦截所有信息，只订阅指定标签或用户手动加入的 thread。

## 11. 迁移计划

### Step 1：新增信息流 schema

新增 `office_actor`、`office_channel`、`office_thread`、`office_packet`、`office_delivery`、`office_flow_definition`、`office_flow_run`、`office_flow_step`、`office_tool_invocation`。

旧表先不删除，避免当前页面立即不可用。

### Step 2：新增信息流 service 和 router

新增独立 service，不复用旧 `task-service`。

建议文件：

- `src/server/office-flow/schema.ts`
- `src/server/office-flow/service.ts`
- `src/server/office-flow/router.ts`
- `src/server/office-flow/snapshot.ts`

### Step 3：替换首页

把 `/` 从任务控制台改成信息流控制面。

`/control` 可以临时保留旧页面作为兼容入口，直到信息流版本稳定。

### Step 4：runner 适配

runner 不再拉任务。新的适配方式是：

- 拉取待处理 delivery
- 读取 thread 上下文
- 产出 packet
- 交给 flow engine 路由

### Step 5：删除旧主流程

信息流版本可用后，再移除或隐藏：

- task service
- approval service
- event feed
- runner status cards
- execution session 主视图

## 12. 测试与体验要求

- service 层测试覆盖直接投递、频道投递、按标签路由、无匹配边归档。
- flow DSL 需要测试非法图、孤立节点、循环图和缺失目标。
- 前端用普通笔记本视口验证，重点检查 `1366x768` 和 `1440x900`。
- 后续接 k8s runner 时，集群信息必须来自 `infra/k8s/cluster`。
- 不修改远程机器代码。
