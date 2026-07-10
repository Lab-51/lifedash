CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."twin_fact_category" AS ENUM('person', 'project', 'preference', 'domain', 'commitment');--> statement-breakpoint
CREATE TYPE "public"."twin_fact_status" AS ENUM('active', 'forgotten');--> statement-breakpoint
CREATE TYPE "public"."embedding_entity_type" AS ENUM('brief', 'card', 'transcript_chunk');--> statement-breakpoint
CREATE TABLE "twin_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fact" text NOT NULL,
	"category" "twin_fact_category" NOT NULL,
	"source_meeting_id" uuid,
	"status" "twin_fact_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_index_meta" (
	"id" varchar(32) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"model" varchar(255) NOT NULL,
	"dimensions" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "embedding_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"meeting_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twin_facts" ADD CONSTRAINT "twin_facts_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "twin_facts_status_idx" ON "twin_facts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "twin_facts_source_meeting_idx" ON "twin_facts" USING btree ("source_meeting_id");--> statement-breakpoint
CREATE INDEX "embeddings_entity_idx" ON "embeddings" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "embeddings_meeting_idx" ON "embeddings" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "embeddings_project_idx" ON "embeddings" USING btree ("project_id");