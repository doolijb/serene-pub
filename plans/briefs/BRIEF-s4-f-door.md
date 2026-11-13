# BRIEF — lane `s4-f-door` (wave 2; flip unit, waves 1–3) — the one translator, and state/rulesets writers ready for member form

Read `plans/briefs/BRIEF-s4-common.md`, then plan §34.1 in full (rekey rule, stores, doors kept until S5), §34.5 (⚠ waves 1–3 are one unit), and the wave 1 reports (`plans/REPORT-s4-f-sdk-2026-11-08.md`, `plans/REPORT-s4-cl-2026-11-08.md`). ★K-1 (ruled): `cast.byId` keyed `seated_member:<id>`. ★K-2 (ruled): a card held by a character seat AND persona seat(s) → the shared values are copied to each seat.

⚠ **Nothing you land may change behaviour yet.** Core keeps emitting card forms until wave 3. You build the translator and make every state/rulesets writer and reader *able* to take member form; the **door inversion** (card form in → member form stored) is written behind one switch point but **not turned on** — wave 3 turns it on together with f-emit's emit flip and f-pass's startup hunk. No lasting database boot between waves 1 and 3.

## Goal

1. **🚧 `memberFormOf(seatMap, ref | owner | key)`** in `src/lib/server/state/seatRefs.ts` — the one pure translator (card form → member form) used by the boot pass (f-pass) and every runtime door. Rules (§34.1): character seat → `seated_member:<cast_member_id>`; player seat → `player_seat:<seatId>`; mapping is exactly `seatOf("character:<card>")`'s order (`seats.ts:988-1097`: live before departed, character seat before player seat, then position, then id). Also the seat-map loader it needs (one query per session). **Land this first** and tell the lead (put a line at the top of your report draft) — f-pass starts on it.
2. **★K-2 helper:** for the card-in-both-seat-forms case, the translator returns every target (not just `seatOf`'s first) when asked for a *copy* (the pass uses it); runtime doors use the single `seatOf` target.
3. **Doors ready, not on:** `storedSeatRef` / `storedSeatOwner` gain the inverted path (card form in → member form stored) behind one exported constant or function the wave-3 lane flips; restore paths (`restoreRetractedState`, Forward's tally/annex in `rewind.ts`) run rows through `memberFormOf` when it's on; `unionAudiences` (`lorebooks/annex.ts:240`) — queue it if it's not in your files.
4. **State/rulesets writers and readers accept `seated_member` owners and keys everywhere** (today they're only reached via the door): `state/resolve.ts` (byId ref/owner/key ~1638–1659 — make it able to key by `seated_member:<id>` under the switch), `state/keys.ts:53` `castMemberKey`, `state/write.ts` (existence check ~1645, tables ~1736 — a `seated_member` owner must be checked against the seat, not a card), `earshot.ts`, `owners.ts`, `worldScope.ts`, `supply.ts`, `give.ts`, `durable.ts`, `handEdits.ts`, `storyTime.ts`, `bindings.state.ts` (state half only), `tools/stateTools.ts`; `rulesets/{read,ties,zones,resolve}.ts` (`rulesKeyOf` ~1218/2086, zone `towards` tie ends ~205–224); `sessions/{seatName,creationModes,convertRuleset,branch}.ts` — incl. **removing `givePlayerSeatACard`'s rekey to `session_cast`** (`seatName.ts:267-330`) under the switch; `sockets/state.ts:610-615`; `sockets/statTrail.ts`.
5. Tests: translator unit tests (every rule, order ties, merged pair, hard-deleted card → null, ids overlapping in one range — card id N and member id N must never cross); writers accept a `seated_member` owner; with the switch on (in a test), card-form input is stored in member form and a stray card-form row is translated on restore.

## Files owned

`src/lib/server/state/**` (owns `seatRefs.ts`), `src/lib/server/rulesets/{read,ties,zones,resolve}.ts`, `src/lib/server/sessions/{seatName,creationModes,convertRuleset,branch}.ts`, `src/lib/server/sockets/state.ts`, `src/lib/server/sockets/statTrail.ts`, `src/lib/server/rewind.ts` (or wherever `restoreRetractedState` lives — list it), tests next to these.

## Out of scope

Emit sites (f-emit), the boot pass and startup (f-pass), client (f-client), `seats.ts` (f-pass's settle hunk; seat lane later), `runtime/**`, `sockets/sessions.ts`. NOMENCLATURE: queue rows to the lead.

## Done means

Translator + door tests above green; every existing test file under `state/`, `rulesets/`, and the four `sessions/` files green with the switch **off**; tsc + check no new errors. Report: `plans/REPORT-s4-f-door-2026-11-08.md`, including the exact name/location of the switch for wave 3.
