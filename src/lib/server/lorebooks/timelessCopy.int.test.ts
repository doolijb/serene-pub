/**
 * `makeTimelessCopy` — a NEW book that keeps each entry, cast member, link
 * and stat as it reads now on the line being read, undated, with its
 * Timeline off. The source is never written.
 *
 * One fixture book holds a dated fork (`line`), a sibling line, a clock,
 * dated changes before and after the clock, an Off-for-a-while window open
 * and closed, history entries with scenes and an entry filed under one, cast
 * members with several dated versions, links that changed over time and
 * stats dated by history entries.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import {
	LOCATION_TYPE_ID,
	entryInsert,
	toEntryRow
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { readingOf, rowsOnReading } from "$lib/server/state/reading"
import {
	entryAt,
	entryOnReadingSql,
	entryOverlaysFor
} from "$lib/server/state/entriesOnReading"
import { castVersionsInForce } from "$lib/server/cast/memberAsRead"
import { inForce } from "$lib/server/state/resolve"
import { nearestTieVersions } from "$lib/shared/lorebooks/tieVersions"
import { compareDates } from "$lib/shared/lorebooks/storyDate"
import {
	LOREBOOK_TABLES,
	bookStatOwners
} from "$lib/server/lorebooks/tableRegistry"
import { holdsSomethingDated } from "$lib/server/lorebooks/timeline"
import { makeTimelessCopy, TIMELESS_COPY_NOTES_REFUSAL } from "./timelessCopy"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-timeless-copy-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

// ── Seed helpers ────────────────────────────────────────────────────────────

const WORLD = "core:entry/world-lore"
const CHARACTER_LORE = "core:entry/character-lore"
const PROFILE = { nodeState: "active", nodeVisibility: "normal" } as const

const positions = new Map<string, number>()
async function insertEntry(
	lorebookId: number,
	data: Record<string, any>,
	extra: Record<string, any> = {}
) {
	const key = `${lorebookId}:${data.typeId}`
	const position = (positions.get(key) ?? 0) + 1
	positions.set(key, position)
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			...entryInsert({ lorebookId, position, ...data } as any),
			...extra
		})
		.returning()
	return row
}

async function amend(
	lorebookId: number,
	entryId: number,
	year: number,
	fields: Record<string, unknown>,
	branchId: number | null = null
) {
	await testDb
		.insert(schema.entryAmendments)
		.values({ lorebookId, entryId, year, fields, branchId })
}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function addVersions(rows: Record<string, any>[]) {
	const { insertCharacterVersions } = await import(
		"$lib/server/characters/versions"
	)
	await insertCharacterVersions(
		testDb as any,
		rows.map((r) => ({ ...PROFILE, ...r })) as any
	)
}

interface Fixture {
	bookId: number
	userId: number
	line: number
	sibling: number
	e: Record<string, number>
	m: Record<string, number>
}

/** The fixture book. Years: clock 1204, `sibling` forks at 1203, `line` at 1207. */
async function seedFixture(
	userId: number,
	name = "Timeless source"
): Promise<Fixture> {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId,
			name,
			storyCalendar: {
				months: [
					{ name: "Frost", days: 30 },
					{ name: "Thaw", days: 30 }
				]
			} as any,
			storyClockYear: 1204
		})
		.returning()
	const bookId = book.id
	const [sibling] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: bookId, name: "Sibling", forkYear: 1203 })
		.returning()
	const [line] = await testDb
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: bookId,
			name: "Line",
			forkYear: 1207,
			storyClockYear: 1208
		})
		.returning()

	const e: Record<string, number> = {}
	const put = async (
		key: string,
		data: Record<string, any>,
		extra: Record<string, any> = {}
	) => {
		e[key] = (await insertEntry(bookId, data, extra)).id
	}
	// History: three on main, one on the line, one on the sibling.
	await put("h1", {
		typeId: HISTORY_TYPE_ID,
		content: "Founding.",
		year: 1200
	})
	await put("h2", {
		typeId: HISTORY_TYPE_ID,
		content: "The siege.",
		year: 1205
	})
	await put("h3", {
		typeId: HISTORY_TYPE_ID,
		content: "The peace.",
		year: 1210
	})
	await put(
		"h4",
		{ typeId: HISTORY_TYPE_ID, content: "Line event.", year: 1208 },
		{ branchId: line.id }
	)
	await put(
		"h5",
		{ typeId: HISTORY_TYPE_ID, content: "Sibling event.", year: 1204 },
		{ branchId: sibling.id }
	)

	await put("keep", { typeId: WORLD, name: "Keep", content: "Keep v1" })
	await put("gate", { typeId: WORLD, name: "Gate", content: "A gate." })
	await put("lamp", { typeId: WORLD, name: "Lamp", content: "A lamp." })
	await put(
		"hut",
		{ typeId: WORLD, name: "Sibling hut", content: "Only on the sibling." },
		{ branchId: sibling.id }
	)
	await put(
		"camp",
		{ typeId: WORLD, name: "Line camp", content: "Only on the line." },
		{ branchId: line.id }
	)
	await put("city", { typeId: WORLD, name: "City", content: "A city." })
	await put("district", {
		typeId: WORLD,
		name: "District",
		content: "A district.",
		anchorEntryId: e.city
	})
	await put("footnote", {
		typeId: WORLD,
		name: "Footnote",
		content: "Filed under the siege.",
		anchorEntryId: e.h2
	})
	await put("orphan", {
		typeId: WORLD,
		name: "Orphan",
		content: "Under the hut.",
		anchorEntryId: e.hut
	})
	await put("hall", {
		typeId: LOCATION_TYPE_ID,
		name: "Hall",
		content: "A hall."
	})
	await put("cellar", {
		typeId: LOCATION_TYPE_ID,
		name: "Cellar",
		content: "A cellar."
	})
	await put(
		"sibCellar",
		{
			typeId: LOCATION_TYPE_ID,
			name: "Sibling cellar",
			content: "On the sibling."
		},
		{ branchId: sibling.id }
	)

	// Dated changes: before the clock (1202), after it (1206), after the main fork (1209), on the line.
	await amend(bookId, e.keep, 1202, { content: "Keep v2" })
	await amend(bookId, e.keep, 1206, { content: "Keep v3" })
	await amend(bookId, e.keep, 1209, { name: "Keep Renamed" })
	await amend(bookId, e.keep, 1208, { content: "Keep line" }, line.id)
	// Off for a while, closed on main.
	await amend(bookId, e.gate, 1205, { enabled: false })
	await amend(bookId, e.gate, 1206, { enabled: true })
	// Off for a while, open on main and closed on the line.
	await amend(bookId, e.lamp, 1205, { enabled: false })
	await amend(bookId, e.lamp, 1209, { enabled: true }, line.id)

	// Cast.
	const member = async (key: string, binding: number, name: string) => {
		const [row] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: bookId,
				binding: `{{char:${binding}}}`,
				name
			})
			.returning()
		return row.id
	}
	const m: Record<string, number> = {}
	m.keeper = await member("keeper", 1, "Keeper")
	m.wanderer = await member("wanderer", 2, "Wanderer")
	m.ghostA = await member("ghostA", 3, "Ghost A")
	m.relic = await member("relic", 4, "Relic")
	m.ghostC = await member("ghostC", 5, "Ghost C")
	await addVersions([
		{
			castMemberId: m.keeper,
			lorebookId: bookId,
			name: "Keeper",
			summary: "Keeper base"
		},
		{
			castMemberId: m.keeper,
			lorebookId: bookId,
			name: "Keeper",
			summary: "Keeper mid",
			year: 1203
		},
		{
			castMemberId: m.keeper,
			lorebookId: bookId,
			name: "Keeper",
			summary: "Keeper late",
			year: 1206
		},
		{
			castMemberId: m.keeper,
			lorebookId: bookId,
			name: "Keeper",
			summary: "Keeper line",
			year: 1208,
			branchId: line.id
		},
		{
			castMemberId: m.wanderer,
			lorebookId: bookId,
			name: "Wanderer",
			summary: "Wanderer base"
		},
		{
			castMemberId: m.wanderer,
			lorebookId: bookId,
			name: "Wanderer",
			summary: "Wanderer 1205",
			year: 1205
		},
		{
			castMemberId: m.wanderer,
			lorebookId: bookId,
			name: "Wanderer",
			summary: "Wanderer sibling",
			year: 1204,
			branchId: sibling.id
		},
		{
			castMemberId: m.ghostA,
			lorebookId: bookId,
			name: "Ghost A",
			summary: "Only on the sibling",
			year: 1204,
			branchId: sibling.id
		},
		// A retired base: no version in force, but a base exists.
		{
			castMemberId: m.relic,
			lorebookId: bookId,
			name: "Relic",
			summary: "Retired base",
			retiredOrder: 1
		}
	])
	await testDb.insert(schema.castPresences).values([
		{
			lorebookId: bookId,
			lorebookBindingId: m.keeper,
			personalPosition: 1,
			fromYear: 1200,
			untilYear: 1205
		},
		{
			lorebookId: bookId,
			lorebookBindingId: m.wanderer,
			personalPosition: 1,
			fromYear: 1201
		}
	])

	// Entries that name members.
	await put("secret", {
		typeId: CHARACTER_LORE,
		name: "Secret",
		content: "Keeper's secret.",
		lorebookBindingId: m.keeper
	})
	await put("relicLore", {
		typeId: CHARACTER_LORE,
		name: "Relic lore",
		content: "About the relic.",
		lorebookBindingId: m.relic
	})
	await put("ghostLore", {
		typeId: CHARACTER_LORE,
		name: "Ghost lore",
		content: "About ghost C.",
		lorebookBindingId: m.ghostC
	})

	// Scenes.
	const scene = async (
		key: string,
		name: string,
		h: number,
		extra: Record<string, any> = {}
	) => {
		const [row] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: bookId,
				historyEntryId: h,
				name,
				summary: name,
				selectedMessageIds: [],
				...extra
			})
			.returning()
		return row.id
	}
	const s1 = await scene("s1", "Scene one", e.h1)
	await scene("s2", "Scene two", e.h2, { openedStoryClockYear: 1205 })
	await scene("s3", "Sibling scene", e.h5, { branchId: sibling.id })
	await scene("s4", "Line scene", e.h4, { branchId: line.id })
	await testDb.insert(schema.sceneCharacters).values([
		{ sceneId: s1, bindingId: m.keeper, role: "participant", ordinal: 0 },
		{ sceneId: s1, bindingId: m.wanderer, role: "participant", ordinal: 1 }
	])

	// Links: a cast tie in three dated versions, an entry pair in two, an undated place link, a link to the relic.
	await testDb.insert(schema.narrativeRelationships).values([
		{
			lorebookId: bookId,
			fromNodeId: m.keeper,
			toNodeId: m.wanderer,
			relationshipType: "ally",
			description: "ally early",
			historyEntryId: e.h1
		},
		{
			lorebookId: bookId,
			fromNodeId: m.keeper,
			toNodeId: m.wanderer,
			relationshipType: "ally",
			description: "ally late",
			historyEntryId: e.h3
		},
		{
			lorebookId: bookId,
			fromNodeId: m.keeper,
			toNodeId: m.wanderer,
			relationshipType: "ally",
			description: "ally line",
			historyEntryId: e.h4,
			branchId: line.id
		},
		{
			lorebookId: bookId,
			fromEntryId: e.hall,
			toEntryId: e.cellar,
			relationshipType: "leads to",
			title: "door",
			description: "door early",
			historyEntryId: e.h1
		},
		{
			lorebookId: bookId,
			fromEntryId: e.hall,
			toEntryId: e.cellar,
			relationshipType: "leads to",
			title: "door",
			description: "door late",
			historyEntryId: e.h2
		},
		{
			lorebookId: bookId,
			fromNodeId: m.keeper,
			toEntryId: e.hall,
			relationshipType: "keeper of",
			description: "keeps hall",
			status: "ended"
		},
		{
			lorebookId: bookId,
			fromNodeId: m.keeper,
			toNodeId: m.relic,
			relationshipType: "holds",
			description: "holds relic"
		}
	])

	// Stats: dated values and configs, a book value, a place value, a sibling place value.
	await testDb.insert(schema.attributeValues).values([
		{
			ownerKind: "cast_member",
			ownerId: m.wanderer,
			slotId: "core:slot/hp@1",
			value: { v: 10 },
			historyEntryId: e.h1
		},
		{
			ownerKind: "cast_member",
			ownerId: m.wanderer,
			slotId: "core:slot/hp@1",
			value: { v: 7 },
			historyEntryId: e.h2
		},
		{
			ownerKind: "cast_member",
			ownerId: m.wanderer,
			slotId: "core:slot/hp@1",
			value: { v: 5 },
			historyEntryId: e.h4,
			branchId: line.id
		},
		{
			ownerKind: "lorebook",
			ownerId: bookId,
			slotId: "core:slot/weather@1",
			value: { v: "rain" }
		},
		{
			ownerKind: "location",
			ownerId: e.hall,
			slotId: "core:slot/stock@1",
			value: { v: 3 },
			storyClockYear: 1205
		},
		{
			ownerKind: "location",
			ownerId: e.sibCellar,
			slotId: "core:slot/stock@1",
			value: { v: 9 }
		}
	])
	await testDb.insert(schema.attributeConfigs).values([
		{
			ownerKind: "cast_member",
			ownerId: m.wanderer,
			slotId: "core:slot/hp@1",
			config: { max: 20 }
		},
		{
			ownerKind: "cast_member",
			ownerId: m.wanderer,
			slotId: "core:slot/hp@1",
			config: { max: 30 },
			historyEntryId: e.h2
		}
	])

	// References with no foreign key.
	await testDb.insert(schema.entryAnnotations).values([
		{
			entryId: e.keep,
			entityKey: `entry:${e.hut}`,
			surface: "hut",
			normalized: "hut",
			tier: "gazetteer",
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		},
		{
			entryId: e.keep,
			entityKey: `entry:${e.city}`,
			surface: "city",
			normalized: "city",
			tier: "gazetteer",
			extractorVersion: "t",
			sourceHash: "h",
			gazetteerHash: "g"
		}
	] as any)
	await testDb.insert(schema.bindingSuggestions).values([
		{
			lorebookId: bookId,
			entityKey: `cast_member:${m.ghostA}`,
			surface: "Ghost A"
		},
		{
			lorebookId: bookId,
			entityKey: "open:the tower",
			surface: "tower",
			exampleSourceKind: "entry",
			exampleSourceId: e.h2,
			exampleContext: "the siege"
		},
		{
			lorebookId: bookId,
			entityKey: "open:the road",
			surface: "road",
			exampleSourceKind: "entry",
			exampleSourceId: e.city,
			exampleContext: "a city"
		}
	])

	return { bookId, userId, line: line.id, sibling: sibling.id, e, m }
}

