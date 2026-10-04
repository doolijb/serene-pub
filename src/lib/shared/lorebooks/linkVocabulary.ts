/**
 * What a relationship between two things is usually called, and how one reads
 * from either of its ends.
 *
 * ⚠ **Suggestions, never a vocabulary the database enforces.**
 * `narrative_relationships.relationship_type` is free text and stays free text:
 * the picker offers the list for the pairing it is drawing and stores whatever
 * was typed. A book whose roads are called "the old way" is not a book with a
 * broken relationship. Nothing reads a relationship type semantically — which
 * way a relationship reads is `reverse_relationship_type`, and
 * `relationshipSentence` below is its only reader.
 *
 * Shared rather than server-side because both sides say relationships: the
 * workspace's picker and forms on the client, the prompt and the retrieval hop
 * on the server.
 */

import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

/** Which two kinds of thing a relationship joins. */
export type LinkPairing = "entry-entry" | "cast-entry" | "cast-cast"

/** One offered relationship type. */
export interface LinkSuggestion {
	type: string
	/**
	 * What picking it pre-fills as the reverse relationship type — how it
	 * reads from the far end. Absent is one way. A symmetric wording repeats
	 * itself. Never on a cast↔cast suggestion: a cast tie's other side is its
	 * own perspective row.
	 */
	reverse?: string
}

/**
 * The list each pairing offers.
 *
 * ⚠ `same as` is **not** here, for either pairing that could want it: two rows
 * that turn out to be one thing are absorbed, not joined by a relationship,
 * and an alias relationship would leave the duplicate standing.
 *
 * `is inside` / `holds` is words, not containment: a place is never filed
 * under anything (plan places-graph §7), so "inside" is an ordinary
 * relationship — many-to-many, no cascade, no tree.
 */
export const LINK_SUGGESTIONS: Readonly<
	Record<LinkPairing, readonly LinkSuggestion[]>
> = {
	"entry-entry": [
		{ type: "connects to", reverse: "connects to" },
		{ type: "leads to" },
		{ type: "runs past" },
		{ type: "near", reverse: "near" },
		{ type: "is inside", reverse: "holds" }
	],
	// Verbs, read from the member ("Keeps the Crypt."), because the same
	// words are also said with both ends named from the place ("Verity keeps
	// the Crypt."), where a noun ("keeper of") or a bare participle ("born
	// in") reads as a broken sentence.
	"cast-entry": [
		{ type: "keeps" },
		{ type: "lives in" },
		{ type: "owns" },
		{ type: "was born in" },
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
}

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

/**
 * Where a relationship stands. One list, read by every form that sets it and
 * by the graph build's response schema.
 */
export const RELATIONSHIP_STATUSES = [
	"active",
	"resolved",
	"broken",
	"evolved"
] as const

/**
 * The most characters each of a relationship's words may run to — one set of
 * ceilings for every writer: the canvas's forms (as `maxlength`), the socket
 * writers (a refusal, never a cut), and a cut where a model or a file wrote
 * them — the graph build's apply, the host's lore-link writer
 * (`link-lore-entries@1`, `create-lore-entry@1`'s `links`) and the lorebook
 * import. The wording is each way: the relationship type and the reverse one
 * alike. Every prompt line and edge label prints them.
 */
export const RELATIONSHIP_TEXT_LIMITS = {
	wording: 100,
	name: 200,
	description: 2000,
	reason: 2000
} as const

/**
 * Who knows of a relationship, least known first — the order
 * `relationshipVisibility.ts` ranks openness in. One list, read by every form
 * that sets it, by the socket writers (which refuse any other) and by the
 * graph build's response schema.
 */
export const RELATIONSHIP_VISIBILITIES = [
	"secret",
	"acknowledged",
	"public"
] as const

// ─── Saying a relationship from one of its ends ───────────────────────────────

/** One end of a relationship, as a sentence names it. */
export interface RelationshipEndRef {
	kind: "cast" | "entry"
	id: number
}

/**
 * An end in any of the shapes it travels in: the wire's (`entryId` /
 * `bindingId`, the client) or the server's reading (`{ kind, id }`,
 * `GraphEntryLink`). Read through `relationshipEndRef`, never by hand.
 */
export type RelationshipEndLike =
	| RelationshipEndRef
	| { kind: "entry"; entryId: number; typeId?: string }
	| { kind: "cast"; bindingId: number }

export const relationshipEndRef = (
	end: RelationshipEndLike
): RelationshipEndRef =>
	"entryId" in end
		? { kind: "entry", id: end.entryId }
		: "bindingId" in end
			? { kind: "cast", id: end.bindingId }
			: { kind: end.kind, id: end.id }

/** A relationship, as little of it as saying it needs. */
export interface SayableRelationship {
	from: RelationshipEndLike
	to: RelationshipEndLike
	/** Read from the `from` end ("leads north to"). */
	relationshipType: string
	/** Read from the `to` end ("leads south to"); null or blank is one way. */
	reverseRelationshipType?: string | null
	/** The relationship's own name ("the rusted iron door"); empty is unnamed. */
	name?: string | null
}

/**
 * How a relationship reads from one of its ends.
 *
 * - `out`: the subject is the `from` end; the wording is the relationship type.
 * - `back`: the subject is the `to` end of a both-ways relationship; the
 *   wording is the reverse relationship type.
 * - `inbound`: the subject is the `to` end of a one-way relationship. There is
 *   no wording from here — the way only runs into it.
 */
export interface RelationshipReading {
	way: "out" | "back" | "inbound"
	wording: string | null
	/** The end the wording reaches. */
	other: RelationshipEndRef
}

const sameEnd = (a: RelationshipEndRef, b: RelationshipEndRef) =>
	a.kind === b.kind && a.id === b.id

/**
 * Which way a relationship reads from `subject`, or null when `subject` is
 * neither end. A relationship from a thing to itself reads out.
 */
export function relationshipReading(
	rel: SayableRelationship,
	subject: RelationshipEndRef
): RelationshipReading | null {
	const from = relationshipEndRef(rel.from)
	const to = relationshipEndRef(rel.to)
	if (sameEnd(from, subject))
		return { way: "out", wording: rel.relationshipType.trim(), other: to }
	if (!sameEnd(to, subject)) return null
	const reverse = rel.reverseRelationshipType?.trim()
	return reverse
		? { way: "back", wording: reverse, other: from }
		: { way: "inbound", wording: null, other: from }
}

/** What an unworded relationship says, rather than a sentence with a hole. */
const UNWORDED = "linked to"
/** The same, with both ends named: the sentence needs its verb. */
const UNWORDED_NAMED = "is linked to"

/** A cast member, or an entry whose type says it is not a place. */
const knownNotAPlace = (end: RelationshipEndLike): boolean => {
	if (end.kind === "cast") return true
	const typeId = (end as { typeId?: unknown }).typeId
	return typeof typeId === "string" && typeId !== LOCATION_TYPE_ID
}

const capitalised = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1)

