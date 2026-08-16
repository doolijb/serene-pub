CREATE INDEX "character_lore_entries_lorebook_id_idx" ON "character_lore_entries" USING btree ("lorebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_tags_unique" ON "character_tags" USING btree ("character_id","tag_id");--> statement-breakpoint
CREATE INDEX "characters_user_id_idx" ON "characters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_characters_character_id_idx" ON "chat_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_id_idx" ON "chat_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_personas_persona_id_idx" ON "chat_personas" USING btree ("persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tags_unique" ON "chat_tags" USING btree ("chat_id","tag_id");--> statement-breakpoint
CREATE INDEX "chats_user_id_idx" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "history_entries_lorebook_id_idx" ON "history_entries" USING btree ("lorebook_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lorebook_tags_unique" ON "lorebook_tags" USING btree ("lorebook_id","tag_id");--> statement-breakpoint
CREATE INDEX "lorebooks_user_id_idx" ON "lorebooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "narrative_nodes_lorebook_id_idx" ON "narrative_nodes" USING btree ("lorebook_id");--> statement-breakpoint
CREATE INDEX "narrative_relationships_from_node_id_idx" ON "narrative_relationships" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX "narrative_relationships_to_node_id_idx" ON "narrative_relationships" USING btree ("to_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_tags_unique" ON "persona_tags" USING btree ("persona_id","tag_id");--> statement-breakpoint
CREATE INDEX "personas_user_id_idx" ON "personas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scenes_lorebook_id_idx" ON "scenes" USING btree ("lorebook_id");--> statement-breakpoint
CREATE INDEX "scenes_chat_id_idx" ON "scenes" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "tags_user_id_idx" ON "tags" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "world_lore_entries_lorebook_id_idx" ON "world_lore_entries" USING btree ("lorebook_id");