CREATE TYPE "public"."entity_kind" AS ENUM('person', 'topic');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"normalized_name" varchar(255) NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "entity_links" (
	"entity_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_links_entity_id_meeting_id_pk" PRIMARY KEY("entity_id","meeting_id")
);
--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_links_meeting_idx" ON "entity_links" USING btree ("meeting_id");