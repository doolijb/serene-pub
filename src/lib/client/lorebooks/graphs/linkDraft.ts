/**
 * Naming a relationship by dragging one node onto another.
 *
 * The drag says which two things are joined and which way round; the form says
 * what it is called and what it means. The picker offers the vocabulary for the
 * pairing it is drawing, and stores whatever was typed:
 * `relationship_type` is free text and a book whose roads are called "the old
 * way" is not a book with a broken edge.
 */

import {
	LINK_SUGGESTIONS,
	type LinkPairing,
	type LinkSuggestion
} from "$lib/shared/lorebooks/linkVocabulary"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { pairingOf, type GraphNode } from "./graphModel"

/**
 * What `RelationshipFields` edits — one set of fields for a new relationship
 * (`LinkDraft`) and a stored one (`NarrativeRelationship`), so the canvas and
 * the place editor ask the same questions the same way.
 */
export interface RelationshipFieldsValue {
	/** Read from the `from` end ("leads north to"). */
	relationshipType: string
	/**
	 * Read from the `to` end ("leads south to"); null is one way — **Both
	 * ways** off. Never set between two cast members.
	 */
	reverseRelationshipType: string | null
	/** The relationship's own name ("the rusted iron door"); empty is unnamed. */
	name: string
	description: string
	status: string
	visibility: string
	/** Why it stands where it does. Only a stored relationship carries one. */
	reason?: string | null
	/**
	 * The history entry that dates it, or null for undated. A new link drawn
	 * while reading as of a date starts on the entry dated that day.
	 */
	historyEntryId: number | null
}

export interface LinkDraft extends RelationshipFieldsValue {
	from: GraphNode
	to: GraphNode
	/** The direction toggle: the edge runs against the way it was dragged. */
	reversed: boolean
}

/** The list this pairing offers, plus whatever the writer types instead. */
export function suggestionsFor(
	from: GraphNode,
	to: GraphNode
): readonly LinkSuggestion[] {
	return LINK_SUGGESTIONS[pairingOf(from, to)]
}

/**
 * Pick an offered relationship type. The suggestion says whether it reads both
 * ways, so picking one sets **Both ways** too: `connects to` repeats itself,
 * `is inside` reads back as `holds`, `leads to` is one way.
 */
export function pickSuggestion<T extends RelationshipFieldsValue>(
	value: T,
	suggestion: LinkSuggestion,
	pairing: LinkPairing
): T {
	return {
		...value,
		relationshipType: suggestion.type,
		reverseRelationshipType:
			pairing === "cast-cast" ? null : (suggestion.reverse ?? null)
	}
}

/**
 * Turn **Both ways** on or off. On, it starts from the offered reverse of the
 * relationship type when there is one, and otherwise repeats the words — a
 * symmetric wording repeats itself, and an asymmetric one is the writer's to
 * turn round ("leads north to" → "leads south to"). A cast tie never reads
 * both ways: its other side is its own perspective row.
 */
export function setBothWays<T extends RelationshipFieldsValue>(
	value: T,
	on: boolean,
	pairing: LinkPairing
): T {
	if (!on || pairing === "cast-cast")
		return { ...value, reverseRelationshipType: null }
	const typed = value.relationshipType.trim()
	const offered = LINK_SUGGESTIONS[pairing].find(
		(s) => s.type === typed.toLowerCase()
	)
	return { ...value, reverseRelationshipType: offered?.reverse ?? typed }
}

/** Why the fields cannot be saved yet, or null when they can. */
export function relationshipFieldsProblem(
	value: RelationshipFieldsValue
): string | null {
	if (!value.relationshipType.trim()) return "Say what joins them."
	if (
		value.reverseRelationshipType !== null &&
		!value.reverseRelationshipType.trim()
	)
		return "Say how it reads from the other end, or turn Both ways off."
	return null
}

/** The far-end picker's own value for **New place…**; never a node key. */
export const NEW_PLACE_OPTION = "new-place"

/** One row of the far-end picker (the shape `Select` lists). */
export interface OtherEndOption {
	value: string
	label: string
	group?: string
	unfiltered?: boolean
}

const OTHER_END_GROUPS = ["Places", "Cast", "Lore"] as const
type OtherEndGroup = (typeof OTHER_END_GROUPS)[number]
const otherEndGroup = (node: GraphNode): OtherEndGroup =>
	node.kind === "cast"
		? "Cast"
		: node.typeId === LOCATION_TYPE_ID
			? "Places"
			: "Lore"

/**
 * What the far end of a relationship may be, as the searchable picker lists
 * it (the link form's **The other end**, the node panel's **Link to…**):
 * places first — the Places lens is drawing a map — then cast, then other
 * lore, never the near end; and, when a place can be made here, **New
 * place…** last, listed whatever is typed (it is the answer exactly when
 * nothing matches).
 */
