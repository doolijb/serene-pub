/**
 * 🚧 Starter lorebooks (PLAN-lorebook-kinds §B, lane K1): a shipped kit's world
 * written into a book, admin kits saved / cloned / deleted by admins only,
 * books and sessions started from a kit, and a kit row kept out of every
 * place a lorebook is read or shared.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "starter-kits-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const VIS = "core:ruleset/vis-itineris@1"
const FREEFORM = "core:ruleset/freeform@1"
const VIS_PRIMER = "core:primer/vis-itineris@1"
const quiet = (() => {}) as any
const db = () => testDb as unknown as Db

const socket = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin, username: `u${userId}` },
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} }),
			in: () => ({ fetchSockets: async () => [] })
		}
	}) as any

let adminA: number
let adminB: number
let member: number
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-starter-kits-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	adminA = (await createTestUser(testDb, "kits-admin-a")).id
	adminB = (await createTestUser(testDb, "kits-admin-b")).id
	member = (await createTestUser(testDb, "kits-member")).id
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** A book of `userId`'s with one cast member on a card they own. */
async function bookWithCast(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Vale ${++n}`, primaryRuleset: VIS })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId, name: `Ivo ${n}`, description: "A ferryman." })
		.returning()
	await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: card.name
		})
	await testDb.insert(schema.lorebookEntries).values({
		lorebookId: book.id,
		typeId: "core:entry/world-lore",
		typeVersion: 1,
		position: 0,
		title: "The ferry",
		content: "It crosses at dusk."
	})
	return { book, card }
}

async function bookRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, id))
	return row
}

async function entriesOf(lorebookId: number) {
	return testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
}

describe("writePrimerInto", () => {
	test("Brackenvale: its entries, places, leads, cast, ties, calendar, clock and Rules — no compendium", async () => {
		const { getPrimer } = await import("@serene-pub/sdk")
		const { writePrimerInto } = await import("./starterKits")
		const primer = getPrimer(VIS_PRIMER)!
		const c = primer.content
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: member, name: "Kit target" })
			.returning()
		const { characterIds } = await testDb.transaction((tx) =>
			writePrimerInto(tx as unknown as Db, {
				lorebookId: book.id,
				userId: member,
				primer
			})
		)

		const rows = await entriesOf(book.id)
		expect(rows.length).toBe(
			c.entries.length + c.places.length + c.leads.length
		)
		expect(
			rows
				.filter((r) => r.typeId === "core:entry/location")
				.map((r) => r.title)
				.sort()
		).toEqual(c.places.map((p) => p.title).sort())
		// Only the primer's own derived entries: the ruleset's compendium is shown under a book, never copied.
		const derived = rows.filter((r) => r.typeId.includes("vis-itineris."))
		expect(derived.map((r) => r.title).sort()).toEqual(
			c.entries
				.filter((e) => e.type.includes("vis-itineris."))
				.map((e) => e.title)
				.sort()
		)
		expect(rows.some((r) => r.derivedFrom != null)).toBe(false)
		expect(
			rows.filter((r) => (r.fields as any)?.category === "lead").length
		).toBe(c.leads.length)

		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(members.map((m) => m.name).sort()).toEqual(
			c.cast.map((m) => m.name).sort()
		)
		expect(characterIds.length).toBe(c.cast.length)
		const cards = await testDb
			.select()
			.from(schema.characters)
			.where(
				inArray(
					schema.characters.id,
					members.map((m) => m.characterId!)
				)
			)
		expect(cards.every((card) => card.userId === member)).toBe(true)

		// Each way out is a lore link.
		const links = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(
				and(
					eq(schema.narrativeRelationships.lorebookId, book.id),
					isNotNull(schema.narrativeRelationships.fromEntryId),
					isNotNull(schema.narrativeRelationships.toEntryId)
				)
			)
		const exits = c.places.reduce(
			(sum, p) => sum + (p.exits?.length ?? 0),
			0
		)
		expect(
			links.filter((l) => l.relationshipType === "leads to").length
		).toBe(exits)
		// A cast tie between two members is two perspective rows.
		const ties = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(
				and(
					eq(schema.narrativeRelationships.lorebookId, book.id),
					isNotNull(schema.narrativeRelationships.fromNodeId),
					isNotNull(schema.narrativeRelationships.toNodeId)
				)
			)
		const castKeys = new Set(c.cast.map((m) => m.key))
		const castTies = c.relationships.filter(
			(r) => castKeys.has(r.from) && castKeys.has(r.to)
		).length
		expect(ties.length).toBe(castTies * 2)

		// Sheets land on the book's cast members, where they are found too.
		const odile = members.find((m) => m.name === "Odile Marsh")!
		const stats = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "cast_member"),
					eq(schema.attributeValues.ownerId, odile.id)
				)
			)
		expect(
			stats.find((s) => s.slotId === "core:slot/level@1")?.value
		).toEqual({ v: 1 })
		const oxbow = rows.find(
			(r) =>
				r.title ===
				c.places.find((p) => p.key === "drowsy-oxbow")!.title
		)!
		expect(
			stats.find((s) => s.slotId === "core:slot/location@1")?.value
		).toEqual({ v: { entryId: oxbow.id } })

		const after = await bookRow(book.id)
		expect(after.primaryRuleset).toBe(VIS)
		expect(after.storyCalendar).toEqual(c.calendar)
		expect(after.storyClockYear).toBe(c.clock!.year)
		expect(after.storyClockMonth).toBe(c.clock!.month)
	})
})

describe("starting a lorebook from a kit", () => {
	test("lorebooks:create from a shipped kit: the kit's Rules win", async () => {
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res: any = await lorebooksCreateHandler.handler(
			socket(member),
			{
				name: "My vale",
				primaryRuleset: FREEFORM,
				starterKit: { primerId: VIS_PRIMER }
			},
			quiet
		)
		const row = await bookRow(res.lorebook.id)
		expect(row).toMatchObject({
			name: "My vale",
			kind: "book",
			primaryRuleset: VIS,
			userId: member,
			sessionId: null
		})
		expect((await entriesOf(row.id)).length).toBeGreaterThan(20)
	})

	test("an unknown kit, or a lorebook named as one, is refused in words", async () => {
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { STARTER_KIT_SENTENCES } = await import("./starterKits")
		const { book } = await bookWithCast(member)
		for (const starterKit of [
			{ primerId: "core:primer/nowhere@1" },
			{ primerId: "core:primer/freeform@1" },
			{ lorebookId: book.id }
		])
			await expect(
				lorebooksCreateHandler.handler(
					socket(member),
					{ name: "x", starterKit } as any,
					quiet
				)
			).rejects.toThrow(STARTER_KIT_SENTENCES.unknown)
	})

	test("from another admin's kit: the cast's cards are copied to the asker", async () => {
		const { starterKitsSaveFromBookHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const { lorebooksCreateHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { book, card } = await bookWithCast(adminA)
		const saved: any = await starterKitsSaveFromBookHandler.handler(
			socket(adminA, true),
			{ lorebookId: book.id, name: "Ferry kit" },
			quiet
		)
		expect(saved.kit).toMatchObject({
			source: "admin",
			name: "Ferry kit",
			mine: true,
			counts: { entries: 1, places: 0, cast: 1 }
		})
		const kitId = Number(saved.kit.id.slice("book:".length))
		expect(await bookRow(kitId)).toMatchObject({
			kind: "starter_kit",
			userId: adminA
		})

		const made: any = await lorebooksCreateHandler.handler(
			socket(member),
			{ name: "From the kit", starterKit: { lorebookId: kitId } },
			quiet
		)
		const [m] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, made.lorebook.id))
		expect(m.characterId).not.toBe(card.id)
		const [copy] = await testDb
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, m.characterId!))
		expect(copy).toMatchObject({
			userId: member,
			name: card.name,
			description: card.description
		})
		expect(await bookRow(made.lorebook.id)).toMatchObject({
			kind: "book",
			userId: member,
			primaryRuleset: VIS
		})

		// Later edits to the book never reach the kit.
		await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book.id,
				typeId: "core:entry/world-lore",
				typeVersion: 1,
				position: 1,
				title: "Later",
				content: "."
			})
		expect((await entriesOf(kitId)).length).toBe(1)
	})
})

describe("a session from a kit", () => {
	test("the kit lands in the session's notes with its Rules, and in no lorebook", async () => {
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const before = await testDb
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.userId, member))
		const res: any = await sessionsCreateHandler.handler(
			socket(member),
			{
				session: { name: "Kit run", genreId: "core:genre/story" },
				characterIds: [],
				personaIds: [],
				characterPositions: {},
				starterKit: { primerId: VIS_PRIMER }
			} as any,
			quiet
		)
		expect(res?.error, res?.error).toBeUndefined()
		const [session] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, res.session.id))
		expect(session).toMatchObject({ lorebookId: null, primaryRuleset: VIS })
		const { ownBookOf } = await import("./ownBook")
		const notes = (await ownBookOf(db(), session.id))!
		expect(notes).toMatchObject({
			sessionId: session.id,
			overlayOf: null,
			kind: "book",
			primaryRuleset: VIS
		})
		expect((await entriesOf(notes.id)).length).toBeGreaterThan(20)
		const { lorebooksListHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const list: any = await lorebooksListHandler.handler(
			socket(member),
			{},
			quiet
		)
		expect(list.lorebookList.some((b: any) => b.id === notes.id)).toBe(
			false
		)
		const after = await testDb
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.userId, member))
		expect(after.length).toBe(before.length + 1) // the notes, and nothing else
	})

	test("a kit beside a lorebook is refused", async () => {
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const { STARTER_KIT_SENTENCES } = await import("./starterKits")
		const { book } = await bookWithCast(member)
		const res: any = await sessionsCreateHandler.handler(
			socket(member),
			{
				session: {
					name: "Both",
					genreId: "core:genre/story",
					lorebookId: book.id
				},
				characterIds: [],
				personaIds: [],
				characterPositions: {},
				starterKit: { primerId: VIS_PRIMER }
			} as any,
			quiet
		)
		expect(res.error).toBe(STARTER_KIT_SENTENCES.kitAndBook)
	})
})

describe("starterKits:list and the admin verbs", () => {
	test("the list shows shipped kits (not Blank) and every admin kit", async () => {
		const { starterKitsListHandler, starterKitsCloneHandler } =
			await import("$lib/server/sockets/starterKits")
		const cloned: any = await starterKitsCloneHandler.handler(
			socket(adminB, true),
			{ id: `primer:${VIS_PRIMER}` },
			quiet
		)
		expect(cloned.kit).toMatchObject({
			source: "admin",
			name: "Brackenvale (copy)",
			rulesId: VIS,
			mine: true
		})
		const res: any = await starterKitsListHandler.handler(
			socket(member),
			{},
			quiet
		)
		const ids = res.kits.map((k: any) => k.id)
		expect(ids).toContain(`primer:${VIS_PRIMER}`)
		expect(ids).not.toContain("primer:core:primer/freeform@1")
		expect(ids).toContain(cloned.kit.id)
		const shipped = res.kits.find(
			(k: any) => k.id === `primer:${VIS_PRIMER}`
		)
		expect(shipped).toMatchObject({
			source: "core",
			name: "Brackenvale",
			rulesId: VIS,
			counts: { places: 10, cast: 7 }
		})
		expect(res.kits.find((k: any) => k.id === cloned.kit.id)).toMatchObject(
			{ mine: false }
		)
		// The clone holds the kit's world, counted alike.
		expect(
			res.kits.find((k: any) => k.id === cloned.kit.id).counts
		).toEqual(shipped.counts)
	})

	test("save, clone and delete are for admins; any admin may delete an admin kit; shipped kits stay", async () => {
		const h = await import("$lib/server/sockets/starterKits")
		const { STARTER_KIT_SENTENCES } = await import("./starterKits")
		const { book } = await bookWithCast(member)
		await expect(
			h.starterKitsSaveFromBookHandler.handler(
				socket(member),
				{ lorebookId: book.id },
				quiet
			)
		).rejects.toThrow(STARTER_KIT_SENTENCES.adminOnly)
		await expect(
			h.starterKitsCloneHandler.handler(
				socket(member),
				{ id: `primer:${VIS_PRIMER}` },
				quiet
			)
		).rejects.toThrow(STARTER_KIT_SENTENCES.adminOnly)
		// An admin saves only their own book.
		await expect(
			h.starterKitsSaveFromBookHandler.handler(
				socket(adminA, true),
				{ lorebookId: book.id },
				quiet
			)
		).rejects.toThrow(STARTER_KIT_SENTENCES.saveOwnBook)

		const cloned: any = await h.starterKitsCloneHandler.handler(
			socket(adminA, true),
			{ id: `primer:${VIS_PRIMER}`, name: "Mine" },
			quiet
		)
		const kitId = Number(cloned.kit.id.slice("book:".length))
		await expect(
			h.starterKitsDeleteHandler.handler(
				socket(member),
				{ lorebookId: kitId },
				quiet
			)
		).rejects.toThrow(STARTER_KIT_SENTENCES.adminOnly)
		// Not a kit: a lorebook is not deleted through here.
		await expect(
			h.starterKitsDeleteHandler.handler(
				socket(adminB, true),
				{ lorebookId: book.id },
				quiet
			)
		).rejects.toThrow()
		expect(await bookRow(book.id)).toBeDefined()
		const res: any = await h.starterKitsDeleteHandler.handler(
			socket(adminB, true),
			{ lorebookId: kitId },
			quiet
		)
		expect(res).toEqual({ lorebookId: kitId, id: `book:${kitId}` })
		expect(await bookRow(kitId)).toBeUndefined()
	})
})

describe("a kit is never read, written by a session, shared or shelved as a book", () => {
	async function adminKit() {
		const { starterKitsCloneHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const cloned: any = await starterKitsCloneHandler.handler(
			socket(adminA, true),
			{ id: `primer:${VIS_PRIMER}`, name: `Kit ${++n}` },
			quiet
		)
		return {
			id: Number(cloned.kit.id.slice("book:".length)),
			name: cloned.kit.name as string
		}
	}

	test("sessions:create, sessions:setLorebook and sessions:update refuse a kit, even its owner's", async () => {
		const { kitIsNotReadSentence } = await import("./starterKits")
		const kit = await adminKit()
		const { sessionsCreateHandler, sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const { sessionsSetLorebookHandler } = await import(
			"$lib/server/sockets/summarize"
		)
		const created: any = await sessionsCreateHandler.handler(
			socket(adminA, true),
			{
				session: {
					name: "Reads a kit",
					genreId: "core:genre/story",
					lorebookId: kit.id
				},
				characterIds: [],
				personaIds: [],
				characterPositions: {}
			} as any,
			quiet
		)
		expect(created.error).toBe(kitIsNotReadSentence(kit.name))
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: adminA, isGroup: false, name: "Plain run" })
			.returning()
		await expect(
			sessionsSetLorebookHandler.handler(
				socket(adminA, true),
				{ sessionId: session.id, lorebookId: kit.id },
				quiet
			)
		).rejects.toThrow(kitIsNotReadSentence(kit.name))
		await expect(
			sessionsUpdateHandler.handler(
				socket(adminA, true),
				{ session: { id: session.id, lorebookId: kit.id } } as any,
				quiet
			)
		).rejects.toThrow(kitIsNotReadSentence(kit.name))
	})

	test("lorebooks:share refuses a kit", async () => {
		const { STARTER_KIT_SENTENCES } = await import("./starterKits")
		const kit = await adminKit()
		const { lorebooksShareHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		await expect(
			lorebooksShareHandler.handler(
				socket(adminA, true),
				{ lorebookId: kit.id, userIds: [member] } as any,
				quiet
			)
		).rejects.toThrow(STARTER_KIT_SENTENCES.share)
	})

	test("the owner's shelf marks their kits; nobody else's shelf shows them", async () => {
		const kit = await adminKit()
		const { lorebooksListHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const mine: any = await lorebooksListHandler.handler(
			socket(adminA, true),
			{},
			quiet
		)
		expect(
			mine.lorebookList.find((b: any) => b.id === kit.id)
		).toMatchObject({ kind: "starter_kit" })
		const theirs: any = await lorebooksListHandler.handler(
			socket(member),
			{},
			quiet
		)
		expect(theirs.lorebookList.some((b: any) => b.id === kit.id)).toBe(
			false
		)
		expect(theirs.lorebookList.every((b: any) => b.kind === "book")).toBe(
			true
		)
	})
})
