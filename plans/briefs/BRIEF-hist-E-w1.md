# BRIEF — hist-E-w1: the first-write fork carries the session's uncompiled scenes; `sessionLoreWrite` forks

Supervisor: hist-E (plan `plans/PLAN-history-one-per-date-2026-11-10.md`, Build scope item 7). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Owner rulings this applies (2026-11-10, verbatim)

- **★H2, rule C accepted:** "Instead of moving the fork point to the session start, the line forks at its first write (as today) and carries that session's not-yet-compiled scenes with it (today they leak onto the parent)."
- "The first-write fork carries the session's uncompiled scenes. Nothing moves." ("Nothing moves" = fork dates never move.)

## Goal

### 1. Carry the session's own uncompiled scenes (`src/lib/server/lorebooks/sessionLine.ts`)

In `ensureSessionLine` (lines 93-146), right after the existing `moveRidingProposals(...)` call (:138-144), on the same `tx`, move the scenes that are:
- `scenes.session_id = sessionId`, and
- `scenes.lorebook_id = bookId` (the attached book), and
- `scenes.branch_id IS NOT DISTINCT FROM <the line the session rode>` (`session.lorebookBranchId ?? null`, the same value passed to `moveRidingProposals`), and
- `scenes.history_entry_id IS NULL` (not yet compiled)

onto the new line: `set branch_id = line.id`. Nothing else on the row changes.

- Write it as a private (non-exported) function `moveRidingScenes(tx, sessionId, bookId, fromBranchId, toBranchId)` in `sessionLine.ts`, shaped like `moveRidingProposals` (`src/lib/server/state/write.ts:464-482`: one `tx.update(...).set(...).where(and(...))`, with `sql\`${col} is not distinct from ${fromBranchId}\``). Keep it in `sessionLine.ts`; do **not** edit `state/write.ts`. Precedent for lines code moving a session's scenes directly: `lorebooks/foldInParent.ts:780-820` (`moveCaptures`).
- Compiled scenes (history_entry_id set), other sessions' scenes, and the session's scenes on any other line or book **never move**.
- **Before writing it**, check whether any table has both a `sceneId`/`scene_id` column **and** a `branchId`/`branch_id` column (`grep -n "sceneId\|branchId" src/lib/server/db/schema.ts`). If one does and its rows for an uncompiled scene would be left on the old line, **stop and report it** — don't move them.
- Update the file header comment (lines 1-34): the session's uncompiled scenes move with the proposals; and add `sessionLoreWrite` (`messages/writes.ts`) to the list of writers, noting it is called on the outer `db` (by `sockets/entries.ts`'s `entries:create`), so — like `loreWriteTargetFor` on the outer `db` — it gets the one-statement lock only. Also update the `ensureSessionLine` doc comment (:83-92) to mention the scenes. Plain sentences, house style.

### 2. `sessionLoreWrite` forks on first write (`src/lib/server/messages/writes.ts`, the fork call only)

`sessionLoreWrite` (:251-290) is the check every session-originated book write that names its session asks first (today `entries:create` with `sessionId`). It reads the line via `sessionReadingOf` but never calls `ensureSessionLine`, so a branch session riding its parent (`sessions.line_on_first_write`) files its lore on the parent's line.