async function copyOf(
	fx: Fixture,
	branchId: number | null,
	name = "Timeless copy"
) {
	return testDb.transaction((tx) =>
		makeTimelessCopy(tx as any, {
			sourceId: fx.bookId,
			branchId,
			userId: fx.userId,
			name
		})
	)
}

// ── What a book reads, as labelled values ──────────────────────────────────

/** The in-force row per owner and slot, for the durable template layer. */
async function readStats(
	bookId: number,
	reading: any,
	labelOf: (kind: string, id: number) => string | null
) {
	const out: Record<string, unknown> = {}
	for (const [table, key] of [
		[schema.attributeValues, "value"],
		[schema.attributeConfigs, "config"]
	] as const) {
		const t = table as any
		const rows: any[] = await testDb
			.select()
			.from(t)
			.where(
				and(
					sql`${t.sessionId} is null`,
					sql`(
						(${t.ownerKind} = 'lorebook' and ${t.ownerId} = ${bookId})
						or (${t.ownerKind} = 'cast_member' and ${t.ownerId} in (select id from lorebook_bindings where lorebook_id = ${bookId}))
						or (${t.ownerKind} = 'location' and ${t.ownerId} in (select id from lorebook_entries where lorebook_id = ${bookId} and type_id = ${LOCATION_TYPE_ID}))
					)`
				)
			)
		const onLine = await rowsOnReading(testDb as any, rows, reading)
		const groups = new Map<string, any[]>()
		for (const r of onLine) {
			const label = labelOf(r.ownerKind, r.ownerId)
			if (label == null) continue
			const k = `${key}|${label}|${r.slotId}`
			groups.set(k, [...(groups.get(k) ?? []), r])
		}
		for (const [k, group] of groups)
			out[k] = inForce(group, reading.dates)![key]
	}
	return out
}

