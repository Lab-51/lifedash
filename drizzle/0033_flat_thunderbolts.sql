ALTER TABLE "projects" ADD COLUMN "system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "source_meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_source_meeting_id_idx" ON "cards" USING btree ("source_meeting_id");
