# BRIEF — s4-follow-a worker w2 (2026-11-09): branch reads (turn-tied member rows, member–entry links) and durable filing by member

You are a `lane-worker` under supervisor lane `s4-follow-a`. Repo `/home/jody/github/serene-pub` (SvelteKit 5, TS, Vitest 4, Drizzle + PGlite). Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

Background: a branch session (`sessions/branch.ts` `branchSession`) of a session that reads its own notes (its **own book**, `lorebooks.session_id`) gets its own notes, a copy (`lorebooks/ownBook.ts` ~l.780–960); the branch's seats point at the **parent's** own-book members, read through the branch's **session cuts** (`state/reading.ts` `sessionCutsOf` / `cutsOfAncestry` ~l.236–280: per ancestor session, `through` = the highest `origin_message_id` among the branch's live lines from it; null when none) and **overlay chain** (`overlayChainOf` ~l.282: own book, then each ancestor's own book, nearest first). Owner ruling 2026-11-05: "All sessions have a lorebook, [own book] or overlay." Never write copy or code that frames a session as having no lorebook.

## Goal A — ★s4-verify-3 (owner approved 2026-11-09): cut post-fork turn-tied member rows for a branch reading

A durable member row (`attribute_values` / `attribute_configs`, `session_id` null, owner `cast_member`) that the **parent** writes on its notes' main **after the fork**, tied to a turn (`valid_from_message_id` = a parent message after the fork), is today read by the branch (the diagnostic `test.fails` at `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts` ~l.607 reads 9, wants 6). Fix in `state/reading.ts` `rowsOnReading` (~l.553): when the reading carries session cuts (`reading.line.sessionCuts`, set for a branch's own-notes reading ~l.347), a **durable** row whose `validFromMessageId` is a message of one of the cut sessions is kept only when `validFromMessageId <= that cut's through` (through null → dropped). A row tied to a message of the reader's own session, or with no turn tie, is unchanged. One query for the messages' session ids (batch, `inArray`). Widen the generic `T` with `validFromMessageId?: number | null`. A **non-branch** reading (no session cuts) takes no extra query and is unchanged.
- Tests: flip the `test.fails` to `test` (keep its ★s4-verify-3 comment, reworded to say it is fixed); add a test that a non-branch reading still reads the parent's turn-tied row (in `ownBook.branchNotes.int.test.ts` or `src/lib/server/state/reading.sessionCuts.int.test.ts`), and one that a turn-tied row at or before the fork still reaches the branch.

## Goal B — ★s4-last-1 (owner approved): member–entry links reach a branch

`src/lib/server/utils/graphEntryLinks.ts` `bookEntryLinks` (~l.120–210) keeps an edge's entry ends and member (node) ends only inside `bookIds` = the book and the book it overlays (~l.147–152, ~l.197–203). A branch's member ends are the **parent's** own-book members, so they're filtered out. 
1. Widen `bookIds` to also include the reading session's **overlay chain** books (`overlayChainOf(db, sessionId)` from `state/reading.ts`) — pass what you need from `readGraphEntryLinks` (which has `sessionId`); a session that is not a branch gets the same list as today.
2. Then copy member–entry links in `lorebooks/ownBook.ts` `copyNotesStatsAndLinks` (~l.820–935): today "a link with a member at either end stays with the parent's notes" (~l.902). Copy a link with an entry at one end and a member at the other: the entry end through `entryRemap` (skip if it did not come across), the member end kept as is (members are shared, not copied), `lorebookId: madeId`, same `historyEntryId` / `branchId` rules as the entry–entry copy. Member–member links: do not copy (out of scope; note it). Update the JSDoc above the function.
- Test (in `ownBook.branchNotes.int.test.ts`): a session on its notes with a member–entry link; branch it; the branch's `readGraphEntryLinks` lists the link with its member end named; the parent still reads it once.

## Goal C — f-emit-3 owner note: durable filing is by member, the character-seat preference only breaks a same-session tie

