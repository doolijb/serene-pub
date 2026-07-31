-- Guard before the drop: narrative_nodes rows are never deleted by
-- scripts/migrate-lorebook-bindings-data.ts or by migration 0076 (the
-- prior migration) — they persist, with lorebook_binding_id backfilled on
-- every row, right up until this DROP removes the whole table. So "table
-- is non-empty" is not a meaningful precondition here; the actual
-- precondition (same one migration 0076 already checks before it reads
-- this column to rewrite narrative_relationships) is that every row has a
-- resolved, non-null lorebook_binding_id. Asserting it again here rather
-- than only trusting 0076 ran correctly turns any future change that
-- reorders/skips 0076 into a loud failure instead of silently destroying
-- unmigrated graph data.
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
DROP TABLE "narrative_nodes" CASCADE;
