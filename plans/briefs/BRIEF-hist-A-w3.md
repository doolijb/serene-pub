# BRIEF — hist-A-w3: the entries socket paths refuse or reuse a taken history date

Supervisor: lane hist-A. Repo `/home/jody/github/serene-pub`. Worker w1 has already built the helpers you call (read them first): `assertHistoryDateFree` and `historyEntryOfDate` / `pickEntryOfDate` in `src/lib/server/scenes/historyEntryOfDate.ts`, `historyOwnerStep` in `src/lib/shared/lorebooks/lineReading.ts`, `historyEntryOver` in `src/lib/server/state/reading.ts`. Don't edit those files. `src/lib/server/sockets/entries.ts` carries uncommitted work by others: keep it, add to it. Other sessions may edit nearby: before each edit, check the file's mtime and `git diff <file>` so you never overwrite live work you didn't make.

## Owner rulings this work applies (2026-11-10, quoted)

- **★H1:** "Reuse the existing". A person's direct create, or re-date onto a taken date, is refused. The paths that mean "the entry of this day" find the existing entry instead.
- **★H2, rule C:** "A line owns a history entry only for a date **strictly after** its fork date. On or before it, the date's entry belongs to the nearest ancestor that may own it. A fork's version of such a day is a line amendment. A dateless fork owns no dated history. When an ancestor has no entry for that day, a day-entry path may create an **empty** one on the owning line."
- **★H3:** "New dated writes on a doubled date are refused until it's fixed." Existing duplicates are never merged automatically.
- **Partial dates are distinct**: *Year 2*, *Year 2 Month 5* and *Year 2 Month 5 Day 3* are three dates. Undated rows are ignored.
- The two refusal sentences (built into `assertHistoryDateFree`; your tests assert them **exactly**):
  - *"‹line› already has a history entry for ‹date›. Open it, or choose another date."*
  - *"‹line› shares everything up to ‹fork date› with ‹parent›. Change that day here as an amendment, or choose a later date."*
  - main is named `main`; a free-form date is spelled like `Year 5, Mo. 1, Day 2` (`formatDate`).
- Bulk and system writers (import, attic, starters, provided books, fold, line delete) are **not** touched. Undo and restore are exempt.

## What `assertHistoryDateFree(tx, { lorebookId, branchId, date, exceptId? })` does

Under the caller's `lockBookCalendar`, inside the caller's transaction (`tx` only): no-op for an undated date; throws the rule-C sentence when the target line doesn't own that day; throws the one-per-date sentence when the target line reads another history row (not `exceptId`) on that day; `BranchRefusal` for a branch that isn't the book's. `historyEntryOfDate(tx, { lorebookId, branchId, date }, { create })` answers the entry the line reads on that day (lowest id of several), and with `create: true` makes an empty one on the owning line when none.

## Goal — `src/lib/server/sockets/entries.ts`, the history paths only