- After the last refusal (`offRefusal`, :280) and **before** `sessionReadingOf` (:285), add `await ensureSessionLine(db, sessionId)` with a one-line comment (the session's first write to the attached book forks its own line, as every other book writer does; after the checks so a refused write forks nothing).
- Import it statically: `import { ensureSessionLine } from "$lib/server/lorebooks/sessionLine"` (sessionLine.ts never imports `$lib/server/db`, so any module may import it; `ownBook.ts` already does).
- Update the `sessionLoreWrite` doc comment's last paragraph (:244-246) to say a branch session riding its parent forks its own line here first.
- Change nothing else in `writes.ts`.

## Files owned (edit only these)

- `/home/jody/github/serene-pub/src/lib/server/lorebooks/sessionLine.ts`
- `/home/jody/github/serene-pub/src/lib/server/messages/writes.ts` (the fork call and its comments only)
- `/home/jody/github/serene-pub/src/lib/server/lorebooks/sessionLine.int.test.ts` (add tests)

## Files readable

Anything. Useful: `state/write.ts:400-482`, `lorebooks/ownBook.ts:400-415`, `scenes/liveScenes.ts:1211-1330` (`openScene`), `sockets/entries.ts:730-750`, `state/sessionLoreWrites.int.test.ts`.

**Never edit** `src/lib/server/pipelines/runtime/host.ts` or `src/lib/server/pipelines/tools/writeTools.ts` (another lane is editing them now), nor any file not listed above.

## Tests to add (in `sessionLine.int.test.ts`, reuse its `world()` fixture)

1. **Scenes follow the fork.** A flagged branch session riding the Fork line. Insert scenes directly into `schema.scenes` (required columns: `lorebookId`; set `sessionId`, `branchId`, `historyEntryId`, `channel`):
   - the session's own uncompiled scene on the Fork line → moves to the new line;
   - the session's own **compiled** scene on the Fork line (`historyEntryId` = a history entry you insert in `lorebookEntries` on the Fork line; see how other tests insert a history entry, `typeId` from `HISTORY_TYPE_ID` or the existing fixtures) → stays on the Fork line;
   - **another session's** uncompiled scene on the Fork line → stays;
   - the session's own uncompiled scene on **main** (`branchId: null`) → stays.
   Then trigger the first write through a real book write (`setValue`, as the "bookWritePlace" test at :262 does) and assert each scene's `branchId`.
2. **Capturing a scene does not fork; the first write carries it.** If feasible, open a scene on the flagged session through the real `openScene` (`$lib/server/scenes/liveScenes`; it needs a session message on the channel as the boundary — insert one into `schema.sessionMessages`), assert the flag is still set and the scene's `branchId` is the Fork line, then `setValue` and assert the scene moved to the new line. If `openScene` cannot be driven from this fixture in reasonable effort, say why in your report and keep test 1 only.
3. **`sessionLoreWrite` forks.** On a flagged session (`world()`), `sessionLoreWrite(testDb, { sessionId, userId, lorebookId: book.id })` answers the new line's id as `branchId`, the session's flag is cleared, and the book has 2 lines; a second call forks nothing. A refused call (wrong `userId`, the `other` user — expose it from `world()` if you need to) forks nothing (flag still set, 1 line).

Int tests that open a DB inside an `it` need a 60 s timeout (the file already sets `vi.setConfig({ testTimeout: 60_000 })`).

## Run (capped scope; never pipe vitest into `head`)

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/lorebooks/sessionLine.int.test.ts src/lib/server/lorebooks/sessionLine.forkTiming.int.test.ts src/lib/server/state/sessionLoreWrites.int.test.ts src/lib/server/sockets/entries.sessionWrite.int.test.ts; echo test-exit=$?'
```

Report any failure in the existing files with the test name and your diagnosis; don't edit files you don't own to fix them. Then `npx prettier --check` your three files (check only).

## Rules (quoted from CLAUDE.md and the lane brief)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- It is a **session**, never a *chat*.
- **Decisions:** decide implementation inside the asked scope; name the choice in your report. Anything a user sees, a new setting/flag/table/migration/event, or files outside the list: stop and report, don't do it. Findings along the way go under **Noticed, not done**, never fixed in passing.
- No migration. Existing scenes that already leaked onto a parent line are left as they are.
- **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never `git checkout`, `restore` or `clean` in either repo. Scratch files start with `hist-E-` and go in your scratchpad, not `/tmp` globs.

Verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This task needs no `sdk:build`.)

## Done means

The three new tests pass; the four files in the run command are green (or each failure diagnosed); prettier check clean on your hunks.

## Report

Write to `/home/jody/github/serene-pub/plans/briefs/REPORT-hist-E-w1.md` (if the write is refused, put it in your final message): changed files with a one-line summary each, tests run with pass/fail counts, decisions made, **Noticed, not done**.
