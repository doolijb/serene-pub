/**
 * A lorebook import finishes the job and tells the truth (plan A13, and A24's
 * import leftovers):
 *
 * - **Overwrite deletes what the book owns by the one rule** book delete uses
 *   (`purgeLorebook`): every stat and stat sheet of the book, its cast
 *   members and its places — a session's own stats on a place included, which
 *   pointed at deleted rows before — and the conflict prompt counts first
 *   what no file brings back (`sessionStats`, `sheets`).
 * - **Overwrite seats the cast of every session reading the book again**, as
 *   reading a book into a session does: the file brings back only its own.
 *   It asks the person nothing per session (no orphan prompt).
 * - **Overwrite drops what sessions hold of the book's entries** — an item
 *   carried, a place stood in — since every entry is new, and the conflict
 *   prompt counts it first (`sessionLoreRefs`).
 * - **An imported book is queued** for its vectors and annotations.
 * - **A failure after the book is saved is not "import failed"**: the reply
 *   carries the book and names what did not finish (`warnings`) — the list
 *   refresh, the read-back, a link the file carries that did not land whole.
 * - **The database's words never reach the person**: a driver error raised
 *   outside a query (PGlite at COMMIT) is a plain sentence.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const enqueued = vi.hoisted(() => ({
	vectors: [] as number[],
	annotations: [] as number[]
}))
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async (id: number) => {
		enqueued.vectors.push(id)
	})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn((id: number) => {
		enqueued.annotations.push(id)
	})
}))
/** Set to make the cast's name sync after the save fail, as a database would. */
const failing = vi.hoisted(() => ({ castSync: false }))
vi.mock("$lib/server/utils/characterBindingSync", async (importOriginal) => {
	const original = await importOriginal<
		typeof import("$lib/server/utils/characterBindingSync")
	>()
	return {
		...original,
		syncLorebookBindingsForCharacter: vi.fn(async (characterId: number) => {
			if (failing.castSync) throw new Error("The cast sync failed.")
			return original.syncLorebookBindingsForCharacter(characterId)
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lorebook-import-finish-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
const STASH = "test:slot/stash@1"
const INVENTORY = "core:slot/inventory@1"
const LOCATION = "core:slot/location@1"

/**
 * Every event a handler sent, emitted as `emitToUser` emits (`sockets/index.ts`
 * `evaluate`): a lazy payload is built, and one whose build throws is logged
 * and sends nothing — it never throws back into the handler.
 */
function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any): any => {
		if (typeof data !== "function") {
			sent.push({ event, data })
			return
		}
		return (async () => {
			try {
				sent.push({ event, data: await data() })
			} catch (e) {
				console.error(`Error building the payload for ${event}:`, e)
			}
		})()
	}
	return { sent, emit }
}

/** Make the book list's read fail, as a database would, until restored. */
const failListRead = () =>
	vi
		.spyOn(testDb.query.lorebooks, "findMany")
		.mockRejectedValue(new Error("The list read failed."))

let n = 0

/**
 * A book with a place, two world entries linked, a cast member with no card
 * and one with a card (whom the file carries, so an import syncs her name).
 */
async function seedBook() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `import-finish-${suffix}`)
	const { lorebooksCreateHandler } = await import("./lorebooks")
	const { lorebook } = await lorebooksCreateHandler.handler(
		fakeSocket(user.id),
		{ name: `Harbor Book ${suffix}` },
		noopEmit
	)
	const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
	const { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } = await import(
		"$lib/shared/entries/types"
	)
	const entry = async (typeId: string, name: string, position: number) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId,
						lorebookId: lorebook.id,
						position,
						name,
						keys: [name.toLowerCase()],
						content: `${name}.`
					} as any)
				)
				.returning()
		)[0]!
	const harbor = await entry(LOCATION_TYPE_ID, "Harbor", 0)
	const bells = await entry(WORLD_LORE_TYPE_ID, "Bells", 0)
	const tides = await entry(WORLD_LORE_TYPE_ID, "Tides", 1)
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: lorebook.id, binding: "{{char:1}}", name: "Mira" })
		.returning()
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "A delver." })
		.returning()
	await testDb.insert(schema.lorebookBindings).values({
		lorebookId: lorebook.id,
		binding: "{{char:2}}",
		characterId: verity!.id,
		name: "Verity"
	})
	await testDb
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 3 })
		.where(eq(schema.lorebooks.id, lorebook.id))
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: lorebook.id,
		fromEntryId: bells.id,
		toEntryId: tides.id,
		relationshipType: "rings with"
	})
	return { user, lorebook, harbor, bells, member }
}