1. **`entries:create`** (`createEntry`, ~:681; `assertDateLands` is called inside its transaction ~:807).
   - **Session write, blank content** (`params.sessionId != null`, the type's `roles.order` (history), trimmed `data.content === ""`): a **day-entry path**. Inside the existing transaction, after `lockBookCalendar` and `assertDateLands`, call `historyEntryOfDate(tx, { lorebookId: data.lorebookId, branchId: data.branchId ?? null, date }, { create: true })`, read that row back with `tx`, and use it as `newEntry` instead of inserting (no member, no sources: assert in code comments why none applies, or skip the reuse path when `castCharacterId` or `sources` is set). The rest of the handler (emit `entries:create` with `{ entry }`, `afterWrite`) runs as today, so `SummarizeLoreModal`'s "New" history button (`createBlankHistoryEntry`, `src/lib/client/components/modals/SummarizeLoreModal.svelte` ~:690, and `handleHistoryEntryCreate` ~:597) selects the found entry. Read those two client functions and confirm in your report that the reply is handled (don't edit them).
   - **Every other dated history create** (a person's create, and a session write that carries content): call `assertHistoryDateFree(tx, { lorebookId: data.lorebookId, branchId: data.branchId ?? null, date })` right after `assertDateLands`. A session write with content on a taken day is therefore refused with the first sentence: `entries.ts` has no imprinted change path to append through, so the lane reports this instead of appending (supervisor decision; ★ in the lane report). Put a one-line comment saying so.
2. **`entries:update` re-dating a history entry** (~:996-1050, the locked transaction where `assertDateLands` and `assertRedateKeepsLines` run): when `movedDate` is set **and differs from the stored date** (`historyEntryDate(existing.entry.fields)` null, or `compareDates(dayOnly(stored), dayOnly(movedDate)) !== 0`), call `assertHistoryDateFree(tx, { lorebookId: existing.entry.lorebookId, branchId: existing.entry.branchId ?? null, date: movedDate, exceptId: params.entry.id })` after `assertDateLands` and before `assertRedateKeepsLines`. A save that resends an unchanged date must never be refused, even on a doubled date (else a doubled entry could not have its text edited).
3. **`entries:iterateNext`** (~:1719-1800): a day-entry path. Inside the transaction, after `next` is computed and `assertDateLands` passes, ask `historyEntryOfDate(tx, { lorebookId, branchId, date: next }, { create: false })`. **Found:** read that row with `tx` and return it as the answer; no shifting, no insert. **Not found:** insert as today, but with `branchId: historyOwnerStep(await lineOfBook(tx, lorebookId, branchId), next).branchId` (rule C: the owning line, possibly an ancestor; the row is empty). Update the handler's doc comment in its voice. The broadcast and reply stay the same shape. Read `src/lib/client/lorebooks/sections/HistoryListActions.svelte` (`nextDate`) and `src/lib/client/components/sessionPage/requests/startHistoryEntry.ts` and confirm in your report that an answer naming an existing entry is handled (they match by `requestId` and open/resolve the entry id); don't edit them.

Imports: from `$lib/server/scenes/historyEntryOfDate` (`assertHistoryDateFree`, `historyEntryOfDate`), `historyOwnerStep` from the shared line module, `historyEntryDate`/`lineOfBook` from `state/reading` (check what is already imported). No other behaviour change in `entries.ts`.

## Files owned

- `src/lib/server/sockets/entries.ts` (the three paths above)
- new `src/lib/server/sockets/entries.historyDateUnique.int.test.ts`
- existing `src/lib/server/sockets/entries*.test.ts` files **only** where a test pins the old duplicate-tolerant behaviour (two history entries on one date made through these handlers): update the test's data or expectation, never weaken the thing it checks, and list each one in your report with why.

## Files readable

`src/lib/server/sockets/entries.sessionWrite.int.test.ts` and `entries.redateLines.int.test.ts` (harness: `vi.mock("$lib/server/db")`, `fakeSocket`, seeding branches with fork parts and sessions), `src/lib/server/messages/writes.ts` (`sessionLoreWrite`, `historyDateOfSessionWrite`; don't edit), the client files named above.

## Done means

New `entries.historyDateUnique.int.test.ts` (every `test` that opens a DB: `60_000` timeout), through the socket handlers:
- create on a taken main date refused with the exact first sentence; nothing written;
- re-date onto a taken date refused with the exact first sentence; a content edit that resends the unchanged date of a **doubled** date (two rows inserted directly) passes; a re-date away from a doubled date passes;
- partial dates distinct: Y2, Y2 M5, Y2 M5 D3 all create on main;
- ★H3: a third create on a doubled date refused;
- a fork ("north", forked at Y5 M1 D3) creating its own entry at its fork day and at an earlier day is refused with the exact second sentence (`north shares everything up to Year 5, Mo. 1, Day 3 with main. …`); at Y5 M1 D4 it passes;
- a sibling fork ("south", same fork date) creates at the same post-fork date as north: passes;
- main creating a date on which north holds its own post-fork entry: passes (main is never refused because of a fork);
- `entries:iterateNext` onto a day that already has an entry on the line: the answer's entry is that entry and the row count doesn't grow; from north onto a day at or before its fork with no main entry: one empty row is made on **main**;
- a session write (blank history `entries:create` with `sessionId`) on a day that already has an entry: the answer is that entry and the row count doesn't grow; with content: refused with the first sentence.

Run (capped, verbatim rule):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/sockets/entries; echo test-exit=$?'`
(that path prefix runs every `entries*.test.ts`), and typecheck: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . 2>&1 | grep -E "sockets/entries" ; echo done'`. Report errors in your files only.

## Out of scope (write down, never build)

`messages/writes.ts`, `liveScenes.ts`, `sessionLine.ts` (lane hist-E); pipeline ports / `host.ts` (hist-B); `sockets/scenes.ts`; any client file; docs; NOMENCLATURE; bulk writers; a DB index; any migration.

## Stop and ask when

A name beyond those in this brief is needed; a path can't follow the rule without reshaping data; rule C gives an answer that looks wrong for a real flow (say which, with the test); anything needs a file not listed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This work needs no `sdk:build`.)
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently. Never add a top-level `await` to `db/index.ts`. Never seed a row at a hardcoded id.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`.
- Views never call `toaster`. Scratch files start with `hist-A-w3-`.

## Report

`plans/briefs/REPORT-hist-A-w3.md`: changed files, each test file run with pass/fail counts, tests whose old expectation you changed (and why), the two client confirmations, assumptions, **Noticed, not done**.
