# BRIEF — hist-G-w2: compiling forks a riding branch session first; deceased members read as background for lore

Supervisor: hist-G (plan `plans/PLAN-history-one-per-date-2026-11-10.md`, "Rulings, fourth round"). Repo `/home/jody/github/serene-pub`. Use absolute paths. Other sessions are editing nearby: `scenes.ts` and `characterLore.ts` carry **unrelated uncommitted work**. Run `git diff <file>` before you edit each file, edit with exact-string `Edit` calls only, and never touch a hunk you didn't make. **Do not edit `host.ts`** — another worker is in it; the supervisor makes the one-line host change for part B.

## Owner rulings this applies (2026-11-10, verbatim)

- **Stray scenes (★E-2):** "Compiling forks the session first". Compiling a scene whose session still rides its parent's line (`line_on_first_write` set) first forks that session's line (`ensureSessionLine`, carrying its uncompiled scenes), so the scene compiles onto its own line.
- **Deceased lore:** "Yes, but we should add a seat section for benched cast members …". A member whose cast version in force is `deceased` reads as background for lore (the narrator reads it). **The benched seat section is a new design, not part of this build.**

## Background you need (supervisor's reading)

- `ensureSessionLine(tx, sessionId)` (`src/lib/server/lorebooks/sessionLine.ts:127-188`): when `sessions.line_on_first_write` is set and the session has an attached book (`sessions.lorebook_id`), it takes `lockBookCalendar(tx, bookId)` (= `pg_advisory_xact_lock(bookId)`, `state/storyTime.ts:160`), forks a line from the one the session rides (`sessions.lorebook_branch_id`), moves the session onto it, clears the flag, and moves the session's own **uncompiled** scenes (`history_entry_id IS NULL`) **in the attached book only**, on the ridden line, onto the new line (`moveRidingScenes`). Compiled scenes never move.
- Advisory xact locks are re-entrant within one transaction, so calling it while already holding `lockBookCalendar(tx, sameBook)` is safe. Calling it for a session whose attached book is **another** book would take a second book's lock while holding the first (lock-order risk) and would move nothing (scenes move only in the attached book). So: **fork only sessions whose `lorebook_id` equals the compiled book.**
- The compile (`src/lib/server/sockets/scenes.ts`, `sceneCompileHandler` ~1088-1500): a **by-date** ask (~1210-1310) opens a transaction under `lockBookCalendar`, finds `waiting` unfiled scenes of that day on `askedBranchId`, and creates the day's entry with `historyEntryOfDate(create:true)`; then both asks run the **entry path**: refusals (ownership, lore writes off, line, moment, ~1312-1390), then `dayUnfiled = unfiledScenesByEntry(db, { lorebookId, line }).get(entryId)` (~1398) plus filed `lineScenes`, `if (scenes.length === 0) refuse("No scenes found for this history entry.")`, then the model call, then a review. Apply (`activityStore.setCompileReviewApplied`, ~2161) files only the `sceneIds` the press recorded; it needs no change.

## Part A — compile forks a riding branch session first (`src/lib/server/sockets/scenes.ts`, the compile only)

A scene is **riding** when: it is unfiled; its `session_id` names a session with `line_on_first_write = true` and `lorebook_id = <the compiled book>`; and the scene's `branch_id IS NOT DISTINCT FROM` that session's `lorebook_branch_id`. Exactly these are what `ensureSessionLine` moves.

