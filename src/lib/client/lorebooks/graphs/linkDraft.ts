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
}

/** The list this pairing offers, plus whatever the writer types instead. */
export function suggestionsFor(
	from: GraphNode,
	to: GraphNode
): readonly LinkSuggestion[] {
	return LINK_SUGGESTIONS[pairingOf(from, to)]
}

export function newLinkDraft(from: GraphNode, to: GraphNode): LinkDraft {
	return {
		from,
		to,
		relationshipType: suggestionsFor(from, to)[0]?.type ?? "",
		reversed: false,
		description: "",
		status: "active",
		visibility: "acknowledged"
	}
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
	draft: LinkDraft
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
		...(description ? { description } : {})
	}
}
