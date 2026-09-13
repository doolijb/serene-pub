/**
 * The map, as arithmetic.
 *
 * Three layers, and each draws a different mark. Containment is the entry's
 * parent and gives the nested boxes; a travel edge between two entries gives a
 * labelled line between boxes; a cast member who lives in or keeps a place
 * gives a pin inside it. Nothing here decides that an entry *is* a place: an
 * entry is on the map when something joins it or holds it, which is the only
 * claim the data supports.
 */

import {
	isTravelLinkType,
	TRAVEL_LINK_TYPES
} from "$lib/shared/lorebooks/linkVocabulary"
import type { EndpointLike } from "../graphs/graphModel"

/** An entry, as little of it as the map needs. */
export interface PlaceEntryLike {
	id: number
	name: string
	/** What it is filed under, by id, or null at the top level. */
	parentId: number | null
}

/** An edge, as little of it as the map needs. */
export interface PlaceEdgeLike {
	id: number
	from: EndpointLike
	to: EndpointLike
	relationshipType: string
	status?: string
}

/** A member standing somewhere, drawn inside the box they stand in. */
export interface PlacePin {
	castId: number
	name: string
	entryId: number
	relationshipType: string
}

/** A box, holding the boxes filed under it. */
export interface PlaceRegion {
	id: number
	name: string
	children: PlaceRegion[]
	pins: PlacePin[]
}

/** A road, a tunnel, a way through: a labelled line between two boxes. */
export interface PlaceLink {
	id: number
	fromId: number
	toId: number
	/** The type as it was typed, which is what the line is labelled. */
	label: string
}

export interface PlacesMap {
	regions: PlaceRegion[]
	links: PlaceLink[]
	pins: PlacePin[]
	/** Entries the map has something to say about. */
	mapped: number
	linkCount: number
}

/**
 * The cast edges that put somebody in a room.
 *
 * Owning a thing and dying at one are facts about a member, not about where
 * they are standing, so they earn no pin.
 */
export const PIN_LINK_TYPES = ["lives in", "keeper of"] as const

export const isPinLinkType = (value: string): boolean =>
	(PIN_LINK_TYPES as readonly string[]).includes(value.trim().toLowerCase())

export interface PlacesMapInput {
	entries: readonly PlaceEntryLike[]
	relationships: readonly PlaceEdgeLike[]
	/** Cast names by binding id, so a pin can be read. */
	castNames: ReadonlyMap<number, string>
}

/**
 * What the map holds.
 *
 * An entry is mapped when containment, a travel link or a pin reaches it. A
 * parent the map does not hold is not a box, so its child is drawn as a root:
 * a region nothing says anything about would be an empty frame around the only
 * thing on screen.
 */
export function buildPlacesMap(input: PlacesMapInput): PlacesMap {
	const byId = new Map(input.entries.map((e) => [e.id, e]))

	const links: PlaceLink[] = []
	const pins: PlacePin[] = []
	for (const rel of input.relationships) {
		if (
			rel.from.kind === "entry" &&
			rel.to.kind === "entry" &&
			isTravelLinkType(rel.relationshipType)
		) {
			links.push({
				id: rel.id,
				fromId: rel.from.entryId,
				toId: rel.to.entryId,
				label: rel.relationshipType
			})
			continue
		}
		const cast = rel.from.kind === "cast" ? rel.from : null
		const entry = rel.to.kind === "entry" ? rel.to : null
		if (!cast || !entry || !isPinLinkType(rel.relationshipType)) continue
		pins.push({
			castId: cast.bindingId,
			name: input.castNames.get(cast.bindingId) ?? `#${cast.bindingId}`,
			entryId: entry.entryId,
			relationshipType: rel.relationshipType
		})
	}

	const mapped = new Set<number>()
	for (const entry of input.entries) {
		if (entry.parentId != null && byId.has(entry.parentId)) {
			mapped.add(entry.id)
			mapped.add(entry.parentId)
		}
	}
	for (const link of links) {
		if (byId.has(link.fromId)) mapped.add(link.fromId)
		if (byId.has(link.toId)) mapped.add(link.toId)
	}
	for (const pin of pins) if (byId.has(pin.entryId)) mapped.add(pin.entryId)

	const pinsByEntry = new Map<number, PlacePin[]>()
	for (const pin of pins) {
		const list = pinsByEntry.get(pin.entryId) ?? []
		list.push(pin)
		pinsByEntry.set(pin.entryId, list)
	}

	const childrenOf = new Map<number, PlaceEntryLike[]>()
	const roots: PlaceEntryLike[] = []
	for (const entry of input.entries) {
		if (!mapped.has(entry.id)) continue
		const parent =
			entry.parentId != null && mapped.has(entry.parentId)
				? entry.parentId
				: null
		if (parent === null) {
			roots.push(entry)
			continue
		}
		const list = childrenOf.get(parent) ?? []
		list.push(entry)
		childrenOf.set(parent, list)
	}

	/** Depth is bounded by the tree the server refuses cycles in. */
	const region = (entry: PlaceEntryLike): PlaceRegion => ({
		id: entry.id,
		name: entry.name,
		children: (childrenOf.get(entry.id) ?? []).map(region),
		pins: pinsByEntry.get(entry.id) ?? []
	})

	return {
		regions: roots.map(region),
		links,
		pins,
		mapped: mapped.size,
		linkCount: links.length
	}
}

/** What to do on a map with nothing on it. */
export const PLACES_EMPTY_LINE =
	"nothing mapped yet · link two places or put one inside another"

/** The types that make an edge a way of getting somewhere, for the picker. */
export const PLACES_LINK_TYPES = TRAVEL_LINK_TYPES

/** The map, said out loud above it. */
export function placesHeaderLine(mapped: number, links: number): string {
	if (mapped === 0 && links === 0) return `Places · 0 · ${PLACES_EMPTY_LINE}`
	return `Places · ${mapped} mapped · ${links} ${
		links === 1 ? "link" : "links"
	}`
}
