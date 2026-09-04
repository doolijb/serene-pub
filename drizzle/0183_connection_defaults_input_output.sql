-- `connection_defaults.capability` becomes `input` + `output`.
--
-- The table held the whole transform id in one `text` primary key —
-- `text+image->text`. Every question the app actually asks of this table is
-- about one SIDE of that id: the admin screen groups cards by output kind, the
-- sampling vocabulary is chosen by output kind, and "which defaults produce
-- images" is the query behind both. Against a single column those are
-- `LIKE '%->image'` scans over a string no index helps with. As two columns they
-- are an equality on an indexed one.
--
-- ⚠ THIS CHANGES A PRIMARY KEY, so it is written add → backfill → constrain →
-- drop rather than as a table rewrite. Every step is separately observable, and
-- the old column is still there and still authoritative until the last
-- statement. Drizzle runs a migration file inside one transaction, so a failure
-- at any statement leaves the table exactly as it was.
--
-- ## The values, and why the order inside a side is not alphabetical
--
-- Comma-delimited `IoKind`s, `+` swapped for `,`, in the EXISTING canonical
-- order — which is `IO_KINDS` declaration order (text, image, audio, video,
-- document, embedding), not alphabetical. Vision stores `input = 'text,image'`
-- and never `'image,text'`. That is the SDK's rule, stated in `capabilities.ts`:
-- "text leads, so vision reads `text+image->text` rather than
-- `image+text->text`". `split_part` and `replace` preserve whatever order the
-- stored id had, and every stored id was written by `transformId()`, so the
-- backfill inherits the canonical order rather than choosing one.
--
--   text+image->text  ->  input 'text,image', output 'text'
--   text->image       ->  input 'text',       output 'image'
--
-- The correspondence has a round-trip property test over the whole `TRANSFORMS`
-- table: `src/lib/shared/capabilities/sides.test.ts`.

ALTER TABLE "connection_defaults" ADD COLUMN "input" text;--> statement-breakpoint
ALTER TABLE "connection_defaults" ADD COLUMN "output" text;--> statement-breakpoint

-- Degenerate rows are DELETED, not backfilled.
--
-- Only transforms were ever registrable here (`capabilityDefaults.ts` and
-- `combos.ts` both say so, and `connectionDefaults:set` refuses anything the
-- combo aggregation does not name), so a `capability` with no `->`, or with an
-- empty side, is corruption rather than data. Backfilling one would write
-- `output = ''` — a row that satisfies the new primary key perfectly and that no
-- reader can ever match again, because nothing will ever ask for a capability
-- with an empty side. An unmatchable row on a lookup table is worse than an
-- absent one: the absent one reads as "not set up" and says where to set it.
--
-- Covers all four shapes in one predicate: no arrow at all (part 2 is ''),
-- '->x', 'x->' and '->'. Run BEFORE the backfill so the backfill has nothing
-- degenerate left to write.
DELETE FROM "connection_defaults"
WHERE split_part("capability", '->', 1) = ''
	OR split_part("capability", '->', 2) = '';--> statement-breakpoint

UPDATE "connection_defaults" SET
	"input" = replace(split_part("capability", '->', 1), '+', ','),
	"output" = replace(split_part("capability", '->', 2), '+', ',');--> statement-breakpoint

ALTER TABLE "connection_defaults" ALTER COLUMN "input" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "connection_defaults" ALTER COLUMN "output" SET NOT NULL;--> statement-breakpoint

-- 0175 declared `"capability" text PRIMARY KEY NOT NULL` inline, so Postgres
-- named the constraint itself: `connection_defaults_pkey`.
ALTER TABLE "connection_defaults" DROP CONSTRAINT "connection_defaults_pkey";--> statement-breakpoint

-- Named to match what Drizzle's `primaryKey({ columns: [input, output] })`
-- generates, so the schema and the database agree about the constraint's name
-- as well as its shape.
--
-- This statement is also the backfill's verification: `capability` was unique,
-- and the split is injective over every id `transformId()` emits, so it cannot
-- collide. If it somehow does — two hand-written rows whose ids differ only in a
-- `+` versus a `,` — this aborts and the whole migration rolls back, which is
-- the right outcome. Silently keeping one of two defaults is not.
ALTER TABLE "connection_defaults" ADD CONSTRAINT "connection_defaults_input_output_pk" PRIMARY KEY ("input","output");--> statement-breakpoint

-- The point of the split. `output` alone is not unique — three transforms
-- produce images — so a plain index, not a unique one.
CREATE INDEX "connection_defaults_output_idx" ON "connection_defaults" USING btree ("output");--> statement-breakpoint

ALTER TABLE "connection_defaults" DROP COLUMN "capability";
