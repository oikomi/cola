import { index, pgEnum, pgTableCreator } from "drizzle-orm/pg-core";

import {
  inferenceDeploymentStatusValues,
} from "@/server/deployments/catalog";
import {
  agentRoleValues,
  agentStatusValues,
  approvalStatusValues,
  approvalTypeValues,
  deviceStatusValues,
  deviceTypeValues,
  eventSeverityValues,
  priorityValues,
  riskLevelValues,
  sessionStatusValues,
  taskStatusValues,
  taskTypeValues,
  zoneValues,
} from "@/server/office/catalog";
import {
  trainingJobStatusValues,
  trainingJobTypeValues,
} from "@/server/training/catalog";
import { gpuAllocationModeValues } from "@/lib/gpu-allocation";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `cola_${name}`);

export const agentRoleEnum = pgEnum("cola_agent_role", agentRoleValues);
export const agentStatusEnum = pgEnum("cola_agent_status", agentStatusValues);
export const zoneEnum = pgEnum("cola_zone", zoneValues);
export const taskTypeEnum = pgEnum("cola_task_type", taskTypeValues);
export const taskStatusEnum = pgEnum("cola_task_status", taskStatusValues);
export const priorityEnum = pgEnum("cola_priority", priorityValues);
export const riskLevelEnum = pgEnum("cola_risk_level", riskLevelValues);
export const trainingJobTypeEnum = pgEnum(
  "cola_training_job_type",
  trainingJobTypeValues,
);
export const trainingJobStatusEnum = pgEnum(
  "cola_training_job_status",
  trainingJobStatusValues,
);
export const gpuAllocationModeEnum = pgEnum(
  "cola_gpu_allocation_mode",
  gpuAllocationModeValues,
);
export const inferenceDeploymentStatusEnum = pgEnum(
  "cola_inference_deployment_status",
  inferenceDeploymentStatusValues,
);
export const cmdbDeployTargetEnum = pgEnum("cola_cmdb_deploy_target", [
  "k8s",
  "ssh",
  "docker",
  "none",
]);
export const cmdbReleaseStatusEnum = pgEnum("cola_cmdb_release_status", [
  "pending",
  "running",
  "success",
  "failed",
  "canceled",
]);
export const deviceTypeEnum = pgEnum("cola_device_type", deviceTypeValues);
export const deviceStatusEnum = pgEnum("cola_device_status", deviceStatusValues);
export const sessionStatusEnum = pgEnum(
  "cola_execution_session_status",
  sessionStatusValues,
);
export const approvalTypeEnum = pgEnum(
  "cola_approval_type",
  approvalTypeValues,
);
export const approvalStatusEnum = pgEnum(
  "cola_approval_status",
  approvalStatusValues,
);
export const eventSeverityEnum = pgEnum(
  "cola_event_severity",
  eventSeverityValues,
);

export const agents = createTable(
  "agent",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    name: d.varchar({ length: 120 }).notNull(),
    roleType: agentRoleEnum().notNull(),
    status: agentStatusEnum().notNull(),
    zoneId: zoneEnum().notNull(),
    focus: d.text(),
    capabilities: d.jsonb(),
    riskScope: d.jsonb(),
    isEnabled: d.boolean().notNull().default(true),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("agent_role_idx").on(t.roleType),
    index("agent_status_idx").on(t.status),
    index("agent_zone_idx").on(t.zoneId),
  ],
);

