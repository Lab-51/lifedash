CREATE TABLE "xp_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" varchar(50) NOT NULL,
  "xp_amount" integer NOT NULL,
  "entity_id" uuid,
  "earned_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "xp_events" ("id", "event_type", "xp_amount", "entity_id", "earned_at")
SELECT gen_random_uuid(), 'focus_session', "duration_minutes", "card_id", "completed_at"
FROM "focus_sessions";
