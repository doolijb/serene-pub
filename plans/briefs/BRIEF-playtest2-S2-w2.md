# BRIEF playtest2-S2-w2 — ★4b: default scene names numbered at render; unfiled scenes listed, copied and exported

Supervisor: lane `playtest2-S2`. Report path: `/home/jody/github/serene-pub/plans/REPORT-playtest2-S2-w2-2026-11-04.md`.

## Goal
Owner's ruling ★4b (2026-11-04): *"number at render; store only custom names (a marker … for defaults; one migration)."* The lead accepted the marker: `scenes.name_is_default` (schema key `nameIsDefault`, boolean NOT NULL DEFAULT false), already generated (`drizzle/0142_…`) with a boot pass that marks every stored `^Scene [0-9]+( · |$)` name default. A default name is e.g. *Scene 3 · the Crypt · Day 2* (place and day added at open by `sceneNameFor`); only its **leading `Scene N`** is replaced at render by the scene's position on its lane. Stored names are never renumbered.
Also (§0-B, owner 2026-11-04): `scenes.history_entry_id` is now nullable — **null = a scene not yet compiled ("unfiled")**; such a scene must be listed, copied and exported, never dropped. Worker w1 makes open stop filing and the compile file scenes; you make the readers below cope.

### 1. `sceneDisplayNames(db, scenes)` — new, in `src/lib/server/scenes/liveScenes.ts` (put it right after `sceneNameFor`, ≈ line 675–720)
`export async function sceneDisplayNames(db: Db, scenes: ReadonlyArray<Pick<SceneRow, "id" | "sessionId" | "channel" | "name" | "nameIsDefault" | "openedAtMessageId" | "selectedMessageIds">>): Promise<Map<number, string | null>>` — each given scene's name as shown, by id.
- A scene with `nameIsDefault` and a name matching `/^Scene \d+(?= · |$)/`: the leading `Scene N` becomes `Scene <position>`, where position = 1 + the number of OTHER scenes on its lane (same `sessionId` and `channel`) that start before it — **today's `sceneNameFor` start rule**: a scene starts at `openedAtMessageId`, else (tick selection) at the smallest `selectedMessageIds`; a scene with neither starts nowhere and is not counted. Everything after `Scene N` (place, day) is kept as stored.
- Shown as stored: a custom name (`nameIsDefault` false), a null name, a default name with no session (`sessionId` null — no lane to number it on) or with no start.
- One read for the lanes of all the given scenes (`inArray(sessionId, …)`, columns `id, sessionId, channel, openedAtMessageId, selectedMessageIds`), not one per scene.
- Pure function of stored rows (P1: deterministic). Document it with a short JSDoc in the file's style (🚧 ★4b).
- Export the existing private `sceneNameFor` if you need it for the rename rule (§3); don't change what it computes.

### 2. Every reader of a scene's name reads through it
- `src/lib/server/sockets/scenes.ts` `buildSceneList` (`scenes:list`, ≈ line 204) and `sceneListByLorebookHandler` (`scenes:listByLorebook`, ≈ line 891): the row's `name` is the display name.
- `scenes:openScenes` handler (≈ line 2430–2470): `name`.
- the summarize activity's `sceneName` (`activityStore.startScene`, ≈ line 1391).
- `liveScenes.ts` `sceneHeaderOf` (≈ line 1502): the header's `name` is the display name (it reads one scene; call `sceneDisplayNames(db, [scene])`). Its place/date de-dup reads the display name.
- `src/lib/server/sockets/narrativeGraph.ts` ≈ line 1192 (`name: s.name` in the GraphBuilderScene map): the display name (one call for all `filteredRawScenes`).
- export: `src/lib/server/utils/lorebookExportBuilder.ts` (≈ line 201) passes the display name into `mapSceneForExport` — **written frozen**: the exported `name` is the display name, the format is unchanged (no new key), and an import stores it as a custom name (the column's default false) — accepted by the lead.

### 3. The rename rule — `sceneUpdateHandler` (`scenes:update`, ≈ line 516) in `sockets/scenes.ts`
When the payload carries `name` (it is `undefined` → untouched, as today):
- equal (after trim) to the scene's **current display name** (`sceneDisplayNames(db, [existing])`) → write nothing to `name` or `nameIsDefault` (the summary review's Apply sends the shown name back — `ProcessSceneModal.svelte:78,149,234` — and must not turn a default name custom);
- blank or null → **default again**: `name` = the automatic name rebuilt with `sceneNameFor` at the scene's start (its `openedAtMessageId`, else smallest selected id) and its opened clock (`sceneClockOf(existing, "opened")`), `nameIsDefault: true`; a scene with no session or no start cannot be numbered → `name: null`, `nameIsDefault: false`;
- anything else → stored as given, `nameIsDefault: false`.
Keep everything else in the handler as is (allowlist, summary, cast, apply/settle).

