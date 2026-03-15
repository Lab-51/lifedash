CREATE TYPE "public"."intel_source_type" AS ENUM('rss', 'manual');--> statement-breakpoint
CREATE TABLE "intel_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"url" varchar(2000) NOT NULL,
	"image_url" varchar(2000),
	"author" varchar(200),
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_bookmarked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"url" varchar(1000) NOT NULL,
	"type" "intel_source_type" DEFAULT 'rss' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intel_items" ADD CONSTRAINT "intel_items_source_id_intel_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."intel_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intel_items_url_idx" ON "intel_items" USING btree ("url");--> statement-breakpoint
CREATE INDEX "intel_items_published_at_idx" ON "intel_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "intel_items_source_id_idx" ON "intel_items" USING btree ("source_id");