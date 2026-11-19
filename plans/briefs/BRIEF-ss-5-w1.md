# BRIEF — worker `ss-5-w1` — a setting lock holds at run time and in the panel

Repo `/home/jody/github/serene-pub`. Supervisor: lane `ss-5`. Paths below are under `src/lib/server/` unless
absolute.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent); never open the
owner's real data directory. No SDK change, no `sdk:build`, no migration.

## Goal

A **setting lock** is a layer's `{ value, lock: true }` stored inside a genre or preset registration's values (or
the pipeline's instance values). Today the run and the Pipelines panel throw it away: a session value at that
address still wins. Make the lock hold, through the one rule the supervisor already wrote:

`pipelines/registrations/values.ts` → `settingLocksOf(layers, decls): Map<string, SettingLock>` (read it, ~170–205).
Keys are `addressedValues` keys (`nodeKey\0slot\0path`); `SettingLock = { layer: "genre" | "preset"; value }`.
Semantics: a lock at `genre` hides the preset's and the session's values at that address; a lock at `preset`
hides the session's. Do not edit `settingLocksOf` without saying why in your report; do not write a second copy
of its logic anywhere.

## Build

1. **The run — `pipelines/config/world.ts`, the minimum edit** (~993–1006 and the leftover loop ~1045–1052). It
   already has `valueLayers` and `allDecls`. Compute `const locks = settingLocksOf(valueLayers, allDecls)` (import
   it beside `registrationValueLayers`). Then:
   - the `session` push skips every key in `locks`;
   - the `preset` push skips every key whose lock is at `genre`;
   - the leftover session override loop (`pipeline_node_overrides`, scope session) skips a row whose
     `` `${o.nodeKey}\u0000${o.slot}\u0000${o.path ?? ""}` `` is in `locks`.
   Filter the maps passed to `pushValues` (a tiny local helper is fine); do not touch `pushValues`,
   `resolvedLayer`, the instance or author pushes, or anything else. When no lock exists the pushes must be
   byte-identical to today (the prompt baselines below prove it).
2. **The panel — `pipelines/config/panel/read.ts` `layers()`** (~101–175). Same rule, same three skips: in the
   loop over `instance / genre / preset / session`, a `preset` value at a genre-locked key is not set; a
   `session` value at any locked key is not set (neither into `session` nor, for a connection slot, into
   `preset`); a leftover row at a locked key is not set. `layerOf` must then name the locking layer's source at
   that key, as it does today for the value that stands. Call `settingLocksOf(layersOf, decls)`; nothing else.
3. **Tests.**
   - `pipelines/registrations/values.int.test.ts`: add a small table for `settingLocksOf` (no DB needed; pure):
     genre lock; preset lock; genre lock beats a preset lock (layer `genre`); an instance lock where the genre
     states nothing → `genre`; an instance lock under a plain genre value → none; a plain decision without lock
     (`{ value, askAtStart: true }`) → none; a lock inside a params slot keyed by path
     (`{ node: { params: { margin: { value: 0.2, lock: true } } } }`) → key `node\0params\0margin`.
   - `pipelines/config/panel/sessionValues.int.test.ts`: a new `describe("a setting lock holds", …)` using the
     file's own helpers (`knob`, `setRegistration`, `leftover`, `panelValue`, `runValue`). Put a lock at the
     knob into the layer above the session: find how a genre's or preset's registration row is stored
     (`registrations` table, `scopeKind` `genre` / `preset`, `scopeRef`; read `registrations/resolve.ts`
     `effectiveRegistrations` and `rows.ts`), and write `{ value: 0.11, lock: true }` at the knob on the
     genre-scope row whose key the session's reply registration uses (restore the row's values in a `finally`
     so later tests are unaffected), or give the session a test preset with a preset-scope row: your choice,
     say which. Cases: (a) stale session registration value 0.07 under the lock: panel and run both read 0.11
     (the run's session-scope entry at the knob is absent; assert what the run resolves at the knob is 0.11 —
     look at how `runValue` reads `world.overrides` and add a reader of the winning entry across scopes in the
     run's order if needed); (b) a leftover row 0.09 under the lock: same; (c) the session value is still
     stored (read `registrationValues(sessionId)`); (d) lift the lock (write `0.11` plain, or remove it): panel
     and run read 0.07 again.
   - **Count for the report (throwaway, then delete it):** on a fresh test database after `bootstrapPipelines`,
     count `registrations` rows whose `values::text` contains `"lock"` and list `(scope_kind, key)` of each, and
     the same for `pipeline_specs.instance_values`. Do it in a temporary test file
     `src/lib/server/pipelines/registrations/ss5-lockcount.int.test.ts` (copy the mocking preamble of
     `sessionValues.int.test.ts`), run it once, put the numbers in your report, delete the file.
4. **Run, only this way, one run at a time** (other lanes run vitest too — wait first):
   ```
   until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
   cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-5-w1-<n>.log 2>&1"
   ```
   Never pipe vitest into `head`. Files: `src/lib/server/pipelines/registrations/values.int.test.ts`,
   `src/lib/server/pipelines/config/panel/sessionValues.int.test.ts`,
   `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts`,
   `src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`,
   `src/lib/server/pipelines/parity/harness.int.test.ts`, and any `worldPipelineLayer*` int test under
   `pipelines/config/` (find it). The two prompt-baseline tests and the parity harness must pass **unchanged**
   (never edit them or their baselines). Then
   `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "world.ts|panel/read.ts|registrations/values|sessionValues"`
   must print nothing.

## Files owned

`src/lib/server/pipelines/config/world.ts`, `src/lib/server/pipelines/config/panel/read.ts`,
`src/lib/server/pipelines/registrations/values.int.test.ts`,
`src/lib/server/pipelines/config/panel/sessionValues.int.test.ts`, and the throwaway count file (deleted).
Read anything. `values.ts` is the supervisor's: read it, don't edit it.

## Rules your work depends on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- CLAUDE.md: "Never `kill -9` the dev server." · "Do what was asked, at the size asked. Findings along the way go
  under **Noticed, not done**, never fixed in passing."
- Lead: "`config/world.ts` is the run's resolver: any edit is the minimum to call the rule. The two
  prompt-baseline tests … and `pipelines/parity/harness.int.test.ts` must stay green with identical prompts."
- Brief: "A stored session value under a lock is kept (not deleted), so unlocking restores it."
- Cold review: "Build one exported rule in `values.ts` … called by the run, the panel and the form's prompt
  branch … No second resolver."

## Out of scope

`settingsForm.ts` (another worker, after you), any client file, `panel/write.ts`, the boot fold, the attic,
`routines/sessionRoutines.ts`, `utils/resolveTaskConfig.ts`, docs, NOMENCLATURE. If one of them looks like it
must change, put it under Noticed.

## Stop and ask (in your report, then stop) when

A prompt baseline or the parity harness changes; the edit to `world.ts` needs more than the three skips; a
test needs a new exported name.

## Report

Write `/home/jody/github/serene-pub/plans/REPORT-ss-5-w1-2026-11-16.md` (status question line; changed files with
line ranges; the count; tests with pass counts and log paths; prettier `--check` result per file; Noticed, not
done). Under 400 words.
