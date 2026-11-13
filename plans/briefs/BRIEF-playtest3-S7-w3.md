# BRIEF playtest3-S7-w3 — server follow-ups: placed scenes relist, compile reply map pruned, moment rollback, refusal order, dead castRefreshed

Lane `playtest3-S7`, worker 3. The supervisor checks your diff against this brief. Your final message must give: changed files, exact test commands, pass/fail counts, prettier result, and Noticed-not-done.

Context: lane S7 already moved the by-date compile's target/sampling resolution and its waiting-scenes check ahead of the entry's creation (`src/lib/server/sockets/scenes.ts` `sceneCompileHandler`, ~1078–1420). Read that handler first. Five more items, all server-side:

## Item 7 — refusal order per ask (do this first; same handler)
Right now the target + sampling block (the `resolveStepConfigs` / `SUMMARIZE_HISTORY_SPEC_ID` / `SUMMARIZE_VERSION` imports, `synthCfg`, `resolveCapabilityTarget`, the two refusals, `compileConnection`, `compileSampling`; ~1117–1169) runs before the by-date branch for BOTH asks. Change it as follows:
- **By-date ask:** resolve target + sampling before the creation, as now.
- **Entry ask:** keep the ownership, lore-writes and line refusals first. Resolve target + sampling after them, at the place the block used to be: after `if (scenes.length === 0) return refuse("No scenes found for this history entry.")`.
Do it without duplicating the block. Wrap it in one local `async` closure inside the handler (e.g. `const resolveCompileModel = async () => { …; return { synthCfg, compileConnection, compileSampling, SUMMARIZE_VERSION } }`). The closure may call `refuse(...)`, which throws, so a refusal still ends the handler. The by-date branch calls it before its transaction and keeps the result in a `let`. The entry path does `const model = resolvedModel ?? (await resolveCompileModel())` at the old place. Later code reads `model.compileConnection` etc. (or destructure). Keep every comment and every refusal string byte-identical. A handler-local closure is not an exported name.

