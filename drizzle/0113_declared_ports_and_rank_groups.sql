-- Six ports that were being used and never declared, and one that was
-- published and never wired.
--
-- Two rulings, one re-projection, because they land on the same six types and
-- the same three documents and splitting them would mean deleting the same rows
-- twice.
--
--  · **D-I — declare what is already supplied.** `bindingTypes.ts` names a
--    population it calls `Supplied`: a key a handler really receives that the
--    contract declares no port for. Every one of them is a *finding* — the read
--    is correct, the value arrives, and nothing anywhere says the port exists.
--    There were seven, and the cost of that is exact rather than tidiness:
--    `validate.ts` skips its shape check when either end of an edge is
--    undeclared (`if (!outShape || !inShape) continue`), so a plugin wiring the
--    wrong shape into one of these got no finding, and a plugin *implementing*
--    one of these types had nothing to read to learn the port was there.
--
--      - `core:task/assemble@2` — `decisions` and `messages`. Both wired by all
--        three shipped specs, and the binding halts without `decisions`; the
--        most load-bearing inputs the node has were the two it did not declare.
--      - `core:task/build-template-context@1` — `relationshipsPerspectives` and
--        `relationshipsKnown`, wired by `respond`; `speakerName` and
--        `speakerCharacter`, supplied by `bindings.ts`'s own side-character
--        wrapper, which unwraps its `speaker` port and calls THIS type's
--        handler with the name and the card spread on. That last pair is the
--        case the declaration exists for: the supplier is a sibling binding
--        rather than a document, so the ports are the only record that this
--        type's input surface is wider than its edges.
--      - `core:provider/summarize-batch@1`, `summarize-synth@1` and
--        `name-entry@1` — `loreType`. **A port, not a parameter**, and the call
--        site is what settles it: `summarizeSpec` writes it as a literal into
--        the node's config, in the same map as `batch` and `request`, and
--        `resolveInput` passes a non-ref config value through untouched, so the
--        binding reads `input.loreType` exactly the way it reads a port. A
--        `params` field would have moved the read to `input.params.loreType`
--        and put the control in the panel, layered and tunable — which the
--        catalog's own `SummarizeShape` rules out in as many words: it is "the
--        thing that distinguishes the four namespaces from one another", and a
--        user changing it "would turn their scene summarizer into a world
--        summarizer without renaming anything".
--
--  · **D-H — wire `rank-hybrid.groups` into `assemble.groups`.** `select()`
--    returns what each retrieval band was allotted, what it spent and how many
--    entries it got there; the binding has always published it; `allocate` has
--    always taken its own `?? {}` branch instead. Two adjacent nodes, one
--    computing exactly what the other needed, with no edge between them —
--    because neither port was declared, so neither side could see the other.
--
-- ⚠ **Neither ruling moves a prompt, and that is checkable rather than hoped
-- for.** `allocate` copies `groups` onto `AllocatedContext.groups` and reads it
-- nowhere else, so `blocks`, `totalTokens` and `budget` — everything `render`
-- walks — are the same bytes with the edge or without it. The parity corpus is
-- the evidence: all sixteen goldens are byte-identical across this change. What
-- fills in is the RECEIPT — `dispatch.ts` publishes `payload.groups` as the
-- run's `sources`, which is the budget panel's entire data set and has been an
-- empty object on every run ever recorded. The six declarations move nothing at
-- all: a declared port that was already being read resolves to the same value it
-- always did.
--
-- ── 1. The six type declarations ───────────────────────────────────────────
--
-- A type's `ports` are in its content hash (13 §12b), so declaring one moves it.
-- On a database that booted a previous build `syncTypeRegistry` would raise
-- `TypeRegistryConflictError`, `bootstrapPipelines` would catch it and return
-- early, and pipelines would silently stop. Deleting the rows lets boot
-- re-project the current declaration.
--
-- Precedent and terms: 0099, 0102, 0106, 0110 and 0111 — safe only while the 0.6
-- line is in preview and nothing outside this repo has pinned these versions,
-- and it must not become the habit. Once 0.6.0 ships, a changed type is a new
-- version, never a rewrite of the row.
--
-- ⚠ `assemble` is at version **2** and the other five at 1, so the predicate is
-- a row constructor rather than 0111's `AND "version" = 1`. Written out per type
-- because a shared `version` clause is how five of these get deleted and the
-- sixth silently does not.
--
-- Only these six. The other rankers do NOT gain `groups`: `rank-by-recency` and
-- the `rank-recall` plugin example compute no per-band usage, and giving them a
-- port they cannot fill would move two more hashes to declare a promise neither
-- keeps (S3, the argument `rank-hybrid`'s own `scripts` hook is spread on this
-- type alone for). `build-narrator-context@1` likewise keeps the shared
-- `contextPorts` untouched — its docblock says the narrate spec never supplies
-- the relationship reads because graph context needs a speaker's perspective and
-- a narrator has none.
--
-- ⚠ **`lorebook_entries_type_fk` points at `(type_id, version)` here.** Nothing
-- can be referencing these rows: that key is how an entry row names its ENTRY
-- type, and all six of these are tasks and providers. Stated rather than
-- discovered, because six rows is enough that "it was fine last time" stops
-- being a reason.
DELETE FROM "pipeline_type_registry"
WHERE ("type_id", "version") IN (
	('core:task/assemble', 2),
	('core:task/build-template-context', 1),
	('core:task/rank-hybrid', 1),
	('core:provider/summarize-batch', 1),
	('core:provider/summarize-synth', 1),
	('core:provider/name-entry', 1)
);
--> statement-breakpoint
-- ── 2. The three published documents ───────────────────────────────────────
--
-- ⚠ **The half a fresh test database cannot see.**
--
-- The `prompt` node in each of the three specs now wires `groups: $.rank.groups`.
-- That is an edit to a published document under an unchanged version: the 0.6
-- pre-release froze spec versions at a hard 1 until 0.7.0, so `1.20.0`, `1.11.0`
-- and `1.0.0` stay. Seeding matches on (slug, semver) and, on a match, updates
-- only the display name (`bootstrap.ts`: "spec publishing is idempotent by
-- version"). The rewired documents would therefore reach NO database that has
-- already seeded — every developer machine and every upgrading install — and
-- would be invisible on a fresh test database, where the rows do not exist and
-- the edit publishes normally. Deleting the version rows is what makes boot
-- republish them.
--
-- The same three pins 0111 named, and for the same structural reason: the
-- reply-shaped specs are the ones with a ranker and an assembler. The six
-- declarations in statement 1 need nothing here — declaring a port is a change
-- to the DECLARATION, not to any document, so the summarize specs' documents
-- have not moved and their versions must stay where they are.
--
-- Precedent and terms: 0095, 0100, 0102, 0106, 0110 and 0111. `pipeline_nodes`,
-- `pipeline_edges`, `pipeline_blocks`, `pipeline_includes`,
-- `pipeline_event_subscriptions` and `pipeline_presets` all cascade from
-- `pipeline_spec_versions`, so the old documents go cleanly. What is LOST with
-- them, stated rather than discovered: the author presets shipped with these
-- versions, and any per-subscription `enabled` flag somebody had turned off.
-- `pipeline_configs` hangs off `pipeline_specs`, not off a version, so tuned
-- configurations survive — including the Connection and Sampling picks 0111
-- exists to have made live — and `reconcileConfigs` re-runs against the
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
-- ── 3. There is no third statement, and its absence is the ruling ──────────
--
-- 0110 and 0111 both ended with a sweep of `pipeline_config_values`, because
-- both moved a declared PARAMETER: `reconcileConfigs` back-fills an author
-- default the first time it sees a declaration and never revisits an address
-- that still exists, so a stored copy of the old number outlives the
-- declaration that wrote it and would be applied as if somebody had chosen it.
--
-- Nothing here moves a parameter. A port is not a configurable surface: it has
-- no default, `reconcileConfigs` never writes a row for one, and the panel
-- renders a control per declared SLOT. So there is no stored copy of anything to
-- clear, and a sweep would only be a DELETE looking for rows that cannot exist.
--
-- ⚠ The same goes for `registrySync.ts`'s display set, which widened to the
-- SDK's `DESCRIPTOR_DISPLAY_KEYS` in this change so that core and the SDK stop
-- answering "is this the same content?" two different ways. It contributes **no
-- rows to this file**, and that was verified rather than assumed: across all 91
-- published types there is no `label` key anywhere inside `slots`, `entryShape`
-- or `configSchema`, so every hash is identical before and after. The
-- disagreement was latent — it would have fired the first time anyone renamed a
-- parameter, as a boot-time conflict that stops pipelines on every install — and
-- closing it while nothing carries the word is what makes this the cheap moment
-- rather than the expensive one.
--
-- Recorded here because a reader who finds the strip in the same commit will
-- reasonably expect rows for it, and "there are none" is a finding, not an
-- omission.
--
-- ⚠ Written as a trailing comment on statement 2 rather than as a third
-- statement-breakpoint. A block that only documents its own absence still has
-- to be a legal statement to survive the split, and a `SELECT 1;` shipped in a
-- migration reads as a leftover to the next person rather than as a ruling.
