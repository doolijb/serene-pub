/**
 * 🚧 A place's stats, set in the lorebook before play (plan places-graph L4;
 * owner answer Q5, 2026-09-29: "put the key in the crypt").
 *
 * ## The durable layer, written with no session
 *
 * A place holds stats at two layers (`state/owners.ts`): `location`, the
 * place as the WORLD knows it (`session_id` NULL), and `session_location`,
 * one run's layer over it. Until now only a session wrote the first — by
 * `state:set` naming the durable kind, or by recording onto the timeline
 * (`durable.ts`). This is the lorebook's own door: the place editor's
 * **Stats** section reads and writes the `location` layer, and every session
 * on the book inherits it through `resolutionChain` until that session
 * changes the value itself.
 *
 * ## Where the editor stands
 *
 * The row stands where the editor reads: on the line being read
 * (`branch_id`; NULL is main, which a branch reads too), and dated so that it
 * is the value in force THERE (`history_entry_id`, chosen here, never by the
 * caller):
 *
 * - reading at a moment some history entry on the line is dated, by that
 *   entry — the value holds from that date on, as a Link drawn there does;
 * - otherwise (now, or a date nothing is dated) it keeps the date of the
 *   value it changes: an undated value stays undated (true from the start of
 *   the story), and a change to the lamp dated Year 7 is dated Year 7 too.
 *
 * Which row is in force is decided by story date, undated earliest, and only
 * then by write order (`resolve.ts inForce`). So a change reaches every moment
 * from its date on and none before it, whenever it was written — without the
 * second rule a change made at now was undated, and an undated row that a
 * dated one shadows at now is a change the author never sees land; by write
 * order alone it was worse, putting the Year 7 lamp in the crypt at Year 3.
 * A read stands at the same reading (`rowsOnReading`, `inForce`), so what the
 * section shows is what a session at that line and moment would inherit.
 *
 * ## Written whole, from what was read
 *
 * A list is written whole, from the value the author saw. A write names that
 * value (`readValue`), and is refused when the book's value at the reading has
 * moved since — another tab, or a session recording a scene onto the world
 * (`durable.ts`) — rather than putting the stale list back over it.
 *
 * ## Limited, as ruled
 *
 * The core **inventory**, and the stats the book already records for places
 * (`lorebookVocabularyFor`: its sheets and durable rows, narrowed to those
 * that apply to a place). Every place of a book is offered the same list;
 * per-place vocabulary is the attributes programme's (plan §14). A write
 * naming anything else is refused, never stored unread.
 *
 * ## Who
 *
 * The book's owner, and nobody else (B0's rule, `assertBookOwner`): a
 * template row outlives every session and resolves in sessions its writer
 * may not be able to open.
 */

import { eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	getAttributeSlot,
	isSlotLoreRef,
	resolveSlotConfig,
	slotPickable,
	slotValueForStorage,
	type AttributeSlotDecl,
	type SlotConfig,
	type SlotValue
} from "@serene-pub/sdk"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import { entryAt, entryOnLineSql, entryOverlaysFor } from "$lib/server/state/entriesOnReading"
import { whyUnseen } from "$lib/shared/lorebooks/placeSight"
import { INVENTORY_SLOT_ID } from "$lib/server/state/inventory"
import {
	durableRows,
	lorebookLinks,
	lorebookVocabularyFor,
	type LorebookVocabulary
} from "$lib/server/state/lorebookState"
import {
	BranchRefusal,
	readingOf,
	rowsOnReading,
	writeDatingAt,
	type LineReading,
	type StoryDating
} from "$lib/server/state/reading"
import { configFor, inForce, nameLoreRefs } from "$lib/server/state/resolve"
import { assertBookOwner, StateRefusal, validateValue } from "$lib/server/state/write"

/** Where the place editor reads: its line and its moment. */
export interface PlaceStatReading {
	lorebookId: number
	/** The line being read; null is main. */
	branchId: number | null
	/** The moment being read; null is now (the head of the line). */
	moment: StoryDate | null
}

