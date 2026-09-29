/**
 * 🚧 What a LOREBOOK holds of its world, its cast and its places — the stats a
 * pipeline reads with no session in play (`core:query/lorebook-state@1`,
 * owner-confirmed 2026-09-27: "Pipelines should be allowed to query stats from
 * the lorebook as well").
 *
 * ## The durable layer, and only that
 *
 * A lorebook's stats are its **durable** rows (`session_id IS NULL`): what
 * write-back recorded onto the timeline (`durable.ts recordToTimeline`) and what
 * an author set on the lorebook, a cast member or a place. Nothing falls
 * through to a card or to a default: a read of the book says what the BOOK
 * says, and "the book never recorded a mood" is an absent key, not the
 * declaration's `calm`. The row in force per owner and slot is `inForce`'s —
 * the same rule a session reads this layer by, so what this answers is exactly
 * what a new session played in the book would inherit.
 *
 * ## The vocabulary without a session (phase 1's world rule, reused)
 *
 * A lorebook has no genre, so it has no baseline. What it tracks is what
 * phase 1 calls **world attributes** (`worldAttributesFor`): the sheets on the
 * lorebook, its cast members and its places, plus every pickable, declared slot
 * the book holds a durable value for. It fails closed like `vocabularyFor`: a
 * slot whose declaration this process does not hold, or one a mechanism keeps
 * (`pickable: false`), is not tracked and its rows are not read.
 *
 * ## Where on the book (rulings 15 and 16, 2026-09-27)
 *
 * A read stands at a `LineReading` (`state/reading.ts`): a line, a moment and
 * the fork cut. Rows on the line being read: shared (`branch_id IS NULL`) or
 * on that line (`onLine`); on a branch, main's DATED rows only up to the fork
 * date; at a moment, nothing dated after it. With no session the default
 * line is the book's most recently used one, at the head of its timeline;
 * a pipeline may name another (`branch`, `at`, `forkCut: false`).
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	getAttributeSlot,
	sheetSlotAppliesTo,
	slotPickable,
	type AttributeSlotDecl,
	type SheetSlotEntry,
	type SlotValue
} from "@serene-pub/sdk"
import { readingOf, rowsOnReading, type LineReading } from "$lib/server/state/reading"
import {
	MAIN_HEAD,
	castMemberAt,
	castOverlaysFor,
	placesOnReading,
	type EntryReading
} from "$lib/server/state/entriesOnReading"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { castKey, slotKey } from "$lib/server/state/keys"
import type { StateOwner } from "$lib/server/state/owners"
import {
	inForce,
	nameLoreRefs,
	onOwners,
	trackedShape,
	worldAttributesFor,
	writeKeys,
	type LocationEntry,
	type SessionLinks,
	type TrackedSlot
} from "$lib/server/state/resolve"

/** One cast member of a lorebook: a `lorebook_bindings` row. */
export interface LorebookCastLink {
	/** `lorebook_bindings.id` — the id a `cast_member` owner names. */
	castMemberId: number
	characterId: number | null
	name: string
}

/** The book's owners, read once: its cast members and its live places. */
export interface LorebookLinks {
	lorebookId: number
	cast: LorebookCastLink[]
	locations: { entryId: number; name: string }[]
}

/**
 * The book's owners **as the reading sees them** (finding #41): its places on
 * the reading's line, titled as amended by then, and its cast members named
 * as amended by then. With no reading, main at its head.
 *
 * ⚠ A member's `characterId` stays their OWN card even when an amendment swaps
 * it: it is the key a session seat holds (`normalizeOwner`'s `session_cast`
 * translation, `castMemberAsOf`), and a swapped card would un-seat them. The
 * swap is how they are drawn, not who they are.
 */
