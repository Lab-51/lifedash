CREATE TABLE "calendar_events" (
	"id" varchar(512) PRIMARY KEY NOT NULL,
	"provider" varchar(20) NOT NULL,
	"event_id" varchar(512) NOT NULL,
	"title" varchar(500) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"attendees" jsonb NOT NULL,
	"series_id" varchar(512),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "calendar_event_id" varchar(512);--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "calendar_series_id" varchar(512);--> statement-breakpoint
CREATE INDEX "calendar_events_provider_idx" ON "calendar_events" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "calendar_events_starts_at_idx" ON "calendar_events" USING btree ("starts_at");