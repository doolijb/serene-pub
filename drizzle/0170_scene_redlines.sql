ALTER TABLE "lore_redlines" DROP CONSTRAINT "lore_redlines_subject_check";--> statement-breakpoint
ALTER TABLE "lore_redlines" DROP CONSTRAINT "lore_redlines_cause_check";--> statement-breakpoint
ALTER TABLE "lore_redlines" ADD COLUMN "scene_id" integer;--> statement-breakpoint
ALTER TABLE "lore_redlines" ADD CONSTRAINT "lore_redlines_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lore_redlines_scene_idx" ON "lore_redlines" USING btree ("scene_id","id") WHERE "lore_redlines"."scene_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "lore_redlines" ADD CONSTRAINT "lore_redlines_subject_check" CHECK (num_nonnulls("lore_redlines"."entry_id", "lore_redlines"."character_version_id", "lore_redlines"."scene_id") = 1 AND ("lore_redlines"."amendment_id" IS NULL OR "lore_redlines"."entry_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "lore_redlines" ADD CONSTRAINT "lore_redlines_cause_check" CHECK ("lore_redlines"."cause" IN ('save', 'routine', 'apply', 'revert', 'take-back', 'restore', 'scene-compiler'));