/**
 * 🚧 (M2c) Provided books: a plugin's `provides.lorebooks`, imported by core's
 * own importer once the plugin is on and `applet:lorebooks:write` is in force.
 *
 * Covers: nothing before the grant; one import at the grant; a second sync is a
 * no-op; a version bump under Full rewrites an untouched entry, keeps a
 * person-edited one, adds a new one and leaves a vanished one; under Review and
 * Off nothing is written and the newer version is held; uninstall keep/delete
 * (a copy of a book is never a provided book); and a person's update cannot
 * mint or move the mark.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-provided-books-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const entry = (id: number, name: string, content: string) => ({
	id,
	name,
	comment: name,
	keys: [name.toLowerCase()],
	content,
	enabled: true,
	extensions: {}
})
const bookFile = (name: string, entries: unknown[]) =>
	JSON.stringify({ name, description: "", entries })

const V1 = (name: string) =>
	bookFile(name, [entry(1, "Dragon", "v1 dragon"), entry(2, "Elf", "v1 elf"), entry(3, "Orc", "v1 orc")])
const V2 = (name: string) =>
	bookFile(name, [entry(1, "Dragon", "v2 dragon"), entry(2, "Elf", "v2 elf"), entry(4, "Troll", "v2 troll")])

let n = 0

/** A plugin row (off, ungranted) with its version-1 package on disk, and an admin who "enabled" it. */
async function seedPlugin() {
	const k = ++n
	const pluginId = `acme.books${k}`
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username: `provided-admin-${k}`, isAdmin: true })
		.returning()
	const manifest = {
		assets: { dir: "assets" },
		provides: { lorebooks: ["assets/books/world.lorebook.json"] },
		permissions: ["applet:lorebooks:write"]
	}
	await testDb.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "0.1.0",
		bundleSource: "",
		bundleHash: "x",
		enabled: false,
		enabledBy: admin.id,
		manifest,
		adminDenied: []
	} as any)
	await putFile(pluginId, "0.1.0", V1(`World ${k}`))
	return { pluginId, admin, manifest }
}

async function putFile(pluginId: string, version: string, text: string) {
	const { pluginPackageDirOf } = await import("./packageDir")
	const dir = path.join(dataDir, pluginPackageDirOf(pluginId, version), "assets/books")
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(path.join(dir, "world.lorebook.json"), text)
}

/** Switch on and approve: the review marker an admin's Approve writes. */
async function grant(pluginId: string, manifest: any) {
	const { declaredPermissions, reviewMarks } = await import("./permissions")
	await testDb
		.update(schema.plugins)
		.set({ enabled: true, adminDenied: reviewMarks(declaredPermissions(manifest)) })
		.where(eq(schema.plugins.pluginId, pluginId))
}

async function bump(pluginId: string, version: string, text: string) {
	await putFile(pluginId, version, text)
	await testDb.update(schema.plugins).set({ version }).where(eq(schema.plugins.pluginId, pluginId))
}

async function provided(pluginId: string) {
	const { markedBook } = await import("./providedMarks")
	const books = await testDb.select().from(schema.lorebooks)
	return books.filter((b) => markedBook(b.extraJson, b.uuid)?.plugin === pluginId)
}

async function entriesOf(lorebookId: number) {
	const rows = await testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	return new Map(rows.map((r) => [r.title, r]))
}

