# BRIEF — fix lane `ss-5-fix` — scope review of lane `ss-5` (programme 2.4)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`,
`plans/REPORT-ss-5-2026-11-16.md` (all of it, the scope review at the end) and `plans/briefs/BRIEF-ss-5.md` with
its corrections (its rules on git, prettier, tests, transactions apply unchanged). Wait for other lanes' tests
with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`; tests only in the capped `systemd-run`
form (`plans/ss-5-fix-<n>.log`); `NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No
migration, no SDK change, no full run, no build. Never commit.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Fixes (paths under `src/lib/server/`)

1. **A lock holds for routines and background tasks too.** `pipelines/routines/sessionRoutines.ts`
   `dutyParamsOf` (~70–95) and `utils/resolveTaskConfig.ts` `sessionSamplingPick` (~177–184) resolve through the
   one rule `settingLocksOf` (`pipelines/registrations/values.ts`): a session value (registration or left-over
   row) under a genre or preset lock does not win; a locked value is unwrapped (never handed on as a
   `{value, lock}` object). Prefer calling the same resolution the run uses over a second implementation; if
   `dutyParamsOf` can read the run's resolved values for the address instead of merging by hand, do that and say
   so. Tests: a session routine's duty param and mode, and a background task's sampling pick, each under a
   genre lock and a preset lock with a stale session value; unlocked behaviour unchanged.
2. **A `null` lock value** means "locked to what lies below": the run already falls through; the form's prompt
   row (`sessions/settingsForm.ts`, prompt branch) and the panel must show that inherited value, read-only, not
   "no prompt". One row in `values.int.test.ts`, one in the form's test.
3. **Docs and charter:** `docs/sessions.md` ~451 names all three places a lock on a pipeline's own setting can
   come from (a genre's defaults, a preset's registration values, a pipeline's instance values) in one plain
   sentence; `NOMENCLATURE.md`'s **setting lock** row lists instance values under where it is stored. The
   header comment of `sessions/exposure.ts` 18–20 states today's rule (the owner sees a locked setting
   read-only with its cause), as a rule, not a history.

## Files owned

`pipelines/routines/sessionRoutines.ts`, `utils/resolveTaskConfig.ts`, `pipelines/registrations/values.ts`
(only if the rule needs the `null` case), `sessions/settingsForm.ts` (prompt branch), `config/panel/read.ts`
(the `null` case), `sessions/exposure.ts` (header comment), their tests, `docs/sessions.md`, `NOMENCLATURE.md`.
Lane `kn-4a2` is running on `client/lorebooks/*` and `lorebooks/entryKnowledge.ts`: not your files.

## Done means

New tests green with the lane's earlier list (`plans/ss-5-final.log`'s files) and the routine tests that cover
`sessionDutiesOf` / `sessionReplyChangesMode` (find them); both prompt baselines and the parity harness
unchanged; `tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead appends it to `plans/REPORT-ss-5-2026-11-16.md`): per fix, what changed and
the test; **Noticed, not done**. Under about 300 words.
