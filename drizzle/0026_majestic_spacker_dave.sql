ALTER TABLE "intel_items" ADD COLUMN "relevance_score" integer;--> statement-breakpoint
ALTER TABLE "intel_items" ADD COLUMN "full_content" text;--> statement-breakpoint
CREATE INDEX "intel_items_relevance_score_idx" ON "intel_items" USING btree ("relevance_score");