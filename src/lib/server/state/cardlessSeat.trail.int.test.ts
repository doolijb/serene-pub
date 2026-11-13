/**
 * 🚧 ⏳ S4 (lane s4-fixes, w2): a card-less character seat appears wherever a carded
 * character seat does in the stat trail, durable filing, item supply, the rules
 * conversion, presences at an hour and the book's own state reader.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	defineRuleset,
	getAttributeSlot
} from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const STAT = "test:slot/cardless-trail-grit@1"
const BAG = "test:slot/cardless-trail-pack@1"
const ADDED = "test:slot/cardless-trail-added@1"
const RULESET = "test:ruleset/cardless-trail-routines@1"
const ROUTINE = { weekday: [[7, "work"]], weekend: [[9, "market"]] }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cardlessTrail-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	defineAttributeSlot(STAT, {
		type: "integer",
		label: { en: "Grit" },
		descriptor: "How much they can take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 10
	})
	defineAttributeSlot(BAG, {
		shape: "core:stat-shape/list@1",
		label: { en: "Pack" },
		descriptor: "What they carry.",
		appliesTo: ["cast"]
	})
	defineAttributeSlot(ADDED, {
		type: "integer",
		label: { en: "Added" },
		descriptor: "A slot a rules version adds.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 }
	})
	defineRuleset(RULESET, {
		name: { en: "Routines" },
		attributes: [],
		entryTypes: [
			{
				id: "routine",
				name: { en: "Routine" },
				holders: ["cast"],
				fields: { routine: { type: "schedule" } },
				prose: "Routine: where someone is by the hour."
			}
		]
	} as never)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	memberFormSwitch.on = false
})

let n = 0
const db = () => testDb as unknown as Db

/** An attached book with a carded member (Verity) and a card-less member (Ash), both seated as character seats. */
async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cardless-trail-${suffix}`)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `Book ${suffix}`,
			storyCalendar: {
				months: [{ name: "Thaw", days: 30 }],
				weekdays: ["a", "b", "c", "d", "e", "f", "g"],
				firstWeekday: 0
			}
		} as never)
		.returning()
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "…" } as any)
		.returning()
	const mVerity = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:v${suffix}}}`,
			characterId: verity!.id,
			name: "Verity"
		})
	).member!
	const ash = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:a${suffix}}}`,
			characterId: null,
			name: "Ash",
			ownName: "Ash"
		} as any)
	).member!
	const genreId = `test:genre/cardless-trail-${suffix}`
	genreKeeping(genreId, {
		name: { en: "Trail" },
		family: "test",
		slots: [getAttributeSlot(STAT)!, getAttributeSlot(BAG)!],
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			genreId,
			primaryRuleset: RULESET,
			lorebookId: book!.id,
			storyClockYear: 1,
			storyClockMonth: 1,
			storyClockDay: 3,
			storyClockHour: 10,
			storyClockMinute: 0
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values([
		{
			sessionId,
			characterId: verity!.id,
			castMemberId: mVerity.id,
			position: 0,
			seatedByUserId: user.id
		},
		{
			sessionId,
			characterId: null,
			castMemberId: ash.id,
			position: 1,
			seatedByUserId: user.id
		}
	] as any)
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			position: 0,
			title: "The bell drowned",
			content: "…",
			fields: { year: 412, month: 3 }
		})
		.returning()
	const [key] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: "core:entry/item",
			typeVersion: 1,
			position: 1,
			title: "Rusty key",
			content: "…",
			fields: { supply: "limited", supplyLimit: 3 }
		})
		.returning()
	const [message] = await testDb
		.insert(schema.messages)
		.values({ sessionId, role: "assistant", content: "…" } as never)
		.returning()
	return {
		user,
		book: book!,
		verity: verity!,
		mVerity,
		ash,
		sessionId,
		entry: entry!,
		key: key!,
		message: message!
	}
}
type World = Awaited<ReturnType<typeof world>>

const ashOwner = (w: World) => ({
	kind: "seated_member" as const,
	id: w.ash.id
})
const ctxOf = (w: World) => ({
	sessionId: w.sessionId,
	updatedBy: "user",
	userId: w.user.id,
	messageId: w.message.id
})

describe("a card-less character seat in the stat trail", () => {
	test("sessionOwnerOf maps the book's card-less member to its seated_member owner; the trail and the socket read it", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { setValue } = await import("./write")
		await setValue(db(), ctxOf(w), {
			owner: ashOwner(w),
			slotId: STAT,
			value: 14
		})

		const { sessionStatTrail, statTrailFor } = await import("./statTrail")
		const mine = await sessionStatTrail(db(), {
			sessionId: w.sessionId,
			owner: ashOwner(w),
			slotId: STAT
		})
		expect(mine.tracked).toBe(true)
		expect(mine.changes.map((c) => c.to)).toEqual([14])

		// The book-side trail: the member's session-layer points are the seat's.
		const book = await statTrailFor(db(), {
			lorebookId: w.book.id,
			sessionId: w.sessionId,
			owner: { kind: "cast_member", id: w.ash.id },
			slotId: STAT,
			mode: "messages"
		})
		expect(book.points.map((p) => p.value)).toEqual([14])

		const { readStatTrail } = await import("$lib/server/sockets/statTrail")
		const read = await readStatTrail(
			{ sessionId: w.sessionId, owner: ashOwner(w), slotId: STAT },
			w.user.id
		)
		expect(read.changes.map((c) => c.to)).toEqual([14])
	})

	test("off, the book's card-less member maps to no session owner", async () => {
		const w = await world()
		const { statTrailFor } = await import("./statTrail")
		const book = await statTrailFor(db(), {
			lorebookId: w.book.id,
			sessionId: w.sessionId,
			owner: { kind: "cast_member", id: w.ash.id },
			slotId: STAT,
			mode: "messages"
		})
		expect(book.points).toEqual([])
	})
})

describe("a card-less character seat files its member's durable record", () => {
	test("the seat's value lands on cast_member:<member> once, as a carded seat's does", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { setValue } = await import("./write")
		await setValue(db(), ctxOf(w), {
			owner: ashOwner(w),
			slotId: STAT,
			value: 14
		})
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "seated_member",
			ownerId: w.mVerity.id,
			slotId: STAT,
			value: { v: 12 },
			sessionId: w.sessionId,
			validFromMessageId: w.message.id,
			updatedBy: "user"
		} as any)
		const { recordToTimeline } = await import("./durable")
		const rows = async (id: number) =>
			(
				await testDb
					.select()
					.from(schema.attributeValues)
					.where(
						and(
							eq(schema.attributeValues.ownerKind, "cast_member"),
							eq(schema.attributeValues.ownerId, id)
						)
					)
			).filter((r) => r.slotId === STAT)
		const first = await recordToTimeline(db(), w.sessionId, {
			reason: "mark",
			historyEntryId: w.entry.id
		})
		expect(first.owners).toContain(`cast_member:${w.ash.id}`)
		expect((await rows(w.ash.id)).map((r) => r.value)).toEqual([{ v: 14 }])
		expect((await rows(w.mVerity.id)).map((r) => r.value)).toEqual([
			{ v: 12 }
		])
		// The recorder appends a row per recording for every owner (no dedupe, carded or not): a second one adds one each, never two.
		await recordToTimeline(db(), w.sessionId, {
			reason: "mark",
			historyEntryId: w.entry.id
		})
		expect((await rows(w.ash.id)).length).toBe(2)
		expect((await rows(w.mVerity.id)).length).toBe(2)
	})

	test("a session of its own notes files a notes member's value onto cast_member:<member> in the own book", async () => {
		const suffix = ++n
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `cardless-notes-${suffix}`)
		const genreId = `test:genre/cardless-notes-${suffix}`
		genreKeeping(genreId, {
			name: { en: "Notes" },
			family: "test",
			slots: [getAttributeSlot(STAT)!],
			events: {}
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: true,
				name: `Notes ${suffix}`,
				genreId,
				primaryRuleset: RULESET
			} as any)
			.returning()
		const sessionId = session!.id
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const notes = await ownBookFor(db(), sessionId)
		const ash = (
			await insertCastMember(testDb, {
				lorebookId: notes.id,
				binding: `{{char:n${suffix}}}`,
				characterId: null,
				name: "Ash",
				ownName: "Ash"
			} as any)
		).member!
		await testDb.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: null,
			castMemberId: ash.id,
			position: 0,
			seatedByUserId: user.id
		} as any)
		const [message] = await testDb
			.insert(schema.messages)
			.values({ sessionId, role: "assistant", content: "…" } as never)
			.returning()
		memberFormSwitch.on = true
		const { setValue } = await import("./write")
		await setValue(
			db(),
			{
				sessionId,
				updatedBy: "user",
				userId: user.id,
				messageId: message!.id
			},
			{
				owner: { kind: "seated_member", id: ash.id },
				slotId: STAT,
				value: 9
			}
		)
		const { recordToTimeline } = await import("./durable")
		const report = await recordToTimeline(db(), sessionId, {
			reason: "mark"
		})
		expect(report.route).toBe("own-book")
		expect(report.owners).toContain(`cast_member:${ash.id}`)
		const rows = (
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.ownerKind, "cast_member"),
						eq(schema.attributeValues.ownerId, ash.id)
					)
				)
		).filter((r) => r.slotId === STAT)
		expect(rows.map((r) => r.value)).toEqual([{ v: 9 }])
	})

	test("off, a card-less member files nothing", async () => {
		const w = await world()
		const { recordToTimeline } = await import("./durable")
		await recordToTimeline(db(), w.sessionId, {
			reason: "mark",
			historyEntryId: w.entry.id
		})
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "cast_member"),
					eq(schema.attributeValues.ownerId, w.ash.id)
				)
			)
		expect(rows).toEqual([])
	})
})

describe("a card-less character seat in the readers", () => {
	test("an item in its list slot counts in the supply", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const { applyChange } = await import("./write")
		await applyChange(db(), ctxOf(w), {
			owner: ashOwner(w),
			slotId: BAG,
			value: [{ entryId: w.key.id, count: 2 }]
		})
		const { itemSupplyFor } = await import("./supply")
		const [row] = await itemSupplyFor(db(), w.sessionId, [w.key.id])
		expect(row).toMatchObject({ held: 2, remaining: 1 })
		expect(row!.holders).toEqual([
			{
				ownerKind: "seated_member",
				ownerId: w.ash.id,
				slotId: BAG,
				count: 2
			}
		])
	})

	test("presences at an hour place it by the routine it holds, as its member", async () => {
		const w = await world()
		memberFormSwitch.on = true
		await testDb.insert(schema.zoneContents).values({
			sessionId: w.sessionId,
			ownerKind: "seated_member",
			ownerId: w.ash.id,
			rulesetId: RULESET,
			zoneType: "carried",
			entries: [
				{
					entryId: null,
					entryType: "routine",
					name: "Ash's week",
					fields: { routine: ROUTINE }
				}
			],
			updatedBy: "test"
		})
		const { presencesOnReading } = await import("./presencesOnReading")
		expect(
			(await presencesOnReading(db(), w.sessionId)).placements
		).toEqual([{ bindingId: w.ash.id, where: "work" }])
	})

	test("the book's reader reads the member's durable value, and a seated_member owner names the member", async () => {
		const w = await world()
		memberFormSwitch.on = true
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: w.ash.id,
			slotId: STAT,
			value: { v: 9 },
			updatedBy: "user"
		} as any)
		const { lorebookStateFor, lorebookLinks, normalizeOwner } =
			await import("./lorebookState")
		const links = await lorebookLinks(db(), w.book.id)
		expect(
			normalizeOwner({ kind: "seated_member", id: w.ash.id }, links)
		).toEqual({ kind: "cast_member", id: w.ash.id })
		const state = await lorebookStateFor(
			db(),
			{
				lorebookId: w.book.id,
				owner: { kind: "cast_member", id: w.ash.id },
				slotIds: [STAT]
			},
			{ links }
		)
		expect(
			(state.cast.byId[String(w.ash.id)] as Record<string, unknown>)[
				"cardless-trail-grit"
			]
		).toBe(9)
	})
})

describe("a card-less character seat in a rules conversion", () => {
	test("an added slot's default lands on the seat", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const rulesetId = `acme.lab:ruleset/cardless-trail-convert-${n}@1`
		await testDb.insert(schema.rulesets).values({
			rulesetId,
			ownerSlug: "acme.lab",
			label: "Convert",
			draft: {},
			published: {
				id: rulesetId,
				version: "2.0.0",
				upgrades: [
					{
						from: "1.0.0",
						to: "2.0.0",
						slots: { added: { [ADDED]: 7 } }
					}
				]
			},
			publishedVersion: "2.0.0"
		})
		await testDb
			.update(schema.sessions)
			.set({ primaryRuleset: rulesetId, rulesetVersion: "1.0.0" })
			.where(eq(schema.sessions.id, w.sessionId))
		const { convertSessionRuleset } = await import(
			"$lib/server/sessions/convertRuleset"
		)
		await convertSessionRuleset(db(), {
			sessionId: w.sessionId,
			to: "2.0.0",
			userId: w.user.id
		})
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, w.sessionId),
					eq(schema.attributeValues.slotId, ADDED)
				)
			)
		expect(
			rows.find(
				(r) => r.ownerKind === "seated_member" && r.ownerId === w.ash.id
			)?.value
		).toEqual({ v: 7 })
		expect(
			rows.some(
				(r) => r.ownerKind === "session_cast" || r.ownerKind === "card"
			)
		).toBe(false)
	})
})
