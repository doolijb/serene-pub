# REPORT cv-line (2026-11-05)

Status question: none was relayed. Wave 0b is built: the one-row read and the session cut are inside the one line rule, with a SQL form and one shared case table. The four targeted test files pass, 116/116.

## Names and signatures (all 🚧; nothing calls them yet, wave 1 will)

**In `src/lib/shared/lorebooks/lineReading.ts`:**
- **`SessionCut`** = `{ sessionId: number; through: number | null; mark: number }`.
- **`Line.sessionCuts?: readonly SessionCut[]`**
  - The list is nearest ancestor first, and the first cut for a session counts.
  - `lineOf` never sets it; the reader adds it as `{ ...lineOf(id, branches), sessionCuts }`.
  - `uncutLine` keeps it, because it lifts only fork date cuts.
- **`LineCastVersion`**: the `character_versions` column names (`id`, `branchId`, `year`/`month`/`day`, `personalPosition`, `writeOrder`, `retiredOrder`, `sourceSessionId`, `sourceMessageId`), plus **`overlayDepth?: number | null`**.
  - `overlayDepth` says which own book of the overlay chain holds the row, counted from the reader: 0 = the reader's own book, 1 = its nearest ancestor's, and so on. Null = the attached book.
  - The reader sets it; it is never a column.
  - An overlay row reads as if on its own book's main.
- **`rowPassesSessionCut(row, line): boolean`**, which applies the session cut and the retire mark.
- **`versionInForce<V extends LineCastVersion>(rows, line, moment: StoryDate | null, appearance: number | null): V | null`**. All four parameters are required, with no defaults. It sits right after `amendmentsOnLine`.
  - **Candidates:** a row must read on the line (`rowReadsOnLine`; an overlay row on `MAIN_LINE`) and pass `rowPassesSessionCut`. Then `amendmentsForAppearance` runs, the one life-point filter; it is called, not copied.
  - **Pick, in order:**
    1. the later date (undated lowest, `compareDates`);
    2. the nearer holder: any overlay row beats any attached row, the lower depth first; then the line's own step before its ancestors, main last;
    3. the higher life point (null lowest);
    4. the higher `writeOrder`;
    5. the higher `id`.
  - It returns the row itself. Resolving `follows` stays with the reader.

**In `src/lib/server/state/lineSql.ts`** (still free of db imports):
- **`SessionCutColumns`** and **`sessionCutSql(cols, line): SQL`**, the mirror of `rowPassesSessionCut`. It keeps the first cut per session.
- The caller combines it with `onLineAtSql`: the attached book on `line`, own books on `MAIN_LINE`.

**In `src/lib/shared/lorebooks/lineReading.cases.ts`:** `CaseVersion`, `CaseVersionReading`, `CaseVersionScenario` and **`CASE_VERSIONS`**, nine scenarios with expectations I worked out by hand:
- S1: branch at the newest message, then write.
- S2: branch, then swipe the fork message (including a branch made after the swipe).
- S3: an in-place change after a branch, plus the branch's own Back lowering `through`.
- S4: Back while a branch reads the row.
- S5: Forward after Back.
- S6: life-point tiers, 34 and 50 at one world moment.
- S7: line steps, nearest first.
- S8: the overlay chain, including Back past every copied message (`through` null).
- S9: nested branches, a grandchild made before its parent's first turn (the challenger's case).

The pure form and the SQL form both match every expectation; the worker found no disagreements.

**The exact rule, as stated in the code comment and §25:**
- A row whose source session has a cut reads only when `source_message_id` is null or ≤ `through`, AND `write_order` ≤ `mark`. A null `through` passes only rows with no source message.
- **Retire mark:** a row with `retired_order` set reads only for a reader that has a cut for its source with `mark` < `retired_order`. Every other reader skips it: the source session itself, a session forked after the retire, and any reader with no cut for that source. Forward clears the mark.
- A row from any other source is not cut.

