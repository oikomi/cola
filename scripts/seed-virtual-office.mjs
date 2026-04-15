import fs from "node:fs";
import path from "node:path";

import postgres from "postgres";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  const envContents = fs.readFileSync(envPath, "utf8");

  for (const rawLine of envContents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL 未设置，无法执行 Virtual Office seed。");
}

const sql = postgres(databaseUrl, { max: 1 });

const now = new Date();

const agents = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "森",
    roleType: "ceo_office",
    status: "executing",
    zoneId: "command",
    focus: "汇总发布阻塞并等待批准结论",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "林岚",
    roleType: "product",
    status: "planning",
    zoneId: "product",
    focus: "将运营反馈整理为下一轮任务输入",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "李代码",
    roleType: "engineering",
    status: "executing",
    zoneId: "engineering",
    focus: "在 OpenClaw Runner-02 上跑回归测试并准备 PR",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "言",
    roleType: "operations",
    status: "waiting_handoff",
    zoneId: "growth",
    focus: "等待研发交付发布摘要和变更说明",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "乔",
    roleType: "hr",
    status: "idle",
    zoneId: "people",
    focus: "空闲，可接入候选人协调与面试总结",
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    name: "唐采买",
    roleType: "procurement",
    status: "waiting_approval",
    zoneId: "vendor",
    focus: "等待外设报价单审批，暂时未下单",
  },
];

const tasks = [
  {
    id: "73333333-3333-4733-8333-333333333333",
    title: "Virtual Office 首页改造",
    taskType: "feature",
    status: "in_progress",
    priority: "high",
    riskLevel: "medium",
    zoneId: "engineering",
    currentAgentId: "33333333-3333-4333-8333-333333333333",
    summary: "替换 T3 默认首页，接入角色、任务、设备总览。",
  },
  {
    id: "72222222-2222-4722-8222-222222222222",
    title: "整理研发到运营的交接输入",
    taskType: "coordination",
    status: "assigned",
    priority: "high",
    riskLevel: "low",
    zoneId: "product",
    currentAgentId: "22222222-2222-4222-8222-222222222222",
    summary: "把变更点、发布时间窗和异常回退说明结构化。",
  },
  {
    id: "74444444-4444-4744-8444-444444444444",
    title: "生成发布摘要与运营播报",
    taskType: "campaign",
    status: "handed_off",
    priority: "medium",
    riskLevel: "low",
    zoneId: "growth",
    currentAgentId: "44444444-4444-4444-8444-444444444444",
    summary: "读取交接摘要后生成对内同步和对外文案。",
  },
  {
    id: "75555555-5555-4755-8555-555555555555",
    title: "审批设计团队显示器报价",
    taskType: "procurement",
    status: "pending_approval",
    priority: "medium",
    riskLevel: "high",
    zoneId: "vendor",
    currentAgentId: "66666666-6666-4666-8666-666666666666",
    summary: "采购 Agent 已完成比价，等待人工确认预算。",
  },
  {
    id: "71111111-1111-4711-8111-111111111111",
    title: "发布窗口审批与升级汇总",
    taskType: "coordination",
    status: "pending_approval",
    priority: "critical",
    riskLevel: "high",
    zoneId: "command",
    currentAgentId: "11111111-1111-4111-8111-111111111111",
    summary: "收敛当前异常、批准结果和回滚条件。",
  },
];