/** Everything a book reads on a line, by labels, so a source and its copy compare without ids. */
async function describeBook(
	bookId: number,
	branchId: number | null,
	/** Members with no version and no base: an entry anchored to one is at the top level in a copy. */
	gone: ReadonlySet<string> = new Set()
) {
	const reading = await readingOf(testDb as any, bookId, { branch: branchId })
	const e = schema.lorebookEntries
	const read = await testDb
		.select()
		.from(e)
		.where(
			and(
				eq(e.lorebookId, bookId),
				entryOnReadingSql(reading),
				ne(e.typeId, HISTORY_TYPE_ID)
			)
		)
	const overlays = await entryOverlaysFor(testDb as any, bookId, reading)
	const wires = new Map(
		read.map((r) => [
			r.id,
			entryAt(toEntryRow(r) as any, overlays, reading) as any
		])
	)
	const readNames = new Map(
		[...wires].map(([id, w]) => [id, w.name as string])
	)
	const members = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, bookId))
	const memberName = new Map(members.map((m) => [m.id, m.name]))

	const entries: Record<string, unknown> = {}
	for (const [id, w] of wires)
		entries[w.name] = {
			type: w.typeId,
			content: w.content,
			enabled: w.enabled,
			archived: w.archived,
			keys: w.keys,
			// What hangs from an entry that does not read is at the top level in a copy.
			anchor:
				w.anchorEntryId != null
					? (readNames.get(w.anchorEntryId) ?? null)
					: null,
			member:
				w.lorebookBindingId != null &&
				!gone.has(memberName.get(w.lorebookBindingId)!)
					? (memberName.get(w.lorebookBindingId) ?? null)
					: null
		}

	const versions = await castVersionsInForce(
		testDb as any,
		members.map((m) => m.id),
		{ reading }
	)
	const cast: Record<string, unknown> = {}
	for (const [id, { version }] of versions)
		cast[memberName.get(id)!] = {
			name: version.name,
			summary: version.summary,
			description: version.description,
			nodeState: version.nodeState,
			nodeVisibility: version.nodeVisibility
		}

	const nr = schema.narrativeRelationships
	const linkRows = await testDb
		.select()
		.from(nr)
		.where(eq(nr.lorebookId, bookId))
	const onLine = nearestTieVersions(
		await rowsOnReading(testDb as any, linkRows, reading),
		reading.line
	)
	const endpoint = (node: number | null, entry: number | null) =>
		node != null
			? `m:${memberName.get(node)}`
			: readNames.has(entry!)
				? `e:${readNames.get(entry!)}`
				: null
	const tieOf = new Map<string, any>()
	for (const r of onLine) {
		const from = endpoint(r.fromNodeId, r.fromEntryId)
		const to = endpoint(r.toNodeId, r.toEntryId)
		if (from == null || to == null) continue
		const key = `${from}|${to}|${r.relationshipType}|${r.title}`
		const date =
			r.historyEntryId != null
				? (reading.dates?.get(r.historyEntryId) ?? null)
				: null
		const held = tieOf.get(key)
		const heldDate = held?.date ?? null
		const order = !held
			? 1
			: date && heldDate
				? compareDates(date, heldDate)
				: date
					? 1
					: heldDate
						? -1
						: 0
		if (!held || order > 0 || (order === 0 && r.id > held.id))
			tieOf.set(key, { id: r.id, date, row: r })
	}
	const links: Record<string, unknown> = {}
	for (const [key, { row }] of tieOf)
		links[key] = { description: row.description, status: row.status }

	const placeName = new Map(read.map((r) => [r.id, r.title]))
	const stats = await readStats(bookId, reading, (kind, id) =>
		kind === "lorebook"
			? "book"
			: kind === "cast_member"
				? (memberName.get(id) ?? null)
				: (placeName.get(id) ?? null)
	)

	const sc = schema.scenes
	const sceneRows = await testDb
		.select({
			id: sc.id,
			name: sc.name,
			branchId: sc.branchId,
			historyEntryId: sc.historyEntryId
		})
		.from(sc)
		.where(eq(sc.lorebookId, bookId))
	const scenes = (await rowsOnReading(testDb as any, sceneRows, reading))
		.map((s) => s.name)
		.sort()

	return { entries, cast, links, stats, scenes }
}

