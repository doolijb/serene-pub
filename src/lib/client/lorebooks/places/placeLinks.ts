/**
 * A place's Links list, as arithmetic (plan places-graph §10.3, B5).
 *
 * The place editor lists every relationship the place is an end of — the
 * doors, roads and "is inside" that give a place its shape — each said from
 * the place with the one sentence (`relationshipSentence`) and edited with the
 * one set of fields (`RelationshipFields`) the canvas uses. The rows come from
 * the one store (`BookRelationships`), so a link drawn on the canvas is here
 * the moment the server's push lands, and one written here is on the canvas.
 *
 * ⚠ **A link is not an entry column.** A row saves on its own, through the
 * store, never through the entry's Save or Save as of (§9).
 */

import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { Line } from "$lib/shared/lorebooks/lineReading"
import {
	linkPairingOf,
	relationshipReading,
	relationshipSentence,
	type LinkPairing,
	type RelationshipEndRef
} from "$lib/shared/lorebooks/linkVocabulary"
import type { PoolItem } from "../poolFilter"
import {
	edgesOnLine,
	laterLabel,
	splitByMoment,
	type DatedEntryLike
} from "../graphs/asOf"
import { placeNode } from "./placeGraph"
import {
	newLinkDraft,
	type LinkDraft,
	type RelationshipFieldsValue
} from "../graphs/linkDraft"

type NarrativeRelationship = Sockets.NarrativeGraph.NarrativeRelationship

/** Where, when and on which line a place's links are read. */
export interface PlaceLinkReading {
	/** The place whose links these are. */
	placeId: number
	/** The line being read (null is main). A row another line owns is read-only. */
	branchId: number | null
	/** That line with its ancestor chain — what it reads (`edgesOnLine`). */
	line: Line
	/** The moment being read (a story-date key), or absent for now. */
	moment: string | null | undefined
	/** Every history entry in the book: what dates a relationship. */
	datedBy: readonly DatedEntryLike[]
	/**
	 * What the far end is called — the pool's reading of an entry (amended
	 * names), a cast member's name. Undefined falls back to the name the
	 * wire's entry end carries.
	 */
	nameOf: (end: RelationshipEndRef) => string | undefined
	/**
	 * Whether the far end is archived as of the moment (the pool's reading).
	 * The canvas and the prompt leave such a link out; this list keeps it,
	 * marked and last, so it can still be seen and unlinked. Absent, none is.
	 */
	isArchived?: (end: RelationshipEndRef) => boolean
	/** A line's name, for the read-only note: `main` or the branch's name. */
	lineName: (branchId: number | null) => string
}

/** One row of the Links list. */
export interface PlaceLinkRow {
	id: number
	rel: NarrativeRelationship
	/** The relationship said from this place. */
	sentence: string
	/** Out of here, back through the reverse, or one way into here. */
	way: "out" | "back" | "inbound"
	/** The far end. */
	other: RelationshipEndRef
	otherName: string
	/** Which two kinds of thing it joins: the fields' chips and Both ways. */
	pairing: LinkPairing
	/** Why it cannot be changed from the line being read, or null. */
	locked: string | null
	/** The date it waits on when it was made true after the moment, or null. */
	later: string | null
	/** The far end is archived as of the moment: listed, but not standing. */
	archived: boolean
}

/**
 * Whether a row stands at the moment — what the canvas draws and the prompt
 * says: made true by then, and its far end not archived. The Links count is
 * of these; the rest are listed after them, each with a badge saying why.
 */
export const placeLinkStands = (row: PlaceLinkRow): boolean =>
	row.later === null && !row.archived

const endKind = (end: NarrativeRelationship["from"]) => end.kind

/** The name the wire's entry end carries (a cast end carries none). */
function wireName(
	rel: NarrativeRelationship,
	end: RelationshipEndRef
): string | undefined {
	for (const wire of [rel.from, rel.to])
		if (
			wire.kind === "entry" &&
			end.kind === "entry" &&
			wire.entryId === end.id
		)
			return wire.name
	return undefined
}

/**
 * Why a relationship cannot be changed from the line being read, or null.
 * The server refuses the same write (plan B0); this says so before it is
 * tried, in the canvas's words.
 */
export function placeLinkLockedReason(
	rel: Pick<NarrativeRelationship, "branchId">,
	branchId: number | null,
	lineName: (branchId: number | null) => string
): string | null {
	const owner = rel.branchId ?? null
	if (owner === (branchId ?? null)) return null
	return `This link belongs to ${lineName(owner)}. Open that line to change it.`
}

