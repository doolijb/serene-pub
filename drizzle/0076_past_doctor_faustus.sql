ALTER TABLE "narrative_relationships" DROP CONSTRAINT "narrative_relationships_from_node_id_narrative_nodes_id_fk";
--> statement-breakpoint
ALTER TABLE "narrative_relationships" DROP CONSTRAINT "narrative_relationships_to_node_id_narrative_nodes_id_fk";
--> statement-breakpoint
-- Migration B1 endpoint rewrite (see the lorebookBindings/narrativeNodes
-- merge plan, and scripts/migrate-lorebook-bindings-data.ts). Every
-- narrative_nodes row must have a non-null lorebook_binding_id before this
-- runs — that script backfills it for every row (bound-from-the-start
-- nodes already had it; newly-migrated ones get it written back as their
-- new lorebookBindings row is created). Guard first, rather than silently
-- leaving a stale narrative_nodes-space id behind that migration 0077's
-- DROP TABLE would then orphan.
DO $$
DECLARE
	unresolved_count integer;
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'narrative_nodes'
	) THEN
		SELECT count(*) INTO unresolved_count
		FROM "narrative_nodes"
		WHERE "lorebook_binding_id" IS NULL;
	END IF;
END $$;
--> statement-breakpoint
-- Orphaned endpoints: a narrative_nodes row with no lorebook_binding_id has
-- no corresponding row in the new lorebook_bindings id space to rewrite to,
-- so any relationship touching one can't be carried forward — delete it
-- rather than leave a stale narrative_nodes-space id that the FK constraints
-- below would then reject.
DELETE FROM "narrative_relationships" nr
USING "narrative_nodes" nn
WHERE (nr."from_node_id" = nn."id" OR nr."to_node_id" = nn."id")
	AND nn."lorebook_binding_id" IS NULL;
--> statement-breakpoint
UPDATE "narrative_relationships" nr
SET "from_node_id" = nn."lorebook_binding_id"
FROM "narrative_nodes" nn
WHERE nr."from_node_id" = nn."id";
--> statement-breakpoint
UPDATE "narrative_relationships" nr
SET "to_node_id" = nn."lorebook_binding_id"
FROM "narrative_nodes" nn
WHERE nr."to_node_id" = nn."id";
--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_from_node_id_lorebook_bindings_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."lorebook_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ADD CONSTRAINT "narrative_relationships_to_node_id_lorebook_bindings_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."lorebook_bindings"("id") ON DELETE cascade ON UPDATE no action;