export const zoneSettings = createTable("zone_setting", (d) => ({
  zoneId: zoneEnum().primaryKey(),
  workstationCapacity: d.integer().notNull().default(0),
  createdAt: d
    .timestamp({ withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
}));

export const tasks = createTable(
  "task",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    title: d.varchar({ length: 160 }).notNull(),
    taskType: taskTypeEnum().notNull(),
    status: taskStatusEnum().notNull(),
    priority: priorityEnum().notNull().default("medium"),
    riskLevel: riskLevelEnum().notNull().default("low"),
    zoneId: zoneEnum().notNull(),
    currentAgentId: d.uuid().references(() => agents.id, {
      onDelete: "set null",
    }),
    parentTaskId: d.uuid(),
    inputPayload: d.jsonb(),
    outputPayload: d.jsonb(),
    summary: d.text(),
    dueAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("task_status_idx").on(t.status),
    index("task_agent_idx").on(t.currentAgentId),
    index("task_zone_idx").on(t.zoneId),
    index("task_risk_idx").on(t.riskLevel),
  ],
);

export const trainingJobs = createTable(
  "training_job",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    title: d.varchar({ length: 160 }).notNull(),
    jobType: trainingJobTypeEnum().notNull(),
    status: trainingJobStatusEnum().notNull().default("draft"),
    priority: priorityEnum().notNull().default("medium"),
    baseModel: d.varchar({ length: 120 }).notNull(),
    datasetName: d.varchar({ length: 120 }).notNull(),
    datasetSplit: d.varchar({ length: 32 }).notNull().default("train"),
    datasetTextField: d.varchar({ length: 64 }).notNull().default("text"),
    objective: d.text().notNull(),
    gpuAllocationMode: gpuAllocationModeEnum().notNull().default("whole"),
    gpuCount: d.integer().notNull().default(1),
    gpuMemoryGi: d.integer(),
    nodeCount: d.integer().notNull().default(1),
    gpusPerNode: d.integer().notNull().default(1),
    configSource: d.varchar({ length: 32 }).notNull().default("manual"),
    launcherType: d.varchar({ length: 32 }).notNull().default("python"),
    distributedBackend: d.varchar({ length: 32 }).notNull().default("none"),
    deepspeedStage: d.integer(),
    precision: d.varchar({ length: 16 }),
    loadIn4bit: d.boolean().notNull().default(true),
    studioConfigSnapshot: d.jsonb(),
    trainingConfigSnapshot: d.jsonb(),
    runtimeNamespace: d.varchar({ length: 120 }),
    runtimeKind: d.varchar({ length: 32 }),
    runtimeJobName: d.varchar({ length: 120 }),
    runtimeServiceName: d.varchar({ length: 120 }),
    runtimeLeaderPodName: d.varchar({ length: 120 }),
    runtimeImage: d.varchar({ length: 255 }),
    artifactPath: d.text(),
    lastError: d.text(),
    startedAt: d.timestamp({ withTimezone: true }),
    finishedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("training_job_status_idx").on(t.status),
    index("training_job_priority_idx").on(t.priority),
    index("training_job_created_idx").on(t.createdAt),
  ],
);

export const inferenceDeployments = createTable(
  "inference_deployment",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    name: d.varchar({ length: 120 }).notNull(),
    status: inferenceDeploymentStatusEnum().notNull().default("draft"),
    modelName: d.varchar({ length: 160 }).notNull(),
    imageTag: d.varchar({ length: 160 }).notNull(),
    endpoint: d.varchar({ length: 255 }).notNull(),
    objective: d.text().notNull(),
    gpuAllocationMode: gpuAllocationModeEnum().notNull().default("whole"),
    gpuCount: d.integer().notNull().default(1),
    gpuMemoryGi: d.integer(),
    replicaCount: d.integer().notNull().default(1),
    startedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("inference_deployment_status_idx").on(t.status),
    index("inference_deployment_name_idx").on(t.name),
    index("inference_deployment_created_idx").on(t.createdAt),
  ],
);

export type CmdbProjectConfig = {
  triggerToken?: string;
  customVariables?: Record<string, string>;
  targetAssetName?: string;
  deployEnv?: string;
  healthUrl?: string;
  monitorUrl?: string;
  k8sNamespace?: string;
  k8sDeployment?: string;
  dockerImage?: string;
  sshPath?: string;
  sshDeployCommand?: string;
};

