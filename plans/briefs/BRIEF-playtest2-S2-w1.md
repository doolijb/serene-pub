# BRIEF playtest2-S2-w1 — §0-B: scene open files nothing; compile files a waiting scene under the history entry of its date

Supervisor: lane `playtest2-S2`. Report path: `/home/jody/github/serene-pub/plans/REPORT-playtest2-S2-w1-2026-11-04.md`.

## Goal
The owner's ruling (§0-B, 2026-11-04): *"a scene compiles into the history entry of its date when one exists on the book, else creates that dated entry; scene open creates nothing."* No history entry exists until a scene compiles. The migration (already applied in the chain) makes `scenes.history_entry_id` nullable: **null = a scene not yet compiled ("unfiled")**. FK + `onDelete: cascade` stay (⚠ deleting a history entry still deletes the scenes filed under it).

The shared helper is written already — **read it, don't change its contract**: `src/lib/server/scenes/historyEntryOfDate.ts`
`historyEntryOfDate(tx, { lorebookId, branchId, date }, { create })` → `{ historyEntryId, created }` (or `null` with `create: false` when none matches). The entry of a date = the history entry dated exactly that day on the line (highest position); a day without a month (13c Day-count clock) dates by year only; `date: null` = the newest dated entry on the line, else Year 1, Month 1, Day 1. It throws `BranchRefusal` for a line not the book's. You may fix a real bug in it (say so in the report), nothing else.

### 1. `src/lib/server/scenes/liveScenes.ts` — `openScene` (≈ line 967) and the filing code only
- `openScene` files nothing: remove the `fileSceneUnder` call; insert the scene with `historyEntryId: null` (or omit it) and **`nameIsDefault: true`** (its name comes from `sceneNameFor`, the automatic name — the other worker numbers it at render).
- Delete `fileSceneUnder` (≈ line 481) — its date-match half now lives in `historyEntryOfDate`; nothing else may call it (grep `src` for callers first; `boundaryWatcher.ts` is read-only for this lane — if it calls `fileSceneUnder`, stop and report).
- `createdHistoryEntry`: no open creates one any more. Remove it from `LiveSceneResult` and from `openScene`'s return, and the spread in `replyLiveScene` in `sockets/scenes.ts` (≈ line 1903). The wire type `createdHistoryEntry?: boolean` in `src/lib/shared/sockets/types.ts:14190` is NOT yours — queue its removal in the report.
- Update the file's header comment item 1 (**Filing**) to the new rule (a scene opens filed under nothing; its compile files it under the history entry of its date, creating it when the book has none). Remove now-unused imports only if your change made them unused (`assertDateLands`, `historyEntryDate`, `rowReadsOnLine`, `HISTORY_TYPE_ID`, `entryInsert`, `lineOfBook`, `BranchRefusal` may still be used elsewhere in the file — grep before removing).
- Do NOT touch `sceneNameFor`, `sceneHeaderOf`, or add `sceneDisplayNames` — worker w2 owns those.