## Item 6 — the moment check against the date the entry is made at (★S7-1, accepted by the lead)
Case: a by-date ask with `date: null`, on a line with no dated entry, with a moment before Year 1, Mo. 1, Day 1 (a whole-year moment `{ year: 1, month: null, day: null }` sorts before 1/1/1). Today this creates an entry at 1/1/1 and then the entry path refuses. Fix:
- `src/lib/server/scenes/historyEntryOfDate.ts`: add `date: StoryDate` to `HistoryEntryOfDate` (additive, internal). Doc: the date of the entry found or made. Return it on both paths: the found `best.date`, or the made `date`. Update every `historyEntryOfDate` caller only if the type forces it (it shouldn't: the field is additive).
- In the by-date transaction, right after `historyEntryOfDate(…, { create: true })` returns: if `resolved.created && askedMoment && compareDates(askedMoment, resolved.date) < 0`, `throw new Error("That moment is before this history entry's date, so there is nothing to compile into yet.")`. The throw rolls the creation back, and the existing `catch (e: any) { return refuse(e?.message || …) }` sends that sentence, which is already used on this path. Keep the early pre-check (`askedMoment && date && …`) as it is.
- Test in `src/lib/server/sockets/scenes.compileLine.int.test.ts` (`describe("scenes:compile by date")`): a book whose main line has NO dated history entry. `seedBook` makes one at Year 1, so seed a fresh minimal book in the test, or delete that entry first, whichever is simpler. One unfiled scene with no clock (`unfiledOn(w, "Undated", null)`). A by-date press with `date: null, moment: { year: 1, month: null, day: null }` rejects with `"before this history entry's date"`. `historyEntriesOf` count is unchanged and nothing is compiled. Add the same case's happy twin only if cheap (moment null makes the 1/1/1 entry).

## Item 1 — a scene the watcher places relists the history list
`afterBoundaryPlaced` (`scenes.ts` ~2561) is the path Automatic mode and judged cues take when the boundary watcher places a scene. It never calls `relistEntries`, so the history list's `unfiledSceneCount` (the Compile gate) goes stale. The manual open (`scenes.ts` ~517) and an accepted cue (`sceneDecideCueHandler`, ~2632) both do `await relistEntries(socket, lorebookId, HISTORY_TYPE_ID, emitToUser)`. Fix:
- Add `lorebookId: number | null` to `afterBoundaryPlaced`'s `params`.
- Both callers in `src/lib/server/scenes/boundaryWatcher.ts` (~776 and ~1436) pass `lorebookId: opened.scene.lorebookId ?? null`.
- Inside the existing `if (io) { … }`, after the broadcasts: `if (params.lorebookId != null) await relistEntries({ io, user: { id: userId } }, params.lorebookId, HISTORY_TYPE_ID, emitToOwner)`. `relistEntries` (`sockets/entries.ts:490`) reads only `socket.user.id` and `socket.io` (for `relayToBookReaders`), and `emitToOwner` already accepts a lazy payload. Add the same one-line comment the other sites carry: "The history list's unfiledSceneCount follows the scenes (Compile's gate)."
- Test: one new int test (a new file `src/lib/server/sockets/scenes.afterBoundaryPlaced.int.test.ts`, or add to an existing scenes int test, your choice). Use `vi.mock` of `$lib/server/sockets/entries` as a pass-through with `relistEntries` replaced by a `vi.fn()`, and `vi.mock` of `$lib/server/sockets/utils/broadcastHelpers` as no-op fns. Call `afterBoundaryPlaced({} , { sessionId, userId, lorebookId, closedSceneIds: [] })` and assert `relistEntries` was called with `expect.objectContaining({ user: { id: userId } })`, the lorebook id, `HISTORY_TYPE_ID`, and a function. With `lorebookId: null` it is not called. If a real session row is needed for `buildSceneList`, seed one; the DB mock pattern is in `scenes.compileLine.int.test.ts` top (createTestDb, `releaseDataDir`, 60 s timeouts).

## Item 2 — `compileReplyTo` never outlives its activity
`compileReplyTo` (`scenes.ts` ~1073) holds the pressing socket per compile activity. It is pruned only on a later Compile press, and its entry is deleted in the `acted` hook (`activityStore.setCompileReviewApplied`, ~2104). A dismissed, discarded, lapsed, superseded or errored compile leaves the socket closure in the map. From scenes.ts nothing can see a compile activity's removal without a hook, so add one (🚧, the lead allowed it):
- `src/lib/server/utils/activityStore.ts`: a hook in the pattern of `setCompileReviewApplied`:
  - Doc `/** 🚧 Set once at wiring time: invoked whenever a compile activity is removed, however it went (acted, dismissed, superseded, lapsed), AFTER the applied hook (when that runs) has settled, so its callee may still read what the applied hook reads. */`
  - Names: `private compileCleared?: (activity: CompileHistoryEntryActivity, how: ActivityClearedHow) => void | Promise<void>` and `setCompileCleared(fn)`.
  - In `remove()`, keep the applied-hook call's promise: `const applied = (that condition) ? Promise.resolve(this.compileReviewApplied(existing)).catch(…same warn…) : Promise.resolve()`. Then `if (existing.kind === "compile_history_entry" && this.compileCleared) void applied.then(() => this.compileCleared!(existing, how)).catch(() => {})`.
  - Behaviour otherwise unchanged.
- `scenes.ts`: `activityStore.setCompileCleared((activity) => { compileReplyTo.delete(activity.id) })`, beside the applied hook, with a one-line 🚧 comment. In the applied hook, move the existing `compileReplyTo.delete(activity.id)` to AFTER the re-send (lead's ask). The cleared hook then backs it up.
- Tests:
  - In `src/lib/server/utils/activityStore.compileApplied.test.ts` (read it for its pattern): the cleared hook runs once for `dismissed`, `lapsed`, `superseded` and `acted`, with the activity and the how. On `acted` with sceneIds in review, it runs only after the applied hook's promise resolves: make the applied hook await a gate and assert the cleared hook has not run until the gate opens.
  - In `scenes.compileLine.int.test.ts`: a press whose entry has an unfiled scene of its day (see `seedDay` / the §0-B describe), then `activityStore.remove(id, "dismissed")`. Assert the map entry is gone. `compileReplyTo` is module-private, so observe it via `vi.spyOn(Map.prototype, "delete")` and check a call with the activity id whose `this` (`spy.mock.contexts[i]`) is not `(activityStore as any).activities` nor `(activityStore as any).abortControllers`. Restore the spy. If you find a cleaner observation that adds no exported name, use that and say so.

## Item 5 — remove the dead `WatchResult.castRefreshed`
`boundaryWatcher.ts`: `WatchResult.castRefreshed?` (~119–120) is never read (the cause is derived at read by `sceneCauses`), and it is dropped whenever `watch()` returns null. Fix:
- Remove the field and its doc.
- In `watchSceneBoundaries` (~575–579), call `await followOpenSceneCast(db, params)` for its effect only, and keep the `result?.outcome !== "placed"` guard and its comment.
- Keep `followOpenSceneCast`'s own return value and `openSceneCastCause` unchanged: `boundaryWatcher.genre.int.test.ts` asserts on that return.
- Grep for any other `castRefreshed` reader in `src/` (expect none) and report what you found.

## Files owned (the only files you may edit)
- `src/lib/server/sockets/scenes.ts`: `sceneCompileHandler`, `afterBoundaryPlaced`, the `setCompileReviewApplied` hook and a new `setCompileCleared` wiring beside it. Do NOT touch the scene-name code near ~668 (another worker comes after you).
- `src/lib/server/utils/activityStore.ts`: the hook only.
- `src/lib/server/scenes/historyEntryOfDate.ts`: the `date` field only.
- `src/lib/server/scenes/boundaryWatcher.ts`: the two `afterBoundaryPlaced` call sites and item 5 only.
- Tests: `src/lib/server/sockets/scenes.compileLine.int.test.ts`, `src/lib/server/utils/activityStore.compileApplied.test.ts`, and one new or existing scenes int test for item 1.

A client worker edits `CompileHistoryEntryModal.svelte` beside you; never touch client files. Re-read each file immediately before every edit. Use Edit, never Write, on existing files.

## Rules your work depends on (quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Sockets: one domain context per event family … is the only listener, and the only place that toasts. An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." `entries:list` via `relistEntries` is already used this way elsewhere, so don't change its payload.
- "Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24." The only new names allowed are the ones above: `HistoryEntryOfDate.date`, `setCompileCleared`/`compileCleared`, the `afterBoundaryPlaced` param `lorebookId`, plus handler-local and test-local variables. No new error strings: item 6 reuses the existing sentence.
- "An int test that opens a DB inside an `it` gets a 60 s timeout."
- "Two writers of one thing is a bug." You only re-send lists; you write nothing new.
- Do what was asked, at the size asked. Anything else goes under **Noticed, not done**.

## Run (capped; never pipe vitest into `head`)
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/utils/activityStore.compileApplied.test.ts src/lib/server/scenes/historyEntryOfDate.int.test.ts <your item-1 test file> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-w3a.log 2>&1; echo exit=$?'`
then, separately: `src/lib/server/scenes/boundaryWatcher.genre.int.test.ts src/lib/server/scenes/sceneCauses.int.test.ts src/lib/server/scenes/unfiledScenesByEntry.int.test.ts` → `playtest3-S7-w3b.log`.
Read each log. Re-run after your last edit. Then `npx prettier --check` on each changed file: report it, and fix only failures on lines you touched. Never `--write`.

## Stop and report (don't decide) when
A refusal can't be reordered without duplicating a query; a new name beyond those listed seems needed; another file must change.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK build is needed.)
- Never `git checkout`, `git restore` or `git clean`. Never a full `npm test`, `npm run check`, or project-wide `tsc`.
