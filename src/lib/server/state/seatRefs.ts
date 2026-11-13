/**
 * 🚧 A seat named by its cast member, read as the key its values are stored
 * under (plan §27, stage S2: refs in, refs out).
 *
 * S2 switches readers onto the seated cast member but changes no stored key:
 * a carded seat's values stay `session_cast:<cardId>` and a card-less player
 * seat's `player_seat:<seatId>` until S4 rekeys them. So a 🚧
 * `seated-member:<memberId>` participant ref, or a 🚧 `seated_member` owner
 * `{ kind: "seated_member", id: <memberId> }`, is translated at the door into
 * the stored key of the seat that member sits in (`seatOf`) — and every
 * reader and writer behind the door keeps working on stored keys alone. No
 * row is ever written under `seated_member` in S2.
 *
 * 🚧 S4 (plan §34.1): `memberFormOf` is the one translator the other way —
 * card form to member form — shared by the `seat-keys` boot pass and the
 * doors, which invert once the flip is on (`memberForm.ts`).
 *
 * ⚠ Must not statically import `$lib/server/db`; every function takes its
 * handle first.
 */
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { seatOf, type ResolvedSeat } from "$lib/server/sessions/seats"
import type { StateOwner } from "$lib/server/state/owners"
import { memberFormOn } from "$lib/server/state/memberForm"

// ─── Card form → member form (plan §34.1, S4) ────────────────────────────────

/** 🚧 One seat of a session as `memberFormOf` reads it (an envoy seat is never in the map). */
export interface SeatMapSeat {
	kind: "character" | "player"
	/** `session_characters.id` | `session_personas.id`. */
	seatId: number
	/** The seated cast member (`lorebook_bindings.id`); null for a member-less seat. */
	castMemberId: number | null
	/** `character_id` | `persona_id`; null for a card-less seat. */
	cardId: number | null
	/** `removed_at` is set. */
	departed: boolean
	/** `coalesce(position, 0)`. */
	position: number
}

/**
 * 🚧 Every seat of one session, in `seatOf`'s order (live before departed,
 * character seat before player seat, then position, then seat id). Load it
 * with `loadSeatMap`; `memberFormOf` reads it without a database.
 */
export interface SeatMap {
	sessionId: number
	seats: readonly SeatMapSeat[]
}

/** `seatOf`'s order: live first, then character seats, then position, then id. */
const bySeatOfOrder = (a: SeatMapSeat, b: SeatMapSeat): number =>
	Number(a.departed) - Number(b.departed) ||
	(a.kind === b.kind ? 0 : a.kind === "character" ? -1 : 1) ||
	a.position - b.position ||
	a.seatId - b.seatId

/** 🚧 Pure: a seat map from seat rows in any order (sorted into `seatOf`'s order). */
export function seatMapOf(
	sessionId: number,
	seats: readonly SeatMapSeat[]
): SeatMap {
	return { sessionId, seats: [...seats].sort(bySeatOfOrder) }
}

/**
 * 🚧 The session's seats for `memberFormOf`: one read of its character seats
 * (envoys left out, as `seatOf` leaves them out) and its player seats, live
 * and departed.
 */
export async function loadSeatMap(db: Db, sessionId: number): Promise<SeatMap> {
	const cs = schema.sessionCharacters
	const ps = schema.sessionPersonas
	const [characterSeats, playerSeats] = await Promise.all([
		db
			.select({
				seatId: cs.id,
				castMemberId: cs.castMemberId,
				cardId: cs.characterId,
				removedAt: cs.removedAt,
				position: cs.position
			})
			.from(cs)
			.where(and(eq(cs.sessionId, sessionId), isNull(cs.envoySlug))),
		db
			.select({
				seatId: ps.id,
				castMemberId: ps.castMemberId,
				cardId: ps.personaId,
				removedAt: ps.removedAt,
				position: ps.position
			})
			.from(ps)
			.where(eq(ps.sessionId, sessionId))
	])
	const seat =
		(kind: SeatMapSeat["kind"]) =>
		(r: {
			seatId: number
			castMemberId: number | null
			cardId: number | null
			removedAt: unknown
			position: number | null
		}): SeatMapSeat => ({
			kind,
			seatId: r.seatId,
			castMemberId: r.castMemberId ?? null,
			cardId: r.cardId ?? null,
			departed: r.removedAt != null,
			position: r.position ?? 0
		})
	return seatMapOf(sessionId, [
		...characterSeats.map(seat("character")),
		...playerSeats.map(seat("player"))
	])
}

/** The input forms `memberFormOf` translates. */
type SeatOwnerLike = { kind: unknown; id: unknown }

/**
 * A seat's member form, in the shape of the card-form input: a participant
 * ref (`seated-member:` / `player-seat:`), a state key (`seated_member:` /
 * `player_seat:`) or an owner. Null for a member-less character seat.
 */
