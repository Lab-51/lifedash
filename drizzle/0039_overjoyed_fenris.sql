CREATE TABLE "twin_profile" (
	"id" varchar(32) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"domain" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"people" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vocabulary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
