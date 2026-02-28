CREATE INDEX "columns_board_id_idx" ON "columns" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "card_activities_card_id_idx" ON "card_activities" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "card_activities_created_at_idx" ON "card_activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "card_checklist_items_card_id_idx" ON "card_checklist_items" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "card_labels_card_id_idx" ON "card_labels" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "card_relationships_source_card_id_idx" ON "card_relationships" USING btree ("source_card_id");--> statement-breakpoint
CREATE INDEX "card_relationships_target_card_id_idx" ON "card_relationships" USING btree ("target_card_id");--> statement-breakpoint
CREATE INDEX "cards_column_id_idx" ON "cards" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "cards_archived_idx" ON "cards" USING btree ("archived");--> statement-breakpoint
CREATE INDEX "cards_updated_at_idx" ON "cards" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "cards_created_at_idx" ON "cards" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "action_items_meeting_id_idx" ON "action_items" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "action_items_status_idx" ON "action_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transcripts_meeting_id_idx" ON "transcripts" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "idea_tags_idea_id_idx" ON "idea_tags" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "brainstorm_messages_session_id_idx" ON "brainstorm_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "card_agent_messages_card_id_idx" ON "card_agent_messages" USING btree ("card_id");