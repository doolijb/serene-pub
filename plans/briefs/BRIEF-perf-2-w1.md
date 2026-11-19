# BRIEF — perf-2 worker w1 — `buildWorld`'s variable-template reads: one batched read per build

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-2`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: the SDK does not change. Run no git command that changes the index or the working tree: no add, reset, checkout, restore, stash, commit.)

## Goal

`buildWorld` (`src/lib/server/pipelines/config/world.ts`, the variable-layout block ~lines 1243–1427 inside
`applyPipelineLayer`) reads `pipeline_variable_templates` about four times per variable on every build. Measured
today (Story reply, second world): 77 × `pubLayoutOf` (`entities/variableTemplates.ts:98`), 77 ×
`resolveVariableTemplate` (`:226`, via `registrations/values.ts` `layoutOfValue` from `derefLayout`), 77 ×
`isAutomatic` (world.ts ~1293), 72 + 5 × `defaultVariableTemplateFor` (`boot/seedVariableTemplates.ts:298/311`).
Replace them with **one read per build** — when `variableKeys` is non-empty — and answer every lookup of that
block in memory, with **exactly the same results, precedence and order**.

## The batched read

One `db.select().from(schema.pipelineVariableTemplates).where(or(inArray(variableId, Vs), inArray(seedKey,
seedKeys))).orderBy(asc(id))` where `Vs` = the distinct `variableId`s of `variableKeys`, and `seedKeys` = for each
V the speech seed key (`SHIPPED_SPEECH_VARIABLE_LAYOUTS.find(t => t.variableId === V)?.seedKey`) and the shipped
default's `seedKeyFor(shipped)` (`SHIPPED_VARIABLE_TEMPLATES.find(t => t.variableId === V && t.isDefault)`) — see
`defaultVariableTemplateFor` for both; omit `inArray(seedKey, …)` when there are none. (Check the exact export
names and where `seedKeyFor` lives; import them, never copy their values.)

Then, in memory over those rows, the same rule as each helper it replaces — read each one before you write its
twin:
- `layoutByReference(db, V, ref)` → the row with `variableId === V`, `reference === ref`, `withdrawnAt == null`;
  its id or null. (Unique index `(variable_id, reference)`, so at most one.)
- `pubLayoutOf(db, V)` → `variableId === V`, `pubDefault === true`, `withdrawnAt == null` (partial unique index).
- `defaultVariableTemplateFor(db, V)` → the speech seed row's id if that row exists (any variable, as today);
  else the shipped default's seed row's id if it exists; else the first row by id with `variableId === V`,
  `withdrawnAt == null` and `!isForeignPackageRow(r, V)` (import `isForeignPackageRow`).
- `derefLayout(id, V)` for these lookups (= `layoutOfValue`: not a number → undefined; no row → undefined;
  `row.variableId !== V` → undefined; else `resolveVariableTemplate`'s mapped object `{ variableId, engine ??
  CORE_TEMPLATE_ENGINE, source ?? "", name, origin }`, `origin` exactly as that function computes it). A row
  absent from the batch either does not exist or belongs to another variable, so it answers undefined — the
  same as today, since every caller here passes V. This holds for the `authored` ids too.
- `isAutomatic(V, id)` → `isAutomaticRow(fullRow, getVariable(V))` on the batch row (only reached when
  `derefLayout` returned a row, so the row is in the batch).
- `referencedLayoutOf(db, V, reference)` (`entities/variableLayouts.ts:1474`) → `layoutByReference` + the mapped
  row + the variable check, answered from the batch, returning `{ engine, source, name, origin }` as it does.

Keep the per-variable `cache` / `defaults` / `referenced` memo structure and the order of `push(...)` calls
exactly as they are. `presetVariableLayoutsOf`, the session's `presetId` read and `declaredVariableLayouts` stay
as they are (one each per build). Touch nothing else in `world.ts` (not `derefLeftover`, not the registration
reads, not `danglingPresetLayouts`), and no other source file.

**Put the in-memory lookups in one small exported pure function in `world.ts`** (e.g. it takes the batch rows and
returns `{ byReference, pub, defaultFor, layoutOf, automatic, referenced }`; your choice of names, internal only,
no user-facing word), with a doc comment in the house style naming each DB helper it mirrors ("the same rule as
`pubLayoutOf`, in memory over this build's rows"), so the parity test below can pin it to those helpers. The DB
helpers stay as they are: other callers use them.

## Prove it (in this order)

1. **Before editing**, write a scratch test `src/lib/server/pipelines/config/perf2w1scratch.int.test.ts` (deleted
   when you are done) that, on a fresh test DB, builds the world (`buildWorld(db, { sessionId, specId })`) for a
   session of **every shipped genre** and each spec that genre registers (see
   `src/lib/server/sockets/sessions.genreParity.int.test.ts` for how sessions of each shipped genre are made),
   plus one session whose preset has a layout for a variable that also has a pub-wide layout (see
   `src/lib/server/pipelines/config/variableResolution.int.test.ts` "the preset's variable layout beats the
   pub's" for fixtures), and writes each world as stable JSON (Maps as sorted entries) to
   `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/perf2/w1-before/`.
   Run it. Then make the change, run it again into `w1-after/`, and `diff -r` the two: **must be identical**.
   Also count, in the scratch test, `pipeline_variable_templates` statements per build before and after (wrap
   `db.$client.query` as `unknownEntries.reply.int.test.ts` `reply()` ~line 184 does).
2. **Permanent tests**, added to `src/lib/server/pipelines/config/variableResolution.int.test.ts` (a new
   `describe`, its existing cases untouched):
   - one build issues **exactly one** statement on `pipeline_variable_templates` from this block (count by SQL
     text containing `pipeline_variable_templates`; if other parts of `buildWorld` also read the table, assert
     the exact before→after numbers you measured instead and say why);
   - the precedence still holds through the batch: preset layout and pub layout for the same variable → the
     preset's row with reason `preset`; pub only → `pub`; neither → the default with `automatic`/`default` as
     before (reuse the file's fixtures);
   - **parity of the pure function with the DB helpers**: for every variable that has rows in the seeded DB, plus
     fixtures with a withdrawn row, a foreign package row and a preset reference, each in-memory answer equals
     the DB helper's (`pubLayoutOf`, `layoutByReference`, `defaultVariableTemplateFor`, `resolveVariableTemplate`
     + variable check, `isAutomaticRow`, `referencedLayoutOf`).
   `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })` if the file opens a DB per test.

## Rules (quoted from the lane's contract)

- "No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical …; what any read
  returns, the order of writes and what every socket push carries are unchanged. No caching across runs."
  (The batch lives for one build only: never a module-level cache.)
- "One batched read (`IN (…)`) per build, results distributed in memory; same rows, same precedence, same order."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
  (`buildWorld` reads on the `db` it is handed; keep it so.)
- CLAUDE.md: "Before introducing any name — table, column, type id, prop, UI label, error string — read
  NOMENCLATURE §1 and §24." This change introduces no user-facing name; local and exported helper names are
  internal. "It is a **session**, never a *chat*."
- CLAUDE.md: "Never `kill -9` the dev server." "`$state(new Set())` …" does not apply (server code).
- `world.ts` is already not prettier-clean: run `npx prettier --check` and report, **never `--write`**; write
  new lines in the house style (tabs, double quotes, no semicolons) and do not reformat lines you don't change.
- Do not move code, rename anything, or touch lines outside the block.

## Tests (how to run)

Only as (one at a time, always at least one path):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-2-w1-<n>.log 2>&1"`
Never pipe vitest into `head`. Done means green:
`src/lib/server/pipelines/config/variableResolution.int.test.ts`,
`src/lib/server/pipelines/config/named.int.test.ts`,
`src/lib/server/pipelines/config/worldPipelineLayer.int.test.ts`,
`src/lib/server/sockets/pipelinesVariableLayouts.int.test.ts`,
`src/lib/server/plugins/presetVariableLayouts.int.test.ts`,
`src/lib/server/pipelines/entities/variableAccounting.int.test.ts`,
`src/lib/server/pipelines/prompt/builderExplicitLayouts.int.test.ts`,
and the scratch before/after diff identical. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-2-w1-tsc.log 2>&1` — 0 errors (if
errors appear in files you did not touch, list them and say they are not yours). Do not run the two baseline
tests (the supervisor does).

## Stop and ask when

A lookup cannot be made equal without a change outside `world.ts`; the batch would change any result; a test
fails for a reason you cannot tie to your change. Report instead of improvising.

## Report (final message, under ~350 words)

Changed files; the exported function's name and shape; the before→after statement count per build from the
scratch test; the diff result; tests run with results; prettier/tsc results; anything noticed and not done.
