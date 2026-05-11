CREATE TYPE "public"."cola_user_role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."cola_user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "cola_user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feishuOpenId" varchar(128) NOT NULL,
  "feishuUnionId" varchar(128),
  "tenantKey" varchar(128) NOT NULL,
  "name" varchar(160),
  "email" varchar(256),
  "avatarUrl" text,
  "role" "cola_user_role" DEFAULT 'viewer' NOT NULL,
  "status" "cola_user_status" DEFAULT 'active' NOT NULL,
  "lastLoginAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone,
  CONSTRAINT "cola_user_feishuOpenId_unique" UNIQUE("feishuOpenId")
);--> statement-breakpoint
CREATE TABLE "cola_auth_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "sessionTokenHash" varchar(128) NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "revokedAt" timestamp with time zone,
  CONSTRAINT "cola_auth_session_sessionTokenHash_unique" UNIQUE("sessionTokenHash")
);--> statement-breakpoint
ALTER TABLE "cola_auth_session" ADD CONSTRAINT "cola_auth_session_userId_cola_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."cola_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_feishu_open_idx" ON "cola_user" USING btree ("feishuOpenId");--> statement-breakpoint
CREATE INDEX "user_tenant_idx" ON "cola_user" USING btree ("tenantKey");--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "cola_user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "cola_user" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "cola_auth_session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "auth_session_token_idx" ON "cola_auth_session" USING btree ("sessionTokenHash");--> statement-breakpoint
CREATE INDEX "auth_session_expires_idx" ON "cola_auth_session" USING btree ("expiresAt");