Owner, 2026-11-09: *"Make sure this doesn't disturb the ability for a cast member to be played by a persona and by the AI in different sessions."* · *"who plays it changes."* The rule in `src/lib/server/state/durable.ts` ~l.326–336 (`heldByCharacterSeat`) skips a player seat only when the same member also holds a character seat **in the same session** (`links` is one session's). 
1. Add an int test (`src/lib/server/state/durable.int.test.ts`): member M of a shared book, played by the AI in session A (character seat) and by a person in session B (player seat whose card is M's card) — a durable write in A and a durable write in B both land on `cast_member:M`.
2. Card-less player seats: `links.playerSeats` (`state/resolve.ts` ~l.245 `PlayerSeatLink`, built ~l.716; has `playerSeatId`, `seatMemberId`) are **not** filed today (only `links.cast` and `links.seatedMembers` are, ~l.354–375 and ~l.405–430). Make a live card-less player seat with a member file onto that member the same way, owner `{ kind: "player_seat", id: playerSeatId }`, in both places (the own-book route `recordOwnBookOwners` and the attached-book loop), with the same tie rule: skipped when a character seat of this session (`links.cast` with `playerSeatId == null`, or `links.seatedMembers`) files the same member. `PlayerSeatLink` doesn't say which book the member lives in: decide it inside `durable.ts` with one query on `lorebook_bindings.lorebook_id` for those member ids (do **not** edit `state/resolve.ts` — not ours). Keep the `🚧 ⏳ S4` comment style; one sentence on the new loop.
- Tests: a card-less player seat's durable write lands on its member; with the same member also in a character seat of the same session, it is filed once (by the character seat).

## Rules you must follow

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `copyNotesStatsAndLinks` runs on `tx`; keep it that way.
- "0.6 is in users' hands: a change to stored data ships with a forward migration or boot pass." These goals change reads and new writes only — no stored-data reshaping, no migration. If you find one is needed, stop and report.
- No new names, settings, events or tables. Private helpers are fine (name them in your report).
- Do what is asked at the size asked; anything else goes under **Noticed, not done**.
- Prettier: run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file. If a file fails only on lines you didn't touch, leave it and say so.
- If an `Edit` fails because the file changed since you read it, re-read that range and retry.

## Files owned (edit only these)

`src/lib/server/state/reading.ts`, `src/lib/server/state/durable.ts`, `src/lib/server/utils/graphEntryLinks.ts`, `src/lib/server/lorebooks/ownBook.ts` (`copyNotesStatsAndLinks` + its JSDoc only), tests next to them: `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts`, `src/lib/server/state/durable.int.test.ts`, `src/lib/server/state/reading.sessionCuts.int.test.ts`, and a new `src/lib/server/utils/graphEntryLinks.int.test.ts` if you need one.

Another worker is editing `sessions/seats.ts`, `sessions/seatName.ts`, `sockets/sessions.ts`, `lorebooks/foldInParent.ts` right now — don't touch them.

## Tests (Done means)

Run, capped and logged (scratchpad `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run <files> --maxWorkers=2 > <scratchpad>/s4-follow-a-w2-tests.log 2>&1; echo test-exit=$? >> <scratchpad>/s4-follow-a-w2-tests.log'`
Files: `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts src/lib/server/lorebooks/ownBook.int.test.ts src/lib/server/lorebooks/ownBook.test.ts src/lib/server/state/durable.int.test.ts src/lib/server/state/reading.sessionCuts.int.test.ts src/lib/server/state/ownNotesReading.int.test.ts src/lib/server/state/lorebookReading.int.test.ts src/lib/server/sessions/branch.state.int.test.ts src/lib/server/sessions/branch.seatMembers.int.test.ts` plus any graphEntryLinks test (`grep -rl graphEntryLinks src --include=*.test.ts`). Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; ...'`. Baseline 0 errors.

## Report

Final message to the supervisor: changed files, one line each; per goal what changed; tests with pass/fail counts; tsc; Noticed, not done.
