# BRIEF — lane `s4-f-pass` (wave 2, after f-door lands `memberFormOf`; flip unit) — the `seat-keys` boot pass and the own-book mint

Read `plans/briefs/BRIEF-s4-common.md`, then plan §34.1 (stores rekeyed, stores left, the pass, ★K-2, ★K-3, ★K-4), §34.5 (⚠ waves 1–3 one unit), the wave 1 reports and f-door's report draft (`plans/REPORT-s4-f-door-2026-11-08.md`). Pattern to copy: `src/lib/server/sessions/seatMembers.ts` (the `seat-members` pass) and `src/lib/server/startup/index.ts:294-330`.

⚠ **Write the pass and its tests; do NOT add it to the startup list.** The startup hunk lands in wave 3 with f-emit, so nothing runs it before the readers flip. No lasting database boot between waves 1 and 3.

## Goal

1. **Own-book mint (★B-5 ruled "fixed at start", so a mint may count as play):** in `sessions/seats.ts` `settleSeats` / `resolveSeatMember` (~300), live carded seats with no member get one minted into the session's book (own book or overlay as the existing rule says for attached books). Remove the "S1 never mints into the own book" guard and its comment; the `seat-members` pass then leaves no seat member-less (the 11-06 walk had "1 left without one"). Test: a session whose book is its own book gets a member for every live carded seat; second boot changes nothing.
2. **🚧 `seat-keys` pass** in new `src/lib/server/sessions/seatKeys.ts` (⏳ until S5): ordered after `character-versions`, before `plugins`; `failsHealth`, not critical; one `db.transaction` per session using **only `tx`**; failures counted and logged; returns a report (sessions done, rows rekeyed per store, counted-and-left cases). Uses f-door's `memberFormOf`. Rekeys every store in §34.1 "Stores rekeyed": owner columns of `attribute_values`, `attribute_configs`, `zone_contents`, `owner_sheets`, `attribute_carries` (`session_cast` → `seated_member` / `player_seat`); JSON: `state_proposals.payload.owner`, zone `entries[].fields.towards`, `sessions.annex.core` (turnOrder, turnTally keys/fields, Crawler `progress.fates` keys), `sessions.annex_audiences`, `sessions.genre_fields` `speechAutoVoice:character:N` keys, `widget_settings.values` (`chosenImages` left sides → `seated-member:<id>=`, `pickMembers`), `messages`/`session_messages` `metadata.speaker`, `message_parts` `core:blocks` addressee/by, `session_messages.rewind_taken`, `annex_deltas.before/after`. **Left** (★K-3 ruled): genre-scoped `session_layout_presets.layout.widgetSettings`, `lorebooks.annex_audiences`, `rankings.speaker_ref`, receipts' portrayals, `session_changes.payload`, Mundi annex.
   - **★K-2 (ruled):** a card in a character seat AND persona seat(s) → copy the shared values to each seat.
   - Merged pair colliding on `owner_sheets_owner_sheet_uq` / `attribute_carries_owner_slot_uq`: survivor's row wins, else newest.
   - Hard-deleted card / member-less departed seat → counted and left.
   - **★K-4 (ruled):** no unique (session, member) index now — S5.
   - Fast path: one cheap query decides "nothing to do"; measure the JSON LIKE scans on a copy of the walk DB (`~/.local/share/SerenePub` is the owner's — **never touch it**; use a copy in your scratchpad or a seeded test DB). If the no-op boot costs > ~200 ms, propose a "pass ran" marker (★, the ★CV-9 pattern) — don't build it.
3. **Tests (these gate the whole flip):** each rule and each store; persona seat → `player_seat:<seatId>`; ★K-2 copy; merged pair collision; card and member ids overlapping in one range (pattern `seatMembers.int.test.ts:198`); hard-deleted card counted and left; Back before the pass → pass → Forward/Back on `annex_deltas` and `rewind_taken`; one session's failure rolls back that session alone; attic upgrade then the pass; a pre-flip backup then the pass; **second run: a dump of every touched table and JSON column is identical and the report is all zeros**. Call the pass directly in tests (it isn't in startup yet).

## Files owned

`src/lib/server/sessions/seatKeys.ts` (new) + tests, `src/lib/server/sessions/seatMembers.ts`, the settle hunk of `src/lib/server/sessions/seats.ts` (`settleSeats`/`resolveSeatMember` only). **Not** `startup/index.ts` (wave 3).

## Out of scope

The startup hunk; runtime doors (f-door); emits (f-emit); client. NOMENCLATURE: queue rows (the pass, the own-book mint rule) to the lead.

## Done means

All tests above green (60 s timeouts on DB-in-`it`); existing `seatMembers`/`seats` test files green; tsc + check no new errors. Report `plans/REPORT-s4-f-pass-2026-11-08.md` with the measured no-op cost and the exact startup hunk for wave 3 to paste.