1. **Entry path:** after the existing refusals and **before** `dayUnfiled` is read, open `db.transaction(async (tx) => { await lockBookCalendar(tx, lorebookId); … })`: read `unfiledScenesByEntry(tx, { lorebookId, line }).get(params.historyEntryId) ?? []`, pick the riding ones (one query on `schema.sessions` for their distinct `sessionId`s, filtered as above), and call `ensureSessionLine(tx, sessionId)` once per such session. Return how many scenes were forked away. Then the existing `dayUnfiled` read runs as now (outside), and no longer sees them.
2. **By-date path:** inside its existing transaction, after `waiting` is computed and **before** `historyEntryOfDate`, do the same for the riding scenes in `waiting`, then drop them from `waiting`. If nothing remains **and** some were forked away, **return** (don't throw — the forks must commit) a marker, and outside refuse with the branch-session sentence below. If nothing remains and none were forked, keep today's "No scenes of that day are waiting to be compiled.".
3. **The sentence** when a press's scenes were all forked away (entry path: `scenes.length === 0` after a fork moved at least one; by-date: as above). Use exactly, with a `// 🚧 Provisional copy: the owner has not seen this sentence.` comment:
   `"The scenes waiting here belong to a branch session, which compiles them on its own line."`
   Define it once as a module-level `const` in `scenes.ts` (beside the other compile code; no new export).
4. Write the riding-scene lookup + fork as **one private (non-exported) helper** in `scenes.ts`, taking `(tx, lorebookId, scenes)` and returning the ids it forked away. Name it `forkRidingSessions`. Only `tx` inside the transaction. Import `ensureSessionLine` from `$lib/server/lorebooks/sessionLine` (it never imports the db, so a static import is safe; check `scenes.ts`'s imports first).
5. Comment the change in house style: one or two plain sentences citing the ruling ("Compiling forks the session first", owner 2026-11-10).
6. **Stop and report** (don't build) if you find a compile path where the fork would have to run while holding a lock other than the compiled book's calendar lock, or where a forked session's **compiled** scenes would move.

### Part A test — new file `src/lib/server/sockets/scenes.compileForksRiding.int.test.ts`

Model the fixture on `src/lib/server/sockets/scenes.compileLine.int.test.ts` (its `vi.mock`s of the db, summarizer, capability target and receipts; `seedBook`, `seedDay`, `unfiledOn`, the by-date describe at ~957). Cases:
- **Entry ask:** main has a day entry with one unfiled scene of a normal session and one unfiled scene of a **riding** branch session (a second session on the same book with `lineOnFirstWrite: true`, `lorebookBranchId: null`) on that day. Compile main's entry → the riding session now has its own line (flag cleared, `lorebook_branch_id` set), its scene moved onto that line, and the compile's scenes (what the mocked summarizer received) and the activity's `sceneIds` contain only the normal session's scene.
- **Only riding scenes:** the same with no normal scene → the press refuses with the branch-session sentence, and the fork still committed (flag cleared, scene on the new line).
- **By-date ask** with only a riding scene → the branch-session sentence, no history entry created, the fork committed.
- **A riding session attached to another book** (its scene in the compiled book, its `lorebook_id` another book) → not forked; its scene compiles as before (today's behaviour). Note this in your report.

## Part B — a deceased member reads as background for lore (`src/lib/server/pipelines/prompt/characterLore.ts:105-177`)

The gate `isCharacterLoreEntryVisible` gets the member's state in force from the binding itself: the host will set `nodeState` (the `MemberAsRead.nodeState` of `cast/memberAsRead.ts:85`, the cast version in force at the session's reading) on each hydrated binding, the same way it already sets `memberCards`. Read it like `memberCards` does (`(binding as { nodeState?: unknown }).nodeState`), with no new type or field name.

In the gate, after the binding is found:
- If the binding's `nodeState === "deceased"`: return `true` when the **player-seat clause** (the existing `sessionPersonas` check, ~159-168: a player seat seats or voices this member) holds — left as is — and otherwise return `narrator` (and still only for this session's book, which the earlier checks already ensure). So its own speaking seat, a seat holding its card, and other voices do **not** read it; the narrator does, even when the member is seated.
- Everything else is unchanged: a binding without `nodeState`, or with any other state (`active`, `missing`, `departed`), reads exactly as today.
- Restructure only as much as needed (e.g. evaluate the player-seat clause into a `const` before the speaker checks). Update the gate's doc comment with one sentence citing the ruling.
- **Stop and report** if this would change what a living (non-deceased) member's voice reads in any existing test.

### Part B tests — `src/lib/server/pipelines/prompt/characterLore.cardless.test.ts` (or a new `characterLore.deceased.test.ts`)

- A seated AI member (its id in `seatedMemberIds`, a card on the binding) whose binding has `nodeState: "deceased"`: its lore is visible to the narrator (both ids null) and **not** to its own voice (`currentCharacterId` = its card; also `currentCastMemberId` = its id for a card-less seat), nor another speaker.
- The same member with `nodeState: "active"` (and with no `nodeState`): unchanged from today (own voice reads it, narrator doesn't when seated).
- A deceased member a player seat seats (`sessionPersonas[].castMemberId` = its id): every speaker still reads it (player-seat clause left as is).

## Files owned (edit only these)

- `/home/jody/github/serene-pub/src/lib/server/sockets/scenes.ts` — the compile handler's fork only (plus the helper, the sentence const and the import)
- `/home/jody/github/serene-pub/src/lib/server/sockets/scenes.compileForksRiding.int.test.ts` (new)
- `/home/jody/github/serene-pub/src/lib/server/pipelines/prompt/characterLore.ts` — the gate only
- `/home/jody/github/serene-pub/src/lib/server/pipelines/prompt/characterLore.cardless.test.ts` or new `characterLore.deceased.test.ts`

## Out of scope (write down, never build)

- The benched seat section (a separate design).
- The departed-player-seat lore bug (`removedAt` ignored by the player-seat clause) — leave it exactly as is; mention it in your report.
- `host.ts` (the supervisor sets `nodeState` there), `sessionLine.ts`, Apply, other compile callers, docs, NOMENCLATURE.

## Stop and ask when

- You'd need a name other than `forkRidingSessions`, or copy other than the sentence above.
- The lock-order or compiled-scene conditions in Part A item 6.
- A living member's reads would change (Part B).
- Anything needs a migration, a setting, or a file outside this list.

## Rules (quoted; they apply to you)

- CLAUDE.md Hard rule: *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."*
- CLAUDE.md Standing ruling: *"Sockets: … views register listeners for local state and never call `toaster`."* (Server side here; the compile's refusals go out through the handler's own `refuse()`, never a new event.)
- CLAUDE.md: *"It is a **session**, never a *chat*."*
- CLAUDE.md §Decisions: *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."*
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand (tabs, double quotes, no semicolons, as the code around them).
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`.)
- Int tests that open a DB inside an `it` need a 60 s timeout. **Never pipe vitest into `head`.** Run vitest only in a capped scope:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
- Typecheck: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p . 2>&1 | grep -E "sockets/scenes|compileForksRiding|characterLore" ; echo tsc-done'`
- Scratch files start with `hist-G-w2-`.

## Done means

- Tests green: `scenes.compileForksRiding.int.test.ts`, your characterLore test, and still green: `src/lib/server/sockets/scenes.compileLine.int.test.ts`, `scenes.applyCommits.int.test.ts`, `scenes.captureAndLine.int.test.ts`, `src/lib/server/scenes/unfiledScenesByEntry.int.test.ts`, `src/lib/server/pipelines/prompt/characterLore*.test.ts`.
- `tsc` clean for these files.
- **Report** (your final message, no file): changed files with the hunks you made (line ranges), tests run with pass counts, decisions you made, anything that made you stop, Noticed-not-done.
