CREATE TYPE "public"."brainstorm_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."brainstorm_session_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "brainstorm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "brainstorm_message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brainstorm_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" varchar(500) NOT NULL,
	"status" "brainstorm_session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brainstorm_messages" ADD CONSTRAINT "brainstorm_messages_session_id_brainstorm_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."brainstorm_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brainstorm_sessions" ADD CONSTRAINT "brainstorm_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;