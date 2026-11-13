# BRIEF playtest4-P1-w1 — one history-rows read per `unfiledScenesByEntry` call, through a pure picker

Worker of lane `playtest4-P1` (supervisor reviews your diff). Working dir `/home/jody/github/serene-pub`. Report: put it in your final message (changed files, test command + pass/fail counts, decisions, anything you could not do).

## Goal
Today `src/lib/server/scenes/unfiledScenesByEntry.ts` calls `historyEntryOfDate(db, …, { create: false })` once per (branch, day) group; each call re-runs `lineOfBook` and re-reads every history entry of the book. Make it read the book's history rows ONCE per call, with behaviour byte-identical.

1. In `src/lib/server/scenes/historyEntryOfDate.ts` extract the loop at lines ~93–104 (target = `dayOnly(date)`; for each row: `historyEntryDate(row.fields)`, skip if none or `!rowReadsOnLine(row, line, date)`; with a target, only an exact-day match; newest date wins, ties by higher `position`) into ONE exported pure function:
   `export function pickEntryOfDate(rows: ReadonlyArray<{ id: number; branchId: number | null; fields: unknown; position: number }>, line: Line, date: StoryDate | null): { historyEntryId: number; date: StoryDate } | null`
   (adjust the `fields`/`branchId` types to whatever the existing select returns and `historyEntryDate` / `rowReadsOnLine` accept; no `any`). It applies `dayOnly` to `date` itself. `historyEntryOfDate` must call it — the rule exists in exactly one place. The `create: true` path (`assertDateLands`, the last-position read, the insert) stays in `historyEntryOfDate` only, unchanged; it needs the `target` (`dayOnly(at.date)`), keep computing that there for the creation date. If you find the create path cannot be kept without duplicating the picker's rule, STOP and say so in your report.
   Add one line to the file header naming `pickEntryOfDate` as the pure date-match over already-read rows.
2. In `unfiledScenesByEntry.ts`:
   - If there are no groups, return the empty map with no further reads.
   - Read the book's history rows once (same select as `historyEntryOfDate`: `id, branchId, fields, position` from `schema.lorebookEntries` where `lorebookId` and `typeId = HISTORY_TYPE_ID`; import `HISTORY_TYPE_ID` from where `historyEntryOfDate.ts` does). Do NOT add a new exported helper for this read (a new name needs the owner); a local query is fine.
   - **The line is per scene, not per call**: each group keeps its own `branchId` (the scene's), resolved by `lineOfBook(db, lorebookId, group.branchId)` (from `$lib/server/state/reading`) **once per DISTINCT branchId**, memoised in a local Map for this call only (no module-level cache — a cache is out of scope). A branchId whose `lineOfBook` throws `BranchRefusal` skips every group on it (memoise the refusal too), exactly as today's `continue`; any other error rethrows. Never resolve groups on the `at.line` (the viewer's line) — `at.line` stays only the scene filter it is today.
   - Each group → `pickEntryOfDate(historyRows, groupLine, group.date)`; null → skip; else merge into `byEntry` exactly as today (id-ordered).
   - Update the charter bullet at line 13 ("One `historyEntryOfDate` call per (scene line, day)…") to say: the book's history rows read once per call, one `lineOfBook` per distinct scene line, each (line, day) group through `pickEntryOfDate` — the same rule `historyEntryOfDate` runs. Keep the `BranchRefusal` sentence. Line 3 may keep naming `historyEntryOfDate`'s rule; make it accurate.
   - Drop the now-unused `historyEntryOfDate` import if unused.
3. Tests, in `src/lib/server/scenes/unfiledScenesByEntry.int.test.ts` (existing fixtures `makeBook`, `scene`, `branch`, `idsOf`), add two cases:
   a. **Equivalence:** a book with several groups — at least: two main-line days with entries (one with two entries that day at different positions), a main-line day with no entry, a fork with its own scenes on a day that has an entry, a Day-count (year-only) scene with a year entry, an undated scene (no clock) if `rowsReadingOnLine` keeps it (check; if it is filtered out, say so in a comment and skip it). Compute the expected map in the test by the OLD rule: group the `unfiledScenesByEntry` input scenes by (branchId, day) yourself and call `historyEntryOfDate(db, { lorebookId, branchId, date }, { create: false })` per group, merging id-ordered, skipping `BranchRefusal`. Assert `unfiledScenesByEntry` on main AND on the fork's line equal that expectation (compare as sorted `[entryId, sceneIds[]]` arrays). Also assert no history row was created (count before/after).
   b. **Fork-only entry, main-line scene, read from the fork:** fork F; a history entry with `branchId: F.id` dated 3/1/1 (same day as `makeBook`'s `day1`, with a HIGHER position than day1); a main-line scene (branchId null) dated 3/1/1. Read with `line: await lineOfBook(db, book.id, F.id)`: the main-line scene still files under `day1` (resolved on ITS own line, main — which does not read the fork's entry), not the fork's entry. (Insert the fork entry via `historyValues([{ lorebookId, year: 3, month: 1, day: 1, branchId: F.id, position: … } as any])`; check `historyValues` in `src/lib/server/pipelines/testing/fixtures` accepts `branchId`/`position`, else set them in an update.)
   Also in `src/lib/server/scenes/historyEntryOfDate.int.test.ts`, add one small pure case for `pickEntryOfDate` over in-memory rows (exact day; tie → higher position; null date → newest; a sibling-line row skipped) — use `MAIN_LINE` and a line built by `lineOfBook` or the shared `lineOf` if it is pure.
   These int files already set `vi.setConfig({ testTimeout: 60_000 … })` or per-test timeouts — keep 60 s for any test doing DB work.

## Files owned (edit ONLY these; re-read each immediately before editing; use Edit, never Write over an existing file)
- `src/lib/server/scenes/historyEntryOfDate.ts`
- `src/lib/server/scenes/historyEntryOfDate.int.test.ts`
- `src/lib/server/scenes/unfiledScenesByEntry.ts`
- `src/lib/server/scenes/unfiledScenesByEntry.int.test.ts`
Everything else is read-only. Another worker edits `src/lib/server/scenes/liveScenes.ts` at the same time; other lanes edit `src/lib/server/sockets/scenes.ts`, `utils/activityStore.ts` — never touch them.

## Out of scope — never build
A cache (beyond the per-call local Map); a setting; any change to what is listed or which entry a scene maps to; `relistEntries`' fan-out; any new exported name besides `pickEntryOfDate`.

## Rules you work under (quoted from CLAUDE.md / the lead)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (`unfiledScenesByEntry` takes the caller's handle; use only that handle for every read.)
- "Never seed a row at a hardcoded id."
- "An int test that opens a DB inside an `it` gets a 60 s timeout."
- No SDK changes. No `NOMENCLATURE.md` edits.

## Tests (only these)
Run exactly:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/scenes/unfiledScenesByEntry.int.test.ts src/lib/server/scenes/historyEntryOfDate.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-P1-w1.log 2>&1; echo exit=$?'`
then read the log (tail). Then `npx prettier --check` on your four files. Never a full `npm test`, `npm run check`, or project `tsc`.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never pipe vitest into `head`.