function memberFormOfSeat(
	seat: SeatMapSeat,
	shape: "ref" | "key" | "owner"
): string | StateOwner | null {
	if (seat.kind === "player") {
		if (shape === "ref") return `player-seat:${seat.seatId}`
		if (shape === "key") return `player_seat:${seat.seatId}`
		return { kind: "player_seat", id: seat.seatId }
	}
	if (seat.castMemberId == null) return null
	if (shape === "ref") return `seated-member:${seat.castMemberId}`
	if (shape === "key") return `seated_member:${seat.castMemberId}`
	return { kind: "seated_member", id: seat.castMemberId }
}


const CARD_REF = /^character:(\d+)$/
const CARD_KEY = /^(\d+)$/

/** The card id a card-form input names, and the shape to answer in; null when the input is not card form. */
function cardFormOf(
	input: string | SeatOwnerLike
): { cardId: number; shape: "ref" | "key" | "owner" } | null {
	if (typeof input === "string") {
		const s = input.trim()
		const m = CARD_REF.exec(s) ?? CARD_KEY.exec(s)
		if (!m) return null
		const cardId = Number(m[1])
		if (!Number.isSafeInteger(cardId) || cardId <= 0) return null
		return { cardId, shape: s.startsWith("character:") ? "ref" : "key" }
	}
	if (
		input &&
		typeof input === "object" &&
		input.kind === "session_cast" &&
		Number.isSafeInteger(input.id) &&
		(input.id as number) > 0
	)
		return { cardId: input.id as number, shape: "owner" }
	return null
}

/** The seats holding `cardId`, in `seatOf`'s order (a character seat by `character_id`, a player seat by `persona_id`). */
const seatsOfCard = (map: SeatMap, cardId: number): SeatMapSeat[] =>
	map.seats.filter((s) => s.cardId === cardId)

/**
 * 🚧 PURE — the one translator from card form to member form (plan §34.1),
 * shared by the `seat-keys` boot pass and every runtime door.
 *
 * Card form in, three shapes, answered in the same shape:
 * - participant ref `character:<cardId>` → `seated-member:<memberId>` | `player-seat:<seatId>`;
 * - state key `<cardId>` (a `byId` / carries key, digits only) → `seated_member:<memberId>` | `player_seat:<seatId>`;
 * - owner `{ kind: "session_cast", id: <cardId> }` → `{ kind: "seated_member", id: <memberId> }` | `{ kind: "player_seat", id: <seatId> }`.
 *
 * The seat is exactly the one `seatOf("character:<cardId>")` returns (live
 * before departed, character seat before player seat, then position, then
 * seat id): a character seat answers its cast member, a player seat its seat
 * id. Null when no seat holds the card (a hard-deleted card) or the seat it
 * finds is a character seat with no member — the caller counts it and leaves
 * the row as it is.
 *
 * Anything that is not card form comes back unchanged — member forms, other
 * owners and other refs alike. A `seated-member:` / `seated_member` id is a
 * cast member id and is never read as a card id (the two share one range).
 *
 * The rare card held by a character seat AND player seat(s) answers the first
 * seat only; to copy one value to every seat (★K-2) use `memberFormTargetsOf`.
 */
export function memberFormOf(map: SeatMap, input: string): string | null
export function memberFormOf<O extends SeatOwnerLike>(
	map: SeatMap,
	input: O
): O | StateOwner | null
export function memberFormOf(
	map: SeatMap,
	input: string | SeatOwnerLike
): string | SeatOwnerLike | null {
	const card = cardFormOf(input)
	if (!card) return input
	const [seat] = seatsOfCard(map, card.cardId)
	return seat ? memberFormOfSeat(seat, card.shape) : null
}

/**
 * 🚧 PURE — every member form a card-form input stands for (★K-2): one per
 * seat that holds the card, in `seatOf`'s order, so a value the card's seats
 * shared is copied to each seat. Seats with no member form (a member-less
 * character seat) are skipped. The first entry is `memberFormOf`'s answer
 * whenever that is not null. Not card form → `[input]` unchanged; no seat →
 * `[]`.
 *
 * The `seat-keys` boot pass copies with it; runtime doors use `memberFormOf`.
 */
export function memberFormTargetsOf(map: SeatMap, input: string): string[]
export function memberFormTargetsOf<O extends SeatOwnerLike>(
	map: SeatMap,
	input: O
): (O | StateOwner)[]
export function memberFormTargetsOf(
	map: SeatMap,
	input: string | SeatOwnerLike
): (string | SeatOwnerLike)[] {
	const card = cardFormOf(input)
	if (!card) return [input]
	const out: (string | SeatOwnerLike)[] = []
	for (const seat of seatsOfCard(map, card.cardId)) {
		const target = memberFormOfSeat(seat, card.shape)
		if (target != null) out.push(target)
	}
	return out
}

/** The stored owner a resolved seat's values live under, in card form (flip off); null for a seat with no card that is not a player seat. */
function storedOwnerOfSeat(seat: ResolvedSeat): StateOwner | null {
	if (seat.cardId != null) return { kind: "session_cast", id: seat.cardId }
	if (seat.kind === "player") return { kind: "player_seat", id: seat.seatId }
	return null
}

