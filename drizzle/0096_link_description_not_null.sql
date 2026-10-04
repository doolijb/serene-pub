-- A link's description is text, never NULL: `NOT NULL DEFAULT ''`.
--
-- ## Why hand-written
--
-- `0033_unique_killraven` creates `narrative_relationships.description`
-- nullable with no default, while its snapshot (and every snapshot after it,
-- up to `0093`) records `NOT NULL DEFAULT ''`. drizzle-kit diffs snapshots,
-- not databases, so `0095_schema_0_6_0` cannot see the gap and never emits
-- these statements. Without this file every database, fresh or upgraded,
-- would hold a nullable column that `schema.ts` declares NOT NULL.
--
-- The UPDATE is a no-op on a fresh database and on an upgraded one (the 0.5.3
-- rows are in the attic by now); it keeps the file safe to apply anywhere.
UPDATE "narrative_relationships" SET "description" = '' WHERE "description" IS NULL;--> statement-breakpoint
ALTER TABLE "narrative_relationships" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "narrative_relationships" ALTER COLUMN "description" SET NOT NULL;
