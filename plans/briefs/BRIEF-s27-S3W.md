# BRIEF s27-S3W — the app's client reads identity, not card ids (seat-cast S3)

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-s27-S3-common.md` first. Lane id **s27-S3W**. Two workers at most. App `/home/jody/github/serene-pub`. Concurrent: **s27-S3C** (server; it fills the fields you read — build against the SDK types and fall back to today's form when a field is absent), **s27-S3G**, **mundi-27a**. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.

## Items (inventory §2)
1. **Projections:** `sessionPageProjections.ts` (`line.speaker.ref` ~613 from the message's `castMemberId` → the seat's `ref`; the turn-picker key ~344; scene-cast refs ~688–711; `fateOf` ~931 by entry lookup; `canControlMessageAs` ~176 by the seat's member), `projections/characters.ts` (~355 `SessionCharacterV1.ref` from the seat's `ref`, `castMemberId`, `cardId`; the pin's `ref` ~402), `projections/attendance.ts` (~82 `personaRefs` from seat refs — after lane G widens the type), `projections/sessionState.ts` (~162–190 a `seated_member` branch in `castOf`), `roundWaiting.ts` (~38), `turnControls.ts` (~37 fire with the candidate's `ref`), `pressRouting.svelte.ts` (~575 collect options), `collects.ts` (~345 by entry lookup), `pageAsks.ts` (~398), `utils/messageSpeaker.ts` (~105–175 by the message's `castMemberId`, seat refs looked up, not parsed).
2. **Request doors:** `requests/setChosenImage.ts` accepts `memberRef` (`seated-member:`) beside ⏳ `characterRef` and stores what lane G's widget sends (★S3-8: lines keyed `seated-member:<id>` once S4 rekeys; in S3 store the form the server's reader accepts — coordinate through the lead); `statTrail.ts`, `setTieShown.ts` owner kinds gain `seated_member` (the lead widened `setOwnerFace`, `givePiece`, `setAttributeCarry`).
3. **Fixtures:** `componentEditor/previewFixtures.ts` gains the new fields.
4. **Tests** per the common contract (both shapes) for each projection and door.

## Files owned
`src/lib/client/**` sites above, `src/routes/**` if a page builds a card ref, their tests, `NOMENCLATURE.md` §25.