### 4. Unfiled scenes (history entry null) — listed, copied, exported
- `scenes:list` / `scenes:listByLorebook`: confirm an unfiled scene is in the reply (`historyEntry: null` on `scenes:list`); `listByLorebook` orders `asc(historyEntryId)` — PG puts nulls last, fine; no change unless something drops it.
- `src/lib/server/lorebooks/tableRegistry.ts` ≈ line 511 (scenes `copy`): today `if (historyEntryId == null) continue` drops a scene whose entry did not map. Skip only when the source scene HAD an entry that did not map (`row.historyEntryId != null && mapped == null`); an unfiled scene copies unfiled. The copy has `sessionId: null` (no lane), so freeze its name the way export does: `name` = the source's display name, `nameIsDefault: false`.
- `src/lib/server/utils/lorebookExportBuilder.ts` ≈ lines 195–227 groups scenes by `historyEntryId` and nests them under their history entry (the import reads scenes only nested under a dated entry: `sockets/lorebooks.ts:2949-2975`, not yours). An unfiled scene must be exported with **no format change and no importer change**:
  (a) nest it under the exported history entry of its date — `historyEntryOfDate(db, { lorebookId, branchId: scene.branchId ?? null, date: <scene's opened day> }, { create: false })` from `src/lib/server/scenes/historyEntryOfDate.ts` (read it: exact-day match on the line, a day without a month dates by year only, `date: null` → newest dated entry; it only reads with `create: false`), when that entry is in the exported set;
  (b) when there is none, the document carries a dated history entry for it — empty text, no keys, dated at the scene's day (Year 1, Month 1, Day 1 when the scene has no clock), placed after the book's history entries; several unfiled scenes of one day share one — exactly what an export written before this change carried for such a scene (open used to create that empty entry). **No DB write during export.** Use the export's own machinery for numbering (`assignHistoryEntryLocalIds`, `buildSpecV3Lorebook`, `mapEntry` in `lorebookExportMapper.ts`); keep scenes on the same lines the export reads today (check what it filters).
  If (b) needs more than a contained change (rough guide: ~80 lines, or reshaping the mapper's public functions), STOP after (a), leave (b) out, and report the two options (synthesized entry vs a new top-level unfiled-scenes key with an importer change) with what each costs.
- The name export writes is the display name (§2).
- `src/lib/server/utils/lorebookExportMapper.ts` ≈ line 793 (`mapSceneForExport`): edit only if (b) or the frozen name needs it.
- `sockets/narrativeGraph.ts`: check a scene with `historyEntryId: null` (and `historyEntry` null) builds without throwing (≈1192 already does `?? null`); also the `notExists` at ≈559 (entries with no scenes) — fine as is unless you find otherwise.

### 5. Tests
New `src/lib/server/sockets/scenes.displayNames.int.test.ts` (copy the world/fixture setup from `scenes.live.int.test.ts` — do NOT edit that file, worker w1 owns it; pass the db explicitly, 60 s timeouts):
- three opened scenes on main read `Scene 1 · …`, `Scene 2 · …`, `Scene 3 · …`; delete the second → `scenes:list` (and `scenes:listByLorebook`) read `Scene 1 …`, `Scene 2 …` for the third, its place/day suffix kept; the stored name is unchanged;
- a custom-named scene keeps its name after a delete; a scene on another channel numbers on its own lane;
- `scenes:update` with the shown (display) name keeps `nameIsDefault` true and the name renumbers after a later delete; blank (`""` and `null`) restores a default name (`nameIsDefault` true, rebuilt by `sceneNameFor`); a new name sets `nameIsDefault` false and is never renumbered;
- `scenes:openScenes` and `sceneHeaderOf` show the display name;
- an unfiled scene is listed (`historyEntry: null`).
Export/copy: in `src/lib/server/sockets/lorebooks.import-export.int.test.ts` (or a new `lorebooks.unfiledScenesExport.int.test.ts`): an unfiled scene is exported nested under its date's history entry when one exists, under a synthesized dated history entry when none does (if built), with the display name; round-trip import gets the scene. In `src/lib/server/lorebooks/tableRegistry.test.ts` / `lorebooks.duplicate.int.test.ts` / `cloneWithChanges.int.test.ts` (whichever tests the scenes copy): an unfiled scene is copied, unfiled, with its frozen display name.
To create unfiled/default-named scenes before w1's open change lands, insert scene rows directly (`historyEntryId: null`, `nameIsDefault: true`, `openedAtMessageId` …) rather than relying on `openScene`'s filing.
Run: your new files, `src/lib/server/lorebooks/tableRegistry.test.ts src/lib/server/sockets/lorebooks.duplicate.int.test.ts src/lib/server/lorebooks/cloneWithChanges.int.test.ts src/lib/server/sockets/lorebooks.import-export.int.test.ts src/lib/server/utils/lorebookExportMapper.test.ts src/lib/server/utils/lorebookExportBuilder.ownershipScoping.int.test.ts`, then `src/lib/server/sockets/narrativeGraph.buildOnItsLine.int.test.ts src/lib/server/sockets/narrativeGraph.buildReadsStoredCast.int.test.ts src/lib/server/sockets/scenes.updateScoping.int.test.ts src/lib/server/sockets/scenes.summaryReview.int.test.ts src/lib/server/sockets/scenes.cues.int.test.ts`. A red you didn't cause: report it, don't fix. A red because a test expected a stored `Scene N` that is now renumbered: fix the expectation and say which.

## Files owned
`src/lib/server/scenes/liveScenes.ts` (new `sceneDisplayNames`, `sceneNameFor` export only, `sceneHeaderOf` — only), `src/lib/server/sockets/scenes.ts` (`buildSceneList`, `sceneListByLorebookHandler`, `sceneUpdateHandler`, the startScene activity block ≈1391, the `scenes:openScenes` handler ≈2430 — only), `src/lib/server/sockets/narrativeGraph.ts` (≈1192 only), `src/lib/server/lorebooks/tableRegistry.ts` (scenes copy only), `src/lib/server/utils/lorebookExportBuilder.ts`, `src/lib/server/utils/lorebookExportMapper.ts` (≈793, only if needed), the test files in §5 and your new ones.

## Not yours
`schema.ts`, `drizzle/**`, `db/dataUpgrades/**` (done) · `historyEntryOfDate.ts` (read and call only) · `openScene`, `fileSceneUnder`, the compile/create handlers, `recordClose`, `scenes.live.int.test.ts` (worker w1) · `boundaryWatcher.ts` · `shared/sockets/types.ts` (queue) · `sockets/lorebooks.ts` (the importer; queue) · `NOMENCLATURE.md` · docs (the supervisor writes them) · client files.

## Stop and report when
(b) of §4 is more than contained; a reader needs a wire field or type change; you'd need a new exported name beyond `sceneDisplayNames`; a test you didn't cause is red.
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
