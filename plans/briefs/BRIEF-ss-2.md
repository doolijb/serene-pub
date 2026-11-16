# BRIEF — build lane `ss-2` — one store and one writer for a session's pipeline values and genre settings

Repo `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/PLAN-session-settings-cleanup-2026-11-15.md` (S2 and its "Cold review" correction; the rest for context
only), `plans/INVENTORY-session-settings-2026-11-15.md`, `../serene-pub-sdk/INTEGRATING.md` §1i (values, one
cascade; exposure), `docs/sessions.md` and `docs/pipelines.md` (settings, the Pipelines card), `NOMENCLATURE.md`
§1, §23, §24 and the rows **settings form**, **registration**, **override**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form; `npx prettier --check <file>` only, **never `prettier --write`**. Never commit.
Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own
tests made, by name. Before any `sdk:build`, check `pgrep -af "vite"` (dev and preview; the Svelte language
server's esbuild is not one) and `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is up, don't
build; report 'blocked on your dev server'. Migrations are **generated** (`npm run db:generate`); a new index
must exceed the highest in `drizzle/meta/_journal.json` (0167 today). Inside `db.transaction` use only `tx`.

## Owner (2026-11-15)

"lets focus on just cleaning up the mess and making sure prompt choices are easilly accessible for all session
owners in each of the sections/pipelines." Standing: P2 ("Two writers of one thing is a bug"); 0.6 is in users'
hands (a change to stored data ships with a boot pass and a test that a second boot changes nothing).

## The defect (verify each line)

- A session-scope value for one step address (`nodeKey · slot · path`) can live in `registrations.values` (written
  by the derived settings form, `sessions/settingsForm.ts` ~780–805, which also deletes the override row) **and**
  in `pipeline_node_overrides` (written by the Pipelines card, `pipelines/config/panel/write.ts` ~480–503).
- The panel layers registration values **under** the override (`config/panel/read.ts` ~87–160); the run takes
  registration values **first** (`config/world.ts` ~1025 before ~1071). So the Pipelines card can show a value
  the run ignores.
- `sessions.genre_fields` is written by `sessions:updateSetting` (`settingsForm.ts` ~345), `sessions:update`
  (`sockets/sessions.ts` ~6927), the preset switch (~3720), `sessions/authorsNote.ts` ~176 and
  `speech/resolveVoice.ts` ~408–431; `sessions.rigour` by `settingsForm.ts` ~315 and `sessions.ts` ~6782–6830.
- The summaries policy is stored in `sessions.metadata.scenes` and as the scene-summaries routine's mode
  (`summariesToRoutine`).

## Build

### A. Inventory (supervisor, read-only; file:line in the report)

Every reader and writer of **session-scope** `pipeline_node_overrides` rows (`sessions/settings.ts` ~139–158,
`routines/sessionRoutines.ts` ~78–86, `sockets/loadouts.ts` ~110–120, `panel/read.ts`, `panel/write.ts`,
`world.ts`, the attic `attic/finish.ts` ~278, ~384, export / import, branch, tests); which kinds of value each
store holds at session scope (prompt, sampling, loadout, model, on / off, params); how an override keyed **per
spec** maps onto values keyed **per registration key** (a spec registered twice); preset- and genre-scope rows
(out of scope, but say whether they share the defect); every writer of `genre_fields`, `rigour`,
`metadata.scenes.summaries`.

### B. One store for session-scope step values

- **`registrations.values` is the store** for every session-scope step value. The Pipelines card (session mode)
  reads and writes it through the same server function the derived form uses; the run and the panel resolve in
  the same order by calling one resolver (no second layering).
- A **boot pass** folds every session-scope `pipeline_node_overrides` row into `registrations.values`: where both
  hold the address, the value the **run** uses today wins (behaviour does not change on upgrade); a per-spec
  override lands on each of that spec's session registrations that has no value of its own; then the override
  row is deleted. A second boot changes nothing. The attic writes its session-scope rows to the surviving store.
- If the inventory shows a kind of value that `registrations.values` cannot hold, **stop and report**.
- No table or column is dropped in this lane (preset and genre scopes still use overrides); no migration is
  expected; if the inventory shows the session scope can be constrained away cheaply, propose it as a ★, do not
  build it.

### C. One writer per stored thing

- `genre_fields`: one module-owned function (🚧 `writeGenreFields(tx, sessionId, patch)`, in the module that owns
  session settings) is the only code that updates the column; the form door, `sessions:update`, the preset
  switch, `authorsNote.ts` and `resolveVoice.ts` call it inside their own transaction, keeping their own
  permission rules. Same for `rigour` (🚧 `writeRigour`). A test fails if another `update(sessions).set({
  genreFields … })` appears (grep-style guard, as `db/transactionGuard` style tests do).
- The summaries policy: the routine's mode is the stored truth; `metadata.scenes.summaries` stops being written
  and is derived on read; a boot pass reconciles a session where the two disagree (the routine's mode wins) and
  a second boot changes nothing.

### D. Docs and names

`docs/sessions.md`, `docs/pipelines.md` where they describe the Pipelines card or which setting wins;
`INTEGRATING.md` §1i (one line: session-scope values live in registrations); `NOMENCLATURE.md` (the **override**
row: session scope retired ⏳; new function names; §25). Comments state the rule, not the story.

## Files owned

App: `sessions/settingsForm.ts`, `sessions/settings.ts`, `pipelines/config/panel/read.ts`, `panel/write.ts`,
`pipelines/config/world.ts`, `registrations/values.ts`, `routines/sessionRoutines.ts`, `sockets/loadouts.ts`,
`attic/finish.ts` (the two session-scope writes), the writers named in C (only the write call), a new boot pass
under the existing boot-pass home (inventory where data upgrades live; follow that pattern), their tests, the
docs, `NOMENCLATURE.md`. Client: `PipelineConfigOptions` session mode only if its socket call changes. SDK:
`INTEGRATING.md` only.

## Out of scope

Prompt rows on every section, the two views, turn controls, locks, the Line row, routine groups, the Turn line
(later lanes of the plan); preset- and genre-scope overrides; any new setting or user-visible wording beyond
correcting a sentence that becomes untrue; dropping a table or column.

## Stop and ask when

CLAUDE.md §Decisions applies; the fold cannot preserve what a run uses today for some stored shape; a per-spec
override cannot be mapped to registrations without changing behaviour; a writer of `genre_fields` cannot call the
one function without breaking its transaction or lock; a migration seems needed.

## Done means

- App tests (capped form `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx
  vitest run --maxWorkers=3 <paths> > plans/ss-2-<n>.log 2>&1"`, strictly one run at a time): the panel and the
  run resolve the same value for every layering case (session value only; old override only; both); the boot
  pass (each case; second boot changes nothing; an attic-imported session); the Pipelines card's session write
  lands in registrations and a run uses it; each `genre_fields` writer goes through the one function; the guard
  test; the summaries reconcile; `settingsForm*.test.ts`, `panel/*.test.ts`, `world*.test.ts`,
  `attic/upgrade.int.test.ts`, `allPipelines.int.test.ts`.
- If the SDK was touched beyond docs: `npm run sdk:build` (after the checks) and `npm run sdk:test` in the capped
  form: only the four known failures.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-ss-2-<date>.md`): the inventory with
file:line; what each store holds after the lane; the fold's rules and what it does to each stored shape; every
new name; changed files; tests with results; open ★; **Noticed, not done**. Under about 800 words.
