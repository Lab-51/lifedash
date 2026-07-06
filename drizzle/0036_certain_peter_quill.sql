CREATE TABLE "meeting_agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_agent_messages" ADD CONSTRAINT "meeting_agent_messages_thread_id_meeting_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."meeting_agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_agent_threads" ADD CONSTRAINT "meeting_agent_threads_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_agent_messages_thread_id_idx" ON "meeting_agent_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_agent_threads_meeting_id_idx" ON "meeting_agent_threads" USING btree ("meeting_id");