export function otherEndOptions(
	candidates: readonly GraphNode[],
	nearKey: string,
	withNewPlace: boolean
): OtherEndOption[] {
	const rows = candidates
		.filter((n) => n.key !== nearKey)
		.map((n) => ({ value: n.key, label: n.name, group: otherEndGroup(n) }))
	rows.sort(
		(a, b) =>
			OTHER_END_GROUPS.indexOf(a.group) - OTHER_END_GROUPS.indexOf(b.group)
	)
	return withNewPlace
		? [
				...rows,
				{ value: NEW_PLACE_OPTION, label: "New place…", unfiltered: true }
			]
		: rows
}

/**
 * Why a draft cannot be named yet, or null when it can: the other end first
 * (a draft opened for **New place…** points at itself until the place
 * exists — nothing is linked to itself), then the fields.
 */
export function linkDraftProblem(draft: LinkDraft): string | null {
	if (draft.from.key === draft.to.key) return "Pick the other end."
	return relationshipFieldsProblem(draft)
}

/**
 * Point the draft at a new far end (the searchable picker, or a place just
 * made). Words the old pairing merely OFFERED give way to the new pairing's
 * first offer — "neutral" is no way to be joined to a room — while words
 * the writer typed stay. Two cast members never read both ways.
 */
export function retargetLink(draft: LinkDraft, to: GraphNode): LinkDraft {
	const was = pairingOf(draft.from, draft.to)
	const pairing = pairingOf(draft.from, to)
	const next: LinkDraft = { ...draft, to }
	if (pairing === was) return next
	const typed = draft.relationshipType.trim().toLowerCase()
	const offered =
		!typed || LINK_SUGGESTIONS[was].some((s) => s.type === typed)
	const first = LINK_SUGGESTIONS[pairing][0]
	if (offered && first)
		return pickSuggestion(
			{ ...next, reversed: readsFromMember(next.from, to) },
			first,
			pairing
		)
	return pairing === "cast-cast"
		? { ...next, reverseRelationshipType: null }
		: next
}

/**
 * The cast↔entry words read from the member ("keeps", "lives in"), so a
 * draft offered them from an entry toward a member starts turned round:
 * a place's **Link to…** Verity reads "Verity → The Crypt", "keeps", not
 * "The Crypt keeps Verity". Words the writer typed keep the way they were
 * drawn; the flip turns either round.
 */
const readsFromMember = (from: GraphNode, to: GraphNode): boolean =>
	from.kind === "entry" && to.kind === "cast"

export function newLinkDraft(
	from: GraphNode,
	to: GraphNode,
	historyEntryId: number | null = null
): LinkDraft {
	const draft: LinkDraft = {
		from,
		to,
		relationshipType: "",
		reverseRelationshipType: null,
		name: "",
		reversed: readsFromMember(from, to),
		description: "",
		status: "active",
		visibility: "acknowledged",
		historyEntryId
	}
	const first = suggestionsFor(from, to)[0]
	return first ? pickSuggestion(draft, first, pairingOf(from, to)) : draft
}

/**
 * Whether the author changed a new link's form since it opened (plan B7): a
 * word typed, a field picked, the far end moved or the direction flipped. A
 * form nobody touched is not an unsaved change; one somebody did is, and
 * leaving it asks first, like every other draft in the workspace.
 */
export function linkDraftChanged(opened: LinkDraft, now: LinkDraft): boolean {
	return (
		opened.from.key !== now.from.key ||
		opened.to.key !== now.to.key ||
		opened.reversed !== now.reversed ||
		opened.relationshipType !== now.relationshipType ||
		opened.reverseRelationshipType !== now.reverseRelationshipType ||
		opened.name !== now.name ||
		opened.description !== now.description ||
		opened.status !== now.status ||
		opened.visibility !== now.visibility ||
		opened.historyEntryId !== now.historyEntryId
	)
}

/** A history entry, as little of it as the When picker needs. */
export interface WhenEntryLike {
	id: number
	name?: string | null
	year: number
	month?: number | null
	day?: number | null
}

/**
 * One history entry, as the When picker names it: the entry and its date,
 * spelled through the book's calendar (`spell` is `formatDate`, which reads
 * the open book's calendar). The create and the edit form share this, so one
 * link reads the same in both.
 */
export function whenLabel(
	entry: WhenEntryLike,
	spell: (date: {
		year: number
		month: number | null
		day: number | null
	}) => string
): string {
	const date = spell({
		year: entry.year,
		month: entry.month ?? null,
		day: entry.day ?? null
	})
	const name = entry.name?.trim()
	return name ? `${name} · ${date}` : date
}

/** The When picker's options: "No date", then every history entry. */
export function whenOptions(
	entries: readonly WhenEntryLike[],
	spell: Parameters<typeof whenLabel>[1]
): { value: string; label: string }[] {
	return [
		{ value: "", label: "No date" },
		...entries.map((e) => ({ value: String(e.id), label: whenLabel(e, spell) }))
	]
}

