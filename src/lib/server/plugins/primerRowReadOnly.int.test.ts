/**
 * 🚧 (m2e-F-D, ★M2e-D-4) A primer row is read-only: every person-facing write
 * door on a book refuses it with one sentence, a clone still works, and the
 * boot sync and the admin disable/enable still write.
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
		getCryptoSecretKey: () => "primer-read-only-test-secret"
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
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const VIS_PRIMER = "core:primer/vis-itineris@1"
const PLUGIN_ID = "acme/primer-kit"
const PLUGIN_NAME = "Acme Kit"
const quiet = (() => {}) as any
const db = () => testDb as unknown as Db
const socket = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin, username: `u${userId}` },
		emit: vi.fn(),
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} }),
			in: () => ({ fetchSockets: async () => [] })
		}
	}) as any

let adminId: number
let member: number
let primerId: number
let pluginKitId: number
let adminKitId: number
let plainProvidedId: number

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
		.orderBy(schema.lorebookEntries.id)
}
async function stateOf(lorebookId: number) {
	const binds = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	return {
		row: await bookRow(lorebookId),
		entries: await entriesOf(lorebookId),
		binds
	}
}
async function insertBook(
	values: Partial<typeof schema.lorebooks.$inferInsert>,
	plugin: string | null
) {
	const uuid = `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: adminId,
			uuid,
			...values,
			...(plugin
				? {
						extraJson: {
							provided: {
								plugin,
								slug: `${plugin}:slug`,
								version: "1.0.0",
								sha256: "x",
								uuid,
								entries: {}
							}
						}
					}
				: {})
		} as any)
		.returning()
	const [shape] = await testDb
		.select({
			typeId: schema.lorebookEntries.typeId,
			typeVersion: schema.lorebookEntries.typeVersion
		})
		.from(schema.lorebookEntries)
		.limit(1)
	await testDb.insert(schema.lorebookEntries).values({
		lorebookId: row.id,
		typeId: shape.typeId,
		typeVersion: shape.typeVersion,
		title: "Seed",
		content: "seed text",
		position: 1
	} as any)
	return row.id
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-primer-read-only-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	adminId = (await testDb.query.users.findFirst({
		where: (u, { eq }) => eq(u.isAdmin, true),
		orderBy: (u, { asc }) => [asc(u.id)]
	}))!.id
	member = (await createTestUser(testDb, "primer-ro-member")).id
	const { syncProvidedPrimers } = await import("./providedPrimers")
	const report = await syncProvidedPrimers(db(), { version: "1.0.0" })
	expect(report.problems).toEqual([])
	const { primerRowOf } = await import("$lib/server/lorebooks/starterKits")
	primerId = (await primerRowOf(db(), VIS_PRIMER))!.row.id
	await testDb.insert(schema.plugins).values({
		pluginId: PLUGIN_ID,
		name: PLUGIN_NAME,
		version: "0.1.0",
		bundleSource: "",
		bundleHash: "x",
		enabled: false,
		manifest: {},
		adminDenied: []
	} as any)
	pluginKitId = await insertBook(
		{ name: "Plugin kit", kind: "starter_kit" },
		PLUGIN_ID
	)
	adminKitId = await insertBook(
		{ name: "Admin kit", kind: "starter_kit" },
		null
	)
	plainProvidedId = await insertBook(
		{ name: "Plain provided", kind: "book" },
		"core"
	)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const REFUSAL_CORE = () => primerRowEditRefusalOf(null)
let primerRowEditRefusalOf: (n: string | null) => string
beforeAll(async () => {
	primerRowEditRefusalOf = (await import("./providedMarks"))
		.primerRowEditRefusal
})

/** Every person-facing door, as a thunk per book id and asker. */
async function doors(
	bookId: number,
	entryId: number,
	entryType: string,
	asker: any
) {
	const L = await import("$lib/server/sockets/lorebooks")
	const E = await import("$lib/server/sockets/entries")
	const K = await import("$lib/server/sockets/starterKits")
	const G = await import("$lib/server/sockets/narrativeGraph")
	const T = await import("$lib/server/sockets/lorebookStoryTime")
	const A = await import("$lib/server/sockets/amendments")
	const S = await import("$lib/server/sockets/scenes")
	return {
		"lorebooks:update settings": () =>
			L.lorebooksUpdateHandler.handler(
				asker,
				{
					lorebook: { id: bookId, name: "Renamed", description: "d" }
				} as any,
				quiet
			),
		"lorebooks:update coverFile": () =>
			L.lorebooksUpdateHandler.handler(
				asker,
				{
					lorebook: { id: bookId },
					coverFile: Buffer.from([1, 2, 3])
				} as any,
				quiet
			),
		"entries:create": () =>
			E.createEntryHandler.handler(
				asker,
				{
					entry: {
						typeId: "core:entry/world-lore",
						lorebookId: bookId,
						name: "New",
						content: "x"
					}
				} as any,
				quiet
			),
		"entries:update": () =>
			E.updateEntryHandler.handler(
				asker,
				{
					entry: {
						id: entryId,
						typeId: entryType,
						content: "changed"
					}
				} as any,
				quiet
			),
		"entries:update archive": () =>
			E.updateEntryHandler.handler(
				asker,
				{
					entry: { id: entryId, typeId: entryType, archived: true }
				} as any,
				quiet
			),
		"entries:delete": () =>
			E.deleteEntryHandler.handler(
				asker,
				{ id: entryId, typeId: entryType } as any,
				quiet
			),
		"entries:updatePositions": () =>
			E.updateEntryPositionsHandler.handler(
				asker,
				{
					lorebookId: bookId,
					typeId: entryType,
					positions: [{ id: entryId, position: 99 }]
				} as any,
				quiet
			),
		"entries:copyFromLibrary": () =>
			E.copyFromLibraryHandler.handler(
				asker,
				{
					lorebookId: bookId,
					typeId: entryType,
					pieceId: "nothing"
				} as any,
				quiet
			),
		"lorebooks:createBinding": () =>
			L.createLorebookBindingHandler.handler(
				asker,
				{ lorebookBinding: { lorebookId: bookId } } as any,
				quiet
			),
		"lorebooks:resolveOrCreateBindingByName": () =>
			L.resolveOrCreateBindingByNameHandler.handler(
				asker,
				{
					lorebookId: bookId,
					name: "A Brand New Name Nobody Has"
				} as any,
				quiet
			),
		"starterKits:saveFromBook": () =>
			K.starterKitsSaveFromBookHandler.handler(
				asker,
				{ lorebookId: bookId } as any,
				quiet
			),
		"narrativeGraph:dismissDuplicate": () =>
			G.narrativeGraphDismissDuplicateHandler.handler(
				asker,
				{ lorebookId: bookId, bindingIdA: 1, bindingIdB: 2 } as any,
				quiet
			),
		"lorebooks:setCalendar": () =>
			T.lorebookSetCalendarHandler.handler(
				asker,
				{ lorebookId: bookId, calendar: null } as any,
				quiet
			),
		"amendments:fork": () =>
			A.amendmentsForkHandler?.handler(
				asker,
				{ lorebookId: bookId, name: "Line" } as any,
				quiet
			),
		"scenes:create": () =>
			S.sceneCreateHandler?.handler(
				asker,
				{ scene: { lorebookId: bookId, name: "S" } } as any,
				quiet
			)
	} as Record<string, () => Promise<any>>
}

