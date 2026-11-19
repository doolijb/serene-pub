# BRIEF — lane `tl-3a`, worker 1 — the new default in code, and every test it moves

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `tl-3a` (brief `plans/briefs/BRIEF-tl-3.md`, its last
section "Cold review corrections" rules). You do not read that brief; this one carries what you need.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: do not run one.) Never `git checkout / restore / stash` anywhere. Never `prettier --write`.
No migration. No full test run, no `npm run build`, no `npm run check`. **One vitest run at a time**, only as:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-3a-<n>.log 2>&1"
```

from `/home/jody/github/serene-pub` (n = 1, 2, 3… never reuse a number). Never pipe vitest into `head`/`tail`
(SIGPIPE leaks PGlite temp dirs): read the log file after. An int test that opens a DB inside an `it` needs a
60 s timeout.

## Goal

Owner, 2026-11-16: "If the genre/preset supports undated, use undated by default." Asked whether that includes
Story: "Yes, story as well". Earlier (2026-11-14): "preset may override the genres default, but not it's mandate".
This **reverses** the 2026-11-14 ruling "By default, Story Minimal will use an undated book. … All other Story
presets will continue defaulting to timelined storybooks." "Messages will just display real time" still stands.

So a new session whose lorebook is its own notes starts them **without** a timeline unless its genre requires
one (`timeline: 'required'`: the Lair, Dungeon Crawler) or its preset's `defaults.timeline` is `true`.

## Build

1. **The rule** — `src/lib/server/lorebooks/timeline.ts` `timelineDefaultFor` (lines 51–69): keep, in order,
   `!genre → true` (unchanged on purpose; the supervisor proposes it to the owner), `timeline === 'required' →
   true`, a boolean `preset.defaults.timeline` → that value; then **`return false`** (today
   `genre.keepsTime === "story"`). Rewrite its doc comment to state the new order and that `keepsTime` no longer
   picks the default (it still feeds ruleset fit and the one-time boot pass over existing data, which is a
   different question). Keep the 🚧 marker. The parameter type may keep `keepsTime?` or drop it — drop it only if
   no caller then fails `tsc` (run `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` once at the
   end if you change the signature; otherwise skip tsc).
   **Do not touch** `src/lib/server/lorebooks/timelinePass.ts` (the boot pass: existing data stays as it is,
   owner 2026-11-16 "Go with the safest option for existing lorebooks"), `sockets/sessions.create.ts`,
   `sockets/sessionAdmin.ts`, `StartSessionForm.svelte`, anything about how writes are dated or `current-date`.
2. **`src/lib/server/lorebooks/timelineDefault.test.ts`** — update the table to the new rule. Every row whose
   expectation changes is listed in your report as `name: old → new` (e.g. "a story genre, nothing": true →
   false). Add a row "a required genre, no preset" → true if missing.
3. **`src/lib/server/sockets/sessions.timelineDefault.int.test.ts`** — move `core-story-living` and
   `core-story-rule-based` from `ON` to `OFF` (report old → new); rename the header comment if it says otherwise.
   Add, in the same file, **the boot test**: an existing Story session whose own notes keep a timeline (create
   one through `create(...)`, then set its notes' `timeline_enabled = true` — what the create path did before
   this change — and give it nothing dated), then run `settleTimelineSwitches(db)` from
   `$lib/server/lorebooks/timelinePass` (an install that has **not** yet run the pass) and run it again (a second
   boot): the notes are still on after each. Name it so the reason reads ("an existing Story session's own notes
   keep their timeline across a boot, the pass not yet run and run again").
4. **A first turn of each shipped Story preset with the timeline off** — new file
   `src/lib/server/sockets/sessions.storyUndated.int.test.ts`, modelled on
   `src/lib/server/sockets/sessions.genreParity.int.test.ts` (copy its harness: the db mock, FakeAdapter, the
   model/sampling setup, `setRoutinesEnabled(true)`, `createOn`, `send`, `settle`). For each of
   `core-story-minimal`, `core-story-living`, `core-story-rule-based` (one character seated; no lorebook):
   - the session's own notes have `timelineEnabled === false`, and the session's `storyClock*` columns are null;
   - one sent message gets exactly one assistant reply and the preset's `callsPerTurn` calls (as genreParity);
   - no pipeline run of the session ended failed/errored (find the run table and its status values: grep
     `pipelineRuns` / `runStatus` in `src/lib/server/db/schema.ts`; assert none has the failed status), and no
     broadcast push in the turn carries an error;
   - nothing was refused in ordinary play: if run notes / receipts are stored, the only timeline sentences
     allowed are `TIMELINE_OFF_SENTENCES.*` from `lorebooks/timeline.ts` (report which appeared, per preset);
   - after the turn, the notes are still off and the session clock still null (the round tick moved nothing).
   If a step throws or a run fails on an ordinary turn for a reason **other than dating**, stop and report it
   (file:line, the error) — do not fix it. A dating defect (a write refused for want of a date, `current-date`
   in a prompt) is reported, not fixed.
5. **The sweep** — after step 1, run these test files (they create a Story session through the real create
   path; the change may make one lose a clock, a dated write or a scene stamp). Split into three runs of about
   14 files each:

   ```
   src/lib/server/state/sessionStoryClock.int.test.ts src/lib/server/state/lorebookReading.int.test.ts
   src/lib/server/sockets/sessions.ownBookCreate.int.test.ts src/lib/server/sockets/appletSessions.int.test.ts
   src/lib/server/sockets/sessions.benchedSeats.int.test.ts src/lib/server/sockets/sessions.taskVoices.int.test.ts
   src/lib/server/sockets/sessions.storyEmptyCast.int.test.ts src/lib/server/sockets/sessions.lorebookName.int.test.ts
   src/lib/server/sockets/sessions.editedLineRerun.int.test.ts src/lib/server/sockets/sessions.taskSweep.int.test.ts
   src/lib/server/sockets/sessions.rulesIncompatible.int.test.ts src/lib/server/sockets/sessions.createRulesets.int.test.ts
   src/lib/server/sockets/sessions.storyRulesRest.int.test.ts src/lib/server/sockets/sessions.personaFlag.int.test.ts
   src/lib/server/sockets/sessions.forms.int.test.ts src/lib/server/sockets/sessions.replyTies.int.test.ts
   src/lib/server/sockets/sessions.creationModes.int.test.ts src/lib/server/sockets/sessions.seatCast.int.test.ts
   src/lib/server/sockets/sessions.castFromLorebook.int.test.ts src/lib/server/sockets/sessions.createStoryStart.int.test.ts
   src/lib/server/sockets/sessions.seatEvents.int.test.ts src/lib/server/sockets/sessions.sweepShown.int.test.ts
   src/lib/server/sockets/sessions.castBindings.int.test.ts src/lib/server/sockets/sessions.genreParity.int.test.ts
   src/lib/server/sockets/sessions.taskReckoning.int.test.ts src/lib/server/sockets/sessions.taskReply.int.test.ts
   src/lib/server/sockets/sessions.messageAccessAndScoping.int.test.ts src/lib/server/sockets/sessions.castMemberIds.int.test.ts
   src/lib/server/sockets/sessionAdmin.int.test.ts src/lib/server/sockets/seatedBy.int.test.ts
   src/lib/server/sockets/sessions.retraction.int.test.ts src/lib/server/plugins/providedBooksPubWide.int.test.ts
   src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/lorebooks/notesShown.realCreate.int.test.ts
   src/lib/server/lorebooks/starterKits.int.test.ts src/lib/server/lorebooks/starterKits.cardless.int.test.ts
   src/lib/server/sessions/rewind.int.test.ts src/lib/server/sessions/narratorVoice.int.test.ts
   src/lib/server/pipelines/routines/routines.int.test.ts src/lib/server/pipelines/routines/roundTick.int.test.ts
   src/lib/server/pipelines/routines/sceneBoundaries.routine.int.test.ts src/lib/server/pipelines/routines/clockOwners.int.test.ts
   src/lib/server/pipelines/routines/roundTick.undo.int.test.ts src/lib/server/pipelines/runtime/host.scenesEndRoute.int.test.ts
   ```

   For each failure, decide (and say which in the report): **(a)** the test meant "a session with a timeline"
   (it expects a clock, a clock move or its line, a dated write, a history day, a scene stamp, a dated reading)
   → make it **say so explicitly**, never weaken an assertion. In this order of preference: the test creates
   from a preset → set that preset row's `defaults.timeline = true` in the test DB before the create (keep the
   row's other `defaults` keys); no preset → switch the new notes on right after create
   (`update lorebooks set timeline_enabled = true where session_id = <id>`), and if it relied on create's
   "starts today" date (lane tl-2d: a new dated session's clock is set to today at create only when its
   lorebook keeps a timeline at create time), report it rather than invent a clock. Add a one-line comment at
   the change: why the test states its timeline. **(b)** the failure is not about the timeline (it also fails
   with step 1 reverted in your head — read the error) → leave it, report it with the error. **(c)** the test
   asserted the old default itself → old → new, report it.
   **Stop and report before editing if more than about 25 tests need their timeline stated** (count and the
   pattern).
6. **Both prompt baselines**, once, after everything: with `KN2_SHA_LOG=plans/tl-3a-shas.txt` in the env of the
   capped run, run `src/lib/server/pipelines/runtime/unknownEntries.reply.int.test.ts
   src/lib/server/sockets/sessions.lairUnknownEntries.int.test.ts`; then `diff plans/kn-2-shas-sup.txt
   plans/tl-3a-shas.txt` (delete `plans/tl-3a-shas.txt` before the run if it exists). Report the diff (expected
   empty: neither creates through the real create path); if a sha moved, say whether a missing `current-date`
   is the cause (stop: a change for any other reason is a question).
7. Finally re-run your touched test files together (steps 2–5) in one capped run, and `npx prettier --check` the
   files you changed.

## Files owned

`src/lib/server/lorebooks/timeline.ts`; `src/lib/server/lorebooks/timelineDefault.test.ts`;
`src/lib/server/sockets/sessions.timelineDefault.int.test.ts`; new
`src/lib/server/sockets/sessions.storyUndated.int.test.ts`; the sweep's test files only where step 5 says;
`plans/tl-3a-*.log`, `plans/tl-3a-shas.txt`.

## Files readable

Anything. Do not edit docs, NOMENCLATURE, the SDK, or non-test source other than `timeline.ts` (a second worker
owns the docs in parallel).

## Out of scope (never built)

The start form's story-time control and any create parameter (lane tl-3b); dating play's writes and
`current-date` (lane tl-2c); the boot pass; ST import's own notes (`sockets/import.ts` uses the column default).

## Stop and ask when

A shipped Story preset cannot play a first turn without a timeline; more than ~25 tests need their timeline
stated; a prompt baseline moves for a reason other than the missing date; any new name, setting, migration or
non-test source change beyond `timeline.ts` seems needed. Report and stop rather than decide.

## Done means

Steps 2–5 test files green in one capped run (log path), baselines diff reported.

## Report (your final message, under ~500 words)

Changed files; every pinned test changed (`file: test name: old → new`); each sweep failure with (a)/(b)/(c) and
what you did; what step 4 observed per preset (sentences seen, runs, clock); baseline diff; logs; anything
noticed but not done.
