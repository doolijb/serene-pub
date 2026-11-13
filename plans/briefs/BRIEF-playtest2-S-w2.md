# BRIEF playtest2-S-w2 — retire *Summarize the story* from Story's sweep

Worker of lane `playtest2-S` (supervisor writes the lane report). Report: your final message (hand-back). Scratch files start with `playtest2-S-w2`.
Scratchpad: `/tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad`

## Goal
Owner ruling 2026-11-04 (§0-B): *"Item 3's **Summarize the story** routine is **retired** (summarize-scene covers it)."* Today Story's sweep (`core:spec/story-sweep`, *Look back over the story*, every 5 turns) has a **summary** duty that asks the model for "what happened since the last summary, as a history entry" and files a new history entry on every run (the duplicate-history-entries bug). Remove the summary arm from Story's sweep so the sweep never asks for, sorts, or files a summary — whatever the duty switch says.

In `../serene-pub-sdk/core-catalog/src/genres/story/reckon.ts` (the only SDK file you edit):
1. `STORY_SWEEP_SCHEMA` (~line 98): drop `summary` from `properties` and from `required`.
2. `STORY_SWEEP_CRIB_SCRIPT` (~line 157): drop the `if (modeOf(modes, "summary") !== "off") asks.push("summary: …")` line.
3. `STORY_SWEEP_SCRIPT` (~line 217): drop `put("summary", "summary", named(j.summary));`.
4. The summary junction in `sweepBranch` (~lines 482–517, `const summarized = sorted.junction('summary', …)`): remove it and chain the next step (`entryWrites(summarized, …)` for lore, ~line 518) from what the summary junction chained from. Keep every other duty's arm byte-for-byte.
5. Doc comments in `reckon.ts` (~lines 27, 92, 193) and the header of `sweep.ts` (~line 4, "a summary, new lore…" — `sweep.ts` is in the same folder; edit its comment only) that list the summary: say what is true now.
6. If `NAMED` or another helper becomes unused only because of this, remove it; nothing else.
**The spec's version stays `1.0.0`** (0.6 version freeze: "record the new hash against the existing pin").

Do NOT edit `../serene-pub-sdk/contracts/src/tasks.ts` (the `summary` duty switch in `core:task/sweep-duties@1`, ~line 5264, stays for now — removing it is the lead's SDK pass; report the exact lines to remove). Do NOT edit `src/lib/server/pipelines/boot/specHashes.test.ts` (shared pin file; report the new hash instead).

## Investigate and report (read-only)
a. **Stored data:** what happens to an existing session whose stored settings carry the `summary` duty (a per-session params override `summary: true|false`, or a duty mode) once (i) this change lands and (ii) later the contracts duty is removed — does any reader refuse or drop the whole override over an unknown key? Cite file:line (start from how `slot.params()` overrides are stored and validated on the app side: `grep -rn "sweep-duties\|sweepDuties" src/lib/server`).
b. **Seeded scripts:** `STORY_SWEEP_CRIB_SCRIPT` / `STORY_SWEEP_SCRIPT` are seeded rows (`seedScript`). How does an existing install get the new text — does boot update an unedited seeded row, and what happens to an admin-edited copy? Cite file:line.
c. Whether anything else in either repo reads `summaryFull` / `summaryReview` or the sweep's `summary` member (`grep -rn`).

## Files owned (the only files you may edit)
- `../serene-pub-sdk/core-catalog/src/genres/story/reckon.ts`
- `../serene-pub-sdk/core-catalog/src/genres/story/sweep.ts` (header comment only)
- `src/lib/server/pipelines/scripts/storyScripts.test.ts` and `src/lib/server/sockets/sessions.taskSweep.int.test.ts` — only to drop assertions/fixtures of the summary member and to add ONE case in `sessions.taskSweep.int.test.ts`: *a sweep run with every duty on writes no history entry* (count `lorebook_entries` rows of the history entry type before/after; use the file's existing helpers and canned model answer — a canned answer that still contains a `summary` member must file nothing).
Another programme's agents edit the SDK and app trees right now: **re-read each file immediately before every edit, and use Edit, never Write, on an existing file.** Never touch any other file in either repo.

## Build and tests (Done means)
1. SDK targeted tests that cover the sweep / Story genre: find them (`grep -rln "story-sweep\|storySweepSpec\|STORY_SWEEP" ../serene-pub-sdk/sdk-tests`) and run only those, from the SDK root, as
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub-sdk && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run <files> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S-w2-sdk-<n>.log 2>&1; echo exit=$?'`
(If the SDK's vitest needs a workspace/config flag, read `../serene-pub-sdk/package.json` scripts to find it; never `npm test` / `npm run sdk:test` whole.) If one fails only because it pins the sweep's hash or prompt text, report it; fix it only if it is one of your owned files.
2. Rebuild the dist: first `pgrep -af "vite dev"` — if a serene-pub dev server is up, do NOT build; report "blocked on your dev server" and stop there. Else, from the app root:
`cd /home/jody/github/serene-pub && flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock npm run sdk:build > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S-w2-build.log 2>&1; echo exit=$?`
If the build fails on a file that is not yours (another programme's in-flight work), report the error and stop.
3. App tests, same scope wrapper, with the flock so you never overlap another worker's run:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock env NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/pipelines/scripts/storyScripts.test.ts src/lib/server/sockets/sessions.taskSweep.int.test.ts src/lib/server/pipelines/boot/specHashes.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S-w2-app-<n>.log 2>&1; echo exit=$?'`
`specHashes.test.ts` is expected to fail on `core:spec/story-sweep@1.0.0` only: report the actual hash it prints (and any OTHER spec whose hash moved — that would be someone else's in-flight work; list it, don't touch it).
Never pipe vitest into `head`. DB-opening tests you add get a 60 s timeout. `npx prettier --check` each file you edited (the SDK has its own prettier config — run it from the SDK root for SDK files).

## Rules you work under
- **P1 (CLAUDE.md):** "A *new* automatic behaviour is **off in core until a genre opts in**, and every automatic action shows its cause and how to undo or switch it off." The sweep's summary filed a history entry with no cause line; retiring it is the fix.
- **Standing ruling:** "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass… Removing or renaming a published SDK name is the owner's call." — you remove no published name: the task id, the spec id and the duty key stay; only the sweep's internal summary arm goes.
- **Scope:** "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- **Names:** you introduce no new names, labels or strings.
- Never edit `../serene-pub-sdk` with `git checkout` / `restore` / `stash` — most of it is uncommitted.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## Report (your final message)
Changed files (both repos) with one line each · the exact commands and pass/fail counts · the new `story-sweep` hash · answers to a–c with file:line · the exact contracts lines the lead should remove · Noticed, not done.