/** Every registered table's rows for a book, plus the book row, for a before/after comparison. */
async function snapshotBook(bookId: number) {
	const out: Record<string, unknown> = {}
	out.book = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, bookId))
	const owners = await bookStatOwners(testDb as any, bookId)
	for (const spec of LOREBOOK_TABLES) {
		const t = spec.table as any
		const label =
			(t as any)[Symbol.for("drizzle:Name")] ?? String(spec.table)
		let rows: unknown[] = []
		if (spec.scope === "book")
			rows = await testDb.select().from(t).where(eq(t.lorebookId, bookId))
		else if (spec.scope === "entry")
			rows = await testDb
				.select()
				.from(t)
				.where(
					sql`${t.entryId} in (select id from lorebook_entries where lorebook_id = ${bookId})`
				)
		else if (spec.scope === "scene")
			rows = await testDb
				.select()
				.from(t)
				.where(
					sql`${t.sceneId} in (select id from scenes where lorebook_id = ${bookId})`
				)
		else if (typeof spec.scope === "object")
			for (const [kinds, ids] of owners)
				if (ids.length)
					rows.push(
						...(await testDb
							.select()
							.from(t)
							.where(
								and(
									inArray(t.ownerKind, kinds),
									inArray(t.ownerId, ids)
								)
							))
					)
		out[`${label}`] = rows.map((r) => JSON.stringify(r)).sort()
		out[`${label}:count`] = await spec.count(testDb as any, bookId)
	}
	return out
}

