ALTER TABLE "focus_sessions" ADD COLUMN IF NOT EXISTS "billable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "hourly_rate" real;
