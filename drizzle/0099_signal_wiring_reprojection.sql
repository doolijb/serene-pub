-- Every declared control has an effect, and every effective control is declared.
--
-- An audit of the retrieval surface found that rule broken in both directions at
-- once. This file is the database half of the repair: six type declarations moved
-- in place, so the projected registry rows have to go and be rebuilt, and one
-- table the reconciler does not sweep has to be swept by hand.
--
-- ── What moved, and why each one moved ──────────────────────────────────────
--
--  1. `core:query/vector-search@1`
--
--     · `topK` defaulted to **12** and was read off `input?.topK` — an IN-PORT
--       name the node does not declare — so the number resolved through the
--       whole scope chain and reached nothing, while the binding ran on a
--       literal `?? 40`. It is read off `params` now and its default is **40**,
--       which is what every install has actually been searching at. Wiring a
--       control is not a licence to re-tune an install that never touched it.
--
--     · `minScore: 0.35` is **culled** and replaced by `similarityFalloff`. It
--       had no reader anywhere, and it could not simply be given one: a minimum
--       similarity removes a row from the pool, and a row out of the pool can no
--       longer be found by keyword, by name or by proximity either — one
--       mechanism's opinion disabling four others, which is the governing rule's
--       single prohibition. The replacement shapes the CONTRIBUTION instead
--       (`semantic = cos ** similarityFalloff`), leaves every row in the pool at
--       every setting, and defaults to 1 — the raw cosine, which is what has
--       been running while the floor sat unread.
--
--       ⚠ It is a shape rather than a number because cosine distributions are
--       not comparable across embedding models: 0.35 means "almost everything"
--       on one embedder and "almost nothing" on another, so an install that
--       changed model would silently change what its lorebook retrieves.
--
--  2. `core:task/rank-hybrid@1`
--
--     `signalRecency` and `signalSceneAffinity` are **culled**. Nothing has ever
--     written `signals.recency` or `signals.sceneAffinity` — no producer, on any
--     path, in any release — so both weights multiplied a permanent zero while
--     being declared, transposed, scored, persisted and rendered. Each needs a
--     design decision a wiring change is not entitled to make (which date orders
--     a dated entry; what scene a session is *in*), so the honest answer is to
--     remove the control rather than leave one that cannot move a prompt.
--
--     `signalDensity` stays, because it now has a producer: `keywordQuery`
--     writes `density` on every candidate, as it already wrote `proximity`.
--
--  3. `core:query/world-lore@1`, `core:query/character-lore@1`,
--     `core:query/history-entries@1`, `core:query/lorebook-triggers@1`
--
--     `guaranteedMessages` is **added**, defaulting to 10. This is the mirror
--     image of the dead controls: it was engine-read and declared NOWHERE, so
--     the only value it could ever hold was a constant nobody could reach — and
--     it is load-bearing, setting the presence window for character-lore
--     co-occurrence and the term-frequency window for tf-idf. 10 is what every
--     scan has silently run at, so declaring it changes nothing.
--
-- ── Why the registry rows are deleted ───────────────────────────────────────
--
-- Slot declarations are part of a type's content hash (13 §12b). On a database
-- that booted a previous build `syncTypeRegistry` would raise
-- `TypeRegistryConflictError`, `bootstrapPipelines` would catch it and return
-- early, and pipelines would silently stop working. Deleting the rows lets boot
-- re-project the current declarations. Same precedent and the same narrowness as
-- 0095: safe only while the 0.6 line is in preview and nothing outside this repo
-- has pinned these versions, and it must not become the habit.
--
-- ⚠ **No `pipeline_spec_versions` row is deleted here, and that is deliberate.**
-- 0095 deleted them because the SPEC DOCUMENTS had been edited in place, and
-- seeding is idempotent by version so a rewritten document would never reach an
-- already-seeded database. No document changed in this work — only type
-- declarations — so the published pipelines are still correct, and deleting them
-- would throw away author presets and per-subscription flags for nothing.
--
-- `pipeline_config_values` needs no statement either: `reconcileConfigs` runs on
-- every boot for every present spec, culls each address the re-projected
-- declaration no longer carries, and writes a `pipeline_config_notices` row
-- naming the control and its previous value. That is strictly better than a
-- DELETE here — the user is told what was removed and what it was set to.
DELETE FROM "pipeline_type_registry"
WHERE "version" = 1
AND "type_id" IN (
	'core:query/vector-search',
	'core:task/rank-hybrid',
	'core:query/world-lore',
	'core:query/character-lore',
	'core:query/history-entries',
	'core:query/lorebook-triggers'
);
--> statement-breakpoint
-- ── The table nothing sweeps ────────────────────────────────────────────────
--
-- `pipeline_node_overrides` is the session-scope layer, and it has no
-- reconciler: `reconcileConfigs` walks `pipeline_config_values` and nothing
-- walks this. A cull therefore leaves rows addressed at a control that no longer
-- exists — invisible, unreachable from any panel, and resurrected as a live
-- value the day somebody re-declares that name for a different purpose.
--
-- Scoped by the node's TYPE rather than by the path alone. `minScore` and
-- `signalRecency` are ordinary names and a plugin's own node is entitled to
-- declare either; what is stale is specifically an override addressed at one of
-- the two core types whose declaration just lost that field. The join goes
-- through the spec's ACTIVE version, which is the document those overrides are
-- addressed against.
DELETE FROM "pipeline_node_overrides" AS "o"
USING "pipeline_specs" AS "s", "pipeline_nodes" AS "n"
WHERE "o"."spec_id" = "s"."id"
AND "n"."spec_version_id" = "s"."active_version_id"
AND "n"."node_key" = "o"."node_key"
AND "n"."type_version" = 1
AND "o"."slot" = 'params'
AND (
	("n"."type_id" = 'core:query/vector-search' AND "o"."path" = 'minScore')
	OR (
		"n"."type_id" = 'core:task/rank-hybrid'
		AND "o"."path" IN ('signalRecency', 'signalSceneAffinity')
	)
);
