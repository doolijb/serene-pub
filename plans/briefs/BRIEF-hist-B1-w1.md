# BRIEF — hist-B1-w1: pipeline history writes in the core host

Supervisor: lane hist-B1. Repo `/home/jody/github/serene-pub`. Report to `plans/briefs/REPORT-hist-B1-w1.md` (if the harness refuses the write, put the whole report in your final message).

## Goal

Two outlet cases in `src/lib/server/pipelines/runtime/host.ts`, plus one new int test file.

### 1. `core:outlet/create-lore-entry` with `entryType` history (case at ~`host.ts:10828`)

When the resolved `typeId === HISTORY_TYPE_ID` (`"core:entry/history"`, `$lib/shared/entries/types`), the write never inserts a second row for a date. It files onto **the day's one entry**:

Inside the existing transaction, after `const line = await forkedLoreLine(...)` (the tx already holds `pg_advisory_xact_lock(lorebookId)`, which IS `lockBookCalendar`):

1. **Date.** From the checked `fields` when `typeof fields.year === "number"`: `{ year, month: fields.month ?? null, day: fields.day ?? null }`. Else the session's dating: `(await writeDatingAt(tx, line.reading))?.date` (`$lib/server/state/reading`). Neither → refuse:
   `` `${node.key}: history needs a date. Give this write a year in its fields, or give the story a dated history entry first.` `` (mark it `// 🚧 Provisional copy: the owner has not seen this sentence.`). It must never fall through to the field default Year 1. An undated legacy history row (no numeric `fields.year`) is never the target — the helpers below already ignore them; keep it so.
