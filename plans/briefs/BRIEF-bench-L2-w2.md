# BRIEF — bench-L2-w2: "in play" for the prompt, the lore gate, the cast doc and the Crawler

Supervisor: bench-L2 (`plans/briefs/BRIEF-bench-L2.md`). Repos `/home/jody/github/serene-pub` and SDK sibling `/home/jody/github/serene-pub-sdk`. Another worker (w1) is editing turn/speaker/state files at the same time — never touch its files (listed under "Not yours").

## The rulings you apply (owner, 2026-11-10, RULED — verbatim where quoted)

- **"In play = live and not benched."** Live: `removed_at IS NULL`. Benched: `is_active = false`. Both seat tables have `is_active` now (`session_personas.is_active` is new, migration `0152_overjoyed_magik`, NOT NULL default true).
- **Benched is the one lore rule** (★1): "Probably benched is the one rule, except seat to benched is something managed by the genre/pipelines, not automatically by core." A benched member reads as **background** (the narrator reads its lore); a seat in play reads as seated.
  - **Retire hist-G's deceased arm:** `characterLore.ts` no longer reads `nodeState`; a deceased member whose seat is in play reads normally (owner: dragging back "treats them normally").
  - **Core never benches on its own:** no automatic bench, no "nudge".
- **Prompt:** "Benched and fallen characters leave the prompt's characters block entirely, except the speaker." "Benched personas leave the names list, likenesses and the persona block."
- **A removed or benched player seat no longer unlocks its member's lore** anywhere (the departed-player-seat bug: the persona arm ignored `removedAt`).
- **SDK cast doc:** `SessionCastV1.sessionPersonas[].enabled` — documented today as "always true" — core fills it from `is_active`. `characters.v1` flags benched personas `benched: true`. The Crawler's `liveSeats` filters `enabled !== false`.
- "Sheets, access and names keep reading `removed_at` only." Don't change a sheet/identity read.

## The one predicate — already written, use it, never spell the condition again

