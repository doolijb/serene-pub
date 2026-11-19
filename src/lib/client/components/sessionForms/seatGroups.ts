/**
 * Pure helpers of the Participants tab's seat groups: the player seats in
 * one group per person, the "Played by" choices, and the handovers a draft
 * sends. The form owns the draft; these only compute.
 */

/** One "Played by" choice: the person's user id as a string, and the words. */
export type PlayedByOption = { value: string; label: string }

/**
 * Move the row at `index` past the nearest row of the same group, in the one
 * session-wide order: the two positions swap, every other row stays. No such
 * neighbour (the group's end): the order, unchanged.
 */
export function swapWithinGroup<T>(
	order: readonly T[],
	index: number,
	delta: -1 | 1,
	inGroup: (row: T) => boolean
): T[] {
	const next = order.slice()
	for (let j = index + delta; j >= 0 && j < next.length; j += delta) {
		if (!inGroup(next[j])) continue
		;[next[index], next[j]] = [next[j], next[index]]
		return next
	}
	return next
}

/**
 * Fill a group's slots of the session-wide order with the group's new order.
 * Rows of other groups keep their positions. A group that gained rows keeps
 * the extra ones after its last slot; one that lost rows closes its slots up.
 * With one group (every row in it) the result is `items`.
 */
export function fillGroupSlots<T>(
	order: readonly T[],
	inGroup: (row: T) => boolean,
	items: readonly T[]
): T[] {
	const out: T[] = []
	const lastSlot = order.reduce((at, r, i) => (inGroup(r) ? i : at), -1)
	let k = 0
	order.forEach((row, i) => {
		if (!inGroup(row)) {
			out.push(row)
			return
		}
		if (k < items.length) out.push(items[k++])
		if (i === lastSlot) while (k < items.length) out.push(items[k++])
	})
	if (lastSlot === -1) while (k < items.length) out.push(items[k++])
	return out
}

/**
 * The people a group can be headed by: the session's people in order (the
 * owner, then the saved guests), then any other player found on a seat.
 */
export function groupPeople(
	people: readonly number[],
	onSeats: readonly number[]
): number[] {
	const out = [...people]
	for (const id of onSeats) if (!out.includes(id)) out.push(id)
	return out
}

/**
 * The handovers the draft holds that differ from the saved person, sorted by
 * key, as the form's `data` carries them.
 */
export function differingHandovers(
	draft: ReadonlyMap<string, number>,
	savedPerson: (key: string) => number | null | undefined
): Array<{ key: string; toUserId: number }> {
	return [...draft.entries()]
		.filter(([key, to]) => savedPerson(key) !== to)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, toUserId]) => ({ key, toUserId }))
}

/** A draft key to the seat the socket write names. */
export function handoverSeatOf(key: string): {
	characterId?: number
	castMemberId?: number
	playerSeatId?: number
} {
	const [kind, id] = key.split(":")
	const n = Number(id)
	if (kind === "character") return { characterId: n }
	if (kind === "member") return { castMemberId: n }
	return { playerSeatId: n }
}

/** A card-less cast member or a named seat the owner picked for a person, held until Save. */
export type PendingPlayerSeat = {
	/** `member:<castMemberId>` or `name:<n>`, never random. */
	key: string
	toUserId: number
	castMemberId?: number
	seatName?: string
	name: string
}

/**
 * The seats the owner names for other people, as `sessions:update`'s
 * `playerSeatsFor` takes them: a pending card whose person is not the owner,
 * then each pending card-less row.
 */
export function playerSeatsForOf(
	cardFor: ReadonlyMap<number, number>,
	pending: readonly PendingPlayerSeat[],
	ownerId: number | null
): Array<{
	toUserId: number
	characterId?: number
	castMemberId?: number
	seatName?: string
}> {
	return [
		...[...cardFor.entries()]
			.filter(([, to]) => to !== ownerId)
			.map(([characterId, toUserId]) => ({ characterId, toUserId })),
		...pending.map((p) =>
			p.castMemberId != null
				? { castMemberId: p.castMemberId, toUserId: p.toUserId }
				: { seatName: p.seatName, toUserId: p.toUserId }
		)
	]
}

/** The "Played by" value that moves a player seat to the AI-played group. */
export const MOVE_TO_AI = "ai"

const MOVE_TO_PERSON = "persona:"

/** The "Played by" value that moves a character seat to a person's Personas group. */
export const moveToPersonValue = (userId: number): string =>
	`${MOVE_TO_PERSON}${userId}`

/** Whether a "Played by" value is a move choice (never a user id). */
export const isMoveValue = (value: string): boolean =>
	value === MOVE_TO_AI || value.startsWith(MOVE_TO_PERSON)

/** The person a move-to-person value names. */
export const moveTargetOf = (value: string): number | null =>
	value.startsWith(MOVE_TO_PERSON)
		? Number(value.slice(MOVE_TO_PERSON.length))
		: null

/** One move as `sessions:update`'s `seatMoves` takes it. */
export type SeatMove =
	| { playerSeatId: number }
	| { characterSeatId: number; toUserId: number }

/**
 * The moves a draft holds, sorted by key. A draft key is `player:<seat id>`
 * (to the AI-played group), or `character:<card id>` / `member:<cast member
 * id>` with a move-to-person value; `characterSeatIdOf` names the saved
 * character seat of the latter. A key whose seat is gone sends nothing.
 */
export function seatMovesOf(
	draft: ReadonlyMap<string, string>,
	characterSeatIdOf: (key: string) => number | null | undefined
): SeatMove[] {
	const out: SeatMove[] = []
	for (const [key, value] of [...draft.entries()].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0
	)) {
		if (key.startsWith("player:")) {
			if (value === MOVE_TO_AI)
				out.push({ playerSeatId: Number(key.slice(7)) })
			continue
		}
		const toUserId = moveTargetOf(value)
		const characterSeatId = characterSeatIdOf(key)
		if (toUserId != null && characterSeatId != null)
			out.push({ characterSeatId, toUserId })
	}
	return out
}