2. `await assertDateLands(tx, lorebookId, date)` (`$lib/server/state/storyTime`), as the socket create does (`sockets/entries.ts:822`).
3. `const day = await historyEntryOfDate(tx, { lorebookId, branchId: line.branchId, date }, { create: true })` (`$lib/server/scenes/historyEntryOfDate`). It finds the entry the line reads on that day (ties: lowest id, `historyEntryOver`), or creates an empty one on the line that owns the date (rule C, `historyOwnerStep`; may be an ancestor line).
4. Read the stored row. When `day.created && anchor`, `imprintMade(tx, anchor, { lorebookId, subject: "entry", subjectId })` **before** the content change, so a retake removes the made row after reverting its content.
5. Append through the **existing imprinted change path** `changeLoreEntry({...}, tx)` (defined ~`host.ts:2001`, inside `createHost`): `content` = stored content when blank → the new content; else `` `${stored}\n\n${new}` `` (one blank line between paragraphs; don't double it if the stored text already ends in whitespace — trim the stored end). `name: undefined` (history has no title). `patch`: the checked `fields` minus `year`, `month`, `day`. Do **not** invent another write path. `changeLoreEntry` refuses a stored row on another line than the session's (a fork's day owned by its parent) with its existing sentence — let that refusal stand; the transaction rolls back, so no empty parent entry is left behind.
6. `match` is not consulted for history (the date is the match). `links` still write from the day entry's id. The Exits-line step stays location-only as now.
7. Run records: `day.created` → `record(node, "lore_entry", id, "created")`; else, when it changed, `"updated"`. `recordLoreSources` when `checked` and (created or changed), as now. Don't run the later generic `if (created) imprintMade(...)` a second time for the history row.
8. **Receipt note** when the day's entry already existed (`!day.created`): add to the result's `notes` array (beside any `checked.notes`) exactly
   `` `filed onto ${formatDate(dayOnly(day.date), calendar)}'s entry` `` — `formatDate`/`dayOnly` from `$lib/shared/lorebooks/storyDate`, `calendar = await bookCalendarOf(tx, lorebookId)`.
9. Result shape: a created day entry returns as a new row does now (`{ id, lorebookId, route, linkIds?, notes? }`); an existing day entry returns the shape the `match` path returns now (`{ id, entryId, lorebookId, route, matched: true, written: false, linkIds?, notes }`).

Wrap plain `Error`s from `assertDateLands` / `historyEntryOfDate` (they throw `Error` / `BranchRefusal`) as `HostScopeError(`${node.key}: ${e.message}`)`, leaving `HostScopeError`s as they are. Follow the file's habit of lazy `await import(...)` for these modules.

Every other entry type keeps today's path byte-for-byte.

### 2. `core:outlet/update-lore-entry` (case at ~`host.ts:11137`)

When `stored.typeId === HISTORY_TYPE_ID` and the patch names any of `year`/`month`/`day`: the moved date is each part from the patch when the patch has the key, else the stored part (`historyEntryDate(stored.fields)`). When its year is a number and its day (`dayOnly`, `compareDates`) **differs** from the stored one (or the stored row is undated), run inside **one** transaction with the change:
```
lock (pg_advisory_xact_lock(lorebookId))
assertDateLands(tx, lorebookId, moved)
assertHistoryDateFree(tx, { lorebookId, branchId: stored.branchId ?? null, date: moved, exceptId: entryId })   // scenes/historyEntryOfDate
assertRedateKeepsLines(tx, entryId, moved)   // utils/forkHistory
changeLoreEntry(change, tx)
(+ the existing recordLoreSources / settleThrough when `checked`)
```
A save that resends the same date runs none of these (a doubled date must stay editable). Same `HostScopeError` wrapping. Restructure only as far as needed: today the `checked` branch opens a transaction and the unchecked one calls `changeLoreEntry(change)` (which opens its own); route "re-date or checked" through the transaction path. Mirror of the socket: `sockets/entries.ts:1049-1105`.

## Tests — new `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`

Model it on `src/lib/server/lorebooks/imprints.int.test.ts` (its `world()`, `host()`, `swipe`, `takeRunWritesElsewhere` retake, `vi.mock("$lib/server/db")` + `createTestDb`, `fs.mkdtemp(... "serene-pub-vitest-hist-B1-...")`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). For a branch session see `host.forkTiming.int.test.ts` / `lorebook_branches` (fork year/month/day) and `sessions.lorebookBranchId`. History rows: `typeId: HISTORY_TYPE_ID, typeVersion: 1, position, content, fields: { year, month, day }`. Cases:

1. Two pipeline history creates (`params: { entryType: "core:entry/history" }`, `fields: {year, month, day}`) on one date → one history row, content holds both paragraphs separated by one blank line; the second result has `notes` containing `filed onto <formatDate(...)>'s entry`; the first created the row.
2. No `fields`, session reads a dated entry → appends to that entry (the `writeDatingAt` one).
3. A retake (swipe via `retractStateAnchoredTo`, or `takeRunWritesElsewhere`) takes the appended paragraph back (content as before). And a day entry the write created is removed by the retake.
4. Fork (session on a branch forked at a date): a create dated **after** the fork lands on the branch (`branchId` = the branch); a create dated **on or before** the fork is refused, and no history row was created on main (the rollback).
5. Undated: no `fields` and no dated history the session reads (an undated legacy history row present) → refused with "history needs a date"; no row created, the legacy row untouched.
6. Update port: re-date onto a taken day → refused ("already has a history entry for"); a branch entry re-dated on/before the fork → refused ("shares everything up to"); a date the book cannot place → refused by `assertDateLands` (e.g. a book calendar that refuses the month, or a day without a month — whatever reaches `assertDateLands`' sentence, not the field checker's); a save resending the stored date on a doubled date with a content change → passes.

Also run the existing neighbours and report results: `src/lib/server/lorebooks/imprints.int.test.ts`, `src/lib/server/pipelines/runtime/loreSources.int.test.ts`, `src/lib/server/pipelines/runtime/host.forkTiming.int.test.ts`, `src/lib/server/pipelines/runtime/lorebookEntries.withLinks.int.test.ts`, `src/lib/server/pipelines/runtime/lorebookEntries.ownBook.int.test.ts`, `src/lib/server/state/ownNotesLine.int.test.ts`, `src/lib/server/sockets/sessions.retraction.int.test.ts`.

Typecheck: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . 2>&1 | grep -E "host\.ts|historyWrites" ; echo tsc-exit=$?'` — report any error in your files.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` — **only** the `create-lore-entry` and `update-lore-entry` cases (a small helper inside `createHost` next to `changeLoreEntry` is fine).
- new `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`

## Files readable

Anything. In particular `scenes/historyEntryOfDate.ts`, `state/reading.ts` (`writeDatingAt`, `historyEntryOver`, `historyEntryDate`), `state/storyTime.ts`, `utils/forkHistory.ts` (`assertRedateKeepsLines`), `sockets/entries.ts:800-870,1040-1110`, `lorebooks/imprints.ts`, `shared/lorebooks/lineReading.ts`.

## Out of scope (never build)

`note-scene@1`, `update-cast-member@1`, Dungeon Crawler, SDK, docs, `entries.ts`, scenes, lines, `writeTools.ts` (another worker). DC tests that go red because the cairn's undated history write is now refused belong to lane hist-D — don't edit them.

## Rules (quoted)

- host.ts already holds a large uncommitted diff from other work. Check `git diff` on it before editing and never overwrite or reformat anything outside your two cases. **Never run `prettier --write` on a file**; format only your own hunks by hand (tabs, no semicolons, double quotes, as the file does). `npx prettier --check <file>` is fine to look.
- CLAUDE.md Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `changeLoreEntry(..., tx)` uses `at` everywhere when given; keep every read inside your transaction on `tx`.
- CLAUDE.md §Decisions: decide implementation inside scope and name each choice in your report; anything a user sees beyond the two sentences above, a new name, setting, migration, or another write path → stop and say so in your report, don't build it.
- Copy (STYLE-GUIDE §10): "errors say what went wrong and what to do."
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `hist-B1-w1-`.
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.

## Report

Changed hunks (file:line ranges), each implementation choice, tests run with pass/fail counts, anything that surprised you (especially: does the retake remove a created day entry; does `fieldsFindings` refuse `fields` without `year`), and Noticed-not-done.
