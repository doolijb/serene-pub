-- The transcript window becomes a control that does something.
--
-- `core:query/session-history@1` declares a `limit` parameter — "How many
-- recent messages are considered for the context" — and it reached nothing.
-- Two independent breaks, stacked, which is why one migration carries three
-- statements:
--
--  1. **The binding read the wrong address.** `runtime/bindings.ts` took
--     `limit: input?.limit ?? 100`. A declared parameter arrives at
--     `input.params.limit`; the top-level key is supplied by nothing, so every
--     run since this node existed has used the literal **100**.
--
--  2. **The specs never named the slot.** `respond`, `narrate` and
--     `narrate-character` all wired `C.sessionHistory.v1({ scope })` with no
--     `params: slot.params()`, and the executor resolves only the slots a
--     node's config names (`executor.ts: resolveInput`). So `input.params` was
--     `undefined` regardless of what the panel had stored. This is the third
--     time this exact omission has shipped — the three lore gather branches
--     (1.16.0/1.10.0) and the narrator's trigger query were the first two.
--
-- The panel meanwhile rendered the control, validated it, saved it, and
-- `reconcileConfigs` back-filled the declared default into
-- `pipeline_config_values` on every install. Renders, saves, reaches nothing:
-- the same defect `topK` had, closed on the same terms (ruling 2026-09-09).
--
-- ⚠ **The declared default moves 40 → 100, and that is the fix rather than a
-- retune.** 100 is the number every install has actually been reading at. Had
-- the wiring landed with 40 still declared, every install at defaults would
-- have had its transcript window cut to 40 messages as a side effect of a
-- typing correction. So the declaration is corrected to the effective value,
-- and moving the number is a separate decision made against the measure corpus.
--
-- ── 1. The type registry ───────────────────────────────────────────────────
--
-- A parameter's default is part of a type's content hash (13 §12b). On a
-- database that booted a previous build `syncTypeRegistry` would raise
-- `TypeRegistryConflictError`, `bootstrapPipelines` would catch it and return
-- early, and pipelines would silently stop. Deleting the row lets boot
-- re-project the current declaration. Precedent and terms: 0099, 0102 and 0106 —
-- safe only while the 0.6 line is in preview and nothing outside this repo has
-- pinned this version, and it must not become the habit. Once 0.6.0 ships, a
-- changed type is a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:query/session-history'
AND "version" = 1;
--> statement-breakpoint
-- ── 2. The three published documents ───────────────────────────────────────
--
-- ⚠ **This is the half a fresh test database cannot see.**
--
-- The `history` node in each of the three specs now wires
-- `params: slot.params()`. That is an edit to a published document under an
-- unchanged version: the 0.6 pre-release froze spec versions at a hard 1 until
-- 0.7.0, so `1.20.0`, `1.11.0` and `1.0.0` stay. Seeding matches on
-- (slug, semver) and, on a match, updates only the display name
-- (`bootstrap.ts`: "spec publishing is idempotent by version"). The rewired
-- documents would therefore reach NO database that has already seeded — every
-- developer machine and every upgrading install — and would be invisible on a
-- fresh test database, where the rows do not exist and the edit publishes
-- normally. Deleting the version rows is what makes boot republish them.
--
-- Precedent and terms: 0095, 0100, 0102 and 0106. `pipeline_nodes`,
-- `pipeline_edges`, `pipeline_blocks`, `pipeline_includes`,
-- `pipeline_event_subscriptions` and `pipeline_presets` all cascade from
-- `pipeline_spec_versions`, so the old documents go cleanly. What is LOST with
-- them, stated rather than discovered: the author presets shipped with these
-- versions, and any per-subscription `enabled` flag somebody had turned off.
-- `pipeline_configs` hangs off `pipeline_specs`, not off a version, so tuned
-- configurations survive — and `reconcileConfigs` re-runs against the
-- republished versions on the same boot.
-- `pipeline_specs.active_version_id` is not a foreign key; it dangles for
-- exactly as long as it takes boot to republish and move the pointer, in the
-- same startup that runs this file.
DELETE FROM "pipeline_spec_versions"
WHERE "id" IN (
	SELECT "v"."id"
	FROM "pipeline_spec_versions" "v"
	JOIN "pipeline_specs" "s" ON "s"."id" = "v"."spec_id"
	WHERE ("s"."slug" = 'core:spec/respond' AND "v"."semver" = '1.20.0')
	OR ("s"."slug" = 'core:spec/narrate' AND "v"."semver" = '1.11.0')
	OR ("s"."slug" = 'core:spec/narrate-character' AND "v"."semver" = '1.0.0')
);
--> statement-breakpoint
-- ── 3. The stored copy of the old default ──────────────────────────────────
--
-- `reconcileConfigs` back-fills an author default into `pipeline_config_values`
-- the first time it sees a declaration, and never revisits an address that still
-- exists. So every database that has booted holds a literal `40` for this
-- control — a number no run has ever used — and wiring the slot while leaving
-- that row in place would hand the newly-live control the very value the
-- declaration change exists to avoid: 100 messages before the upgrade, 40 after.
--
-- Deleted rather than updated, following 0102: the row's absence is back-filled
-- on the same boot from the corrected declaration, and the back-fill writes a
-- `pipeline_config_notices` row naming the control, so the change is reported
-- rather than silent. (A row that somehow escapes the back-fill is still safe —
-- `resolveSlot`'s `params` branch layers the config over the declared defaults,
-- so a missing address resolves to 100 either way.)
--
-- ⚠ **The store cannot tell a seeded value from a hand-set one.**
-- `pipeline_config_values` carries `(config_id, node_key, slot, path, value)`
-- and no provenance: no author column, no timestamp, and a panel write to an
-- address leaves nothing behind that a later reader could distinguish from the
-- back-fill that created it. So this is scoped to rows holding **exactly the
-- previous declared default**. An admin who deliberately chose some other
-- number keeps it; one who deliberately typed 40 is indistinguishable from one
-- who never touched the control, and lands on 100 — stated rather than hidden,
-- and the smaller error of the two, since 100 is what their pipeline was
-- reading at while the panel said 40.
--
-- Session-scoped overrides (`pipeline_node_overrides`, the only override scope
-- left) are deliberately untouched: a row there exists only because somebody
-- opened one session's settings and typed a number, so it is authored by
-- definition and there is no seeded value to lift.
--
-- `value` is `json`, which has no equality operator; compared as text, which for
-- a scalar JSON number is its digits.
DELETE FROM "pipeline_config_values" AS "cv"
USING "pipeline_configs" AS "c", "pipeline_specs" AS "s"
WHERE "cv"."config_id" = "c"."id"
AND "c"."spec_id" = "s"."id"
AND "cv"."slot" = 'params'
AND "cv"."path" = 'limit'
AND "cv"."value"::text = '40'
AND (
	("s"."slug" = 'core:spec/respond' AND "cv"."node_key" = 'gather.history.read')
	OR ("s"."slug" = 'core:spec/narrate' AND "cv"."node_key" = 'history')
	OR ("s"."slug" = 'core:spec/narrate-character' AND "cv"."node_key" = 'history')
);
