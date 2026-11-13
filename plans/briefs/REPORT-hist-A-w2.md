# REPORT hist-A-w2
Status line: done; no status question was relayed.

## Changed files
- src/lib/client/lorebooks/looseEnds.ts: chores `doubled-history-date`, `history-before-fork` (after undated-history, exact labels, 🚧 fix comments), `LooseEndsInput.line`, `LooseEnd.alsoEntryIds`, header line, doubled-date grouping (archived included, lowest id wins), fork check via `historyOwnerStep`.
- src/lib/client/lorebooks/looseEnds.test.ts: 9 new cases (all brief cases).
- src/lib/client/lorebooks/LooseEndsQueue.svelte: quiet text link per other entry, `onOpen({...row, target})`.
- src/lib/client/lorebooks/time/TimeLens.svelte (drop only): `offerDate` opens the existing history entry of the day (lowest id) with the mention; `pendingMention` state, `applyPendingMention()`, `appendMention()`, cleared in `discardDraft()`, applied in the same `$effect`. No history row on the date: `startCreate` as before.

## Tests
- vitest (brief's command): 13 files, 156 tests passed, exit 0. No test mounts LooseEndsQueue.
- svelte-check: no errors in LooseEndsQueue / TimeLens / looseEnds.
- prettier --check: TimeLens clean; the other three files still show pre-existing diffs (not from my hunks); my hunks were formatted by hand.

## Assumptions
- Link numbering: the row button is the oldest entry, so with several others the links read `Other entry 2`, `Other entry 3` (aria-label gets ` (2)`, ` (3)` appended); a single other reads `Other entry`.
- Link class reused: `text-primary-ink ... hover:underline` (from MomentBar / CastDuplicatesPanel).
- Day match in the drop compares `{year, month, day}` of both sides via `compareDates`.
- `historyOwnerStep` was already present and matched spec.

## Noticed, not done
- LorebooksWorkspace must pass `line` into `looseEnds()` (queued for lead), else history-before-fork never fires.
- Dropping an undated history row onto a taken tick (the "date" offer branch) writes a duplicate date; the server will refuse that save.
- Existing prettier drift in looseEnds.ts (import), looseEnds.test.ts, LooseEndsQueue.svelte (pre-existing).
