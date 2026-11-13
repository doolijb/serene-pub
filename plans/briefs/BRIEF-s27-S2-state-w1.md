# BRIEF s27-S2-state-w1 — SessionLinks, names and ownership read the seated member; state sockets accept a seated member

Lane **s27-S2-state** (supervisor: Opus), worker **w1** (Sonnet, `lane-worker`). App `/home/jody/github/serene-pub`. Another worker (w2) edits the rulesets files, `bindings.state.ts`, `stateTools.ts`, `state/statTrail.ts`, `sockets/statTrail.ts`, `sessions/{seatPortrait,seatName,convertRuleset}.ts` at the same time — don't touch those. Two other lanes edit `pipelines/runtime/**` (except bindings.state/stateTools), `pipelines/prompt/**`, `speech/**`, `sprites/**` — don't touch.

## Goal
The state module reads who a seated character **is** (name) from the seat's cast member as read, and who **owns** a seat from the member's active card read over the seat's card — with stored keys (`session_cast:<cardId>`, `player_seat:<seatId>`, `state.cast.byId[<cardId>]`) unchanged. Socket owners may arrive as 🚧 `{ kind: "seated_member", id }` and are translated at the door.

## Files owned (the only files you may edit)
- `src/lib/server/state/resolve.ts`
- `src/lib/server/state/write.ts` (only the `sealerName` hunk ~623–647 and imports)
- `src/lib/server/state/handEdits.ts`
- `src/lib/server/sockets/state.ts`
- `src/lib/server/state/worldScope.ts`, `src/lib/server/state/cardState.ts`, `src/lib/server/state/declarations.ts` (check; edit only if a site takes a seat's name/identity from a card)
- New test files: `src/lib/server/state/seatMember.int.test.ts` (and, if you need one, `src/lib/server/state/seatRefs.int.test.ts` for the supervisor's helper).
## Files readable
Everything; in particular `src/lib/server/cast/{memberAsRead,seatedCast}.ts`, `src/lib/server/sessions/seats.ts` (`seatOf`), `src/lib/server/state/seatRefs.ts`, `src/lib/server/cast/memberAsRead.int.test.ts` (fixtures: cards, books, members with `ownName`, seats).

## Items
1. **`sessionLinks` (`state/resolve.ts` ~557–700).**
   - Keep the two seat queries (they mean "live seats now" and carry `isActive`, `seatName`, `userId`, `position`); add the seat's id and its stored `cast_member_id` to each.
   - Take each seat's member as read from **one** `seatedCastOf(db, sessionId)` call (it does the `overCards` batching, so two seats on one member each read over their own card), matched by `(kind, seatId)`. Skip the call when no seat has a member.
   - `CastMemberLink.name`: a character seat → `asRead.name` when the seat has a member, else the card's name as today; a carded player seat → `coalesce(seatName, asRead.name ?? card name)` (the seat name still wins, as today).
   - ⚠ **R1 collision — do not change `CastMemberLink.castMemberId`.** It already exists and means *the attached book's member*, found by card (`castMemberCards(...).memberOf`), and it routes durable `cast_member` values (`chainFor`, `owners.ts`, `lorebookState.ts`, `durable.ts`; NOMENCLATURE §25: "⚠ `castMemberId` still means the attached book's member"). A stored seat member can sit in the own book, or (after an attach, since a fill never clears) in another book, so redefining it would move durable values. Instead add 🚧 **`seatMemberId?: number | null`** to `CastMemberLink`: the seat's stored `cast_member_id` (character seat: `session_characters.cast_member_id`; carded player seat: `session_personas.cast_member_id`), with a doc comment "⚠ Not `castMemberId` (the attached book's member, which routes durable values)". Fill it for every entry. (The supervisor records the name in §25 and raises it to the lead.)
   - `PlayerSeatLink` (card-less player seats) unchanged (no member in S2).
   - Two seats on one member with different cards stay two entries (they have different `characterId`s); dedupe stays by `characterId`.
2. **`nextTurn` (`resolve.ts` ~2216–2230)** parses the head turn entry's ref: also accept `seated-member:<memberId>` (→ `seatOf(db, sessionId, ref)` → the seat's `cardId`; null when no card). `character:<id>` path unchanged. **`personaOf` (~2180)**: "which persona an asking user voices" by the card's owner — ownership; switch it to the member's `activeCardId` read over the seat's card when the seat has a member (same card as today), else the card as today. If that makes no observable difference and adds queries, you may leave it and say why in the report (decision, named).
3. **`sealerName` (`write.ts` ~623–647)** — the turn owner's name in the "that reply is sealed: ‹name› has spoken since" refusal. `speakerId` is a card id (the `session_cast` owner id, or the message's speaker card). Resolve the seat with `seatOf(db, sessionId, \`character:${speakerId}\`)` (add `sessionId` to the function's parameters; its caller `anchorFor` has `ctx.sessionId`); when the seat has a member, the name is `memberAsRead(db, castMemberId, { sessionId, overCards: new Map([[castMemberId, seat.cardId]]) })?.name`; else the card's name as today; else "someone".
4. **`handEdits.ts` (~176–330).**
   - The player seat rows' `cardName` and the `characters` map's `name`: read through the member as read (one `membersAsRead` batch per distinct seat card; use the seats' stored `cast_member_id` — add it to the seat query; for cast characters use `links.cast[].seatMemberId` from item 1) with `overCards` = the seat's card; fall back to the card's name when no member.
   - Ownership (`cardOwner`, `characters.get(id).userId`): the owner of the member's `activeCardId` read over the seat's card (= the seat's card) — when no member, the card as today. Behaviour for today's data must not change.
   - **Rename the local `seatOf` closure** (~257) to `playerSeatOf`: it maps a state owner to the *player seat that plays it*, which is not the shared `sessions/seats.ts` `seatOf(tx, sessionId, ref)` (a ref to its seat). R1 — one name, one meaning. Update its three callers.
5. **`sockets/state.ts`.**
   - **Owners at the door:** wherever a handler reads an owner from the client (`owner(...)` helper used by `state:set` / `state:configure` ~1322/1419; `state:setOwnerFace` ~1271; `state:givePiece` from/to ~1549; `state:showTieSide` ~1624; `state:setCarry` ~1810; the value-heard helper ~268 — find them all), translate a `{ kind: "seated_member", id }` with `storedSeatOwner(db, sessionId, raw)` **before** the existing validation; null → the handler's existing "not in this session" style refusal (reuse an existing sentence; don't invent copy — if none fits, report it as ★ and use the closest existing one). `state:showTieSide`'s kind check must then see the stored kind.
   - **Names:** the ledger's `seatOf` Map (~815) names a `player_seat` owner by `seatName || cardName`; switch `cardName` to the member as read (seat's stored `cast_member_id`, `overCards` = the seat's card), card name when no member, and **rename the Map** to `seatLabelOf` (R1: not the shared `seatOf`). Any other place in this file naming a seat from `characters.name` (grep it) likewise.
   - **Ownership:** `ownSeatsOf` (~442) decides a viewer's seats by `userId ?? cardOwner`: `cardOwner` from the member's `activeCardId` read over the seat's card when the seat has a member, else the card as today. `seatCardsOf` reads stored keys only — leave it.
   - `castMemberOf` (~275) and `chainOf` (~419) use `CastMemberLink.castMemberId` (attached book's member, routes durable values) — leave them.
6. **`worldScope.ts`, `cardState.ts`, `declarations.ts`:** the inventory lists `worldScope.ts` ~45–88 (player seat → `session_cast(personaId)`: a stored-key mapping — keep), `cardState.ts` ~116 / ~336–345 and `declarations.ts` ~866 (the **`card`** owner kind's owner — the card editor's own values — and the sessions seating a card for a re-read: stored keys). Expected: no change. Confirm by reading, and list each with the reason in your report. `worldScope.ts`'s `ownBookMemberOf` (mints an own-book member for a card) is a writer — leave it and note it.

## Tests (Done means)
- Existing, unchanged and green: `src/lib/server/state/write.int.test.ts`, `src/lib/server/state/handEdits.int.test.ts`, `src/lib/server/state/worldScope.int.test.ts`, `src/lib/server/state/resolve.int.test.ts`, `src/lib/server/state/write.ownerGone.int.test.ts`, `src/lib/server/sockets/state.int.test.ts`, `src/lib/server/sockets/state.ownerScope.int.test.ts`, `src/lib/server/sockets/state.earshot.int.test.ts`, `src/lib/server/sockets/state.ledger.int.test.ts`, `src/lib/server/sockets/state.attributes.int.test.ts`, `src/lib/server/sockets/cardState.int.test.ts`, `src/lib/server/state/declarations.int.test.ts`. Run them in two or three batches, not all at once.
- New `src/lib/server/state/seatMember.int.test.ts` (60 s timeouts; fixtures modelled on `cast/memberAsRead.int.test.ts`; seats written with `sessions/seats.ts` `seatCast` / `seatPlayer` or direct inserts that set `cast_member_id`):
  a. a seat whose member has `ownName` → `sessionLinks(...).cast[i].name` is the own name, `seatMemberId` is the member, `castMemberId` unchanged (attached book's member), `characterId` the card; `stateFor`'s `state.cast.byId[<cardId>]` exists under the card id with that name;
  b. a seat with no member → the card's name (as today);
  c. two live seats on one member with different cards → two entries, each named from the member over its own card (with `ownName` unset, each reads its own card's name);
  d. the sealed-anchor refusal names a member with `ownName` by the own name (drive `anchorFor` or the public write that raises it);
  e. a `state:set` (or `setValue` through the socket door helper) with owner `{ kind: "seated_member", id: <memberId> }` writes the **same `attribute_values` row** (`owner_kind = 'session_cast'`, `owner_id = <cardId>`) as `{ kind: "session_cast", id: <cardId> }`, and no row has `owner_kind = 'seated_member'`; a card-less player seat's member is not reachable in S2 (no member) — skip;
  f. a player seat: `handEdits`' not-theirs sentence names the seat's member by its own name when the persona card's member has `ownName` (if reachable through an exported function; otherwise via the socket).
- `npx tsc --noEmit -p . 2>&1 | grep -E "state/(resolve|write|handEdits|worldScope|cardState|declarations|seatMember)|sockets/state\.ts"` → nothing.

## Out of scope
Rekeying anything; `rewind_taken`, turn tally, turn order writing (S4); the SDK; prompt text; the client; `sessions/seats.ts`, `cast/*` (another lane's; report a needed change); the item-4 sweep files (`give.ts`, `durable.ts`, `supply.ts`, `presencesOnReading.ts`, `storyTime.ts`, `sessionLoreRefs.ts`, `lorebookState.ts`, `owners.ts`, `earshot.ts`, `carries.ts`) — a later worker; NOMENCLATURE.md (the supervisor).

## Stop and ask (report, don't build) when
CLAUDE.md §Decisions applies; a user-visible sentence would change other than a name now read from the member; a new exported name beyond `seatMemberId`; a migration; a needed edit outside your files.

## Report path
Your final message (the supervisor reads it). Format as in the rules below.

---
# Rules every s27-S2-state worker builds to (quoted by the supervisor; read with your own brief)

## What S2 is (from BRIEF-s27-S2-common.md, quoted)
Stage S2 switches **readers** onto the seated cast member. It changes **no stored key and no stored data**.

1. "What a seated character is (name, shown name, retold text fields, greetings, example dialogues, face, voice, sprite sets) is read through `cast/memberAsRead.ts` (`membersAsRead` for a batch, `memberAsRead` for one) on the session's reading. When a seat has no member yet (`castMemberId` null), read the card as today."
   - "**A seat reads the card it holds.** Pass `overCards` (member id → the seat's card id) so a dated card amendment doesn't move a seat's card with the story clock … Two seats on one member with different cards: read them in separate calls (`seatedCastOf` shows how)."
   - "**Seat sets keep today's queries.** Where your code selects seats (incl. departed seats with `removedAt` …), keep that query and only move the per-seat member lookup onto `membersAsRead`, keyed by each seat's `cast_member_id`. Use `seatedCastOf` only where the code means 'live seats now'. Existing ad-hoc overlays in your files … become calls to the one reader; delete an overlay helper only when your lane removed its last caller, and say so."
2. "**Refs in, refs out.** Every parser in your files that accepts `character:<cardId>` also accepts 🚧 `seated-member:<memberId>`, resolved with `sessions/seats.ts` `seatOf` / `parseSeatRef`. Refs your code **emits** stay as today (`character:<cardId>` for a carded seat, `player-seat:<id>`) until S3/S4."
3. "**Keys stay.** `session_cast:<cardId>` owners, `state.cast.byId[<cardId>]`, the turn order in the core annex, `turnTally`, speech Auto voice picks, `rankings.speaker_ref`, `rewind_taken`, the sprite-set slot on the `session_cast` owner: **unchanged**. Do not rekey or rewrite them (S4 owns that)."
4. "**Payloads are additive.** … **Do not change SDK types or objects handed to plugins** (`CastEntry`, `SessionCharacterV1`, `ParticipantRef`, …) — that is S3; no SDK edit, no `sdk:build`."
5. "**Two live seats can share one member** until the next boot (import, branch, attach leave pairs). Resolve per seat, never per member; `seatOf` picks live, then lowest position, then lowest id."
6. "**Behaviour stays the same for today's data — with one intended change** … a seat's member is read **wherever it lives**, including the session's own book … Apart from that: A carded seat whose member has no voice or sprites of its own, and whose retold flags are what they were, must read exactly what it read before: the existing tests in your files stay green **unchanged** (a test you must edit is a finding — say why)."
8. "**No migration, no SDK edit, no boot-pass change, no new setting, flag or event.** A new exported name goes in NOMENCLATURE §25 (R3: qualified) in the same change." — **Workers do not edit NOMENCLATURE.md; list every new exported name in your report and the supervisor records it.** "Anything a user sees that changes — copy, a click target, a new line — is a ★" — report it, don't invent copy.
9. "**Every session has a lorebook** — its own book (Session notes) or an overlay of a book. Never write 'no book', 'no lorebook', 'bookless', 'reads no lorebook' in code, comments, tests or copy; say 'a session whose lorebook is its own book'."

## The readers you switch onto (already built; read their headers, don't edit them)
- `src/lib/server/cast/memberAsRead.ts`: `membersAsRead(db, memberIds, { sessionId?, reading?, overCards? })` → `Map<memberId, MemberAsRead>`; `memberAsRead(db, id, opts)`. Fields used here: `name` (memberNames rule: the member's own name when `own_name` is set, else the card's name — use `name` where today's code reads `characters.name`), `shownName` (nickname || name), `activeCardId` (with `overCards` = the seat's card, this IS the seat's card), `cardless`.
- `src/lib/server/cast/seatedCast.ts`: `seatedCastOf(db, sessionId)` → live seats (character seats with a card, then player seats incl. card-less), each `{ seatId, kind, castMemberId, cardId, position, asRead }`, `asRead` null while the seat has no member (then read the card). Already does the overCards batching for two seats on one member.
- `src/lib/server/sessions/seats.ts`: `seatOf(tx, sessionId, ref)` → `ResolvedSeat { kind: 'character'|'player', seatId, castMemberId, cardId, departed } | null` for `character:<cardId>`, `seated-member:<memberId>`, `player-seat:<seatId>` (live before departed; character seat before player seat; lowest position then id; never an envoy). `parseSeatRef(ref)` pure.
- `src/lib/server/state/seatRefs.ts` (the supervisor's, new): `storedSeatRef(db, sessionId, ref)` → a `seated-member:<id>` ref as its seat's stored ref (`character:<cardId>` for a seat with a card — a carded player seat is its card — or `player-seat:<seatId>` for a card-less player seat), any other ref unchanged, null when the member has no seat; `storedSeatOwner(db, sessionId, owner)` → `{ kind: 'seated_member', id }` as its seat's stored owner (`session_cast` by card / `player_seat` by seat id), any other owner unchanged, null when not seated; `isSeatedMemberOwner(owner)`. Use these at the door (where a raw ref or owner arrives) so everything behind it keeps working on stored keys. Never write a row under `seated_member`.
- "Own" (NOMENCLATURE §25, sheet latitude row, unchanged in S2): "**Own**: a player's cards (`characters.userId`) and card-less seat; the session owner's cards plus the world, the people nobody plays and the places." In S2 the card a seat's ownership is read from is the member's `activeCardId` read with `overCards` = the seat's card (so: the seat's card, as today); a seat with no member reads its card as today.

## CLAUDE.md rules that apply
- Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never add a top-level `await` to `src/lib/server/db/index.ts`." "`$state(new Set())`…" (n/a server). "It is a **session**, never a *chat*."
- No static `$lib/server/db` import in a module that tests mock (pass `db`); `state/**`, `rulesets/**`, `sessions/**` modules take their handle first. `sockets/*.ts` already import `db` statically — keep that pattern there.
- Decisions: decide implementation inside scope and name each choice in your report; anything a user sees that changes, a new name, setting, flag or file outside your list → stop and report it (★), don't build it. Findings outside your brief go under **Noticed, not done**, never fixed in passing.
- NOMENCLATURE R1 one word one meaning; R3 qualify, never the bare noun; R6 mark new provisional names 🚧. §24: grep a new name across `src`, the SDK and the schema before using it.
- Tests: run only the targeted files your brief names (`npx vitest run <files>`); **never pipe vitest into `head`** (SIGPIPE leaks PGlite temp dirs); int tests that open a DB need 60 s timeouts (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`); a new int test follows `src/lib/server/cast/memberAsRead.int.test.ts`'s setup (mkdtemp `serene-pub-vitest-<name>-`, `releaseDataDir` in afterAll). Delete only `/tmp/serene-pub-vitest-*` dirs your own tests made, by name.
- Formatting: `npx prettier --check <file>` / `--write` only on files you created; files dirty at HEAD carry other lanes' work — hand-format your hunks, never reformat a whole existing file.
- Typecheck: `npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"` must show nothing in your files.

## Verbatim (multi-agent guide)
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build: no SDK edits in this lane.)

## Report (your final message)
Changed files; per site: what switched (file:line → reader) and what still reads the card and why; new exported names (for §25); tests run with exact counts; any existing test you had to edit (a finding — old and new value, why); ★ (user-visible change, new name); Noticed, not done (incl. S4 rekey items).