export async function lorebookLinks(
	db: Db,
	lorebookId: number,
	reading: EntryReading = MAIN_HEAD
): Promise<LorebookLinks> {
	const [members, overlays, places] = await Promise.all([
		db
			.select({
				id: schema.lorebookBindings.id,
				characterId: schema.lorebookBindings.characterId,
				name: schema.lorebookBindings.name
			})
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
			.orderBy(asc(schema.lorebookBindings.id)),
		castOverlaysFor(db, lorebookId, reading),
		placesOnReading(db, lorebookId, reading)
	])
	return {
		lorebookId,
		cast: members.map((m) => {
			const c = castMemberAt(m, overlays, reading, { keepCard: true })
			return {
				castMemberId: m.id,
				characterId: m.characterId ?? null,
				name: typeof c.name === "string" ? c.name : (m.name ?? "")
			}
		}),
		locations: places
	}
}


/** A lorebook's vocabulary: its tracked declarations, in first-mention order. */
export interface LorebookVocabulary {
	decls: AttributeSlotDecl[]
	slots: TrackedSlot[]
}

/**
 * What the lorebook tracks with no session: the sheets on its owners, then the
 * slots its durable rows hold — phase 1's world attributes, read for the book
 * alone. See the header.
 */
export async function lorebookVocabularyFor(
	db: Db,
	links: LorebookLinks
): Promise<LorebookVocabulary> {
	// `worldAttributesFor` reads links shaped for a session; the book's own
	// owners are the same three kinds, so the same rule is asked, not restated.
	const asSession: SessionLinks = {
		sessionId: 0,
		lorebookId: links.lorebookId,
		cast: links.cast.map((c, position) => ({
			characterId: c.characterId ?? 0,
			name: c.name,
			castMemberId: c.castMemberId,
			isPersona: false,
			isActive: false,
			position
		})),
		locations: links.locations,
		storyDate: null
	}
	const world = await worldAttributesFor(db, asSession, undefined, true)
	const decls: AttributeSlotDecl[] = []
	const sheetIds = new Map<string, string>()
	const take = (decl: AttributeSlotDecl | undefined, entry?: SheetSlotEntry, sheetId?: string) => {
		// Fails closed: undeclared or mechanism-kept slots are not tracked.
		if (!decl || !slotPickable(decl) || decls.some((d) => d.id === decl.id)) return
		decls.push(onOwners(decl, entry && sheetSlotAppliesTo(entry, decl)))
		if (sheetId) sheetIds.set(decl.id, sheetId)
	}
	for (const sheet of world.sheets)
		for (const entry of sheet.slots) take(getAttributeSlot(entry.id), entry, sheet.id)
	for (const slotId of world.recorded) take(getAttributeSlot(slotId))
	return {
		decls,
		slots: decls.map((d) => ({
			id: d.id,
			key: slotKey(d.id),
			type: d.type,
			...trackedShape(d),
			appliesTo: d.appliesTo,
			...(d.retired ? { retired: true as const } : {}),
			...(sheetIds.has(d.id) ? { sheetId: sheetIds.get(d.id)! } : {})
		}))
	}
}

/** Match a slot a pipeline named — its full id or its local name — in a vocabulary. */
export function trackedSlotNamed(
	decls: AttributeSlotDecl[],
	named: string
): AttributeSlotDecl | undefined {
	const wanted = named.trim()
	return decls.find((d) => d.id === wanted) ?? decls.find((d) => slotKey(d.id) === wanted)
}

/** One cast member as `core:query/lorebook-state@1` lists them. */
export interface LorebookCastEntry {
	/** `lorebook_bindings.id` — the cast member, never the card. */
	id: number
	key: string
	name: string
	[slot: string]: SlotValue
}

