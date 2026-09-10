-- The summarize batch size becomes a real control, clamped to the real window.
--
-- `core:task/batch-messages@1` decides how much chat one draft is written
-- against. Three things were wrong with that decision and all three are fixed in
-- the declaration, which is why this file exists at all.
--
--  1. **The declared size did not mean what it said.** `batchTokens` is
--     documented as "how many tokens of chat each summarizing batch holds", and
--     the binding computed `Math.max(batchTokens - 1500, 500)` — so an admin
--     asking for 2048 tokens of chat received 548. The 1500 is real (a batch
--     prompt is the chat plus its template plus room for the draft written
--     back), but it is a reserve to be accounted for, not a tax on the number a
--     person typed.
--
--  2. **Nothing clamped it.** The binding never read a sampling config at all,
--     so a batch size above the model's context window produced a prompt the
--     model could not hold — and unlike the assembled session context there is
--     no truncation anywhere on this path to catch it: `compilePrompt` returns
--     early on an injected prompt, so `getContextTokenLimit()` never supersedes
--     the batch. `core:task/batch-messages@1` gains a `sampling` slot for this,
--     the same shape and the same argument as `core:task/context-budget@1`.
--
--  3. **The default was a number nobody chose.** 2048 minus the reserve is 548
--     tokens of chat per draft, which is a handful of messages. 0.5 batched at
--     `4096 - 1500 = 2596`; the new default of **2560** is that same quality
--     point at a round 2.5 Ki, so what people have actually been getting is what
--     they keep getting.
--
--     ⚠ Deliberately NOT a fraction of the available window. Long-context models
--     degrade in the middle, so this is a quality knob and the window is only
--     ever a ceiling on it — nothing here scales the batch up to fill 128k.
--
-- ── Why the registry row is deleted ────────────────────────────────────────
--
-- Slot declarations are part of a type's content hash (13 §12b), and this one
-- gained a slot and changed a default. On a database that booted a previous
-- build `syncTypeRegistry` would raise `TypeRegistryConflictError`,
-- `bootstrapPipelines` would catch it and return early, and pipelines would
-- silently stop working. Deleting the row lets boot re-project the current
-- declaration. Precedent and terms: 0099 and 0106 — safe only while the 0.6 line
-- is in preview and nothing outside this repo has pinned this version, and it
-- must not become the habit.
DELETE FROM "pipeline_type_registry"
WHERE "version" = 1
AND "type_id" = 'core:task/batch-messages';
--> statement-breakpoint
-- ── Why the four spec versions are deleted ─────────────────────────────────
--
-- ⚠ **This is the half a fresh test database cannot see.**
--
-- The clamp needs a window, and the window has to be the one the *drafting* step
-- generates against — a batch cut against one config and drafted against another
-- overflows silently, which is the failure being fixed rather than a new one to
-- introduce. So the four summarize documents now wire the batching Task's
-- `sampling` slot as a REFERENCE to `drafting.item.draft`'s
-- (`slot.samplingOf(...)`), which makes it one shared control rather than a
-- second picker free to disagree.
--
-- That is an edit to a published document under an unchanged version: the 0.6
-- pre-release froze spec versions at a hard 1 until 0.7.0, so `1.3.0` stays.
-- Seeding matches on `(slug, semver)` and, on a match, updates only the display
-- name (`bootstrap.ts`: "spec publishing is idempotent by version"). The rewired
-- documents would therefore reach NO database that has already seeded — every
-- developer machine and every upgrading install — and would be invisible on a
-- fresh test database, where the rows do not exist and the edit publishes
-- normally. Deleting the version rows is what makes boot republish them.
--
-- Precedent and terms: `0095_prompt_format_reprojection` and
-- `0100_narration_split_reprojection`, which did exactly this for the same pin.
-- `pipeline_nodes`, `pipeline_edges`, `pipeline_blocks`, `pipeline_includes`,
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
	WHERE "v"."semver" = '1.3.0'
	AND "s"."slug" IN (
		'core:spec/summarize-world',
		'core:spec/summarize-character',
		'core:spec/summarize-scene',
		'core:spec/summarize-history'
	)
);
--> statement-breakpoint
-- ── The stored copy of the old default ─────────────────────────────────────
--
-- `reconcileConfigs` back-fills an author default into `pipeline_config_values`
-- the first time it sees a declaration, and never revisits an address that still
-- exists. So every database that has booted holds a literal `2048` for this
-- control, and changing the declared default alone would leave it running the
-- old number while the code says otherwise — the panel agreeing with the user
-- and the run doing something else, which is the defect class `config.ts` was
-- written to end.
--
-- Scoped to rows still holding **exactly the previous author default**. An admin
-- who deliberately raised or lowered the batch size keeps their value; one who
-- deliberately typed the old default is indistinguishable from one who never
-- touched it, and lands on 2560 — stated rather than hidden, and the smaller
-- error of the two. `reconcileConfigs` back-fills the new default on the same
-- boot and writes a `pipeline_config_notices` row naming the control, so the
-- change is reported rather than silent.
--
-- `value` is `json`, which has no equality operator; compared as text, which for
-- a scalar JSON number is its digits.
DELETE FROM "pipeline_config_values" AS "cv"
USING "pipeline_configs" AS "c", "pipeline_specs" AS "s"
WHERE "cv"."config_id" = "c"."id"
AND "c"."spec_id" = "s"."id"
AND "s"."slug" IN (
	'core:spec/summarize-world',
	'core:spec/summarize-character',
	'core:spec/summarize-scene',
	'core:spec/summarize-history'
)
AND "cv"."node_key" = 'batches'
AND "cv"."slot" = 'params'
AND "cv"."path" = 'batchTokens'
AND "cv"."value"::text = '2048';
