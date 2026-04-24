CREATE TYPE "public"."cola_gpu_allocation_mode" AS ENUM('whole', 'memory');--> statement-breakpoint

ALTER TABLE "cola_training_job" ADD COLUMN "gpuAllocationMode" "cola_gpu_allocation_mode" DEFAULT 'whole' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "gpuMemoryGi" integer;--> statement-breakpoint

UPDATE "cola_training_job"
SET
  "gpuAllocationMode" = COALESCE("gpuAllocationMode", 'whole'),
  "gpuMemoryGi" = NULL;--> statement-breakpoint

ALTER TABLE "cola_inference_deployment" ADD COLUMN "gpuAllocationMode" "cola_gpu_allocation_mode" DEFAULT 'whole' NOT NULL;--> statement-breakpoint
ALTER TABLE "cola_inference_deployment" ADD COLUMN "gpuMemoryGi" integer;--> statement-breakpoint

UPDATE "cola_inference_deployment"
SET
  "gpuAllocationMode" = COALESCE("gpuAllocationMode", 'whole'),
  "gpuMemoryGi" = NULL;
