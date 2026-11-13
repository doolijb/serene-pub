# BRIEF playtest2-A-w3 — Ask retired from Story (§0-F) + the Story docs for Stop

Supervisor: lane `playtest2-A`. Report: `/home/jody/github/serene-pub/plans/REPORT-playtest2-A-w3-2026-11-04.md` (if the write is refused, put the full report in your final message).

## Context you must not lose
Another programme (M2e) edits the SDK (`/home/jody/github/serene-pub-sdk`) **right now** — `sdk/src/descriptors.ts`, `core-catalog/src/registry/genres.ts`, `core-catalog/src/loadouts.ts` are theirs: never touch them. **Re-read each file immediately before each edit; Edit, never Write, an existing file; touch only the lines your task needs.** Never `git checkout` / `restore` / `stash` / `clean` in the SDK repo — most of it is uncommitted.

## Goal
Owner ruling 2026-11-04 (§0-F): "**Ask: retired from Story.** The forms mechanism stays (the Lair's Roll, Adventure's Ask)." (Adventure folded into Story on 2026-10-19; there is no Adventure genre any more — `core-catalog/src/registry/retired.ts`.) Lead's brief: "Remove Ask from the Story genre's quick row and registration … (+ its index/registration + docs `genre-story.md`); the forms mechanism stays. Retire, do not delete, any shared piece … still uses."

The decided shape (supervisor's call, inside scope):
1. `../serene-pub-sdk/core-catalog/src/genres/defaults.ts` ~line 225: Story's action registrations stop registering Ask — `actionRegistrations(storyAskSpec(), storyAnswerSpec())` becomes `actionRegistrations(storyAnswerSpec())`; drop the now-unused `storyAskSpec` import. **Answer stays registered**: messages already in users' sessions carry Ask's choices blocks whose options fire `core:spec/story-answer`, and those must stay answerable (0.6 is in users' hands). Since Ask is no longer registered, it is on no quick row, no `/ask`, no composer chip.
2. `core-catalog/src/genres/story/ask.ts`: **do not change the spec's graph or its `contributes`** (that would change its published content hash, pinned in the app's `specHashes.test.ts`, which is not ours). Update only its doc comments: retired from Story 2026-11-04 (owner §0-F); still published so stored references resolve and an administrator may still register it; Story no longer registers it.
3. `core-catalog/src/index.ts` ~line 276: keep the `CORE_SPECS` row (published, unregistered); fix its comment ("The worked form …") to say retired from Story's defaults 2026-11-04, kept published. `core-catalog/src/genres/story/index.ts` lines ~21 and 33-34: comment only, if it claims Story offers Ask.
4. `../serene-pub-sdk/sdk-tests/coreGenreDefaults.test.ts` ~line 90: Story's expected action list no longer has `core:spec/story-ask#ask`; add one assertion "Story registers no Ask" (no `core:spec/story-ask` among Story's registrations) and that `core:spec/story-answer#answer` (or whatever key it lists today — read it) is still there.
5. `docs/genre-story.md` § Actions (lines ~68-70):
   - line 68: remove "and **Ask** and **Answer** for questions put to a character".
   - line 70 — also carries owner ruling ★A2 (2026-11-04: a waiting reply may be stopped by any session member; actions presser or owner). Rewrite it to: "**Stop** works on a reply that hasn't started yet and on an action on its way. Anyone in the session can stop a reply; an action (**Rest**, **Image**) is stopped by whoever pressed it or by the session's owner, and nothing is posted." (Sentence case; plain words; STYLE-GUIDE §10.)
6. Grep both repos for any other place that tells a user Story has Ask (`/ask` in docs, slash-command help, client copy) — **don't edit** files outside your list; list each hit (file:line + text) in your report.

## Files owned
`/home/jody/github/serene-pub-sdk/core-catalog/src/genres/defaults.ts` (the Story actions line + import only), `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/story/ask.ts` (comments only), `/home/jody/github/serene-pub-sdk/core-catalog/src/index.ts` (the one comment), `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/story/index.ts` (comments only), `/home/jody/github/serene-pub-sdk/sdk-tests/coreGenreDefaults.test.ts`, `/home/jody/github/serene-pub/docs/genre-story.md` (§ Actions lines only).

## Files readable
Everything.

## Out of scope — never built
Deleting the Ask spec or its prompt seed (`core-catalog/src/seed/prompts.ts`); touching `registry/retired.ts`, `registry/genres.ts`, `descriptors.ts`, `loadouts.ts`; any migration or boot pass (a genre's default registrations are re-projected at boot from the declaration — `src/lib/server/pipelines/registrations/project.ts` — read it and say in your report whether a stale genre-scope `story-ask#ask` row is replaced away at the next boot; if NOT, stop and report, don't build a pass); `docs/sessions.md` (lane H's — list its Ask lines for the queue); NOMENCLATURE.md.

## Rules quoted
- CLAUDE.md: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." (Here nothing stored is reshaped: Answer keeps its id and registration; Ask keeps its published spec.)
- "Removing or renaming a published SDK name is the owner's call." — so no exported name is removed: `storyAskSpec`, `STORY_ASK_SPEC_ID`, `STORY_ASK_SCHEMA` stay exported.
- Do what was asked, at the size asked; findings under **Noticed, not done**; nothing "for later". Never `git commit`.

## Done means
1. SDK test, single file, through the sdk-tests runner — read `/home/jody/github/serene-pub-sdk/sdk-tests/package.json` for the runner and run only `coreGenreDefaults.test.ts` from `/home/jody/github/serene-pub-sdk/sdk-tests` (never `npm test` at the SDK root, never the whole sdk-tests suite). Note the core-catalog may need its dist built first if sdk-tests import the dist — check how it resolves; if it needs a build, use the app's command below.
2. Build: first `pgrep -af "vite dev"` — if a serene-pub dev server is up, don't build; report "blocked on your dev server". Else from `/home/jody/github/serene-pub`: `flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build`. If the build fails on a file that is not yours (M2e's in-progress work), stop and report the error verbatim; don't fix it.
3. App tests that name Story's Ask, after the build:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/db/dataUpgrades/0108_layering_registrations.int.test.ts src/lib/server/attachments/readers.int.test.ts src/lib/server/pipelines/config/postHistoryTrigger.int.test.ts src/lib/server/pipelines/runtime/specShape.test.ts src/lib/server/pipelines/boot/specHashes.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-A-w3.log 2>&1; echo exit=$?'
```
then read the log (never pipe vitest into `head`). For each failure, say whether it is caused by this change (then it is yours to fix only if the file is in **Files owned**; otherwise report the exact fix needed) or pre-existing (check with the failure's own text; `0108_layering_registrations` was already failing before this lane per the lead's grouped verification).
4. `npx prettier --check` on each file you changed.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## Report
Changed files (both repos) with a one-line why · exact commands and pass/fail counts · the boot re-projection finding · other Ask hits (file:line + text) · assumptions · **Noticed, not done**.
