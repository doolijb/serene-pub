# BRIEF — hist-A: one history entry per date (core), and the Loose-ends chores

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read **all owner-ruling sections**, **§ Build scope items 1 and 8**, the challenge answers, and the research sections **"What the code does today"** and **"★H2 design"**. GO 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions may be editing nearby. Before each edit, check the file's mtime and `git diff` so you never overwrite live work you didn't make.

## Rulings this lane applies (owner, 2026-11-10)

- **★H1:** "Reuse the existing". A person's direct create, or re-date onto a taken date, is refused. The paths that mean "the entry of this day" find the existing entry instead.
- **★H2, rule C accepted.** A line owns a history entry only for a date **strictly after** its fork date. On or before it, the date's entry belongs to the nearest ancestor that may own it. A fork's version of such a day is a line amendment (`compileSaveOf`, already built). A dateless fork owns no dated history. When an ancestor has no entry for that day, a day-entry path may create an **empty** one on the owning line.
- **★H3:** existing duplicates are **reported in Loose ends**, never merged automatically. New dated writes on a doubled date are refused until it's fixed.
- **Partial dates are distinct** (lead default, from `compareDates`, `shared/lorebooks/storyDate.ts:88`). *Year 2*, *Year 2 Month 5* and *Year 2 Month 5 Day 3* are three dates. Undated rows (no numeric year) are ignored.
- **Bulk and system writers land rows unchanged** (challenge 1). This covers import, attic ETL, starters and primers, provided-book upgrade, fold and line delete. They do **not** call the check and never merge or skip; the chore surfaces any doubled date. Undo and restore are exempt.

## Goal

