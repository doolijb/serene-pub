# REPORT — lane `sense-rin2` — 2026-11-11

Written by the lead from the supervisor's final message. Four accepted fixes from the scope review of `sense-rin`.

## Confirmed on the server first

- The turn reads each entry as the session reads it (amendments applied before any retrieval step, `runtime/host.ts`
  ~4320–4335), so the skip "entry is disabled" means off at the turn's reading, whatever the base row says.
- Gate order: rows off the line or dated after the clock are cut in SQL first; then `keywordQuery.ts` (~558–580)
  checks archived before disabled.
- `entry.enabled` on a skipped row is the base row's live value.

## Built

- `src/lib/shared/sockets/types.ts` (`RetrievalRow` only): new `skipReason?: string`.
  `src/lib/server/sockets/pipelines.ts` (the skipped-row block of `explainRetrieval` only) sets it. The `verdict`
  sentence is unchanged. Test: `pipelines.retrievalExplain.test.ts`.
- `src/lib/client/lorebooks/editor/readIn.ts`: prefix parsing removed (`SKIPPED_PREFIX`, `skipReasonOf` gone); reads
  `row.skipReason`. New `offDecisionLine(baseEnabled)`, shared by the line and the tab.
- `src/lib/client/lorebooks/editor/signals.ts`: the gate chain in the server's order — archived; off (from the
  reading when known, else the turn's own disabled skip, else the base row only while the reading is unknown and
  the turn said nothing); a null reading with no row; a judged row's own sentence; a skipped row through the same
  mapping the line uses; else the catch-all.
- `docs/lorebooks.md` line 94: the clause in the server's order.
- `EntryFireTest.svelte`: not changed.

## Tests

3 files, **138/138**. `tsc --noEmit -p .`: 0 errors (needs an 8 GB heap). Prettier: lane-written files clean.
New tests were not run against the old code; each fails there by reading.

## Names for §25

`ReadInFacts.verdict` → `decisionLine`; `SignalFacts.verdict` → `decisionLine`; `skipVerdict` → `skipDecisionLine`;
`storeVerdict` → `storeDecisionLine`; new `offDecisionLine(baseEnabled)`; `GATE.notOnLine` → `GATE.notReadHere`; new
wire field `RetrievalRow.skipReason`. Removed: `SKIPPED_PREFIX`, `skipReasonOf`. `reason` (code) and `why` (stored
sentence) keep their names.

## What a null reading covers

`marksAsRead` returns null when: (1) the entry is archived as the session reads it; (2) it is not on the session's
line; (3) it is dated after the session's clock; (4) the session's attached book is someone else's and not readable
by the asker; (5) no readable book, or the entry is gone. The tab's sentence names 1–3. **Assumption:** 4 and 5
cannot occur while the editor is open on the entry.

## Open ★

1. Copy 🚧: `GATE.notReadHere` "it is archived in this session, not on its line, or dated after its clock"; the docs
   clause "this session does not read it (archived there, off its line, or dated after its clock)".
2. For a disabled skip whose row carries no base row, the line says "it is switched off". Recommended: keep.
3. The field name `RetrievalRow.skipReason`. Recommended: keep.

## Noticed, not done

- The wire field `RetrievalRow.verdict` is still named `verdict` though it is selection's answer on a candidate.
- `SignalFacts.decisionLine` is documented "Never absent on a no", but a skipped row with no reason leaves it undefined.
- The tab mixes a live reading with a run explanation from when the test ran.