describe("a core primer row refuses every person's edit", () => {
	test("each door refuses with the one sentence and writes nothing", async () => {
		const entry = (await entriesOf(primerId))[0]
		const asker = socket(adminId, true)
		const table = await doors(primerId, entry.id, entry.typeId, asker)
		const before = await stateOf(primerId)
		for (const [name, run] of Object.entries(table)) {
			if (name === "entries:copyFromLibrary") continue // asked below: needs its own order
			await expect(run(), name).rejects.toThrow(REFUSAL_CORE())
		}
		await expect(table["entries:copyFromLibrary"]()).rejects.toThrow(
			REFUSAL_CORE()
		)
		expect(await stateOf(primerId)).toEqual(before)
	}, 60_000)

	test("entries:setMarks answers with the sentence as an error and changes nothing", async () => {
		const E = await import("$lib/server/sockets/entries")
		const entry = (await entriesOf(primerId))[0]
		const before = await entriesOf(primerId)
		const sent: any[] = []
		const res: any = await E.entrySetMarksHandler.handler(
			socket(adminId, true),
			{ entryId: entry.id, off: true } as any,
			((e: string, d: any) => sent.push([e, d])) as any
		)
		expect(res.error).toBe(REFUSAL_CORE())
		expect(await entriesOf(primerId)).toEqual(before)
	}, 60_000)

	test("the Brackenvale sentence names the pub, not a plugin", () => {
		expect(REFUSAL_CORE()).toBe(
			"This starter lorebook comes with the pub: clone it to make your own."
		)
	})
})

