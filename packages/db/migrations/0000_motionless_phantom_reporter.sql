CREATE TYPE "public"."action_kind" AS ENUM('payout', 'refund', 'invoice_send', 'order_create');--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('received', 'blocked', 'pending_approval', 'approved', 'denied', 'expired', 'executing', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."approval_decided_via" AS ENUM('dashboard', 'link');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."counterparty_type" AS ENUM('email', 'paypal_payer_id', 'capture_id');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('allow', 'hold', 'block');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" "action_kind" NOT NULL,
	"amount_currency" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"counterparty_type" "counterparty_type" NOT NULL,
	"counterparty_value" text NOT NULL,
	"counterparty_display_name" text,
	"category" text,
	"memo" text,
	"reason" text NOT NULL,
	"source_context" jsonb,
	"metadata" jsonb,
	"status" "action_status" DEFAULT 'received' NOT NULL,
	"paypal_resource_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_via" "approval_decided_via",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"action_id" uuid,
	"agent_id" uuid,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"verdict" "verdict" NOT NULL,
	"risk_score" integer NOT NULL,
	"findings" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "decisions_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"paypal_request_id" text NOT NULL,
	"paypal_resource_id" text,
	"response" jsonb,
	"status" text NOT NULL,
	"error" text,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"instruction" text NOT NULL,
	"policy" jsonb NOT NULL,
	"version" integer NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "actions" ADD CONSTRAINT "actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decisions" ADD CONSTRAINT "decisions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "executions" ADD CONSTRAINT "executions_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_agent_id_idx" ON "actions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_status_idx" ON "actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_created_at_idx" ON "actions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_status_expires_idx" ON "approvals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_action_id_idx" ON "audit_events" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_agent_id_idx" ON "audit_events" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mandates_agent_version_idx" ON "mandates" USING btree ("agent_id","version");