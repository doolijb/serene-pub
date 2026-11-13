# BRIEF — hist-A-w1: the history-date owner, the free-date check, owner-aware find-or-create, one tie-break

Supervisor: lane hist-A. Plan: `plans/PLAN-history-one-per-date-2026-11-10.md` (read **§ ★H2 design** and **§ What the code does today → Dates** only; the rules you need are quoted below). Repo `/home/jody/github/serene-pub`. Another worker (w2) is editing client files at the same time; never touch them. Other sessions may edit nearby: before each edit, check the file's mtime and `git diff <file>` so you never overwrite live work you didn't make. All four files below already carry uncommitted work by others: keep it, add to it.

## Owner rulings this work applies (2026-11-10, quoted)

- **★H1:** "Reuse the existing". A person's direct create, or re-date onto a taken date, is refused. The paths that mean "the entry of this day" find the existing entry instead.
- **★H2, rule C:** "A line owns a history entry only for a date **strictly after** its fork date. On or before it, the date's entry belongs to the nearest ancestor that may own it. A fork's version of such a day is a line amendment (`compileSaveOf`, already built). A dateless fork owns no dated history. When an ancestor has no entry for that day, a day-entry path may create an **empty** one on the owning line."
- **★H3:** existing duplicates are reported (another worker), never merged automatically. "New dated writes on a doubled date are refused until it's fixed."
- **Partial dates are distinct** (from `compareDates`, `shared/lorebooks/storyDate.ts:88`): *Year 2*, *Year 2 Month 5* and *Year 2 Month 5 Day 3* are three dates. Undated rows (no numeric year: `historyEntryDate(fields) === null`) are ignored.

## Goal

### 1. `historyOwnerStep(line, date)` — pure, in `src/lib/shared/lorebooks/lineReading.ts`

Signature: `export function historyOwnerStep(line: Line, date: StoryDate): LineStep`. Returns the step of `line.steps` whose branch owns a dated history day under rule C.

Algorithm (derived from how `lineOf` builds cuts — read `lineOf` and `LineStep`): `steps[0]` is the line itself (cut null); `steps[i+1].cut` is the earliest fork date along steps 0..i. Walk `i = 0, 1, …`: return `steps[i]` when it is the **last** step, or when `steps[i+1].cut !== null && compareDates(date, steps[i+1].cut) > 0`. (A null cut means "no fork date so far": the step owns nothing dated and the walk goes on. This gives: a line owns dates strictly after its own fork date; a dateless fork owns none; main, the last step, owns the rest. Because the walk only reaches step i when `date` is at or before every earlier fork date, the comparison against the accumulated cut equals the comparison against step i's own fork date.) Use `compareDates`, never `dateValue`. Doc comment in the file's voice: say it is rule C (owner, 2026-11-10), what it answers, and that `scenes/historyEntryOfDate.ts` is its server user.

Cases: add an exported table to `src/lib/shared/lorebooks/lineReading.cases.ts` (e.g. `CASE_HISTORY_OWNERS`: line id, date, expected owner id, over `CASE_BRANCHES`) and a `describe("historyOwnerStep — rule C …")` in `lineReading.test.ts` that runs it. With the existing branches (A off main at Y5; B off main dateless; C off A at Y7; D off A dateless; E off C at Y3) the expected owners are:
- main: Y1 → main, Y99 → main.
- A: Y6 → A; Y5 → main; Y4 → main; Y5 M1 → A (partial: after Y5); Y5 M5 D3 → A.
- B (dateless): Y9 → main; Y1 → main.
- C: Y8 → C; Y7 → A; Y6 → A; Y5 → main.
- D (dateless, off A): Y9 → A; Y3 → main.
- E: Y4 → E; Y3 → main; Y2 → main.
Plus one test with its own branch list for a **partial fork date** (a fork off main at Y2 M5 D3): Y2 → main; Y2 M5 → main; Y2 M5 D3 → main; Y2 M5 D4 → fork; Y2 M6 → fork; Y3 → fork. Verify every expectation against your implementation by reasoning first; if one disagrees with the algorithm, stop and report rather than bending either.

### 2. One tie-break — `src/lib/server/state/reading.ts` (the tie-break only)

Today `pickEntryOfDate` (`scenes/historyEntryOfDate.ts`) breaks a doubled date by highest position and `writeDatingAt` (`reading.ts`, ~:467) by lowest id. **Supervisor decision: lowest id wins** (the oldest row; stat datings already hang from it; position moves with a drag). Add one small exported pure helper in `reading.ts` next to `historyEntryDate`:

`export function historyEntryOver(a: { id: number; date: StoryDate }, b: { id: number; date: StoryDate }): boolean` — true when `a` wins over `b`: the later date (`compareDates > 0`), and of equal dates the lower id. Doc comment: the one rule both pickers use, and why lowest id.

Use it in `writeDatingAt` (its result must stay exactly what it is today) and in `pickEntryOfDate` (which then no longer reads `position`: drop `position` from its row parameter type; its callers pass wider rows, which still type-check). Fix `writeDatingAt`'s doc sentence "Two entries on one date: the lower id." only if needed to point at the helper. Edit nothing else in `reading.ts`.

### 3. `src/lib/server/scenes/historyEntryOfDate.ts` — keep the file where it is; don't rename or move it

a) **Owner-aware create.** In `historyEntryOfDate(..., { create: true })`, when no entry matches, the new empty row is inserted with `branchId: historyOwnerStep(line, date).branchId` instead of the asked line's `branchId`. Nothing else in the create changes (`assertDateLands`, position after the book's last history entry, empty content). Reason it is safe without a further check (put this in the doc): when the asked line reads no entry on that day, the owning line has no own entry on that day either, since the asked line reads every own row of the owning step at that date. The asked line always reads the row it gets back. Update the module header bullets accordingly ("`create: true` makes the dated entry … on the line that owns the date (rule C)"), and the "of several, the highest position" wording to the lowest id.