- SQL: `seatInPlay(t)` from `src/lib/server/sessions/seats.ts` = `and(isNull(t.removedAt), eq(t.isActive, true))`. `t` is a table (`schema.sessionPersonas`) **or the fields object a drizzle relational `where: (cp, ops) => …` callback hands you** (use `seatInPlay(cp)` there, never the unaliased schema table inside a relational query).
- Pure: `inPlay(row)` from `$lib/shared/sessions/inPlay` (pure modules like `characterLore.ts` / `promptFields.ts` import it from there, not from `seats.ts`). Reads `removedAt`, `isActive` (table row) and `enabled` (the pipeline read's name for the same bench); absent reads as in play.
- **No other new names.** If you need one, stop and say so in your report.

## Goal

1. **Lore gate** — `src/lib/server/pipelines/prompt/characterLore.ts` `isCharacterLoreEntryVisible` (~:115-180):
   - the persona arm (`playerSeat`, ~:159) counts only player seats in play: `inPlay(cp) && (…)`. Add `removedAt?`/`isActive?` to the `LoreGateSession.sessionPersonas` row type if missing.
   - **delete** the deceased arm (`nodeState === "deceased"`, ~:164-167) and rewrite the function's doc comment (~:115-126) to the new single rule (benched → background; deceased in play reads normally).
   - `seatedMemberIds` semantics stay (background = not in it); the host fills it from seats in play (below).
2. **Host lore read** — `src/lib/server/pipelines/runtime/host.ts` ~:4525-4670 only:
   - remove the `nodeState: read?.nodeState` hydration (~:4538-4543) and its comment (check `read?.nodeState` has no other reader there first).
   - `seatRows` select (~:4565): add `isActive: schema.sessionCharacters.isActive`.
   - `asSession.sessionPersonas` (~:4628): pass `isActive: cp.isActive` beside `removedAt`.
   - `seatedMemberIds` (~:4636-4660): every `removedAt == null` filter on both tables becomes `inPlay(r)` / `inPlay(cp)`, and update its ★4 comment ("a live seat" → "a seat in play").
   - Leave the co-occurrence `bindingCharacter` / `seated` set as is unless it is clearly a "who is seated" read; say what you decided.
3. **Host, other seat reads** (also `host.ts`):
   - `liveCastRefs` (~:655-725: "every reference that may hold a turn"): both seat queries → `seatInPlay`. Update its doc ("Removed seats" → "seats out of play").
   - `session_cast` (~:5150-5800): the player-seat select (~:5253) adds `enabled: schema.sessionPersonas.isActive` (R5: `is_active` → `enabled` at this seam, as the character select does at ~:5198); the output (~:5790) `enabled: cp.enabled !== false` instead of hardcoded `true`, and its comment ("A persona seat has no switch; it is always taking part") rewritten to the bench. Every seat still goes out (benched ones with `enabled: false`); readers filter. Update the case's doc block (~:5162-5170) to say player seats carry the bench too.
   - ~:9269 (`set-seat-name` retire-by-card lookup): a benched seat is already out of play, so retiring it again is no seat: `seatInPlay`. If reading the flow shows that would break a retire, leave it and say why.
   - ~:2920 (`cardlessPlayerSeatOf` caller): verify only (w1 makes `cardlessPlayerSeatOf` in-play).
   - Touch nothing else in `host.ts` (it is a shared file).
4. **Prompt** — `src/lib/server/pipelines/prompt/promptFields.ts` (~:360-450):
   - the characters block (~:390-398) compiles only character seats in play, **plus the speaker always** (`isSpeaker(cc)` keeps a benched speaker in full).
   - names (~:410-416) and likenesses (~:430-435) already drop `enabled === false` character seats — use `inPlay` there; do the same for **player seats**: `personaNames`, persona likenesses, and the persona block (find where `{{user}}`/the viewer's own persona description is picked from `sessionPersonas` in this file or its helpers in `pipelines/prompt/`; a benched persona never fills it). The simplest correct shape may be one `inPlay` filter where `sessionPersonas` is first read (~:371); check no speaker/identity read below needs the benched ones before you do it.
   - `src/lib/server/sockets/sessions.ts` `getPromptSessionFromDb` (~:2145-2260) only: its `sessionPersonas` relational `where` (~:2207) becomes `seatInPlay(cp)`; `sessionCharacters` keeps reading benched seats (full rows carry `isActive`; `promptFields` filters, keeping the speaker). Update the comment above it. Check both callers (~:8537 send, ~:10231 token count) don't need a benched persona from it.
5. **`characters.v1`** — `src/lib/client/components/sessionPage/projections/characters.ts` ~:467: `seat(link, link.persona, true, link.isActive === false, link.seatName ?? null)`; add `isActive?: boolean | null` to the `sessionPersonas` row type (~:90). Verify `sessions:get`'s payload carries `isActive` on player seats (a full-row relational read does); say so. Update the doc comment at ~:431-435.
6. **SDK (source only — never build)**:
   - `/home/jody/github/serene-pub-sdk/sdk/src/participants.ts` ~:465: `SessionCastV1.sessionPersonas[].enabled` doc: "🚧 The seat is in play: false = benched (owner 2026-11-10). Every seat is here, benched or not; a reader that must not see a benched one — a turn pool, a names list — filters on this (the table's column is `is_active`)." Type stays `boolean`. Also fix the summary doc above (~:385) if it says personas always ride enabled.
   - `/home/jody/github/serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/preamble.ts` `liveSeats` (~:202): `if (seats[i] && !seats[i].removedAt && seats[i].enabled !== false)`; update its doc line at ~:89 ("every seat not removed" → in play, not removed and not benched). It's ES5 inside a template string — keep the style (`var`, no arrows); check escaping.
   - Check other `core-catalog` readers of `sessionPersonas` that choose a turn/speaker (grep `sessionPersonas` in `core-catalog/src` — the turn pool, rotation, Lair, Story): if one filters `removedAt` but not `enabled` for player seats, list it in your report (**do not edit it** — an SDK change beyond the two named needs the owner).
   - **Don't run `npm run sdk:build`, `npm test` or `npm run build` at the SDK root.** Test from source: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test <file>` (e.g. add a case to `seatCastScripts.test.ts`, which imports `DUNGEON_CRAWLER_PREAMBLE` from source: a benched seat (`enabled: false`) is not in `liveSeats`/`seatOf`). Run `dungeonCrawler*.test.ts` and `seatCastScripts.test.ts` from source.

## Files owned (edit only these)

- `src/lib/server/pipelines/prompt/characterLore.ts`, `promptFields.ts` (+ helpers in `pipelines/prompt/` only if the persona block lives there — name them in your report)
- `src/lib/server/pipelines/prompt/characterLore*.test.ts`, `promptFields*.test.ts`
- `src/lib/server/pipelines/runtime/host.ts` (only the regions in 2 and 3)
- `src/lib/server/sockets/sessions.ts` (`getPromptSessionFromDb` only)
- `src/lib/client/components/sessionPage/projections/characters.ts` (the one line + type + comment) and its `characters.test.ts`
- SDK: `sdk/src/participants.ts` (the doc), `core-catalog/src/genres/dungeon-crawler/preamble.ts` (`liveSeats` + doc line), `sdk-tests/seatCastScripts.test.ts` (new case)
- new host tests if you need them (`pipelines/runtime/host.*.int.test.ts` style)

## Not yours (w1, or other lanes)

`sessions/turnPlan.ts`, `fireTurn.ts`, `speakerRotation.ts`, `dispatchSpeech.ts`, `runTurn.ts`, `shared/sessions/playerSeat.ts`, `sessions/seatName.ts`, `messages/store.ts`, `state/resolve.ts`, the send handler block in `sockets/sessions.ts` (~:8585-8615, w1 edits it), `sessions/seats.ts` (the predicate is done; tell me if it is wrong), `NOMENCLATURE.md`, `docs/`, `STYLE-GUIDE.md`. Other sessions are editing nearby (variable layouts; images/vision) and `host.ts`, `sockets/sessions.ts`, `characters.ts` all carry their uncommitted work: **run `git diff <file>` before you edit each file**, and edit with `Edit` on exact regions, never by rewriting a file.

## Tests — Done means

- **Replace** `src/lib/server/pipelines/prompt/characterLore.deceased.test.ts` (hist-G's, untracked) with the new matrix — rename it `characterLore.benched.test.ts` (delete the old file; it is untracked, `rm` it by name): (a) a member whose seat is in play → its own seat reads its lore, the narrator doesn't; (b) benched → the narrator reads it, its own seat doesn't; (c) a member with a `deceased` `nodeState` whose seat is in play → its own seat reads it (the binding's `nodeState` is ignored); (d) a removed player seat and (e) a benched player seat do not unlock their member's lore for anyone (and the narrator reads it as background once `seatedMemberIds` lacks it).
- a `promptFields` test: a benched character's card leaves the characters block and the names; a benched speaker keeps its card in full; a benched persona leaves `personaNames`, likenesses and the persona block.
- `characters.test.ts`: a benched player seat is listed `benched: true`.
- SDK from source: the new `seatCastScripts.test.ts` case + the existing `dungeonCrawler*.test.ts`, `seatCastScripts.test.ts` green.
- existing tests green: `src/lib/server/pipelines/prompt/*` (all files in that dir), `src/lib/server/pipelines/runtime/*seat*` tests, `loreMatch.seatedMember.int`, `pipelines.portrayalsSeated.int`, `sessions.promptTokenCount.cardless.int`, `characterLoreBand.test`.
- Typecheck: `npx tsc --noEmit -p .` clean for your files (filter to your paths; report others' errors, don't fix them).

Run vitest only this way, a few files at a time:
`systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files>; echo test-exit=$?'`
Write long output to a file under `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/` named `bench-L2-w2-*.log` and grep it.

## Stop and ask (in your report, don't decide) when

CLAUDE.md §Decisions applies (user-visible behaviour beyond the rulings above, copy, a new name/setting/migration); a change would alter what a **living, in-play** member reads or does; an SDK change beyond the two named; you need a file outside the list.

## Rules (verbatim)

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this lane: **never run `npm run sdk:build` at all** — the lead coordinates it.)
- Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file.**
- Inside `db.transaction(async (tx) => …)` use only `tx`. `$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`.
- Int tests that open a DB inside an `it` need a 60 s timeout. **Never pipe vitest into `head`.**
- It is a **session**, never a *chat*.
- Scratch files start with `bench-L2-w2-`.

## Report

Return in your final message (don't write a report file): changed files in both repos with one line each, "SDK edits ready for build" with the list, tests run with pass/fail counts, the `tsc` result for your files, each leave-vs-change decision (co-occurrence set, :9269, the persona block's location), any SDK readers you found but didn't edit, and **Noticed, not done**.