describe("🚧 M2c: a provided book an administrator deletes by hand", () => {
	test("stays deleted: the next sync skips it, the plugin page says so; another plugin's sync is untouched", async () => {
		const { syncProvidedBooks, providedBooksOf } = await import("./providedBooks")
		const { lorebooksDeleteHandler } = await import("$lib/server/sockets/lorebooks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		expect((await syncProvidedBooks(testDb as any, pluginId)).imported).toEqual(["world"])
		const [book] = await provided(pluginId)
		const socket = { id: "s-admin", user: { id: admin.id, isAdmin: true } } as any
		await lorebooksDeleteHandler.handler(socket, { id: book.id } as any, () => {})
		expect(await provided(pluginId)).toHaveLength(0)
		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		expect((row as any).provided.dismissed.world).toMatchObject({ by: admin.id, version: "0.1.0" })
		const again = await syncProvidedBooks(testDb as any, pluginId)
		expect(again.imported).toEqual([])
		expect(again.dismissed).toEqual(["world"])
		expect(await provided(pluginId)).toHaveLength(0)
		// A version bump does not bring it back either.
		await bump(pluginId, "0.2.0", V2("World again"))
		expect((await syncProvidedBooks(testDb as any, pluginId)).imported).toEqual([])
		const [after] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		expect((await providedBooksOf(testDb as any, after as any)).map((b) => b.state)).toEqual(["dismissed"])
		// Another plugin's book still imports.
		const other = await seedPlugin()
		await grant(other.pluginId, other.manifest)
		expect((await syncProvidedBooks(testDb as any, other.pluginId)).imported).toEqual(["world"])
	}, 60_000)
})

describe("provided books", () => {
	test("nothing before the grant; one import after; a second sync is a no-op", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, admin, manifest } = await seedPlugin()

		// Off and unapproved: nothing.
		await syncProvidedBooks(testDb as any, pluginId)
		expect(await provided(pluginId)).toHaveLength(0)
		// On but not approved: still nothing.
		await testDb.update(schema.plugins).set({ enabled: true }).where(eq(schema.plugins.pluginId, pluginId))
		await syncProvidedBooks(testDb as any, pluginId)
		expect(await provided(pluginId)).toHaveLength(0)

		await grant(pluginId, manifest)
		const first = await syncProvidedBooks(testDb as any, pluginId)
		expect(first.imported).toEqual(["world"])
		const [book] = await provided(pluginId)
		expect(book.userId).toBe(admin.id)
		expect((await entriesOf(book.id)).size).toBe(3)

		const second = await syncProvidedBooks(testDb as any, pluginId)
		expect(second.imported).toEqual([])
		expect(second.upgraded).toEqual([])
		expect(await provided(pluginId)).toHaveLength(1)
		expect((await entriesOf(book.id)).size).toBe(3)
	})

	test("a version bump under Full: untouched rewritten, edited kept, new added, vanished left", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		await testDb.update(schema.lorebooks).set({ loreWriteMode: "full" }).where(eq(schema.lorebooks.id, book.id))

		// The person edits Elf.
		const before = await entriesOf(book.id)
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "my own elf" })
			.where(eq(schema.lorebookEntries.id, before.get("Elf")!.id))

		await bump(pluginId, "0.2.0", V2(book.name))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.upgraded).toEqual(["world"])
		expect(report.keptEdited).toBe(1)
		expect(report.goneUpstream).toBe(1)

		const after = await entriesOf(book.id)
		expect(after.get("Dragon")!.content).toBe("v2 dragon")
		expect(after.get("Elf")!.content).toBe("my own elf")
		expect(after.get("Troll")!.content).toBe("v2 troll")
		expect(after.get("Orc")!.content).toBe("v1 orc")

		const [marked] = await provided(pluginId)
		expect((marked.extraJson as any).provided.version).toBe("0.2.0")
		// Same version again: nothing.
		expect((await syncProvidedBooks(testDb as any, pluginId)).upgraded).toEqual([])
	})

	test.each(["review", "off"] as const)("a version bump under %s writes nothing and is held", async (mode) => {
		const { syncProvidedBooks, providedBooksOf } = await import("./providedBooks")
		const { pluginId, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		await testDb.update(schema.lorebooks).set({ loreWriteMode: mode }).where(eq(schema.lorebooks.id, book.id))

		await bump(pluginId, "0.2.0", V2(book.name))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.held).toEqual(["world"])
		const after = await entriesOf(book.id)
		expect(after.get("Dragon")!.content).toBe("v1 dragon")
		expect(after.has("Troll")).toBe(false)

		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		const listed = await providedBooksOf(testDb as any, row)
		expect(listed[0]).toMatchObject({ state: "held", lorebookId: book.id })
		expect(listed[0].why).toContain("0.2.0")
	})

	test("the page lists a book as waiting before approval", async () => {
		const { providedBooksOf } = await import("./providedBooks")
		const { pluginId } = await seedPlugin()
		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		const listed = await providedBooksOf(testDb as any, row)
		expect(listed).toEqual([
			expect.objectContaining({ slug: "world", lorebookId: null, state: "waiting" })
		])
		expect(listed[0].why).toMatch(/Switch the plugin on/)
	})

	test("uninstall keeps by default, deletes on request, and never touches a copy", async () => {
		const { syncProvidedBooks, deleteProvidedBooks } = await import("./providedBooks")
		const { duplicateLorebookRows } = await import("$lib/server/utils/lorebookDuplicate")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const copy = await testDb.transaction((tx) => duplicateLorebookRows(tx as any, book.id, admin.id, "My copy"))

		// Keep (the default): the uninstall socket calls nothing, the book stays.
		expect(await provided(pluginId)).toHaveLength(1)

		// Delete: the marked book goes; the copy is the person's.
		const gone = await deleteProvidedBooks(testDb as any, pluginId)
		expect(gone.books).toBe(1)
		expect(await provided(pluginId)).toHaveLength(0)
		const left = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, copy.id))
		expect(left).toHaveLength(1)
	})

	test("a person's update cannot mint or move the mark", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { lorebooksUpdateHandler } = await import("$lib/server/sockets/lorebooks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const stored = (book.extraJson as any).provided

		await lorebooksUpdateHandler.handler(
			{ user: { id: admin.id } } as any,
			{
				lorebook: {
					id: book.id,
					name: "Renamed",
					extraJson: { provided: { plugin: "someone.else", slug: "x", version: "9", uuid: book.uuid } }
				}
			} as any,
			() => {}
		)
		const [after] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, book.id))
		expect(after.name).toBe("Renamed")
		expect((after.extraJson as any).provided).toEqual(stored)
	})

	test("marks: a mark only counts on the row it names; a save keeps the stored one", async () => {
		const { markedBook, markedCharacter, keepStoredProvidedMark, withoutProvidedMark } = await import("./providedMarks")
		const uuid = "11111111-1111-4111-8111-111111111111"
		const mark = { plugin: "a.b", slug: "w", version: "1", sha256: "", uuid, entries: {} }
		expect(markedBook({ provided: mark }, uuid)?.plugin).toBe("a.b")
		expect(markedBook({ provided: mark }, "22222222-2222-4222-8222-222222222222")).toBeNull()
		expect(markedCharacter({ serenepub: { provided: { plugin: "a.b", slug: "w", uuid } } }, uuid)?.slug).toBe("w")

		const stored = { serenepub: { provided: { plugin: "a.b", slug: "w", version: "1", uuid } } }
		const sent = { serenepub: { provided: { plugin: "evil", slug: "x", uuid }, timbre: {} } }
		expect((keepStoredProvidedMark(sent, stored) as any).serenepub.provided.plugin).toBe("a.b")
		expect((keepStoredProvidedMark(sent, {}) as any).serenepub.provided).toBeUndefined()
		expect((withoutProvidedMark(sent) as any).serenepub.timbre).toEqual({})
	})
})

