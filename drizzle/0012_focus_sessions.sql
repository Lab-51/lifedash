CREATE TABLE "focus_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "card_id" uuid REFERENCES "cards"("id") ON DELETE SET NULL,
  "duration_minutes" integer NOT NULL,
  "note" text,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "focus_achievements" (
  "id" varchar(50) PRIMARY KEY,
  "unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
