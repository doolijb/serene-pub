# BRIEF playtest3-S7-w5 — one scene-start rule; the export reads the one day rule

Lane `playtest3-S7`, worker 5. The supervisor checks your diff against this brief. Your final message must give: changed files, exact test commands, pass/fail counts, prettier result, and Noticed-not-done.

## Goal
1. **One scene-start rule.** "A scene starts at its opening line, else (tick selection) at its smallest selected line; with neither it starts nowhere" is written three times:
   - `src/lib/server/sockets/scenes.ts` ~668: `existing.openedAtMessageId ?? (existing.selectedMessageIds?.length ? Math.min(...existing.selectedMessageIds) : null)`, inside the scene-update name path.
   - `src/lib/server/scenes/liveScenes.ts` `sceneNameFor`'s local `startOf` (~602).
   - `src/lib/server/scenes/liveScenes.ts` `sceneDisplayNames`' local `startOf` (~649).

   Export ONE function, `sceneStartOf`, from `src/lib/server/scenes/historyEntryOfDate.ts`, placed after the `export { dayOnly }` line:
   ```ts
   /** Where a scene starts on its lane: its opening line, else (tick selection) its smallest selected line; neither — null, it starts nowhere. The ONE scene-start rule (`sceneNameFor`'s numbering, `sceneDisplayNames`, the scene update's default name). */
   export function sceneStartOf(scene: {
   	openedAtMessageId: number | null
   	selectedMessageIds: number[] | null
   }): number | null {
   	return (
   		scene.openedAtMessageId ??
   		(scene.selectedMessageIds?.length ? Math.min(...scene.selectedMessageIds) : null)
   	)
   }
   ```
   Then:
   - Replace both local `startOf`s with calls to it. Remove the locals and import `sceneStartOf` from `./historyEntryOfDate`. Keep the surrounding comments, trimming only words that described the removed local.
   - Replace the inline expression in `scenes.ts` ~668 with `sceneStartOf(existing)`, importing it beside the existing `import { dayOnly, historyEntryOfDate } from "$lib/server/scenes/historyEntryOfDate"` (~61).
   - If a call site's row type has `selectedMessageIds` typed differently (e.g. `unknown`/`number[] | null | undefined`), widen the parameter type minimally (`?: … | null`) rather than casting at the call site.
   - Behaviour must not change.
2. **The export reads the one day rule.** `src/lib/server/utils/lorebookExportBuilder.ts` ~222–225 derives an unfiled scene's day inline (`const month = year != null ? (s.openedStoryClockMonth ?? null) : null; const day = month != null ? (s.openedStoryClockDay ?? null) : null`). Make it call `dayOnly`:
   - `const date = year != null ? dayOnly({ year, month: s.openedStoryClockMonth ?? null, day: s.openedStoryClockDay ?? null }) : null`, then `const month = date?.month ?? null` and `const day = date?.day ?? null`, so the code after it (the `dayKey` and the synthetic `entryInsert`) is unchanged and behaves identically.
   - Import `dayOnly` from `$lib/shared/lorebooks/storyDate`.

## Tests
- Add a small unit test for `sceneStartOf` in a NEW file `src/lib/server/scenes/sceneStartOf.test.ts` (pure, no DB): opening line wins over a selection; the smallest selected id when there is no opening line; null with neither, and with an empty selection.
- Run the existing tests that cover the three call sites and the export (find them with grep: `sceneNameFor`, `sceneDisplayNames`, `Scene 2`, `lorebookExportBuilder`, `exportLorebook`, `unfiled` in `src/lib/server/**/*.test.ts`). Include at least `src/lib/server/sockets/scenes.live.int.test.ts` and every test file that imports `lorebookExportBuilder` or tests the export of unfiled scenes. List the files you ran.

Run (capped; never pipe vitest into `head`; batch at most ~6 int files per run):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-w5-<n>.log 2>&1; echo exit=$?'`. Read each log. Re-run after your last edit. If a test fails, check whether it also failed before your change; if it did, say so and do not fix it. Then `npx prettier --check` on each changed file: report it, fix only lines you touched, never `--write`.

## Files owned (the only files you may edit)
- `src/lib/server/scenes/historyEntryOfDate.ts`: add `sceneStartOf` only.
- `src/lib/server/scenes/liveScenes.ts`: the two `startOf` locals and the import only.
- `src/lib/server/sockets/scenes.ts`: the one expression at ~668 and its import only.
- `src/lib/server/utils/lorebookExportBuilder.ts`: the day derivation and its import only.
- New `src/lib/server/scenes/sceneStartOf.test.ts`.

Re-read each file immediately before every edit (other work landed in these files minutes ago). Use Edit, never Write, on existing files.

## Rules your work depends on (quoted)
- "Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24." The only new name is `sceneStartOf` (named by the lead). Nothing else new.
- "Inside `db.transaction(async (tx) => …)` use only `tx`." Unaffected here, but don't move code across a transaction boundary.
- "An int test that opens a DB inside an `it` gets a 60 s timeout."
- "It is a **session**, never a *chat*."
- Do what was asked, at the size asked. Anything else goes under **Noticed, not done**.

## Out of scope
Any behaviour change; any other copy of a rule you happen to find (list it under Noticed); `NOMENCLATURE.md`; client files.

## Stop and report (don't decide) when
A call site's rule differs from the one above (then it is not a copy: report it and leave it); an import cycle appears; another file must change.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK build is needed.)
- Never `git checkout`, `git restore` or `git clean`. Never a full `npm test`, `npm run check`, or project-wide `tsc`.
