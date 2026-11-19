# BRIEF — worker `ss-5-fix-w1` (lane `ss-5-fix`): a setting lock holds for routines and background sampling

Repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/`. Report to
`plans/REPORT-ss-5-fix-w1-2026-11-16.md` (changed files, tests run with results, anything you could not do).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK change in this lane.)

Also: never `git checkout / restore`; never `prettier --write` (nor on a scratch copy). These files were changed by other lanes today and are uncommitted: re-read each right before editing, small targeted edits only. Inside `db.transaction(async (tx) => …)` use only `tx`. No migration, no new exported name, no new setting: if you think you need one, stop and say so in the report.

## Background (read, don't re-derive)

A **setting lock** is a layer's `{ value, lock: true }` at one address inside registration values. The one rule is
`settingLocksOf(layers, decls)` in `pipelines/registrations/values.ts` (~170–204): which addresses a layer above
the session locks, and at which layer (`genre` = the genre's registration, or the pipeline's instance values where
the genre states nothing; then `preset`). Address keys are `addressedValues`' `nodeKey\u0000slot\u0000path`.
`addressedValues(values, decls)` without `keepDecisions` unwraps any `{value, …}` decision to its value. The run
(`pipelines/config/world.ts` ~999–1013 and ~1064) skips a session value (registration value or left-over
`pipeline_node_overrides` row) at a locked address, and a preset value at a genre-locked one. A run also skips a
`null` value at any layer (`readStoredValue`), so a `null` reads as "nothing stated here".

Two readers outside the run ignore the rule (scope review of lane ss-5):
- `pipelines/routines/sessionRoutines.ts` `dutyParamsOf` (~59–98): merges `reg.values` (the SDK's genre ⊕ preset ⊕
  session merge, where a session value beats a lock) by hand, then left-over rows with no lock check; with no
  session value a locked value arrives as a `{value, lock}` object, and `dutyModes` (`pipelines/runtime/duties.ts`
  ~78) then reads that duty as off (`value === true` fails).
- `utils/resolveTaskConfig.ts` `sessionSamplingPick` (~154–200): the session's own sampling pick (registration
  value, else a left-over row) with no lock check.

## Do

1. **`settingLocksOf`, the `null` case** (`registrations/values.ts`). A lock whose value is `null` means "locked
   to what lies below". Make `SettingLock.value` the value the lock holds: the locking layer's value; where that
   is `null` or absent, the first non-`null` value of the layers below it at that address (a genre-layer lock:
   the instance values, unless the instance values are themselves the locking layer; a preset lock: the genre
   layer, then the instance values), each unwrapped; `undefined` when none states one (the caller then uses its
   declared default). Update the `SettingLock` doc comment (today "as stated") and the function's comment in the
   same plain style. Nothing in `config/world.ts` or `config/panel/read.ts` reads `.value` (check with grep);
   `sessions/settingsForm.ts` ~733 does (`plain(lock.value)`) and keeps working.
   Test: in `pipelines/registrations/values.int.test.ts` `describe("settingLocksOf")`, add two rows to `cases`:
   a `null` preset lock over a plain genre value holds the genre's value (layer `preset`); a `null` genre lock
   with nothing below holds `undefined` (layer `genre`).

2. **`dutyParamsOf`** (`routines/sessionRoutines.ts`). Keep its order (declared defaults < the registration's
   values < a left-over session row at a path the session's own values do not state) and put the rule through
   it:
   - `decls` = one per declared param: `{ nodeKey: at.node, slot: "params", path }`.
   - `layers = registrationValueLayers(db, { specSlug: reg.pipeline, sessionId, registrationKey: reg.key })`
     (call it once, outside the `if (spec)`; the session's own params for the left-over check come from
     `layers.session` as today); `locks = settingLocksOf(layers, decls)`.
   - The registration's values through `addressedValues(reg.values, decls)` (unwrapped), only the keys under
     `${at.node}\u0000params\u0000`, skipping locked keys.
   - Each locked key under that prefix: `lock.value`, or the declared default when it is `undefined`.
   - Left-over rows: also skipped at a locked path.
   - Update the function's comment: under a lock from a layer above (`settingLocksOf`, the run's rule) the lock's
     value holds and the session's own value and left-over row are not read.
   Do not call `buildWorld`.

3. **`sessionSamplingPick`** (`utils/resolveTaskConfig.ts`). With the same one-decl list it builds today, take
   `settingLocksOf(layers, decls).get(<the oracle sampling key>)`; when locked, return `wholeId(lock.value)`
   before reading the session's value or the left-over row (a value that is not a whole id, such as a seed
   reference, is no pick: the node's own slot and the instance default decide, as today). Update its comment.

## Tests (new; all under a stale session value)

- **Routines** — add a `describe` in `pipelines/registrations/resolve.int.test.ts` beside "the host doors read the
  session's routines…" (~229), reusing its `sessionOn("core-story-living")` and setup. Find the reckoning routine
  (`effectiveRegistrations(...).effective`, `trigger.family === "routine"`) and its duties step key and the param
  that publishes `timed-expiry` (`DUTY_MODE_KEYS` in `runtime/duties.ts`, the contract's params schema). Store a
  stale session value `false` on that param (session registration row: `upsertRow(db, rowOfChange({ key, values }, { kind: "session", sessionId }, "owner"))`, as `sockets/sessions.taskReckoning.int.test.ts` ~291 does). Then:
  - a **genre lock** `{ value: true, lock: true }` (a genre-scope change row, key `genreChangeKey(key)`, scope ref
    the session's genre, as `pipelines/config/panel/sessionValues.int.test.ts` `withGenreValues` ~240 does; delete
    the row and `invalidateRegistrations()` after): `sessionDutiesOf(db, sessionId, reckoningDuties.id)["timed-expiry"]`
    is `"full"` and `dutyParamsOf(...)` gives `true` for the param (a boolean, never an object);
  - a **preset lock** the same way (a preset-scope row: `scopeKind: "preset"`, `scopeRef: String(<the session's
    preset id>)`, `key`; find how the session's preset is stored): `"full"`;
  - a left-over `pipeline_node_overrides` session row `false` at that param under the genre lock: still `"full"`;
  - the lock with **no** session value: `"full"` (today a `{value, lock}` object reads as off);
  - unlocked (the lock row removed): the session's `false` → `"off"` again.
  - `sessionReplyChangesMode`: the reply's `changes` param (`reading.params.changes`, see taskReckoning ~291)
    stale `false` on the session, genre-locked `true` → `"full"`.
- **Sampling** — in `pipelines/config/panel/sessionValues.int.test.ts` (inside or beside `describe("task sampling
  keeps the session's pick")`, ~360; you may lift `withGenreValues` to file scope if you need it there): session
  registration pick A, genre lock `{ [oracle]: { sampling: { value: B, lock: true } } }` → `resolveTaskConfig({
  taskType: "session", sessionId }).sampling?.id === B`; a left-over row C under the lock → B; a preset lock the
  same → B; lock lifted → A.
- Existing tests that must stay green unchanged: `values.int.test.ts`, `resolve.int.test.ts`,
  `sockets/sessions.taskReckoning.int.test.ts`, `panel/sessionValues.int.test.ts`,
  `db/sessionSamplingMigration.int.test.ts`.

## Running

Wait for other lanes first: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-5-fix-w1-<n>.log 2>&1"`,
one run at a time; never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s
timeout. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "sessionRoutines|resolveTaskConfig|registrations/values|resolve.int|sessionValues.int" ` (0 lines wanted) and
`npx prettier --check` on each file you changed.

## Files owned

`src/lib/server/pipelines/registrations/values.ts` (the `settingLocksOf` / `SettingLock` block only),
`src/lib/server/pipelines/routines/sessionRoutines.ts`, `src/lib/server/utils/resolveTaskConfig.ts`,
`src/lib/server/pipelines/registrations/values.int.test.ts`,
`src/lib/server/pipelines/registrations/resolve.int.test.ts` (one new describe),
`src/lib/server/pipelines/config/panel/sessionValues.int.test.ts` (new tests; lifting `withGenreValues`).
Readable: anything. Not yours: `sessions/settingsForm.ts`, `config/panel/read.ts`, docs, `NOMENCLATURE.md`
(another worker follows you), `client/lorebooks/*`, `lorebooks/entryKnowledge.ts` (lane `kn-4a2`).

## Stop and ask (in the report) when

A new name, setting or migration seems needed; a test shows a no-lock behaviour changing; the rule's change
breaks an existing test in a way that is not "the lock now holds".