/** What `core:query/lorebook-state@1` publishes. */
export interface LorebookState {
	lorebookId: number
	/** The line read. Null is main. */
	branchId: number | null
	/** 🚧 The moment read at; null is the head of the timeline. */
	moment: StoryDate | null
	/** 🚧 Where main was cut for this branch; null when nothing was. */
	forkedAt: StoryDate | null
	/** What the book tracks, after the `slotIds` filter. */
	slots: TrackedSlot[]
	world: Record<string, SlotValue>
	cast: { byId: Record<string, LorebookCastEntry>; [slug: string]: unknown }
	locations: { byId: Record<string, LocationEntry>; [slug: string]: unknown }
}

/** The owner filter: one of the book's durable owners. */
export type LorebookOwnerFilter = { kind: "lorebook" | "cast_member" | "location"; id?: number }

export interface LorebookStateQuery {
	lorebookId: number
	/** The line (null = main) when `reading` is not given; fork cut on, head. */
	branchId?: number | null
	/** 🚧 Where on the book to read — wins over `branchId`. */
	reading?: LineReading
	owner?: LorebookOwnerFilter
	/** Full slot ids or local names; absent or empty is every tracked slot. */
	slotIds?: string[]
}

/** Thrown when an owner filter names somebody who is not in this book. */
export class LorebookOwnerRefusal extends Error {}

/**
 * The lorebook's durable stats: its world, each cast member, each place. See
 * the header for what "durable" and "tracked" mean here.
 */
export async function lorebookStateFor(
	db: Db,
	query: LorebookStateQuery,
	known: { links?: LorebookLinks; vocabulary?: LorebookVocabulary } = {}
): Promise<LorebookState> {
	const reading =
		query.reading ?? (await readingOf(db, query.lorebookId, { branch: query.branchId ?? "main" }))
	const branchId = reading.branchId
	const links = known.links ?? (await lorebookLinks(db, query.lorebookId, reading))
	const vocabulary = known.vocabulary ?? (await lorebookVocabularyFor(db, links))
	const owner = query.owner
	if (owner) assertOwnerInBook(links, owner)

	const named = (query.slotIds ?? []).filter((s) => typeof s === "string" && s.trim())
	const decls = named.length
		? vocabulary.decls.filter((d) => named.some((n) => trackedSlotNamed([d], n)))
		: vocabulary.decls
	const stored = decls.filter((d) => d.type !== "derived")
	const wants = (kind: LorebookOwnerFilter["kind"], id: number) =>
		!owner || (owner.kind === kind && (kind === "lorebook" || owner.id === id))

	const owners: StateOwner[] = [
		...(wants("lorebook", links.lorebookId) ? [{ kind: "lorebook" as const, id: links.lorebookId }] : []),
		...links.cast
			.filter((c) => wants("cast_member", c.castMemberId))
			.map((c) => ({ kind: "cast_member" as const, id: c.castMemberId })),
		...links.locations
			.filter((l) => wants("location", l.entryId))
			.map((l) => ({ kind: "location" as const, id: l.entryId }))
	]
	const rows = await rowsOnReading(db, await durableRows(db, owners, stored.map((d) => d.id)), reading)
	const valueFor = (o: StateOwner, slotId: string): SlotValue | undefined => {
		const row = inForce(rows.filter((r) => r.ownerKind === o.kind && r.ownerId === o.id && r.slotId === slotId))
		const v = row?.value?.v as SlotValue | undefined
		return v === null ? undefined : v
	}
	const fill = async (
		bag: Record<string, SlotValue>,
		o: StateOwner,
		facet: "world" | "cast" | "location"
	) => {
		for (const decl of stored.filter((d) => d.appliesTo.includes(facet)))
			await writeKeys(bag, decl, stored, async () => valueFor(o, decl.id))
	}

	const world: Record<string, SlotValue> = {}
	if (wants("lorebook", links.lorebookId)) await fill(world, { kind: "lorebook", id: links.lorebookId }, "world")

	const castById: Record<string, LorebookCastEntry> = {}
	for (const member of links.cast) {
		if (!wants("cast_member", member.castMemberId)) continue
		const entry: LorebookCastEntry = { id: member.castMemberId, key: castKey(member.name), name: member.name }
		await fill(entry, { kind: "cast_member", id: member.castMemberId }, "cast")
		castById[String(member.castMemberId)] = entry
	}
	const cast: LorebookState["cast"] = { byId: castById }
	for (const entry of Object.values(castById)) if (!(entry.key in cast)) cast[entry.key] = entry

	const placesById: Record<string, LocationEntry> = {}
	for (const place of links.locations) {
		if (!wants("location", place.entryId)) continue
		const entry: LocationEntry = { id: place.entryId, key: castKey(place.name), name: place.name }
		await fill(entry, { kind: "location", id: place.entryId }, "location")
		placesById[String(place.entryId)] = entry
	}
	const locations: LorebookState["locations"] = { byId: placesById }
	for (const entry of Object.values(placesById)) if (!(entry.key in locations)) locations[entry.key] = entry

	await nameLoreRefs(db, [world, ...Object.values(castById), ...Object.values(placesById)])
	return {
		lorebookId: links.lorebookId,
		branchId,
		moment: reading.moment,
		forkedAt: reading.forkedAt,
		slots: vocabulary.slots.filter((s) => decls.some((d) => d.id === s.id)),
		world,
		cast,
		locations
	}
}

