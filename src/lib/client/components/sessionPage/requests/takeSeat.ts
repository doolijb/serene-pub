/**
 * 🚧 `take-seat` (core only, Lair rewrite D5, 2026-10-21): a guest who plays
 * takes a seat by naming the character they will play — a card-less player
 * seat, the session's seat-name write (`sessions:update`'s `seatName`, which
 * opens one for a caller with none). Their lines are then that character's
 * turns. A blank name is refused; so is one past {@link SEAT_NAME_MAX}.
 */

/** The longest seat name the composer sends. */
export const SEAT_NAME_MAX = 80

/** What this answer needs of the page. */
export interface TakeSeatDeps {
	/** Open the viewer's seat under `name` (trimmed, non-blank). */
	takeSeat(name: string): void
}

/** Answer one `take-seat`. */
export function answerTakeSeat(params: unknown, deps: TakeSeatDeps): void {
	const raw = (params as { name?: unknown } | null | undefined)?.name
	const name = typeof raw === "string" ? raw.trim() : ""
	if (!name) throw new Error("Name the character you'll play.")
	if (name.length > SEAT_NAME_MAX)
		throw new Error(`A character's name is at most ${SEAT_NAME_MAX} characters.`)
	deps.takeSeat(name)
}
