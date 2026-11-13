# BRIEF — hist-E: session lines carry their scenes; next chapter carries the clock

Plan: `plans/PLAN-history-one-per-date-2026-11-10.md`. Read the owner-ruling sections, **§ Build scope item 7**, the **★H2 design** and **§ Clocks** research sections, and lane hist-A's report (`plans/REPORT-hist-A-2026-11-10.md`). GO 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Lane hist-B1 is running at the same time in `pipelines/runtime/host.ts` and `tools/writeTools.ts`; never edit those. Check each file's `git diff` before editing.

## Rulings this lane applies (owner, 2026-11-10)

- **★H2, rule C accepted**, including "Instead of moving the fork point to the session start, the line forks at its first write (as today) and carries that session's not-yet-compiled scenes with it (today they leak onto the parent)."
- **★C2:** "Carry the clock". A next chapter starts at the followed session's story now.
- **★C3:** keep session clocks.

## Goal

1. **Carry the session's own uncompiled scenes on first write.** When `ensureSessionLine` (`src/lib/server/lorebooks/sessionLine.ts:93-140`) forks the session's line, it moves **that session's own** scenes that are not yet compiled (`scenes.history_entry_id IS NULL`, belonging to this session) from the line the session rode onto the new line. Do it the way it already moves proposals (`moveRidingProposals`, `:138`). Compiled scenes and other sessions' scenes never move. Use `tx` only.
2. **Fork on first write where the session writes to the book but skips it today** (research: medium confidence; verify first):
   - scene capture files scenes on `session.lorebookBranchId` and never calls `ensureSessionLine` (`src/lib/server/scenes/liveScenes.ts:1230`, `openScene` ~`:1211`);
   - `sessionLoreWrite` (`src/lib/server/messages/writes.ts:251-290`) skips it too.

   Where a session has `line_on_first_write` set (a branch or a branch-off start), the first such write calls `ensureSessionLine` first, exactly as the existing book-write paths do (find them: `grep -rn ensureSessionLine src/lib/server`), so the write lands on the session's own line. If research shows scene capture deliberately does not fork (a scene is not a "book write"), **stop and report** with the evidence; don't change it.
3. **Next chapter carries the clock** (`src/lib/server/sockets/sessions.ts:903-932` and `:1540-1556`): a next chapter's new session starts with the followed session's story now (`sessionStoryNowOf`, `state/storyTime.ts:358-368`) as its own session clock, instead of falling back to the line's present. Copy the parts verbatim. When the followed session has no clock and follows its line, the new one follows the line too, unchanged.

## Files owned

- `src/lib/server/lorebooks/sessionLine.ts` (+ tests)
- `src/lib/server/scenes/liveScenes.ts` (the first-write fork call only)
- `src/lib/server/messages/writes.ts` (the first-write fork call only)
- `src/lib/server/sockets/sessions.ts` (the next-chapter clock only)
- `src/lib/server/state/write.ts` (only if moving scenes needs a helper beside `moveRidingProposals`)
- new and existing int tests for these

## Out of scope (write down, never build)

- ★4 from hist-A (a branch session's history date starting after its fork): it waits on the owner.
- Pipeline ports, `note-scene@1` (hist-B1/B2); SDK (hist-C/D); docs (hist-F); `entries.ts`, `historyEntryOfDate.ts` (hist-A, closed).
- Removing session clocks (★C3: kept).

## Stop and ask when

CLAUDE.md §Decisions applies; moving scenes would move another session's or a compiled scene; scene capture forking would change what other sessions on the line see in a way the rulings don't cover; a migration seems needed (none is planned: existing leaked scenes are left as they are and listed in the report).

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This lane needs no `sdk:build`.)
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite silently.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `hist-E-`.

## Done means

- **Targeted tests pass:**
  - a branch session captures a scene before its first book write; at the first write the line forks and the uncompiled scene moves onto it; another session's scene and a compiled scene stay;
  - scene capture / `sessionLoreWrite` on a `line_on_first_write` session lands on its own line (or the evidence-backed stop);
  - next chapter starts at the followed session's clock, and a following session stays following;
  - existing `sessionLine`, `liveScenes`, branch and next-chapter tests still green (`grep -rln "nextChapter\|next-chapter\|branchSession\|ensureSessionLine" src --include=*.test.ts`).
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files (capped, `NODE_OPTIONS=--max-old-space-size=8192`, `MemoryMax=12G`).
- **No full suite.**

## Report

`plans/REPORT-hist-E-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files, tests and results, names for lane F, open ★, **Noticed, not done**.
