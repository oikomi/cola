import type {
  AgentRole,
  AgentStatus,
  ApprovalStatus,
  ApprovalType,
  DockerRunnerEngine,
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
import type { ResourceOwner } from "@/server/resource-owners";

export type OfficeMetric = {
  label: string;
  value: string;
  delta: string;
};

export type OfficeZone = {
  id: ZoneId;
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
  label: string;
  summary: string;
  headcount: number;
  activeCount: number;
  workstationCapacity: number;
  workstationMax: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OfficeAgent = {
  id: string;
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
  name: string;
  role: AgentRole;
  engine: DockerRunnerEngine | null;
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
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
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
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
  name: string;
  type: DeviceType;
  engine: DockerRunnerEngine | null;
  nativeDashboardUrl: string | null;
  status: DeviceStatus;
  resourcePool: string;
  currentSessionStatus: SessionStatus | null;
  currentTaskId: string | null;
  healthSummary: string;
};

export type OfficeApproval = {
  id: string;
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
  type: ApprovalType;
  status: ApprovalStatus;
  taskId: string;
  requestedByAgentId: string;
  title: string;
  summary: string;
};

export type OfficeEvent = {
  id: string;
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
  severity: EventSeverity;
  title: string;
  description: string;
  at: string;
};

export type OfficeExecutionReport = {
  sessionId: string;
  ownerUserId?: string | null;
  ownerUser?: ResourceOwner | null;
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
  mode: "database" | "fallback";
  readOnlyReason: string | null;
  integrations?: {
    hermesGitLab: {
      configured: boolean;
    };
  };
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