async function fileOf(lorebookId: number, userId: number) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { specBookWithGraph } = await buildLorebookExportData(lorebookId, userId)
	return JSON.parse(JSON.stringify(specBookWithGraph))
}

async function importFile(
	userId: number,
	data: unknown,
	emit: (event: string, data: any) => void = noopEmit
) {
	const { lorebookImportHandler } = await import("./lorebooks")
	return lorebookImportHandler.handler(
		fakeSocket(userId),
		{ lorebookJson: JSON.stringify(data) },
		emit
	)
}

async function overwrite(
	userId: number,
	heldImportId: string,
	existingId: number,
	emit: (event: string, data: any) => void = noopEmit
) {
	const { lorebookImportResolveHandler } = await import("./lorebooks")
	return lorebookImportResolveHandler.handler(
		fakeSocket(userId),
		{ heldImportId, action: "overwrite", existingId },
		emit
	)
}

/** A changed file of the book, and the conflict it raises. */
async function conflictOf(b: Awaited<ReturnType<typeof seedBook>>) {
	const file = await fileOf(b.lorebook.id, b.user.id)
	file.description = "Changed."
	const res = await importFile(b.user.id, file)
	expect(res.status).toBe("conflict")
	return res.conflict!
}

describe("an overwrite deletes what the book owns by the one rule, and says so first", () => {
	test("a session's stats on a place and every assigned sheet are counted, then gone", async () => {
		const b = await seedBook()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: b.user.id, isGroup: false, name: "Run", lorebookId: b.lorebook.id })
			.returning()
		const sheetId = `test:sheet/harbor-${n}@1`
		await testDb
			.insert(schema.attributeSheets)
			.values({ id: sheetId, userId: b.user.id, props: {} })
		// The session's own layer over the harbor: a value and a configuration
		// of one slot — one stat.
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session_location",
			ownerId: b.harbor.id,
			slotId: STASH,
			value: { v: ["rope"] },
			sessionId: session!.id
		})
		await testDb.insert(schema.attributeConfigs).values({
			ownerKind: "session_location",
			ownerId: b.harbor.id,
			slotId: STASH,
			config: { max: 3 },
			sessionId: session!.id
		})
		// A sheet on the book, on its cast member and on its place.
		await testDb.insert(schema.ownerSheets).values([
			{ ownerKind: "lorebook", ownerId: b.lorebook.id, sheetId },
			{ ownerKind: "cast_member", ownerId: b.member.id, sheetId },
			{ ownerKind: "location", ownerId: b.harbor.id, sheetId }
		])

		const conflict = await conflictOf(b)
		expect(conflict.losses).toMatchObject({ sessionStats: 1, sheets: 3 })

		await overwrite(b.user.id, conflict.heldImportId, b.lorebook.id)
		const held = async (
			table:
				| typeof schema.attributeValues
				| typeof schema.attributeConfigs
				| typeof schema.ownerSheets,
			kinds: string[],
			ids: number[]
		) =>
			(
				await testDb
					.select({ id: table.id })
					.from(table as any)
					.where(and(inArray(table.ownerKind, kinds), inArray(table.ownerId, ids)))
			).length
		for (const table of [
			schema.attributeValues,
			schema.attributeConfigs,
			schema.ownerSheets
		]) {
			expect(await held(table, ["location", "session_location"], [b.harbor.id])).toBe(0)
			expect(await held(table, ["cast_member"], [b.member.id])).toBe(0)
		}
		expect(await held(schema.ownerSheets, ["lorebook"], [b.lorebook.id])).toBe(0)
	})

	test("a book with none of them counts none", async () => {
		const b = await seedBook()
		const conflict = await conflictOf(b)
		expect(conflict.losses).toMatchObject({ sessionStats: 0, sheets: 0, sessionLoreRefs: 0 })
	})

	test("the user's characters the file rewrites by uuid are counted first", async () => {
		const b = await seedBook()
		const unchanged = await conflictOf(b)
		expect(unchanged.losses?.charactersRewritten).toBe(0)

		const file = await fileOf(b.lorebook.id, b.user.id)
		file.description = "Changed."
		const verity = file.extensions.serenepub.characters[0]
		expect(verity.card.data.name).toBe("Verity")
		verity.card.data.description = "A delver no longer."
		// Embedded twice, rewritten once.
		file.extensions.serenepub.characters.push({ ...verity, localId: 99 })
		const res = await importFile(b.user.id, file)
		expect(res.status).toBe("conflict")
		expect(res.conflict!.losses?.charactersRewritten).toBe(1)
	})
})

