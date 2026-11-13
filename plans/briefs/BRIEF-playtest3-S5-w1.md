# BRIEF playtest3-S5-w1 — server: Compile by date; scene rows carry `openedBecause` / `castCause`

Lane `playtest3-S5` · worker 1 · supervisor reads your final hand-back (put the full report there; do not write a report file).

## Goal
Two server pieces. The shared types are ALREADY written by the supervisor in `src/lib/shared/sockets/types.ts` — read them, do not change them unless something cannot compile (then say so):
- `Sockets.Scenes.Compile.Params = ByEntry | ByDate` (~:14148). `ByDate = { lorebookId; date: StoryDate | null; branchId; moment }`.
- `Sockets.Scenes.SceneListRow` gains optional `openedBecause?: string`, `castCause?: string` (~:13963); `OpenScenes.Response.scenes[]` gains the same two (~:14420).

### 1. Compile by date (`src/lib/server/sockets/scenes.ts`, `sceneCompileHandler` ~:1071)
The ruling (owner 2026-11-04): *"a Not yet compiled group at the top of the History lens, scenes by date, one **Compile** per date that creates the dated entry if none exists."* The client sends `ByDate`; the server turns it into the entry-id compile that exists today, then runs exactly that path (frames, activity, review, Apply-time filing via `setCompileReviewApplied` — all unchanged).
For a `ByDate` ask, in this order, refusing through the handler's own `refuse()` (the `scenes:compile:error` event) and creating NOTHING on any refusal:
1. The lorebook exists and `lorebook.userId === userId`, else *"Lorebook not found or access denied."*; `bookLoreWriteMode(db, lorebookId) === "off"` → `LORE_WRITES_OFF` (as the entry path).
2. `date`: null, or `storyDateFrom(params.date)` (refuse *"That date is not a story date."* when it does not parse). `moment` parses as today.
3. `lineOfBook(db, lorebookId, branchId)`; `BranchRefusal` → *"That line is not one of this lorebook's."*
4. A moment before the date (`moment && date && compareDates(moment, dayOnly(date)) < 0`) → the entry path's sentence *"That moment is before this history entry's date, so there is nothing to compile into yet."*
5. **Pre-check, so a stale press never leaves an empty entry:** the asked line's OWN unfiled scenes of that day exist — `scenes` rows with `historyEntryId IS NULL`, this `lorebookId`, `branchId` equal to the asked line (`isNull` for main), and whose day equals `dayOnly(date)` (a scene's day: `openedStoryClockYear/Month/Day` through `dayOnly`, exported from `scenes/historyEntryOfDate.ts`; `date: null` ⇒ the scenes with `openedStoryClockYear IS NULL`). None → *"No scenes of that day are waiting to be compiled."*
6. `const resolved = await db.transaction(async (tx) => { await lockBookCalendar(tx, lorebookId); return historyEntryOfDate(tx, { lorebookId, branchId, date }, { create: true }) })` — **inside the callback use only `tx`** (the outer `db` deadlocks PGlite silently). This is the ONLY caller with `create: true`. `assertDateLands` inside it may throw: word that as a refusal with its message.
7. When `resolved.created`: `await relistEntries(socket, lorebookId, HISTORY_TYPE_ID, emitToUser)` BEFORE the run starts (the client must hold the new row before the compile's `activity:update` reaches it).
8. Continue as the entry-id ask with `historyEntryId = resolved.historyEntryId` (same `branchId`, `moment`). Refactor minimally: e.g. resolve to an entry-id params object at the top and let the existing body read that; every `params.historyEntryId` read below must read the resolved id, and `about` (the refusal's `historyEntryId`) must name the resolved id once it is known. Keep the narrowing type-safe (`"historyEntryId" in params`), no `as any` on params.
The `ByEntry` path must behave byte-for-byte as before.

### 2. Scene causes (★S-4), derived at read — `src/lib/server/scenes/liveScenes.ts`
Owner ruling 2026-11-04: *"scene rows carry `openedBecause` + `castCause`; `ConversationSceneV1` the same (optional); the divider shows them under its name and in the faces' title."* Lead (challenger round): *"S5 derives `castCause` at read in `liveScenes.ts` (no second writer, P2), `sessionEvents.ts` untouched."* No column, no store, no migration.
Add one exported read helper in `liveScenes.ts`: `sceneCauses(db, scenes) → Map<sceneId, { openedBecause?: string; castCause?: string }>` (only scenes that have one get an entry; keys absent when absent). Batched: one cue query for all the scenes, one `sessionSceneContext` per distinct session.
- **`openedBecause`**: for a live scene (`sessionId` and `openedAtMessageId` not null), the `scene_cues` rows with `state = 'placed'` at `(sessionId, channel, atMessageId = scene.openedAtMessageId)`; their triggers ordered and worded **exactly as `offeredSceneCues` words a chip** (`boundaryWatcher.ts` ~:950–1040: `triggerOrder(declared)`, the declared triggers' `i18nText(label)`, a `judged` cue's own `reason` or `JUDGED_CUE_FALLBACK_REASON`, then `sceneCueReason`). Do not copy that logic: extract the ordering+wording into one exported function in `boundaryWatcher.ts` that both `offeredSceneCues` and `sceneCauses` call (the chip's output must not change — `offeredSceneCues` tests stay green). Import `boundaryWatcher` from `liveScenes` by **dynamic** `await import(...)` (boundaryWatcher already dynamically imports liveScenes; avoid a static cycle). No placed cue → no `openedBecause` (a scene a person opened, by hand or by accepting a cue — `accepted` is NOT `placed`).
- **`castCause`**: for an OPEN live scene (`openedAtMessageId` not null, `closedAtMessageId` null, `sessionId` not null): `ctx = await sessionSceneContext(db, sessionId)` (`server/sessions/sceneSettings.ts`); present iff `ctx && ctx.castRefresh && ctx.settings.mode !== "manual"`, valued `openSceneCastCause(ctx.genreName)` (already exported from `boundaryWatcher.ts`, a pure function — the same condition `followOpenSceneCast` runs on). Never on a closed scene or a captured-by-selection scene.
- Wire it into every scene row reply: `sceneReplyRow` (liveScenes.ts ~:898), and in `sockets/scenes.ts` `buildSceneList` (`scenes:list`, ~:208), the `scenes:listByLorebook` handler (~:1004), and `scenes:openScenes` (~:2625; its rows are a different shape — add the two keys there). Spread only defined keys (`...(c.openedBecause ? { openedBecause } : {})`) so a row without a cause has no key.
- Do NOT touch `src/lib/server/sessions/sessionEvents.ts`.

## Files owned (re-read each immediately before editing — other lanes work in the same trees)
`src/lib/server/sockets/scenes.ts`, `src/lib/server/scenes/liveScenes.ts`, `src/lib/server/scenes/boundaryWatcher.ts` (the extracted wording function only), tests: `src/lib/server/sockets/scenes.compileLine.int.test.ts`, `src/lib/server/sockets/scenes.live.int.test.ts`, and one new `src/lib/server/scenes/sceneCauses.int.test.ts`.
## Files readable
Everything. Not yours to edit: `historyEntryOfDate.ts`, `unfiledScenesByEntry.ts` (call only), `shared/sockets/types.ts` (supervisor's), `sessionEvents.ts`, `NOMENCLATURE.md`, `db/defaults.ts`, anything client-side.
## Out of scope — never built
A column or store for the causes; any setting; renumbering; changing the compile model prompt; any new socket event; Chronicle (`requests/historyEntries.ts`).
## Stop and ask when (put it in your hand-back, do not decide)
A migration seems needed; the by-date path cannot reuse the entry path; a new name beyond `sceneCauses`, the extracted wording function, `openedBecause`, `castCause`, and the error sentences above; anything outside the files owned.

## Tests (new cases; keep every existing case green)
- `scenes.compileLine.int`: ByDate with no entry of the day → exactly one history entry created on the asked line, dated that day, the run compiles that day's unfiled scenes, the press files nothing, the review's `acted` files them (reuse the file's existing adapter/activity helpers); ByDate when an entry of the day exists → no entry created, that entry compiled; ByDate `date: null` over no-clock scenes; ByDate with no unfiled scenes of that day → refused, NO entry created; ByDate with `moment` before the date → refused, nothing created; ByDate on a book of another user → refused. An existing ByEntry case still passes unchanged.
- `sceneCauses.int` (new): an Automatic-placed scene (a `placed` cue at its opening line) carries `openedBecause` with the chip's words; a scene a person opened (no cue, and one with an `accepted` cue) carries none; two triggers at one line join in chip order; `castCause` present for the open scene under a genre with `scenes.castRefresh: true` and mode not Manual (copy the fixture genre approach of `boundaryWatcher.genre.int.test.ts`, `test:genre/opening`), absent under Manual, absent on a closed scene, absent for a genre without `castRefresh`.
- `scenes.live.int`: one case that `scenes:list` and `scenes:listByLorebook` rows carry `openedBecause` for a placed scene and have NO `openedBecause` key for a hand-opened one.
- Rows that lack both keys still read everywhere (they are optional; just keep the existing tests green).
Run (only these files):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/scenes/sceneCauses.int.test.ts src/lib/server/sockets/scenes.displayNames.int.test.ts src/lib/server/scenes/boundaryWatcher.int.test.ts src/lib/server/scenes/boundaryWatcher.genre.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S5-w1-<n>.log 2>&1; echo exit=$?'` then read the log (grep for `Test Files`, `Tests`, `FAIL`). An int test that opens a DB inside an `it` gets a 60 s timeout. Check `find /home/jody/github/serene-pub/src -name "boundaryWatcher*.int.test.ts"` for the exact watcher test paths first.

## Rules you work under (quoted from CLAUDE.md and the lead)
- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."*
- *"Never seed a row at a hardcoded id."* *"Never add a top-level `await` to `src/lib/server/db/index.ts`."*
- *"An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing."* (`entries:list` relists carry `lorebookId` already through `relistEntries`.)
- *"Stored data. 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it."* No migration in this task.
- *"P1. A new automatic behaviour is off in core until a genre opts in; every automatic action shows its cause on the line and how to switch it off."* (This task is the showing half.)
- Do what was asked, at the size asked. Findings along the way go under **Noticed, not done** in your hand-back, never fixed in passing. Prettier: check only your changed files with `npx prettier --check <file>`; do NOT reformat whole files (`prettier --write` over a whole file has made earlier lanes' diffs unreviewable) — if a file was already unformatted, leave its untouched parts alone.
- Never run a project-wide `tsc`, `npm run check`, or `npm test`.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an `sdk:build`.)
- Never pipe vitest into `head`.

## Hand-back
Changed files with a line-range summary each · the exact test command(s) and pass/fail counts · every decision you made · Stopped/needs supervisor · Noticed, not done.
