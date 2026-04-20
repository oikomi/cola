ALTER TABLE "cola_training_job" ADD COLUMN "runtimeNamespace" varchar(120);--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "runtimeJobName" varchar(120);--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "runtimeImage" varchar(255);--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "artifactPath" text;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "lastError" text;
