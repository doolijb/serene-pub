/**
 * 🚧 Seat identity on the client (s27 S3): who a seat, a ref or a line names,
 * read off what the host fills in the session payload — a seat's `ref` and
 * `cardId`, a message's `castMemberId` — so consumers work on today's
 * card-keyed data and on member-keyed data alike.
 *
 * Two rules: the host fills and consumers read, falling back to the card
 * form (⏳, kept until S5) only when a field is absent — a card-form payload; and a consumer looks a seat or a
 * cast entry up by what it carries, never parsing an id out of a ref or a key.
 *
 * A leaf: types only, no imports.
 */

/** 🚧 A seat row as the session payload carries it — structural, so the page's session and a fixture both fit. */
export interface PayloadSeat {
	id?: number | null
	/** A character seat's card. */
	characterId?: number | null
	/** A player seat's card. */
	personaId?: number | null
	/** The seat's cast member (s27 S1). */
	castMemberId?: number | null
	envoySlug?: string | null
	position?: number | null
	removedAt?: unknown
	/** 🚧 The seat's participant ref, when the host fills it (s27 S3). */
	ref?: string | null
	/** 🚧 The member's active card on the timeline, when the host fills it (s27 S3). */
	cardId?: number | null
}

/** 🚧 The two seat tables of a session payload. */
export interface SeatsPayload<
	C extends PayloadSeat = PayloadSeat,
	P extends PayloadSeat = PayloadSeat
> {
	sessionCharacters?: readonly C[] | null
	sessionPersonas?: readonly P[] | null
}

/** 🚧 A seat found, with the table it sits in. */
export interface SeatFound<S extends PayloadSeat = PayloadSeat> {
	seat: S
	form: "character" | "player"
}

/** 🚧 The message columns that say who spoke a line. */
export interface SeatMessage {
	characterId?: number | null
	personaId?: number | null
	/** The speaker's seat member, stamped at write. */
	castMemberId?: number | null
	metadata?: unknown
	/** The line's role: `"user"` for a person's line, `"assistant"` for a character's. */
	role?: string | null
	isNarratorResponse?: boolean | null
}

type Form = SeatFound["form"]

const hostRef = (seat: PayloadSeat): string | null =>
	typeof seat.ref === "string" && seat.ref ? seat.ref : null

/**
 * 🚧 The participant ref of a seat: the host-filled `ref` when there is one;
 * else ⏳ today's form — a character seat `character:<characterId>` (null
 * with no card or for an envoy's seat), a player seat `character:<personaId>`
 * when it voices a card, else `player-seat:<id>` (null with no id).
 */
export function seatRefOf(seat: PayloadSeat, form: Form): string | null {
	const filled = hostRef(seat)
	if (filled) return filled
	if (form === "character")
		return seat.characterId != null && !seat.envoySlug
			? `character:${seat.characterId}`
			: null
	return seat.personaId != null
		? `character:${seat.personaId}`
		: seat.id != null
			? `player-seat:${seat.id}`
			: null
}

/**
 * Every seat a ref or a member can name, in the order the server's `seatOf`
 * (`sessions/seats.ts`) chooses: a live seat (`removedAt` falsy) before a
 * departed one, in either table; then a character seat before a player seat;
 * then the lowest `position` (null counts as 0), then the lowest seat `id`
 * (null as 0), then payload order. An envoy's seat is never chosen. This must
 * change with `seatOf`.
 */
function seatsInOrder<C extends PayloadSeat, P extends PayloadSeat>(
	session: SeatsPayload<C, P> | null | undefined
): SeatFound<C | P>[] {
	const all: SeatFound<C | P>[] = [
		...(session?.sessionCharacters ?? [])
			.filter((seat) => !seat.envoySlug)
			.map((seat) => ({ seat, form: "character" as const })),
		...(session?.sessionPersonas ?? [])
			.filter((seat) => !seat.envoySlug)
			.map((seat) => ({ seat, form: "player" as const }))
	]
	return all.sort(
		(a, b) =>
			Number(!!a.seat.removedAt) - Number(!!b.seat.removedAt) ||
			Number(a.form === "player") - Number(b.form === "player") ||
			(a.seat.position ?? 0) - (b.seat.position ?? 0) ||
			(a.seat.id ?? 0) - (b.seat.id ?? 0)
	)
}

/** The first of `seats` holding the member, preferring one form when asked. */
function holding<S extends PayloadSeat>(
	seats: SeatFound<S>[],
	castMemberId: number,
	prefer?: Form
): SeatFound<S> | null {
	const held = seats.filter((f) => f.seat.castMemberId === castMemberId)
	if (prefer) {
		const first = held.find((f) => f.form === prefer)
		if (first) return first
	}
	return held[0] ?? null
}

/** The seat a ref names, looked up in `seats` (already in seat order). */
function naming<S extends PayloadSeat>(
	seats: SeatFound<S>[],
	ref: string
): SeatFound<S> | null {
	return (
		seats.find((f) => seatRefOf(f.seat, f.form) === ref) ??
		// A seat that took a card keeps answering to its seat ref.
		seats.find(
			(f) =>
				f.form === "player" &&
				f.seat.id != null &&
				`player-seat:${f.seat.id}` === ref
		) ??
		seats.find(
			(f) =>
				f.seat.castMemberId != null &&
				`seated-member:${f.seat.castMemberId}` === ref
		) ??
		null
	)
}