// ── Tests ───────────────────────────────────────────────────────────────────

let fx: Fixture
const GONE = new Set<string>()

beforeAll(async () => {
	const owner = await makeUser("timeless-owner")
	fx = await seedFixture(owner.id)
}, 60_000)

describe("the copy reads as the source read", () => {
	test("from main, every entry, member, link, stat and scene reads the same", async () => {
		const copy = await copyOf(fx, null)
		expect(await describeBook(copy.id, null)).toEqual(
			await describeBook(fx.bookId, null, GONE)
		)
	}, 60_000)

	test("from the line, the same holds for the line's reading", async () => {
		const copy = await copyOf(fx, fx.line, "Timeless from line")
		expect(await describeBook(copy.id, null)).toEqual(
			await describeBook(fx.bookId, fx.line, GONE)
		)
	}, 60_000)

	test("by hand: from main, the change after the clock is applied and the windows read as the head says", async () => {
		const copy = await copyOf(fx, null, "Timeless by hand")
		const d = await describeBook(copy.id, null)
		const entries = d.entries as Record<string, any>
		expect(entries["Keep Renamed"].content).toBe("Keep v3")
		expect(entries["Keep"]).toBeUndefined()
		expect(entries["Gate"].enabled).toBe(true)
		expect(entries["Lamp"].enabled).toBe(false)
		expect(entries["Sibling hut"]).toBeUndefined()
		expect(entries["Line camp"]).toBeUndefined()
		expect(entries["Sibling cellar"]).toBeUndefined()
		expect(entries["District"].anchor).toBe("City")
		expect(entries["Footnote"].anchor).toBeNull()
		expect(entries["Orphan"].anchor).toBeNull()
		expect(Object.keys(d.cast).sort()).toEqual(["Keeper", "Wanderer"])
		expect((d.cast as any).Keeper.summary).toBe("Keeper late")
		expect(d.links).toMatchObject({
			"m:Keeper|m:Wanderer|ally|": { description: "ally late" },
			"e:Hall|e:Cellar|leads to|door": { description: "door late" },
			"m:Keeper|e:Hall|keeper of|": { status: "ended" }
		})
		expect(d.stats).toMatchObject({
			"value|Wanderer|core:slot/hp@1": { v: 7 },
			"config|Wanderer|core:slot/hp@1": { max: 30 },
			"value|book|core:slot/weather@1": { v: "rain" },
			"value|Hall|core:slot/stock@1": { v: 3 }
		})
		expect(
			Object.keys(d.stats).some((k) => k.includes("Sibling cellar"))
		).toBe(false)
		expect(d.scenes).toEqual(["Scene one", "Scene two"])
	}, 60_000)

	test("by hand: from the line, the line's own changes read and the windows differ", async () => {
		const copy = await copyOf(fx, fx.line, "Timeless line by hand")
		const d = await describeBook(copy.id, null)
		const entries = d.entries as Record<string, any>
		expect(entries["Keep"].content).toBe("Keep line")
		expect(entries["Keep Renamed"]).toBeUndefined()
		expect(entries["Lamp"].enabled).toBe(true)
		expect(entries["Line camp"]).toBeDefined()
		expect((d.cast as any).Keeper.summary).toBe("Keeper line")
		expect((d.links as any)["m:Keeper|m:Wanderer|ally|"].description).toBe(
			"ally line"
		)
		expect((d.stats as any)["value|Wanderer|core:slot/hp@1"]).toEqual({
			v: 5
		})
		expect(d.scenes).toEqual(["Line scene", "Scene one", "Scene two"])
	}, 60_000)

	test("from main and from the line give two different copies", async () => {
		const main = await describeBook(fx.bookId, null)
		const line = await describeBook(fx.bookId, fx.line)
		expect(main).not.toEqual(line)
	})
})

