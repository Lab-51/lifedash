CREATE TABLE "card_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"name" varchar(200) NOT NULL,
	"description" text,
	"priority" "card_priority" DEFAULT 'medium' NOT NULL,
	"label_names" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "recurrence_type" varchar(20);--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "recurrence_end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "source_recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;