# REPORT s27-S2-tidy (2026-11-05)

Relayed status question: none received.

## Summary
Five of the seven items are built (2, 3, 4, 6, 7). Every targeted test passes and `tsc` is clean on the lane's files.

Items 1 and 5 hit the stop conditions in the brief, so I changed nothing for either. Each is written up below with the exact difference and a recommendation (★TIDY-1, ★TIDY-2). Because item 1 was held, `NOMENCLATURE.md` was not touched: no name was added, retired or renamed.

## Item 1 (one door): stopped
**What differs.** `cardFormRef` (`pipelines/prompt/seatCards.ts:229`) and `storedSeatRef` (`state/seatRefs.ts`) give different answers in one case: a `seated-member:` ref whose id `parseSeatRef` rejects. That covers `seated-member:0`, `seated-member:000`, and any id above `Number.MAX_SAFE_INTEGER`.
- `cardFormRef` returns **the ref unchanged**. It tests `parseSeatRef(ref)?.form`, which is null for that ref.
- `storedSeatRef` returns **null**. Its own regex `/^seated-member:(\d+)$/` matches, and then `seatOf` returns null.

**What agrees.** Every other case gives the same answer:
- a carded seat → `character:<card>`, including a carded player seat;
- a card-less player seat → `player-seat:<id>`;
- a card-less character seat → null;
- an unseated member → null;
- any other ref passes through unchanged;
- trimming is the same in both.

**★TIDY-1, recommendation:** take `storedSeatRef` as it is, so a `seated-member:` ref with an impossible id answers null.
- Why: no member can sit under such a ref. A pass-through would also hand a `seated-member:` string to callers that then feed it to the SDK's `parseParticipantRef`, which does not know that form until S3, so it can throw.
- Trade-off: those malformed refs move from pass-through to null at every caller. Today's data has none.
- Once ruled, the move is mechanical. Sites (`grep -rn cardFormRef src/`):
  - `runTurn.ts:1761`
  - `fireAction.ts:368/374/1292`
  - `portrayals.ts:145/244`
  - `runStatus.ts:216`
  - `turnPlan.ts:156/291`
  - `fireTurn.ts:155/201`
  - `diceWords.ts:84`
  - `host.ts:4007/8140/8520`
  - `bindings.ts:8437`
  - `sockets/sessions.ts:9689`
- Test fallout:
  - `sessions/fireTurn.seatedMember.int.test.ts:141–153` imports `cardFormRef`. It would need editing, which counts as a finding.
  - `seatCards.int.test.ts`'s `describe("cardFormRef")` would go with the function.

## Item 5 (one speaker-ref rule): stopped
Extending `messages/sessionChanges.ts` `speakerRefOf` to read `metadata.speaker = player-seat:<id>` would change its output for existing callers. Card-less player lines carry exactly that metadata (`sessions/seatName.ts` writes it); `characterId` and `personaId` are null. Today such a line gives null; extended, it gives `player-seat:<id>`. The callers affected:
- `sessions/retakeTurn.ts:254` and `pipelines/runtime/host.ts:~8991`: `lost.speaker` on `core:event/message-deleted@1`, which plugins can see.
- `pipelines/speech/messageLine.ts:64`: the speech line's `speakerRef`, which keys `speechAutoVoice:<speakerRef>`.
- `settledLines.ts` reads `metadata.speaker` first, so it is unaffected.

There is also an order question. `speakerRefOfValues` checks the player-seat metadata **before** `characterId`. To equal it, the extension must sit between `personaId` and `characterId`.

**★TIDY-2, recommendation:** extend `speakerRefOf` in that order and have the store call it.
- Why: naming the player seat is truer than null for a deleted card-less player line, and it gives that line a voice key.
- Trade-off: a plugin-visible payload changes, as does the speech key for those lines, so the ruling is yours.
- The alternative is to keep `speakerRefOfValues` as the store's own rule.

`store.ts` `speakerRefOfValues` is untouched.

## Built
**Item 2 (stamp fails loudly), `messages/store.ts`:**
- `withSpeakerStamp`'s try/catch and warning are gone.
- `restampSpeakers`'s per-row try/catch ("re-stamp skipped") is gone too. That was my call: a patch's re-stamp is part of that same write.
- The `speakerMemberOf` doc now says a failed seat read fails the write.
- `withStoryClockStamp` is unchanged.

