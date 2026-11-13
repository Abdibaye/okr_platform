CREATE TYPE "public"."access_permission" AS ENUM('viewer', 'editor');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('not_required', 'pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."check_in_cadence" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('on_track', 'at_risk', 'off_track');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('in_app_only', 'pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."goal_level" AS ENUM('company', 'team', 'individual');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."goal_visibility" AS ENUM('company', 'team', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('invitation', 'assignment', 'check_in_request', 'check_in_cadence', 'approaching_deadline', 'overdue_update', 'mention', 'approval');--> statement-breakpoint
CREATE TABLE "goal_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"key_result_id" uuid,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(160) DEFAULT '' NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"team_id" uuid,
	"manager_id" text,
	"job_title" varchar(160) DEFAULT '' NOT NULL,
	"token" varchar(128) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"accepted_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"email_delivery_status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "key_result_editors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key_result_id" uuid NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kr_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"key_result_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"effective_date" date NOT NULL,
	"value" numeric(14, 4) NOT NULL,
	"progress" numeric(6, 2) NOT NULL,
	"confidence" "confidence_level" DEFAULT 'on_track' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"blockers" text DEFAULT '' NOT NULL,
	"corrects_check_in_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_id" text NOT NULL,
	"actor_id" text,
	"type" "notification_type" NOT NULL,
	"title" varchar(240) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link_path" varchar(500),
	"entity_type" varchar(40),
	"entity_id" text,
	"dedup_key" varchar(240) NOT NULL,
	"read_at" timestamp with time zone,
	"email_status" "delivery_status" DEFAULT 'in_app_only' NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_error" text,
	"last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objective_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"permission" "access_permission" DEFAULT 'viewer' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lead_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_cycle_id_okr_cycles_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "cycle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "objectives" ALTER COLUMN "progress" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "objectives" ALTER COLUMN "progress" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "entity_type" varchar(40);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "job_title" varchar(160) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "key_results" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "key_results" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "key_results" ADD COLUMN "confidence" "confidence_level" DEFAULT 'on_track' NOT NULL;--> statement-breakpoint
ALTER TABLE "key_results" ADD COLUMN "last_check_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "key_results" ADD COLUMN "last_effective_date" date;--> statement-breakpoint
ALTER TABLE "key_results" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "level" "goal_level" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "status" "goal_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "approval_status" "approval_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "visibility" "goal_visibility" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "parent_objective_id" uuid;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "copied_from_objective_id" uuid;--> statement-breakpoint
ALTER TABLE "objectives" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "okr_cycles" ADD COLUMN "require_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "okr_cycles" ADD COLUMN "check_in_cadence" "check_in_cadence" DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "okr_cycles" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_comments" ADD CONSTRAINT "goal_comments_key_result_id_key_results_id_fk" FOREIGN KEY ("key_result_id") REFERENCES "public"."key_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_manager_id_user_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result_editors" ADD CONSTRAINT "key_result_editors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result_editors" ADD CONSTRAINT "key_result_editors_key_result_id_key_results_id_fk" FOREIGN KEY ("key_result_id") REFERENCES "public"."key_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result_editors" ADD CONSTRAINT "key_result_editors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kr_check_ins" ADD CONSTRAINT "kr_check_ins_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kr_check_ins" ADD CONSTRAINT "kr_check_ins_cycle_id_okr_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."okr_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kr_check_ins" ADD CONSTRAINT "kr_check_ins_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kr_check_ins" ADD CONSTRAINT "kr_check_ins_key_result_id_key_results_id_fk" FOREIGN KEY ("key_result_id") REFERENCES "public"."key_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kr_check_ins" ADD CONSTRAINT "kr_check_ins_corrects_check_in_id_kr_check_ins_id_fk" FOREIGN KEY ("corrects_check_in_id") REFERENCES "public"."kr_check_ins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_access" ADD CONSTRAINT "objective_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_access" ADD CONSTRAINT "objective_access_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_access" ADD CONSTRAINT "objective_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_comments_objective_created_idx" ON "goal_comments" USING btree ("objective_id","created_at");--> statement-breakpoint
CREATE INDEX "invitations_company_email_idx" ON "invitations" USING btree ("company_id","email");--> statement-breakpoint
CREATE INDEX "invitations_email_status_idx" ON "invitations" USING btree ("email","status");--> statement-breakpoint
CREATE UNIQUE INDEX "key_result_editors_key_result_user_unique" ON "key_result_editors" USING btree ("key_result_id","user_id");--> statement-breakpoint
CREATE INDEX "kr_check_ins_key_result_effective_idx" ON "kr_check_ins" USING btree ("key_result_id","effective_date","created_at");--> statement-breakpoint
CREATE INDEX "kr_check_ins_company_cycle_idx" ON "kr_check_ins" USING btree ("company_id","cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_company_recipient_dedup_unique" ON "notifications" USING btree ("company_id","recipient_id","dedup_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "objective_access_objective_user_unique" ON "objective_access" USING btree ("objective_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_team_user_unique" ON "team_memberships" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_memberships_company_user_idx" ON "team_memberships" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_company_name_unique" ON "teams" USING btree ("company_id","name");--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_cycle_id_okr_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."okr_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_manager_id_user_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parent_objective_id_objectives_id_fk" FOREIGN KEY ("parent_objective_id") REFERENCES "public"."objectives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_copied_from_objective_id_objectives_id_fk" FOREIGN KEY ("copied_from_objective_id") REFERENCES "public"."objectives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_company_entity_idx" ON "audit_logs" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "company_memberships_company_manager_idx" ON "company_memberships" USING btree ("company_id","manager_id");--> statement-breakpoint
CREATE INDEX "key_results_company_owner_idx" ON "key_results" USING btree ("company_id","owner_id");--> statement-breakpoint
CREATE INDEX "objectives_company_owner_idx" ON "objectives" USING btree ("company_id","owner_id");--> statement-breakpoint
CREATE INDEX "objectives_parent_idx" ON "objectives" USING btree ("parent_objective_id");