describe("an overwrite drops what sessions hold of the book's entries, and says so first", () => {
	test("an item carried and a place stood in are counted, then gone; the rest of a list stays", async () => {
		const b = await seedBook()
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const { ITEM_TYPE_ID } = await import("$lib/shared/entries/types")
		const [rope] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: ITEM_TYPE_ID,
					lorebookId: b.lorebook.id,
					position: 0,
					name: "Rope",
					keys: ["rope"],
					content: "Rope."
				} as any)
			)
			.returning()
		const [mira] = await testDb
			.insert(schema.characters)
			.values({ userId: b.user.id, name: "Mira", description: "A delver." })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: b.user.id, isGroup: false, name: "Delve", lorebookId: b.lorebook.id })
			.returning()
		// Mira carries the rope and a coin, and stands at the harbor; the
		// party are at the harbor too.
		await testDb.insert(schema.attributeValues).values([
			{
				ownerKind: "session_cast",
				ownerId: mira!.id,
				slotId: INVENTORY,
				value: { v: [{ entryId: rope!.id, count: 2 }, "a coin"] },
				sessionId: session!.id
			},
			{
				ownerKind: "session_cast",
				ownerId: mira!.id,
				slotId: LOCATION,
				value: { v: { entryId: b.harbor.id } },
				sessionId: session!.id
			},
			{
				ownerKind: "session",
				ownerId: session!.id,
				slotId: LOCATION,
				value: { v: { entryId: b.harbor.id } },
				sessionId: session!.id
			}
		])

		const conflict = await conflictOf(b)
		expect(conflict.losses).toMatchObject({ sessionLoreRefs: 3 })

		await overwrite(b.user.id, conflict.heldImportId, b.lorebook.id)
		const left = await testDb
			.select({
				ownerKind: schema.attributeValues.ownerKind,
				slotId: schema.attributeValues.slotId,
				value: schema.attributeValues.value
			})
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, session!.id))
		expect(left).toEqual([
			{ ownerKind: "session_cast", slotId: INVENTORY, value: { v: ["a coin"] } }
		])
	})
})