describe("the copy is timeless", () => {
	test("it holds no dated change, history entry, line, presence, clock or calendar, and its switch is off", async () => {
		const copy = await copyOf(fx, null, "Timeless flat")
		const id = copy.id
		const count = async (table: any, col: any) =>
			(
				await testDb
					.select({ n: sql<number>`count(*)::int` })
					.from(table)
					.where(eq(col, id))
			)[0].n
		expect(
			await count(
				schema.entryAmendments,
				schema.entryAmendments.lorebookId
			)
		).toBe(0)
		expect(
			await count(schema.castAmendments, schema.castAmendments.lorebookId)
		).toBe(0)
		expect(
			await count(schema.castPresences, schema.castPresences.lorebookId)
		).toBe(0)
		expect(
			await count(
				schema.lorebookBranches,
				schema.lorebookBranches.lorebookId
			)
		).toBe(0)
		const [history] = await testDb
			.select({ n: sql<number>`count(*)::int` })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, id),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
		expect(history.n).toBe(0)
		const [row] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, id))
		expect(row.timelineEnabled).toBe(false)
		expect(row.storyClockYear).toBeNull()
		expect(row.storyCalendar).toBeNull()
		expect(await holdsSomethingDated(testDb as any, id)).toBe(false)

		const versions = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.lorebookId, id))
		expect(
			versions.every(
				(v) =>
					v.year == null &&
					v.branchId == null &&
					v.historyEntryId == null &&
					v.atHour == null &&
					v.personalPosition == null &&
					v.sourceSessionId == null &&
					// A version in force goes in unretired; the kept base of a named member keeps its retire mark.
					(v.retiredOrder == null ||
						v.castMemberId === copy.maps.bindings.get(fx.m.relic))
			)
		).toBe(true)
		const perMember = new Map<number, number>()
		for (const v of versions)
			perMember.set(
				v.castMemberId!,
				(perMember.get(v.castMemberId!) ?? 0) + 1
			)
		expect([...perMember.values()].every((n) => n === 1)).toBe(true)

		const links = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, id))
		expect(
			links.every((l) => l.historyEntryId == null && l.branchId == null)
		).toBe(true)

		const scenes = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, id))
		expect(scenes.map((s) => s.name).sort()).toEqual([
			"Scene one",
			"Scene two"
		])
		expect(
			scenes.every(
				(s) =>
					s.historyEntryId == null &&
					s.branchId == null &&
					s.openedStoryClockYear == null &&
					s.closedStoryClockYear == null
			)
		).toBe(true)

		const stats = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				sql`${schema.attributeValues.ownerKind} = 'location' and ${schema.attributeValues.ownerId} in (select id from lorebook_entries where lorebook_id = ${id})`
			)
		expect(stats).toHaveLength(1)
		expect(stats[0].storyClockYear).toBeNull()
	}, 60_000)

	test("members: one with no version and nothing naming it goes; a named one with a base stays; a named one with none goes", async () => {
		const copy = await copyOf(fx, null, "Timeless members")
		const names = (
			await testDb
				.select({ name: schema.lorebookBindings.name })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, copy.id))
		)
			.map((m) => m.name)
			.sort()
		// Ghost A: out. Relic: named by a link and an entry, keeps its base. Ghost C: named by an entry, no base: kept with no version, so its lore stays its own.
		expect(names).toEqual(["Ghost C", "Keeper", "Relic", "Wanderer"])
		const ghostLore = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, copy.id),
					eq(schema.lorebookEntries.title, "Ghost lore")
				)
			)
		expect(ghostLore).toHaveLength(1)
		expect(ghostLore[0].anchorBindingId).toBe(
			copy.maps.bindings.get(fx.m.ghostC)
		)
		const relicLore = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, copy.id),
					eq(schema.lorebookEntries.title, "Relic lore")
				)
			)
		expect(relicLore[0].anchorBindingId).toBe(
			copy.maps.bindings.get(fx.m.relic)
		)
		const [relicVersion] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(
				eq(
					schema.characterVersions.castMemberId,
					copy.maps.bindings.get(fx.m.relic)!
				)
			)
		expect(relicVersion.summary).toBe("Retired base")
	}, 60_000)

	test("rows that name what went are cleared", async () => {
		const copy = await copyOf(fx, null, "Timeless no-FK")
		const keys = (
			await testDb
				.select({ key: schema.entryAnnotations.entityKey })
				.from(schema.entryAnnotations)
				.where(
					sql`${schema.entryAnnotations.entryId} in (select id from lorebook_entries where lorebook_id = ${copy.id})`
				)
		).map((a) => a.key)
		expect(keys).toEqual([`entry:${copy.maps.entries.get(fx.e.city)}`])
		const suggestions = await testDb
			.select()
			.from(schema.bindingSuggestions)
			.where(eq(schema.bindingSuggestions.lorebookId, copy.id))
		expect(suggestions.map((s) => s.entityKey).sort()).toEqual([
			"open:the road",
			"open:the tower"
		])
		const tower = suggestions.find((s) => s.entityKey === "open:the tower")!
		expect(tower.exampleSourceId).toBeNull()
		const road = suggestions.find((s) => s.entityKey === "open:the road")!
		expect(road.exampleSourceId).toBe(copy.maps.entries.get(fx.e.city))
	}, 60_000)

	test("the same entry titles, one per kept entry, and an entry-pair link in one version", async () => {
		const copy = await copyOf(fx, null, "Timeless links")
		const links = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, copy.id))
		expect(links).toHaveLength(4)
	}, 60_000)

	test("a kept entry loses its Beginning and keeps its decay rate", async () => {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: fx.userId, name: "Timeless beginning source" })
			.returning()
		const living = await insertEntry(book!.id, {
			typeId: WORLD,
			name: "Living",
			content: "Began.",
			year: 5,
			month: 2,
			decayRate: 0.3
		})
		expect((living!.fields as any).year).toBe(5)
		const copy = await copyOf(
			{ ...fx, bookId: book!.id },
			null,
			"Timeless beginning copy"
		)
		const [row] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, copy.maps.entries.get(living!.id)!))
		const fields = row!.fields as Record<string, unknown>
		for (const part of ["year", "month", "day"])
			expect(part in fields).toBe(false)
		expect(row!.decayRate).toBe(0.3)
	}, 60_000)

	test("a session's notes are refused with the sentence", async () => {
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: fx.userId,
				isGroup: false,
				name: "Notes holder"
			} as any)
			.returning()
		const [notes] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: fx.userId,
				name: "Notes",
				sessionId: session.id
			} as any)
			.returning()
		await expect(
			testDb.transaction((tx) =>
				makeTimelessCopy(tx as any, {
					sourceId: notes.id,
					branchId: null,
					userId: fx.userId,
					name: "x"
				})
			)
		).rejects.toThrow(TIMELESS_COPY_NOTES_REFUSAL)
	}, 60_000)
})

