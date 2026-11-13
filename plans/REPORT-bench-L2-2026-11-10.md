# REPORT — bench-L2: benched seats, the readers ("a seat in play") — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-bench-L2-w{1,2}.md`. A scope review ran inside the lane.

## Predicate
- `seatInPlay(t)` (SQL, `sessions/seats.ts`) is `removed_at IS NULL AND is_active`.
- Pure `inPlay(row)` lives in new `src/lib/shared/sessions/inPlay.ts` (re-exported by `seats.ts`). It reads `removedAt`/`isActive`/`enabled`.

## Changed (core)
- **Turns:** `turnPlan.ts`, `speakerRotation.ts`, `runTurn.ts` `presenceRef`, `host.ts` `liveCastRefs`.
- **Which seat a person speaks as:**
  - `playerSeat.ts`: `isOwnPlayerSeat`/`isLivePlayerSeat` use `inPlay`; `isCardlessPlayerSeat` stays a shape test for sheets.
  - `seatName.ts`: the `mine` pick uses `inPlay`.
  - `messages/store.ts`: `speakerSeatOf` ranks in play, then benched, then removed.
  - `sockets/sessions.ts`: the send handler's retired-card block.
- **State:** `resolve.ts` has `PlayerSeatLink.isActive`, persona links' `isActive`, and a card-less cast entry's `enabled`.
- **Prompt:** `promptFields.ts` drops benched player seats everywhere; the characters block keeps `isSpeaker || inPlay`.
- **Lore gate:** the `characterLore.ts` persona arm is `inPlay`. **hist-G's deceased arm is deleted.**
- **`host.ts`:** the `nodeState` hydration is removed; `seatRows` and `seatedMemberIds` use `inPlay`.
- **SDK cast doc:** `session_cast` `enabled` comes from `is_active`; `characters.v1` gives personas `benched`.
- **Tests:**
  - new: `characterLore.benched.test.ts` (replaces `deceased`), `promptFields.benched.test.ts`, `fireTurn.benched.int.test.ts`;
  - updated: `promptFields`, `templateContextBinding.int`, `projections/characters`, `playerSeat`, `speakerRotation.cardless`, `seatName.mint.int`, `speakerStamp.int`.

## Changed (SDK, built by the lead)
- `sdk/src/participants.ts`: the `enabled` doc now says "false = benched".
- DC `preamble.ts`: `liveSeats` requires `enabled !== false`.
- `sdk-tests/seatCastScripts.test.ts`: a new case.
- **Lead (★L2-2 accepted):** DC `roundScript.ts` `named` filter adds `s.enabled === false`.

## Tests
- Batch 1: 57 files, 653/653.
- Batch 2: 44 files, 364 pass, 2 fail before the build.
- **After the lead's sdk:build:**
  - W3, Walk100, Walk2 and `specHashes`: 4 files, 42/42;
  - SDK `coreCatalog`, `conformance`, `dungeonCrawler*` and `seatCastScripts`: 164/164.
- `tsc`: 0.

## Deliberate departures (accepted)
1. `fireTurn` `entryIsPersons` stays an identity read (removedAt), so a benched persona is never generated as AI.
2. `getPromptSessionFromDb` keeps benched personas so history can resolve their names. The prompt blocks filter.
3. The host `set-seat-name` retire-by-card lookup is unchanged (L3).
4. Identity reads stay on `removedAt`: `dispatchSpeech` castRefs, `seatRefLookupOfCast`, the lore co-occurrence set.

## ★ (lead)
- **L2-1:** a guest whose only seat is benched is asked to sit again (and could open a second seat). Kept for L4 to decide (a "you're benched" composer state).
- **L2-2:** accepted and done (roundScript).

## Names for L5
- `seatInPlay`, `inPlay`, `PlayerSeatLink.isActive`.
- The `enabled` meaning for persona seats.
- **NOMENCLATURE:358 background member:** now "no seat in play holds the member" (replace hist-G's deceased wording).
- **R1:** say "a seat in play" (also "place in play" and `inPlayOrder`).

## Noticed, not done
- Story `create.ts:93` `nobody` counts benched personas through a path length, which can't filter.
- `portrayals.ts`/`bindings.ts`/`state/write.ts` use `isCardlessPlayerSeat`, so they see benched card-less seats (right for sheets).
- `EditSessionForm.svelte:1360` lists benched card-less seats in the seated list until L4.
