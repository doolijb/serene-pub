# BRIEF — hist-G: follow-ups to hist-B1 and hist-E, and the fourth-round rulings (core)

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read the rulings sections, especially **"Rulings, fourth round"**. Read the reports `plans/REPORT-hist-B1-2026-11-10.md`, `plans/REPORT-hist-E-2026-11-10.md` and `plans/REPORT-hist-A-2026-11-10.md`. GO 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents (suggested split: w1 = parts 1-2, w2 = parts 3-5), and quote into their briefs the rules they need. Other sessions are editing nearby (host.ts carries unrelated uncommitted seat-cast work). Check each file's `git diff` before editing, and never touch hunks you didn't make.

## Part 1 — pipeline history writes (`src/lib/server/pipelines/runtime/host.ts`, `fileOntoHistoryDay` ~2097-2190 and the two port cases)

1. **Default date (owner, round 4):** with no `fields.year`, the date is the **session's story now** (`sessionStoryNowOf` / the same day `historyDateOfSessionWrite` uses for socket session writes, `messages/writes.ts`), not `writeDatingAt`. The day's entry is created if needed (`historyEntryOfDate(create:true)`). No session dating and no year: still refused.
2. **Month or day without a year** in `fields` is refused in words before any fallback (scope finding 1): *"‹node›: a history date needs a year. Give this write a year in its fields, or leave the date out to use the story's day."* (provisional 🚧).
3. **A day entry the pipeline creates keeps the anchors the old insert stamped** (scope finding 2). When `day.created`, stamp `provenance: "pipeline"` and the target's `sourceMessageId` on the new row inside `tx` (pass `sourceMessageId` into the helper). Don't change `scenes/historyEntryOfDate.ts`.
4. **The fork refusal comes before anything is created** (scope finding 3). Before `historyEntryOfDate`, if `historyOwnerStep(line, date).branchId !== line.branchId`, refuse with hist-A's rule-C sentence (reuse its builder from `historyEntryOfDate.ts`; export it there only if it isn't already, which is a minimal change). Update the test that pins the old copy (`host.historyWrites.int.test.ts:167`).
5. **Narrow the error wrapping** (scope finding 4): wrap only the refusal errors (plain `Error`s from the asserts, `BranchRefusal`) as `HostScopeError`, with `{ cause: e }`. Database faults rethrow unwrapped.

## Part 2 — hist-E follow-ups

6. **`src/lib/server/messages/writes.ts:284-285` comment:** make it honest. It forks after its *own* checks, and `entries:create` refusals that come later leave the fork (match `sessionLine.ts:33-37`).
7. **`src/lib/server/sockets/entries.ts` `entries:create`** (queued by hist-E): call `ensureSessionLine(tx, sessionId)` **inside** its transaction after its checks and use the answer as `data.branchId`; `sessionLoreWrite` then drops its own call. So a refused first write no longer leaves an empty line. Keep the outer behaviour otherwise identical, and test that a refused first write forks nothing.
8. **Test gap:** `sessionLine.int.test.ts` adds a scene for the same session, on the same `branchId` value, in a **second book**, and expects it to stay put.

## Part 3 — stray scenes (owner, round 4: "Compiling forks the session first")

9. In the compile path (`src/lib/server/sockets/scenes.ts`, the day compile ~1092-1290, and wherever a scene is compiled into an entry), before filing a scene whose session still has `line_on_first_write` set and rides the line being compiled, call `ensureSessionLine(tx, thatSessionId)` for **that** session inside the compile transaction. That forks its line and carries its uncompiled scenes. Then:
   - that session's scenes are no longer on the compiled line, so they don't compile into the parent's history;
   - the compile proceeds with the remaining scenes; if none remain, it answers in words that those scenes belong to a branch session, which compiles them on its own line.

   Read how compile picks its scenes first. If forking inside compile would need a lock order that risks deadlock (the book calendar lock vs the session line lock), **stop and report** with the evidence.

## Part 4 — deceased reads as background for lore (owner, round 4)

10. `src/lib/server/pipelines/prompt/characterLore.ts:124-177`: a cast member whose **cast version in force** (at the session's reading moment) has `nodeState: "deceased"` is treated as **background** for lore. The narrator reads its lore; its own voice and other voices don't (unless the player-seat clause already makes it everyone's, which is left as is). Find how the gate learns the member's state in force (cast versions, `characters/versions.ts`, `cast/memberAsRead.ts`). If the gate has no cheap access to the version in force, add it to the data the host already loads (`runtime/host.ts:4440-4520`, `seatedMemberIds`) minimally. Test: a seated AI member marked deceased has its lore read by the narrator and not by its own voice; an active one is unchanged.
    - **Not in scope:** the departed-player-seat lore bug (`removedAt` ignored, plan PROPOSAL "Noticed, not done"). Leave it, and mention it again in your report.

## Files owned

- `src/lib/server/pipelines/runtime/host.ts` (the `fileOntoHistoryDay` helper, the two history port paths, and the minimal `seatedMemberIds` data addition for part 4 only)
- `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`
- `src/lib/server/scenes/historyEntryOfDate.ts` (exporting the refusal-sentence builder only, if needed)
- `src/lib/server/messages/writes.ts` (the comment and dropping the call)
- `src/lib/server/sockets/entries.ts` (`entries:create`'s fork call only) + an entries int test
- `src/lib/server/lorebooks/sessionLine.int.test.ts`
- `src/lib/server/sockets/scenes.ts` (the compile fork only) + a scenes compile int test
- `src/lib/server/pipelines/prompt/characterLore.ts` + its tests

## Out of scope (write down, never build)

- The benched seat section (a separate design); the departed-seat lore bug.
- SDK work (hist-C/D); docs and NOMENCLATURE (hist-F): queue names and copy.
- Changing rule C, or the fork-day refusal (kept by the owner).

## Stop and ask when

CLAUDE.md §Decisions applies; compile forking risks a deadlock or would move another session's compiled scenes; the lore gate change would alter what a living member's voice reads; a name beyond the copy above is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `hist-G-`.

## Done means

- **Targeted tests pass:**
  - `host.historyWrites.int.test.ts`: the story-now default, month-without-year refused, a created row stamped `pipeline` + `sourceMessageId`, the fork refusal with the rule-C sentence and no rollback churn, a DB fault not wrapped;
  - `sessionLine.int.test.ts` (other-book scene);
  - an entries test (a refused first write forks nothing);
  - a scenes compile test (a branch session's riding scene is forked away before compile; the parent's compile no longer files it);
  - a `characterLore` test (deceased → background);
  - the existing `pipelines/runtime/*lore*`, `entries*`, `scenes*`, `sessionLine*` and `characterLore*` tests still green (Dungeon Crawler death tests are still expected red until hist-D; list them).
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-hist-G-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, tests and results, names and copy for lane F, open ★, **Noticed, not done**.
