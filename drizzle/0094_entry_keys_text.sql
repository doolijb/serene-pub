-- `entry_keys_text(keys)`: an entry's keys as the annotation lane reads them —
-- joined by ", ", a NULL key read as empty, exactly JavaScript's
-- `keys.join(", ")` in `entryAnnotationText` (`annotations/index.ts`).
--
-- ## Why a function
--
-- `lorebook_entries.annotation_text_hash` (created by `0095_schema_0_6_0`) is
-- GENERATED, and Postgres admits only IMMUTABLE functions in a generated
-- column. `array_to_string` is STABLE because it takes any array and some
-- element types print differently under different settings. `text` is not one
-- of them, so over `text[]` the join is immutable in fact, and this wrapper
-- declares it.
--
-- ## Why hand-written
--
-- drizzle-kit emits the generated column's expression but never the function
-- it calls, so this file has no snapshot and must stay ahead of every
-- generated migration that creates that column.
CREATE FUNCTION "entry_keys_text"("keys" text[]) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE
	AS $$ SELECT coalesce(array_to_string("keys", ', ', ''), '') $$;