describe("🚧 M2c fix: a provided book that uses the package's OWN ruleset entry type", () => {
	/** A package ruleset `desk` with an entry type `keepsake`, published as the install does — rows only, nothing registered or synced. */
	async function shipRuleset(pluginId: string) {
		const { _withdrawRuleset, defineRuleset, rulesetDocumentOf } = await import("@serene-pub/sdk")
		const id = `${pluginId}:ruleset/desk@1`
		const decl = defineRuleset(id as never, {
			name: { en: "Desk" },
			attributes: [],
			entryTypes: [{ id: "keepsake", name: { en: "Keepsake" }, holders: ["cast"], fields: { worth: { type: "number" } }, prose: "A keepsake." }]
		} as never)
		const doc = rulesetDocumentOf(decl, "1.0.0")
		_withdrawRuleset(id as never)
		const { publishPluginRulesets } = await import("./pluginRulesets")
		const r = await publishPluginRulesets(testDb as never, pluginId, { rulesets: [doc] } as never)
		expect(r.refused).toEqual([])
		return `${pluginId}:entry/desk.keepsake`
	}
	const typed = (id: number, name: string, content: string, type: string, worth: number) => ({
		...entry(id, name, content),
		extensions: { serenepub: { entryType: `${type}@1`, worth } }
	})

	test("live enable imports it typed; an upgrade re-imports it typed; an undeclared type is refused out loud, never world lore", async () => {
		const { syncProvidedBooks, providedBooksOf } = await import("./providedBooks")
		const { pluginId, manifest } = await seedPlugin()
		const KEEPSAKE = await shipRuleset(pluginId)
		const before = await testDb
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, KEEPSAKE))
		expect(before).toHaveLength(0) // what E saw: no row for the FK to point at
		await putFile(
			pluginId,
			"0.1.0",
			bookFile("Desk", [
				entry(1, "Lamp", "v1 lamp"),
				typed(2, "Locket", "v1 locket", KEEPSAKE, 3),
				typed(3, "Ghost", "never lands", `${pluginId}:entry/desk.unknown`, 1)
			])
		)
		await grant(pluginId, manifest)
		const first = await syncProvidedBooks(testDb as any, pluginId)
		expect(first.problems).toEqual([])
		expect(first.imported).toEqual(["world"])
		const [book] = await provided(pluginId)
		let rows = await entriesOf(book.id)
		expect(rows.get("Locket")?.typeId).toBe(KEEPSAKE)
		expect((rows.get("Locket")?.fields as any)?.worth).toBe(3)
		// Refused, not demoted: no world-lore "Ghost", and the page names it.
		expect(rows.has("Ghost")).toBe(false)
		let [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		let page = await providedBooksOf(testDb as any, row as any)
		expect(page[0]!.state).toBe("imported")
		expect(page[0]!.why).toMatch(/One entry was not imported: 'Ghost': its type .*desk\.unknown is declared by no ruleset/)

		// The upgrade re-imports the typed entry typed (an untouched entry under Full is rewritten).
		await bump(
			pluginId,
			"0.2.0",
			bookFile("Desk", [entry(1, "Lamp", "v2 lamp"), typed(2, "Locket", "v2 locket", KEEPSAKE, 5)])
		)
		const second = await syncProvidedBooks(testDb as any, pluginId)
		expect(second.problems).toEqual([])
		expect(second.upgraded).toEqual(["world"])
		rows = await entriesOf(book.id)
		expect(rows.get("Locket")?.typeId).toBe(KEEPSAKE)
		expect(rows.get("Locket")?.content).toBe("v2 locket")
		;[row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		page = await providedBooksOf(testDb as any, row as any)
		expect(page[0]).toMatchObject({ state: "imported", version: "0.2.0" })
		expect(page[0]!.why).toBeUndefined() // the refusal cleared with a clean upgrade
	}, 90_000)

	test("a failed import says it failed on the plugin page, not 'waiting for approval'", async () => {
		const { syncProvidedBooks, providedBooksOf } = await import("./providedBooks")
		const { pluginId, manifest } = await seedPlugin()
		await putFile(pluginId, "0.1.0", "{ this is not a lorebook")
		await grant(pluginId, manifest)
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.imported).toEqual([])
		expect(report.problems.length).toBeGreaterThan(0)
		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		const [b] = await providedBooksOf(testDb as any, row as any)
		expect(b!.state).toBe("failed")
		expect(b!.why).toMatch(/^The import failed: /)
		expect(b!.why).not.toMatch(/Waiting for approval/)
	}, 60_000)
})
