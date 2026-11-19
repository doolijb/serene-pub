# BRIEF — worker `tl-4-w1` — a new own book's Timeline follows the genre / preset rule; re-pin one next-chapter test

App repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-4`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build the SDK in this task: don't.)

Also: never `prettier --write`; never `git checkout / restore / stash` anywhere; never `pkill -f` a generic pattern; no migration;
no `npm run build`; no full test run. Other lanes are editing nearby files right now: **re-read every file right before you
edit it**, and in `src/lib/server/lorebooks/ownBook.ts` touch **only** `insertOwnBook`, `ownBookFor`, `ensureOwnBooks` (and
`genreCalendarOf` only if you fold its read into `insertOwnBook`'s, see below). Another lane edits the Apply review further down
that file.

## Rules your work depends on (quoted)

- CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
  `insertOwnBook` and `ensureOwnBooks` run inside transactions: every read you add uses the handle passed in.
- CLAUDE.md Standing ruling: "A change to stored data or ids ships with a forward migration or boot pass and a test that a
  second boot changes nothing." (No data is changed here; the boot pass `ensureOwnBooks` only makes missing notes. Test that a
  second run makes nothing and changes no switch.)
- Owner 2026-11-16 (D53a): "Make both follow the new rule". Standing: "Go with the safest option for existing lorebooks":
  an existing lorebook's switch is never changed.
- The rule, `timelineDefaultFor(genre, preset)` in `src/lib/server/lorebooks/timeline.ts` (read it): a genre that does not
  resolve, or declares `timeline: 'required'` (Lair, Dungeon Crawler), is on; else the preset's boolean `defaults.timeline`;
  else off.

## Goal (item 1)

Today `insertOwnBook` (`src/lib/server/lorebooks/ownBook.ts` ~206) leaves `timeline_enabled` to the column default (**true**)
when its caller passes no `timelineEnabled` and the notes overlay nothing. Three callers pass none: the import of sessions
(`src/lib/server/sockets/import.ts` ~1347, ~1498), the `ownBookFor` fallback (same file ~160), and the boot pass
`ensureOwnBooks` (~273). Only `sockets/sessions.create.ts` (~733–797) asks `timelineDefaultFor` and passes the answer.

**The decision moves into `insertOwnBook`:** when `row.overlayOf == null` and `row.timelineEnabled === undefined`, it reads the
session's `genreId` and `presetId` (from `sessions`), resolves the genre the way create does (SDK `getGenre` from
`@serene-pub/sdk`, see `sessions.create.ts` ~733–741) and the preset row's `defaults` (`schema.sessionPresets`, by id; a
missing row = no preset; read its `defaults` even if disabled or withdrawn — say so in your report), and inserts
`timelineEnabled: timelineDefaultFor(genre, { defaults })`. Rules:

- An explicit `timelineEnabled` from a caller (create) still wins. `overlayOf` set: unchanged (copies the overlaid book's switch).
- One read of the session row serves both the calendar (`genreCalendarOf` already reads `genreId`) and the timeline: do not add
  a second select of the same row. Keep `genreCalendarOf`'s exported signature (grep its other callers).
- Do not change `sockets/import.ts` or `sessions.create.ts` unless something forces it (then stop and say why).
- Update the `insertOwnBook` JSDoc on `timelineEnabled` ("Absent, the column's default") to the new truth, briefly.
- The import sets neither genre nor preset: genre is the column default Story, no preset → **off**. This is intended.

## Goal (item 6)

`src/lib/server/sockets/sessions.creationModes.int.test.ts` ~341, the **second** test named "a following session is followed by
a following one" (it fails today: the clock is today's date where it expects all nulls). Owner ruling D52(b) 2026-11-16: "Keep,
it defaults from the current, last active point, but offer a branch/date picker as well". Re-pin it: the following session
starts **today** when the lorebook has no date anywhere. Compute "today" the way the code does (find how
`sockets/sessions.createStoryStart.int.test.ts` or other tl-2d tests pin today: `storyToday` in `state/storyTime.ts` ~906, which
time zone, whether hour/minute stay null). Change only the expectation (and the test title only if it must differ; say so).
Report old → new.

## Tests (new file, your choice of name beside `ownBook.ts` or under `sockets/`; reuse an existing int-test harness — look at
`src/lib/server/sockets/sessions.timelineDefault.int.test.ts` and `sessions.storyUndated.int.test.ts`)

1. The `ownBookFor` fallback, a session that exists and has no notes: once per **shipped Story preset** (core seeds: Minimal,
   Living, Rule Based — find their seeded rows / slugs) → off (or the preset's boolean if it ships one), and one session of a
   **required genre** (Lair or Dungeon Crawler) → on. An existing notes row is never changed by `ownBookFor`.
2. The import path: a session brought in by the import (drive the real import handler if a test already does — grep
   `import.ts` tests — else call `insertOwnBook` with exactly the import's arguments) → notes off.
3. `ensureOwnBooks`: a session with no notes gets notes by the rule (Story no preset → off; required genre → on); a **second
   run** makes 0 and changes no row's `timeline_enabled`; a session that already had notes (switch true) keeps true.
4. An explicit `timelineEnabled: true` passed to `insertOwnBook` for a Story session still gives true.

Int tests that open a DB inside an `it` need a 60 s timeout.

## How to run tests — only this form, one at a time, wait first

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-4-w1-<n>.log 2>&1"
```

Never pipe vitest into `head`. Run: your new test file, `src/lib/server/sockets/sessions.creationModes.int.test.ts`,
`src/lib/server/sockets/sessions.timelineDefault.int.test.ts`, `src/lib/server/lorebooks/timelineDefault.test.ts`, and any
existing test that calls `insertOwnBook` / `ensureOwnBooks` / `ownBookFor` and asserts `timelineEnabled` (grep; list them).
Then (wait first) `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p /home/jody/github/serene-pub` and report the
error count in your files. `npx prettier --check` your changed files (drift that predates you is fine; report it).

## Files owned

`src/lib/server/lorebooks/ownBook.ts` (the functions named above only), your new test file,
`src/lib/server/sockets/sessions.creationModes.int.test.ts` (that one test).

## Stop and ask (in your report, don't decide) when

A new exported name, setting or flag seems needed; the preset can't be read inside the transaction; a test outside your files
fails because of your change; anything else outside this brief.

## Report (your final message, under ~350 words)

Changed files; what `insertOwnBook` now does (one paragraph, incl. the disabled/withdrawn-preset choice); tests run with log
paths and pass/fail counts; item 6 old → new; anything noticed but not done.