describe("who is and is not a primer row", () => {
	test("a plugin's row names the plugin; once the plugin is gone the row is editable", async () => {
		const entry = (await entriesOf(pluginKitId))[0]
		const asker = socket(adminId, true)
		const table = await doors(pluginKitId, entry.id, entry.typeId, asker)
		await expect(table["lorebooks:update settings"]()).rejects.toThrow(
			primerRowEditRefusalOf(PLUGIN_NAME)
		)
		await expect(table["entries:create"]()).rejects.toThrow(
			`This starter lorebook comes with ${PLUGIN_NAME}: clone it to make your own.`
		)
		const { primerRowEditProblem } = await import("./providedMarks")
		expect(await primerRowEditProblem(db(), pluginKitId)).toBe(
			primerRowEditRefusalOf(PLUGIN_NAME)
		)
		// The wire names the plugin too (list and get), while it is installed.
		const { buildLorebooksList, lorebooksGetHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const listed: any = await buildLorebooksList(adminId)
		expect(
			listed.lorebookList.find((b: any) => b.id === pluginKitId).readOnly
		).toEqual({ pluginName: PLUGIN_NAME })
		const got: any = await lorebooksGetHandler.handler(
			asker,
			{ id: pluginKitId } as any,
			() => {}
		)
		expect(got.lorebook.readOnly).toEqual({ pluginName: PLUGIN_NAME })
		// The shared sentence is the server's.
		const shared = await import("$lib/shared/lorebooks/primerRow")
		expect(shared.primerRowEditRefusal(PLUGIN_NAME)).toBe(
			primerRowEditRefusalOf(PLUGIN_NAME)
		)
		await testDb
			.delete(schema.plugins)
			.where(eq(schema.plugins.pluginId, PLUGIN_ID))
		expect(await primerRowEditProblem(db(), pluginKitId)).toBeNull()
		await table["lorebooks:update settings"]()
		expect((await bookRow(pluginKitId)).name).toBe("Renamed")
	}, 60_000)

	test("an admin kit with no mark and a plain provided book stay editable", async () => {
		const { primerRowEditProblem } = await import("./providedMarks")
		for (const id of [adminKitId, plainProvidedId]) {
			expect(await primerRowEditProblem(db(), id)).toBeNull()
			const entry = (await entriesOf(id))[0]
			const table = await doors(
				id,
				entry.id,
				entry.typeId,
				socket(adminId, true)
			)
			await table["lorebooks:update settings"]()
			expect((await bookRow(id)).name).toBe("Renamed")
			await table["entries:update"]()
			expect((await entriesOf(id))[0].content).toBe("changed")
		}
		expect(await primerRowEditProblem(db(), 987_654_321)).toBeNull()
	}, 60_000)
})

describe("the wire field", () => {
	test("lorebooks:list and lorebooks:get carry readOnly for the primer row only", async () => {
		const { buildLorebooksList, lorebooksGetHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const list: any = await buildLorebooksList(adminId)
		const of = (id: number) =>
			list.lorebookList.find((b: any) => b.id === id)
		expect(of(primerId).readOnly).toEqual({ pluginName: null })
		expect(of(adminKitId)?.readOnly).toBeUndefined()
		expect(of(plainProvidedId)?.readOnly).toBeUndefined()
		const get = async (id: number) =>
			(
				(await lorebooksGetHandler.handler(
					socket(adminId, true),
					{ id } as any,
					quiet
				)) as any
			).lorebook
		expect((await get(primerId)).readOnly).toEqual({ pluginName: null })
		expect((await get(adminKitId)).readOnly).toBeUndefined()
		expect((await get(plainProvidedId)).readOnly).toBeUndefined()
		expect((await get(plainProvidedId)).provided).toEqual({
			disabled: false
		})
	}, 60_000)
})

describe("cloning, upgrading and disabling still work", () => {
	test("starterKits:clone and a person's start give an editable clone with no readOnly", async () => {
		const { starterKitsCloneHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const {
			lorebooksCreateHandler,
			lorebooksGetHandler,
			lorebooksUpdateHandler
		} = await import("$lib/server/sockets/lorebooks")
		const res: any = await starterKitsCloneHandler.handler(
			socket(adminId, true),
			{ id: `book:${primerId}`, name: "Mine" },
			quiet
		)
		const cloneId = Number(res.kit.id.slice("book:".length))
		const start: any = await lorebooksCreateHandler.handler(
			socket(member),
			{
				name: "My vale",
				primaryRuleset: "core:ruleset/freeform@1",
				starterKit: { lorebookId: primerId }
			},
			quiet
		)
		for (const [id, who] of [
			[cloneId, socket(adminId, true)],
			[start.lorebook.id, socket(member)]
		] as const) {
			const got: any = await lorebooksGetHandler.handler(
				who,
				{ id } as any,
				quiet
			)
			expect(got.lorebook.readOnly).toBeUndefined()
			await lorebooksUpdateHandler.handler(
				who,
				{ lorebook: { id, description: "mine now" } } as any,
				quiet
			)
			expect((await bookRow(id)).description).toBe("mine now")
		}
		const dup: any = await (
			await import("$lib/server/sockets/lorebooks")
		).lorebooksDuplicateHandler.handler(
			socket(adminId, true),
			{ lorebookId: primerId } as any,
			quiet
		)
		const dupId = dup?.lorebook?.id ?? dup?.id
		expect(dupId).toBeTruthy()
		const copy = await bookRow(dupId)
		const { primerRowEditProblem } = await import("./providedMarks")
		expect(await primerRowEditProblem(db(), copy.id)).toBeNull()
	}, 60_000)

	test("an upgrade still lands on the primer row", async () => {
		const { syncProvidedPrimers } = await import("./providedPrimers")
		const [victim] = await entriesOf(primerId)
		const { markedBook } = await import("./providedMarks")
		const row = await bookRow(primerId)
		const mark = markedBook(row.extraJson, row.uuid)!
		const key = Object.keys(mark.entries).find(
			(k) => mark.entries[k].id === victim.id
		)!
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "stale upstream" })
			.where(eq(schema.lorebookEntries.id, victim.id))
		const { rowHashOf } = await import("./providedBooks")
		const [stale] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, victim.id))
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...(row.extraJson as object),
					provided: {
						...mark,
						sha256: "older",
						entries: {
							...mark.entries,
							[key]: {
								...mark.entries[key],
								hash: rowHashOf(stale),
								up: "older"
							}
						}
					}
				}
			})
			.where(eq(schema.lorebooks.id, primerId))
		const report = await syncProvidedPrimers(db(), { version: "1.0.1" })
		expect(report.upgraded).toContain(VIS_PRIMER)
		const [after] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, victim.id))
		expect(after.content).toBe(victim.content)
		expect(after.content).not.toBe("stale upstream")
	}, 60_000)

	test("the admin disable and enable pair still toggles it", async () => {
		const { setProvidedBookDisabled } = await import("./providedBooks")
		const { markedBook } = await import("./providedMarks")
		const mark = async () => {
			const r = await bookRow(primerId)
			return markedBook(r.extraJson, r.uuid)!
		}
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, true, adminId)
		expect((await mark()).disabled).toBe(true)
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, false, adminId)
		expect((await mark()).disabled).toBeUndefined()
	}, 60_000)
})
