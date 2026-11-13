# REPORT s27-S2-turns (2026-11-05)

**Status: BUILT.** The turn, speaker-stamp and roster-name readers now read the seated cast member. Refs coming in accept 🚧 `seated-member:<memberId>`, translated at the door with `cardFormRef`. Refs going out, the turn order, `turnTally` and the other keys are unchanged.

My verification run: **28 files, 294/294 pass.** It includes `dispatch.int` (now 57/57), the whole `messages/` directory and every new file. `tsc` shows nothing in lane files; the one error left is the old `arrangeCanvas.dom` one. No migration, no SDK edit, no `sdk:build`, no new setting, flag or event, no commit, no stash.

One existing test was edited (`dispatch.int.test.ts`'s fake database); the reason is under Tests.

Relayed status question: none received.

Workers were w1 and w2 (Sonnet). Their briefs are `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-turns-w1.md` and `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-turns-w2.md`. I checked both reports against their briefs, read the key hunks, made two edits myself (listed under Tests and Open ★), and re-ran the lane set.

## What switched (file → reader)

**Speaker stamp (★27-7)**
- **`messages/store.ts`** is the single writer, so the stamp lives there, once. Three private steps, beside `withStoryClockStamp`:
  - `insertLegacy` and `insertLegacyMany` stamp `cast_member_id = (await seatOf(db, sessionId, ref))?.castMemberId ?? null`. The ref is:
    - `character:<personaId>` for a persona line;
    - else a `metadata.speaker` of the form `player-seat:<id>`;
    - else `character:<characterId>`;
    - no ref (narration, an envoy line, a persona-less line) means no stamp.
  - A caller that already passes `castMemberId`, including an explicit null, is left alone.
  - `seatOf` is imported dynamically and runs on the handle the store was given (`tx` inside a transaction).
  - A failure only warns, never fails the write. A bulk insert caches by `sessionId|ref`.
  - `updateLegacy` and `updateLegacyWhere` re-stamp only when the patch sets `characterId` or `personaId` without `castMemberId`. This is checked on the patch's keys, so a streaming patch costs nothing extra.
  - The mirror carries `castMemberId`:
    - `projectLegacy.ts` adds the key only when the row has it, so the exact shapes in `projectLegacy.test.ts` are unchanged.
    - `upsertProjection`'s `set` gains the column.
  - **Effect:** every caller is stamped without being edited: host.ts `create-message`, greetings, branch, attachments, and lane access's import and persona-message paths. Access can stamp explicitly or leave it to the store; both give the same rule. The reassign path's `updateLegacyWhere(characterId → newId)` now re-stamps too.

**Refs in and turns (w1)**
- **`dispatch.ts` `loadAdapterSession`:** character seats go through `seatCardsAsRead`, with the `cc.character !== null` filter kept. The queued item 6b is done: stops and own labels now use the member's name.
- **`runTurn.ts`:** `request.speaker` is translated before anything reads it.
- **`portrayals.ts` `resolvePortrayals`:**
  - `seated-member:` refs (and the speaker) are translated before the SDK parse.
  - The answer is keyed under the ref as asked and under the card key.
  - An unseated member is answered `none`.
  - The ownership queries are unchanged: the card-owner join already answers "the owner of the seat's active card".
- **`fireAction.ts`:**
  - `req.actor.as` and `req.recipients` are translated once, at the top. An unseated one stays as sent and is refused by the existing sentences.
  - `answererName` uses `cardFormRef` + `cardsAsSeatsRead` + `memberShownName`. The `retoldMembersForSession` import is gone.
- **`turnPlan.ts`:**
  - `storedTurnPlan` matches speaker names against the member as read (`cardsAsSeatsRead`). Player seats keep their names.
  - `waits` and `skipWaitingTurn` translate at the door.
  - Stored refs stay in card form.
- **`turnYield.ts`:** a turn line's name comes from the member, once per distinct card.
- **`fireTurn.ts`:** `fireTurnEntry` and `entryIsPersons` translate `entry.ref`.
- **`sockets/sessions.ts`, fireTurn `ownsIt` hunk (~10049–10092):** `seatOf` judges by the owner of the member's `activeCardId` (with `overCards`), else the seat's card. A `character:` ref with no seat keeps today's card lookup.

**Names, faces and permissions (w2)**
- **`messages/permissions.ts` `canActOnMessage`:** persona and character lines are judged through `seatOf` by the owner of the seat's active card, else the old card check.
- **`messages/verbs.ts` `pressedTurnControl`:** `seated-member:` counts as `pick`.
- **`messages/diceWords.ts` `outcomeWordsOf(db, blocks, sessionId?)`:** with a session, it names through `cardsAsSeatsRead` and accepts `seated-member:`. Without one, it behaves exactly as today.
- **`runStatus.ts`:** the `{speaker}` name uses `cardFormRef` (before the `isParticipantRef` gate), `cardsAsSeatsRead` and `memberShownName`. The `retoldMembersForSession` import is gone.
- **`scenes/liveScenes.ts`, `narrativeGraph.ts` transcript hunk, `sockets/pipelines.ts` `portrayalLinesOf`:** names come from `cardsAsSeatsRead`. `retoldMembersForSession` is gone from the first two.
- **`summarizer/availableSceneCast.ts`:** character seats are read through `seatCardsAsRead`. The member's own nickname is added as an alias when it differs from the card's.
- **`conversations/gate.ts` `sessionCardBody`:**
  - Names come from `seatMembersAsRead`, an export lane pT2 added to `seatCards.ts` while this lane ran.
  - The face is the member's `faceMediaId` when it differs from the card avatar, resolved with one extra `files` query.

## What still reads the card, and why
- **Player seats' names** in every roster and in `loadAdapterSession`: this follows lane promptText's open ★1.
- **Ids used as keys** (no change):
  - `graphContextFormatter.ts` (`cards.memberOf` by card);
  - `ragContext.ts` and `vectorizationQueue.ts` (scope ids; the RAG candidate labels name the card's embedded text);
  - `promptDiff.ts` (`currentCharacterId`).
- **`speakerRotation.ts`:** no change. It is pure, and its `CastRead` is the host's `session_cast` read, already filled at `host.ts:4820`. The only consumer outside tests is `bindings.ts` turn-pool.
- **Also no change:** `runReply.ts` (emits a library card ref), `sessionEvents.ts` (derives an emitted ref from the stored row) and `sessionChanges.ts` `speakerRefOf` (emits).
- **Refs out** stay `character:<cardId>` / `player-seat:<id>`: `turnRefs`, `ownPresence`, `enabledSeats`, `presser`, form addressees (stored in card form by `bindings.ts`).

## Changed files
- **Edited:**
  - `src/lib/server/messages/{store,projectLegacy,permissions,verbs,diceWords}.ts`
  - `src/lib/server/pipelines/runtime/{dispatch,runTurn,portrayals,fireAction,runStatus}.ts`
  - `src/lib/server/sessions/{turnPlan,turnYield,fireTurn}.ts`
  - `src/lib/server/scenes/liveScenes.ts`, `src/lib/server/utils/summarizer/availableSceneCast.ts`, `src/lib/server/conversations/gate.ts`
  - `src/lib/server/sockets/narrativeGraph.ts` (transcript hunk), `src/lib/server/sockets/pipelines.ts` (`portrayalLinesOf`), `src/lib/server/sockets/sessions.ts` (fireTurn `ownsIt` hunk only, no prettier)
- **Edited test:** `src/lib/server/pipelines/runtime/dispatch.int.test.ts` (one stub, see Tests).
- **New tests:**
  - `src/lib/server/messages/speakerStamp.int.test.ts` (8)
  - `src/lib/server/messages/seatMemberNames.int.test.ts` (8)
  - `src/lib/server/messages/seatMemberNames.graph.int.test.ts` (1)
  - `src/lib/server/sessions/fireTurn.seatedMember.int.test.ts` (4)
  - `src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts` (4)
- **No change needed** (checked): `speakerRotation.ts`, `sessionEvents.ts`, `runReply.ts`, `graphContextFormatter.ts`, `ragContext.ts`, `vectorizationQueue.ts`, `promptDiff.ts`, `sessionChanges.ts`.
- **NOMENCLATURE §25:** no rows. No new exported name: the stamp steps are private, and `outcomeWordsOf` only gained an optional argument.

## Tests
- **My run, 28 files, 294/294:**
  - `dispatch.int`, both of w1's new files, `src/lib/server/messages` (all of it, including w2's new files);
  - `portrayals.int`, `fireTurn.int`, `runStatus.int`, `stops.seatMembers.int`, `sessions.turnControlPresence.int`, `sessions.turnControlSplit.int`.
- **Workers' runs:**
  - w1: 20 files, 258 pass, with the one known `sessions.forms.int` failure ("a pressed action that parks…", an extra `askedRunId`). Covered: `speakerRotation`, `speakerRotation.unprompted`, `plannedTurns`, `turnStrategies`, `runTurn.int`, `fireAction.collects.int`, `turnAdvise.int`, `turnChannel.int`, `armsSpeaker.int`, `unclaimedSpeaker.int`, `sessions.turnOrder.int`, `sessions.narratorCarryOn.int`.
  - w2: 37 files, 336/336. Covered: `runStatus.*`, `liveScenes.rewind.int`, `availableSceneCast.test`, `gate.test`, `promptDiff.int`, `graphContextFormatter.*`, `narrativeGraph.{memberStory,linksAndLines,buildReadsStoredCast}.int`, `pipelines.{messageExplain,scoping}.int`, `sessionMessages.laneEnvoySwipe.int`, `attachments/send.int`, `branch.revision.int`, `greetings.seatMembers.int`.
- **The one existing test edited (a finding):** `dispatch.int.test.ts`'s `fakeDb` had only `query.sessions.findFirst`. `loadAdapterSession` now reads seats' members through `seatCardsAsRead`, which uses `db.select`, so 49/57 tests failed with `select is not a function`.
  - I added one stub, `select → from → where → limit → []`, with a comment. Its seats have no member and its session's lorebook holds none, so the cards read as they are.
  - The test's assertions are untouched. It is a harness gap, not a behaviour change.
- **Existing tests whose value changed from the intended own-book change:** none. No existing fixture has an own-book member with an own name.
- **What the new tests prove:**
  - **Stamp:**
    - a character line, a persona line and a card-less player-seat line each carry the seat's member, on `session_messages` and on the `messages` mirror;
    - narration, an envoy line and a seat with no member give null;
    - a caller's value is kept;
    - bulk inserts are stamped;
    - an update that moves the speaker re-stamps;
    - all of it works inside `tx`.
  - **Turn selection:** a `seated-member:` ref judges and fires the same seat as its card ref, and an unseated one is refused, not thrown.
  - **Two seats on one member** (different cards) rotate as two seats, in position order.
  - **Turn plan:** a plan matches the member's `own_name`.
  - **Portrayals:** `resolvePortrayals` answers `seated-member:` refs.
  - **Permissions:** `canActOnMessage` gives the same answer through the seat.
  - **Names:** outcome words, the status speaker name, live-scene names and graph transcript names read the member's own name. A member in the session's own book is read.
- **Temp dirs:** I deleted none. Eleven `/tmp/serene-pub-vitest-*` dirs appeared during my run and were already gone when I checked. Workers report theirs released.
- **Prettier:** `--check` is clean on the five new files.

## Open ★
- **★TU-1 (copy, low):** an unseated `seated-member:` speaker in `runTurn` throws _"Nobody in session N is seated as ‹ref›."_ (new developer-facing text). It takes the place of the SDK parse error that such a ref threw before. It cannot be reached from the app today: refs core emits are in card form, and the socket's `isParticipantRef` gate refuses `seated-member:`. Keep it, or reuse another sentence?
- **★TU-2 (copy, low):** `fireTurnEntry` refuses an unseated `seated-member:` entry with the state door's existing sentence, _"that character is not in this session's cast."_ (verbatim from `state/write.ts` and `sockets/state.ts`; I replaced w1's "the turn produced no reply"). The sessions socket would show it as the error. It cannot be reached today either, for the same `isParticipantRef` reason.

## Queued for other lanes / the lead
- **`pipelines/runtime/host.ts` ~7403 (pT2 / host owner):** change `outcomeWordsOf(db, p.blocks)` to `outcomeWordsOf(db, p.blocks, sessionId)`, so outcome words name the member. Without it they keep the card's name, as today.
- **s27-S2-access:** the store now stamps `cast_member_id` on every insert, and re-stamps an update that moves `characterId`/`personaId`. Import, persona messages and reassign need no stamp code of their own; an explicit stamp is still respected.
- **`conversations/gate.ts`** depends on pT2's new `seatMembersAsRead` export in `seatCards.ts`. pT2 should keep that export, or tell this lane.

## Decisions taken inside scope (named, not ★)
- **The stamp:**
  - It lives in the message store, not at each writer: the store is "the single writer", and the rule is the contract's one rule.
  - A patch that moves the speaker to nobody clears the stamp.
- **fireAction:** an unseated `seated-member:` act-as or recipient stays as sent, so the existing refusal sentences answer it. No new copy.
- **portrayals:** answers are keyed under both the ref as asked and the card key; an unseated member is answered `none`.
- **fireTurn:** `entryIsPersons` translates too (for direct callers); a repeated translation costs no query.

## Noticed, not done
- **S3:**
  - `sockets/sessions.ts` ~10112 `isParticipantRef(seated.ref)` and `sameEntry` (literal compare): a client's `seated-member:` pick cannot reach the new translation through `sessions:fireTurn`.
  - `sockets/pipelines.ts` `portrayalLinesOf` filters keys with `isParticipantRef`, so a `seated-member:` receipt key is dropped.
  - `host.ts:3442` checks `q.speaker` with `isParticipantRef` / `canonicalParticipantRef` without translating it.
- **S4 rekey items met:**
  - the turn order, `turnTally`, plan `waits` and `skipped`, `turnRefs` `player-seat:`;
  - message `character_id`/`persona_id`;
  - `graphContextFormatter`'s `cards.memberOf.get(cardId)` lookup.
  - S4's boot backfill of `cast_member_id` on old messages should go through the same `seatOf` rule the store now uses.
- **"No book" wording for the S4 sweep:** `messages/store.ts:89` (`withStoryClockStamp` doc, "a session with no book"). It predates this lane, and I left it.
- **Coverage:** `portrayalLinesOf`'s name change has no test of its own (not exported; it needs a socket harness). `loadAdapterSession` is covered only through `dispatch.int` and `stops.seatMembers.int`.
- **Other lanes' uncommitted hunks** in `dispatch.ts`, `fireAction.ts`, `permissions.ts` (`sessionAccessFor`), `verbs.ts`, `replyView.*` and `liveScenes.ts` were left as they were. Edits here were additive, with no reformatting.

## Scope review (lead, 2026-11-05) — in scope; five findings → lane s27-S2-tidy
- F1 MEDIUM the store's stamp "only warns" on failure: inside a transaction a failed select aborts it anyway; outside, a null stamp can't be told from "no member" → drop the catch (a failed stamp fails the write).
- F2 LOW "can act" / fire-turn `ownsIt` read `memberAsRead` only to get `activeCardId`, which `overCards` pins to `seat.cardId` → judge by the seat's card directly.
- F3 LOW portrayals answers under the asked `seated-member:` ref and the card key → only under the ref asked.
- F4 the lane's ★ ids collided with ruled 11-04 ids → renamed ★TU-1 / ★TU-2 (above).
- F5 LOW `speakerRefOfValues` (store) beside `speakerRefOf` (`sessionChanges.ts`) → one rule; `outcomeWordsOf`'s `sessionId` passed by its `host.ts` caller.
