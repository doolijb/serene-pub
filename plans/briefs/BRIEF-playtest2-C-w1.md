# BRIEF playtest2-C-w1 — the two app-created local ONNX rows, and the generalised fold (server)

Lane `playtest2-C` (supervisor wrote this). Report: put your full report in your final hand-back (changed files, tests run with exact command and pass/fail counts, decisions, Noticed-not-done). You are a `lane-worker`.

## Goal
On every boot, `sync()` in `src/lib/server/db/defaults.ts` makes sure this pub has exactly one connection row of each local ONNX type, with a fixed name:
- `CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS` (`"local-onnx"`) → name **Local embeddings**
- `CONNECTION_TYPE.LOCAL_ONNX_NER` (`"local-onnx-ner"`) → name **Local named entities**

Owner rulings (2026-11-04, final): *"two rows, Local embeddings and Local named entities, undeletable (remove a model's files instead); extra hand-made rows fold into the kept one (the one a loadout names, else the oldest); fresh installs fill no loadout."* · *"the app creates the local ONNX rows, never fills a loadout with them (no-implicit-pickup stands)"* · one active per modality is a person's choice, so seeding never makes one the active/default one.

### 1. `src/lib/server/connections/connectionFold.ts` (new) — `foldConnectionInto(tx, source, target)`
Generalise steps 1–3 and 5 of `src/lib/server/connections/koboldCppManagedFold.ts` (`foldOne`, `referencesTo`) into one exported function: source's `connection_models` rows move to target (a model target already has — same `model` string — maps to target's row instead, and every FK into `connection_models.id` is repointed for those duplicates); every FK into `connections.id` repointed source → target (found by schema introspection, as now; the `connection_scripts` pair-uniqueness dedupe stays); every `pipeline_config_values` row with `slot = 'connection'` naming source rewritten to target + mapped model; then delete source. Signature: `foldConnectionInto(tx: Tx, source: SelectConnection-row, target: SelectConnection-row): Promise<void>`. No options parameter.
Then make `koboldCppManagedFold.ts` use it with **byte-identical behaviour**: its two KCPP-only parts stay in that file — (a) an image row's models become `image-gen`: do it as a pre-step inside the same transaction (`update connection_models set modality='image-gen' where connection_id = source.id` when `source.type === KOBOLDCPP_MANAGED_IMAGE`), then call `foldConnectionInto`; (b) step 4, the `extraJson.profile` carry-over onto target. Update both module headers (one sentence each) so the header says where the generic fold lives. `koboldCppManagedFold.int.test.ts` must stay green unchanged.

