# BRIEF — worker `ss-5-fix-w2` (lane `ss-5-fix`): a `null` lock shows what lies below; docs and charter

Repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/` unless they start with `docs/` or
name a root file. Write nothing but the files owned; put your report in your final hand-back (changed files,
tests run with results, anything you could not do).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK change in this lane.)

Also: never `git checkout / restore`; never `prettier --write` (nor on a scratch copy; a `--check` failure that HEAD's copy also has is pre-existing: leave it). The files were changed by other lanes today and are uncommitted: re-read each right before editing, small targeted edits only. Inside `db.transaction(async (tx) => …)` use only `tx`. No migration, no new exported name, no new setting, no copy (UI words) change: if you think you need one, stop and say so. You may not know whether a `/tmp/serene-pub-vitest-*` dir is yours: then leave it.

## Background

A **setting lock** is a layer's `{ value, lock: true }` inside registration values. The one rule is
`settingLocksOf(layers, decls)` in `pipelines/registrations/values.ts` (~170–220), which a worker has just
changed: `SettingLock.value` is now **the value the lock holds** — the locking layer's value; where that is
`null`, the first non-`null` value of the layers below it (genre-layer lock: the instance values; preset lock:
the genre layer, then the instance values), unwrapped; `undefined` when none states one (the caller's declared
default then holds). A `null` lock means "locked to what lies below"; the run already reads it that way (a run
skips a `null` at any layer).

## Do

1. **The form's prompt row** (`sessions/settingsForm.ts`, prompt branch ~718–790). Today
   `const value = lock ? plain(lock.value) : (own ?? inherited)`. Under a lock whose `value` is `undefined` the
   row must show the declared default (`declared.has(addr) ? declared.get(addr) : d.authorDefault`, the tail of
   `inherited` today), read-only as now, never "no prompt". Smallest change that does it. Nothing else in the
   branch changes (`lockedAt`, `readOnlyReason`, `source` stay).
   Test (`sessions/settingsForm.int.test.ts`, beside "a prompt row: read-only at the lock's prompt…" ~758, using
   its `lockedAt(...)` helper): the owner chooses a second prompt; then a genre lock `{ value: null, lock: true }`
   at the prompt address: for the owner and an admin the row is `editable: false`, `lockedAt: "genre"`, and its
   `value` is the prompt the row showed **before** the owner's choice (`open.value`), not `null` and not the
   owner's choice; after the lock lifts, the owner's choice is back.
   Write the test first and run it: if it already passes with the rule's change alone, say so and leave the
   source as it is.

2. **The Pipelines panel** (`pipelines/config/panel/read.ts` ~140–170). In the layer loop a non-session layer's
   value is written into the `preset` map; at a locked address whose locking layer states `null`, that `null`
   overwrites the layers below it, so the panel shows nothing where the run reads the value below. Fix: at a
   locked address (`locks.has(key)`), a non-session layer whose value is `null` writes nothing (one condition;
   unlocked addresses unchanged).
   Test (`pipelines/config/panel/sessionValues.int.test.ts`, in `describe("a setting lock holds")` ~233, with its
   `withGenreValues`, `stated`, `panelValue`, `runWinner`): a session value 0.07, a genre lock
   `stated({ value: null, lock: true })`: `panelValue` equals `runWinner`, and both equal what a fresh session
   with no value shows (read it in the test; neither is 0.07). Write the test first; if it already passes, say
   so and leave the source.

3. **`docs/sessions.md`** (~451, *Settings you can change, and why some are locked*). Replace the sentence
   "a pipeline's own setting is locked only where a genre's defaults lock it." so the sentence reads:
   "The preset editor offers **Lock** on the genre's settings; a pipeline's own setting is locked where the
   genre's defaults, a preset's values for that pipeline or the pipeline's values on this pub lock it."
   ("the pipeline's values on this pub" is `docs/pipelines.md` ~136's name for instance values.)

4. **`NOMENCLATURE.md`**, the **setting lock** row (~283). In "Stored on a preset (`session_presets.settings`),
   on the genre (its defaults and pins), or inside a genre's or preset's registration values." add the
   pipeline's instance values: "…or inside a genre's or preset's registration values or a pipeline's **instance
   values**." Nothing else in the row; no §25 entry (no name added or renamed).

5. **`sessions/exposure.ts` header** (lines ~18–20). Today: "A genre's field reaches the owner unless it says
   `reach: 'admin'`; one a layer above locked shows its value, read-only, to an administrator and nothing to the
   owner (R1)." State today's rule, as a rule, not a history: "A genre's field reaches the owner unless it says
   `reach: 'admin'`; one a layer above locked shows its value read-only, with the layer's reason, to whoever it
   reaches (the owner and an administrator)." Comment only; no code change in that file.

## Running

Wait for other lanes first: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-5-fix-w2-<n>.log 2>&1"`,
one run at a time; never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s
timeout. Run `sessions/settingsForm.int.test.ts` and `pipelines/config/panel/sessionValues.int.test.ts` (all
green). Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "settingsForm|panel/read|exposure|sessionValues.int"`
(0 lines wanted).

## Files owned

`src/lib/server/sessions/settingsForm.ts` (prompt branch only), `src/lib/server/pipelines/config/panel/read.ts`
(the one condition), `src/lib/server/sessions/exposure.ts` (header comment only),
`src/lib/server/sessions/settingsForm.int.test.ts`, `src/lib/server/pipelines/config/panel/sessionValues.int.test.ts`,
`docs/sessions.md` (that sentence), `NOMENCLATURE.md` (that row). Readable: anything. Not yours:
`registrations/values.ts`, `routines/sessionRoutines.ts`, `utils/resolveTaskConfig.ts` (done by the first
worker), `client/lorebooks/*`, `lorebooks/entryKnowledge.ts` (lane `kn-4a2`).

## Stop and ask (in the report) when

A new name, setting, copy change or migration seems needed; an existing test changes in a way that is not
"a `null` lock now shows what lies below".