/** A place's stats on a reading. */
export interface PlaceStats {
	reading: LineReading
	place: { entryId: number; name: string }
	/** What the section offers, inventory first. */
	decls: AttributeSlotDecl[]
	/** The book's value per slot id — present only when set; lore references named. */
	values: Record<string, SlotValue>
	/** The configuration in force for this place, per slot id. */
	configs: Record<string, SlotConfig>
	/**
	 * Per slot id, the date the value in force holds from — present only when
	 * that value is dated (its history entry has a date).
	 */
	heldSince: Record<string, StoryDating>
	/**
	 * The history entry on the line dated exactly the moment being read, which
	 * dates every write made here; null at now, or when none is.
	 */
	writeDatedBy: StoryDating | null
}

export type { StoryDating }

/** The most one stat of a place holds, written in one go (L4 review: nothing capped it). */
export const PLACE_STAT_MAX_ITEMS = 500
export const PLACE_STAT_MAX_CHARS = 20_000

export interface PlaceStatWrite extends PlaceStatReading {
	placeId: number
	slotId: string
	/** A list is written whole. `null` clears the book's value. */
	value: SlotValue
	/**
	 * The book's value this write was made from, as read (null: not set).
	 * The write is refused when the book's value at write time differs from it.
	 * Omitted, nothing is compared.
	 */
	readValue?: SlotValue
	/** The person writing. Must own the book. */
	userId: number
}

/**
 * What a place's Stats section offers: the core inventory, then every stat
 * the book records that applies to a place, in the vocabulary's order. A
 * derived stat has nothing to set, and a place does not compute one yet
 * (stats-and-states "not built yet"), so it is not offered.
 */
export function placeStatDecls(vocabulary: LorebookVocabulary): AttributeSlotDecl[] {
	const out: AttributeSlotDecl[] = []
	const take = (decl: AttributeSlotDecl | undefined) => {
		if (!decl || decl.type === "derived" || !slotPickable(decl)) return
		if (!decl.appliesTo.includes("location")) return
		if (out.some((d) => d.id === decl.id)) return
		out.push(decl)
	}
	take(getAttributeSlot(INVENTORY_SLOT_ID))
	for (const decl of vocabulary.decls) take(decl)
	return out
}

/** The reading a write or a read stands at; a branch of another book is refused. */
async function placeReading(db: Db, at: PlaceStatReading): Promise<LineReading> {
	try {
		return await readingOf(db, at.lorebookId, {
			branch: at.branchId ?? "main",
			moment: at.moment
		})
	} catch (e) {
		if (e instanceof BranchRefusal) throw new StateRefusal(e.message)
		throw e
	}
}

/**
 * One place's stats as the book holds them at the reading. Refuses a place
 * that is not a live place of this book on the line (archived at the moment
 * included), in a sentence.
 */
export async function placeStatsFor(
	db: Db,
	query: PlaceStatReading & { placeId: number }
): Promise<PlaceStats> {
	const reading = await placeReading(db, query)
	const links = await lorebookLinks(db, query.lorebookId, reading)
	const place = links.locations.find((l) => l.entryId === query.placeId)
	if (!place)
		throw new StateRefusal(
			"That is not a place of this lorebook on this line, or it is archived at this moment."
		)
	const decls = placeStatDecls(await lorebookVocabularyFor(db, links))
	const owner = { kind: "location" as const, id: place.entryId }
	const rows = await rowsOnReading(
		db,
		await durableRows(db, [owner], decls.map((d) => d.id)),
		reading
	)
	const values: Record<string, SlotValue> = {}
	const configs: Record<string, SlotConfig> = {}
	const heldSince: Record<string, StoryDating> = {}
	for (const decl of decls) {
		const row = inForce(
			rows.filter((r) => r.slotId === decl.id),
			reading.dates
		)
		const v = row?.value?.v as SlotValue | undefined
		// A cleared row reads as not set: absent, never a stored null.
		if (v !== null && v !== undefined) values[decl.id] = v
		const date = row?.historyEntryId != null ? (reading.dates?.get(row.historyEntryId) ?? null) : null
		if (row?.historyEntryId != null && date) heldSince[decl.id] = { historyEntryId: row.historyEntryId, date }
		configs[decl.id] = await configFor(db, { owner, slotId: decl.id, reading })
	}
	await nameLoreRefs(db, [values], reading, "book")
	const writeDatedBy = await historyDatedAt(db, reading)
	return { reading, place, decls, values, configs, heldSince, writeDatedBy }
}

