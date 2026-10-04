/**
 * 🚧 A place's Stats section, as arithmetic (plan places-graph L4; owner
 * answer Q5, 2026-09-29: "put the key in the crypt").
 *
 * What the lorebook itself holds for a place — the durable layer every
 * session on the book inherits until it changes the value — read and written
 * over `lorebookState:*` at the line and moment the place editor reads.
 * Limited as ruled: the core inventory, and the place stats the book already
 * records. The server decides which those are; this file draws what it said.
 *
 * The drawing reuses the session widgets' own plain-TypeScript half
 * (`@serene-pub/core-catalog/session-state`): which control a stat's shape
 * is, what a list item reads as, how a list grows and shrinks — so a key in
 * the crypt reads the same here as in the World State widget.
 *
 * ⚠ **Not an entry column.** A stat saves on its own, at once, never with
 * the entry's Save or Save as of — as a Link does.
 */

import {
	listItemKeyOf,
	listItemsOf,
	pickableEntries,
	shownValueText,
	slotKind,
	slotWritable,
	type PickableEntry,
	type SlotKind
} from "@serene-pub/core-catalog/session-state"
import { isSlotLoreRef, slotLoreRefCount, type SlotValue } from "@serene-pub/sdk"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { momentDate } from "../time/moment"
import { SCENE_KIND, type PoolItem } from "../poolFilter"

type Read = Sockets.LorebookState.Get.Response

/** Entry kinds nothing holds: a place, a date, a scene. */
const NOT_HELD: ReadonlySet<string> = new Set([LOCATION_TYPE_ID, HISTORY_TYPE_ID, SCENE_KIND])

/** Where the place editor reads: the line, and the moment (a story-date key). */
export interface PlaceStatsReading {
	branchId: number | null
	moment: string | null | undefined
}

/** One held item of a list stat, as the section lists it. */
export interface PlaceStatItem {
	/** A stable key for a keyed `#each`: position and identity. */
	key: string
	index: number
	/** A lore entry's name as the pool reads it; a word as itself. */
	name: string
	/** The name, and how many past one: `Rusty key ×2`. */
	text: string
	/** The lore entry it is, or null for a word. */
	entryId: number | null
	count: number
}

/** One stat of the place, drawn by its shape. */
export interface PlaceStatRow {
	slot: Sockets.State.SlotDescriptor
	kind: SlotKind
	/** The book's value; undefined when the book never set it. */
	value: SlotValue | undefined
	/** The configuration in force for this place: bounds, options, a list's limits. */
	config: Record<string, unknown>
	/** False for a retired stat: shown with its value, nothing new written. */
	writable: boolean
	/** A list's items; empty for anything else. */
	items: PlaceStatItem[]
	/** A non-list value as a line of text; "" when not set. */
	text: string
	/** The story date the book's value holds from; null when it is undated (or not set). */
	heldSince: Sockets.LorebookState.Moment | null
}

/** The read of one place, at the reading. */
export function placeStatsReadParams(
	lorebookId: number,
	placeId: number,
	reading: PlaceStatsReading
): Sockets.LorebookState.Get.Params {
	const date = momentDate(reading.moment)
	return {
		lorebookId,
		owner: { kind: "location", id: placeId },
		branchId: reading.branchId ?? null,
		moment: date ? { year: date.year, month: date.month ?? null, day: date.day ?? null } : null
	}
}

/**
 * One stat written whole, at the reading, naming the value it was made from
 * (`readValue`: the row's value as read, null when not set) — the server
 * refuses the write when the book's value has moved since, and dates it
 * itself (`writeDatedBy`, else the value's `heldSince`).
 */
export function placeStatsWriteParams(
	lorebookId: number,
	placeId: number,
	reading: PlaceStatsReading,
	slotId: string,
	value: SlotValue,
	readValue: SlotValue | undefined
): Sockets.LorebookState.Set.Params {
	return {
		...placeStatsReadParams(lorebookId, placeId, reading),
		slotId,
		value,
		readValue: readValue ?? null
	}
}

/**
 * The server's read as rows, in the order it offered them. `nameOf` is the
 * pool's name for an entry (amended as of the moment); without one, the name
 * the server read.
 */
export function placeStatRows(
	read: Read,
	nameOf: (entryId: number) => string | undefined
): PlaceStatRow[] {
	return read.slots.map((slot) => {
		const value = read.values[slot.slotId] as SlotValue | undefined
		const kind = slotKind(slot)
		const items: PlaceStatItem[] =
			kind === "list"
				? listItemsOf(value).map((item, index) => {
						if (isSlotLoreRef(item)) {
							const name = nameOf(item.entryId) || item.name?.trim() || `Lore entry ${item.entryId}`
							const count = slotLoreRefCount(item)
							return {
								key: listItemKeyOf(item, index),
								index,
								name,
								text: count > 1 ? `${name} ×${count}` : name,
								entryId: item.entryId,
								count
							}
						}
						return {
							key: listItemKeyOf(item, index),
							index,
							name: String(item),
							text: String(item),
							entryId: null,
							count: 1
						}
					})
				: []
		return {
			slot,
			kind,
			value,
			config: read.configs[slot.slotId] ?? {},
			writable: slotWritable(slot),
			items,
			text: kind === "list" || value === undefined ? "" : shownValueText(slot, value, (s) => s),
			heldSince: value === undefined ? null : (read.heldSince?.[slot.slotId] ?? null)
		}
	})
}

/**
 * What a stat set here stands for in time, in a sentence under the heading.
 * `moment` is the moment's label (null at now); `datedBy` the label of the
 * date the server dates a change here by (`writeDatedBy`), or null when
 * nothing in the line's history is dated that moment — then a change keeps
 * the date of the value it changes (a row's `heldSince`, shown beside it).
 */
export function placeStatsDating(moment: string | null, datedBy: string | null): string {
	if (datedBy !== null) return `Set here, a stat is dated ${datedBy} and holds from then on.`
	const keeps =
		"a change here keeps the date of the value it changes: from the start of the story, or from the date beside the stat."
	if (moment === null) return `A${keeps.slice(1)}`
	return `Nothing in the history is dated ${moment}, so ${keeps}`
}

/**
 * What **Add from the lorebook** offers: the book's items first, then its
 * other lore — the session picker's order. Never a place (a room does not lie
 * in a room; it is linked), a history entry (a date is not a thing), a scene,
 * or an archived entry. `held` says how many the list already holds.
 */
export function placeStatPicks(
	pool: readonly PoolItem[],
	placeId: number,
	value: unknown
): PickableEntry[] {
	const rows = pool
		.filter((item) => item.id !== placeId && !item.archived && !NOT_HELD.has(item.kind))
		.map((item) => ({ id: item.id, typeId: item.kind, title: item.name }))
	return pickableEntries(value, [rows])
}