/** 🚧 A resolved seat in member form (flip on): a player seat by its id, a character seat by its member; null for a member-less character seat. */
function memberOwnerOfSeat(seat: ResolvedSeat): StateOwner | null {
	if (seat.kind === "player") return { kind: "player_seat", id: seat.seatId }
	return seat.castMemberId != null ? { kind: "seated_member", id: seat.castMemberId } : null
}

const SEATED_MEMBER_REF = /^seated-member:(\d+)$/

/**
 * 🚧 A participant ref as the session stores it.
 *
 * Flip off (`memberForm.ts`, S2/S3): a `seated-member:<memberId>` is read as
 * its seat's card-form ref — `character:<cardId>` for a seat with a card (a
 * carded player seat is its card), `player-seat:<seatId>` for a card-less
 * player seat. Any other ref comes back unchanged. Null when the member has
 * no seat in the session (or sits only in a seat with neither card nor player).
 *
 * 🚧 Flip on (S4, the door kept until S5 for plugins, Mundi's `cardRef`
 * fallback and old tabs): a `character:<cardId>` is read as its seat's member
 * form through `memberFormOf` — `seated-member:<memberId>` or
 * `player-seat:<seatId>` — and a `seated-member:<memberId>` of a member who
 * sits only in a player seat as that seat's `player-seat:<seatId>`. A
 * card-form input the translator can't answer comes back unchanged (a
 * member-less character seat keeps card form until S5). Any other ref comes
 * back unchanged. Null when no seat answers a `seated-member:` ref.
 */
export async function storedSeatRef(
	db: Db,
	sessionId: number,
	ref: string
): Promise<string | null> {
	if (memberFormOn()) {
		const s = ref.trim()
		if (CARD_REF.test(s))
			return memberFormOf(await loadSeatMap(db, sessionId), s) ?? s
		if (!SEATED_MEMBER_REF.test(s)) return ref
		const seat = await seatOf(db, sessionId, s)
		const owner = seat ? memberOwnerOfSeat(seat) : null
		if (!owner) return null
		return owner.kind === "seated_member"
			? `seated-member:${owner.id}`
			: `player-seat:${owner.id}`
	}
	if (!SEATED_MEMBER_REF.test(ref.trim())) return ref
	const seat = await seatOf(db, sessionId, ref)
	const owner = seat ? storedOwnerOfSeat(seat) : null
	if (!owner) return null
	return owner.kind === "session_cast"
		? `character:${owner.id}`
		: `player-seat:${owner.id}`
}

/** True when `owner` is a 🚧 `seated_member` owner `{ kind: "seated_member", id }`. */
export const isSeatedMemberOwner = (
	owner: unknown
): owner is { kind: "seated_member"; id: number } =>
	!!owner &&
	typeof owner === "object" &&
	(owner as { kind?: unknown }).kind === "seated_member" &&
	Number.isSafeInteger((owner as { id?: unknown }).id) &&
	((owner as { id: number }).id ?? 0) > 0

/**
 * 🚧 An owner as the session stores it.
 *
 * Flip off (`memberForm.ts`): `{ kind: "seated_member", id: <memberId> }` is
 * read as its seat's card-form owner — `session_cast` by the seat's card, or
 * `player_seat` by a card-less player seat's id. Any other owner comes back
 * unchanged (it is not validated here). Null when the member has no such seat
 * in the session.
 *
 * 🚧 Flip on (S4, the door kept until S5): `{ kind: "session_cast", id:
 * <cardId> }` is read as its seat's member form through `memberFormOf` —
 * `seated_member` by the seat's member, or `player_seat` by the seat's id —
 * and a `seated_member` owner of a member who sits only in a player seat as
 * that seat's `player_seat`. A card-form input the translator can't answer
 * comes back unchanged (a member-less character seat keeps card form until
 * S5). Any other owner comes back unchanged. Null when no seat answers a
 * `seated_member` owner.
 */
export async function storedSeatOwner<O extends { kind: unknown; id: unknown }>(
	db: Db,
	sessionId: number,
	owner: O
): Promise<O | StateOwner | null> {
	if (memberFormOn()) {
		if (isSeatedMemberOwner(owner)) {
			const seat = await seatOf(db, sessionId, `seated-member:${owner.id}`)
			return seat ? memberOwnerOfSeat(seat) : null
		}
		if (owner && typeof owner === "object" && owner.kind === "session_cast")
			return (
				(memberFormOf(await loadSeatMap(db, sessionId), owner) as
					| O
					| StateOwner
					| null) ?? owner
			)
		return owner
	}
	if (!isSeatedMemberOwner(owner)) return owner
	const seat = await seatOf(db, sessionId, `seated-member:${owner.id}`)
	return seat ? storedOwnerOfSeat(seat) : null
}
