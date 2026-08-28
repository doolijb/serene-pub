-- Route blocks (20 §10) postdate both of this table's checks, and each check
-- refused them for its own reason: the kind list never learned the word, and
-- F9's bounded check demanded a ceiling from a construct that does not repeat
-- (a route fires a subset of its branches once, like a fan-out runs each lane
-- once). Every routed spec failed at the row until now.
ALTER TABLE "pipeline_blocks" DROP CONSTRAINT "pipeline_blocks_kind_check";
--> statement-breakpoint
ALTER TABLE "pipeline_blocks" ADD CONSTRAINT "pipeline_blocks_kind_check" CHECK ("pipeline_blocks"."kind" IN ('async', 'map', 'loop', 'route'));
--> statement-breakpoint
ALTER TABLE "pipeline_blocks" DROP CONSTRAINT "pipeline_blocks_bounded_check";
--> statement-breakpoint
ALTER TABLE "pipeline_blocks" ADD CONSTRAINT "pipeline_blocks_bounded_check" CHECK ("pipeline_blocks"."kind" IN ('async', 'route') OR "pipeline_blocks"."max" IS NOT NULL);
