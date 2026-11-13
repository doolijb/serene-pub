# BRIEF — bench-L2-w1: "in play" for turns, speaking seats and state links

Supervisor: bench-L2 (`plans/briefs/BRIEF-bench-L2.md`). Repo `/home/jody/github/serene-pub`. Another worker (w2) is editing prompt/lore/host/SDK files at the same time — never touch its files (listed under "Not yours").

## The ruling you apply (owner, 2026-11-10, RULED)

- **"In play = live and not benched."** A seat is *live* when `removed_at IS NULL`; *benched* when `is_active = false`. Both seat tables now have `is_active` (`session_characters` always did; `session_personas.is_active` is new, migration `0152_overjoyed_magik`, NOT NULL default true, written only by `setSeatBench` in `sessions/seats.ts`).
- The rule applies to: **turns**, **which seat a person speaks as**, the prompt and the lore gate (w2's). **"Sheets, access and names keep reading `removed_at` only."** (design, verbatim). So a benched seat keeps its sheet, its stat values, its name and its history lines — it only leaves turns and is never picked as the speaking seat.
- **Core never benches on its own**; you write no bench, only read it.
- "A benched seat is never picked as the speaking seat."

## The one predicate — already written, use it, never spell the condition again

- SQL: `seatInPlay(table)` exported from `src/lib/server/sessions/seats.ts` — `and(isNull(t.removedAt), eq(t.isActive, true))`, for `schema.sessionCharacters` or `schema.sessionPersonas`. Use it in a `.where(and(eq(...sessionId), seatInPlay(schema.sessionPersonas)))` in place of `isNull(...removedAt)`.
- Pure: `inPlay(row)` from `$lib/shared/sessions/inPlay` (also re-exported from `sessions/seats.ts`). Reads `removedAt`, `isActive` (table row) and `enabled` (the SDK/pipeline read's name for the same bench); absent reads as in play. If you select rows and filter in JS, select `isActive` and filter with `inPlay`.
- Prefer importing from `$lib/shared/sessions/inPlay` in pure/unit-tested modules (`seats.ts` pulls in many imports).
- **No other new names.** If you think you need one (a helper, a field beyond `PlayerSeatLink.isActive`), stop and say so in your report.

## Goal — each reader below, verify and change to "in play"

1. **Turns**
   - `src/lib/server/sessions/turnPlan.ts` ~:124 and ~:138 (character and persona seat queries): `seatInPlay`. (Check what the character query already filters; it may read `isActive` elsewhere — don't double-filter, but make it the one predicate.)
   - `src/lib/server/sessions/fireTurn.ts` ~:160-170: `rows.some((r) => r.personaId === id && !r.removedAt)` → in play (select `isActive`, use `inPlay`).
   - `src/lib/server/pipelines/runtime/speakerRotation.ts`: ~:242 character filter `cc.enabled === true && !cc.removedAt` and ~:257 persona filter `cp.persona && !cp.removedAt` → `inPlay(cc)` / `cp.persona && inPlay(cp)` (these rows are the SDK cast doc, `enabled` carries the bench; w2 makes core fill player seats' `enabled` from `is_active`). Also check ~:130-136 (`live: row.removedAt == null`) — decide whether it is a turn read (then in play) or an identity read (then leave), and say which in your report. Keep the character arm's behaviour for `enabled: undefined` in mind: today it requires `=== true`; `inPlay` treats absent as in play. Note it in the report if any test relied on it.
   - `src/lib/server/pipelines/runtime/dispatchSpeech.ts` ~:427 and ~:472: read the surrounding function first; if it chooses who **speaks/takes a turn**, use `seatInPlay`; if it maps lines already spoken to voices (history/identity), leave `removedAt` and say why.
   - `src/lib/server/pipelines/runtime/runTurn.ts` ~:1800: same test.
   - `src/lib/server/state/resolve.ts` `who.active` (~:2302-2318): verify it already drops benched character seats (`c.isActive`) and excludes personas; change nothing unless wrong.
2. **Which seat a person speaks as**
   - `src/lib/shared/sessions/playerSeat.ts`:
     - `isOwnPlayerSeat` — add in play (`inPlay(seat)` replaces the `seat.removedAt` test). Add `isActive?: boolean | null` to `PlayerSeatLike`.
     - `isLivePlayerSeat` ("whether a seat is anyone's voice") — in play.
     - `ownCardlessPlayerSeats` follows from `isOwnPlayerSeat`.
     - **`isCardlessPlayerSeat` stays a shape test reading `removedAt` only** (it is used by sheets/state: `state/write.ts:1868`, `state/resolve.ts:722`, `bindings.ts`, `portrayals.ts`, `EditSessionForm.svelte`; "sheets, access and names keep reading removed_at only"). Update its and the module's doc comment to say so in one line.
   - `src/lib/server/sessions/seatName.ts` (the speaker pickers only):
     - `cardlessPlayerSeatOf` (~:257): select `isActive` too so `ownCardlessPlayerSeats` sees the bench.
     - `writeSeatName`'s `mine` pick (~:200-205, used when no `playerSeatId` and no retire): a benched seat is never picked. The seats query at ~:170-190 also serves `params.playerSeatId` (naming a specific seat, e.g. the owner renaming a benched seat — a *names* read: leave that path reading `removedAt` only). So: select `isActive` and filter `inPlay` only inside the `mine` pick. Do not touch the retire branch (~:130-160) or `editCardlessPlayerSeats` (~:390+).
   - `src/lib/server/messages/store.ts` `speakerSeatOf` (~:176-250) only: the persona-seat sort at ~:226-232 puts removed seats last; make it in play first, then benched, then removed (select `isActive`). It still returns a benched seat when that is the only one holding the card (a line already spoken stays its speaker's). Keep `departed: seat.removedAt != null` as is (that's the removed sense).
   - `src/lib/server/sockets/sessions.ts` — **one block only**, the send handler's retired-card check at ~:8599-8613 (`held.every((h) => h.removedAt)`): a card whose seats are all out of play (benched or removed) speaks from the person's in-play card-less seat. Select `isActive`, test `held.every((h) => !inPlay(h))`. Update its comment ("has retired" → benched). This is what `sessions.dungeonCrawlerWalk2.int.test.ts` Q0-2 (`:570`) needs. Touch nothing else in that file (w2 owns `getPromptSessionFromDb` in it — edit with `Edit` on your exact block only, never rewrite).
   - `src/lib/server/pipelines/runtime/host.ts` is **w2's** — do not edit it. If `host.ts` ~:2920 (`cardlessPlayerSeatOf` caller) or ~:9269 (retire-by-card lookup) needs a change, list it in your report.
3. **State links** (`src/lib/server/state/resolve.ts`, `sessionLinks` ~:607-760 and the cast-entry build ~:1730-1800):
   - the `voiced` select (~:640): add `isActive: schema.sessionPersonas.isActive`; keep its `removedAt` filter (a benched seat stays in the links, marked).
   - carded persona links (~:751): `isActive: r.isActive !== false` (today hardcoded `true`).
   - `PlayerSeatLink` (~:197): add `isActive: boolean` (doc: "🚧 false = benched (owner 2026-11-10); the seat stays in the links, out of play") and fill it; the card-less player seat cast entry (~:1772) `enabled: seat.isActive` (today `true`). Keep every existing consumer compiling (grep `PlayerSeatLink` / `playerSeats` construction sites in tests and `src/`; if a test builds links by hand, give it `isActive: true`).
   - `who.active`: verify only (above).

## Files owned (edit only these)

- `src/lib/server/sessions/turnPlan.ts`, `src/lib/server/sessions/fireTurn.ts`
- `src/lib/server/pipelines/runtime/speakerRotation.ts`, `dispatchSpeech.ts`, `runTurn.ts` (only the seat reads named above)
- `src/lib/shared/sessions/playerSeat.ts`
- `src/lib/server/sessions/seatName.ts` (the pickers named above only)
- `src/lib/server/messages/store.ts` (`speakerSeatOf` only)
- `src/lib/server/sockets/sessions.ts` (the one send-handler block above only)
- `src/lib/server/state/resolve.ts` (`sessionLinks` voiced/persona/`PlayerSeatLink`, the player-seat cast entry `enabled`)
- tests for these: existing ones you must update, and new ones you add next to them (`*.benched.test.ts` / `*.benched.int.test.ts` or a new `describe` in an existing file)

## Not yours (w2, or other lanes)

`pipelines/prompt/*`, `pipelines/runtime/host.ts`, `getPromptSessionFromDb` in `sockets/sessions.ts`, `client/**`, the SDK repo, `sessions/seats.ts` (the predicate is done; tell me if it is wrong), `NOMENCLATURE.md`, `docs/`, `STYLE-GUIDE.md`. Other sessions are editing nearby (variable layouts; images/vision): **run `git diff <file>` before you edit each file**, and edit with `Edit` on exact regions, never by rewriting a file.

## Tests — Done means

New or updated targeted tests, all green:
- turn plan: a benched player seat (and a benched character seat) is not in the plan (`turnPlan.playerSeats.int.test.ts` or a new one);
- `speakerRotation`: a persona row `enabled: false` is skipped (`speakerRotation.cardless.test.ts` / `speakerRotation.test.ts`);
- `fireTurn`: firing as a persona whose only seat is benched is not seated;
- `cardlessPlayerSeatOf` never returns a benched seat; `writeSeatName` with no `playerSeatId` never names a benched seat; `speakerSeatOf` prefers the in-play seat over a benched one holding the same card;
- `playerSeat.test.ts`: `isOwnPlayerSeat` / `isLivePlayerSeat` false for `isActive: false`; `isCardlessPlayerSeat` unchanged;
- `src/lib/server/sockets/sessions.dungeonCrawlerWalk2.int.test.ts` Q0-2 (`:570`) green; `sessions.dungeonCrawlerWalk100.int.test.ts` stays green;
- existing tests for every file you touched stay green: `turnPlan.*`, `fireTurn.*`, `speakerRotation.*`, `dispatchSpeech.*`, `runTurn.int`, `seatName.mint.int`, `playerSeat.test`, `messages/*` that cover `speakerSeatOf`, `state.seatIdentity.int`, `state.int`, `sessions.playerSeats.int`, `sessions.fireTurn.seatedMember.int`, `sessions.turnControl*.int`.
- Known: `sessions.dungeonCrawlerW3.int.test.ts` A9 (`:542`) stays red until the SDK's Dungeon Crawler `liveSeats` change (w2) is built — the lead builds the SDK later. Run it once and report what it shows; don't chase it.
- Typecheck: `npx tsc --noEmit -p .` clean for your files (filter the output to your paths; other lanes may have errors of their own — report those, don't fix them).

Run vitest only this way, a few files at a time:
`systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
Write long output to a file under `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/` named `bench-L2-w1-*.log` and grep it.

## Stop and ask (in your report, don't decide) when

CLAUDE.md §Decisions applies (behaviour a user sees beyond "benched is out of play", copy, a new name/setting/migration); a change would alter what a **living, in-play** member reads or does; you need a file outside the list.

## Rules (verbatim)

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **never run `npm run sdk:build` at all** — the lead coordinates it.)
- Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently).
- Int tests that open a DB inside an `it` need a 60 s timeout. **Never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs).
- It is a **session**, never a *chat*.
- Scratch files start with `bench-L2-w1-`.

## Report

Return in your final message (don't write a report file): changed files with one line each, tests run with pass/fail counts, the `tsc` result for your files, each "leave vs change" decision you made (dispatchSpeech, runTurn, speakerRotation :130), anything for host.ts (w2) or other files, and **Noticed, not done**.
