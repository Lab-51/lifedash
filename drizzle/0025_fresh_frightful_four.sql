CREATE TYPE "public"."intel_brief_type" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TABLE "intel_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "intel_brief_type" NOT NULL,
	"date" varchar(10) NOT NULL,
	"content" text NOT NULL,
	"article_count" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intel_items" ADD COLUMN "category" varchar(50);--> statement-breakpoint
ALTER TABLE "intel_items" ADD COLUMN "summary" text;--> statement-breakpoint
CREATE UNIQUE INDEX "intel_briefs_type_date_idx" ON "intel_briefs" USING btree ("type","date");--> statement-breakpoint
CREATE INDEX "intel_items_category_idx" ON "intel_items" USING btree ("category");