**Item 3 ("can act" and fire-turn by the seat's card):**
- `messages/permissions.ts` `ownsSeatedCard` is now `seatOf`, then `ownsCharacter(seat.cardId ?? cardId)`, else the message's own card. `memberAsRead` is dropped and the doc rewritten.
- `sockets/sessions.ts` fireTurn `ownsIt`: the `memberAsRead` block is dropped, so `cardId = seat?.cardId ?? null`. A card-less seat stays not-owned. The comment is updated. Only that hunk was edited.
- The answers are the same because `overCards` pinned `activeCardId` to `seat.cardId`, and a null pin falls back to `seat.cardId` too.

**Item 4 (portrayals answer only under the ref asked), `pipelines/runtime/portrayals.ts`:**
- After the main loop, all asked `seated-member:` keys are filled first.
- Then each translated card key is deleted unless a non-`seated-member:` ref canonicalises to it.
- They are filled before deleting so that two `seated-member:` refs on one seat both get their answer.

**Item 6 (outcome words name the member), `host.ts:7398`:**
- The call is now `outcomeWordsOf(db, p.blocks, sessionId)`.
- `sessionId` is a number there, because the create-message case throws when it is undefined.

**Item 7 (pT2's noticed items):**
- `utils/castMemberCards.ts` `memberOfCard`: the linked select now has `.orderBy(asc(lorebookBindings.id))` before `.limit(1)`.
- `seatCards.ts` `cardsAsSeatsRead` now orders by `coalesce(position, 0)`, then id, like `seatOf`.
- `sessions/seats.ts` `seatOf`'s doc now names `cardFormRefInCast` as its mirror.

**Formatting.** I brought the lane's own new lines to prettier shape: the `store.ts` ternary, two lines in `portrayals.ts`, and the new test's array. `permissions.ts`, `store.ts`, `castMemberCards.ts` and `portrayals.ts` already failed `prettier --check` at HEAD on other lines, and none were reformatted. Both edited test files now pass `prettier --check`.

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/messages/store.ts`: stamp hunk.
- `/home/jody/github/serene-pub/src/lib/server/messages/permissions.ts`: `ownsSeatedCard`.
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts`: fireTurn `ownsIt` hunk (~10064–10090).
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/portrayals.ts`: the end of `resolvePortrayals`.
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.ts`: one line (7398).
- `/home/jody/github/serene-pub/src/lib/server/utils/castMemberCards.ts`: `memberOfCard`.
- `/home/jody/github/serene-pub/src/lib/server/pipelines/prompt/seatCards.ts`: `cardsAsSeatsRead`.
- `/home/jody/github/serene-pub/src/lib/server/sessions/seats.ts`: `seatOf` doc only.
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts`: new test. Asked only two `seated-member:` refs, the result holds exactly those keys.
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts`: new `describe("an outcome row's words name the seat's member")`.
  - It drives `core:outlet/create-message` with a dice block `by: character:<card>`. The stored `diceWords` is `"Maren — Stealth: Failure."` (the member's own name).
  - With the `host.ts` line reverted, the test fails and the stored words carry the card's name, `"Verity — …"`.
- Worker briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-tidy-w1.md`, `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-tidy-w2.md`.

No existing test was edited.

## Tests
**w1:** one run of `src/lib/server/messages` (whole dir) plus 12 more files: `fireTurn.int`, `fireTurn.seatedMember.int`, `sessions.fireTurnOnly`, `turnControlPresence.int`, `laneEnvoySwipe.int`, `seatCards.test`, `seatCards.int`, `seats.int`, `sessions.seatCast.int`, `branch.seatMembers.int`, `datedCardLore.int`, `castMemberLifecycle.int`. **31 files, 313/313 passed.**

**w2:**
- `portrayals.int`, `turnSeats.seatMembers.int`, `runTurn.int`, `envoyRoad.int`, `host.seatMembers.int`, `seatMemberNames.int`, `diceWords.test`: **7 files, 80/80 passed.**
- `sessions.lairWalk.int`, which asserts `diceWords` through the host: **18/18 passed.**

**Re-run (supervisor),** after w2's type-only fix and my formatting reflows: `portrayals.int`, `turnSeats.seatMembers.int`, `host.seatMembers.int`, `speakerStamp.int`, `store.int`, `writes.int`. **6 files, 67/67 passed.**

**`npx tsc --noEmit -p .`:** nothing in any lane file.

**Temp dirs:** my re-run left no new `/tmp/serene-pub-vitest-*` dirs. w1 saw `/tmp/serene-pub-vitest-hVBthi` appear, unnamed and of unknown owner. It was not deleted.

## Open ★
- **★TIDY-1:** `storedSeatRef`'s null vs `cardFormRef`'s pass-through for a `seated-member:` ref with an impossible id. I recommend `storedSeatRef` as it is, then the mechanical move above.
- **★TIDY-2:** extend `speakerRefOf` with the player-seat metadata, which changes `lost.speaker` and the speech key for card-less player lines. I recommend extending it.

## Noticed, not done
- In `ownsSeatedCard` and the `character:` path of fireTurn's `ownsIt`, `seatOf(character:<cardId>)` always returns a seat whose `cardId` equals `cardId`. The seat read is therefore redundant there; it reduces to the card's owner. It was kept as the brief asked.
- `store.ts:89`'s "no book" wording in the `withStoryClockStamp` doc is still there; it is already on the S4 sweep list.

## Lead dispositions and work (2026-11-05)
- **★TIDY-1 → `storedSeatRef` as it is** (an impossible `seated-member:` id answers null; no member can sit under it, and a pass-through would hand `seated-member:` to the SDK parser before S3). **The lead did the move:** every `cardFormRef` caller (`runTurn`, `fireAction` ×3, `portrayals` ×2, `runStatus`, `turnPlan` ×2, `fireTurn` ×2, `diceWords`, `host.ts` ×3, `bindings.ts` pick-sprite, the token count in `sockets/sessions.ts`) now calls `state/seatRefs.ts` `storedSeatRef`; `cardFormRef` deleted from `seatCards.ts` (and its unused `seatOf` import); `seatCards.int`'s describe and `fireTurn.seatedMember.int` call `storedSeatRef` (test edits caused by the retirement); §25 row amended. `cardFormRefInCast` stays. Run: 16 files, 141/141.
- **★TIDY-2 → keep both rules for now** (no behaviour change in S2): `speakerRefOf` emits plugin-visible and speech-key refs and stays as is; the store's `speakerRefOfValues` also names a card-less player line by its seat, for the stamp. They differ only on card-less player lines; S4 settles it with `player_seat:` keys. Recorded here instead of a merge.
