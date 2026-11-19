# BRIEF — worker `tl-4-w3` — tests that assumed fallback notes keep a timeline

App repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-4`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build the SDK in this task: don't.)

Also: never `prettier --write`; never `git checkout / restore / stash` anywhere; never `pkill -f` a generic pattern; no
migration; no `npm run build`; no full test run; **no product code** — test files only. Other lanes are editing nearby files:
**re-read every file right before you edit it.**

## Why these tests fail (the change, already made and correct)

Owner ruling D53(a), 2026-11-16: "Make both follow the new rule". `insertOwnBook` (`src/lib/server/lorebooks/ownBook.ts`
~206–275) now decides a new own book's Timeline with `timelineDefaultFor(genre, preset)` (`lorebooks/timeline.ts`) when its
caller passes no `timelineEnabled` and the notes overlay nothing: a genre that doesn't resolve or declares `timeline:
'required'` (Lair, Dungeon Crawler) → on; else the preset's boolean `defaults.timeline`; else **off**. So notes made by the
`ownBookFor` fallback or `ensureOwnBooks` for a Story session with no preset are now **off** (before: the column default, on).
Many test fixtures made notes through `ownBookFor` / `ensureOwnBooks` and then exercised dated behaviour (clocks, lines,
dated history, the timeline pass), which needs a timeline. Do **not** change product code to make them pass.

## The failing tests (from `plans/tl-4-w1-3.log`)

- `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts` — "parent at an early moment: a later-dated row is not yet in force"
- `src/lib/server/lorebooks/ownBook.timeline.int.test.ts` — "made over an off book they are off, over an on book on, over none the default (on)"
- `src/lib/server/lorebooks/timelinePass.int.test.ts` — 4 tests
- `src/lib/server/state/loreWriteDate.int.test.ts` — "a session on its own notes … with a dated notes history entry: dated"
- `src/lib/server/state/ownNotesLine.int.test.ts` — 8 tests
- `src/lib/server/state/ownNotesReading.int.test.ts` — 2 tests
- `src/lib/server/state/timelineOff.int.test.ts` — "a session reading its notes alone follows the notes' switch"
- `src/lib/server/sessions/noLorebook.int.test.ts` — 2 tests
- `src/lib/server/sockets/ownNotesLine.sockets.int.test.ts` — 4 tests
- `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts` — "refuses a branch entry re-dated on or before the fork"
- `src/lib/server/sockets/sessions.creationModes.int.test.ts` — "a surfaced book (★B-3) > the owner's branch off…" (~461; its
  `surfaced()` helper makes notes with `ownBookFor`)

## What to do, per test

1. **Confirm the cause** first: the test makes notes through `ownBookFor` / `ensureOwnBooks` / `insertOwnBook` without a
   switch and then needs a timeline. If a test fails for any other reason, leave it and list it (not yours).
2. **A fixture that needs a timeline** (nearly all): state it explicitly, the way lane tl-3a did for
   `sessions.createStoryStart` ("states its timeline"). Prefer the smallest honest form: pass `timelineEnabled: true` where the
   test calls `insertOwnBook`, or set the notes' `timeline_enabled` to true right after `ownBookFor` in the file's own fixture
   helper (one place per file, not per test). Don't change the session's genre to dodge the rule. Don't change what a test
   asserts.
3. **A test that pins the old default** (e.g. `ownBook.timeline` "…over none the default (on)"): re-pin to the new rule (Story,
   no preset → off) and rename the title to match; list it **old → new**. If the test also covers "over none" for a required
   genre, keep/add that it is on.
4. **`timelinePass` tests**: the pass is a one-time boot pass over **existing** data, whose notes were made with the old default
   (on). Its fixtures should make the notes **on explicitly** (simulating data from before), so every assertion stands as
   written. A comment of one line saying so is fine.

## How to run tests — only this form, one at a time, wait first

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-4-w3-<n>.log 2>&1"
```

Never pipe vitest into `head`. Run the 11 files above (in at most two runs). Int tests that open a DB inside an `it` need a 60 s
timeout. Then (wait first) `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub` and
report the error count in your files. `npx prettier --check` your changed files (report; pre-existing drift is fine).

## Files owned

The 11 test files above. Nothing else.

## Stop and ask (report, don't decide) when

A test can only pass by changing product code or an assertion that isn't a pin of the old default; a failure has another cause.

## Report (your final message, under ~350 words)

Per file: what you changed (fixture made explicit / re-pinned old → new); tests run (log paths, pass/fail); failures left with
their cause; tsc count.