export const cmdbProjects = createTable(
  "cmdb_project",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }).notNull(),
    gitlabProjectId: d.integer(),
    gitlabPath: d.varchar({ length: 512 }).notNull().unique(),
    gitlabWebUrl: d.text(),
    description: d.text(),
    defaultBranch: d.varchar({ length: 128 }).notNull().default("main"),
    enabled: d.boolean().notNull().default(true),
    deployTarget: cmdbDeployTargetEnum().notNull().default("none"),
    config: d.jsonb().$type<CmdbProjectConfig>(),
    lastSyncedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("cmdb_project_name_idx").on(t.name),
    index("cmdb_project_path_idx").on(t.gitlabPath),
    index("cmdb_project_enabled_idx").on(t.enabled),
    index("cmdb_project_target_idx").on(t.deployTarget),
  ],
);

export const cmdbReleases = createTable(
  "cmdb_release",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    projectId: d
      .integer()
      .notNull()
      .references(() => cmdbProjects.id, { onDelete: "cascade" }),
    ref: d.varchar({ length: 128 }).notNull(),
    deployEnv: d.varchar({ length: 64 }),
    gitlabPipelineId: d.integer(),
    gitlabPipelineUrl: d.text(),
    gitlabStatus: d.varchar({ length: 64 }),
    status: cmdbReleaseStatusEnum().notNull().default("pending"),
    variables: d.jsonb().$type<Record<string, string>>(),
    triggeredBy: d.varchar({ length: 256 }),
    lastError: d.text(),
    startedAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    completedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("cmdb_release_project_idx").on(t.projectId),
    index("cmdb_release_status_idx").on(t.status),
    index("cmdb_release_created_idx").on(t.createdAt),
  ],
);

export const devices = createTable(
  "device",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    name: d.varchar({ length: 120 }).notNull(),
    deviceType: deviceTypeEnum().notNull(),
    status: deviceStatusEnum().notNull(),
    resourcePool: d.varchar({ length: 120 }).notNull(),
    host: d.varchar({ length: 255 }),
    metadata: d.jsonb(),
    lastHeartbeatAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("device_status_idx").on(t.status),
    index("device_pool_idx").on(t.resourcePool),
  ],
);

export const executionSessions = createTable(
  "execution_session",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    taskId: d.uuid().references(() => tasks.id, {
      onDelete: "cascade",
    }),
    agentId: d.uuid().references(() => agents.id, {
      onDelete: "set null",
    }),
    deviceId: d.uuid().references(() => devices.id, {
      onDelete: "set null",
    }),
    status: sessionStatusEnum().notNull().default("pending"),
    logPath: d.text(),
    artifactPath: d.text(),
    startedAt: d.timestamp({ withTimezone: true }),
    endedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("execution_session_task_idx").on(t.taskId),
    index("execution_session_device_idx").on(t.deviceId),
    index("execution_session_status_idx").on(t.status),
  ],
);

export const approvals = createTable(
  "approval",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    taskId: d.uuid().references(() => tasks.id, {
      onDelete: "cascade",
    }),
    approvalType: approvalTypeEnum().notNull(),
    status: approvalStatusEnum().notNull().default("pending"),
    requestedByAgentId: d.uuid().references(() => agents.id, {
      onDelete: "set null",
    }),
    approvedByUserId: d.varchar({ length: 120 }),
    title: d.varchar({ length: 160 }).notNull(),
    reason: d.text(),
    resolvedAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("approval_status_idx").on(t.status),
    index("approval_task_idx").on(t.taskId),
  ],
);

export const events = createTable(
  "event",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    eventType: d.varchar({ length: 120 }).notNull(),
    entityType: d.varchar({ length: 80 }).notNull(),
    entityId: d.varchar({ length: 120 }).notNull(),
    severity: eventSeverityEnum().notNull().default("info"),
    title: d.varchar({ length: 160 }).notNull(),
    description: d.text(),
    payload: d.jsonb(),
    occurredAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  }),
  (t) => [
    index("event_entity_idx").on(t.entityType, t.entityId),
    index("event_occurred_idx").on(t.occurredAt),
  ],
);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)],
);