b) **`assertHistoryDateFree`** — new export:

```ts
export async function assertHistoryDateFree(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate | null; exceptId?: number }
): Promise<void>
```

- `date` null or without a numeric year → return. Compare on `dayOnly(date)`.
- Read the book's branches (`id, name, forkedFromBranchId, forkYear, forkMonth, forkDay`). A `branchId` that isn't one of them → `throw new BranchRefusal(...)` exactly as `lineOfBook` does. `line = lineOf(branchId, branches)`.
- Line names: main is `"main"` (the moment bar's `BranchChip` and `assertRedateKeepsLines` in `utils/forkHistory.ts` both say "main"); a branch is its `name`. Dates go through `formatDate(date, await bookCalendarOf(tx, lorebookId))` (`bookCalendarOf` from `$lib/server/state/storyTime`, `formatDate` from `$lib/shared/lorebooks/storyDate`).
- **(b) first — rule C.** `owner = historyOwnerStep(line, day)`. When `owner.branchId !== branchId` (only possible on a branch), let `branch` be the target branch row, `fork = forkDateOf(branch)`, `parent` = the name of `branch.forkedFromBranchId` (null → "main"):
  - `fork` set: `throw new Error(\`${line} shares everything up to ${formatDate(fork, cal)} with ${parent}. Change that day here as an amendment, or choose a later date.\`)` — **exact copy**.
  - `fork` null (dateless fork; ★ provisional copy, the owner hasn't seen it): `throw new Error(\`${line} follows ${parent} with no fork date, so its dated history is ${parent}'s. Change that day here as an amendment.\`)`. Mark it 🚧 in a comment.
- **(a) then — one entry per date.** Read the book's history rows (`id, branchId, fields`), skip `exceptId`; when any row has `historyEntryDate(fields)` non-null with `compareDates(rowDate, day) === 0` and `rowReadsOnLine(row, line, rowDate)`: `throw new Error(\`${line} already has a history entry for ${formatDate(day, cal)}. Open it, or choose another date.\`)` — **exact copy**. Archived rows count (they still hold their date).
- Doc comment must explain why checking the target line is the whole of "any line of the book reads both rows": under rule C two rows each owned by its own line can only meet on that line itself (a line reads an ancestor's row at a date only when the date is at or before the fork, which the nearer line doesn't own). A row that breaks rule C (made before this rule) is ignored on other lines on purpose: a write on main is never refused because of a fork; Loose ends reports such rows. Say the caller must hold `lockBookCalendar(tx, lorebookId)` and pass only `tx`.
- Errors are plain `Error`s, the shape `assertDateLands` (`state/storyTime.ts:177`) and `assertRedateKeepsLines` already use.

## Files owned

- `src/lib/shared/lorebooks/lineReading.ts`, `lineReading.cases.ts`, `lineReading.test.ts`
- `src/lib/server/state/reading.ts` (the tie-break only)
- `src/lib/server/scenes/historyEntryOfDate.ts`, `historyEntryOfDate.int.test.ts`
- `src/lib/server/scenes/unfiledScenesByEntry.int.test.ts` only if it pins the old highest-position tie (update the expectation only; say so)

## Files readable

`src/lib/server/utils/forkHistory.ts` (`assertRedateKeepsLines`, the refusal shape and line naming), `src/lib/server/state/storyTime.ts`, `src/lib/shared/lorebooks/storyDate.ts`, `src/lib/client/lorebooks/editor/compileSave.ts` (`compileSaveOf`, pure), `src/lib/server/sockets/scenes.ts:1230-1310` (compile's caller), `src/lib/server/scenes/unfiledScenesByEntry.ts`.

## Tests (Done means)

`historyEntryOfDate.int.test.ts` (follow its existing harness; every `it`/`test` that opens a DB gets a `60_000` timeout):
- Update the two tests that pin the old tie ("of two, the higher position" → the lower id; `pickEntryOfDate` ties → lowest id). Name them in your report.
- **Tie-break test:** a book with two main entries on one date (the newest date); `historyEntryOfDate(create:false)` and `writeDatingAt` (build the reading with the existing reader in `reading.ts`, e.g. `readingOf`) return the **same** id, the lower one. Plus a pure `historyEntryOver` check.
- **Fork compile:** a book with a main entry at Y5 M1 D1 and a branch "North" off main at Y5 M1 D3 (insert `lorebookBranches` with fork parts). (1) Asking North for Y5 M1 D3 (its fork day) with `create:true` creates **one empty row on main** (`branchId` null, content ""); (2) asking North for Y5 M1 D2 (earlier, no parent entry) does the same; (3) asking main for each of those dates afterwards answers the same id with `created:false` and the row count doesn't grow; (4) `compileSaveOf({ branchId: row.branchId, ...date }, { branchId: north, moment: null })` is `{ kind: "amendment", branchId: north, atEntryDate: true, … }`; (5) asking North for Y5 M1 D4 creates on North.
- **`assertHistoryDateFree`** (direct calls inside `testDb.transaction`): taken date on main → sentence (a) with exact text (free-form calendar spells `Year 5, Mo. 1, Day 2`; check `formatDate` for the exact spelling and assert the full string); `exceptId` lets the row itself pass; Y5 and Y5 M1 and Y5 M1 D2 are distinct; an undated row is ignored; North at its fork day and earlier → sentence (b) exact; North after its fork, on a date main also has (dated after the fork) → passes; a second fork "South" reusing North's post-fork date → passes; main writing a date on which North has its own post-fork entry → passes; main writing a date on which North holds a rule-C-breaking own row (dated before its fork, inserted directly) → passes; a dateless fork → the dateless sentence.
- `lineReading.test.ts` (pure).

Run in a capped scope (verbatim rule below):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/shared/lorebooks/lineReading.test.ts src/lib/server/scenes/historyEntryOfDate.int.test.ts src/lib/server/scenes/unfiledScenesByEntry.int.test.ts src/lib/server/state/lineSql.int.test.ts; echo test-exit=$?'`
(`lineSql.int.test.ts` and `client/lorebooks/lineConformance.test.ts` read the shared cases file; also run `src/lib/client/lorebooks/lineConformance.test.ts` to prove the new export breaks nothing.) Then typecheck your files: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . 2>&1 | grep -E "lineReading|reading\.ts|historyEntryOfDate|unfiledScenesByEntry" ; echo done'` — report errors in your files only.

## Out of scope (write down, never build)

`src/lib/server/sockets/entries.ts` (worker w3 calls your check after you), `sockets/scenes.ts` (if its comment at ~:1274 about "creates on that line's own branch" goes stale, write it under Noticed), any client file, pipelines, SDK, docs, NOMENCLATURE, a DB index, any migration.

## Stop and ask when

A name beyond `historyOwnerStep`, `assertHistoryDateFree`, `historyEntryOver` and the cases table is needed; rule C gives an answer that looks wrong for a real flow; a test expectation in this brief disagrees with the algorithm; anything needs a file not listed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand (tabs, no semicolons, double quotes, as the files already are).
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This work needs no `sdk:build`.)
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently. Never add a top-level `await` to `db/index.ts`. Never seed a row at a hardcoded id.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`.
- Scratch files start with `hist-A-w1-`.

## Report

`plans/briefs/REPORT-hist-A-w1.md`: changed files, each test file run with its pass/fail counts, tests whose old expectation you changed (and why), assumptions, **Noticed, not done**.
