# BRIEF cv-line-w1 — `versionInForce`, the session cut and the retire mark (pure + SQL + one case table)

Worker (Sonnet) for lane **cv-line**; supervisor is the cv-line lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-line-w1 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Add the one-row read for cast versions to the ONE line rule, its SQL narrowing, and one shared case table that the client conformance test and the server SQL int test both run. Nothing in the app calls any of this yet (wave 1 will).

## Files owned (edit only these)
- `src/lib/shared/lorebooks/lineReading.ts`
- `src/lib/shared/lorebooks/lineReading.cases.ts`
- `src/lib/shared/lorebooks/lineReading.test.ts`
- `src/lib/client/lorebooks/lineConformance.test.ts`
- `src/lib/server/state/lineSql.ts`
- `src/lib/server/state/lineSql.int.test.ts`

NOT `NOMENCLATURE.md` (the supervisor writes the §25 rows). Not `amendments.ts` (import from it only). Nothing else.

## Files readable
`src/lib/shared/lorebooks/amendments.ts` (~180–198 `amendmentsForAppearance`), `storyDate.ts` (`compareDates`), `src/lib/server/db/schema.ts` ~9360–9520 (`characterVersions` and its CHECKs), `src/lib/server/db/characterVersions0146.int.test.ts` (how to insert a lorebook, a `lorebook_bindings` cast member and cast versions), `src/lib/server/state/reading.ts` (`lineOfBook`), `plans/PLAN-sdk-creation-seams-2026-10-30.md` §32 §3, §5b and §33.2 (lines ~1214–1280, ~1396–1407).

## Rules you work under (quoted)
- The header of `lineReading.ts`: "The two halves drifted apart three times while each carried its own copy; this module is the copy." Keep ONE rule. The SQL form must decide exactly what the pure form decides.
- `amendmentsForAppearance` is "⚠ The one filter … two copies is how the roster and the prompt came to disagree." **Call it; never re-implement the life-point filter.** `amendments.ts` already imports `lineReading.ts`; importing `amendmentsForAppearance` back is a function-only cycle (both sides only call each other inside function bodies), which is fine — add a one-line comment saying so at the import.
- "`compareDates` orders. `dateValue` … is never used here."
- CLAUDE.md: no static `$lib/server/db` import in a module tests mock (`lineSql.ts` must stay db-free); an int test that opens a DB inside a test needs a **60 s timeout** (`test(name, fn, 60_000)`); never pipe vitest into `head`; targeted tests only; tsc clean on your files; prettier clean on your files.
- Names: use exactly the names in this brief. Do not invent any other exported name, prop, or type. If you need one, stop and say so in your report.

## What to build

### 1. `lineReading.ts`

**`SessionCut`** (exported interface) and **`Line.sessionCuts`**:
```ts
/**
 * 🚧 A **session cut** (plan §32 §5b, §33.2): how far into one ancestor
 * session a branch's reading sees. One per ancestor, nearest first; the first
 * cut for a session is the one that counts.
 */
export interface SessionCut {
	/** The ancestor session. */
	sessionId: number
	/** The highest origin message the reader still has from that session (its live copied lines); null = none (the branch went Back past every one), so only rows with no source message read. */
	through: number | null
	/** The write-order mark: the highest write order at the fork, taken under the state lock. */
	mark: number
}
```
`Line` gains `sessionCuts?: readonly SessionCut[]` with a doc comment: absent or empty = not a branch, or a branch made before S4 — nothing is cut by session; only cast versions read it (`rowPassesSessionCut`); entries and values ride the line uncut (★CV-12). `lineOf` does not set it (the reader adds it: `{ ...lineOf(id, branches), sessionCuts }`). **`uncutLine` keeps `sessionCuts`** (it lifts fork DATE cuts only; a session cut is not a date cut) — update its doc line to say so.

Add a header section to the module doc, after "## Amendments": "## Cast versions: one row in force" stating the rule below in a few lines.

**`LineCastVersion`** (exported interface; field names are the drizzle column names so a selected `characterVersions` row fits):
```ts
export interface LineCastVersion {
	id: number
	/** NULL = main. */
	branchId: number | null
	/** Day grain; a null year is undated (never cut, ranks below every dated row). */
	year: number | null
	month?: number | null
	day?: number | null
	/** The life point; null = every appearance (ranks below every number). */
	personalPosition: number | null
	writeOrder: number
	retiredOrder: number | null
	sourceSessionId: number | null
	sourceMessageId: number | null
	/**
	 * Which own book of the overlay chain holds the row, counted from the
	 * reader: 0 = the reading session's own book, 1 = its nearest ancestor's,
	 * …; null/absent = the attached book, read along the line's steps. The
	 * reader sets it (the table has no such column). An overlay row reads as
	 * on its own book's main (`MAIN_LINE`).
	 */
	overlayDepth?: number | null
}
```