/**
 * 🚧 The seat holding a cast member, in seat order; with `prefer`, a seat of
 * that form first (each group in seat order), then the other form. Null for
 * no member or no seat.
 */
export function seatOfCastMember<C extends PayloadSeat, P extends PayloadSeat>(
	session: SeatsPayload<C, P> | null | undefined,
	castMemberId: number | null | undefined,
	prefer?: Form
): SeatFound<C | P> | null {
	if (castMemberId == null) return null
	return holding(seatsInOrder(session), castMemberId, prefer)
}

/**
 * 🚧 The seat a ref names, looked up and never parsed: the first seat (in
 * seat order) whose own ref is it; else the player seat whose `player-seat:<id>`
 * it is; else the seat whose `seated-member:<castMemberId>` it is.
 */
export function seatOfRef<C extends PayloadSeat, P extends PayloadSeat>(
	session: SeatsPayload<C, P> | null | undefined,
	ref: string | null | undefined
): SeatFound<C | P> | null {
	if (!ref) return null
	return naming(seatsInOrder(session), ref)
}

/**
 * 🚧 The seat a line was spoken from, found by the line's stamp. A narrator
 * line finds nothing. The line's form: a `personaId` is a player's; a
 * `characterId` a character's; with neither (a card-less seat's line) a
 * `role` of `"user"` is a player's, any other role a character's. Then, in
 * order: the seat a stamped speaker (`metadata.speaker`) names, among every
 * seat of both tables; the seat of the line's form holding its `castMemberId`
 * (so a member holding both seats never turns a person's line into the
 * character's); ⏳ the seat of that form on the line's card column, until S5.
 * An envoy's line finds nothing.
 */
export function seatOfMessage<C extends PayloadSeat, P extends PayloadSeat>(
	session: SeatsPayload<C, P> | null | undefined,
	msg: SeatMessage
): SeatFound<C | P> | null {
	if (msg.isNarratorResponse) return null
	const seats = seatsInOrder(session)
	const said = (msg.metadata as { speaker?: unknown } | null | undefined)
		?.speaker
	if (typeof said === "string" && said) {
		const named = naming(seats, said)
		if (named) return named
	}
	const form: Form =
		msg.personaId != null
			? "player"
			: msg.characterId != null
				? "character"
				: msg.role === "user"
					? "player"
					: "character"
	const ofForm = seats.filter((f) => f.form === form)
	return (
		(msg.castMemberId != null ? holding(ofForm, msg.castMemberId) : null) ??
		// ⏳ The card column, until S5 drops the card columns.
		(form === "player" && msg.personaId != null
			? ofForm.find((f) => f.seat.personaId === msg.personaId)
			: form === "character" && msg.characterId != null
				? ofForm.find((f) => f.seat.characterId === msg.characterId)
				: undefined) ??
		null
	)
}

/**
 * 🚧 The ref a line's speaker carries: the ref of the seat `seatOfMessage`
 * finds (`seatRefOf`), for every line — a card-less player seat's line
 * carries its `player-seat:<id>` (★S3W-1). With no seat, ⏳ the line's own
 * card columns, `character:<characterId>`, else `character:<personaId>`,
 * else null.
 */
export function messageRefOf<C extends PayloadSeat, P extends PayloadSeat>(
	session: SeatsPayload<C, P> | null | undefined,
	msg: SeatMessage
): string | null {
	const found = seatOfMessage(session, msg)
	const filled = found ? seatRefOf(found.seat, found.form) : null
	if (filled) return filled
	return msg.characterId
		? `character:${msg.characterId}`
		: msg.personaId
			? `character:${msg.personaId}`
			: null
}

/** 🚧 A `state.cast.byId` map: entries by key, each of a seat's member. */
export type CastById = Readonly<
	Record<string, Record<string, unknown> | undefined>
>

/**
 * 🚧 The `state.cast.byId` entry a ref names: the entry whose host-filled
 * `ref` is it, else the one whose `seated-member:<castMemberId>` it is. ⏳
 * Only while no entry carries a `ref` (a host before S3), today's key: a
 * `player-seat:<id>` ref is `byId["player_seat:<id>"]`, a `character:<id>`
 * ref is `byId["<id>"]`. Never while any entry carries one — a card id would
 * then hit a member's key, the wrong person.
 */
export function castEntryOf(
	byId: CastById | null | undefined,
	ref: string | null | undefined
): Record<string, unknown> | undefined {
	if (!byId || !ref) return undefined
	const entries = Object.values(byId).filter(
		(e): e is Record<string, unknown> => !!e && typeof e === "object"
	)
	const withRef = entries.find((e) => e.ref === ref)
	if (withRef) return withRef
	const ofMember = entries.find(
		(e) =>
			typeof e.castMemberId === "number" &&
			`seated-member:${e.castMemberId}` === ref
	)
	if (ofMember) return ofMember
	if (entries.some((e) => typeof e.ref === "string")) return undefined
	return byId[
		ref.startsWith("player-seat:")
			? `player_seat:${ref.slice(12)}`
			: ref.replace(/^character:/, "")
	]
}

/** 🚧 The `state.cast.byId` entry of a cast member. */
export function castEntryOfMember(
	byId: CastById | null | undefined,
	castMemberId: number | null | undefined
): Record<string, unknown> | undefined {
	if (!byId || castMemberId == null) return undefined
	return Object.values(byId).find(
		(e): e is Record<string, unknown> =>
			!!e && e.castMemberId === castMemberId
	)
}
