-- The prompt format reaches the render — two re-projections, one cause.
--
-- `core:task/assemble@2` gained a `connection` slot, and the two shipped specs
-- that use it wire that slot to the node which SENDS the reply
-- (`slot.connectionOf("generate")`). Until now nothing supplied the connection's
-- `prompt_format` to the render: `prompt/assemble.ts` read `input.promptFormat`,
-- no port, slot or spec ever set it, and `prompt/renderers.ts` fell back to
-- Vicuna on every run. Every ChatML, Llama-2, Alpaca, OpenAI and Claude
-- connection was sent Vicuna markers, while `runtime/dispatch.ts` stamped the
-- receipt with the connection's REAL format — so the receipt asserted a format
-- the render had not used.
--
-- ── 1. The type registry ────────────────────────────────────────────────────
--
-- Slot declarations are part of a type's content hash (13 §12b). On a database
-- that booted a previous build `syncTypeRegistry` would raise
-- `TypeRegistryConflictError`, `bootstrapPipelines` would catch it and return
-- early, and pipelines would silently stop. Deleting the row lets boot
-- re-project the current declaration. Same precedent, and the same narrowness,
-- as the earlier assemble re-projection: safe only while the 0.6 line is in
-- preview and nothing outside this repo has pinned the version.
--
-- ── 2. The published documents ──────────────────────────────────────────────
--
-- The spec edit is IN PLACE, under the version freeze ruled for the 0.6
-- pre-release ("no SDK spec bumps; all stay a hard 1 until 0.7.0"). Seeding
-- matches on (slug, semver) and, on a match, updates only the display name —
-- `bootstrap.ts` states it: "spec publishing is idempotent by version". So the
-- rewired documents would reach NO database that has already seeded, which is
-- every developer machine and every upgrading install, and would be invisible on
-- a fresh test database where the rows do not exist and the edit publishes
-- normally. Deleting the version rows is what makes boot republish them.
--
-- `pipeline_nodes`, `pipeline_edges`, `pipeline_blocks`, `pipeline_includes`,
-- `pipeline_event_subscriptions` and `pipeline_presets` all cascade from
-- `pipeline_spec_versions`, so the old document goes cleanly. What is LOST with
-- it, stated rather than discovered: the author presets shipped with these
-- versions, and any per-subscription `enabled` flag somebody had turned off.
-- `pipeline_configs` hangs off `pipeline_specs`, not off a version, so tuned
-- configurations survive — and `reconcileConfigs` re-runs against the
-- republished version on the same boot. `pipeline_runs.spec_version_id` is a
-- plain column with no foreign key: past runs keep their history and are left
-- pointing at a version row that is gone, which is the state the column's own
-- "nullable on purpose … retired specs" note already describes.
--
-- `pipeline_specs.active_version_id` is likewise not a foreign key. It is left
-- dangling for exactly as long as it takes boot to republish and move the
-- pointer, which happens in the same startup that runs this file.
--
-- ⚠ This must not become a pattern (13 §12b). Once 0.6.0 ships, a changed type
-- or spec is a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:task/assemble'
AND "version" = 2;
--> statement-breakpoint
DELETE FROM "pipeline_spec_versions"
WHERE "id" IN (
	SELECT "v"."id"
	FROM "pipeline_spec_versions" "v"
	JOIN "pipeline_specs" "s" ON "s"."id" = "v"."spec_id"
	WHERE ("s"."slug" = 'core:spec/respond' AND "v"."semver" = '1.20.0')
	   OR ("s"."slug" = 'core:spec/narrate' AND "v"."semver" = '1.11.0')
);
