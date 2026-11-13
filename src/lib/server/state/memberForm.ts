/**
 * 🚧 ⏳ (until S5) **The flip's one switch point** (plan §34.1, §34.5).
 *
 * Off: every seat's values, keys and refs are stored and emitted in **card
 * form** (`session_cast:<cardId>` owners, `byId` keyed by the card id,
 * `character:<cardId>` refs), and the doors in `state/seatRefs.ts` translate
 * a member form that comes in back to card form — S2/S3's behaviour.
 *
 * On: a seat is stored in **member form** — a character seat as
 * `seated_member:<castMemberId>` (owner `{ kind: "seated_member", id }`, ref
 * `seated-member:<id>`), every player seat, carded or not, as
 * `player_seat:<seatId>` (ref `player-seat:<id>`) — and the doors translate a
 * card form that comes in to member form (`memberFormOf`).
 *
 * On from 2026-11-08 (S4 wave 3, lane s4-on: with the emit flip and the
 * `seat-keys` boot pass in `startup/index.ts`); removed in S5, when card form
 * goes. Nothing else reads a flag. Tests may set `memberFormSwitch.on` and
 * must set it back.
 *
 * ⚠ A leaf: no imports, so `owners.ts` and `keys.ts` can read it.
 */
export const memberFormSwitch: { on: boolean } = { on: true }

/** 🚧 ⏳ True once seats are stored in member form (`memberFormSwitch`). */
export const memberFormOn = (): boolean => memberFormSwitch.on