/**
 * The Links list: every relationship the place is an end of, on the line
 * being read, said from the place. Those that stand at the moment come
 * first, each group in the order the links were made; then a link made true
 * after the moment, with its date; then one whose far end is archived as of
 * the moment. The canvas draws only the first group (`placeLinkStands`).
 */
export function placeLinkRows(
	relationships: readonly NarrativeRelationship[],
	reading: PlaceLinkReading
): PlaceLinkRow[] {
	const subject: RelationshipEndRef = { kind: "entry", id: reading.placeId }
	const touching = relationships.filter(
		(rel) => relationshipReading(rel, subject) !== null
	)
	const onLine = edgesOnLine(touching, reading.line, reading.datedBy)
	const { inStory, later } = splitByMoment(
		onLine,
		reading.moment,
		reading.datedBy
	)
	const byId = (a: NarrativeRelationship, b: NarrativeRelationship) =>
		a.id - b.id
	const row = (rel: NarrativeRelationship, isLater: boolean): PlaceLinkRow => {
		const name = (end: RelationshipEndRef) =>
			reading.nameOf(end) ?? wireName(rel, end) ?? `#${end.id}`
		const reads = relationshipReading(rel, subject)!
		return {
			id: rel.id,
			rel,
			sentence: relationshipSentence(rel, subject, name) ?? "",
			way: reads.way,
			other: reads.other,
			otherName: name(reads.other),
			pairing: linkPairingOf(endKind(rel.from), endKind(rel.to)),
			locked: placeLinkLockedReason(rel, reading.branchId, reading.lineName),
			later: isLater ? laterLabel(rel, reading.datedBy) : null,
			archived: reading.isArchived?.(reads.other) ?? false
		}
	}
	const rows = [
		...[...inStory].sort(byId).map((rel) => row(rel, false)),
		...[...later].sort(byId).map((rel) => row(rel, true))
	]
	return [
		...rows.filter((r) => !r.archived),
		...rows.filter((r) => r.archived)
	]
}

/**
 * The places a new link can reach: every other place the line reads, archived
 * ones left out, by name. The pool is already the line's reading.
 */
export function placeChoices(
	pool: readonly PoolItem[],
	placeId: number
): PoolItem[] {
	return pool
		.filter(
			(item) =>
				item.kind === LOCATION_TYPE_ID &&
				!item.archived &&
				item.id !== placeId
		)
		.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A new link from this place to another: the canvas's draft, drawn from
 * here, starting on the first suggestion (`connects to`, both ways) and dated
 * by `historyEntryId` (the entry dated the moment being read, or none).
 */
export function newPlaceLink(
	from: { id: number; name: string },
	to: { id: number; name: string },
	historyEntryId: number | null
): LinkDraft {
	return newLinkDraft(placeNode(from), placeNode(to), historyEntryId)
}

/** The same draft, its far end moved to another place. */
export function withOtherPlace(
	draft: LinkDraft,
	to: { id: number; name: string }
): LinkDraft {
	return { ...draft, to: placeNode(to) }
}

/**
 * A stored relationship's own fields, as `RelationshipFields` edits them —
 * never its ends (`updateLinkParams` sends none).
 */
export function placeLinkFields(
	rel: NarrativeRelationship
): RelationshipFieldsValue & { id: number } {
	return {
		id: rel.id,
		relationshipType: rel.relationshipType,
		reverseRelationshipType: rel.reverseRelationshipType ?? null,
		name: rel.name ?? "",
		description: rel.description ?? "",
		status: rel.status,
		visibility: rel.visibility,
		reason: rel.reason ?? null,
		historyEntryId: rel.historyEntryId ?? null
	}
}

/**
 * Whether the fields say anything the stored relationship does not. A reason
 * typed and cleared again is no reason, as the column reads it.
 */
export function placeLinkChanged(
	rel: NarrativeRelationship,
	fields: RelationshipFieldsValue & { id: number }
): boolean {
	return linkFieldsDiffer(placeLinkFields(rel), fields)
}

/** Whether two sets of a relationship's own fields say different things. */
export function linkFieldsDiffer(
	a: RelationshipFieldsValue,
	b: RelationshipFieldsValue
): boolean {
	const reason = (v: string | null | undefined) => v?.trim() || null
	return (
		a.relationshipType !== b.relationshipType ||
		a.reverseRelationshipType !== b.reverseRelationshipType ||
		a.name !== b.name ||
		a.description !== b.description ||
		a.status !== b.status ||
		a.visibility !== b.visibility ||
		reason(a.reason) !== reason(b.reason) ||
		a.historyEntryId !== b.historyEntryId
	)
}
