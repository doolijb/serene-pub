# BRIEF — lane `s4-seat` (wave 4; after the flip) — card-less seats

Read `plans/briefs/BRIEF-s4-common.md`, plan §34.2 ("Card-less seats"), §34.0 (the seat-filter bullet), the 2026-11-08 rulings (★4, ★6), and the reports `plans/REPORT-s4-f-emit-2026-11-08.md`, `plans/REPORT-s4-f-client-2026-11-08.md` (its "Needs another file" list is yours), `plans/REPORT-s4-f-door-2026-11-08.md`, `plans/REPORT-s4-cl-2026-11-08.md`. The flip is on: seats are addressed `seated-member:<id>` / `player-seat:<id>`, owners `seated_member` / `player_seat`.

Rulings: "Everything in session is cast → active card." · ★S2b-1 "Still theo" (the seater keeps acting rights, `seated_by_user_id`) · ★4: **background member = not seated in this session** (lore gate and docs) · ★6: a named **Take a seat** mints a card-less member in the session's book, named by the seat name · ★S3W-1/★S3W-3: a card-less player seat is treated like any seat.

## Goal

1. **`seatCast` gains a `castMemberId` form** (`sessions/seats.ts` ~369/398): the member must live in one of the session's books (own book or overlay, incl. the overlay's parent) and must not be an overlay row; else refused in words that say what to do. `character_id` = the member's linked card or null (⏳ until S5). The seater is required. A revive finds the row by (session, member). The merge rule covers card-less seats.
2. **`seatPlayer` gains `castMemberId`**; ★6 named Take a seat mints a card-less member (one writer: `sessions/seats.ts`; the member is created through the lorebooks module's binding writer, P2).
3. **`bookCastToSeat`** (`sessions/seatBookCast.ts` ~73–78) returns `{castMemberId, cardId|null}` and stops dropping card-less members; persona members skipped by their active card; a provided book seats all its members. `sessions:create` and add-to-session accept `castMemberIds`.
4. **Every `isNotNull(characterId)` filter** becomes "not an envoy, and has a member or a card": `cast/seatedCast.ts:129`, `seats.ts` ~733/779/830, `sessions/rowProjection.ts` ~574 (`castFaces`), `runtime/portrayals.ts` ~401, `conversations/gate.ts` ~192, `state/handEdits.ts` ~230. Voices-in-use (`speech/resolveVoice.ts` ~298), sprite choice (`sprites/choices.ts` ~121–150) and the ~39 non-null `.character.` reads (`runtime/bindings.ts`, `sessions/greetings.ts`, `runtime/speakerRotation.ts`, `illustrateScene.ts`, …) read by member. `state/seatRefs.ts` `storedOwnerOfSeat` (~19–23) answers for a card-less character seat.
5. **Lore gate by member (★4):** `characterLore.ts` (~127 `currentCharacterId`, ~139 card-less = narrator-only) gates private lore by the speaking seat's member; "background" = not seated in this session.
6. **Client (from f-client):** `utils/messageSpeaker.ts` (~121/~149) names card-less lines via `seatOfMessage`; `canControlMessageAs` (`sessionPageProjections.ts` ~150) mirrors the server's `canActOnMessage` for card-less lines; `PickSpeakerModal` + `turnFlow` `onPickSpeaker` pick a seat (ref), not a card; the seating pickers offer card-less members of the session's books.
7. Docs: `docs/sessions.md`, `docs/group-sessions.md` (seating card-less cast), `docs/lorebook-cast.md` (background member = not seated here), `docs/personas.md` (Take a seat), `docs/session-layout.md:61` (Who's here lists card-less player seats; faces on dividers and the turn line).

## Files owned

`src/lib/server/sessions/{seats,seatBookCast,greetings,rowProjection}.ts`, `src/lib/server/cast/seatedCast.ts`, `src/lib/server/pipelines/prompt/seatCards.ts`, `src/lib/server/pipelines/runtime/{portrayals,speakerRotation,bindings}.ts` + `illustrateScene.ts`, `src/lib/server/conversations/gate.ts`, `src/lib/server/state/{handEdits,seatRefs}.ts`, `src/lib/server/speech/resolveVoice.ts`, `src/lib/server/sprites/choices.ts`, `characterLore.ts` (find it), **owns `src/lib/server/sockets/sessions.ts` and `src/lib/shared/sockets/types.ts`** (lane s4-chr-read may append one new namespace block for `characters:page` — don't edit its block), `src/lib/client/utils/messageSpeaker.ts`, `sessionPageProjections.ts` (`canControlMessageAs`), `PickSpeakerModal.svelte`, `turnFlow.svelte.ts`, the seating picker components (find them; list them), the docs above, tests next to all of these.

## Out of scope

Starters (st), Copy to my characters (cp), the Characters view (chr-*), fold (bk-fold). NOMENCLATURE: queue rows.

## Done means

Tests: a card-less seat is written and revived; an outside member and an overlay row are refused in words; envoys untouched; the merge rule covers card-less seats; a card-less speaker gets prompt, voice, sprites and its own private lore; a member not seated in this session is background for the lore gate; named Take a seat mints one card-less member; `bookCastToSeat` seats card-less members; client: a card-less line shows its name and face, PickSpeaker picks by ref. tsc + check no new errors. Report `plans/REPORT-s4-seat-2026-11-08.md`.
