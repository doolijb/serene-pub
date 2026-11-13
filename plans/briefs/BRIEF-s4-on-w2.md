# BRIEF s4-on-w2 — stale state/socket tests after the S4 flip (2026-11-08)

Read first, and follow: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s4-on-common-tests.md` (shared rules, verbatim lines, how to fix, test command, report shape).

## Files owned (edit only these)

- `src/lib/server/sockets/state.earshot.int.test.ts` — 12 failing. Helpers `whisperOf`/`gritOf` (~l.172) and direct `byId[String(card)]` reads (~l.412, ~449) look entries up by card id → choice 2 (find the entry by host-filled `id`, character-seat entry vs player-seat entry as the fixture means). Derive expressions written as `state.cast.byId["${bram.id}"].whisper` (~l.434/441) are a plugin-authored reader keyed by card id — with the switch on a card-keyed reader finds nothing (owner ruling ★K-1, 2026-11-08: "a stale card-key reader finds nothing rather than the wrong person"); rewrite them to the member-form key of that seat (compute it from the fixture's seat row) so the test still proves what it says. The `mine` test (~l.519–534) expects `session_cast:<card>` keys: with the switch on a carded player seat (a guest's persona) is `player_seat:<seatId>` and a character seat with a member `seated_member:<id>` — assert those keys from the fixture's seat rows. `res.owners.find(o => o.kind === "session_cast" && o.id === id)` (~l.381) → match by the row's `ref`/`castMemberId`/`cardId` instead. Writes through the door with `{session_cast, card}` are fine.
- `src/lib/server/sockets/state.seatIdentity.int.test.ts` — 2 failing ("keys are unchanged" — expect the member-form keys now, i.e. choice 1 for the old-keys assertion pinned off + an on-mode sibling, or choice 2; your call, say which).
- `src/lib/server/sockets/state.showTieSide.int.test.ts` — 2 failing (door returns `seated_member` now; tests named "character seat -> session_cast" and "a session_cast owner works as before" are door tests → choice 1).
- `src/lib/server/state/resolve.int.test.ts` — 2 failing in describe `who` (~l.509–549): byId read by card id; the persona entry is `player_seat:<seatId>` on → choice 2.
- `src/lib/server/state/seatMember.int.test.ts` — 3 failing: "a member with its own name…" (byId by card, ~l.190 → choice 2); "two live seats on one member with different cards: two entries" (~l.257: on, the two seats share one key and collapse to one link — the lowest position; this is the pre-merge state the merge rule settles; choice 1: pin the two-entries expectation off and add the on expectation `[[a.id, "Alder", shared.id]]`); "a seated_member owner at the state:set door … none under seated_member" (door test → choice 1).
- `src/lib/server/state/owners.test.ts` — 1 failing: "a seat has no card behind it: its chain is itself alone" — `resolutionChain` for `player_seat` returns `[owner]` only while off; on, `seatChain` (see `state/owners.ts` ~l.94–123 and the comment there) → choice 1.

## Done means

All six files pass with the switch on (the default), counted in one capped run of exactly these six files, log `s4-on-w2-tests.log`.
