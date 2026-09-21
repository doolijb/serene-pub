/**
 * The message venue's per-row published values — `item.<field>` (plans/29
 * R-15 *enabled-when*; plans/30 U5e, 2026-09-17).
 *
 * One pure shape both sides build: the server at the door from the real row
 * (`entities/publishedValues.ts`), the client per rendered row from what it
 * already knows (`messageVerbState.ts`). A field added here is added for
 * both, which is what lets a listing hand the client the `item.*` predicates
 * it could not evaluate without a message and trust the answer to match the
 * door's.
 */

/** The message venue's per-row facts, as `item.<field>`. */
export interface ItemValues {
	id: number
	/** No later message on this channel — retry, continue and swipe act here only. */
	isNewest: boolean
	hidden: boolean
	generating: boolean
	/** The row's `role` column: `user`, `assistant`, … */
	role: string
	/** The item rule's answer for the viewer or actor (`canActOnMessage` / `canControl`). */
	mine: boolean
	/**
	 * A swipe to the right exists: a stored alternative after the one
	 * showing, or — on a reply that is not a greeting — the fresh one the
	 * reply road would write. A greeting's alternatives are its card's, so
	 * on its last one there is nothing to swipe to.
	 */
	hasSwipes: boolean
	/** A card's greeting (`metadata.isGreeting`): swiped, never regenerated. */
	greeting: boolean
	/**
	 * Which channel the row is on (20 §7; R-C) — the stored string, lane
	 * included. `main` for every row that names none, which is every row in
	 * every session whose genre declares no channel of its own.
	 *
	 * Here because a genre with two channels has verbs that belong to one of
	 * them: a writing room's *Rewrite* acts on the manuscript and must not be
	 * offered on the conversation. `venue.channel` is the declared way to say
	 * that and cannot be relied on yet — a listing is built for ONE channel
	 * and the client asks for none — so an `item.channel` predicate is what
	 * answers it per row, on both sides, from this one shape.
	 */
	channel: string
}

/** What `itemValuesOf` reads off a row — the columns; the two facts only a query or a viewer answers ride beside. */
export interface ItemRow {
	id: number
	isHidden?: boolean | null
	isGenerating?: boolean | null
	role?: string | null
	/** The row's `channel` column; absent reads as `main`, the column's default. */
	channel?: string | null
	metadata?: {
		isGreeting?: boolean
		swipes?: { currentIdx: number | null; history: string[] }
	} | null
}

/** The `item` document for one message — pure, the same on both sides. */
export function itemValuesOf(
	row: ItemRow,
	facts: { isNewest: boolean; mine: boolean }
): ItemValues {
	const greeting = row.metadata?.isGreeting === true
	const swipes = row.metadata?.swipes
	const idx = swipes?.currentIdx
	const len = swipes?.history?.length ?? 0
	const hasNext = typeof idx === "number" && idx < len - 1
	return {
		id: row.id,
		isNewest: facts.isNewest,
		hidden: row.isHidden === true,
		generating: row.isGenerating === true,
		role: row.role ?? "",
		mine: facts.mine,
		hasSwipes: greeting ? hasNext : true,
		greeting,
		channel: row.channel || "main"
	}
}