### 2. `src/lib/server/connections/localOnnxConnections.ts` (new) — `ensureLocalOnnxConnections(db)`
- Export `LOCAL_ONNX_CONNECTION_NAME: Readonly<Record<string, string>>` = `{ [LOCAL_ONNX_EMBEDDINGS]: "Local embeddings", [LOCAL_ONNX_NER]: "Local named entities" }` (the one place the two names are spelled; lane C's next worker reads it for the socket guards).
- `ensureLocalOnnxConnections(db: Db): Promise<{ created: number; folded: number; renamed: number }>`:
  1. `await localOnnxAvailability()` (`$lib/server/localModels/onnxRuntime`); when `!available`, return zeros and touch nothing (an unavailable machine gets no rows; older rows stay as they are).
  2. Per type: rows of that type ordered by `id`. The **kept** row = the first row whose id appears in `loadouts.connection_id`, else the oldest. Fold every other row into it, **each in its own `db.transaction(async (tx) => foldConnectionInto(tx, source, kept))`**; on a throw, log (as the KCPP fold does) and leave that row.
  3. No row of the type: insert one directly, the way `ensureManagedKoboldCppEndpoint` (`src/lib/server/koboldcpp/managedEndpoint.ts:76-97`) does: `{ ...CONNECTION_DEFAULTS[type], type, modality: CONNECTION_DEFAULTS[type].modality, name: <fixed name>, extraJson: {...} }`, drop the `model` key (connections have no model column — see how `connections:create` strips it), and `capabilities = { resolved: resolveConnectionCapabilities(data) }`. **No `id`** (never seed a fixed id).
  4. Kept row whose `name` is not exactly the fixed name: update `name` only.
  5. Never write `loadouts`, `connection_defaults`, `user_settings` or any default/star (the fold's FK repoint is the only thing that may touch a loadout's `connection_id`, and only from a folded row to the kept one).
  6. Idempotent: a settled install writes nothing.
- Module header: purpose, the rulings above quoted with date, why it matches on TYPE (one row per type after the fold — the managed KoboldCPP precedent, `managedEndpoint.ts:11-13`) and not on `id`.

### 3. `src/lib/server/db/defaults.ts`
- Call `ensureLocalOnnxConnections(db)` in its own `try { … } catch` block placed **after** the system-settings block (the one that runs `seedCoreLoadouts` / `moveConnectionDefaultsToLoadouts` / the `SEEDED_SAMPLING_DEFAULTS` loop, ending at `console.error("Error syncing system settings:", error)`) and before the ollama-settings block, so an upgraded install's moved defaults count as "a loadout names it". Log one line when anything changed, like the KCPP fold's: `[connections] Local ONNX connections: created N, folded N, renamed N.` Comment: why here (after the loadouts move), `db` passed in for the packaged-build reason given above.
- Do NOT touch the ★47 lines (`"text->text": "sampling-reply"` and its comment) or anything else in the sampling/loadout blocks.
- Amend the comment at the line reading `// **Sampling defaults may be seeded; connection defaults NEVER.** That is` … `// a person can add — so a capability with no connection must read as "not` once: keep the rule (no connection DEFAULT is ever seeded), and correct the claim "a connection is a thing only a person can add" to say the app adds its own rows — the managed KoboldCPP and audio.cpp endpoints and the two local ONNX rows (`ensureLocalOnnxConnections`, below) — and still never points a default or a loadout at one. Two or three comment lines, no more. Quote the before and after lines in your report.

### 4. Tests
- New `src/lib/server/connections/localOnnxConnections.int.test.ts` (createTestDb per test, `beforeEach` 60 s timeout; `vi.mock("$lib/server/localModels/onnxRuntime", …)` so availability is controlled, never a real transformers import): fresh DB → exactly two rows, the fixed names, right types/modalities, `capabilities.resolved` non-empty; no `loadouts` row has a `connection_id` of either; no `connection_defaults` row names either; second call → zero counts and every connections row byte-identical (`toEqual` before/after); unavailable → zero rows; an existing hand-made `local-onnx` row named "My embeddings" is adopted (same id, renamed); **two hand-made rows of one type, the newer one named by a loadout** (`loadouts.connection_id`) and a pipeline Connection slot (`setConfigValue` from `$lib/server/utils/testDb`, see `koboldCppManagedFold.int.test.ts` for the pattern) naming the older → one row left, it is the loadout-named one, the slot now names it, the loadout still names it, a model on both maps to the kept row's model id; and "no loadout names either" → the oldest is kept.
- A focused unit/int test for `foldConnectionInto` itself is covered by the above plus the unchanged KCPP fold test; don't add a third.
- `src/lib/server/db/defaults.seedKey.int.test.ts`: add one `describe` block (mock `onnxRuntime` available at file top with `vi.mock`, hoisted) — after `sync()` twice there is exactly one row of each type with the fixed name, and the second `sync()` changed no connections row. Do not alter existing cases.
- Blast radius: `grep -rl "db/defaults\"\|defaults\")).sync" src --include=*.test.ts`, then within those files grep for assertions on `schema.connections` / connection counts. Run every such file that asserts on connections (and `src/lib/server/attic/fresh.int.test.ts`, `src/lib/server/attic/upgrade.faithful.int.test.ts`). If one fails because two new rows now exist, fix the TEST minimally (mock availability off in that file, or filter by type) and say which and why. Note how long a `sync()`-calling file takes before vs after if a real `@huggingface/transformers` import now happens in it.

## Files owned (edit only these)
`src/lib/server/connections/connectionFold.ts` (new), `src/lib/server/connections/localOnnxConnections.ts` (new), `src/lib/server/connections/localOnnxConnections.int.test.ts` (new), `src/lib/server/connections/koboldCppManagedFold.ts`, `src/lib/server/db/defaults.ts` (only the new block + the one comment), `src/lib/server/db/defaults.seedKey.int.test.ts`, and minimal test-only fixes in sync()-calling test files you list.

## Files readable
Everything. Read before writing: `koboldCppManagedFold.ts` whole, `koboldcpp/managedEndpoint.ts:1-97`, `defaults.ts:1-50` (header) and `:600-760`, `shared/utils/connectionDefaults.ts:220-272`, `connections/resolve.ts` (`resolveConnectionCapabilities`), `db/schema.ts:532-645` (connections) and the `loadouts` table (`schema.ts:1091+`), `sockets/connections.ts:479-600` (create: how `model` is stripped).

## Out of scope (never build)
Filling any loadout; setting any default or star; a third row; a `seed_key` column or any schema change / migration (none — stop and report if you think one is needed); renaming types; socket handler guards (delete/rename/create — the next worker's); the ONNX list fetch gate; any client file; docs; `NOMENCLATURE.md`; `STYLE-GUIDE.md`. Never touch `serene-pub-sdk/core-catalog/src/loadouts.ts` or `src/lib/server/loadouts/seed.ts`.

## Stop and ask when
A schema change seems needed; a test outside the list needs a non-trivial change; any new user-facing string beyond the two names and the log line; CLAUDE.md §Decisions applies.

## Rules you work under (quoted from CLAUDE.md and the lead)
- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."*
- *"Never seed a row at a hardcoded id."* / defaults.ts header: *"ADDING A NEW DEFAULT: give it a `seedKey` and **no `id`** — let the sequence assign one."* (connections has no `seed_key` column; this lane matches on type, one row per type, and the supervisor raises that as a ★.)
- *"Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."*
- *"0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."*
- **P1:** a new automatic behaviour is off in core until a genre opts in, and every automatic action shows its cause — this one is ruled by the owner (the app creates the rows); the boot log line is its record.
- Another programme and lane S2 are building in the same trees: **re-read every file immediately before editing it; use Edit, never Write, on an existing file.**
- Tests: run only your files. Command (n = 1, 2, …):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-C-w1-<n>.log 2>&1; echo exit=$?'` then read the log (tail/grep). **Never pipe vitest into `head`.** An int test that opens a DB inside an `it`/`beforeEach` gets a 60 s timeout.
- Never a full `npm test`, `npm run check`, or project-wide `tsc`. You may run `npx prettier --check <file>` on your files.

## Verbatim from the guide
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should need no sdk:build.)

## Done means
Green: `src/lib/server/connections/localOnnxConnections.int.test.ts`, `src/lib/server/connections/koboldCppManagedFold.int.test.ts`, `src/lib/server/db/defaults.seedKey.int.test.ts`, plus every sync()-calling file you found asserting on connections. Report each with pass/fail counts.
