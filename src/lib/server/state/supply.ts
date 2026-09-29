/**
 * 🚧 Item supply — how many of an item are held, and how many are left
 * (attributes phase 3a, 2026-09-26).
 *
 * Counts live in two places (owner ruling): the item entry's **supply**
 * (`core:entry/item@1` — unique, limited to N, or unlimited) and each
 * holder's **held count** on the list item that references it
 * (`{ entryId, count }`). This module puts the two side by side.
 *
 * ⚠ **It answers; it never enforces.** Supply is enforced by genre pipelines
 * (ruled 2026-09-25): they read this through `core:query/item-supply@1` and
 * decide what a zero means. The write gate stores whatever the slot accepts,
 * so an over-held item is a state a pipeline let happen, and reads as none
 * left rather than as debt.
 *
 * Held = Σ over every list slot this session tracks, for every owner in it —
 * the world (`session`), each cast member (`session_cast`) and each location
 * (`session_location`, phase 4) — of the value in force (`valueOf`, so an
 * inherited pack counts too).
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { heldCountIn, isSlotLoreRef, type SlotListItem } from "@serene-pub/sdk"
import { itemSupplyOf, remainingItemSupply, type ItemSupplyMode } from "@serene-pub/core-catalog"
import { ITEM_TYPE_ID } from "$lib/shared/entries/types"
import { sessionLinks, sessionLorebookIds, valueOf, vocabularyFor } from "$lib/server/state/resolve"
import { sessionReadingOf } from "$lib/server/state/reading"
import {
	MAIN_HEAD,
	entryAt,
	entryOnReadingSql,
	entryOverlaysFor
} from "$lib/server/state/entriesOnReading"
import type { StateOwner } from "$lib/server/state/owners"

/** One owner's holding of one item — a character's, the world's, or a place's (phase 4). */
export interface ItemHolder {
	ownerKind: "session" | "session_cast" | "session_location"
	ownerId: number
	slotId: string
	count: number
}

/** One item's supply, answered. */
export interface ItemSupplyRow {
	entryId: number
	name: string
	supply: ItemSupplyMode
	/** How many exist; `null` — no bound. */
	limit: number | null
	/** Σ held counts across the session's owners. */
	held: number
	/** limit − held, never below zero; `null` for an unlimited supply. */
	remaining: number | null
	holders: ItemHolder[]
}

/**
 * The supply of the item entries in this session's lorebook — all of them,
 * or the ones asked for. An id that is not an item in this session's
 * lorebook is not answered for (the scoping refusal, as a missing row).
 */
export async function itemSupplyFor(
	db: Db,
	sessionId: number,
	entryIds?: readonly number[]
): Promise<ItemSupplyRow[]> {
	// `sessions.lorebook_id` — see `sessionLorebookIds`.
	const books = await sessionLorebookIds(db, sessionId)
	if (!books.length || (entryIds && !entryIds.length)) return []

	// The items as the session reads its book: on its line, at its clock or
	// the head, each resolved through the line's amendments (a supply cut to
	// "unique" at Y3 is unique from Y3), and none the line has shelved.
	const reading = (await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD
	const stored = await db
		.select({
			id: schema.lorebookEntries.id,
			lorebookId: schema.lorebookEntries.lorebookId,
			title: schema.lorebookEntries.title,
			fields: schema.lorebookEntries.fields,
			archived: schema.lorebookEntries.archived
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				inArray(schema.lorebookEntries.lorebookId, books),
				eq(schema.lorebookEntries.typeId, ITEM_TYPE_ID),
				entryOnReadingSql(reading),
				...(entryIds ? [inArray(schema.lorebookEntries.id, [...entryIds])] : [])
			)
		)
		.orderBy(schema.lorebookEntries.id)
	if (!stored.length) return []
	const overlays = new Map<number, Awaited<ReturnType<typeof entryOverlaysFor>>>()
	for (const book of new Set(stored.map((r) => r.lorebookId)))
		overlays.set(book, await entryOverlaysFor(db, book, reading, stored.map((r) => r.id)))
	const items = stored
		.map((r) => {
			// The wire names an amendment overlays: `name`, declared fields flat.
			const e = entryAt(
				{ ...((r.fields ?? {}) as Record<string, unknown>), id: r.id, name: r.title ?? "", archived: r.archived },
				overlays.get(r.lorebookId) ?? new Map(),
				reading
			) as Record<string, unknown> & { id: number }
			return { id: r.id, title: typeof e.name === "string" ? e.name : "", fields: e, archived: e.archived === true }
		})
		.filter((i) => !i.archived)
	if (!items.length) return []

	const holders = await holdingsFor(db, sessionId, new Set(items.map((i) => i.id)))
	return items.map((item) => {
		const supply = itemSupplyOf(item.fields as Record<string, unknown> | null)
		const held = holders.filter((h) => h.entryId === item.id)
		const total = held.reduce((sum, h) => sum + h.count, 0)
		return {
			entryId: item.id,
			name: item.title ?? "",
			supply: supply.mode,
			limit: supply.limit,
			held: total,
			remaining: remainingItemSupply(supply, total),
			holders: held.map(({ entryId: _entryId, ...h }) => h)
		}
	})
}

/** Every (owner, list slot) holding of the given entries, as the session resolves it now. */
async function holdingsFor(
	db: Db,
	sessionId: number,
	entryIds: ReadonlySet<number>
): Promise<Array<ItemHolder & { entryId: number }>> {
	const links = await sessionLinks(db, sessionId)
	const vocabulary = await vocabularyFor(db, sessionId, links)
	const lists = vocabulary.entries.map((e) => e.decl).filter((d) => d.type === "list")
	const owners: Array<{
		owner: StateOwner & { kind: ItemHolder["ownerKind"] }
		facet: "world" | "cast" | "location"
	}> = [
		{ owner: { kind: "session", id: sessionId }, facet: "world" },
		...links.cast.map((c) => ({
			owner: { kind: "session_cast" as const, id: c.characterId },
			facet: "cast" as const
		})),
		// What is lying in a place is held there (phase 4): a key left in the
		// crypt is one of the limited supply as much as a key in a pocket.
		...links.locations.map((l) => ({
			owner: { kind: "session_location" as const, id: l.entryId },
			facet: "location" as const
		}))
	]
	const out: Array<ItemHolder & { entryId: number }> = []
	for (const { owner, facet } of owners)
		for (const decl of lists) {
			if (!decl.appliesTo.includes(facet)) continue
			const value = await valueOf(db, { sessionId, owner, slotId: decl.id }, { links, vocabulary })
			if (!Array.isArray(value)) continue
			const ids = new Set(
				(value as readonly SlotListItem[])
					.filter(isSlotLoreRef)
					.map((ref) => ref.entryId)
					.filter((id) => entryIds.has(id))
			)
			for (const entryId of ids)
				out.push({
					entryId,
					ownerKind: owner.kind,
					ownerId: owner.id,
					slotId: decl.id,
					count: heldCountIn(value, entryId)
				})
		}
	return out
}
