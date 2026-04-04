CREATE TABLE "intel_feed_sources" (
	"feed_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	CONSTRAINT "intel_feed_sources_feed_id_source_id_pk" PRIMARY KEY("feed_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "intel_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"emoji" varchar(10),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intel_briefs" ADD COLUMN "feed_id" uuid;--> statement-breakpoint
ALTER TABLE "intel_feed_sources" ADD CONSTRAINT "intel_feed_sources_feed_id_intel_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."intel_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_feed_sources" ADD CONSTRAINT "intel_feed_sources_source_id_intel_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."intel_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intel_feed_sources_source_id_idx" ON "intel_feed_sources" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "intel_briefs" ADD CONSTRAINT "intel_briefs_feed_id_intel_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."intel_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intel_briefs_type_date_feed_idx" ON "intel_briefs" USING btree ("type","date","feed_id");