/**
 * The history entry on the reading's line dated exactly its moment (the
 * lowest id, when two are); null at now, or when nothing is dated then —
 * the Links list's rule (`whenAtMoment`), on the server. The shared dating
 * helper's answer (`writeDatingAt`), taken only when it falls ON the moment:
 * between dates, and at now, a place's write keeps the date of the value it
 * changes (see the header) rather than the latest date before it.
 */
async function historyDatedAt(db: Db, reading: LineReading): Promise<StoryDating | null> {
	const moment = reading.moment
	if (!moment) return null
	const dating = await writeDatingAt(db, reading)
	return dating && compareDates(dating.date, moment) === 0 ? dating : null
}

/** Two values the same once stored: a reference's read-in `name` and key order aside. */
const sameStored = (a: SlotValue, b: SlotValue) =>
	JSON.stringify(slotValueForStorage(a ?? null)) === JSON.stringify(slotValueForStorage(b ?? null))

/**
 * Set one of a place's stats in the book (see the header). Returns the new
 * row's id. Every refusal is a `StateRefusal` a person can read.
 */
export async function setPlaceStat(db: Db, write: PlaceStatWrite): Promise<number> {
	await assertBookOwner(db, write.lorebookId, write.userId)
	// The read it is compared with, the checks and the insert are ONE
	// transaction under the place's lock: read outside it, two tabs writing
	// one place from the same read both pass the comparison and the second
	// lands blind over the first — the stale list put back that `readValue`
	// exists to refuse. Only `tx` inside it.
	return await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('placeStat'), ${write.placeId})`)
		const stats = await placeStatsFor(tx, write)
		const decl = stats.decls.find((d) => d.id === write.slotId)
		if (!decl) {
			const named = getAttributeSlot(write.slotId)
			const label = named ? (i18nTextIn(named.label) ?? named.id) : `'${write.slotId}'`
			throw new StateRefusal(
				`${label} is not a stat this lorebook keeps for places. A place here holds its inventory ` +
					`and the stats the lorebook already records for places.`
			)
		}
		const label = i18nTextIn(decl.label) ?? decl.id
		if (write.readValue !== undefined && !sameStored(write.readValue, stats.values[decl.id] ?? null))
			throw new StateRefusal(
				`${label} changed since this was read, so nothing was saved. What it holds now is shown; ` +
					`make the change again if it still applies.`
			)
		const value = slotValueForStorage(write.value ?? null)
		assertWithinLimits(label, value)
		await assertLoreRefsInBook(tx, write.lorebookId, stats.reading, decl, value, stats.place.entryId)
		const owner = { kind: "location" as const, id: stats.place.entryId }
		await validateValue(tx, {
			owner,
			slotId: decl.id,
			value,
			config: stats.configs[decl.id]
		})
		const [row] = await tx
			.insert(schema.attributeValues)
			.values({
				ownerKind: owner.kind,
				ownerId: owner.id,
				slotId: decl.id,
				value: { v: value },
				// The durable layer: no session, no message — authoring is not play.
				sessionId: null,
				validFromMessageId: null,
				updatedBy: "user",
				branchId: stats.reading.branchId,
				// The moment's own date, else the date of the value it changes
				// (see the header): either way, in force where it was written.
				historyEntryId:
					stats.writeDatedBy?.historyEntryId ?? stats.heldSince[decl.id]?.historyEntryId ?? null
			})
			.returning({ id: schema.attributeValues.id })
		return row!.id
	})
}

/** Refuse a value bigger than one stat of a place holds. */
function assertWithinLimits(label: string, value: SlotValue): void {
	const items = Array.isArray(value) ? value.length : 0
	const chars = JSON.stringify(value ?? null).length
	if (items > PLACE_STAT_MAX_ITEMS || chars > PLACE_STAT_MAX_CHARS)
		throw new StateRefusal(
			`That is too much for ${label}: one stat of a place holds at most ` +
				`${PLACE_STAT_MAX_ITEMS} items and ${PLACE_STAT_MAX_CHARS.toLocaleString("en")} characters.`
		)
}

/**
 * Every lore reference a value brings in names an entry of THIS book on the
 * line being written, not archived as the line's dated changes leave it at
 * the moment being written (book sight, plan A27: an entry archived by an
 * amendment is refused, one an amendment restored is taken; one switched Off
 * is taken — the author may set up a room for when it is back) — the book's
 * own form of `write.ts assertLoreRefsInSession`, in the book's words. A text
 * slot's single reference must also be of the entry types its config names.
 * What a place's LIST holds is never a place (itself included: a room does
 * not lie in a room, it is linked) or a history entry (a date is not a
 * thing) — the rule **Add from the lorebook** offers by (`placeStatPicks`),
 * held here too.
 *
 * ⚠ Whose book first. An entry of another book is refused as "Lore entry
 * {id}", never by its title: anyone who owns a book reaches this, and a
 * refusal quoting the title would read other people's books one id at a time.
 */
async function assertLoreRefsInBook(
	db: Db,
	lorebookId: number,
	reading: LineReading,
	decl: AttributeSlotDecl,
	value: SlotValue,
	placeId: number
): Promise<void> {
	const incoming: readonly unknown[] = Array.isArray(value)
		? value
		: isSlotLoreRef(value)
			? [value]
			: []
	const ids = [...new Set(incoming.filter(isSlotLoreRef).map((ref) => ref.entryId))]
	if (!ids.length) return
	const entryTypes = decl.type !== "list" ? (resolveSlotConfig(decl).entryTypes ?? null) : null
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			lorebookId: schema.lorebookEntries.lorebookId,
			title: schema.lorebookEntries.title,
			typeId: schema.lorebookEntries.typeId,
			enabled: schema.lorebookEntries.enabled,
			archived: schema.lorebookEntries.archived,
			onLine: sql<boolean>`(${entryOnLineSql(reading)})`
		})
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, ids))
	const byId = new Map(rows.map((r) => [r.id, r]))
	const overlays = await entryOverlaysFor(
		db,
		lorebookId,
		reading,
		rows.filter((r) => r.lorebookId === lorebookId).map((r) => r.id)
	)
	for (const id of ids) {
		const row = byId.get(id)
		if (!row || row.lorebookId !== lorebookId)
			throw new StateRefusal(`Lore entry ${id} is not in this lorebook, so nothing here can hold it.`)
		// The book's own entry, as the line reads it at the moment: its name
		// and marks after the line's dated changes.
		const seen = entryAt(
			{ id: row.id, name: row.title ?? "", enabled: row.enabled, archived: row.archived },
			overlays,
			reading
		)
		const named =
			typeof seen.name === "string" && seen.name ? `'${seen.name}'` : `Lore entry ${id}`
		if (!row.onLine)
			throw new StateRefusal(
				`${named} was written on another line of this lorebook, so this line does not have it.`
			)
		const unseen = whyUnseen(row, seen, "book")
		if (unseen === "archived")
			throw new StateRefusal(`${named} is archived, so nothing here can hold it. Restore it first.`)
		if (unseen === "archived-for-now")
			throw new StateRefusal(
				`${named} is archived at this point in the story by a dated change, so nothing here can ` +
					`hold it at this moment. Change that dated change first.`
			)
		if (decl.type === "list" && (row.typeId === LOCATION_TYPE_ID || id === placeId))
			throw new StateRefusal(
				`${named} is a place, so it cannot lie in one. Link the two places instead.`
			)
		if (decl.type === "list" && row.typeId === HISTORY_TYPE_ID)
			throw new StateRefusal(`${named} is a history entry — a date, not a thing a place can hold.`)
		if (entryTypes && !entryTypes.some((t) => t.replace(/@\d+$/, "") === row.typeId))
			throw new StateRefusal(
				`${named} is a ${row.typeId} entry, and ${decl.id} points only at ${entryTypes.join(", ")} entries.`
			)
	}
}
