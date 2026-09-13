/**
 * What an edge between two things is usually called.
 *
 * ⚠ **Suggestions, never a vocabulary the database enforces.**
 * `narrative_relationships.relationship_type` is free text and stays free text:
 * the picker offers the list for the pairing it is drawing and stores whatever
 * was typed. A book whose roads are called "the old way" is not a book with a
 * broken edge.
 *
 * Shared rather than server-side because both ends read it: the workspace's
 * picker offers the list, and `entries:counts` decides what a **place** is from
 * `TRAVEL_LINK_TYPES` below.
 */

/** Which two kinds of thing an edge joins. */
export type LinkPairing = "entry-entry" | "cast-entry" | "cast-cast"

/**
 * The types that make an edge a way of getting somewhere.
 *
 * Lower-cased on both sides when compared — `relationship_type` is whatever was
 * typed, and "Leads To" is the same road as "leads to".
 */
export const TRAVEL_LINK_TYPES = [
	"connects to",
	"leads to",
	"runs past",
	"near"
] as const

export type TravelLinkType = (typeof TRAVEL_LINK_TYPES)[number]

export const isTravelLinkType = (value: unknown): boolean =>
	typeof value === "string" &&
	(TRAVEL_LINK_TYPES as readonly string[]).includes(
		value.trim().toLowerCase()
	)

/** One offered type, and the sentence the picker says about it. */
export interface LinkSuggestion {
	type: string
	/** Present only where the type has something to warn about. */
	note?: string
}

/**
 * The list each pairing offers.
 *
 * ⚠ `same as` is **not** here, for either pairing that could want it: two rows
 * that turn out to be one thing are absorbed, not joined by an edge, and an
 * alias edge would leave the duplicate standing.
 */
export const LINK_SUGGESTIONS = {
	"entry-entry": [
		{ type: "connects to" },
		{ type: "leads to" },
		{ type: "runs past" },
		{ type: "near" },
		{
			type: "inside",
			note: 'Use "Part of" instead: containment is the entry\'s parent, not an edge.'
		}
	],
	"cast-entry": [
		{ type: "keeper of" },
		{ type: "lives in" },
		{ type: "owns" },
		{ type: "born in" },
		{ type: "died at" }
	],
	"cast-cast": [
		{ type: "neutral" },
		{ type: "ally" },
		{ type: "enemy" },
		{ type: "rival" },
		{ type: "mentor" },
		{ type: "family" },
		{ type: "romantic" },
		{ type: "complicated" },
		{ type: "life_debt" }
	]
} as const satisfies Record<LinkPairing, readonly LinkSuggestion[]>

/** Which pairing two endpoint kinds make. */
export const linkPairingOf = (
	from: "cast" | "entry",
	to: "cast" | "entry"
): LinkPairing =>
	from === "cast" && to === "cast"
		? "cast-cast"
		: from === "entry" && to === "entry"
			? "entry-entry"
			: "cast-entry"
