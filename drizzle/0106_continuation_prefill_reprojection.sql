-- The text a continue is continuing finally reaches the model.
--
-- Three re-projections, one cause. `sessionMessages:continue` kept the row's
-- partial text and called `generateResponse`, which wrote
-- `(session as any)._continuationPrefill` — a key NOTHING read. The runtime has
-- had the seam since it was written (`prompt/messages.ts` puts
-- `continuationPrefill` on the seed line, the `-2` placeholder the model
-- continues from, and `runtime/bindings.ts` passes it straight through) and no
-- port ever carried a value to it: `core:task/process-messages@1` declared none
-- and no spec wired one. So a continue sent an EMPTY seed line, got a fresh
-- reply, and the socket glued it onto the partial afterwards — the model never
-- saw what it was asked to continue.
--
-- ── 1. The type registry, twice ─────────────────────────────────────────────
--
-- Port declarations are part of a type's content hash (13 §12b), and two moved:
-- `core:task/process-messages@1` gained the `continuationPrefill` IN-port that
-- carries the partial to the seed line, and `core:input/user-message@1` gained
-- the matching OUT-port that lets a caller supply it. On a database that booted
-- a previous build `syncTypeRegistry` would raise `TypeRegistryConflictError`,
-- `bootstrapPipelines` would catch it and return early, and pipelines would
-- silently stop. Deleting the rows lets boot re-project the current
-- declarations. Same precedent, and the same narrowness, as 0095 and 0099: safe
-- only while the 0.6 line is in preview and nothing outside this repo has pinned
-- the versions.
--
-- ⚠ `user-message@1` is shared — `echo`, `generate-image`, `graph-build` and
-- `narrate` take it too. Adding an out-port is purely additive for them: a port
-- nothing wires is never resolved, so none of their documents change and none of
-- their versions move. Only `respond` wires it.
--
-- ── 2. The published document ───────────────────────────────────────────────
--
-- The spec edit is IN PLACE, under the version freeze ruled for the 0.6
-- pre-release ("no SDK spec bumps; all stay a hard 1 until 0.7.0") — respond's
-- `lines` node gained `continuationPrefill: $.input.continuationPrefill`, which
-- is the whole of the fix on the pipeline side. Seeding matches on
-- (slug, semver) and, on a match, updates only the display name (`bootstrap.ts`:
-- "spec publishing is idempotent by version"). So the rewired document would
-- reach NO database that has already seeded — every developer machine and every
-- upgrading install — and would be invisible on a fresh test database, where the
-- row does not exist and the edit publishes normally. Deleting the version row
-- is what makes boot republish it.
--
-- Precedent and terms: `0095_prompt_format_reprojection`, which did exactly this
-- for this same pin, and `0100_narration_split_reprojection`.
-- `pipeline_nodes`, `pipeline_edges`, `pipeline_blocks`, `pipeline_includes`,
-- `pipeline_event_subscriptions` and `pipeline_presets` all cascade from
-- `pipeline_spec_versions`, so the old document goes cleanly. What is LOST with
-- it, stated rather than discovered: the author presets shipped with this
-- version, and any per-subscription `enabled` flag somebody had turned off.
-- `pipeline_configs` hangs off `pipeline_specs`, not off a version, so tuned
-- configurations survive — and `reconcileConfigs` re-runs against the
-- republished version on the same boot. `pipeline_runs.spec_version_id` is a
-- plain column with no foreign key: past runs keep their history and are left
-- pointing at a version row that is gone, which is the state the column's own
-- "nullable on purpose … retired specs" note already describes.
-- `pipeline_specs.active_version_id` is likewise not a foreign key; it dangles
-- for exactly as long as it takes boot to republish and move the pointer, which
-- happens in the same startup that runs this file.
--
-- ⚠ No stored config value is cleared here, and that is deliberate. Nothing
-- about this change alters a parameter's default or an address a config
-- back-filled from: two ports were added and one edge was drawn. Deleting rows
-- that did not change would throw away somebody's tuning and prove nothing.
--
-- ⚠ This must not become a pattern (13 §12b). Once 0.6.0 ships, a changed type
-- or spec is a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:task/process-messages'
AND "version" = 1;
--> statement-breakpoint
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:input/user-message'
AND "version" = 1;
--> statement-breakpoint
DELETE FROM "pipeline_spec_versions"
WHERE "id" IN (
	SELECT "v"."id"
	FROM "pipeline_spec_versions" "v"
	JOIN "pipeline_specs" "s" ON "s"."id" = "v"."spec_id"
	WHERE "s"."slug" = 'core:spec/respond' AND "v"."semver" = '1.20.0'
);