**`rowPassesSessionCut(row, line): boolean`** — `row: Pick<LineCastVersion, "writeOrder" | "retiredOrder" | "sourceSessionId" | "sourceMessageId">`. The rule, which its doc comment states exactly:
- Find the cut for `row.sourceSessionId` (first match in `line.sessionCuts`; none when the source is null).
- **Retire mark:** a row with `retiredOrder` set reads only for a reader that has a cut for its source whose `mark < retiredOrder` (that reader forked before the row was retired). Every other reader passes it by: the source session itself, a session forked after the retire, any reader with no cut for that source (the book's own screens). Forward clears the mark (null) and the row reads again by the next two tests.
- **Session cut:** when a cut exists, the row reads only when `sourceMessageId` is null or `≤ through` (a null `through` passes only rows with a null source message), AND `writeOrder ≤ mark`.
- A row from any other source (null, the reader itself, a session not among the cuts) is not cut.

**`versionInForce<V extends LineCastVersion>(rows: readonly V[], line: Line, moment: StoryDate | null, appearance: number | null): V | null`** — all four parameters required (no defaults). Place it right after `amendmentsOnLine`. 🚧 in its doc.
1. Candidates: a row with `overlayDepth != null` must pass `rowReadsOnLine(row, MAIN_LINE, dateOf(row), moment)`; any other row `rowReadsOnLine(row, line, dateOf(row), moment)`; and every row `rowPassesSessionCut(row, line)`. `dateOf(row)` = `row.year == null ? null : { year, month, day }`.
2. Appearance: `amendmentsForAppearance(candidates, appearance)` (null = every row).
3. Pick the greatest by, in order:
   a. date: undated lowest; dated by `compareDates`, later wins;
   b. the nearer holder: any overlay row outranks any attached-book row; among overlay rows the lower `overlayDepth` wins; among attached rows the lower step index in `line.steps` wins (the line itself first, main last);
   c. the higher life point (`personalPosition`; null lowest);
   d. the higher `writeOrder`;
   e. the higher `id` (a copy inherits its source's write order, so two rows can tie; the later row wins — deterministic).
4. Return the row (not a copy), or null when no row is a candidate. Field resolution with `follows` is the reader's (wave 1) — say so in one doc line.

### 2. `lineSql.ts`

```ts
/** A cast version's provenance and order, as columns (`characterVersions`). */
export interface SessionCutColumns {
	sourceSessionId: AnyPgColumn
	sourceMessageId: AnyPgColumn
	writeOrder: AnyPgColumn
	retiredOrder: AnyPgColumn
}
/** The mirror of `rowPassesSessionCut` … */
export function sessionCutSql(cols: SessionCutColumns, line: Line): SQL
```
- Cuts = `line.sessionCuts`, deduplicated keeping the FIRST cut per `sessionId` (so it agrees with the pure `find`).
- No cuts → `isNull(retiredOrder)`.
- Else `or(` the uncut arm `and(isNull(retiredOrder), or(isNull(src), notInArray(src, cutIds)))`, then one arm per cut: `and(eq(src, c.sessionId), <message>, lte(writeOrder, c.mark), or(isNull(retiredOrder), gt(retiredOrder, c.mark)))` where `<message>` is `isNull(msg)` when `c.through == null`, else `or(isNull(msg), lte(msg, c.through))` `)`.
- Doc: the caller composes it with `onLineAtSql(branch, date, line, moment)` for the attached book's rows and `onLineAtSql(branch, date, MAIN_LINE, moment)` for an own book's rows (the overlay chain); the life-point filter and the pick stay in TypeScript (`versionInForce`). Update the module header's first paragraph to mention cast versions in one clause.

### 3. `lineReading.cases.ts` — the shared table

Add (types import `type SessionCut` from `./lineReading`):
```ts
/** A cast version on a line (local branch ids, as `CASE_BRANCHES`). */
export interface CaseVersion {
	id: number
	branchId: number | null
	date: StoryDate | null
	personalPosition: number | null
	writeOrder: number
	retiredOrder: number | null
	sourceSessionId: number | null
	sourceMessageId: number | null
	overlayDepth?: number | null
}
export interface CaseVersionReading {
	reader: string
	line: number | null
	sessionCuts: SessionCut[]
	moment: StoryDate | null
	appearance: number | null
	/** Hand-worked: the ids that read (after the appearance filter), ascending. */
	candidates: number[]
	inForce: number | null
}
export interface CaseVersionScenario { name: string; rows: CaseVersion[]; readings: CaseVersionReading[] }
export const CASE_VERSIONS: CaseVersionScenario[]
```
Sessions: P = 101 (the parent), C = 102 (its branch), G = 103 (C's branch), C2 = 104 (a later branch of P). Row 1 of every scenario is the member's undated base on main (`branchId null, date null, personalPosition null, writeOrder 1, retiredOrder null, source null/null`) unless said otherwise. Notation below: `id: branch, date, pp, wo, ret, src session/message, depth`. Write a one-line comment per scenario and per reading saying what it shows. **These expectations are hand-worked by the supervisor; if your implementation disagrees with one, re-check the rule above and report the disagreement — do not change an expectation silently.**

**S1 "branch at newest, then write"** — all on main.
rows: 1 base · 2: main, Y2, pp–, wo 30, –, 101/9 · 3: main, Y3, wo 40, 101/10 · 4: main, Y3, wo 55, 101/null (P wrote with no message after the fork) · 5: main, Y3, wo 60, 101/11 (P's next turn)
- P: line null, cuts [], moment null, app null → [1,2,3,4,5] → 5
- C: line null, cuts [{101, through 10, mark 50}], null, null → [1,2,3] → 3
- C at Y2: same cuts, moment {year:2} → [1,2] → 2

**S2 "branch, then swipe the fork message"**
rows: 1 base · 2: main, Y3, wo 40, ret 51, 101/10 (retired by the swipe) · 3: main, Y3, wo 52, 101/10 (the new swipe's write)
- P: cuts [] → [1,3] → 3
- C (forked before the swipe): [{101,10,50}] → [1,2] → 2
- C2 (forked after the swipe): [{101,10,60}] → [1,3] → 3

**S3 "an in-place change after a branch (retire mark)"**
rows: 1 base · 2: main, Y3, wo 40, ret 51, 101/8 (the row before the change) · 3: main, Y3, wo 52, 101/8 (the changed row)
- P: [] → [1,3] → 3
- C: [{101,10,50}] → [1,2] → 2
- C after its own Back to before message 8: [{101,7,50}] → [1] → 1

**S4 "Back while a branch reads the row"**
rows: 1 base · 2: main, Y3, wo 40, ret 51, 101/10
- P: [] → [1] → 1
- C: [{101,10,50}] → [1,2] → 2

**S5 "Forward after Back (mark cleared)"**
rows: 1 base · 2: main, Y3, wo 40, ret null, 101/10
- P: [] → [1,2] → 2
- C: [{101,10,50}] → [1,2] → 2

**S6 "life-point tiers: 34 and 50 at one world moment"** — all main, no sources, cuts [].
rows: 1 base · 2: Y10, pp 34, wo 2 · 3: Y10, pp 50, wo 3 · 4: Y10, pp null, wo 4 · 5: Y8, pp 50, wo 5 · 6: Y10, pp 50, wo 6
- Y10, app null → [1,2,3,4,5,6] → 6
- Y10, app 50 → [1,2,3,4,5,6] → 6
- Y10, app 40 → [1,2,4] → 2
- Y10, app 34 → [1,2,4] → 2
- Y10, app 20 → [1,4] → 4
- Y9, app 50 → [1,5] → 5
- Y9, app 40 → [1] → 1
- head (moment null), app null → [1,2,3,4,5,6] → 6

**S7 "the nearer holder: line steps nearest first"** — no sources, cuts [], moment null, app null.
rows: 1 base · 2: main, Y5, wo 10 · 3: branch 2 (B), Y5, wo 5 · 4: branch 1 (A), Y5, wo 3
- reads main (line null) → [1,2] → 2
- reads line B (line 2) → [1,2,3] → 3
- reads line C (line 3: A up to Y7, main up to Y5) → [1,2,4] → 4

**S8 "the overlay chain"** — reader G (103), ancestors C (102) then P (101); G rides line B (line 2).
rows: 1 base (attached, main) · 2: attached main, Y5, wo 10 · 3: attached branch 2, Y5, wo 11 · 4: depth 1, Y5, wo 14, 102/20 · 5: depth 0, Y5, **pp 40**, wo 13, no source (an edit on G's notes) · 6: depth 1, Y6, wo 15, 102/30 · 7: depth 2, Y7, wo 16, 101/10
G's cuts: [{102, through 25, mark 20}, {101, through 15, mark 18}]
- G head: line 2, moment null, app null → [1,2,3,4,5,7] → 7
- G at Y6 → [1,2,3,4,5] → 5
- G at Y6, app 30 → [1,2,3,4] → 4 (the nearest ancestor's notes outrank the line)
- G at Y4 → [1] → 1
- G after Back past every copied message: [{102, null, 20}, {101, null, 18}], head, app null → [1,2,3,5] → 5

**S9 "nested branches: a grandchild made before its parent's first turn"** — P rides main; C branched at P's message 10; G branched from C before C's first turn (rides main); P then went Back over message 10 and played it again; C's first book write forked line B.
rows: 1 base · 2: main, Y3, wo 40, ret 53, 101/10 · 3: main, Y3, wo 54, 101/10 · 4: branch 2, Y4, wo 55, 102/200
- P: line null, [] → [1,3] → 3
- C: line 2, [{101,10,50}] → [1,2,4] → 4
- C at Y3: line 2, same cuts, moment {year:3} → [1,2] → 2
- G: line null, [{102, null, 52}, {101, 10, 50}] → [1,2] → 2

### 4. Tests
- **`lineConformance.test.ts`** (pure, the client side): a `describe("cast versions — versionInForce", …)` that, for every scenario and reading, builds `{ ...lineOf(reading.line, CASE_BRANCHES), sessionCuts: reading.sessionCuts }`, maps case rows to `LineCastVersion` (date → year/month/day), and expects (a) the candidate ids (rows passing `rowReadsOnLine` on the right line per `overlayDepth` + `rowPassesSessionCut`, then `amendmentsForAppearance`) to equal `reading.candidates`, and (b) `versionInForce(...)?.id ?? null` to equal `reading.inForce`. Update the file header's reader list in one clause.
- **`lineReading.test.ts`** (focused units, no table): `uncutLine` keeps `sessionCuts`; the first cut for a session wins over a later duplicate; `versionInForce` answers null with no candidate; two rows tied on everything but id → the higher id; an overlay row on a non-null branch is not a candidate.
- **`lineSql.int.test.ts`** (the server side): a new `describe` that runs `CASE_VERSIONS` against real `character_versions` rows. Build one book with `CASE_BRANCHES` (as `buildBook` does) — or reuse a builder — and per scenario one cast member (`lorebook_bindings`) in it for the attached rows, plus one own book (a plain `lorebooks` row) and one cast member there per `overlayDepth` used. Insert each case row with `node_state 'active'`, `node_visibility 'normal'`, its real branch id, date, `personal_position`, `write_order`, `retired_order`, `source_session_id`, `source_message_id` (plain ints, no FK). Per reading: line = `{ ...(await lineOfBook(db, book.id, real(reading.line))), sessionCuts }`; fetch the attached member's rows with `and(eq(castMemberId, m), onLineAtSql(branchId, {year,month,day}, line, moment), sessionCutSql(cols, line))` and each overlay member's rows with `onLineAtSql(..., MAIN_LINE, moment)` and the same `sessionCutSql`; tag overlay rows with their depth; map ids back to local; apply `amendmentsForAppearance` and expect the ids to equal `reading.candidates`; then expect `versionInForce` over the fetched rows to pick `reading.inForce`. Every new `test` gets a `60_000` timeout. Keep the file's existing tests unchanged; update its header comment in one clause.

## Out of scope
Any caller of `versionInForce` (wave 1: `memberAsRead`, `reading.ts`), `reading.ts`, `amendments.ts`, NOMENCLATURE, docs, the schema, `lineOf`'s building of cuts, card versions, `follows` resolution.

## Stop and ask (in your report) when
A name beyond this brief seems needed; an expectation in the table disagrees with the rule as written; anything needs a file you don't own.

## Done means
```
cd /home/jody/github/serene-pub && npx vitest run src/lib/shared/lorebooks/lineReading.test.ts src/lib/client/lorebooks/lineConformance.test.ts src/lib/client/lorebooks/lineConformance.screens.dom.test.ts src/lib/server/state/lineSql.int.test.ts
```
all green (run them; never pipe into `head`); `npx tsc --noEmit -p . 2>&1 | grep -E "lineReading|lineSql|lineConformance"` empty; `npx prettier --check` clean on your six files. Before and after the run, `ls -d /tmp/serene-pub-vitest-* /tmp/serene-pub-linesql-* 2>/dev/null` — delete by name only dirs that appeared from your runs.

Report: names and signatures, changed files, test results (counts), any expectation you disagreed with, Noticed-not-done.
