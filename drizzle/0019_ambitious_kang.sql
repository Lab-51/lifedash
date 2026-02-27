CREATE TABLE "project_agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hourly_rate" real;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "billable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project_agent_messages" ADD CONSTRAINT "project_agent_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;