const devices = [
  {
    id: "81111111-1111-4811-8111-111111111111",
    name: "OpenClaw Runner-01",
    deviceType: "docker_openclaw",
    status: "online",
    resourcePool: "docker-core",
    metadata: {
      runtime: "docker",
      engine: "openclaw",
      healthSummary: "空闲，容器健康检查正常",
    },
  },
  {
    id: "83333333-3333-4833-8333-333333333333",
    name: "OpenClaw Runner-02",
    deviceType: "docker_openclaw",
    status: "busy",
    resourcePool: "docker-core",
    metadata: {
      runtime: "docker",
      engine: "openclaw",
      healthSummary: "正在容器内执行前端构建和类型检查",
    },
  },
  {
    id: "82222222-2222-4822-8222-222222222222",
    name: "OpenClaw Runner-03",
    deviceType: "docker_openclaw",
    status: "busy",
    resourcePool: "docker-ops",
    metadata: {
      runtime: "docker",
      engine: "openclaw",
      healthSummary: "挂载 OpenClaw 浏览器会话，等待交接后继续运行",
    },
  },
  {
    id: "84444444-4444-4844-8444-444444444444",
    name: "OpenClaw Runner-04",
    deviceType: "docker_openclaw",
    status: "unhealthy",
    resourcePool: "docker-backoffice",
    metadata: {
      runtime: "docker",
      engine: "openclaw",
      healthSummary: "最近一次 OpenClaw 供应商门户会话超时，需要人工复核",
    },
  },
];

const executionSessions = [
  {
    id: "b1111111-1111-4b11-8b11-111111111111",
    taskId: "73333333-3333-4733-8333-333333333333",
    agentId: "33333333-3333-4333-8333-333333333333",
    deviceId: "83333333-3333-4833-8333-333333333333",
    status: "running",
    logPath: "/logs/session-mm02-ui.log",
    artifactPath: "/artifacts/session-mm02-ui",
  },
  {
    id: "b2222222-2222-4b22-8b22-222222222222",
    taskId: "74444444-4444-4744-8444-444444444444",
    agentId: "44444444-4444-4444-8444-444444444444",
    deviceId: "82222222-2222-4822-8222-222222222222",
    status: "running",
    logPath: "/logs/session-mm03-ops.log",
    artifactPath: "/artifacts/session-mm03-ops",
  },
  {
    id: "b3333333-3333-4b33-8b33-333333333333",
    taskId: "75555555-5555-4755-8555-555555555555",
    agentId: "66666666-6666-4666-8666-666666666666",
    deviceId: "84444444-4444-4844-8444-444444444444",
    status: "failed",
    logPath: "/logs/session-mm04-vendor.log",
    artifactPath: "/artifacts/session-mm04-vendor",
  },
];

const approvals = [
  {
    id: "91111111-1111-4911-8111-111111111111",
    taskId: "71111111-1111-4711-8111-111111111111",
    approvalType: "production_release",
    status: "pending",
    requestedByAgentId: "11111111-1111-4111-8111-111111111111",
    title: "生产发布窗口批准",
    reason: "研发回归通过，但仍需确认外部依赖告警是否可接受。",
  },
  {
    id: "92222222-2222-4922-8222-222222222222",
    taskId: "75555555-5555-4755-8555-555555555555",
    approvalType: "vendor_quote",
    status: "pending",
    requestedByAgentId: "66666666-6666-4666-8666-666666666666",
    title: "显示器采购报价批准",
    reason: "第二供应商交期更短但成本更高，需要预算 owner 选择。",
  },
];

const events = [
  {
    id: "a1111111-1111-4a11-8a11-111111111111",
    eventType: "session.started",
    entityType: "execution_session",
    entityId: "b1111111-1111-4b11-8b11-111111111111",
    severity: "info",
    title: "研发 Agent 已占用 OpenClaw Runner-02",
    description: "容器会话开始于 13:32，目标是完成首页改造和类型检查。",
    occurredAt: new Date(now.getTime() - 2 * 60_000),
  },
  {
    id: "a2222222-2222-4a22-8a22-222222222222",
    eventType: "task.blocked",
    entityType: "task",
    entityId: "74444444-4444-4744-8444-444444444444",
    severity: "warning",
    title: "运营 Agent 等待交接",
    description: "当前缺少最终发布日期和回滚条件，需要产品或 CEO Office 补齐。",
    occurredAt: new Date(now.getTime() - 5 * 60_000),
  },
  {
    id: "a3333333-3333-4a33-8a33-333333333333",
    eventType: "device.unhealthy",
    entityType: "device",
    entityId: "84444444-4444-4844-8444-444444444444",
    severity: "critical",
    title: "OpenClaw Runner-04 最近一次会话失败",
    description: "采购门户容器会话超时，报价单抓取没有完成。",
    occurredAt: new Date(now.getTime() - 8 * 60_000),
  },
  {
    id: "a4444444-4444-4a44-8a44-444444444444",
    eventType: "task.updated",
    entityType: "task",
    entityId: "72222222-2222-4722-8222-222222222222",
    severity: "info",
    title: "产品 Agent 创建新交接草稿",
    description: "已生成结构化摘要，等待发布窗口决策。",
    occurredAt: new Date(now.getTime() - 11 * 60_000),
  },
];

