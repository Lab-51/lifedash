ALTER TYPE "public"."live_suggestion_type" ADD VALUE 'project';--> statement-breakpoint
ALTER TABLE "live_suggestions" ADD COLUMN "accepted_project_id" uuid;--> statement-breakpoint
ALTER TABLE "live_suggestions" ADD CONSTRAINT "live_suggestions_accepted_project_id_projects_id_fk" FOREIGN KEY ("accepted_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;