describe("an overwrite seats the cast of every session reading the book", () => {
	test("a character who joined after the file was written is a cast member again", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		file.description = "Changed."
		// Bram joined a session reading the book after the file was written,
		// and was seated in the cast then.
		const [bram] = await testDb
			.insert(schema.characters)
			.values({ userId: b.user.id, name: "Bram", description: "A sailor." })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: b.user.id, isGroup: false, name: "Voyage", lorebookId: b.lorebook.id })
			.returning()
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session!.id, characterId: bram!.id, position: 0 })
		await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: b.lorebook.id, binding: "{{char:3}}", characterId: bram!.id })

		const res = await importFile(b.user.id, file)
		expect(res.status).toBe("conflict")
		await overwrite(b.user.id, res.conflict!.heldImportId, b.lorebook.id)

		const seated = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, b.lorebook.id),
					eq(schema.lorebookBindings.characterId, bram!.id)
				)
			)
		expect(seated).toHaveLength(1)
	})
})

describe("an overwrite asks nothing of the sessions it seats", () => {
	test("a reading session's cast member with no card is not put to the person as a question", async () => {
		const b = await seedBook()
		const conflict = await conflictOf(b)
		for (const name of ["Run A", "Run B"])
			await testDb
				.insert(schema.sessions)
				.values({ userId: b.user.id, isGroup: false, name, lorebookId: b.lorebook.id })
		const { sent, emit } = recorder()
		await overwrite(b.user.id, conflict.heldImportId, b.lorebook.id, emit)
		expect(sent.map((s) => s.event)).not.toContain("bindingCheck:result")
	})
})

