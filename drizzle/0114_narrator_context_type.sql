-- The narrator gets its own context-builder type, and the reply pipeline gives
-- up a field it never read.
--
-- Both pipelines pinned `core:task/build-template-context@1`, and the panel is
-- generated from the registry row — so each advertised the other's controls.
-- Reply prompts all carried an empty `narratorName`; the narrator offered
-- layout pickers for `exampleDialogue` (read off the speaking character it does
-- not have) and `speakerRelationships` (which its spec deliberately never
-- supplies). Three controls wired to nothing, in both directions.
--
-- A node type is the unit that declares a configurable surface — it is how a
-- plugin declares one, and `RegistryEntry.slots` carries the declaration so core
-- can render the form without executing the plugin that owns it (12 §2, F6).
-- Two surfaces is therefore two types, not one type narrowed per spec.
--
-- Dropping `narratorName` from the reply type's `prompts` slot moves its content
-- hash, and a published version is frozen — so without this delete an upgraded
-- install hits `TypeRegistryConflictError`, `bootstrapPipelines` returns early,
-- and pipelines stop with nothing on screen but a diagnostics line. Deleting the
-- row lets boot re-project the current declaration.
--
-- `core:task/build-narrator-context@1` needs nothing here: adding a type inserts
-- a row and conflicts with nothing.
--
-- Safe only because nothing outside this repo has pinned this version. Once
-- 0.6.0 ships, a changed type is a new version, never a rewrite of the row
-- (13 §12b). `registryHashes.test.ts` records the new hash in the same commit.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:task/build-template-context'
AND "version" = 1;--> statement-breakpoint
-- Strip the dead key from reply prompts already written.
--
-- Seeding is insert-only by seed key — deliberately, because a row a user edited
-- is theirs — so removing it from `seedPrompts.ts` does not touch an install that
-- has already booted. The panel's editor renders one box per key in the row, so
-- without this every shipped reply prompt keeps showing an empty "Narrator name"
-- field that nothing on that pipeline reads. Exactly what `0110` did for the
-- `system` / `postHistory` aliases.
--
-- Scoped to the reply namespace by join rather than applied everywhere: the
-- narrator's rows carry the same key and it is load-bearing there. A `-` on an
-- absent key is a no-op in jsonb, so this is safe against a database that never
-- had it.
UPDATE "pipeline_prompts" AS p
SET "fields" = (("fields"::jsonb) - 'narratorName')::json
FROM "pipeline_specs" AS s
WHERE p."spec_id" = s."id"
AND s."slug" = 'core:spec/respond';
