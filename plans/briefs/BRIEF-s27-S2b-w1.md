# BRIEF s27-S2b-w1 — "Everything in session is cast -> active card": remove `overCards`, ownership by the active card

App: `/home/jody/github/serene-pub` (SvelteKit 5, TS, Vitest 4, Drizzle + PGlite). You are a `lane-worker` in lane **s27-S2b**. Read **`plans/briefs/BRIEF-s27-S2b-RULES.md` first, in full** — it is part of this brief. Verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## The ruling (owner, 2026-11-05, late — quote it in every test you change)
> **"Everything in session is cast -> active card."** Every session reader resolves the seat's **cast member**, then that member's **active card on the timeline** (the dated card at the session's reading, `castMemberAt` without `keepCard`). This **replaces the lead's S2 rule "a seat reads the card it holds"** (`overCards`) — prompt, greetings, names, faces, voice, sprites, ownership ("own" = the active card's owner), "can act", fire-turn, access, lists and payloads.

Background: `cast/memberAsRead.ts` `membersAsRead(db, memberIds, { sessionId })` already resolves each member on the session's reading and layers it over its ACTIVE card (`MemberAsRead.activeCardId`; `cardless` when the reading draws the member with no card). S2 added the option `overCards` (member id → the seat's card) so a seat read the card it held; it was carried through "batches" so two seats on one member holding different cards read separately. The ruling removes that: every reader reads the member over its active card, period. Two seats on one member now read the same thing, so **batches go too** (one `membersAsRead` call with the unique member ids).

## Goal (in order)
1. **`src/lib/server/cast/memberAsRead.ts`**: delete the `overCards` option (interface field + its doc + the `opts.overCards?.has(...)` application ~394). Header comments that mention it go.
2. **Every caller drops `overCards`** (and any batches built only for it), in:
   - `cast/seatedCast.ts` `seatedCastOf` — one `membersAsRead` call; fix the header/comments ("layered over its active card").
   - `pipelines/prompt/seatCards.ts` — `seatMembersAsRead`: one `membersAsRead` call over the unique member ids (keep the stored-member trust + `findSeatMembers` logic exactly). Fix the header and the doc comments that say "over the card the seat holds" / `keepCard`.
   - `sessions/rowProjection.ts` `seatMembersAsReadForSessions` (~313–470): drop the batches (it must still equal `seatMembersAsRead` per session — a parity test guards that). **Only that function's hunk** in this file — another worker edits other hunks of `rowProjection.ts` at the same time (persona seats in `castNames`/`castFaces`); re-read before each edit.
   - `speech/resolveVoice.ts` (~144), `pipelines/runtime/dispatchSpeech.ts` (~367), `state/write.ts` (`sealerName`, ~650), `state/handEdits.ts` (~90: batches keyed `${id}:${cardId}` → key by what the callers need; keep behaviour otherwise), `state/resolve.ts` (uses `seatedCastOf`; check nothing there relies on the seat's card being the read card), `sockets/state.ts` (~490, ~861), `rulesets/ties.ts` (~1247, ~1770), `rulesets/zones.ts` (~221), `sessions/seatName.ts` (`seatCardOwner`), `sessions/seatPortrait.ts` (~88). `sprites/choices.ts` ~141 only has a comment saying "No `overCards`, on purpose" — reword it to not name a removed option (one line).
   - After you finish: `grep -rn overCards src` must return nothing.
   - In each, read the surrounding logic: where code compared `activeCardId` to the seat's card or assumed the read card **is** the seat's card, make it follow `activeCardId` (that is the ruling). Comments that say "a seat reads the card it holds" are rewritten to the ruling.
3. **`seatCardAsRead` (`pipelines/prompt/seatCards.ts`)**: drop the guard "leaves the card unchanged unless `activeCardId` is this card". New rule: the member is layered over **its active card** even when the seat holds another card.
   - When `asRead.activeCardId === card.id` (the common case): exactly today's behaviour (only the differing name/nickname and the member's own retold fields are written; same object back when nothing differs).
   - When `asRead.activeCardId !== card.id` (the reading draws the member with another card, or with none — `cardless`): write **every** field the card row carries under these names from `asRead` — `name`, `nickname`, `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `exampleDialogues`, `groupOnlyGreetings` — because `asRead` already holds the active card's values for the fields the member doesn't retell; set `strokes = null` (the held card's strokes describe the held card, not the active one). Keep `id` and every other key (the keys-stay rule: the row's `id` is still the seat's card id, refs emitted stay `character:<seatCardId>`). Update its doc comment.
4. **Ownership ("own" = the active card's owner):**
   - `src/lib/server/messages/permissions.ts` `ownsSeatedCard` (~69–85): judge by the owner of the seat member's `activeCardId` (`memberAsRead(db, seat.castMemberId, { sessionId })`). Seat with no member → the seat's card (today). **Member read is cardless on this reading (no active card) → the seat's card** (lane decision, flagged to the owner). No seat → the message's own card (today).
   - `src/lib/server/sockets/sessions.ts` fireTurn `ownsIt` hunk (~10066–10102, starts at `let ownsIt = false`): same rule. **Only this hunk** of `sockets/sessions.ts` — another worker edits other hunks concurrently; re-read the hunk right before editing.
   - Use a dynamic `await import("$lib/server/cast/memberAsRead")` where the file already imports seat helpers dynamically.

## Tests
Change the tests that pinned "a seat holding a dated card reads that card" to the ruling — edit them in place (rename the test to the new rule), quote the ruling in a comment, assert the **active (dated) card**'s values. Known ones (grep for more: `grep -rn -i "card it holds\|holding a dated\|overCards" src --include=*.test.ts`):
- `cast/memberAsRead.int.test.ts` (~207 overCards case → delete the option case, or turn into "the dated card draws the member" if not already covered; ~422 "each seat reads its member over the card the seat holds, two seats on one member included" → each seat reads its member over the active card; two seats on one member read the same)
- `state/seatMember.int.test.ts` (~473 describe "a seat reads the card it holds…")
- `speech/memberVoice.int.test.ts` (~266)
- `sessions/rowProjection.seatCast.int.test.ts` (~271), `sessions/rowProjection.batch.int.test.ts` (parity / batches)
- `pipelines/prompt/seatCards.int.test.ts` (~244), `pipelines/prompt/seatCards.test.ts` (pure `seatCardAsRead` cases — add: member over a different active card writes every field and nulls strokes, keeps `id`; cardless member writes its own fields)
- `pipelines/runtime/host.seatMembers.int.test.ts` (~234)
- `pipelines/runtime/datedCardLore.int.test.ts` — run it; edit only if it moves.
New tests: ownership — a guest owning the **dated (active) card** of a seat's member can act on that seat's message (`messages/permissions` — find its existing int test with `grep -rln "canActOnMessage" src --include=*.test.ts`) and the seat-card owner cannot once the clock draws the dated card; a seat with no member still judged by its card.

Run, at the end, these suites (a few files per `npx vitest run` call): `src/lib/server/cast/`, `pipelines/prompt/seatCards*`, `sessions/rowProjection*`, `sessions/seatName*` / `seatPortrait*` tests if any, `speech/memberVoice.int.test.ts` + `speech/` resolveVoice tests, `state/seatMember.int.test.ts`, `state/handEdits.int.test.ts`, `state/write.int.test.ts`, `state/resolve.int.test.ts`, `rulesets/` tests touching ties/zones (`grep -rln "ties\|zones" src/lib/server/rulesets --include=*.test.ts`), `sockets/state*.int.test.ts` that mention a seat member, `pipelines/runtime/host.seatMembers.int.test.ts`, `datedCardLore.int.test.ts`, `dispatchSpeech` tests, the permissions tests, `sockets/sessions.*` tests that cover fire turn (`grep -rln "fireTurn\|fire-turn\|sessions:fireTurn" src --include=*.test.ts`). Then `npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must print nothing.

## Files owned (edit only these)
`src/lib/server/cast/{memberAsRead,seatedCast}.ts`, `pipelines/prompt/seatCards.ts`, `sessions/rowProjection.ts` (the `seatMembersAsReadForSessions` hunk only), `speech/resolveVoice.ts`, `pipelines/runtime/dispatchSpeech.ts`, `state/{write,handEdits,resolve}.ts`, `sockets/state.ts`, `rulesets/{ties,zones}.ts`, `sessions/{seatName,seatPortrait}.ts`, `sprites/choices.ts` (one comment line), `messages/permissions.ts`, `sockets/sessions.ts` (fireTurn `ownsIt` hunk only), and the test files named above plus new test files next to these modules.
## Files readable
Anything. Especially `state/entriesOnReading.ts` (header: `keepCard`, `castMemberAt`), `sessions/seats.ts` (`seatOf`).
## Out of scope
Persona/player-seat readers (another worker), access (`utils/sessionAccess.ts`, `media/access.ts`, `conversations/store.ts`, `sessions/backdrop.ts`, the visibility handler — a later worker), `illustrateScene.ts`, `jump.ts`, NOMENCLATURE.md, docs, any client file, the SDK.
## Stop and ask when
A reader whose output a user sees would change beyond "the dated card instead of the held card" · you would need a new exported name · a test outside the known list changes and you are not sure it is this ruling.
## Done means
`grep -rn overCards src` empty; the listed suites green (changed tests listed old → new); tsc clean on your files. Report as your final message (see RULES).
