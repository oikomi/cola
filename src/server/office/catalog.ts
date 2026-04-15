export const agentRoleValues = [
  "product",
  "engineering",
  "operations",
  "hr",
  "procurement",
  "ceo_office",
] as const;

export const agentStatusValues = [
  "idle",
  "planning",
  "waiting_device",
  "executing",
  "waiting_handoff",
  "waiting_approval",
  "blocked",
  "error",
] as const;

export const taskTypeValues = [
  "feature",
  "bugfix",
  "campaign",
  "recruiting",
  "procurement",
  "coordination",
] as const;

export const taskStatusValues = [
  "created",
  "queued",
  "assigned",
  "in_progress",
  "pending_approval",
  "handed_off",
  "completed",
  "failed",
  "canceled",
] as const;

export const priorityValues = ["low", "medium", "high", "critical"] as const;

export const riskLevelValues = ["low", "medium", "high"] as const;

export const deviceTypeValues = [
  "docker_openclaw",
  "browser_runner",
  "sandbox",
] as const;

export const deviceStatusValues = [
  "online",
  "busy",
  "offline",
  "unhealthy",
  "maintenance",
] as const;

export const sessionStatusValues = [
  "pending",
  "starting",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;

export const approvalTypeValues = [
  "production_release",
  "vendor_quote",
  "offer_release",
  "policy_change",
] as const;

export const approvalStatusValues = [
  "pending",
  "approved",
  "rejected",
  "canceled",
] as const;

export const eventSeverityValues = ["info", "warning", "critical"] as const;

export const zoneValues = [
  "command",
  "product",
  "engineering",
  "growth",
  "people",
  "vendor",
] as const;

export type AgentRole = (typeof agentRoleValues)[number];
export type AgentStatus = (typeof agentStatusValues)[number];
export type TaskType = (typeof taskTypeValues)[number];
export type TaskStatus = (typeof taskStatusValues)[number];
export type Priority = (typeof priorityValues)[number];
export type RiskLevel = (typeof riskLevelValues)[number];
export type DeviceType = (typeof deviceTypeValues)[number];
export type DeviceStatus = (typeof deviceStatusValues)[number];
export type SessionStatus = (typeof sessionStatusValues)[number];
export type ApprovalType = (typeof approvalTypeValues)[number];
export type ApprovalStatus = (typeof approvalStatusValues)[number];
export type EventSeverity = (typeof eventSeverityValues)[number];
export type ZoneId = (typeof zoneValues)[number];

export const roleLabels: Record<AgentRole, string> = {
  product: "产品",
  engineering: "研发",
  operations: "运营",
  hr: "HR",
  procurement: "采购",
  ceo_office: "CEO Office",
};

export const agentStatusLabels: Record<AgentStatus, string> = {
  idle: "空闲",
  planning: "规划中",
  waiting_device: "等待设备",
  executing: "执行中",
  waiting_handoff: "等待交接",
  waiting_approval: "等待审批",
  blocked: "阻塞",
  error: "异常",
};

export const taskStatusLabels: Record<TaskStatus, string> = {
  created: "已创建",
  queued: "排队中",
  assigned: "已分派",
  in_progress: "进行中",
  pending_approval: "待审批",
  handed_off: "已交接",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
};

export const priorityLabels: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "关键",
};

export const riskLevelLabels: Record<RiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

export const deviceStatusLabels: Record<DeviceStatus, string> = {
  online: "在线",
  busy: "占用中",
  offline: "离线",
  unhealthy: "异常",
  maintenance: "维护中",
};

export const deviceTypeLabels: Record<DeviceType, string> = {
  docker_openclaw: "Docker / OpenClaw",
  browser_runner: "Browser Runner",
  sandbox: "Sandbox",
};

export const zoneLabels: Record<ZoneId, string> = {
  command: "指挥台",
  product: "产品甲板",
  engineering: "研发工位",
  growth: "增长环",
  people: "People Desk",
  vendor: "供应商港",
};
