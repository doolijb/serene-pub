-- The narrator splits in two, and the world narrator finally gets retrieval.
--
-- Two facts, one cause: `core:spec/narrate` was doing two jobs badly. Its
-- shipped prompt says "you only narrate the environment, not {{characterNames}}"
-- while the button's own modal offered "or any side characters and encounters"
-- as a use for it — so the thing people most often wanted from the narrator, a
-- shopkeeper answering back, was reachable only by asking a pipeline configured
-- to refuse it. And the retrieval half was worse than unhelpful: the document
-- wired the keyword mechanism and the ranker and NOTHING else, so a user who
-- turned on "find entries by meaning" or "find entries by name" got no change at
-- all in narrator mode, with nothing anywhere saying so.
--
-- ── What this file has to do, and what it deliberately does not ─────────────
--
-- `core:spec/narrate-character` is a NEW spec. New specs need no help here:
-- `seedCoreSpecs` publishes a slug it has never seen, and its type declarations
-- (`core:input/side-character-turn@1`,
-- `core:task/build-side-character-context@1`) are new rows the registry sync
-- projects on the next boot. Nothing to delete, nothing to re-project.
--
-- ⚠ **`core:spec/narrate` is the half that needs a statement, and it is the
-- half a fresh test database cannot see.**
--
-- Its version does NOT move — the 0.6 pre-release froze SDK spec versions at a
-- hard 1 until 0.7.0 — so the retrieval wiring is an edit in place under
-- `1.11.0`. Seeding matches on `(slug, semver)` and, on a match, updates only
-- the display name (`bootstrap.ts`: "spec publishing is idempotent by version").
-- So the rewired document would reach NO database that has already seeded —
-- every developer machine and every upgrading install — and would be invisible
-- on a fresh test database, where the row does not exist and the edit publishes
-- normally. Deleting the version row is what makes boot republish it.
--
-- Precedent and terms: `0095_prompt_format_reprojection`, which did exactly this
-- for the same pin. `pipeline_nodes`, `pipeline_edges`, `pipeline_blocks`,
-- `pipeline_includes`, `pipeline_event_subscriptions` and `pipeline_presets` all
-- cascade from `pipeline_spec_versions`, so the old document goes cleanly. What
-- is LOST with it, stated rather than discovered: the author presets shipped
-- with this version, and any per-subscription `enabled` flag somebody had turned
-- off. `pipeline_configs` hangs off `pipeline_specs`, not off a version, so
-- tuned configurations survive — and `reconcileConfigs` re-runs against the
-- republished version on the same boot, which is what back-fills the new nodes'
-- declarations and records a notice for anything the reshape culled.
-- `pipeline_specs.active_version_id` is not a foreign key; it dangles for
-- exactly as long as it takes boot to republish and move the pointer, in the
-- same startup that runs this file.
--
-- ⚠ No `pipeline_type_registry` row is deleted here, and that is deliberate. No
-- existing type declaration moved — the two new ones are additions, which the
-- sync projects without conflict. Deleting rows that did not change would throw
-- away nothing and prove nothing.
--
-- ⚠ This must not become a pattern (13 §12b). Once 0.6.0 ships, a changed type
-- or spec is a new version, never a rewrite of the row.
DELETE FROM "pipeline_spec_versions"
WHERE "id" IN (
	SELECT "v"."id"
	FROM "pipeline_spec_versions" "v"
	JOIN "pipeline_specs" "s" ON "s"."id" = "v"."spec_id"
	WHERE "s"."slug" = 'core:spec/narrate' AND "v"."semver" = '1.11.0'
);
