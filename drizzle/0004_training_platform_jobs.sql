CREATE TYPE "public"."cola_training_job_type" AS ENUM('sft', 'dpo', 'lora', 'pretrain');--> statement-breakpoint
CREATE TYPE "public"."cola_training_job_status" AS ENUM('draft', 'running', 'stopped', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "cola_training_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"jobType" "cola_training_job_type" NOT NULL,
	"status" "cola_training_job_status" DEFAULT 'draft' NOT NULL,
	"priority" "cola_priority" DEFAULT 'medium' NOT NULL,
	"baseModel" varchar(120) NOT NULL,
	"datasetName" varchar(120) NOT NULL,
	"objective" text NOT NULL,
	"gpuCount" integer DEFAULT 1 NOT NULL,
	"startedAt" timestamp with time zone,
	"finishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "training_job_status_idx" ON "cola_training_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "training_job_priority_idx" ON "cola_training_job" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "training_job_created_idx" ON "cola_training_job" USING btree ("createdAt");--> statement-breakpoint
