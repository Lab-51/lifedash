CREATE TABLE "agent_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"related_card_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_cost" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_insights" ADD CONSTRAINT "agent_insights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_insights_project_id_status_idx" ON "agent_insights" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "agent_insights_created_at_idx" ON "agent_insights" USING btree ("created_at");