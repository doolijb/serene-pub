# BRIEF — lane `s4-f-client` (wave 3; flip unit) — the session page reads member form

Read `plans/briefs/BRIEF-s4-common.md`, then plan §34.1 ("Emit sites" client line; "Flips together"; gap 3), §34.5, and `plans/REPORT-s4-f-sdk-2026-11-08.md` (**its "Queued for f-client" list is part of your goal**) and `plans/REPORT-s4-f-door-2026-11-08.md`. Lane s4-f-emit flips the server beside you; after both, the lead turns the doors and the boot pass on.

## Goal

1. Every client reader that builds or parses a card-form ref, owner or key reads the **host-filled** `ref` / `castMemberId` / `cardId` / `key` instead (never parse a key — K-1 keys are opaque): `client/.../characters.ts` ~354, `sessionPageProjections.ts` ~335, ~697, `pressRouting.svelte.ts` ~577, `turnFlow.svelte.ts` ~338, `roundWaiting.ts` ~58, `attendance.ts` ~49, ~85, `routes/sessions/[id]/+page.svelte` ~551, and the six request doors (find them). Grep again; list every site.
2. **`seatIdentity.ts` (~176–232) `seatOfMessage` / `messageRefOf`** stop needing a card column: a message is matched to its seat by its `castMemberId` stamp / ref, so a card-less character line gets its name (the seat lane makes card-less seats in wave 4; this must already work for them).
3. **f-sdk's queue:** `participantOf` (`routes/sessions/[id]/+page.svelte` ~752, via `seatCardIdOfRef`) and `NextCharacterBlock` give a `player-seat:<id>` its face, so carded player seats keep their turn-line and `sp-avatar` avatars after the flip; narrow the op union at `shared/sockets/types.ts` ~17154 (drop `"attach-lorebook"` if no stored-row reader needs it — check `ledgerLines`).
4. `shared/sockets/types.ts` owner unions accept `seated_member` / `player_seat` wherever a payload carries an owner.

5. **From f-door:** with the switch on, a carded player seat's owner row in `state:*` payloads keys as `player_seat:<id>` (not a name slug) — check every widget/client reader that matches owner rows by slug and switch it to `ref` / `key`.

## Files owned

`src/lib/client/components/sessionPage/**` (projections, requests, flows), `src/lib/client/**/characters.ts` (the one site), `src/routes/sessions/[id]/+page.svelte`, `NextCharacterBlock.svelte` (find it), `src/lib/shared/sockets/types.ts`, tests next to these.

## Out of scope

Server (f-emit); widgets in the SDK (f-sdk done); the Characters view (wave 6); seating pickers (seat lane, wave 4).

## Done means

Tests: `seatIdentity` with member-form payloads (carded, card-less, a member holding both seats, a departed seat); `participantOf` gives a player seat its face; the projection/turn-flow/attendance test files green against member-form payloads; tsc + check no new errors. Report `plans/REPORT-s4-f-client-2026-11-08.md`.
