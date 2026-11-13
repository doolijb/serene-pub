# BRIEF — bench-L2: benched seats, the readers ("in play = live and not benched")

Design: `plans/PROPOSAL-benched-seats-2026-11-10.md`. Read it all, including both rulings rounds and the challenge answers (binding). Also read `plans/REPORT-bench-L1-2026-11-10.md`: `setSeatBench`, `session_personas.is_active` (migration `0152_overjoyed_magik`), and the "Queued → L2" list. RULED 2026-11-10. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, delegate the typing to at most 2 `lane-worker` agents inside the files below, and quote into their briefs the rules they need. Other sessions are editing nearby (variable layouts; images/vision). Check each file's `git diff` before editing.

## Rulings this lane applies (owner, 2026-11-10)

- **Benched is the one lore rule** (★1): a benched member reads as **background** (the narrator reads its lore); a seat in play reads as seated.
  - **Retire hist-G's deceased arm:** `characterLore.ts` no longer reads `nodeState`; a deceased member whose seat is in play reads normally ("treats them normally").
  - **Core never benches on its own:** no automatic bench, and no "nudge".
- **Benched and fallen characters leave the prompt's characters block** entirely, except the speaker.
- **A removed or benched player seat no longer unlocks its member's lore** everywhere. That's the departed-player-seat bug: the persona arm ignored `removedAt`.

## Goal

1. **One predicate.** `seatInPlay` (SQL: `removed_at IS NULL AND is_active`) and a pure `inPlay(row)` in `src/lib/server/sessions/seats.ts`, or a shared module if client code needs it. Use them below; don't spell the condition again.
2. **Readers that must use "in play"** (add `is_active` for player seats; character seats already have it). Verify each and find any others (grep `removedAt` / `removed_at` readers in turns, prompt and speaker code):
   - **Turns:** `turnPlan.ts:~138`, `fireTurn.ts:~166`, `speakerRotation.ts:~257`, `dispatchSpeech.ts:~472`, `runTurn.ts:~1800`; `who.active` in `state/resolve.ts:~2302-2318`.
   - **Which seat a person speaks as:**
     - `sessions/seatName.ts` `cardlessPlayerSeatOf` / `ownCardlessPlayerSeats`, and the `mine` pick in `writeSeatName` when there's no retire;
     - `src/lib/shared/sessions/playerSeat.ts` `isCardlessPlayerSeat` / `isOwnPlayerSeat`;
     - `src/lib/server/messages/store.ts` `speakerSeatOf`.

     A benched seat is never picked as the speaking seat.
   - **Prompt:**
     - the characters block (`pipelines/prompt/promptFields.ts:~390-398`) compiles only seats in play, plus the speaker always;
     - names and likenesses (`:~410-435`) already drop benched character seats, so do the same for player seats;
     - `getPromptSessionFromDb` (`sockets/sessions.ts:~2207`), `pipelines/runtime/host.ts:~684, ~9224`.
   - **Lore gate** (`pipelines/prompt/characterLore.ts`, `isCharacterLoreEntryVisible`):
     - the persona arm counts only player seats in play;
     - delete the deceased arm hist-G added (the `nodeState === "deceased"` branch) and its `nodeState` hydration in `host.ts` (~4538-4543);
     - `seatedMemberIds` (`host.ts:~4599-4638`) filters `removedAt == null && isActive !== false` on both tables (add `isActive` to the `seatRows` select), and passes `isActive` through `asSession.sessionPersonas`;
     - replace `characterLore.deceased.test.ts` with the new matrix (in play → its own seat reads it; benched → the narrator; deceased-and-in-play → its own seat; a removed or benched player seat doesn't leak).
   - **SDK cast doc** (`SessionCastV1.sessionPersonas[].enabled`, documented today as "always true"): core fills it from `is_active`. `resolve.ts` fills persona links' `isActive` from the column (hardcoded `true` at `~:751`); add `PlayerSeatLink.isActive` if the SDK type needs it (**SDK edit**: contract doc and type only), and `characters.v1` flags benched personas `benched: true`.
   - **Dungeon Crawler** `liveSeats` (SDK `core-catalog/src/genres/dungeon-crawler/preamble.ts:~202`) filters `enabled !== false`. **SDK edit.**
3. **SDK edits** (the two above): make them in source. **Don't run `npm run sdk:build`.** The lead coordinates it with another session; report "SDK edits ready for build" and list the files. Test from source where possible: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>`.

## Files owned

- `src/lib/server/sessions/seats.ts` (the predicate only), `src/lib/server/sessions/seatName.ts` (the speaker pickers only)
- `src/lib/shared/sessions/playerSeat.ts`, `src/lib/server/messages/store.ts` (`speakerSeatOf` only)
- the turn files above, `src/lib/server/state/resolve.ts` (`who.active`, persona `isActive`)
- `src/lib/server/pipelines/prompt/promptFields.ts`, `src/lib/server/pipelines/prompt/characterLore.ts` (+ tests), `src/lib/server/pipelines/runtime/host.ts` (the lore-read seat rows and `nodeState` removal only), `src/lib/server/sockets/sessions.ts` (`getPromptSessionFromDb` only)
- SDK: the `SessionCastV1` / `PlayerSeatLink` doc and type, the DC `preamble.ts` `liveSeats`
- tests for these

## Out of scope (write down, never build)

- The port `set-seat-bench@1`, `writes.seats`, retract/restore, companion death (L3). UI (L4). Docs and NOMENCLATURE (L5).
- `setSeatBench` itself and the data upgrade (L1, done).

## Stop and ask when

CLAUDE.md §Decisions applies; a reader's change would alter what a **living, in-play** member reads or does; an SDK change beyond the two named is needed; a name beyond `seatInPlay` / `inPlay` is needed.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Never commit. Never `npm test` or `npm run build` at the SDK root. **Never `npm run sdk:build`.** Delete only `/tmp/serene-pub-vitest-*` dirs your own runs made, by name — never a glob.
- Inside `db.transaction(async (tx) => …)` use only `tx`. `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`.
- Int tests that open a DB inside an `it` need a 60 s timeout. Never pipe vitest into `head`. Run vitest in a capped scope: `systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`.
- Scratch files start with `bench-L2-`.

## Done means

- **Targeted tests pass:**
  - the `characterLore` matrix;
  - a `promptFields` test (a benched card leaves the block; a benched speaker keeps theirs);
  - the in-play readers (turn plan, speaker rotation, `fireTurn`, `cardlessPlayerSeatOf` / `speakerSeatOf` never pick a benched seat);
  - `sessions.dungeonCrawlerWalk2.int.test.ts` Q0-2 (`:570`, the line after a retire belongs to the new seat `player-seat:4`, not the benched `player-seat:3`) and `sessions.dungeonCrawlerW3.int.test.ts` A9 (`:542`, the owner's OLD seat's `fate` must still read dead after a new character; the old seat must not resolve to the new one) are green, and Walk100 stays green;
  - existing `sessions*`, `pipelines/prompt/*`, `pipelines/runtime/*seat*` tests green.
- **Typecheck:** `npx tsc --noEmit -p .` clean for your files.
- **No full suite.**

## Report

`plans/REPORT-bench-L2-2026-11-10.md`. If the harness refuses the write, put the full report in your final message. Include changed files in both repos, "SDK edits ready for build" with the list, tests and results, names for L5, open ★, **Noticed, not done**.