describe("the source is never changed", () => {
	test("every registered table's rows and the book row are equal after, from main and from the line", async () => {
		const before = await snapshotBook(fx.bookId)
		await copyOf(fx, null, "Timeless unchanged main")
		await copyOf(fx, fx.line, "Timeless unchanged line")
		const after = await snapshotBook(fx.bookId)
		expect(after).toEqual(before)
		expect(Object.keys(before).length).toBeGreaterThan(40)
	}, 60_000)
})

// ── A small seeded property test ───────────────────────────────────────────

/** Mulberry32, so a failing seed is reproducible. */
function prng(seed: number) {
	let a = seed
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

describe("property: the copy's stored rows read as the source's folded rows", () => {
	for (const seed of [1, 2, 3, 4, 5]) {
		test(`seed ${seed}`, async () => {
			const rand = prng(seed)
			const int = (n: number) => Math.floor(rand() * n)
			const owner = await makeUser(`timeless-prop-${seed}`)
			const [book] = await testDb
				.insert(schema.lorebooks)
				.values({ userId: owner.id, name: `Prop ${seed}` })
				.returning()
			const [sibling] = await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: book.id,
					name: "Sibling",
					forkYear: 1100 + int(20)
				})
				.returning()
			const forkYear = 1110 + int(20)
			const [line] = await testDb
				.insert(schema.lorebookBranches)
				.values({ lorebookId: book.id, name: "Line", forkYear })
				.returning()
			const ids: { id: number; branch: number | null }[] = []
			for (let i = 0; i < 12; i++) {
				const where = int(4)
				const branchId =
					where === 0 ? line.id : where === 1 ? sibling.id : null
				const row = await insertEntry(
					book.id,
					{ typeId: WORLD, name: `E${i}`, content: `base ${i}` },
					branchId ? { branchId } : {}
				)
				ids.push({ id: row.id, branch: branchId })
			}
			for (let i = 0; i < 30; i++) {
				const target = ids[int(ids.length)]
				const onLine = rand() < 0.4
				const branchId = onLine
					? line.id
					: target.branch === sibling.id
						? sibling.id
						: null
				const year = onLine ? forkYear + 1 + int(10) : 1100 + int(40)
				const kind = int(3)
				const fields =
					kind === 0
						? { content: `c${i}` }
						: kind === 1
							? { enabled: rand() < 0.5 }
							: { name: `N${i}` }
				await amend(book.id, target.id, year, fields, branchId)
			}
			const fixture: Fixture = {
				bookId: book.id,
				userId: owner.id,
				line: line.id,
				sibling: sibling.id,
				e: {},
				m: {}
			}
			for (const pick of [null, line.id]) {
				const copy = await copyOf(
					fixture,
					pick,
					`Prop copy ${seed}-${pick}`
				)
				const expected = await describeBook(book.id, pick)
				const got = await describeBook(copy.id, null)
				expect(got.entries).toEqual(expected.entries)
			}
		}, 60_000)
	}
})
