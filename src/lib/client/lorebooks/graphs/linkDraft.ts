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
	type LinkSuggestion
} from "$lib/shared/lorebooks/linkVocabulary"
import { pairingOf, type GraphNode } from "./graphModel"

export interface LinkDraft {
	from: GraphNode
	to: GraphNode
	relationshipType: string
	/** The direction toggle: the edge runs against the way it was dragged. */
	reversed: boolean
	description: string
	status: string
	visibility: string
	/**
	 * The history entry that dates the link, or null for undated. A new link
	 * drawn while reading as of a date starts on the entry dated that day.
	 */
	historyEntryId: number | null
}

/** The list this pairing offers, plus whatever the writer types instead. */
export function suggestionsFor(
	from: GraphNode,
	to: GraphNode
): readonly LinkSuggestion[] {
	return LINK_SUGGESTIONS[pairingOf(from, to)]
}

export function newLinkDraft(
	from: GraphNode,
	to: GraphNode,
	historyEntryId: number | null = null
): LinkDraft {
	return {
		from,
		to,
		relationshipType: suggestionsFor(from, to)[0]?.type ?? "",
		reversed: false,
		description: "",
		status: "active",
		visibility: "acknowledged",
		historyEntryId
	}
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
 * An empty description is left out rather than sent as a blank: the column
 * holds what a writer wrote, and a row of empty strings is not a fact.
 */
export function createLinkParams(
	lorebookId: number,
	draft: LinkDraft,
	/** The line being read — the link is drawn on it (null is main). */
	branchId: number | null = null
): Sockets.NarrativeGraph.CreateRelationship.Params {
	const [from, to] = linkEnds(draft)
	const description = draft.description.trim()
	return {
		lorebookId,
		from: endpoint(from),
		to: endpoint(to),
		relationshipType: draft.relationshipType.trim(),
		status: draft.status,
		visibility: draft.visibility,
		branchId,
		...(description ? { description } : {}),
		...(draft.historyEntryId != null
			? { historyEntryId: draft.historyEntryId }
			: {})
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
