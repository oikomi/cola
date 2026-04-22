ALTER TABLE "cola_training_job" ADD COLUMN "datasetSplit" varchar(32) DEFAULT 'train' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "datasetTextField" varchar(64) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "nodeCount" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "gpusPerNode" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "configSource" varchar(32) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "launcherType" varchar(32) DEFAULT 'python' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "distributedBackend" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "deepspeedStage" integer;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "precision" varchar(16);--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "loadIn4bit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "studioConfigSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "trainingConfigSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "runtimeKind" varchar(32);--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "runtimeServiceName" varchar(120);--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "runtimeLeaderPodName" varchar(120);--> statement-breakpoint

UPDATE "cola_training_job"
SET
  "datasetSplit" = COALESCE("datasetSplit", 'train'),
  "datasetTextField" = COALESCE("datasetTextField", 'text'),
  "nodeCount" = COALESCE("nodeCount", 1),
  "gpusPerNode" = COALESCE("gpusPerNode", GREATEST(COALESCE("gpuCount", 1), 1)),
  "configSource" = COALESCE("configSource", 'manual'),
  "launcherType" = COALESCE("launcherType", 'python'),
  "distributedBackend" = COALESCE("distributedBackend", 'none'),
  "loadIn4bit" = COALESCE("loadIn4bit", true);
