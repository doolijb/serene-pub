/**
 * 🚧 Who a person may speak as in a session — one rule, both halves.
 *
 * A **player seat** (a `session_personas` row) is a person's voice when it
 * carries their card (`persona_id`, the card's owner theirs) or when it is a
 * live card-less seat with a name (`isCardlessPlayerSeat`) that is theirs
 * (`user_id`), and in play (live and not benched, `inPlay`; owner 2026-11-10).
 * The page's send gate, composer and turn controls read it
 * (`sessionPageData`); the server stamps a card-less line with the same
 * test (`cardlessPlayerSeatOf`).
 */
import { inPlay } from "./inPlay"

/** The fields every read of a seat carries — the client's and the server's. */
export interface PlayerSeatLike {
	id?: number
	personaId?: number | null
	persona?: { userId?: number | null; name?: string | null } | null
	userId?: number | null
	seatName?: string | null
	removedAt?: unknown
	isActive?: boolean | null
}

/**
 * 🚧 A live card-less player seat with a name: a player character with no card. The
 * one test every reader of seats makes — a row with neither a card nor a
 * name is a departed card's leftover, and nobody. Reads a row as any read
 * carries it: `personaId` and/or the joined `persona`, `seatName`,
 * `removedAt`. A shape test reading `removedAt` only — a benched seat is still
 * one (sheets, access and names; the speaker tests add `inPlay`).
 */
export const isCardlessPlayerSeat = (seat: {
	personaId?: number | null
	persona?: unknown
	seatName?: string | null
	removedAt?: unknown
}): boolean =>
	seat.personaId == null && seat.persona == null && !!seat.seatName?.trim() && !seat.removedAt

/** Whether this seat is `userId`'s voice: their card, or their named card-less seat. */
export function isOwnPlayerSeat(seat: PlayerSeatLike, userId: number | null | undefined): boolean {
	if (userId == null || !inPlay(seat)) return false
	if (seat.personaId != null || seat.persona != null)
		return (seat.persona?.userId ?? seat.userId) === userId
	return isCardlessPlayerSeat(seat) && seat.userId === userId
}

/**
 * 🚧 Whether a guest's composer asks them to join ("Join the conversation —
 * Add your persona"): a guest, in a genre with personas, with no voice of
 * their own here — no card and no live named card-less seat
 * (`isOwnPlayerSeat`). A player seated by an interview has a voice and is
 * never asked (round 2, 2026-10-15).
 */
export function asksToJoin(opts: {
	isGuest: boolean
	personasInMode: boolean
	seats: readonly PlayerSeatLike[] | null | undefined
	userId: number | null | undefined
	/**
	 * 🚧 The genre's player label (`playerLabel`), when it declares one —
	 * a genre of player seats (2026-10-16). With it, a member who may open
	 * a card-less seat (`mayOpenCardlessSeat`) is never asked for a persona:
	 * their seat is opened by name, not by a card.
	 */
	playerLabel?: string | null
	/** 🚧 Whether the viewer is a player of the session (`session_guests.is_player`). */
	isPlayer?: boolean
}): boolean {
	if (!opts.isGuest || !opts.personasInMode) return false
	if (opts.playerLabel?.trim() && mayOpenCardlessSeat({ isOwner: false, isPlayer: opts.isPlayer }))
		return false
	return !(opts.seats ?? []).some((s) => isOwnPlayerSeat(s, opts.userId))
}

/**
 * 🚧 Whether a guest's story composer offers them a **seat** instead
 * ("Take a seat": name the character you'll play, or bring a persona — Lair
 * rewrite D5, 2026-10-21): the other half of `asksToJoin`'s rule for a genre
 * of player seats (one that declares a `playerLabel`). A guest who plays
 * (`mayOpenCardlessSeat`), in such a genre, with no voice of their own here,
 * is never asked for a persona — their seat is opened by name — and until
 * it is, their line would be the game master's. Only on the story (`main`):
 * a genre that seats people another way (Dungeon Crawler's interview, on its
 * Planner lane) closes the story's composer until then, and a closed
 * composer's reason wins.
 */
export function offersSeat(opts: {
	isGuest: boolean
	personasInMode: boolean
	seats: readonly PlayerSeatLike[] | null | undefined
	userId: number | null | undefined
	playerLabel?: string | null
	isPlayer?: boolean
}): boolean {
	if (!opts.isGuest || !opts.personasInMode || !opts.playerLabel?.trim()) return false
	if (!mayOpenCardlessSeat({ isOwner: false, isPlayer: opts.isPlayer })) return false
	return !(opts.seats ?? []).some((s) => isOwnPlayerSeat(s, opts.userId))
}

/**
 * 🚧 Whether a member may open a card-less player seat for themselves — the
 * server's rule (`writeSeatName`): the session's owner, or a guest who
 * plays. Absent `isPlayer` reads as a player, the column's default.
 */
export const mayOpenCardlessSeat = (opts: { isOwner: boolean; isPlayer?: boolean | null }): boolean =>
	opts.isOwner || opts.isPlayer !== false

/** Whether a seat is anyone's voice — a card, or a named card-less seat, in play. */
export const isLivePlayerSeat = (seat: PlayerSeatLike): boolean =>
	inPlay(seat) && (seat.personaId != null || isCardlessPlayerSeat(seat))

/**
 * 🚧 Whether the viewer is benched and nothing else: no player seat of theirs
 * in play (`isOwnPlayerSeat`) and at least one live seat of theirs on the
 * bench (`!removedAt && isActive === false`; owner ruling 2026-11-11). Their
 * page offers no "Join" / "Take a seat" / persona then — the composer closes
 * with `BENCHED_ONLY_GUEST` / `BENCHED_ONLY_OWNER`.
 */
export function benchedOnly(opts: {
	seats: readonly PlayerSeatLike[] | null | undefined
	userId: number | null | undefined
}): boolean {
	const me = opts.userId
	if (me == null) return false
	const seats = opts.seats ?? []
	if (seats.some((s) => isOwnPlayerSeat(s, me))) return false
	return seats.some((s) => !s.removedAt && s.isActive === false && (s.userId ?? s.persona?.userId) === me)
}

/** 🚧 The line a benched-only guest's composer and turn controls close with. */
export const BENCHED_ONLY_GUEST = "You're on the bench — the owner can bring you back."
/** 🚧 The same, for the session's owner whose own seat is benched. */
export const BENCHED_ONLY_OWNER = "You're on the bench — bring yourself back in Participants."

/** `userId`'s own card-less seats, in the order given (position). */
export const ownCardlessPlayerSeats = <S extends PlayerSeatLike>(
	seats: readonly S[] | null | undefined,
	userId: number | null | undefined
): S[] =>
	(seats ?? []).filter((s) => isCardlessPlayerSeat(s) && isOwnPlayerSeat(s, userId))

/**
 * 🚧 Whom the viewer writes as with no persona, as the composer writes it
 * after "Write as" (`ConversationComposerV1.playerLabel`): their own
 * card-less player seat by its name ("Ann"), else the genre's label with
 * its article ("the Adventurer"), else nothing. A seat's name is a person,
 * never a role, so it takes no article.
 */
export function composerWritingAs(opts: {
	ownSeat?: Pick<PlayerSeatLike, "seatName"> | null
	playerLabel?: string | null
}): string | undefined {
	const seat = opts.ownSeat?.seatName?.trim()
	if (seat) return seat
	const label = opts.playerLabel?.trim()
	return label ? `the ${label}` : undefined
}
