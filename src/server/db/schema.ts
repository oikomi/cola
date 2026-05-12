import { index, pgEnum, pgTableCreator } from "drizzle-orm/pg-core";

import { inferenceDeploymentStatusValues } from "@/server/deployments/catalog";
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
export const cmdbAssetStatusEnum = pgEnum("cola_cmdb_asset_status", [
  "connected",
  "planned",
  "unknown",
]);
export const userRoleEnum = pgEnum("cola_user_role", [
  "admin",
  "operator",
  "viewer",
]);
export const userStatusEnum = pgEnum("cola_user_status", [
  "active",
  "disabled",
]);
export const deviceTypeEnum = pgEnum("cola_device_type", deviceTypeValues);
export const deviceStatusEnum = pgEnum(
  "cola_device_status",
  deviceStatusValues,
);
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

export const users = createTable(
  "user",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    feishuOpenId: d.varchar({ length: 128 }).notNull().unique(),
    feishuUnionId: d.varchar({ length: 128 }),
    tenantKey: d.varchar({ length: 128 }).notNull(),
    name: d.varchar({ length: 160 }),
    email: d.varchar({ length: 256 }),
    avatarUrl: d.text(),
    role: userRoleEnum().notNull().default("viewer"),
    status: userStatusEnum().notNull().default("active"),
    lastLoginAt: d.timestamp({ withTimezone: true }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("user_feishu_open_idx").on(t.feishuOpenId),
    index("user_tenant_idx").on(t.tenantKey),
    index("user_role_idx").on(t.role),
    index("user_status_idx").on(t.status),
  ],
);

export const authSessions = createTable(
  "auth_session",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    userId: d
      .uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionTokenHash: d.varchar({ length: 128 }).notNull().unique(),
    expiresAt: d.timestamp({ withTimezone: true }).notNull(),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    revokedAt: d.timestamp({ withTimezone: true }),
  }),
  (t) => [
    index("auth_session_user_idx").on(t.userId),
    index("auth_session_token_idx").on(t.sessionTokenHash),
    index("auth_session_expires_idx").on(t.expiresAt),
  ],
);

export const agents = createTable(
  "agent",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("agent_owner_idx").on(t.ownerUserId),
  ],
);

export const zoneSettings = createTable(
  "zone_setting",
  (d) => ({
    zoneId: zoneEnum().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
    workstationCapacity: d.integer().notNull().default(0),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("zone_setting_owner_idx").on(t.ownerUserId)],
);

export const tasks = createTable(
  "task",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("task_owner_idx").on(t.ownerUserId),
  ],
);

export const trainingJobs = createTable(
  "training_job",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("training_job_owner_idx").on(t.ownerUserId),
  ],
);

export const inferenceDeployments = createTable(
  "inference_deployment",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("inference_deployment_owner_idx").on(t.ownerUserId),
  ],
);

export type CmdbProjectConfig = {
  triggerToken?: string;
  customVariables?: Record<string, string>;
  targetAssetName?: string;
  targetAssetNames?: string[];
  deployEnv?: string;
  healthUrl?: string;
  monitorUrl?: string;
  k8sNamespace?: string;
  k8sDeployment?: string;
  dockerImage?: string;
  sshPath?: string;
  sshDeployCommand?: string;
};

export type CmdbReleaseOperationLog = {
  at: string;
  step: string;
  status: "pending" | "running" | "success" | "failed" | "canceled" | "info";
  title: string;
  detail?: string;
};

export const cmdbAssets = createTable(
  "cmdb_asset",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
    name: d.varchar({ length: 128 }).notNull().unique(),
    ip: d.varchar({ length: 128 }).notNull(),
    sshUser: d.varchar({ length: 128 }),
    sshPassword: d.text(),
    sshPort: d.integer().notNull().default(22),
    roles: d.jsonb().$type<string[]>(),
    arch: d.varchar({ length: 64 }),
    status: cmdbAssetStatusEnum().notNull().default("connected"),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("cmdb_asset_name_idx").on(t.name),
    index("cmdb_asset_status_idx").on(t.status),
    index("cmdb_asset_ip_idx").on(t.ip),
    index("cmdb_asset_owner_idx").on(t.ownerUserId),
  ],
);

export const cmdbProjects = createTable(
  "cmdb_project",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
    name: d.varchar({ length: 256 }).notNull(),
    gitlabProjectId: d.integer(),
    gitlabPath: d.varchar({ length: 512 }).notNull().unique(),
    gitlabWebUrl: d.text(),
    description: d.text(),
    defaultBranch: d.varchar({ length: 128 }).notNull().default("main"),
    enabled: d.boolean().notNull().default(true),
    deployTarget: cmdbDeployTargetEnum().notNull().default("docker"),
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
    index("cmdb_project_owner_idx").on(t.ownerUserId),
  ],
);

export const cmdbReleases = createTable(
  "cmdb_release",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    operationLogs: d.jsonb().$type<CmdbReleaseOperationLog[]>(),
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
    index("cmdb_release_owner_idx").on(t.ownerUserId),
  ],
);

export const devices = createTable(
  "device",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("device_owner_idx").on(t.ownerUserId),
  ],
);

export const executionSessions = createTable(
  "execution_session",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("execution_session_owner_idx").on(t.ownerUserId),
  ],
);

export const approvals = createTable(
  "approval",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("approval_owner_idx").on(t.ownerUserId),
  ],
);

export const events = createTable(
  "event",
  (d) => ({
    id: d.uuid().defaultRandom().primaryKey(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("event_owner_idx").on(t.ownerUserId),
  ],
);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    ownerUserId: d.uuid().references(() => users.id, {
      onDelete: "set null",
    }),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [
    index("name_idx").on(t.name),
    index("post_owner_idx").on(t.ownerUserId),
  ],
);