describe("an imported book is queued for its vectors and annotations", () => {
	test("a new book and an overwritten one, both", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-other-${n}`)
		const created = await importFile(other.id, file)
		expect(created.status).toBe("created")
		expect(enqueued.vectors).toContain(created.lorebook!.id)
		expect(enqueued.annotations).toContain(created.lorebook!.id)

		const conflict = await conflictOf(b)
		enqueued.vectors.length = 0
		enqueued.annotations.length = 0
		await overwrite(b.user.id, conflict.heldImportId, b.lorebook.id)
		expect(enqueued.vectors).toEqual([b.lorebook.id])
		expect(enqueued.annotations).toEqual([b.lorebook.id])
	})
})

describe("a failure after the book is saved is reported as a saved book", () => {
	test("create: the reply carries the book and names what did not finish", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-list-${n}`)
		const { sent, emit } = recorder()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		const list = failListRead()
		try {
			const res = await importFile(other.id, file, emit)
			expect(res.status).toBe("created")
			expect(res.lorebook?.name).toBe(b.lorebook.name)
			expect(res.warnings).toEqual([
				"The lorebook list could not be refreshed. Reload to see the new book."
			])
			expect(sent.map((s) => s.event)).not.toContain("lorebooks:import:error")
			expect(sent.find((s) => s.event === "lorebooks:import")?.data).toEqual(res)
		} finally {
			list.mockRestore()
			logged.mockRestore()
		}
	})

	test("overwrite: the same", async () => {
		const b = await seedBook()
		const conflict = await conflictOf(b)
		const { sent, emit } = recorder()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		const list = failListRead()
		try {
			const res = await overwrite(b.user.id, conflict.heldImportId, b.lorebook.id, emit)
			expect(res.lorebook.id).toBe(b.lorebook.id)
			expect(res.warnings).toEqual([
				"The lorebook list could not be refreshed. Reload to see the new book."
			])
			expect(sent.map((s) => s.event)).not.toContain("lorebooks:importResolve:error")
		} finally {
			list.mockRestore()
			logged.mockRestore()
		}
	})

	test("a book that could not be read back is named", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-readback-${n}`)
		// The read-back is the one read of the book with its cast attached.
		const findFirst = testDb.query.lorebooks.findFirst.bind(testDb.query.lorebooks)
		const spy = vi
			.spyOn(testDb.query.lorebooks, "findFirst")
			.mockImplementation(((args: any) =>
				args?.with?.lorebookBindings
					? Promise.reject(new Error("The read-back failed."))
					: findFirst(args)) as any)
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const res = await importFile(other.id, file)
			expect(res.status).toBe("created")
			expect(res.lorebook?.name).toBe(b.lorebook.name)
			expect(res.warnings).toEqual([
				"The lorebook was saved, but could not be read back. Reload to see it."
			])
		} finally {
			spy.mockRestore()
			logged.mockRestore()
		}
	})

	test("create: a cast name sync that fails after the save is a warning", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-sync-${n}`)
		const { sent, emit } = recorder()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		failing.castSync = true
		try {
			const res = await importFile(other.id, file, emit)
			expect(res.status).toBe("created")
			expect(res.warnings).toEqual([
				"The cast members' names were not updated from their character cards."
			])
			expect(sent.map((s) => s.event)).not.toContain("lorebooks:import:error")
		} finally {
			failing.castSync = false
			logged.mockRestore()
		}
	})

	test("overwrite: a cast name sync that fails after the save is a warning", async () => {
		const b = await seedBook()
		const conflict = await conflictOf(b)
		const { sent, emit } = recorder()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		failing.castSync = true
		try {
			const res = await overwrite(b.user.id, conflict.heldImportId, b.lorebook.id, emit)
			expect(res.lorebook.id).toBe(b.lorebook.id)
			expect(res.lorebook.description).toBe("Changed.")
			expect(res.warnings).toEqual([
				"The cast members' names were not updated from their character cards."
			])
			expect(sent.map((s) => s.event)).not.toContain("lorebooks:importResolve:error")
		} finally {
			failing.castSync = false
			logged.mockRestore()
		}
	})

	test("a link the file carries that could not be restored is named", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-link-${n}`)
		const insert = testDb.insert.bind(testDb)
		const spy = vi.spyOn(testDb, "insert").mockImplementation(((table: any) => {
			if (table === schema.narrativeRelationships)
				throw new Error("The link write failed.")
			return insert(table)
		}) as any)
		const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const res = await importFile(other.id, file)
			expect(res.status).toBe("created")
			expect(res.warnings).toEqual(["1 link from the file could not be restored."])
		} finally {
			spy.mockRestore()
			warned.mockRestore()
		}
	})

	test("a link whose ends the file does not carry, or that links an entry to itself, is counted", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const graph = file.extensions.serenepub.narrativeGraph
		const [link] = graph.relationships
		graph.relationships.push(
			{ ...link, to: { kind: "entry", entry: 999 } },
			{ ...link, to: link.from }
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-ends-${n}`)
		const res = await importFile(other.id, file)
		expect(res.status).toBe("created")
		expect(res.warnings).toEqual(["2 links from the file could not be restored."])
	})

	test("a link restored without the date or scene the file gave it is named", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const [link] = file.extensions.serenepub.narrativeGraph.relationships
		link.historyEntryLocalId = 999
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-undated-${n}`)
		const res = await importFile(other.id, file)
		expect(res.status).toBe("created")
		expect(res.warnings).toEqual([
			"1 link from the file was restored without its date or scene, which the file does not carry."
		])
	})
})

describe("the database's words never reach the person", () => {
	test("a driver error raised outside a query is a plain sentence", async () => {
		const b = await seedBook()
		const file = await fileOf(b.lorebook.id, b.user.id)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const other = await createTestUser(testDb, `import-finish-driver-${n}`)
		// What PGlite raises at COMMIT: no drizzle wrapper, a SQLSTATE and a
		// severity, and the constraint's name in the message.
		const driverError = Object.assign(
			new Error('duplicate key value violates unique constraint "lorebooks_uuid_idx"'),
			{ code: "23505", severity: "ERROR", constraint: "lorebooks_uuid_idx" }
		)
		const spy = vi.spyOn(testDb, "transaction").mockRejectedValueOnce(driverError)
		const { sent, emit } = recorder()
		try {
			await expect(importFile(other.id, file, emit)).rejects.toBe(driverError)
		} finally {
			spy.mockRestore()
		}
		const refusal = sent.find((s) => s.event === "lorebooks:import:error")
		expect(refusal?.data.error).toBe(
			"The lorebook could not be imported. The server log has the details."
		)
	})
})
