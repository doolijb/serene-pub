# BRIEF playtest4-P1-w2 — `sceneDisplayNames` linear; `sceneCauses` reads contexts in parallel

Worker of lane `playtest4-P1` (supervisor reviews your diff). Working dir `/home/jody/github/serene-pub`. Report: put it in your final message (changed files, test command + pass/fail counts, decisions, anything you could not do).

## Goal
In `src/lib/server/scenes/liveScenes.ts`, ONLY the functions `sceneDisplayNames` (~630–680) and `sceneCauses` (~931–1000). Output identical.

1. **`sceneDisplayNames`** is quadratic: `numbered.includes(s)` per scene and a full `lanes.filter` per scene. Rewrite the body after the `lanes` read:
   - `numbered` membership via a `Set` of the numbered scene objects (or their ids — but note the loop iterates `scenes` and today tests object identity; ids are unique per row so a Set of ids is equivalent).
   - Group the `lanes` rows per (sessionId, channel) lane. Key safely: `channel` may be `null` or a string — never build a string key where `null` and the string `"null"` collide (use a nested `Map<sessionId, Map<channel|null, …>>`, or `JSON.stringify([sessionId, channel])`). Today's equality is strict (`o.sessionId !== s.sessionId || o.channel !== s.channel`) — keep that meaning.
   - Per lane: the sorted array of non-null `sceneStartOf(o)` values (ascending numbers).
   - A numbered scene's position = **1 + the count of lane rows (other than itself) whose start is STRICTLY earlier than `at`** — exactly `liveScenes.ts:667–671` today. Compute the count by a lower-bound binary search (first index with start >= at) over the lane's sorted starts. Then subtract the self-exclusion: today `o.id === s.id` is skipped; the self row (from the DB read) is counted by the lower bound only if its own DB start is non-null and `< at` (possible when the passed-in `s` differs from its stored row). Handle that by looking up the self row's DB start (a `Map<id, start>` built from `lanes`) and subtracting 1 when it is `< at`. Two scenes sharing a start share a number, as today — a plain one-pass counter would give distinct numbers and change output; do not do that.
   - Keep the `Scene N` regex replace and `out.set` order exactly as today. No new exported names; local helpers inside the function or as module-private functions are fine.
2. **`sceneCauses`**: the loop `for (const sessionId of sessionIds) contexts.set(sessionId, await sessionSceneContext(db, sessionId))` runs in sequence. Read them with `Promise.all` over `sessionIds` (bounded by the number of sessions — no new concurrency knob, no limiter), then fill `contexts` in the same keys. If the function's doc comment says "one `sessionSceneContext` per session", keep it accurate (you may add "read in parallel").

3. **Tests:**
   - `src/lib/server/sockets/scenes.displayNames.int.test.ts`: add a 200-scene case. One session lane (plus a few scenes on a second channel so lanes are exercised), with at least one TIE of starts (two scenes with the same `openedAtMessageId`, or a selection scene whose min selected id equals another's opening line), some scenes with custom names (`nameIsDefault: false`), and stored default names like `Scene 1` / `Scene 1 · Something`. Insert messages and scenes in BULK (one multi-row insert each; `insertSessionMessageRow` one by one 200+ times is too slow — check `src/lib/server/pipelines/testing/fixtures` and the `schema.sessionMessages` columns for a batch insert). Compute the expected names IN THE TEST by the OLD rule (a literal copy of today's quadratic loop as a local test helper: `1 + count of same (session, channel) rows, not itself, with non-null start strictly < at`, using `sceneStartOf` from `$lib/server/scenes/historyEntryOfDate`), then call `sceneDisplayNames(testDb as any, rows)` (import from `$lib/server/scenes/liveScenes`) and assert the Map equals the expectation; also assert the tie actually produced two equal `Scene N` numbers. 60 s timeout on this test.
   - `src/lib/server/scenes/sceneCauses.int.test.ts`: only if an existing case does not already cover two sessions in one call, add one case with scenes from two sessions (different genre settings if the fixtures make that cheap) asserting each session's causes are its own. If it is already covered, add nothing and say so.

## Files owned (edit ONLY these; re-read each immediately before editing; use Edit, never Write over an existing file)
- `src/lib/server/scenes/liveScenes.ts` — **only** inside `sceneDisplayNames` and `sceneCauses` (plus module-private helpers placed directly beside them if you need one)
- `src/lib/server/sockets/scenes.displayNames.int.test.ts`
- `src/lib/server/scenes/sceneCauses.int.test.ts`
Everything else is read-only. Another worker edits `scenes/historyEntryOfDate.ts` and `scenes/unfiledScenesByEntry.ts` at the same time; other lanes edit `src/lib/server/sockets/scenes.ts` and `utils/activityStore.ts` — never touch them.

## Out of scope — never build
A cache; a setting; any change to what is listed or how a name reads; any new exported name.

## Rules you work under (quoted from CLAUDE.md / the lead)
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (Both functions take the caller's handle; use only it.)
- "`$state(new Set())` is not reactive" — irrelevant server-side; plain `Set`/`Map` are right here.
- "Never seed a row at a hardcoded id." (Test rows use returned ids.)
- "An int test that opens a DB inside an `it` gets a 60 s timeout."
- No SDK changes. No `NOMENCLATURE.md` edits.

## Tests (only these)
Run exactly:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.displayNames.int.test.ts src/lib/server/scenes/sceneCauses.int.test.ts src/lib/server/scenes/sceneStartOf.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-P1-w2.log 2>&1; echo exit=$?'`
then read the log (tail). Then `npx prettier --check` on your files (for `liveScenes.ts`, report only whether YOUR hunks are clean if the file was already unformatted). Never a full `npm test`, `npm run check`, or project `tsc`.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never pipe vitest into `head`.
