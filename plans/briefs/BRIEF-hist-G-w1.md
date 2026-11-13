# BRIEF — hist-G-w1: pipeline history writes default to story now; first-write fork moves inside `entries:create`

Supervisor: hist-G (plan `plans/PLAN-history-one-per-date-2026-11-10.md`, "Rulings, fourth round"). Repo `/home/jody/github/serene-pub`. Use absolute paths. Other sessions are editing nearby: `host.ts`, `writes.ts`, `entries.ts` carry **unrelated uncommitted work**. Run `git diff <file>` before you edit each file, edit with exact-string `Edit` calls only, and never touch a hunk you didn't make.

## Owner rulings this applies (2026-11-10, verbatim)

- **Default date:** "The session's story 'now' (Recommended)". A pipeline history write with no date files onto the session's story-now day, creating that day's entry if needed (replaces `writeDatingAt` in hist-B1's `fileOntoHistoryDay`).
- **Fork day:** "Keep it — scenes first". A branch session's direct history writes with content on its fork day stay refused.

## Goal

### Part 1 — `fileOntoHistoryDay` (`src/lib/server/pipelines/runtime/host.ts` ~2086-2190, and its call at ~11068)

1. **Default date = the session's story now.** Replace the `writeDatingAt` fallback. With no numeric `fields.year`, read `sessionStoryNowOf(tx, a.sessionId)` (`$lib/server/state/storyTime`, import lazily like the others in the helper) **on `tx`** (it runs after `forkedLoreLine`, so it sees the forked line). The date is `{ year: now.year, month: now.month ?? null, day: now.month != null ? (now.day ?? null) : null }` (time of day dropped — the same parts `historyDateOfSessionWrite` in `messages/writes.ts:308` takes). **Supervisor's decision:** do **not** apply `historyDateOfSessionWrite`'s `nextStoryDate` step for `from === "history"`: that step is for a person's "New history entry"; for an append it would make every undated pipeline write a new day. When `now` is null, refuse with the existing undated sentence (keep its 🚧 comment). Remove the now-unused `writeDatingAt` import from the helper. Update the helper's doc comment ("else the session's story now").
2. **Month or day without a year is refused before any fallback.** If `fields.year` is not a number and `fields.month` or `fields.day` is a number, throw `HostScopeError` with exactly: `` `${nodeKey}: a history date needs a year. Give this write a year in its fields, or leave the date out to use the story's day.` `` and a `// 🚧 Provisional copy: the owner has not seen this sentence.` comment above it.
3. **A day entry this helper creates keeps the anchors the old insert stamped.** Add `sourceMessageId: number | null` to the helper's argument `a`, and pass `target.sourceMessageId` from the `create-lore-entry` call site (~11070; `target` is in scope there). When `day.created`, inside `tx`, **before** `imprintMade` and before reading `stored`, run `tx.update(schema.lorebookEntries).set({ provenance: "pipeline", sourceMessageId: a.sourceMessageId }).where(eq(schema.lorebookEntries.id, day.historyEntryId))`. (The old plain insert stamped `{ provenance: "pipeline" }` through `entryInsert` and `sourceMessageId: target.sourceMessageId`; see ~11140-11150.) Do **not** change `historyEntryOfDate`'s insert.
4. **The fork refusal comes before anything is created.** After the date is resolved and before `historyEntryOfDate`, refuse when the line does not own the day (rule C). Do it through a builder exported from `src/lib/server/scenes/historyEntryOfDate.ts` (see "historyEntryOfDate.ts" below). Throw `HostScopeError(`${nodeKey}: ${sentence}`)`.
5. **Narrow the error wrapping.** Today the `try/catch` around `assertDateLands` + `historyEntryOfDate` wraps every `Error`. Wrap only refusals: an error whose `constructor === Error` (the asserts throw plain `Error`s) or `instanceof BranchRefusal` (find its import in host.ts; it comes from the lines module, as `historyEntryOfDate.ts:39` imports it) becomes `new HostScopeError(`${nodeKey}: ${e.message}`, { cause: e })`. Everything else (database faults, `HostScopeError`, non-Errors) rethrows unchanged. The builder call from item 4 sits inside the same `try` so a `BranchRefusal` from it is wrapped too.

### `src/lib/server/scenes/historyEntryOfDate.ts` (the builder export only)

The rule-C sentences live inline in `assertHistoryDateFree` (~229-257). Extract them, unchanged, into one exported function and have `assertHistoryDateFree` call it first:

```ts
/** Rule C's refusal for a history day the line does not own (...doc...), or null when it owns it. Throws `BranchRefusal` for a branch not of this book. */
export async function historyDayOwnerRefusal(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate }
): Promise<string | null>
```

It loads the book's branches, throws the existing `BranchRefusal` for a foreign `branchId`, builds the line, and returns the existing "shares everything up to …" sentence (fork date) or the existing dateless-fork sentence (keep its 🚧 comment), naming `historyOwnerStep(line, day)`'s line as today, with `day = dayOnly(date)`. `assertHistoryDateFree`: after its early return for no year, `const refusal = await historyDayOwnerRefusal(tx, {...}); if (refusal) throw new Error(refusal)`, then its one-per-date part as now (it may load the branches again for `name`/`line`/`cal`; one small extra query is accepted). Its behaviour and sentences must not change. The name `historyDayOwnerRefusal` is the supervisor's; use exactly it. No other change in this file.

### Part 1 tests — `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`

Read the whole file first; reuse its `world()` / `history()` / `entry()` / `rows()` helpers.
- Update the test at ~159-171 that pins `/a change to it there is an amendment/`: it now expects `/shares everything up to/`, and still that no row is made.
- Update the "with no fields, the write files onto the `writeDatingAt` entry" test to the story-now default, and add:
  - **story-now default with a session clock:** set the session's own clock (`sessions.storyClockYear/Month/Day`) to a day with no entry while an older dated entry exists → a new entry is created at the clock's day, and that new row has `provenance === "pipeline"` and `sourceMessageId` equal to the turn's anchor (find what `target.sourceMessageId` is for a book write in `lorebooks/ownBook.ts` `loreWriteTargetFor`; if it is null for an attached-book write, assert null and the provenance only, and say so in your report);
  - **story-now default, no clock:** with a dated entry and no clock, the write files onto that entry (story now from history), and no new row;
  - **month without year refused:** `fields: { month: 3 }` → `/a history date needs a year/`, nothing written;
  - **fork refusal with no churn:** on the fork (`world({ fork: true })`), a date on or before year 4 → `/shares everything up to/`, and no row anywhere in the book;
  - **a database fault is not wrapped:** make `historyEntryOfDate` throw an `Error` subclass once (e.g. `vi.mock("$lib/server/scenes/historyEntryOfDate", async (orig) => ({ ...(await orig()), historyEntryOfDate: vi.fn(...) }))` with a module-level switch, delegating to the real one otherwise) → the rejection is that subclass instance, **not** a `HostScopeError`. Keep the mock from affecting the other tests.

### Part 2 — hist-E follow-ups

6. **`src/lib/server/messages/writes.ts`:** `sessionLoreWrite` **drops** its `await ensureSessionLine(db, sessionId)` call (~284-286) and its comment, and the now-unused static import of `ensureSessionLine` (line 41) if nothing else uses it. Rewrite the doc comment's last sentence (~251-252) honestly: `sessionLoreWrite` reads the line as it stands and forks nothing; its caller (`entries:create`) forks a riding branch session's own line inside its transaction, after every check, so a refused write forks nothing. Do not touch the `LIBRARY_NEEDS` hunk (another session's).
7. **`src/lib/server/sockets/entries.ts` `createEntry` (~690-935):** inside `db.transaction(async (tx) => …)` (~809), right after `await lockBookCalendar(tx, data.lorebookId)` and before the date checks, when `params.sessionId != null`: `await ensureSessionLine(tx, params.sessionId)`, then set `data.branchId = (await sessionReadingOf(tx, params.sessionId))?.branchId ?? null`. **Supervisor's decision:** re-reading the reading (not taking `ensureSessionLine`'s return value raw) keeps the answer identical to what `sessionLoreWrite` used to return for own-book and stale-branch sessions. Import `ensureSessionLine` (`$lib/server/lorebooks/sessionLine`) and `sessionReadingOf` (`$lib/server/state/reading`) as the file already imports its neighbours (check whether either is already imported). Use **only `tx`** inside the transaction. Add a two-line comment: the session's first write forks its own line here, inside the write's transaction and after every check before it, so a refused write forks nothing. Change nothing else in `entries.ts`.
8. **Tests — `src/lib/server/lorebooks/sessionLine.int.test.ts`** (read it whole first):
   - The hist-E test that expects `sessionLoreWrite` to fork (in "sessionLoreWrite forks on first write", ~441-end) is now wrong: change it to assert `sessionLoreWrite` forks nothing (flag stays set), and move the "forks once / refusal forks nothing" assertions to `entries:create` (next bullet).
   - **New file `src/lib/server/sockets/entries.firstWriteFork.int.test.ts`** (model the socket/handler fixture on `src/lib/server/sockets/entries.sessionWrite.int.test.ts`): (a) a riding branch session's first `entries:create` with `sessionId` forks its line once and the row lands on the new line; (b) a riding session's `entries:create` refused **inside the transaction** (e.g. a content write onto a day already taken on its line → `assertHistoryDateFree` refuses) leaves `line_on_first_write` set, `lorebook_branch_id` unchanged, and no new `lorebook_branches` row.
   - **Other-book scene stays put** (in `sessionLine.int.test.ts`, in the "carries the session's uncompiled scenes" describe): the session also has an uncompiled scene in a **second book**, on the same `branchId` value as the line the session rides (null = main is fine), and after the first write that scene's `branchId` is unchanged.

## Files owned (edit only these)

- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.ts` — only `fileOntoHistoryDay` and its `create-lore-entry` call site's argument list
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`
- `/home/jody/github/serene-pub/src/lib/server/scenes/historyEntryOfDate.ts` — the builder extraction only
- `/home/jody/github/serene-pub/src/lib/server/messages/writes.ts` — the call, import and doc comment only
- `/home/jody/github/serene-pub/src/lib/server/sockets/entries.ts` — the fork call and its imports only
- `/home/jody/github/serene-pub/src/lib/server/sockets/entries.firstWriteFork.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/lorebooks/sessionLine.int.test.ts`

## Files readable

Anything. Useful: `src/lib/server/lorebooks/sessionLine.ts` (the fork; its header comment at 26-37 will go stale — **don't edit it**, it is not yours; note it), `src/lib/server/state/storyTime.ts:358` (`sessionStoryNowOf`), `src/lib/server/state/reading.ts:311` (`sessionReadingOf`), `src/lib/shared/lorebooks/lineReading.ts:325` (`historyOwnerStep`), `src/lib/server/lorebooks/ownBook.ts` (`loreWriteTargetFor`).

## Out of scope (write down, never build)

- Changing rule C, the fork-day refusal, or `historyEntryOfDate`'s insert.
- `sessionLine.ts` comments; docs; NOMENCLATURE (another lane).
- Any other `host.ts` region (lore gate data, other ports).

## Stop and ask when

- You would need a name other than `historyDayOwnerRefusal`, or copy other than the sentence in item 2.
- A refusal you expected to be a plain `Error` turns out to be a subclass (or vice versa), so item 5's rule would wrap a DB fault or leave a refusal unwrapped.
- Moving the fork into the transaction would change a check's outcome before the transaction (e.g. `assertAnchorEntry` with the riding line) in a way a test shows.
- Anything needs a migration, a setting, or a file outside this list.

## Rules (quoted; they apply to you)

- CLAUDE.md Hard rule: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."*
- CLAUDE.md Hard rule: *"Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."*
- CLAUDE.md: *"It is a **session**, never a *chat*."*
- CLAUDE.md §Decisions: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."*
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand (tabs, double quotes, no semicolons, as the files around them).
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`.)
- Int tests that open a DB inside an `it` need a 60 s timeout. **Never pipe vitest into `head`.** Run vitest only in a capped scope:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
- Typecheck: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . 2>&1 | grep -E "host.ts|historyEntryOfDate|writes.ts|entries.ts|entries.firstWriteFork|sessionLine|historyWrites" ; echo tsc-done'`
- Scratch files start with `hist-G-w1-`.

## Done means

- Tests green: `host.historyWrites.int.test.ts`, `sessionLine.int.test.ts`, `entries.firstWriteFork.int.test.ts`, plus still green: `src/lib/server/sockets/entries.sessionWrite.int.test.ts`, `entries.historyDateUnique.int.test.ts`, `entries.lines.int.test.ts`, `entries.redateLines.int.test.ts`, `src/lib/server/scenes/historyEntryOfDate.int.test.ts`, `src/lib/server/messages/loreLinks.int.test.ts`.
- `tsc` clean for these files.
- **Report** (your final message, no file): changed files with the hunks you made (line ranges), tests run with pass counts, decisions you made, anything that made you stop, Noticed-not-done.
