/**
 * Who this world holds at the moment being read.
 *
 * The question the Lives lens answers in pictures, answered as a list: given
 * the cast as they resolve on this line at this moment, who is actually *here*
 * — and where one person is here more than once, say so, because that is the
 * fact a reader will not otherwise believe.
 *
 * ⚠ **Presence is not existence.** A member who has not arrived, or who has
 * left, still exists as a row: they are simply not in the world at this point.
 * `nodeState` is the author's own tracking of that, so it is what we read.
 *
 * ⚠ Pure. The resolving happened before this — these rows are already read
 * as-of (`resolveCast`), so nothing here knows about amendments or branches.
 * What it does know is that a carded member is NAMED by their card, so an
 * amendment that swaps the card shows a different person standing in the room.
 */

/** A cast row, as much of it as presence and naming need. */
export interface RosterRow {
	id: number
	name?: string | null
	nodeState?: string | null
	/** Which card is drawing them at this moment, where one is. */
	characterId?: number | null
	/**
	 * Which point of their own life this reading is. Absent until personal
	 * tracks land; present, it is what distinguishes two of one person.
	 */
	personalPosition?: number | null
}

/** One person, in the world, at one point of their own life. */
export interface Inhabitant {
	/** Unique per APPEARANCE, never per member — two of her need two keys. */
	key: string
	castId: number
	name: string
	initial: string
	/** What distinguishes this appearance, when something must. */
	aspect: string | null
	/** This member is in the world more than once right now. */
	alsoHere: boolean
}

/**
 * States that mean "not in the world right now".
 *
 * ⚠ An unknown state counts as PRESENT. A book that has never touched the
 * field should show its whole cast, and a state some future genre invents
 * should not quietly empty the room.
 */
const ABSENT = new Set(["departed", "dead", "gone", "not-yet", "unborn"])

export function isPresent(row: RosterRow): boolean {
	const state = (row.nodeState ?? "").trim().toLowerCase()
	return state === "" || !ABSENT.has(state)
}

const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase()

/**
 * The world's inhabitants, in name order, with duplicates marked.
 *
 * ⚠ Ordered by name and then by position, so two of one person sit together
 * and the younger is first — a life read in the order it was lived, even when
 * the story is not.
 */
export function worldRoster(
	rows: readonly RosterRow[],
	/** How to name the card someone is drawn with, where that is known. */
	cardName?: (characterId: number) => string | undefined
): Inhabitant[] {
	const here = rows.filter(isPresent)
	const seen = new Map<number, number>()
	for (const row of here) seen.set(row.id, (seen.get(row.id) ?? 0) + 1)

	return here
		.map((row) => {
			const twice = (seen.get(row.id) ?? 0) > 1
			const card =
				row.characterId != null
					? cardName?.(row.characterId)
					: undefined
			// ⚠ **The card NAMES them**, as the Cast list already does. The
			// binding's own `name` is frozen at whatever it was seeded with, so
			// using it showed one unchanging name with the live card muttering
			// underneath — the amendment resolved, and the room did not look
			// any different. A member with no card keeps their own name.
			const name = (card ?? row.name ?? "").trim() || "Unnamed"
			// An aspect earns its line only when it tells two apart.
			const aspect =
				row.personalPosition != null
					? `age ${row.personalPosition}`
					: null
			return {
				key: `cast#${row.id}@${row.personalPosition ?? "now"}`,
				castId: row.id,
				name,
				initial: initialOf(name),
				aspect,
				alsoHere: twice
			}
		})
		.sort(
			(a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
		)
}

/**
 * The chip's sentence. Leads with the remarkable thing when there is one.
 *
 * "6 in the world" is a count; "6 in the world · 2 of Verity" is news.
 */
export function worldRosterLine(inhabitants: readonly Inhabitant[]): string {
	if (!inhabitants.length) return "nobody here"
	const doubled = new Set(
		inhabitants.filter((i) => i.alsoHere).map((i) => i.name)
	)
	const base = `${inhabitants.length} in the world`
	if (!doubled.size) return base
	const [first] = [...doubled]
	return doubled.size === 1
		? `${base} · 2 of ${first}`
		: `${base} · ${doubled.size} doubled`
}