/** Refuse an owner filter naming a cast member or place of another book. */
export function assertOwnerInBook(links: LorebookLinks, owner: LorebookOwnerFilter): void {
	if (owner.kind === "lorebook") {
		if (owner.id !== undefined && owner.id !== links.lorebookId)
			throw new LorebookOwnerRefusal(
				`lorebook ${owner.id} is not the lorebook being read (${links.lorebookId}).`
			)
		return
	}
	const found =
		owner.kind === "cast_member"
			? links.cast.some((c) => c.castMemberId === owner.id)
			: links.locations.some((l) => l.entryId === owner.id)
	if (!found)
		throw new LorebookOwnerRefusal(
			`${owner.kind === "cast_member" ? "cast member" : "place"} ${owner.id} is not in lorebook ${links.lorebookId}.`
		)
}

/**
 * An owner as a pipeline names it, normalized to one of the book's durable
 * owners — or null when it names nothing usable. `"world"` and
 * `{ kind: 'lorebook' }` are the world; the session-layer kinds are accepted
 * and translated (R5: `session` → `lorebook`, `session_location` → `location`
 * by the same entry id, `session_cast` → the cast member whose card it is).
 */
export function normalizeOwner(
	raw: unknown,
	links: LorebookLinks
): LorebookOwnerFilter | null {
	if (raw === "world") return { kind: "lorebook" }
	if (!raw || typeof raw !== "object") return null
	const { kind, id } = raw as { kind?: unknown; id?: unknown }
	const num = typeof id === "number" && Number.isInteger(id) ? id : undefined
	switch (kind) {
		case "world":
		case "lorebook":
		case "session":
			return { kind: "lorebook" }
		case "cast_member":
			return num === undefined ? null : { kind: "cast_member", id: num }
		case "location":
		case "session_location":
			return num === undefined ? null : { kind: "location", id: num }
		case "session_cast": {
			const member = links.cast.find((c) => c.characterId === num)
			// A character not bound into this book: nobody the book can name.
			return member ? { kind: "cast_member", id: member.castMemberId } : { kind: "cast_member", id: -1 }
		}
		default:
			return null
	}
}

/** Durable rows (no session) for these owners and slots. */
export async function durableRows(db: Db, owners: StateOwner[], slotIds: string[]) {
	if (!owners.length || !slotIds.length) return []
	return await db
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				inArray(schema.attributeValues.ownerKind, owners.map((o) => o.kind)),
				inArray(schema.attributeValues.ownerId, owners.map((o) => o.id)),
				inArray(schema.attributeValues.slotId, slotIds),
				isNull(schema.attributeValues.sessionId)
			)
		)
}