1. **The check** goes in `src/lib/server/scenes/historyEntryOfDate.ts`. Keep the file where it is; don't move or rename it (lead decision: it avoids churn across lanes).
   - `assertHistoryDateFree(tx, { lorebookId, branchId, date, exceptId? })` throws a refusal error (follow the shape `assertDateLands` / `assertRedateKeepsLines` already use) when either holds:
     - (a) any line of the book reads both the row being written or moved and another history row with `compareDates === 0`, using the existing line helpers (`rowReadsOnLine`, `lineOf`, the loop in `utils/forkHistory.ts:395-448`);
     - (b) per rule C, the target line doesn't own that date.
   - The two refusal sentences (exact copy, ★ for the owner if you think they read wrong):
     - *"‹line› already has a history entry for ‹date›. Open it, or choose another date."*
     - *"‹line› shares everything up to ‹fork date› with ‹parent›. Change that day here as an amendment, or choose a later date."*
     - ‹line› and ‹parent› use the line names the UI already shows (main = the book's name or the existing main-line word; check how the moment bar names lines). ‹date› uses the book calendar's spelling.
2. **`historyOwnerStep(line, date)`**: a pure function in `src/lib/shared/lorebooks/lineReading.ts` that returns which step of the line chain owns a dated history day under rule C. Add cases to its existing cases file (`lineReading.cases.ts` or equivalent) for main, a dated fork, a fork of a fork, a dateless fork, and partial dates.
3. **Reuse (★H1):** `historyEntryOfDate(..., { create: true })` (compile's find-or-create, `:94-162`) resolves the owner via `historyOwnerStep`. It finds the entry the asked line reads for that date, else creates an empty one **on the owning line**. Today it creates on the asked line at any date. Compile's save on a fork stays a line amendment.
4. **Unify the two tie-breaks:** `pickEntryOfDate` (`historyEntryOfDate.ts:69`, highest position) and `writeDatingAt` (`src/lib/server/state/reading.ts:447`, lowest id) must pick the **same** row when a date is doubled. Pick one rule, use one helper, and test it.
5. **Person paths refuse** (`src/lib/server/sockets/entries.ts`): `entries:create` of a history entry (`:681`, beside `assertDateLands` `:807`), and `entries:update` re-dating one (`:996-1038`), call `assertHistoryDateFree` under the book-calendar lock the handlers already take (`lockBookCalendar`).
6. **Day-entry paths reuse:**
   - **`entries:iterateNext`** (`:1719-1786`): if the next date already has an entry on the line, open or return it instead of creating; check the client handles that answer.
   - **Session lore writes:** history dated at the session clock (`messages/writes.ts:301`, through `entries.ts:727-741`) finds the day's entry instead of creating a second. A session write's content is appended through the existing imprinted change path so a retake takes it back; reuse whatever `entries.ts` already does for an update, and stop and report if no such path exists. This lane edits only what `entries.ts` calls. `messages/writes.ts` belongs to lane hist-E; if it needs changing, queue the change in the report.
   - **Time-lens drop** (`src/lib/client/lorebooks/time/TimeLens.svelte:445-462`): dropping a non-history entry onto a date that already has a history entry opens that entry (with the dropped entry's mention ready, the same way it already prefills a new one) instead of creating a new dated entry.
7. **Loose ends** (`src/lib/client/lorebooks/looseEnds.ts`, pure, plus where its chores render):
   - Chore **Two history entries on one date**: one row per doubled date on the line being read; opening it shows both entries (or opens the first with the other linked; follow how existing chores open). It leaves when fixed. No per-row dismissal (owner, 2026-10-02, `looseEnds.ts` header).
   - Chore **A line's own history before its fork**: a fork's own history entry dated on or before its fork date.
   - The chore labels are new UI copy. Use exactly these two labels and list them for lane F's NOMENCLATURE rows.

## Files owned

- `src/lib/server/scenes/historyEntryOfDate.ts` + `historyEntryOfDate.int.test.ts`
- `src/lib/shared/lorebooks/lineReading.ts` + its cases/tests
- `src/lib/server/state/reading.ts` (the tie-break only)
- `src/lib/server/sockets/entries.ts` (the history paths above) + new `entries.historyDateUnique.int.test.ts`
- `src/lib/client/lorebooks/time/TimeLens.svelte` (the drop only)
- `src/lib/client/lorebooks/looseEnds.ts` + `looseEnds.test.ts`, and the file that renders chore rows (find it from `LooseEndsQueue.svelte`)
- tests that pin the old duplicate-tolerant behaviour (update only, and say which)

## Out of scope (write down, never build)

- Pipeline ports, `write_entry`, `note-scene@1`, cast state (lane hist-B); SDK (hist-C, hist-D).
- `messages/writes.ts`, `liveScenes.ts`, `sessionLine.ts`, next chapter (hist-E): queue needs in the report.
- Bulk writers (import, attic, kits, provided books, fold, line delete): unchanged.
- A DB unique index. Moving or renaming the module.
- Docs and NOMENCLATURE (hist-F): queue the names.
- Lore visibility or affinity (a separate design).

## Stop and ask when

CLAUDE.md §Decisions applies; a writer can't follow the rule without reshaping data; rule C gives an answer that looks wrong for a real flow; a name beyond those in this brief is needed; a migration seems needed (none is planned).

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently. Never add a top-level `await` to `db/index.ts`. Never seed a row at a hardcoded id.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`. Views never call `toaster`.
- Scratch files start with `hist-A-`.

## Done means

- **Targeted tests pass:**
  - the new `entries.historyDateUnique.int.test.ts` covers: create and re-date refused on a taken date with the exact sentence; partial dates distinct; a fork's own entry on or before its fork date refused with the second sentence; a sibling fork may reuse a date after its own fork; main is never refused because of a fork; iterateNext and a session write on a taken day reuse;
  - `historyEntryOfDate.int.test.ts`: compile on a fork for its fork day, and for an earlier day, with no parent entry creates one empty row on the owner, the save is a fork amendment, and the parent's later compile reuses it;
  - the tie-break test;
  - the lineReading cases;
  - `looseEnds.test.ts` for both chores;
  - existing tests in `src/lib/server/scenes/`, `src/lib/server/sockets/entries*.test.ts`, `src/lib/client/lorebooks/` that touch history still green.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-hist-A-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, tests and results, names for lane F, changes queued for hist-B and hist-E, open ★, **Noticed, not done**.
