# REPORT — hist-G: follow-ups to hist-B1/E and the fourth-round rulings (core) — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-hist-G-w{1,2}.md`. The lane ran its own scope review and fixed both findings.

## Changed files
- **`pipelines/runtime/host.ts`:**
  - `fileOntoHistoryDay`:
    - the default date is the session's **story now**, taken literally (★G-3);
    - a month or day without a year is refused;
    - the rule-C refusal (`historyDayOwnerRefusal`) comes before anything is created;
    - a created day entry is stamped `provenance:"pipeline"` + `sourceMessageId`;
    - only refusals are wrapped (`HostScopeError`, `{cause}`).
  - The lore read's bindings carry `nodeState` (the version in force, from `membersAsRead`).
- **`scenes/historyEntryOfDate.ts`:** the rule-C sentences move into a new export, `historyDayOwnerRefusal`, which `assertHistoryDateFree` calls.
- **`messages/writes.ts`:** `sessionLoreWrite` forks nothing now.
- **`sockets/entries.ts`:** `createEntry` forks inside its transaction, after the lock and checks. After a fresh fork it re-runs the anchor check and the story-now date. A refused first write forks nothing.
- **`sockets/scenes.ts`:** private `forkRidingSessions`. Compiling forks any branch session still riding the compiled line (attached to this book) before reading the day's scenes. If only riding scenes were waiting, the press refuses with `BRANCH_SESSION_SCENES`.
- **`pipelines/prompt/characterLore.ts`:** `nodeState === "deceased"` → `playerSeat || narrator`.
- **Lead:** the `lorebooks/sessionLine.ts` header comment now lists the new fork callers and drops the outer-`db` `sessionLoreWrite` caveat.
- **Tests:**
  - `host.historyWrites` (updated plus 4 new);
  - `sessionLine` (an other-book scene stays);
  - new `entries.firstWriteFork.int.test.ts` (3), `scenes.compileForksRiding.int.test.ts` (4) and `characterLore.deceased.test.ts` (4).

## Tests
- 59 files, 473/473. After the review fixes, 7 files, 87/87.
- DC: 4 red, all on the undated cairn write (hist-D):
  - W3 ×2;
  - Walk100 "is a NEW seat";
  - Walk2 "the card stays with the fallen seat".
- `tsc`: clean in this lane's files.

## Copy (provisional 🚧) for hist-F
- "‹node›: a history date needs a year. Give this write a year in its fields, or leave the date out to use the story's day."
- "The scenes waiting here belong to a branch session, which compiles them on its own line."
- hist-B1's "‹node›: history needs a date. …" now fires when there is no year and no story now.

## Open ★
- **G-1/G-2:** the two sentences above.
- **G-3:** story now is taken literally, with no next-day step. Recommended: keep it, so appends don't move the calendar forward.
- **G-4:** a press refused later at `startCompile` keeps its forks. Recommended: accept it.

## Noticed, not done
- The departed-player-seat lore bug (the player-seat clause ignores `removedAt`).
- A riding session attached to another book is not forked, and its scene still compiles where it sits.
- The three new test files aren't prettier-formatted (the brief bans `--write`).
