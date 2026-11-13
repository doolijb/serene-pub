# BRIEF playtest2-S4-w4 — the open/close replies name a scene by its display name

Lane `playtest2-S4`, worker 4. The supervisor checks your diff against this brief. Report back in your final message (changed lines, tests run + exact counts, decisions, anything you stopped on, Noticed-not-done). Do not write a report file.

## Why
A default scene name (`Scene 3 · …`, `nameIsDefault`) is numbered at render by `sceneDisplayNames(db, scenes)` (`src/lib/server/scenes/liveScenes.ts` ~633: returns `Map<sceneId, string | null>`, the stored name for every scene, renumbered by position on its session's lane for default names). `scenes:listByLorebook`, `scenes:openScenes`, the export and the graph build already show that name. But `sceneReplyRow(db, scene)` (`liveScenes.ts` ~895), which builds the `scene` / `closedScene` / `openedScene` of the `scenes:open` / `scenes:close` / `scenes:moveBoundary` / `scenes:merge` replies (`src/lib/server/sockets/scenes.ts` `replyLiveScene` ~2097–2103), still sends the stored name — so one scene can go by two numbers.

## Goal
In `sceneReplyRow` only: set `name` to `(await sceneDisplayNames(db, [scene])).get(scene.id) ?? scene.name`. Keep everything else it returns as is. (`sceneDisplayNames` reads the session's other scenes itself, so passing the one scene is enough — confirm by reading it.) One short comment: the reply names the scene as every list does.

## Files owned (only these; re-read immediately before every edit; Edit, never Write, on existing files)
- `src/lib/server/scenes/liveScenes.ts` — ONLY `sceneReplyRow`.
- `src/lib/server/sockets/scenes.displayNames.int.test.ts` — add tests.
Another worker is editing `src/lib/server/sockets/scenes.ts`, `entries.ts`, `lorebookExportBuilder.ts` and a new `scenes/unfiledScenesByEntry.ts` at the same time: never touch those.

## Tests
In `scenes.displayNames.int.test.ts`: a session with two default-named scenes where the stored number differs from the position (copy how the file's existing tests seed that — e.g. after deleting the first scene, or inserted out of order); `scenes:open` (or `scenes:close`) on the later one replies with `scene.name` equal to the name `scenes:listByLorebook` shows for it (the renumbered one), not the stored one; and a `closedScene` in an open's reply carries its display name too, if the file's helpers make that easy (else say why not).

Run (n = 1, 2, …):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.displayNames.int.test.ts src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/sockets/scenes.laneE.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S4-w4-<n>.log 2>&1; echo exit=$?'` then read the log (tail/grep; never pipe vitest into head). The other worker may be mid-edit in `scenes.ts`: if a run fails on a syntax/type error in a file that is not yours, wait a few minutes and re-run; report it if it persists. An existing assertion that expected the stored name in a reply: report the test and line, and change it only if it is plainly about the old stored-name behaviour (say so).

## Rules you work under
- No new names, fields, events or labels. No schema change.
- Never "fix in passing": anything else you notice goes under Noticed, not done.
- An int test that opens a DB inside an `it` gets a 60 s timeout.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also never `git checkout`, `git restore` or `git clean` in either repo. Never a full `npm test`, `npm run check`, or `tsc` over the project.
