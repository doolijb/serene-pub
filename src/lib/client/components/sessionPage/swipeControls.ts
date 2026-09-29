/**
 * Which lines of a session get swipe arrows and a Regenerate (F1, B1a).
 *
 * Keyed on the message **role**, never on a persona: the author's own line is
 * `role === "user"` in every genre, including the persona-less ones (Lair,
 * Guide), where the line carries no `personaId`. Regenerating or swiping the
 * author's line would write the narrator's prose over it, so the author's
 * line is edited, never regenerated — the same rule the server's door holds
 * (core's `retry` / `swipe` / `extend` enabled-when on `item.role`).
 *
 * Pure, so the page and its test read one rule.
 */

export interface SwipeRow {
	id: number
	role?: string | null
	isGenerating?: boolean | null
	isHidden?: boolean | null
	metadata?: {
		isGreeting?: boolean
		swipes?: { currentIdx?: number | null; history?: readonly unknown[] }
	} | null
}

/** The newest line the author wrote, or undefined. */
export function lastAuthorLine<T extends SwipeRow>(
	rows: readonly T[] | undefined
): T | undefined {
	if (!rows) return undefined
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].role === "user") return rows[i]
	}
	return undefined
}

/** Is the newest row a reply the Regenerate chip may act on? */
export function canRegenerateNewest(
	newest: SwipeRow | undefined,
	retryOffered: boolean
): boolean {
	return (
		retryOffered &&
		!!newest &&
		newest.role === "assistant" &&
		!newest.metadata?.isGreeting &&
		!newest.isGenerating &&
		!newest.isHidden
	)
}

/** May this row be swiped forward (a new swipe, or the next stored one)? */
export function canSwipeRight(
	msg: SwipeRow,
	isGreeting: boolean,
	lastAuthor: SwipeRow | undefined
): boolean {
	if (msg.role === "user") return false
	if (msg.isGenerating) return false
	if (lastAuthor && lastAuthor.id >= msg.id) return false
	if (isGreeting) {
		const idx = msg.metadata?.swipes?.currentIdx
		const len = msg.metadata?.swipes?.history?.length ?? 0
		if (typeof idx !== "number" || len === 0) return false
		return idx < len - 1
	}
	return true
}

/** Does this row show the swipe row at all? */
export function showSwipeControls(
	msg: SwipeRow,
	facts: {
		isGreeting: boolean
		isNewest: boolean
		swipeOffered: boolean
		canRegenerateNewest: boolean
		lastAuthor: SwipeRow | undefined
	}
): boolean {
	// An opt-in built-in the genre switched off has no control (R-15).
	if (!facts.swipeOffered) return false
	// The author's own line never swipes — checked before "newest", because in
	// a persona-less genre the newest line can be the author's.
	if (msg.role === "user") return false
	if (msg.isGenerating) return false
	if (facts.isNewest && !facts.isGreeting) return facts.canRegenerateNewest
	if (facts.isGreeting) return (facts.lastAuthor?.id ?? 0) < msg.id
	return false
}
