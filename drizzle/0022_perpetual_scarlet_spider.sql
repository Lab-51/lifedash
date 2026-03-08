CREATE TABLE "card_agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_agent_messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "project_agent_messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "card_agent_threads" ADD CONSTRAINT "card_agent_threads_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_threads" ADD CONSTRAINT "project_agent_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_agent_threads_card_id_idx" ON "card_agent_threads" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "project_agent_threads_project_id_idx" ON "project_agent_threads" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "card_agent_messages" ADD CONSTRAINT "card_agent_messages_thread_id_card_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."card_agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agent_messages" ADD CONSTRAINT "project_agent_messages_thread_id_project_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."project_agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_agent_messages_thread_id_idx" ON "card_agent_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "project_agent_messages_project_id_idx" ON "project_agent_messages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_agent_messages_thread_id_idx" ON "project_agent_messages" USING btree ("thread_id");--> statement-breakpoint
-- Backfill: create a default thread for each card that has existing messages
INSERT INTO "card_agent_threads" ("id", "card_id", "title", "created_at")
SELECT gen_random_uuid(), DISTINCT_CARDS."card_id", 'Conversation', now()
FROM (SELECT DISTINCT "card_id" FROM "card_agent_messages") AS DISTINCT_CARDS;--> statement-breakpoint
-- Backfill: assign existing card messages to their card's new thread
UPDATE "card_agent_messages" SET "thread_id" = (
  SELECT "id" FROM "card_agent_threads" WHERE "card_agent_threads"."card_id" = "card_agent_messages"."card_id" LIMIT 1
) WHERE "thread_id" IS NULL;--> statement-breakpoint
-- Backfill: create a default thread for each project that has existing messages
INSERT INTO "project_agent_threads" ("id", "project_id", "title", "created_at")
SELECT gen_random_uuid(), DISTINCT_PROJECTS."project_id", 'Conversation', now()
FROM (SELECT DISTINCT "project_id" FROM "project_agent_messages") AS DISTINCT_PROJECTS;--> statement-breakpoint
-- Backfill: assign existing project messages to their project's new thread
UPDATE "project_agent_messages" SET "thread_id" = (
  SELECT "id" FROM "project_agent_threads" WHERE "project_agent_threads"."project_id" = "project_agent_messages"."project_id" LIMIT 1
) WHERE "thread_id" IS NULL;