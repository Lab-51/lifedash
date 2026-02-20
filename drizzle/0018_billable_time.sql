ALTER TABLE "focus_sessions" ADD COLUMN "billable" boolean DEFAULT true NOT NULL;
ALTER TABLE "projects" ADD COLUMN "hourly_rate" real;