### 2. `src/lib/server/sockets/scenes.ts` — the compile handler, the create handler, the two timeline records
- **`sceneCompileHandler` (≈ line 985).** It keeps its by-entry-id ask (`params.historyEntryId`) — the Compile-by-date ask is a later lane (S-B2), and `Sockets.Scenes.Compile.Params` does not change. After the existing checks (entry found and owned, lore writes not Off, line resolved, entry reads on the line, moment check) and BEFORE the `lineScenes` query: inside ONE `db.transaction(async (tx) => …)` (use only `tx`), take `lockBookCalendar(tx, lorebookId)` (import from `$lib/server/state/storyTime`), read the book's **unfiled** scenes on the line (`isNull(schema.scenes.historyEntryId)`, `eq(lorebookId)`, `onLineSql(schema.scenes.branchId, line)`, then `rowsReadingOnLine(…, line, (s) => <the scene's day>)` as the existing query does), and for each one ask `historyEntryOfDate(tx, { lorebookId, branchId: scene.branchId ?? null, date: <scene day> }, { create: false })`; when that answers **the asked entry's id**, file the scene under it (`UPDATE scenes SET history_entry_id = … WHERE id = … AND history_entry_id IS NULL`). A scene whose date's entry is some other entry, or none, stays unfiled (its own compile files it). The scene's day = `sceneClockOf(scene, "opened")` (export it is already exported) reduced to the day (`{ year, month, day }`, null when the scene has no clock). Then the existing `lineScenes` query runs unchanged and picks them up. A `BranchRefusal` from the helper → `refuse("That line is not one of this lorebook's.", e)` like the existing one.
  Why `create: false` here: a by-entry-id ask always has its entry; compiling one entry must never create entries for other days (P1: no hidden automatic action). The `create: true` half is the one the by-date ask (S-B2) will call; it is covered by the helper's tests below.
- **`sceneCreateHandler` (≈ line 278–392).** `historyEntryId` may now be absent/null on the payload: then the scene is stored unfiled and the history-entry lookup + line check are skipped (never `eq(id, null)`). When it is given, everything stays as today (verified, refused the same way).
- **Timeline records:** `scenes:create` (≈ line 469) and `recordClose` (≈ line 2074) pass `historyEntryId: scene.historyEntryId`. For an unfiled scene pass `undefined` (`?? undefined`) so `recordToTimeline` dates the write from the reading, as a session's other writes are (`state/durable.ts:202`), never an explicit null.
- Do NOT touch `buildSceneList`, `sceneListByLorebookHandler`, `sceneUpdateHandler`, the `startScene` activity block (≈1391) or the `scenes:openScenes` handler (≈2455) — worker w2 owns those.

### 3. Server readers to CHECK (not edit unless owned here)
- `src/lib/server/state/durable.ts:402-418` `newestHistoryEntryOf` types `best` as `{ id: number; historyEntryId: number }` — now a type error (number | null). NOT yours: queue the exact fix (`historyEntryId: number | null`) in the report, and say what it now returns when the newest scene is unfiled (null anchor) and who reads it (`sessions/settle.ts:174`, `sockets/sessions.ts:1863-1870`).
- `src/lib/server/attic/etl/lore.ts:299` reads 0.5.3 data whose column is NOT NULL: confirm in the report it needs no change (do not edit it).
- grep `src/lib/server` for any other reader of a scene row's `historyEntryId` that assumes a number (`scenes.historyEntryId`, `scene.historyEntryId`, `s.historyEntryId`) and list each with a verdict (crash / drops the scene / fine). Do not edit them unless they are in your Files owned; files `sockets/narrativeGraph.ts`, `lorebooks/tableRegistry.ts`, `utils/lorebookExport*.ts` are worker w2's — list, don't edit.

### 4. Client readers — check a null history entry doesn't crash them
`src/lib/client/**/requests/historyEntries.ts:~308`, `**/time/storyTime.ts:~167,192`, `TimeLens.svelte:~170`, `EntryWorkspace.svelte:~667`, `lorebooks/sections/index.ts:~398`, `BookSettings.svelte:~162` (find the exact paths with `find src -name …`). For each: does a scene with `historyEntryId: null` (and, on `scenes:list` rows, `historyEntry: null`) throw, or is it just not shown? Where it would **throw**, add the minimal null guard (skip the scene) and nothing else; where it is only not shown, leave the file untouched and say so. If a `.ts` reader has a unit test beside it, add a case with a null entry; for a `.svelte` reader, reason it from the code and quote the line.

### 5. Tests (beside each; add cases, keep existing ones green)
New file `src/lib/server/scenes/historyEntryOfDate.int.test.ts` (use the DB fixture pattern the scene int tests use — read `src/lib/server/sockets/scenes.live.int.test.ts` and `scenes.compileLine.int.test.ts` for `createTestDb` / world setup and the `defaultDb()` mocking pattern; pass the db explicitly):
- the entry of the date when present (no new row; of two same-dated entries, the higher position);
- none dated that day: `create: false` → null; `create: true` → creates the entry dated that day, after the last position, `created: true`, and a second call answers the same entry with `created: false`;
- a Day-count clock date `{ year: 3, month: null, day: 2 }` dates by year only (`{ year: 3 }`, month and day null) — matches a Year-3 entry, creates one when absent;
- a sibling line's entry is never the answer;
- `date: null`: newest dated entry, else Year 1, Month 1, Day 1.
In `src/lib/server/sockets/scenes.live.int.test.ts`: the two open tests at ≈153 and ≈182 assert the old filing — change them to the new rule: **open creates no entry** (`res.scene.historyEntryId` null, no new history entry row in the book, `nameIsDefault` true); keep every other assertion.
In `src/lib/server/sockets/scenes.compileLine.int.test.ts` (or a new `scenes.compileFiles.int.test.ts` if cleaner): **compile fills the day's entry** — an unfiled scene opened on the entry's day is filed under the asked entry and compiled; an unfiled scene of another day stays unfiled; a scene already filed is untouched. (Compile needs a model: follow how the existing compile tests stub `compileScenesForEntry` / the connection; if no existing test reaches the scene query without a model, assert the filing by stubbing the summarizer with `vi.mock` as they do.)
`scenes.createLine.int.test.ts` / `scenes.createScoping.int.test.ts`: a create without `historyEntryId` stores an unfiled scene; with a foreign one still refuses.
Run: `src/lib/server/scenes/historyEntryOfDate.int.test.ts src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/sockets/scenes.createLine.int.test.ts src/lib/server/sockets/scenes.createScoping.int.test.ts src/lib/server/scenes/liveScenes.rewind.int.test.ts`, then `src/lib/server/scenes/boundaryWatcher.int.test.ts src/lib/server/scenes/boundaryWatcher.genre.int.test.ts src/lib/server/scenes/judgedSceneCue.int.test.ts src/lib/server/sockets/scenes.laneE.int.test.ts src/lib/server/sockets/scenes.captureAndLine.int.test.ts src/lib/server/sockets/scenes.loreWritesOff.int.test.ts`. A red caused by the old open-files rule in a test file: fix the assertion to the new rule (say which). A red you didn't cause: report it, don't fix.

## Files owned
`src/lib/server/scenes/liveScenes.ts` (openScene, fileSceneUnder removal, LiveSceneResult, header comment — only), `src/lib/server/scenes/historyEntryOfDate.ts` (bug fixes only), `src/lib/server/sockets/scenes.ts` (compile handler, create handler, `recordClose`, the `createdHistoryEntry` spread in `replyLiveScene` — only), the client readers in §4 (minimal null guards only, only if they throw), new `src/lib/server/scenes/historyEntryOfDate.int.test.ts`, the test files named in §5 (and any new `scenes.compileFiles.int.test.ts`).

## Not yours
`schema.ts`, `drizzle/**`, `db/dataUpgrades/**` (done by the supervisor) · `boundaryWatcher.ts` (read only) · `shared/sockets/types.ts` (queue) · `NOMENCLATURE.md` · `state/durable.ts` (queue) · docs (the supervisor writes them) · `CompileHistoryEntryModal.svelte` · `sceneNameFor`, `sceneDisplayNames`, `sceneHeaderOf`, `buildSceneList`, `scenes:listByLorebook`, `scenes:update`, `scenes:openScenes`, the startScene activity, `narrativeGraph.ts`, `tableRegistry.ts`, the export files (worker w2).

## Stop and report when
A caller of `fileSceneUnder` outside `liveScenes.ts`; a client reader needs more than a null guard; you'd need a new exported name, event, field or user-visible string; a test you didn't cause is red.
# Rules every playtest2-S2 worker follows (quoted by the supervisor from CLAUDE.md, the lane brief and the multi-agent guide)

Verbatim lines (multi-agent guide):
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This lane needs no SDK build; don't run one.)

Working in shared files:
- Another worker edits OTHER functions of `src/lib/server/scenes/liveScenes.ts` and `src/lib/server/sockets/scenes.ts` at the same time, and other programmes edit nearby trees. **Re-read the exact lines immediately before every edit; use the Edit tool (exact string replace), never Write, on any existing file; touch only the functions your brief names.** Never run `prettier --write` on a whole file (reformatting buries the diff and collides with the other worker); keep the file's existing style by hand.
- Never edit a file not in your brief's Files owned. A change you need elsewhere: write it under "Queued" in your report with file:line and exact text.
- Never edit server files while a dev server boots (`pgrep -af "vite dev"`; none should be running — if one starts, stop editing and report).

DB rules (CLAUDE.md Hard rules):
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently (`db/transactionGuard.ts` throws in dev/test).
- Never seed a row at a hardcoded id. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- The migration is already generated (`drizzle/0142_scenes_unfiled_default_names.sql`: `scenes.history_entry_id` nullable, `scenes.name_is_default boolean NOT NULL DEFAULT false`; schema key `nameIsDefault`). Never write or edit a migration or `schema.ts`.

Names (NOMENCLATURE §1, §24): R1 one word one meaning; R3 qualify, never the bare noun (`history entry`, never `entry`/`history` bare in copy); it is a **session**, never a *chat*. The only new names this lane may introduce: `name_is_default`/`nameIsDefault`, `historyEntryOfDate`, `sceneDisplayNames`. Any other new exported identifier, event, field, setting or user-visible string: stop and list it in your report instead (a module-private helper function inside a file is fine; say its name in the report).

P1: no new automatic behaviour beyond the brief. Do what was asked at the size asked; findings go under **Noticed, not done**, never fixed in passing.

Tests — only the files your brief names, plus files you add. Never a full `npm test`, `npm run check`, `tsc` over the project. Run vitest exactly as:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S2-<worker>-<n>.log 2>&1; echo exit=$?'`
then read the log (tail/grep). Never pipe vitest into `head`. An int test that opens a DB inside an `it` gets a 60 s timeout (`}, 60_000)`). Run at most ~6 int files per invocation.

Report: write it to your brief's report path (if the write is refused, put the whole report in your final message): Changed files · Tests run (exact command, pass/fail counts, log path) · Decisions you made · Stopped / needs supervisor · Queued (file:line + exact text) · Noticed, not done.
