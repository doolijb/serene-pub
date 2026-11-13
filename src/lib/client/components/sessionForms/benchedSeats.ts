/**
 * 🚧 Benched seats on the Participants tab: the two facts the host fills on
 * a benched seat row (`hasLines`, `fellInStory` on `sessions:get`), read once.
 *
 * A seat is benched when it is live and `isActive` is false (`inPlay`). Core
 * never benches on its own, so what the tab shows beside a benched row is
 * only what the row itself says: that its story fell (`seatFellInStory`) and
 * whether it has any lines (`seatHasNoLines`, which gates Remove).
 *
 * Pure, so the form and its tests share one reading.
 */
import { inPlay } from "$lib/shared/sessions/inPlay"

/** A player seat as `session.sessionPersonas` carries it. */
type PlayerSeatRow = {
	id: number
	removedAt?: unknown
	isActive?: boolean | null
	personaId?: number | null
	userId?: number | null
	persona?: { userId?: number | null } | null
}

/** The session, as far as fallen seats read it. */
type BenchedSeatsSession = {
	sessionPersonas?: ReadonlyArray<PlayerSeatRow> | null
}

/**
 * Whether the seat's story ended: **(a)** the host marked the row
 * `fellInStory` (host-filled on `sessions:get`; absent reads false), or **(b)** for a
 * player seat only, it is benched and a later live card-less seat of the same
 * player follows it (a death retired the seat and the player made a new
 * character).
 */
export function seatFellInStory(
	session: BenchedSeatsSession | null | undefined,
	row: object,
	kind: "character" | "player"
): boolean {
	if ((row as { fellInStory?: unknown }).fellInStory === true) return true
	if (kind !== "player") return false
	const seat = row as PlayerSeatRow
	if (seat.removedAt || inPlay(seat)) return false
	const player = seat.userId ?? seat.persona?.userId ?? null
	if (player == null) return false
	return (session?.sessionPersonas ?? []).some(
		(o) =>
			o.id > seat.id &&
			!o.removedAt &&
			o.personaId == null &&
			o.userId === player
	)
}

/**
 * Whether the seat has no lines, so a soft Remove is safe. Only a row the
 * host marked `hasLines === false` (host-filled on `sessions:get`) says so; absent reads
 * false, which hides Remove.
 */
export function seatHasNoLines(row: object): boolean {
	return (row as { hasLines?: unknown }).hasLines === false
}
