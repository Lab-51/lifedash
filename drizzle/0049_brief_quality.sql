ALTER TABLE "action_items" ADD COLUMN "owner" varchar(120);--> statement-breakpoint
ALTER TABLE "action_items" ADD COLUMN "due_text" varchar(120);--> statement-breakpoint
ALTER TABLE "meeting_briefs" ADD COLUMN "structure" jsonb;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "participants" text[];