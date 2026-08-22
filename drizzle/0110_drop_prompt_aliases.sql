-- Strip the two dead alias keys from prompts already written.
--
-- `system` and `postHistory` carried the same two texts a second time, because
-- assembly and the provider each declared their own prompts slot under those
-- names (13 §12 finding i). Spec 1.1.0 closed that — both now read the context
-- node's prompts by reference — so nothing declares those names and nothing
-- resolves them.
--
-- Removing them from `seedPrompts.ts` and `migrateLegacy.ts` is not enough on
-- its own: both are **insert-only by seed key**, which is deliberate (a row a
-- user edited is theirs) and means an existing row keeps whatever it was
-- created with. Without this, every install that has already booted keeps two
-- inert keys, and the panel's editor renders one box per key in the row — so a
-- shipped prompt shows five boxes where the pipeline reads three, with no way
-- to tell which two do nothing.
--
-- Scoped to the two namespaces that ever had the aliases. The summarize and
-- graph namespaces use their own field names (`batch`, `synth`, `name`, …) and
-- are not touched. A `-` on a key that is absent is a no-op in jsonb, so this
-- is safe to run against a database that never had them.
--
-- Not a schema change: `db:generate` writes nothing for this, so the file, the
-- journal entry and the snapshot are hand-authored (0108 is the precedent).
UPDATE "pipeline_prompts"
SET "fields" = (("fields"::jsonb) - 'system' - 'postHistory')::json
WHERE "spec_id" IN (
	SELECT "id" FROM "pipeline_specs"
	WHERE "slug" IN ('core:spec/respond', 'core:spec/narrate')
)
AND (("fields"::jsonb) ? 'system' OR ("fields"::jsonb) ? 'postHistory');
