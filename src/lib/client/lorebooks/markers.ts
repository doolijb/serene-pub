/**
 * The retrieval marker: what the newest run of the attached session decided
 * about one entry, as a mark on its row.
 *
 * Algolia's ranking debugger rather than Elasticsearch's `_explain` (handover
 * §4.8): a small mark on the result, hover names what it is about, click opens
 * the account. So the mark itself carries no numbers, and the criteria behind
 * it live one press away in the Read in? tab, which runs the question against
 * a real turn.
 *
 * ⚠ **Three states, and the third is an absence.** An entry the run never
 * reported on gets no mark: no mechanism offered it to the ranker and none
 * declined it by name, which is a different fact from "left out" and must not
 * be drawn as a weaker version of it.
 */

/** What the newest run did with an entry. */
export type RetrievalMarker = "fired" | "considered"

/** The newest run's decisions, by entry id. */
export type EntryDecisions = Record<number, RetrievalMarker>

/** How a retrieval marker is drawn and said. */
export interface RetrievalMarkerDisplay {
	glyph: string
	/** The mark said in one word, for a screen reader and for a chip. */
	label: string
	/** What the mark is about, and where its criteria are. */
	title: string
}

const MARKERS: Record<RetrievalMarker, RetrievalMarkerDisplay> = {
	fired: {
		glyph: "●",
		label: "Fired",
		title: "In the prompt on the newest run of the attached session. Open Read in? for the criteria."
	},
	considered: {
		glyph: "○",
		label: "Considered",
		title: "Weighed and left out on the newest run of the attached session. Open Read in? for the criteria."
	}
}

/** The mark for one entry, or null when the run said nothing about it. */
export function markerFor(
	decisions: EntryDecisions | null | undefined,
	entryId: number
): RetrievalMarkerDisplay | null {
	const decision = decisions?.[entryId]
	return decision ? MARKERS[decision] : null
}
