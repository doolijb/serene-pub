# BRIEF playtest2-S-w1 — first scene (`scenes.first`) and the open-scene cast refresh gate (`scenes.castRefresh`)

Worker of lane `playtest2-S` (supervisor writes the lane report). Report: your final message (hand-back). Scratch files start with `playtest2-S-w1`.
Scratchpad: `/tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad`

## Goal
Two server behaviours, both **off in core**, each switched on only by the session genre's shape (`shape.scenes.first`, `shape.scenes.castRefresh`). The SDK has not declared these fields yet (the lead adds them later): read them **defensively from the shape as `unknown`** — on only when the value is exactly `true`; anything else (absent, a string, an object) is off.

### A. First scene (item 2)
When a session's very first story line lands on `main` and the genre's `shape.scenes.first === true`:
- **Suggested** mode → record a scene cue at that line with trigger key **`opening`** (state `open`), so the conversation's *New scene?* chip offers it; its reason words are **"the story began"**.
- **Automatic** mode → open the scene at that line (the watcher's existing Automatic path: `openScene(..., cause: { kind: "system" })`, then `markCuesAt(..., "placed")`), so the `opening` cue row stays as the stored cause.
- **Manual** → nothing (already: `watch()` returns early on Manual).
- **New sessions only, no backfill:** fire only when the lane has **no earlier line at all** on that channel (hidden rows included — do not use the `prev` query, which skips hidden rows), **no scene has ever been placed on the lane**, and **no `opening` cue exists for the session's lane in any state** (so a removed or dismissed opening scene is never offered or placed again). A session that already has messages gets nothing.
- Only the `main` lane (`parseChannel(channel).slug === "main"`), never a side channel.

Where (all in the files below):
- `src/lib/server/scenes/boundaryWatcher.ts`: export a constant `OPENING_TRIGGER = "opening"` next to `ENDED_HERE_TRIGGER` (~line 110) and put it at the **head** of `TRIGGER_ORDER` (~line 115). In `firedTriggers` (~line 302), inside `if (opts.core)`, add the opening check gated on `ctx.first`. It is not a setting (like `endedHere`), so it is never in `ctx.settings.triggers`. It is recorded by the existing `fresh` insert in `watch()` (~line 560) — check that path records it and that Automatic places it.
- `src/lib/server/sessions/sceneSettings.ts` (claimed block: the `SessionSceneContext` interface ~line 74 and `sessionSceneContext` ~line 106): add two fields read from the genre `shape` the function already loads: `first: boolean` and `castRefresh: boolean`, plus `genreName: string | null` (the genre's display name, `i18nText(genre.name)` if the loaded genre row carries one; null otherwise) for the cause words in B. A small local reader `shapeFlag(shape, key)` that walks `shape?.scenes?.[key] === true` with `unknown` narrowing. Do not touch the SDK's `resolveSceneSettings` (it already ignores unknown keys).
- `src/lib/shared/sessions/sceneSettings.ts`: add `opening: "the story began"` at the top of `SCENE_CUE_REASONS` (~line 68), with a `// 🚧 Not a setting: the genre's first scene (shape.scenes.first).` comment as `endedHere` has.

### B. Open-scene cast refresh gate (item 21 audit row 14)
`followOpenSceneCast` (`boundaryWatcher.ts` ~line 460, called from `watchSceneBoundaries` ~line 449) runs on every landed line in every mode today. Change it so it runs only when the genre's `shape.scenes.castRefresh === true` **and the scene mode is not Manual** (Manual is the person's off switch — the supervisor raises this as ★ for the lead; build it this way). It reads the context through `sessionSceneContext` (it does not today: add the read; keep it inside the existing try/catch, never throwing).
When it runs and the cast moved, the cause must be nameable: export from `boundaryWatcher.ts` a function `openSceneCastCause(genreName: string | null): string` returning exactly
`"${genreName ?? "This session's genre"} keeps the open scene's cast up to date from its lines. Set Scenes to Manual to stop it."`
Export `followOpenSceneCast` (for the test) and make it return `{ sceneId: number; cause: string } | null` — the object when it rewrote the cast, null otherwise — instead of `void`. Add an optional `castRefreshed?: { sceneId: number; cause: string }` to `WatchResult`; `watchSceneBoundaries` keeps returning `WatchResult | null` exactly as today and, when its result is non-null and the refresh rewrote the cast, returns `{ ...result, castRefreshed }`. Never invent a result (an `outcome`) when `watch()` returned null. Update the comment block at the top of `boundaryWatcher.ts` (~lines 52–56, "in every mode, Manual included") to say what is true now.
`refreshOpenSceneCast` in `liveScenes.ts` itself stays as it is (it is the writer; the gate is the watcher's).

## Files owned (the only files you may edit)
- `src/lib/server/scenes/boundaryWatcher.ts`
- `src/lib/server/sessions/sceneSettings.ts` (only the `SessionSceneContext` interface and `sessionSceneContext` function)
- `src/lib/shared/sessions/sceneSettings.ts` (only the `SCENE_CUE_REASONS` table)
- `src/lib/server/scenes/boundaryWatcher.genre.int.test.ts`
- `src/lib/server/scenes/boundaryWatcher.int.test.ts`
Another programme's agents edit nearby files right now: **re-read each file immediately before every edit, and use Edit, never Write, on an existing file.** Do not touch `src/lib/server/scenes/liveScenes.ts` (another worker may be in it later), `sockets/scenes.ts`, `sockets/sessions.ts`, `src/lib/shared/sockets/types.ts`, `NOMENCLATURE.md`, or anything in `../serene-pub-sdk`.

## Files readable
Everything. Especially `src/lib/server/scenes/liveScenes.ts` (`openScene` ~967, `refreshOpenSceneCast` ~776), `src/lib/server/pipelines/entities/sessionGenres.ts` (`getSessionGenre`), `../serene-pub-sdk/sdk/src/sceneSettings.ts` (`resolveSceneSettings`, `overlay`).

## Tests (Done means)
In `boundaryWatcher.genre.int.test.ts` (it already publishes test genres straight into the registry tables with a raw `shape` — use that: publish a fixture genre, e.g. `test:genre/opening`, whose create spec's `genre.shape` is `{ channels: ["main"], scenes: { first: true, castRefresh: true } }`, written raw, not through `genreKeeping`/`defineGenre` validation, since the SDK refuses unknown `scenes` keys at declaration). New cases:
1. Fixture genre, Suggested: the first line gets an open `opening` cue, offered with reason "the story began" (`offeredSceneCues`); no scene row.
2. Fixture genre, Automatic: the first line opens Scene 1 at that line; the `opening` cue is `placed`.
3. Fixture genre, Manual: nothing (no cue, no scene).
4. Fixture genre, a session with messages already (two lines inserted, then watch the third — and also watch the 2nd when the 1st exists): no `opening`.
5. Removed opening never comes back: Automatic, the first line opens a scene; delete that scene; a new first line (or re-watching) places nothing (the `opening` cue exists).
6. A genre without `scenes.first` (Lair or the existing delve genre): the first line gets no `opening` cue.
7. Cast refresh: the existing G3 test (~line 381) must keep passing for a session on a genre WITH `castRefresh: true` (move it onto the fixture genre, or publish a castRefresh variant); add: on a genre without `castRefresh` the cast is NOT refreshed by a landed line (`watchSceneBoundaries` / `followOpenSceneCast`); with it, `followOpenSceneCast` returns `{ sceneId, cause }` and the cause is exactly the sentence above with the fixture genre's name; under Manual it does not run.
Every DB-opening test gets a 60 s timeout (`test(name, fn, 60_000)`).

Run (one command per run, never piped into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && flock /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/sdk-build.lock env NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/scenes/boundaryWatcher.genre.int.test.ts src/lib/server/scenes/boundaryWatcher.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S-w1-<n>.log 2>&1; echo exit=$?'`
then read the log. (The `flock` keeps your run from overlapping another worker's SDK rebuild.) Also run `npx prettier --check` on each file you edited.

## Rules you work under (quoted from the lead's and the supervisor's reading)
- **P1 (CLAUDE.md):** "Code decides what code can; the model only judges. Same inputs, same result. A *new* automatic behaviour is **off in core until a genre opts in**, and every automatic action shows its cause and how to undo or switch it off."
- **Owner ruling 2026-11-04, item 2:** "opens under **Suggested** (a cue) and **Automatic** (a placement), never Manual; **new sessions only**, no backfill; Story opts in through `shape.scenes`, never a core default."
- **Owner ruling 2026-11-04, item 21:** "the AI form answer and the open-scene cast refresh are **off in core until a genre opts in**, each showing its cause and switch (Story opts into the cast refresh through its shape…)."
- **Lead, Build plan 2:** "Opt-in shape fields 🚧: `scenes.first`, `scenes.castRefresh`, `forms.modelAnswers`; absent = off; Story sets the first two." "Until then every lane reads the fields from the shape as `unknown`."
- **Names (NOMENCLATURE R3):** "qualify, never the bare noun". The only new names you may introduce are the ones in this brief: `opening` (cue trigger key), `OPENING_TRIGGER`, `first` / `castRefresh` / `genreName` on `SessionSceneContext`, `openSceneCastCause`, `castRefreshed`, `followOpenSceneCast` (export). Any other new identifier, label or user-facing string: stop and say so in your report instead.
- **DB:** "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never seed a row at a hardcoded id."
- **Sockets:** "views register listeners for local state and never call `toaster`" — you add no socket events.
- **Scope:** "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- Stop and report (do not decide) if: the shape cannot be read where described, an existing test outside your files breaks, or the brief contradicts the code.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You do not need an `sdk:build`.)
- Never a full `npm test`, `npm run check`, `tsc` over the project. Never `kill -9` anything.

## Report (your final message)
Changed files with a one-line summary each · the exact test command(s) and pass/fail counts · anything you stopped on · names you introduced · Noticed, not done.