/**
 * The history entry a new link starts dated by: the one dated exactly the
 * moment being read, or none. At now, or on a date no entry is dated, a new
 * link is undated — a date nobody chose is not a claim to make for them.
 */
export function whenAtMoment(
	entries: readonly WhenEntryLike[],
	moment: { year: number; month?: number | null; day?: number | null } | null
): number | null {
	if (!moment) return null
	const hit = entries.find(
		(e) =>
			e.year === moment.year &&
			(e.month ?? null) === (moment.month ?? null) &&
			(e.day ?? null) === (moment.day ?? null)
	)
	return hit?.id ?? null
}

/** Turn the arrow round without redrawing the drag. */
export const flipLink = (draft: LinkDraft): LinkDraft => ({
	...draft,
	reversed: !draft.reversed
})

/** The two ends in the order the edge runs. */
export function linkEnds(draft: LinkDraft): [GraphNode, GraphNode] {
	return draft.reversed ? [draft.to, draft.from] : [draft.from, draft.to]
}

/** What the form calls itself, which is the edge said out loud. */
export function linkFormTitle(draft: LinkDraft): string {
	// A draft opened for New place… has no far end until the place exists.
	if (draft.from.key === draft.to.key) return `${draft.from.name} → …`
	const [from, to] = linkEnds(draft)
	return `${from.name} → ${to.name}`
}

const endpoint = (node: GraphNode) =>
	node.kind === "cast"
		? ({ kind: "cast", bindingId: node.id } as const)
		: ({ kind: "entry", entryId: node.id } as const)

/**
 * What the socket is handed.
 *
 * An empty description or name is left out rather than sent as a blank: the
 * column holds what a writer wrote, and a row of empty strings is not a fact.
 * A one-way draft sends no reverse at all, which the server reads as one way.
 */
export function createLinkParams(
	lorebookId: number,
	draft: LinkDraft,
	/** The line being read — the link is drawn on it (null is main). */
	branchId: number | null = null
): Sockets.NarrativeGraph.CreateRelationship.Params {
	const [from, to] = linkEnds(draft)
	const description = draft.description.trim()
	const name = draft.name.trim()
	const reverse = draft.reverseRelationshipType?.trim()
	return {
		lorebookId,
		from: endpoint(from),
		to: endpoint(to),
		relationshipType: draft.relationshipType.trim(),
		status: draft.status,
		visibility: draft.visibility,
		branchId,
		...(reverse ? { reverseRelationshipType: reverse } : {}),
		...(name ? { name } : {}),
		...(description ? { description } : {}),
		...(draft.historyEntryId != null
			? { historyEntryId: draft.historyEntryId }
			: {})
	}
}

/**
 * What an edit sends: the fields `RelationshipFields` edits and nothing else.
 *
 * ⚠ **Never the ends.** The edit form does not move a relationship, and
 * resending both ends on every save made the server judge a move nobody made.
 * ⚠ **Always the line** (plan B0): the server refuses another line's row,
 * and main is `null`, never left out.
 */
export function updateLinkParams(
	rel: RelationshipFieldsValue & { id: number },
	/** The line being read. */
	branchId: number | null
): Sockets.NarrativeGraph.UpdateRelationship.Params & {
	branchId: number | null
} {
	const reverse = rel.reverseRelationshipType?.trim()
	return {
		relationship: {
			id: rel.id,
			relationshipType: rel.relationshipType.trim(),
			reverseRelationshipType: reverse ? reverse : null,
			name: rel.name.trim(),
			description: rel.description,
			status: rel.status,
			visibility: rel.visibility,
			...(rel.reason !== undefined ? { reason: rel.reason } : {}),
			historyEntryId: rel.historyEntryId
		},
		branchId
	}
}

/**
 * Is this reply the link THIS form asked for? The create reply is a
 * broadcast to every tab, so the form settles on the one whose book and ends
 * match what it sent.
 */
export function isReplyFor(
	params: Sockets.NarrativeGraph.CreateRelationship.Params,
	rel: Pick<
		Sockets.NarrativeGraph.NarrativeRelationship,
		"lorebookId" | "from" | "to"
	>
): boolean {
	const same = (
		a: Sockets.NarrativeGraph.CreateRelationship.Params["from"],
		b: Sockets.NarrativeGraph.NarrativeRelationship["from"]
	) =>
		!!a &&
		a.kind === b.kind &&
		(a.kind === "cast"
			? b.kind === "cast" && a.bindingId === b.bindingId
			: b.kind === "entry" && a.entryId === b.entryId)
	return (
		rel.lorebookId === params.lorebookId &&
		same(params.from, rel.from) &&
		same(params.to, rel.to)
	)
}
