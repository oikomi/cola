CREATE TYPE "public"."cola_inference_deployment_status" AS ENUM('draft', 'serving', 'paused', 'failed');--> statement-breakpoint
CREATE TABLE "cola_inference_deployment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" "cola_inference_deployment_status" DEFAULT 'draft' NOT NULL,
	"modelName" varchar(160) NOT NULL,
	"imageTag" varchar(160) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"objective" text NOT NULL,
	"gpuCount" integer DEFAULT 1 NOT NULL,
	"replicaCount" integer DEFAULT 1 NOT NULL,
	"startedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "inference_deployment_status_idx" ON "cola_inference_deployment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inference_deployment_name_idx" ON "cola_inference_deployment" USING btree ("name");--> statement-breakpoint
CREATE INDEX "inference_deployment_created_idx" ON "cola_inference_deployment" USING btree ("createdAt");
