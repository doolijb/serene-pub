# BRIEF — worker `tl-2b-w2`: no history entry falls back to Year 1, Month 1, Day 1 (and a guard test)

Supervisor: lane `tl-2b`. App repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/` unless
said otherwise.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: nothing in the SDK changes in this task. Never `prettier --write`, nor on a scratch copy.)

## The rule (owner, 2026-11-16)

"There shouldn't be a scenario where it defaults to 1-1-1." Each site below uses the story's now when there is
one; with none, a person's write is **refused with a sentence that says how to give the story a date** (the
person's form keeps asking for a year; it never invents Year 1). Each sentence is provisional copy: mark it in the
code with `// 🚧 Provisional copy: the owner has not seen this sentence.` (the form already used at
`pipelines/runtime/host.ts` 640).

## The sites

1. **`messages/writes.ts` 319–341 `historyDateOfSessionWrite`**: today returns `{ year: 1, month: 1, day: 1 }`
   when the session has no story now. Change it to return `null` then (type `… | null`), and fix the JSDoc (it
   currently says "a line with no dates at all starts at Year 1, Month 1, Day 1"). Its only callers are
   `sockets/entries.ts` ~980 and ~1079.
2. **`sockets/entries.ts` ~957–984 and ~1066–1083** (a session's history create with no year): when
   `historyDateOfSessionWrite` returns `null`, refuse (`throw new Error(...)`, as the surrounding refusals do)
   with: *"This story has no date yet. Give this history entry a year, or set the story clock in the lorebook's
   Book settings first."* Both places (the second is the re-date after the session's first write forks its line).
3. **`sockets/entries.ts`, a history create with no year and no session** (the lorebook view's path): today the
   row reaches `entryInsert` (`utils/lorebookEntries.ts` 405–420), which fills the SDK-declared default year 1
   (`fieldDefault`). Before that, refuse a history entry (`entryDeclaration(typeId)?.roles.order`) whose `year` is
   null with *"A history entry needs a year."* Do NOT touch `entryInsert` or the SDK default (the default's removal
   waits on an owner question about imports). Find which client form sends this path and whether it always sends a
   year today; report it (do not edit client files).
4. **`scenes/historyEntryOfDate.ts` 147–160** (`historyEntryOfDate(…, { create: true })` with `date: null` on a
   line with no dated history entry; reached by a person's **Compile** of the *Undated* scenes,
   `sockets/scenes.ts` ~1470): today it makes an entry dated Year 1, Month 1, Day 1. Change: take the line's
   stored clock — `storyNowOf(tx, lorebookId, branchId, { line })` from `state/storyTime.ts` (with no dated history
   on the line its answer, when non-null, is the line's clock) — and create the entry on that clock's day
   (`dayOnly`); when it is null, `throw new Error(...)` (a plain `Error`: `sockets/scenes.ts` catches it and
   refuses with its message) with: *"These scenes have no date, and this line has no dated history entry or story
   clock to file them under. Set the story clock in the lorebook's Book settings, or date a history entry, then
   compile."* Mind the import cycle: `historyEntryOfDate.ts` already imports from `state/storyTime`; check
   `storyNowOf` does not pull a cycle that breaks at load (run the tests). Fix the module JSDoc (lines 14–17) and
   the inline comment (151–153). **Inside a transaction use only `tx`.**
5. **The guard test** (new: `src/lib/server/state/noYearOneFallback.guard.test.ts`, a plain unit test reading
   source files with `node:fs`): it fails on a literal year-1 fallback in the story-time, entries, scenes and
   import modules: `state/storyTime.ts`, `state/reading.ts`, `sockets/entries.ts`, `messages/writes.ts`,
   `utils/lorebookEntries.ts`, `utils/lorebookImportMapper.ts`, every non-test `.ts` under `scenes/`. Strip
   comments first (line and block), then match e.g. `/\byear\s*(?::|\?\?|\|\|)\s*1(?![\d.])/`. An allow-list,
   checked both ways (an entry that no longer matches fails too, so it shrinks when the site goes), holds exactly
   one site today: `state/storyTime.ts` `FIRST_STORY_DAY` (the clock outlet's start with no clock and no present),
   with the reason "waits on the owner's ruling on the real calendar (DISCUSS-LATER D49b)". Each failure message
   names the file, the line and the rule. Look at `sessions/bookLock.guard.test.ts` (lane tl-2a, new) for the
   house style of a guard test.

## Files owned

`messages/writes.ts`, `sockets/entries.ts` (the sites above only: other lanes have edits nearby; re-read the
region right before each edit and make small targeted edits), `scenes/historyEntryOfDate.ts`, the new guard test,
and these tests: `scenes/historyEntryOfDate.int.test.ts`, `sockets/scenes.compileLine.int.test.ts`,
`sockets/entries.sessionWrite.int.test.ts`, plus any test that pins the old Year 1 from these sites (find them:
grep the tests that call `historyDateOfSessionWrite` or compile with no date).

## Files readable

Anything. In particular `state/storyTime.ts` 255–330 (`storyNowOf`), `state/reading.ts` 430–465,
`sockets/scenes.ts` 1420–1500, `pipelines/runtime/host.ts` 600–660 (the pipeline's history refusal, already
built), `utils/lorebookEntries.ts` 400–430, `entries/declarations.ts` 195–270.

## Out of scope

`state/storyTime.ts` (another worker is editing it: read only), `FIRST_STORY_DAY`, the SDK and its declared
default, `entryInsert`, the import mapper, the export (`utils/lorebookExportBuilder.ts` 382/392 also writes Year 1:
note it, do not touch), every client file (`client/lorebooks/sections/index.ts:232`,
`client/components/modals/CompileHistoryEntryModal.svelte:107`, `client/lorebooks/time/*`,
`SessionLorebookReading.svelte:177` default year 1: note, do not touch), `sockets/scenes.ts` (its comment at
1475 goes stale: note it), docs.

## Pinned tests to change on purpose (list each in your report: old → new)

- `scenes/historyEntryOfDate.int.test.ts` ~181 "no date: the newest dated entry, else Year 1, Month 1, Day 1" →
  the newest dated entry; else the line's clock's day; else refused with the sentence (nothing written).
- `sockets/scenes.compileLine.int.test.ts` 1389 and 1411 (Year 1 made and compiled / a moment before Year 1
  refused) → with no clock: refused with the sentence, nothing made; with a line clock: the entry is made on the
  clock's day and compiled (and the moment-before check still refuses a moment before it).
- Any test of `historyDateOfSessionWrite` with no now → `null`; the socket path → refused with the sentence.

## Stop and ask when

A site needs a file outside Files owned; a shipped genre's ordinary turn would now refuse (these are person
paths; if a pipeline reaches one, stop and say which); a sentence must differ from the ones above; a test
outside the list pins the old behaviour in a way that is not just Year 1 from these sites.

## Tests (capped, never piped into `head`)

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2b-w2-<n>.log 2>&1"
```
An int test that opens a DB inside an `it` needs a 60 s timeout. If a run fails on imports from `@serene-pub/*`
(another lane may be rebuilding the SDK), wait a few minutes and rerun once before investigating.

Run: the guard test; the three test files above; `sockets/entries.historyDateBounds.int.test.ts`,
`sockets/entries.storyCalendar.int.test.ts`, `sockets/entries.lines.int.test.ts`,
`sockets/entries.unfiledSceneCount.int.test.ts`, `state/sessionLoreWrites.int.test.ts` as regressions; new tests
for each refusal (the session path with no now; the no-session path with no year; compile with no date, no dated
entry: with and without a line clock). Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/tl-2b-w2-tsc.log 2>&1` and report errors in
your files (other lanes may have errors of their own: list them, do not fix them). `npx prettier --check` your
files.

## Report (your final message)

Changed files; per site what it does now; the client path for site 3 and whether it always sends a year; pinned
tests changed (old → new); tests run with pass/fail counts and log paths; every sentence added; **Noticed, not
done**.
