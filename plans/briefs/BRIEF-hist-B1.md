# BRIEF — hist-B1: pipeline history writes (core host), the no-SDK half of hist-B

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read the owner-ruling sections, the challenge answers, and **§ Build scope item 2**. Lane hist-A's report (`plans/REPORT-hist-A-2026-11-10.md`) describes the helpers you call. GO 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions may be editing nearby. Check each file's `git diff` before editing, and never overwrite work you didn't make.

## Rulings this lane applies (owner, 2026-11-10)

- **★H1:** "Reuse the existing." A pipeline that writes history on a date that already has an entry writes into that day's entry. It never makes a second one.
- **★H2, rule C:** the owning line of a dated day is `historyOwnerStep(line, date)` (`shared/lorebooks/lineReading.ts`). hist-A's `historyEntryOfDate(tx, …, { create: true })` already finds the entry the line reads, or creates an empty one on the owning line, under the calendar lock.
- **S1 (lead default, consistent with ★H1):** the pipeline's content is **appended** to the day's entry as a new paragraph, through the existing **imprinted** change path, so a retake or Back takes the paragraph back (challenge 6: `changeLoreEntry`, `pipelines/runtime/host.ts:1992-2000`, the `match` route near `:10958`). The receipt note reads *"filed onto ‹date›'s entry"* (‹date› uses the book calendar's spelling).
- **Scenes first** (owner direction): a direct history write is the second choice, allowed, and lands on the day's one entry.

## Goal

1. **`create-lore-entry@1` with `entryType` history** (host commit near `host.ts:10828-11010`):
   - resolve the date from the node's `fields` {year, month?, day?}, else the session's dating (`writeDatingAt`, `state/reading.ts`);
   - run `assertDateLands` as the socket path does (`sockets/entries.ts:807`);
   - get the day's entry with `historyEntryOfDate(tx, …, { create: true })` for the session's line;
   - append the content through the imprinted change path;
   - write the receipt note.

   A history create with no year and no session dating is refused in words (history needs a date), never landing on the field default Year 1. An undated legacy row is never the target.
2. **`update-lore-entry@1`** (`host.ts:2001-2070`): when it changes a history entry's date, run the same checks the socket re-date runs, `assertDateLands`, `assertRedateKeepsLines` and `assertHistoryDateFree(tx, { …, exceptId })`, **only when the date actually changes**. That closes today's second, unchecked date writer (P2).
3. **The chat tool `write_entry`** (`pipelines/runtime/tools/writeTools.ts:43,78`): `kind: "history"` (or any kind mapping to the history type) is refused with a `ToolError` reading *"History comes from scenes: capture the moment and compile it, or write world lore."* Remove `history` from `ENTRY_TYPES`.
4. **Ties:** use `historyEntryOver` (`state/reading.ts`) wherever this code picks between same-date rows.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` (the `create-lore-entry@1` and `update-lore-entry@1` history paths only)
- `src/lib/server/pipelines/runtime/tools/writeTools.ts` + `writeTools.test.ts`
- new or existing int tests under `src/lib/server/pipelines/runtime/` for these ports

## Files readable

Anything. In particular: `scenes/historyEntryOfDate.ts`, `state/reading.ts`, `utils/forkHistory.ts`, `sockets/entries.ts`, `runtime/loreMatch.ts`, the SDK contract `../serene-pub-sdk/contracts/src/outlets.ts:1607-1760`. Read only; this lane doesn't change the SDK.

## Out of scope (write down, never build)

- `note-scene@1`, `update-cast-member@1` `nodeState` (they need the SDK contract first: lane hist-C, then hist-B2).
- Contract prose and docs (hist-C, hist-F). Dungeon Crawler (hist-D); its cairn write will start appending to Year-1-dated… no, it will be **refused** (undated). That's expected and hist-D removes the write. Say so in your report, and check the DC tests that will turn red (`sessions.dungeonCrawlerW3.int.test.ts:399-401`, `dungeonCrawlerWalk*`). Mark them as hist-D's to fix; don't edit them.
- `entries.ts`, `messages/writes.ts`, scenes and lines (hist-A, hist-E).

## Stop and ask when

CLAUDE.md §Decisions applies; there's no imprinted append path a retake can undo (stop; don't invent a write path); a name beyond the receipt and refusal copy above is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `hist-B1-`.

## Done means

- **Targeted tests pass:**
  - two pipeline history creates on one date leave one row whose content holds both paragraphs, with a receipt note on the second;
  - a retake takes the appended paragraph back;
  - a history create on a fork, on or before its fork date, lands on the owning line;
  - an undated history create is refused;
  - the update port's re-date refusals (taken date, rule C, `assertDateLands`) and a no-change save pass;
  - `write_entry` `kind:"history"` is refused;
  - the existing `pipelines/runtime/*` lore tests still green, except the DC ones listed for hist-D.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-hist-B1-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, tests and results, red tests left for hist-D, names for lane F, open ★, **Noticed, not done**.
