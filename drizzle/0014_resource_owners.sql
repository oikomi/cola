ALTER TABLE "cola_agent" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_zone_setting" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_task" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_inference_deployment" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_cmdb_asset" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_cmdb_project" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_cmdb_release" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_device" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_execution_session" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_approval" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_event" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_post" ADD COLUMN "ownerUserId" uuid;--> statement-breakpoint
ALTER TABLE "cola_agent" ADD CONSTRAINT "cola_agent_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_zone_setting" ADD CONSTRAINT "cola_zone_setting_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_task" ADD CONSTRAINT "cola_task_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_training_job" ADD CONSTRAINT "cola_training_job_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_inference_deployment" ADD CONSTRAINT "cola_inference_deployment_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_cmdb_asset" ADD CONSTRAINT "cola_cmdb_asset_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_cmdb_project" ADD CONSTRAINT "cola_cmdb_project_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_cmdb_release" ADD CONSTRAINT "cola_cmdb_release_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_device" ADD CONSTRAINT "cola_device_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_execution_session" ADD CONSTRAINT "cola_execution_session_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_approval" ADD CONSTRAINT "cola_approval_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_event" ADD CONSTRAINT "cola_event_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cola_post" ADD CONSTRAINT "cola_post_ownerUserId_cola_user_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."cola_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_owner_idx" ON "cola_agent" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "zone_setting_owner_idx" ON "cola_zone_setting" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "task_owner_idx" ON "cola_task" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "training_job_owner_idx" ON "cola_training_job" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "inference_deployment_owner_idx" ON "cola_inference_deployment" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "cmdb_asset_owner_idx" ON "cola_cmdb_asset" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "cmdb_project_owner_idx" ON "cola_cmdb_project" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "cmdb_release_owner_idx" ON "cola_cmdb_release" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "device_owner_idx" ON "cola_device" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "execution_session_owner_idx" ON "cola_execution_session" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "approval_owner_idx" ON "cola_approval" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "event_owner_idx" ON "cola_event" USING btree ("ownerUserId");--> statement-breakpoint
CREATE INDEX "post_owner_idx" ON "cola_post" USING btree ("ownerUserId");
