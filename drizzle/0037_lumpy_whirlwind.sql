CREATE TYPE "public"."live_suggestion_status" AS ENUM('proposed', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."live_suggestion_type" AS ENUM('action_item', 'decision', 'question');--> statement-breakpoint
CREATE TABLE "live_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"type" "live_suggestion_type" NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "live_suggestion_status" DEFAULT 'proposed' NOT NULL,
	"accepted_card_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_suggestions" ADD CONSTRAINT "live_suggestions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_suggestions" ADD CONSTRAINT "live_suggestions_accepted_card_id_cards_id_fk" FOREIGN KEY ("accepted_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_suggestions_meeting_id_idx" ON "live_suggestions" USING btree ("meeting_id");