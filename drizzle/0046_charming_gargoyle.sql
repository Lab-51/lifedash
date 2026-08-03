DROP INDEX "meeting_agent_threads_meeting_id_idx";--> statement-breakpoint
ALTER TABLE "meeting_agent_threads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "meeting_agent_threads_meeting_id_idx" ON "meeting_agent_threads" USING btree ("meeting_id");