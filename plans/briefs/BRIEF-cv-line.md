# BRIEF cv-line — wave 0b: the one-row read and the session cut inside the one line rule

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-cv-common.md` first, then `plans/REPORT-cv-schema-2026-11-05.md` (the columns as built). Lane id **cv-line**. One worker (Sonnet), two at most. App `/home/jody/github/serene-pub`.

## Items (plan §32 §3, §5b; §33.2)
1. `src/lib/shared/lorebooks/lineReading.ts` (pure, the ONE line rule — its header warns it "drifted apart three times"; keep one rule): 🚧 `versionInForce(rows, line, moment, appearance)` beside `amendmentsOnLine` (~328–345): candidates via `rowReadsOnLine` (~278–289) + the session cut + the retire mark; appearance via `amendmentsForAppearance` (`shared/lorebooks/amendments.ts` ~190–198; null = every row); pick: latest date (undated lowest, `compareDates`), then the nearer holder (the session's own overlay, each ancestor's overlay, then line steps nearest first), then the higher life point, then the higher `write_order`; returns the row (field resolution with `follows` is the reader's, wave 1).
2. `Line` (~66–75) gains `sessionCuts?: { sessionId, through: number | null, mark: number }[]`; a row whose `source_session_id` is a cut session reads only when `source_message_id` is null or ≤ `through` AND `write_order` ≤ `mark`; a row with `retired_order` set reads only for a reader whose mark for that source is below `retired_order` (§33.2 — state the exact rule in the code comment and the §25 row).
3. `src/lib/server/state/lineSql.ts` (~32 `onLineSql`): the SQL narrowing for the same rule (cuts, retire mark) so a reader can fetch candidates in one query; the pure function decides.
4. Conformance: `lineReading.cases.ts` gains cases — branch at newest then write; branch then swipe the fork message; an in-place change after a branch (retire mark); Forward after Back (mark cleared); life-point tiers (34 vs 50 at one world moment); the overlay chain; nested branches (grandchild before its parent's first turn). The server `lineSql.int` and the client conformance tests run the same table.
5. NOMENCLATURE §25: `versionInForce`, `sessionCuts`, the retire-mark rule.

## Files owned
`src/lib/shared/lorebooks/lineReading.ts`, `lineReading.cases.ts`, `src/lib/server/state/lineSql.ts`, their tests (incl. `lineSql.int` and the client conformance test), `NOMENCLATURE.md` §25. Nothing calls `versionInForce` yet (wave 1).
