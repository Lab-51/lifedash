ALTER TABLE "twin_facts" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "twin_facts" ADD COLUMN "purged_at" timestamp with time zone;