import type {
  AgentRole,
  AgentStatus,
  ApprovalStatus,
  ApprovalType,
  DeviceStatus,
  DeviceType,
  EventSeverity,
  Priority,
  RiskLevel,
  SessionStatus,
  TaskStatus,
  TaskType,
  ZoneId,
} from "@/server/office/catalog";

export type OfficeMetric = {
  label: string;
  value: string;
  delta: string;
};

export type OfficeZone = {
  id: ZoneId;
  label: string;
  summary: string;
  headcount: number;
  activeCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OfficeAgent = {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  zoneId: ZoneId;
  focus: string;
  currentTaskId: string | null;
  deviceId: string | null;
  energy: number;
  x: number;
  y: number;
};

export type OfficeTask = {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  riskLevel: RiskLevel;
  ownerAgentId: string;
  zoneId: ZoneId;
  summary: string;
};

export type OfficeDevice = {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  resourcePool: string;
  currentSessionStatus: SessionStatus | null;
  currentTaskId: string | null;
  healthSummary: string;
};

export type OfficeApproval = {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  taskId: string;
  requestedByAgentId: string;
  title: string;
  summary: string;
};

export type OfficeEvent = {
  id: string;
  severity: EventSeverity;
  title: string;
  description: string;
  at: string;
};

export type OfficeExecutionReport = {
  sessionId: string;
  taskId: string;
  agentId: string | null;
  deviceId: string | null;
  status: SessionStatus;
  title: string;
  summary: string;
  outputText: string | null;
  artifactPath: string | null;
  logPath: string | null;
  completedAt: string | null;
};

export type OfficeSnapshot = {
  generatedAt: string;
  headline: string;
  metrics: OfficeMetric[];
  zones: OfficeZone[];
  agents: OfficeAgent[];
  tasks: OfficeTask[];
  devices: OfficeDevice[];
  approvals: OfficeApproval[];
  events: OfficeEvent[];
  executionReports: OfficeExecutionReport[];
};