async function seed() {
  await sql.begin(async (tx) => {
    await tx`delete from cola_event`;
    await tx`delete from cola_approval`;
    await tx`delete from cola_execution_session`;
    await tx`delete from cola_task`;
    await tx`delete from cola_device`;
    await tx`delete from cola_agent`;

    for (const agent of agents) {
      await tx`
        insert into cola_agent (
          id, name, "roleType", status, "zoneId", focus, "createdAt"
        ) values (
          ${agent.id}::uuid,
          ${agent.name},
          ${agent.roleType}::cola_agent_role,
          ${agent.status}::cola_agent_status,
          ${agent.zoneId}::cola_zone,
          ${agent.focus},
          ${now}
        )
      `;
    }

    for (const task of tasks) {
      await tx`
        insert into cola_task (
          id, title, "taskType", status, priority, "riskLevel", "zoneId",
          "currentAgentId", summary, "createdAt"
        ) values (
          ${task.id}::uuid,
          ${task.title},
          ${task.taskType}::cola_task_type,
          ${task.status}::cola_task_status,
          ${task.priority}::cola_priority,
          ${task.riskLevel}::cola_risk_level,
          ${task.zoneId}::cola_zone,
          ${task.currentAgentId}::uuid,
          ${task.summary},
          ${now}
        )
      `;
    }

    for (const device of devices) {
      await tx`
        insert into cola_device (
          id, name, "deviceType", status, "resourcePool", metadata, "createdAt"
        ) values (
          ${device.id}::uuid,
          ${device.name},
          ${device.deviceType}::cola_device_type,
          ${device.status}::cola_device_status,
          ${device.resourcePool},
          ${JSON.stringify(device.metadata)}::jsonb,
          ${now}
        )
      `;
    }

    for (const session of executionSessions) {
      await tx`
        insert into cola_execution_session (
          id, "taskId", "agentId", "deviceId", status, "logPath", "artifactPath",
          "startedAt", "endedAt", "createdAt"
        ) values (
          ${session.id}::uuid,
          ${session.taskId}::uuid,
          ${session.agentId}::uuid,
          ${session.deviceId}::uuid,
          ${session.status}::cola_execution_session_status,
          ${session.logPath},
          ${session.artifactPath},
          ${now},
          ${session.status === "failed" ? now : null},
          ${now}
        )
      `;
    }

    for (const approval of approvals) {
      await tx`
        insert into cola_approval (
          id, "taskId", "approvalType", status, "requestedByAgentId", title, reason, "createdAt"
        ) values (
          ${approval.id}::uuid,
          ${approval.taskId}::uuid,
          ${approval.approvalType}::cola_approval_type,
          ${approval.status}::cola_approval_status,
          ${approval.requestedByAgentId}::uuid,
          ${approval.title},
          ${approval.reason},
          ${now}
        )
      `;
    }

    for (const event of events) {
      await tx`
        insert into cola_event (
          id, "eventType", "entityType", "entityId", severity, title, description, "occurredAt", "createdAt"
        ) values (
          ${event.id}::uuid,
          ${event.eventType},
          ${event.entityType},
          ${event.entityId},
          ${event.severity}::cola_event_severity,
          ${event.title},
          ${event.description},
          ${event.occurredAt},
          ${now}
        )
      `;
    }
  });
}

seed()
  .then(async () => {
    console.log("Virtual Office seed 完成。");
    await sql.end();
  })
  .catch(async (error) => {
    console.error("Virtual Office seed 失败：", error);
    await sql.end();
    process.exit(1);
  });
