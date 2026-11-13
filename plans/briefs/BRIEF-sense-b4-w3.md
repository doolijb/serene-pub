# BRIEF — build lane `sense-b4`, worker 3 — the rule end to end with the real predicate; fork timing rewritten

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`, readable for
context; this brief is your contract). Words: a **build lane** is this stream of work; a **channel** is a
session's message channel. Never write bare "lane" for a channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What is built (do not change production code)

**The rule (owner-ruled):** for a session that reads an attached lorebook **and whose scenes end by themselves**,
a pipeline's new entry, place, history day or link goes to the session's own book whatever the lorebook's write
setting (Full included). It reaches the lorebook only by **Apply**, which runs by itself as scenes close when the
session's owner owns the lorebook and its write setting is Full. **Every other session writes exactly as before**
(straight to the lorebook under Full).

- `scenesEndByThemselves(db, sessionId)` in `src/lib/server/lorebooks/ownBook.ts` is the one predicate: the session
  has an attached lorebook; `scenesRoutineOn` (`scenes/boundaryWatcher.ts`: an effective
  `core:spec/scene-boundaries` registration whose mode is not Off); `sessionSceneContext(…)` (`sessions/sceneSettings.ts`)
  says `settings.mode === "automatic"` and `mayPlace`.
- `sessionLoreWriteTo` in `src/lib/server/pipelines/runtime/host.ts` sends `create-lore-entry`,
  `update-lore-entry`, `link-lore-entries` and history days to the own book (`route: "own-book"`, `alsoReads`) when
  it holds; `sources` no longer moves the settle line for such a session (provenance is still recorded). No line is
  forked by these writes.
- `applyOverlayItems` (`ownBook.ts`) now calls `ensureSessionLine` inside its transaction (after the "nothing
  chosen" return) and re-reads the line: an Apply forks a branch session's line, not its first write.
  `applyHeldAutomatically` runs for a branch too.
- Story (Living, Rule Based), the Lair and the Dungeon Crawler register the scenes routine and declare
  `scenes.mode: 'automatic'`; Story Minimal drops it; Chat and the Guide register nothing.

## Build (tests only)

### 1. New file `src/lib/server/pipelines/runtime/host.scenesEndRoute.int.test.ts` — the **real** predicate

Bootstrapped world, no mocks of the predicate. Copy the harness of
`src/lib/server/pipelines/routines/sceneBoundaries.routine.int.test.ts` (lines ~1–280: `createTestDb` mock,
`defaults.sync()`, `bootstrapPipelines`, a fake adapter, `sessionsCreateHandler` with a preset by `seedKey`, then
`lorebookId` set to a fresh lorebook of the owner and `metadata.scenes.mode` set). Drive writes through
`createHost(db, { sessionId, userId, runId })` and `host.commit(params, node)` as
`src/lib/server/pipelines/runtime/host.ownBookFull.int.test.ts` does (read it; it is the mocked twin of this file).
The owner's write setting is Full (`userSettings.loreWriteMode: "full"`, or the default if that is Full — check).

Cases:

a. **Predicate pins** (`scenesEndByThemselves` true/false, then the write's route): Story · Living, Automatic → true,
   a place goes to the own book. Then each of these is false and **a place, a link and a history day go straight to
   the lorebook exactly as before** (route `book`, rows in the lorebook, settle line moves with `sources`):
   - a Chat session (`core-chat-default` or the seed key Chat uses — check `../serene-pub-sdk/core-catalog/src/seed/presets.ts`);
   - Story · Living with the scenes routine switched **Off** at session scope (copy `setKeeper` from
     `src/lib/server/pipelines/routines/clockOwners.int.test.ts` ~396–422: `effectiveRegistrations`, `rowOfChange`,
     `upsertRow`, for the `core:spec/scene-boundaries` registration);
   - Story · Living with scene mode **Suggested**; and with **Manual**;
   - Story · Minimal (`core-story-minimal`).
b. **Under Full on your own lorebook, a session meeting the rule:** a run's room (place), a link from it to a
   lorebook room, and a history day sit in the **own book**; the session reads them (e.g. `sessionEntriesAsRead` /
   the places list reader the Lair uses, `lorebooksReadBy`), and **nobody else does**: a second session of the
   same owner on the same lorebook does not see them, and the lorebook's own entries do not include them.
c. **Taken by a swipe and Back:** the turn that wrote them is retracted (use the path
   `src/lib/server/state/ownBookRoute.undo.int.test.ts` uses for Back and for a swipe/regenerate) → the room, link
   and day are gone from the own book; Forward brings them back if that file shows how.
d. **In the lorebook after the scene ends:** close a scene covering that turn and call the scene-close Apply (the
   path `src/lib/server/scenes/liveScenes.autoApply.int.test.ts` or `src/lib/server/lorebooks/autoApply.int.test.ts`
   uses: `applyHeldAutomatically(db, { sessionId, automatic: "scene-close", sceneId })` after the scene is closed)
   → the room and the link are in the lorebook, the day is the lorebook's (merged or moved), and an `apply`
   record exists.
e. **A member's session** (another user's session on the owner's lorebook, meeting the rule): its room is held in
   its own book and `applyHeldAutomatically` returns null — it never applies by itself.

Every int test that opens a DB inside an `it` needs a 60 s timeout (the bootstrapped harness uses 180 s; keep it).

### 2. `src/lib/server/pipelines/runtime/host.forkTiming.int.test.ts` — rewritten to the new rule, never weaker

Today it pins "the first accepted entry/link write forks the line" for a branch session riding its parent's line.
- Keep every existing case as the pin for a session whose scenes do **not** end by themselves (say so in each
  title and the file's header comment); they must pass unchanged in substance.
- Add the new rule for a session that meets it (mock the predicate per session as `host.ownBookFull.int.test.ts`
  does — read its `vi.mock("$lib/server/lorebooks/ownBook", …)`): the first accepted entry write and the first
  link write **fork nothing** (`line_on_first_write` stays true, no `lorebook_branches` row added, rows in the own
  book with `branch_id` null); **then an Apply forks** the line (`applyOverlayItems` pressed by the owner) and
  what it moved carries the new line's `branch_id`.

## Run

Only these files, only inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
Never pipe vitest into `head`. Also run, unchanged, `host.ownBookFull.int.test.ts` and
`src/lib/server/lorebooks/applyForksLine.int.test.ts`. `npx prettier --check` on each file you wrote. Typecheck:
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, report only errors in your files.

## Files owned (edit only these)

The new test file and `host.forkTiming.int.test.ts`. **No production file.** If a case cannot pass without a
production change, stop and report the case, what fails, and the smallest fix you see — do not make it.

## Out of scope

Every production file; the Lair and Dungeon Crawler socket suites (another worker); docs.

## Stop and ask (in your report) when

A case fails because of production behaviour (report it with the evidence); the real predicate is false where
this brief says true (or the reverse) — report what `scenesRoutineOn` and `sessionSceneContext` answered.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. Never run npm at the SDK repo root. It is a
  **session**, never a *chat* (the genre named Chat is a name). Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Other sessions are editing this repo: never touch their files, never "fix" failures that are theirs.

## Report (your final message)

Files written; each case and what it proves; test results per file (pass/fail counts); anything production that
failed, with evidence; **Noticed, not done**.
