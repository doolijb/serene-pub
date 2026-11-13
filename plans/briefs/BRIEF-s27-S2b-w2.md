# BRIEF s27-S2b-w2 — ★pT-1 "a persona seat reads its cast member like every seat" (server)

App: `/home/jody/github/serene-pub` (SvelteKit 5, TS, Vitest 4, Drizzle + PGlite). You are a `lane-worker` in lane **s27-S2b**. Read **`plans/briefs/BRIEF-s27-S2b-RULES.md` first, in full** — it is part of this brief. Verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## The rulings (owner, 2026-11-05, late — quote the relevant one in every test you change)
> **★pT-1 → a persona seat reads its cast member like every seat.**
> **"Everything in session is cast -> active card."** Every session reader resolves the seat's cast member, then that member's active card on the timeline (the dated card at the session's reading).

Plus the standing state-lane rule: **a player seat's seat name (`session_personas.seat_name`) still wins over the member's name**, as today (`withSeatName` in `sessions/seatName.ts`).

## Background
Stage S2 moved every **character** seat onto its cast member: `pipelines/prompt/seatCards.ts` `seatCardsAsRead(db, sessionId, rows)` takes rows `{ castMemberId, character: <card row> }` and returns them with `character` filled from the seat's member as read (own name/nickname, each retold text field the member tells; seats with no stored member read the member the seat writer would find for the card; none → the card as is). `seatMembersAsRead(db, sessionId, rows)` returns the `MemberAsRead` per row instead (for faces: `faceMediaId`, `shownName`). **Player seats were left on their card** (open ★pT-1, now ruled yes). A player seat is a `session_personas` row: `personaId` (its card, may be null — a card-less player seat), `castMemberId`, `seatName`, `position`, `removedAt`, `id`.
Another worker (w1) is concurrently changing the INSIDE of `seatCards.ts` so members are read over their active card (no signature change). **Do not edit `seatCards.ts`**; use `seatCardsAsRead` / `seatMembersAsRead` as they are, passing persona rows as `{ castMemberId: cp.castMemberId, character: cp.persona }` (map back to `persona` after). If you think you need a persona helper form there, stop and ask (Questions).

## Goal — switch these player-seat reads onto the member, seat name applied AFTER (so it still wins)
1. `src/lib/server/pipelines/runtime/host.ts` — the `session_cast` read (~4746–5175): `sessionPersonas` rows go through `seatCardsAsRead` like `castRows` do (~4820); then `withSeatName(cp.persona, cp.seatName)` (~5171) as today. Fix the comment at ~4810–4818 ("Player seats keep their card"). Only this hunk of host.ts.
2. `src/lib/server/sockets/sessions.ts` — **only these hunks** (re-read each right before editing; another worker edits the fireTurn hunk ~10070 concurrently):
   - `getPromptSessionFromDb` (~1815–1960): persona seats read like `session.sessionCharacters` are (~1942–1955).
   - the typing persona name (~630–670, `personaName: persona.name`): the member's shown name, seat name winning.
   - `sessions:update` player-seat `removedName` (around ~6475–6530; the character-seat removal already uses `seatCardsAsRead`): player seats' `removedName` from the member as read, seat name winning.
   - `withSessionExtras` (~5129–5175): `castNames` / `castFaces` (and `castSpriteSets` if it falls out naturally) also cover persona seats. **Keep the map shape** (keyed by the seat's card id); add persona seats' card ids; when one card is held by a character seat and a persona seat, the character seat's entry wins (seatOf's order). Card-less player seats (no `personaId`) add nothing (they have no card id key).
3. `src/lib/server/sessions/rowProjection.ts` — the sessions-list payload maps (`castNames`/`castFaces`, ~140–215 and ~560–640, `seatCastShownFrom`): cover persona seats too, same key rule. **Do not edit `seatMembersAsReadForSessions`** (~313–470) — w1 is editing that function concurrently; re-read before each edit.
4. `src/lib/server/sessions/greetings.ts` — the greeting's `{{user}}` (the persona's name): the member's name, seat name winning.
5. `src/lib/server/pipelines/runtime/dispatch.ts` `loadAdapterSession` (~440–460): `sessionPersonas` through `seatCardsAsRead`, then `withSeatName`.
6. Rosters and names: `sessions/turnPlan.ts` (~120–150: player names `names(p.seatName, p.name, p.nickname)` → seat name, then the member's name/nickname as read), `scenes/liveScenes.ts` (~874), `utils/summarizer/availableSceneCast.ts` (~399), `conversations/gate.ts` (~198). Where a site has the persona SEAT rows in hand, read them with `seatCardsAsRead` / `seatMembersAsRead` (rows with the seat's `castMemberId`). Where it only has persona card ids, select the seats' `castMemberId` for them (live before departed, then position, then id).
7. Emitted refs and keys stay (`character:<personaId>`, `player-seat:<id>`); only names/texts/faces change.

## Tests
- Existing tests whose value changes because of this ruling: edit with the ruling quoted, list each **old → new** in your report. Known: `pipelines/runtime/host.seatMembers.int.test.ts` ~308 ("…a player seat carries its member and keeps its card" → reads its member); the promptText w1 test "(f)" pinning player seats on their card (grep `grep -rn -i "player seat\|persona" src/lib/server/pipelines/prompt/seatCards*.test.ts src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts src/lib/server/sessions/greetings.seatMembers.int.test.ts`). Any other existing test that changes: say why.
- **New tests** (int tests with 60 s timeouts; follow the fixtures in `host.seatMembers.int.test.ts`, `greetings.seatMembers.int.test.ts`, `rowProjection.castNames.int.test.ts`): a persona seat whose member has its own name (`own_name`) and a retold description — (a) the host `session_cast` read / `getPromptSessionFromDb` shows the member's name and description; (b) the greeting's `{{user}}` is the member's name; (c) the sessions-list `castNames` and `withSessionExtras` `castNames` include the persona card → member's name; (d) the turn plan roster names it; (e) **a seat name still wins** over the member's own name in (a), (b), (d).
- Run your files' suites: `host.seatMembers.int`, `greetings*`, `rowProjection*`, `turnPlan*`, `liveScenes*`, `availableSceneCast*`, `conversations/gate*`, `dispatch*` (loadAdapterSession), the `sockets/sessions.*` tests that cover typing / update removal / `sessions:get` payload (find with grep), plus your new tests. `npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` prints nothing.

## Files owned (edit only these)
`pipelines/runtime/host.ts` (the session_cast persona hunk), `pipelines/runtime/dispatch.ts`, `sockets/sessions.ts` (the four hunks above), `sessions/{greetings,turnPlan,rowProjection}.ts` (rowProjection: not `seatMembersAsReadForSessions`), `scenes/liveScenes.ts`, `utils/summarizer/availableSceneCast.ts`, `conversations/gate.ts`, their test files and new test files beside them. All paths under `src/lib/server/`.
## Out of scope
`seatCards.ts`, `cast/**`, ownership/access, `illustrateScene.ts`, `jump.ts`, client code (another lane applies `castNames` to personas on the client), NOMENCLATURE.md, docs, the SDK, objects handed to plugins (e.g. SDK `SessionCharacterV1`) — if a plugin-facing object would change shape, stop and ask; changed *values* (names) inside existing fields are the ruling.
## Stop and ask when
A user-visible string other than a name/text/face changes · a plugin-facing type would change · you need a new exported name · two readings of a site.
## Done means
All listed sites switched (or reported why not); new tests green; existing suites green with changes listed old → new; tsc clean on your files. Report as your final message (see RULES).
