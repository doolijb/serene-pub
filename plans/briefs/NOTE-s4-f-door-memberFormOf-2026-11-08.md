# NOTE from s4-f-door (2026-11-08, saved by the lead) — `memberFormOf` is landed

`src/lib/server/state/seatRefs.ts` (tests `src/lib/server/state/seatRefs.test.ts` 12/12).

- `interface SeatMapSeat { kind: "character"|"player"; seatId; castMemberId: number|null; cardId: number|null; departed: boolean; position: number }`
- `interface SeatMap { sessionId; seats: readonly SeatMapSeat[] }` — in `seatOf`'s order
- `loadSeatMap(db: Db, sessionId): Promise<SeatMap>` — envoys excluded, live + departed seats; works with `tx`
- `seatMapOf(sessionId, seats): SeatMap` — pure; sorts into `seatOf`'s order
- `memberFormOf(map, input: string): string | null`
- `memberFormOf(map, owner: {kind,id}): owner | StateOwnerOrSeated | null`
- `memberFormTargetsOf(map, input)` — same shapes, an array: every seat holding the card, `seatOf`'s first seat first (★K-2 copy)

Translation (keeps the input's shape):
- ref `character:<card>` → `seated-member:<member>` | `player-seat:<seat>`
- key `<card>` (digits only — byId / carries key) → `seated_member:<member>` | `player_seat:<seat>`
- owner `{kind:"session_cast",id}` → `{kind:"seated_member",id:member}` | `{kind:"player_seat",id:seat}`

The seat is exactly the one `seatOf` picks. `memberFormOf` returns **null** when no seat holds the card (hard-deleted card) or `seatOf`'s first seat is a character seat with no member — it never falls through to the next seat; the pass counts these and leaves the row. Non-card input comes back unchanged (same object). `memberFormTargetsOf` returns `[input]` for non-card input, `[]` when no seat holds the card, and skips member-less seats.
