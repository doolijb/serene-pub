/**
 * What a rail item's dots say, in words (less-confusing B1 and B2,
 * 2026-10-11; STYLE-GUIDE §5.1).
 *
 * The item's accessible name and its tooltip both read these, so a sighted
 * user hovering a dot gets the words a screen reader already had. The shell
 * (`Layout.svelte`) draws the dots; this decides what they mean.
 */

/** A status dot's level: red for broken, gold for act on it. */
export type RailDotLevel = "error" | "attention"

/** The Admin dot, and the phone Views button's Admin half, in words. */
export const ADMIN_DOT_WORDS: Record<RailDotLevel, string> = {
	error: "something is broken",
	attention: "something needs you"
}

/** What the rail knows about one item when it draws its dots. */
export interface RailDotFacts {
	/** The rail item's key: a view key, `home`, `user`. */
	key: string
	/** The rail's wide form, where the open-view dot is drawn alone. */
	wide: boolean
	/** A view with a tab that is not the one on screen. */
	openNotShowing: boolean
	/** The session under a focused view is writing a reply (Sessions' ember dot). */
	writing: boolean
	/** Unread notifications (Activity). */
	waiting: number
	/** The worst Needs you item (Admin). */
	adminWorst: RailDotLevel | null
	/**
	 * Unread messages across the person's unmuted conversations (Messages'
	 * gold dot, PLAN-private-messages-2026-10-12 §6.2).
	 */
	unreadMessages: number
}

/**
 * Whether an item draws the grey "open but not showing" dot: on the wide
 * rail only, at the row's end. On the narrow rail five clicks put one on most
 * icons and nothing said what it meant, so it is not drawn there. The tab
 * itself is unchanged; only its mark moved.
 */
export function railShowsOpenDot(facts: RailDotFacts): boolean {
	return facts.wide && facts.openNotShowing
}

/** One phrase per dot the item draws, in the order they sit. */
export function railDotWords(facts: RailDotFacts): string[] {
	const words: string[] = []
	if (railShowsOpenDot(facts)) words.push("still open")
	if (facts.key === "sessions" && facts.writing)
		words.push("a reply is being written")
	// The count, not the dot: an info-only notification lights nothing but
	// is still waiting, and the name has always said so.
	if (facts.key === "activity" && facts.waiting > 0)
		words.push(`${facts.waiting} waiting on you`)
	if (facts.key === "admin" && facts.adminWorst)
		words.push(ADMIN_DOT_WORDS[facts.adminWorst])
	// The item is already named Messages: "Messages, 3 unread".
	if (facts.key === "conversations" && facts.unreadMessages > 0)
		words.push(`${facts.unreadMessages} unread`)
	return words
}

/**
 * Whether the Messages item draws its dot: gold (primary), the attention
 * colour, the same moment the Activity dot lights for the same message.
 */
export function railShowsMessagesDot(facts: RailDotFacts): boolean {
	return facts.key === "conversations" && facts.unreadMessages > 0
}

/** The phone Views button's Messages half, which has no "Messages" beside it. */
export function unreadMessagesWords(count: number): string | null {
	if (count <= 0) return null
	return count === 1 ? "1 unread message" : `${count} unread messages`
}

/** The item's accessible name: its title, then what its dots say. */
export function railLabel(title: string, facts: RailDotFacts): string {
	return [title, ...railDotWords(facts)].join(", ")
}

/**
 * The item's tooltip. The narrow rail has no labels, so every item names
 * itself; the wide rail shows the name already, so only an item with a dot
 * gets one, and it says what the dot means.
 */
export function railTitle(
	title: string,
	facts: RailDotFacts
): string | undefined {
	if (!facts.wide) return railLabel(title, facts)
	return railDotWords(facts).length > 0 ? railLabel(title, facts) : undefined
}