const stopped = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * One relationship, said from `subject` — the one sentence every surface and
 * every prompt says a relationship with (plan places-graph §6.1).
 *
 * The subject is implicit: the sentence stands under the subject's own name
 * (a place's Links list, "From here:" under a room).
 * - From the `from` end: "The rusted iron door leads north to the Drowned
 *   Hall." — or, unnamed, "Leads north to the Drowned Hall."
 * - From the `to` end of a both-ways relationship, through the reverse
 *   relationship type: "The rusted iron door leads south to the Guardroom."
 * - From the `to` end of a one-way relationship: "One way, into here from the
 *   Guardroom." ⚠ The editor shows it; a prompt leaves it out
 *   (`relationshipReading(…).way === "inbound"`).
 * - …unless either end is known not to be a place — a cast member, or an
 *   entry whose `typeId` (the wire's ends carry it) is not a place's. "Into
 *   here" is a place's wording (§6.1), for a way between two places; anything
 *   else is said as drawn, both ends named: "Verity keeps the Crypt.",
 *   "Verity lives in the Crypt." An end that does not say its type is read
 *   as a place, the subject this sentence was made for.
 * - The name leads only a way between places — the door is what "leads
 *   north". Anything else is not its name ("The old claim owns the Crypt"
 *   would be said of nobody), so the name trails: "Owns the Crypt, by the
 *   old claim." / "Verity owns the Crypt, by the old claim."
 *
 * ⚠ Said with both ends named, the wording follows the member's name, so it
 * must be a verb phrase: the cast↔entry suggestions are ("keeps", "was born
 * in"); a noun a writer types ("keeper of") reads as it was typed.
 *
 * Null when `subject` is neither end. `nameOf` names the other end — a cast
 * end carries no name on the wire, so the caller knows it and this does not.
 */
export function relationshipSentence(
	rel: SayableRelationship,
	subject: RelationshipEndRef,
	nameOf: (end: RelationshipEndRef) => string
): string | null {
	const reading = relationshipReading(rel, subject)
	if (!reading) return null
	const other = nameOf(reading.other)
	const name = rel.name?.trim() ?? ""
	const by = name ? `, by ${name}` : ""
	// A way between places: somewhere a way runs between, at both ends.
	const isWay = !knownNotAPlace(rel.to) && !knownNotAPlace(rel.from)
	if (reading.way === "inbound") {
		// "Into here" is a way in. A member who lives in a place is said as
		// drawn (B4), both ends named, so the wording needs its verb.
		if (isWay) return stopped(`One way, into here from ${other}${by}`)
		const wording = rel.relationshipType.trim() || UNWORDED_NAMED
		return stopped(
			capitalised(`${other} ${wording} ${nameOf(subject)}${by}`)
		)
	}
	const wording = reading.wording || UNWORDED
	if (!isWay) return stopped(capitalised(`${wording} ${other}${by}`))
	return stopped(capitalised(`${name ? `${name} ` : ""}${wording} ${other}`))
}
