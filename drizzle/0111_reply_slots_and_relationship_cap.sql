-- Two more slots a spec declared and never named — one picker, one ceiling.
--
-- Both were found by `src/lib/server/pipelines/boot/paramsSlotWiring.test.ts`,
-- which walks every slot the type registry declares against every document
-- `seedCoreSpecs` builds and had seventeen of these written down in its ledger.
-- The seam is one loop of the executor: `resolveInput` walks the config keys
-- that are PRESENT, so a slot the spec never mentioned is not a key, nothing
-- resolves it, and the binding reads its value off an `undefined` — while
-- `config/panel/declarations.ts` renders one control per DECLARED slot, so the
-- panel shows it, the scope chain stores what a person sets, and the run never
-- reads it.
--
--  1. **`connection` and `sampling` on the reply step.** `respond`, `narrate`
--     and `narrate-character` all called `C.generateText.v1({ context, prompts })`
--     and named neither slot, so `refId(p.connection)` in `host.ts` read `null`,
--     `resolveCapabilityTarget` took that as "the pipeline chose nothing", and
--     the request went to the instance default. `host.ts`'s own comment says
--     omitting that forwarding "was why the panel's Connection and Sampling
--     pickers on the reply step did nothing" — the host half was fixed and the
--     spec half was not.
--
--  2. **`params` on the two relationship reads.** `respond`'s
--     `gather.relationshipsPerspectives.read` and `gather.relationshipsKnown.read`
--     named no `params` slot, so `bindings.ts` called
--     `capRelationships(section, undefined)` on every turn — and that function
--     reads `undefined` as no ceiling and returns the section whole.
--
-- ⚠ **The first one CHANGES what a run does, deliberately, and the second one
-- must not.** Ruling D-8 says no install changes behaviour as a side effect of
-- a wiring fix and that a newly-live declared default becomes today's effective
-- value. The two halves land on opposite sides of it:
--
--  · A Connection or Sampling pick on the reply step is something a PERSON
--    entered, expecting it to be used. Honouring it is the fix, not a retune —
--    the app owner already classes the current state as a defect
--    (STATE-2026-09-08 §1, "Per-node sampling ignored"). An install that never
--    set one is unaffected: `resolveSlot` falls back to
--    `world.activeConnection[kind]`, which `world.ts` projects from the very
--    `connection_defaults` row the `capabilityDefault` tier reads, and
--    `sessionOverride` still outranks `pipelineConfig` in `RESOLUTION_TIERS`.
--
--  · `maxEntries` was a SEEDED number nobody chose, and it said 12 while every
--    run was uncapped. So the declaration drops its default outright (statement
--    1) and the stored 12s go with it (statement 3). Uncapped is not expressible
--    as a number here: `0` already means the opposite (`capRelationships`
--    returns `null`, dropping the section — the off-switch convention this
--    package uses everywhere), a negative sentinel is what `capRelationships`
--    actually reads as "no cap" but `min: 0` forbids one and no other parameter
--    in the contracts uses a negative sentinel, and a large finite number is a
--    different value that is merely usually indistinguishable. An absent default
--    is the exact one: `resolveSlot`'s params branch copies a schema default only
--    `if (v?.default !== undefined)`, `reconcileConfigs` back-fills a row only
--    when a declaration carries one, and `NumberControl` already renders and
--    round-trips an empty box as "unset".
--
-- ── 1. The type registry ───────────────────────────────────────────────────
--
-- A parameter's default is part of a type's content hash (13 §12b), so dropping
-- it moves both relationship types' hashes. On a database that booted a previous
-- build `syncTypeRegistry` would raise `TypeRegistryConflictError`,
-- `bootstrapPipelines` would catch it and return early, and pipelines would
-- silently stop. Deleting the rows lets boot re-project the current declaration.
-- Precedent and terms: 0099, 0102, 0106 and 0110 — safe only while the 0.6 line
-- is in preview and nothing outside this repo has pinned these versions, and it
-- must not become the habit. Once 0.6.0 ships, a changed type is a new version,
-- never a rewrite of the row.
--
-- Only these two. `core:provider/generate-text@1` is untouched — naming a slot
-- is a change to the DOCUMENT, not to the declaration — so its hash has not
-- moved and its row must stay where it is.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" IN (
	'core:query/relationships-perspectives',
	'core:query/relationships-known'
)
AND "version" = 1;
--> statement-breakpoint
-- ── 2. The three published documents ───────────────────────────────────────
--
-- ⚠ **This is the half a fresh test database cannot see.**
--
-- The `generate` node in each of the three specs now wires
-- `connection: slot.connection()` and `sampling: slot.sampling()`, and
-- `respond`'s two relationship reads now wire `params: slot.params()`. Those are
-- edits to published documents under unchanged versions: the 0.6 pre-release
-- froze spec versions at a hard 1 until 0.7.0, so `1.20.0`, `1.11.0` and `1.0.0`
-- stay. Seeding matches on (slug, semver) and, on a match, updates only the
-- display name (`bootstrap.ts`: "spec publishing is idempotent by version"). The
-- rewired documents would therefore reach NO database that has already seeded —
-- every developer machine and every upgrading install — and would be invisible
-- on a fresh test database, where the rows do not exist and the edit publishes
-- normally. Deleting the version rows is what makes boot republish them.
--
-- Precedent and terms: 0095, 0100, 0102, 0106 and 0110. `pipeline_nodes`,
-- `pipeline_edges`, `pipeline_blocks`, `pipeline_includes`,
-- `pipeline_event_subscriptions` and `pipeline_presets` all cascade from
-- `pipeline_spec_versions`, so the old documents go cleanly. What is LOST with
-- them, stated rather than discovered: the author presets shipped with these
-- versions, and any per-subscription `enabled` flag somebody had turned off.
-- `pipeline_configs` hangs off `pipeline_specs`, not off a version, so tuned
-- configurations survive — including the Connection and Sampling picks this
-- change exists to make live — and `reconcileConfigs` re-runs against the
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
-- ── 3. The stored copy of the old declared default ─────────────────────────
--
-- `reconcileConfigs` back-fills an author default into `pipeline_config_values`
-- the first time it sees a declaration, and never revisits an address that still
-- exists. So every database that has booted holds a literal `12` for these two
-- controls — a ceiling no run has ever applied — and wiring the slot while
-- leaving those rows in place would cap every upgraded install's relationship
-- block at 12 as a side effect of a wiring fix. That is exactly what D-8
-- forbids.
--
-- Deleted rather than updated, following 0102 and 0110. Unlike those two the
-- absence is NOT back-filled again on the next boot — the corrected declaration
-- carries no default, so there is nothing to write — which is the point: the
-- address resolves to `undefined`, `capRelationships` returns the section whole,
-- and the control renders as the empty box that means "no ceiling". A row that
-- somehow escapes this statement is the one case that DOES change behaviour, so
-- `boot/relationshipsCapReprojection.int.test.ts` asserts "none left" per
-- address rather than counting.
--
-- ⚠ **The store cannot tell a seeded value from a hand-set one.**
-- `pipeline_config_values` carries `(config_id, node_key, slot, path, value)`
-- and no provenance: no author column, no timestamp, and a panel write to an
-- address leaves nothing behind that a later reader could distinguish from the
-- back-fill that created it. So this is scoped to rows holding **exactly the
-- previous declared default**. An admin who deliberately chose some other
-- number keeps it; one who deliberately typed 12 is indistinguishable from one
-- who never touched the control, and lands on uncapped — stated rather than
-- hidden, and the smaller error of the two, since uncapped is what their
-- pipeline was doing while the panel said 12.
--
-- Session-scoped overrides (`pipeline_node_overrides`, the only override scope
-- left) are deliberately untouched: a row there exists only because somebody
-- opened one session's settings and typed a number, so it is authored by
-- definition and there is no seeded value to lift.
--
-- Both node keys are `respond`'s alone — no other shipped spec has a
-- relationship read — and the `s.slug` predicate is kept anyway, on 0110's
-- terms: `maxEntries` is a parameter name shared with `entity-search`,
-- `vector-search` and `entity-link`, so the address is only unique because all
-- three predicates hold together.
--
-- `value` is `json`, which has no equality operator; compared as text, which for
-- a scalar JSON number is its digits.
DELETE FROM "pipeline_config_values" AS "cv"
USING "pipeline_configs" AS "c", "pipeline_specs" AS "s"
WHERE "cv"."config_id" = "c"."id"
AND "c"."spec_id" = "s"."id"
AND "s"."slug" = 'core:spec/respond'
AND "cv"."slot" = 'params'
AND "cv"."path" = 'maxEntries'
AND "cv"."value"::text = '12'
AND "cv"."node_key" IN (
	'gather.relationshipsPerspectives.read',
	'gather.relationshipsKnown.read'
);