## Choices I made (inside scope)
1. **`overlayDepth` as a field on the row**, not a second `Line` field. The reader tags rows relative to itself, which keeps `Line` about one book. This is a new name; it is recorded in §25 and can be renamed, since nothing calls it.
2. **The holder rule:** the brief needed the overlay tier somehow; I decided it as above.
3. **The `id` tie-break.** A copy inherits its source's write order, so rows can tie on it; the higher id makes the pick deterministic (P1).
4. **A null life point ranks lowest**, and **a null `through` passes only rows with no source message.** Both are my reading of §32 §5b. Either would change wave 1 results if you read §5b differently.
5. **`uncutLine` keeps `sessionCuts`.** Dropping them would leak a parent's later rows into a branch on a whole-line read.
6. **`lineReading.ts` imports `amendmentsForAppearance` back from `amendments.ts`.** That makes an import cycle, but both sides only call each other inside function bodies; it is commented in the file. The repo has no lint rule against cycles.

## Changed files
- /home/jody/github/serene-pub/src/lib/shared/lorebooks/lineReading.ts
- /home/jody/github/serene-pub/src/lib/shared/lorebooks/lineReading.cases.ts
- /home/jody/github/serene-pub/src/lib/shared/lorebooks/lineReading.test.ts
- /home/jody/github/serene-pub/src/lib/client/lorebooks/lineConformance.test.ts
- /home/jody/github/serene-pub/src/lib/server/state/lineSql.ts
- /home/jody/github/serene-pub/src/lib/server/state/lineSql.int.test.ts
- /home/jody/github/serene-pub/NOMENCLATURE.md (§25: 3 rows appended after the cv-schema "life point" row, lines 3289–3291)
- Worker brief: /home/jody/github/serene-pub/plans/briefs/BRIEF-cv-line-w1.md

## Tests (targeted only; I re-ran them myself after the worker)
`npx vitest run` on `lineReading.test.ts`, `lineConformance.test.ts`, `lineConformance.screens.dom.test.ts` and `lineSql.int.test.ts`: 4 files, **116/116 pass**.
- **Client conformance (`lineConformance.test.ts`):** runs `CASE_VERSIONS`, checking both the candidate ids and the row in force.
- **`lineSql.int.test.ts`:** runs the same table against real `character_versions` rows, with an own book and member per overlay depth. Each new test has a 60 s timeout, and the existing tests are unchanged.
- **`lineReading.test.ts` unit tests:**
  - `uncutLine` keeps the cuts.
  - The first duplicate cut wins.
  - With no candidate the answer is null.
  - A tie on everything but id goes to the higher id.
  - An overlay row on a branch is not a candidate.

Other checks:
- `npx tsc --noEmit -p .` filtered to lane files: no errors.
- `npx prettier --check` passes on all six files.
- No new `/tmp/serene-pub-vitest-*` dirs came from my runs or the worker's (listings compared before and after), so I deleted nothing.

## §25 rows
1. `versionInForce`, with `LineCastVersion` and `overlayDepth`.
2. `Line.sessionCuts` / `SessionCut`, with `sessionCutSql`, `SessionCutColumns` and `CASE_VERSIONS`.
3. The retire-mark rule, stated exactly.

## Open ★
None new. The `overlayDepth` name and the null-`through` reading (choices 1 and 4) can be changed if you or wave 1 disagree. Neither blocks anything.

## Noticed, not done
- Five of the six files were not prettier-clean at HEAD. The worker ran `prettier --write` on them, so the diffs include formatting-only changes to existing lines, the largest about 200 lines in `lineReading.test.ts`. No logic outside the additions changed.
- I did not run a `scope-reviewer`; the guide gives that to whoever accepts the lane.
- No `docs/*.md` change: nothing here is user-facing yet.
- `NOMENCLATURE.md` was already not prettier-clean before my rows (cv-schema noted the same), so I did not reformat it.
## Scope review (lead, 2026-11-05 late) — no objection to the code
1. The report file first held the worker's brief (the lead's extraction) → rewritten from the lane's hand-back; lane cv-core told.
2. `lifePointOver` (private) → renamed `personalPositionOver` (life point is prose only, R1).
3. The SQL "first cut per session" path has no shared case → accepted as defensive ("one per ancestor": a repeat never happens).
Heads-up carried to cv-core: the lift note will list members whose branch amendment dated before a later main amendment reads differently under date-first picking (★CV-1); `versionInForce` doesn't filter `node_state` — callers narrow to active rows in SQL.
