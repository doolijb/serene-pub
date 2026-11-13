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
import { and, eq, inArray, isNull } from "drizzle-orm"
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

const shelf = async (userId: number) => {
	const { buildLorebooksList } = await import("$lib/server/sockets/lorebooks")
	return (await buildLorebooksList(userId)).lorebookList.map((r) => r.id)
}

describe("🚧 M2e: a provided book is disabled, never deleted", () => {
	test("delete is refused; disable hides it from the list but a reader keeps it; enable shows it; the pair works through the events", async () => {
		const { syncProvidedBooks, providedBooksOf } = await import("./providedBooks")
		const { lorebooksDeleteHandler, lorebooksGetHandler } = await import("$lib/server/sockets/lorebooks")
		const { pluginsDisableProvidedBook, pluginsEnableProvidedBook } = await import("$lib/server/sockets/plugins")
		const { PROVIDED_BOOK_DELETE_REFUSAL } = await import("./providedMarks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		expect((await syncProvidedBooks(testDb as any, pluginId)).imported).toEqual(["world"])
		const [book] = await provided(pluginId)
		const socket = { id: "s-admin", user: { id: admin.id, isAdmin: true } } as any
		const emitted: Array<[string, any]> = []
		const emit = (e: string, d: any) => void emitted.push([e, d])

		// Delete is refused, nothing goes.
		await expect(lorebooksDeleteHandler.handler(socket, { id: book.id } as any, emit as any)).rejects.toThrow(
			PROVIDED_BOOK_DELETE_REFUSAL
		)
		expect(await provided(pluginId)).toHaveLength(1)
		expect((await entriesOf(book.id)).size).toBe(3)
		expect(await shelf(admin.id)).toContain(book.id)
		const shown = (await (await import("$lib/server/sockets/lorebooks")).buildLorebooksList(admin.id)).lorebookList.find(
			(r) => r.id === book.id
		)
		// m3b-F (2026-11-05): the row also names the plugin it comes with.
		expect((shown as any).provided).toMatchObject({ disabled: false })
		expect(typeof (shown as any).provided.pluginName).toBe("string")

		// A non-admin cannot switch it.
		await expect(
			pluginsDisableProvidedBook.handler({ user: { id: admin.id, isAdmin: false } } as any, { pluginId, slug: "world" }, emit as any)
		).rejects.toThrow()

		// Disable: gone from the list, rows intact, still readable.
		const res = await pluginsDisableProvidedBook.handler(socket, { pluginId, slug: "world" }, emit as any)
		expect(res).toEqual({ pluginId, slug: "world", disabled: true, lorebookId: book.id })
		expect(await shelf(admin.id)).not.toContain(book.id)
		expect((await entriesOf(book.id)).size).toBe(3)
		await lorebooksGetHandler.handler(socket, { id: book.id } as any, emit as any)
		const got = emitted.filter(([e]) => e === "lorebooks:get").at(-1)![1]
		expect(got.lorebook.provided).toEqual({ disabled: true })
		const [row] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		expect((await providedBooksOf(testDb as any, row as any))[0]).toMatchObject({ state: "imported", disabled: true })
		// Still refused to delete while disabled.
		await expect(lorebooksDeleteHandler.handler(socket, { id: book.id } as any, emit as any)).rejects.toThrow()

		// Enable.
		const back = await pluginsEnableProvidedBook.handler(socket, { pluginId, slug: "world" }, emit as any)
		expect(back).toMatchObject({ disabled: false, lorebookId: book.id })
		expect(await shelf(admin.id)).toContain(book.id)
		expect(((await provided(pluginId))[0].extraJson as any).provided.disabled).toBeUndefined()
		// An unknown plugin is refused in a sentence.
		await expect(pluginsDisableProvidedBook.handler(socket, { pluginId: "nope", slug: "x" }, emit as any)).rejects.toThrow()
	}, 60_000)

	test("an upgrade still lands while disabled, and the book stays disabled", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled } = await import("./providedBooks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		await testDb.update(schema.lorebooks).set({ loreWriteMode: "full" }).where(eq(schema.lorebooks.id, book.id))
		await setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		await bump(pluginId, "0.2.0", V2(book.name))
		expect((await syncProvidedBooks(testDb as any, pluginId)).upgraded).toEqual(["world"])
		const [after] = await provided(pluginId)
		expect((await entriesOf(book.id)).get("Dragon")!.content).toBe("v2 dragon")
		expect((after.extraJson as any).provided).toMatchObject({ version: "0.2.0", disabled: true })
		expect(await shelf(admin.id)).not.toContain(book.id)
	}, 60_000)

	test("a slug disabled before it has a row lands disabled at its first import and the ledger entry is dropped", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled, providedBooksOf } = await import("./providedBooks")
		const { pluginId, admin, manifest } = await seedPlugin()
		const wait = await setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		expect(wait).toEqual({ lorebookId: null, owner: null })
		const [pre] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		expect((pre as any).provided.disabled.world).toBeTruthy()
		expect((await providedBooksOf(testDb as any, pre as any))[0]).toMatchObject({ disabled: true, state: "waiting" })
		await grant(pluginId, manifest)
		expect((await syncProvidedBooks(testDb as any, pluginId)).imported).toEqual(["world"])
		const [book] = await provided(pluginId)
		expect((book.extraJson as any).provided.disabled).toBe(true)
		expect(await shelf(admin.id)).not.toContain(book.id)
		const [post] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		expect((post as any).provided?.disabled?.world).toBeUndefined()
	}, 60_000)

	test("boot pass: a M2c tombstone becomes a disabled mark, the sync imports it disabled, and a second boot changes nothing", async () => {
		const { syncProvidedBooks, turnTombstonesIntoDisabled } = await import("./providedBooks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		const stamp = { at: "2026-11-01T00:00:00.000Z", by: admin.id, version: "0.1.0" }
		await testDb
			.update(schema.plugins)
			.set({ provided: { dismissed: { world: stamp }, failed: {} } as never })
			.where(eq(schema.plugins.pluginId, pluginId))
		const boot = async () => {
			await turnTombstonesIntoDisabled(testDb as any)
			await syncProvidedBooks(testDb as any, pluginId)
		}
		await boot()
		const books = await provided(pluginId)
		expect(books).toHaveLength(1)
		expect((books[0].extraJson as any).provided.disabled).toBe(true)
		const snap = async () => ({
			plugins: await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId)),
			books: await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, books[0].id)),
			count: (await provided(pluginId)).length
		})
		const [row] = (await snap()).plugins
		expect((row as any).provided.dismissed).toBeUndefined()
		expect((row as any).provided.disabled?.world).toBeUndefined()
		const first = await snap()
		await boot()
		expect(await snap()).toEqual(first)
		// A tombstone that has no book yet moves as-is, with its stamp.
		const other = await seedPlugin()
		await testDb
			.update(schema.plugins)
			.set({ provided: { dismissed: { world: stamp } } as never })
			.where(eq(schema.plugins.pluginId, other.pluginId))
		await turnTombstonesIntoDisabled(testDb as any)
		const [moved] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, other.pluginId))
		expect((moved as any).provided).toEqual({ disabled: { world: stamp } })
		const once = JSON.stringify(moved)
		await turnTombstonesIntoDisabled(testDb as any)
		expect(JSON.stringify((await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, other.pluginId)))[0])).toBe(once)
	}, 60_000)

	test("uninstall that keeps the books brings a disabled one back into view as an ordinary book", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled, clearDisabledOnKeptBooks } = await import("./providedBooks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		await setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		expect(await clearDisabledOnKeptBooks(testDb as any, pluginId)).toBe(1)
		expect(await shelf(admin.id)).toContain(book.id)
		// With the owner gone, it is no longer provided: Delete works.
		await testDb.delete(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		const { lorebooksDeleteHandler } = await import("$lib/server/sockets/lorebooks")
		const socket = { id: "s-admin", user: { id: admin.id, isAdmin: true } } as any
		await lorebooksDeleteHandler.handler(socket, { id: book.id } as any, (() => {}) as any)
		expect(await shelf(admin.id)).not.toContain(book.id)
	}, 60_000)

	test("a new attach of a disabled book is refused; a session already reading it keeps it", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled } = await import("./providedBooks")
		const { sessionsCreateHandler, sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: admin.id, name: "reads it", isGroup: false, lorebookId: book.id } as any)
			.returning()
		const socket = { id: "s-admin", user: { id: admin.id, isAdmin: true } } as any
		await setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		// A new attach (a session made onto it) is refused: the disabled book reads as absent.
		await expect(
			sessionsCreateHandler.handler(
				socket,
				{ session: { name: "new", lorebookId: book.id }, characterIds: [], personaIds: [] } as any,
				(() => {}) as any
			)
		).rejects.toThrow("Access denied. You can only read a lorebook you own into a session.")
		// Already reading it: naming it again is not a new attach, and the session keeps it.
		await sessionsUpdateHandler.handler(
			socket,
			{ session: { id: session.id, lorebookId: book.id } } as any,
			(() => {}) as any
		)
		const [now] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, session.id))
		expect(now.lorebookId).toBe(book.id)
	}, 60_000)

	test("switching a plugin's book: an ordinary book re-sends plugins:list only; its starter row also re-sends starterKits:list with the card disabled", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginsDisableProvidedBook, pluginsEnableProvidedBook } = await import("$lib/server/sockets/plugins")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const socket = { id: "s-admin", user: { id: admin.id, isAdmin: true }, emit: vi.fn() } as any
		const toggle = async (h: typeof pluginsDisableProvidedBook) => {
			const emitted: Array<[string, any]> = []
			await h.handler(socket, { pluginId, slug: "world" }, ((e: string, d: any) => void emitted.push([e, d])) as any)
			return emitted.map(([e]) => e)
		}
		const ordinary = await toggle(pluginsDisableProvidedBook)
		expect(ordinary).toContain("plugins:list")
		expect(ordinary).not.toContain("starterKits:list")
		await toggle(pluginsEnableProvidedBook)

		await testDb.update(schema.lorebooks).set({ kind: "starter_kit" }).where(eq(schema.lorebooks.id, book.id))
		const emitted: Array<[string, any]> = []
		await pluginsDisableProvidedBook.handler(
			socket,
			{ pluginId, slug: "world" },
			((e: string, d: any) => void emitted.push([e, d])) as any
		)
		expect(emitted.map(([e]) => e)).toContain("plugins:list")
		// The list carries the disabled rows, so it goes to the asking socket only.
		expect(emitted.map(([e]) => e)).not.toContain("starterKits:list")
		const call = socket.emit.mock.calls.find((c: any[]) => c[0] === "starterKits:list")!
		const card = call[1].kits.find((k: any) => k.provided?.pluginId === pluginId)
		expect(card.provided).toMatchObject({ pluginId, disabled: true })
	}, 60_000)

	test("setProvidedBookDisabled waits for the sync's turn, so an upgrade's stale mark cannot wipe the switch", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled, serial, saveMark } = await import("./providedBooks")
		const { markedBook } = await import("./providedMarks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		let release!: () => void
		const gate = new Promise<void>((r) => (release = r))
		let reads!: () => void
		const read = new Promise<void>((r) => (reads = r))
		const upgrade = serial(pluginId, async () => {
			const [b] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, book.id))
			const stale = markedBook(b.extraJson, b.uuid)!
			reads()
			await gate
			await saveMark(testDb as any, b, stale)
		})
		await read
		const switching = setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		release()
		await Promise.all([upgrade, switching])
		const [after] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, book.id))
		expect(markedBook(after.extraJson, after.uuid)?.disabled).toBe(true)
	}, 60_000)

	test("switching a shared book also pushes lorebooks:list to the people it is shared with", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginsDisableProvidedBook } = await import("$lib/server/sockets/plugins")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const member = await createTestUser(testDb as any, `provided-share-member-${n}`)
		await testDb.insert(schema.lorebookShares).values({ lorebookId: book.id, userId: member.id })
		const key = Symbol.for("serene-pub.userPush")
		const pushed: Array<[number, string]> = []
		;(globalThis as any)[key] = (userId: number, event: string) => void pushed.push([userId, event])
		try {
			const socket = { id: "s-admin", user: { id: admin.id, isAdmin: true }, emit: vi.fn() } as any
			await pluginsDisableProvidedBook.handler(socket, { pluginId, slug: "world" }, (() => {}) as any)
		} finally {
			delete (globalThis as any)[key]
		}
		const to = pushed.filter(([, e]) => e === "lorebooks:list").map(([u]) => u)
		expect(to).toEqual(expect.arrayContaining([book.userId, member.id]))
	}, 60_000)

	test("the applet library door and the jump search leave a disabled book out", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled } = await import("./providedBooks")
		const { runLibraryLorebooks } = await import("$lib/server/sockets/appletLibrary")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const door = { person: { userId: admin.id, isAdmin: true, via: "install", pluginId } } as any
		const ids = async () => (await runLibraryLorebooks(door, {} as any)).rows.map((r: any) => r.id)
		expect(await ids()).toContain(book.id)
		await setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		expect(await ids()).not.toContain(book.id)
	}, 60_000)

	test("a refused switch names its book on the :error event; the handler still rejects", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginsDisableProvidedBook, pluginsEnableProvidedBook } = await import("$lib/server/sockets/plugins")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const refuse = async (h: typeof pluginsDisableProvidedBook, user: any, sent: any) => {
			const emitted: Array<[string, any]> = []
			await expect(
				h.handler({ id: "s", user } as any, sent, ((e: string, d: any) => void emitted.push([e, d])) as any)
			).rejects.toThrow()
			return emitted
		}
		const sent = { pluginId, slug: "world" }
		const byNonAdmin = await refuse(pluginsDisableProvidedBook, { id: admin.id, isAdmin: false }, sent)
		expect(byNonAdmin).toEqual([["plugins:disableProvidedBook:error", { error: expect.any(String), ...sent }]])
		const unknown = { pluginId: "nope", slug: "x" }
		const byAdmin = await refuse(pluginsEnableProvidedBook, { id: admin.id, isAdmin: true }, unknown)
		expect(byAdmin).toEqual([["plugins:enableProvidedBook:error", { error: expect.any(String), ...unknown }]])
	}, 60_000)

	test("isNewAttachOfDisabledBook: absent, shown, disabled with no session, with another book, with this book", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled } = await import("./providedBooks")
		const { isNewAttachOfDisabledBook } = await import("./providedMarks")
		const { pluginId, admin, manifest } = await seedPlugin()
		await grant(pluginId, manifest)
		await syncProvidedBooks(testDb as any, pluginId)
		const [book] = await provided(pluginId)
		const [other] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: admin.id, name: "other" } as any)
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: admin.id, name: "reader", isGroup: false, lorebookId: other.id } as any)
			.returning()
		const db = testDb as any
		expect(await isNewAttachOfDisabledBook(db, 999_999_999, session.id)).toBe(false)
		expect(await isNewAttachOfDisabledBook(db, book.id, session.id)).toBe(false)
		await setProvidedBookDisabled(db, pluginId, "world", true, admin.id)
		expect(await isNewAttachOfDisabledBook(db, book.id)).toBe(true)
		expect(await isNewAttachOfDisabledBook(db, book.id, session.id)).toBe(true)
		await testDb.update(schema.sessions).set({ lorebookId: book.id }).where(eq(schema.sessions.id, session.id))
		expect(await isNewAttachOfDisabledBook(db, book.id, session.id)).toBe(false)
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

describe("provided books: a changed file at the same version re-imports", () => {
	/** The marked book row, every entry row, and the plugin's `provided` column: what a sync that did nothing must leave alone. */
	async function snapshot(pluginId: string, bookId: number) {
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, bookId))
		const entries = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
			.orderBy(schema.lorebookEntries.id)
		const [plugin] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		return { book, entries, pluginProvided: plugin.provided }
	}

	/** Import, then set the book's lore write mode. */
	async function importedWith(mode: "full" | "review" | "off") {
		const { syncProvidedBooks } = await import("./providedBooks")
		const seeded = await seedPlugin()
		await grant(seeded.pluginId, seeded.manifest)
		await syncProvidedBooks(testDb as any, seeded.pluginId)
		const [book] = await provided(seeded.pluginId)
		await testDb.update(schema.lorebooks).set({ loreWriteMode: mode }).where(eq(schema.lorebooks.id, book.id))
		return { ...seeded, book }
	}

	test("same version + changed content: new entry added, untouched rewritten, edited kept, reported and logged", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedWith("full")
		const markBefore = (book.extraJson as any).provided

		const before = await entriesOf(book.id)
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "my own elf" })
			.where(eq(schema.lorebookEntries.id, before.get("Elf")!.id))

		await putFile(pluginId, "0.1.0", V2(book.name)) // same version, no bump
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		try {
			const report = await syncProvidedBooks(testDb as any, pluginId)
			expect(report.reimported).toEqual(["world"])
			expect(report.upgraded).toContain("world")
			expect(report.held).toEqual([])
			expect(report.imported).toEqual([])
			expect(info).toHaveBeenCalledWith(
				`[plugins] '${pluginId}' provided book ${book.name}: its content changed (same version) — re-imported.`
			)
		} finally {
			info.mockRestore()
		}

		const after = await entriesOf(book.id)
		expect(after.get("Troll")!.content).toBe("v2 troll")
		expect(after.get("Dragon")!.content).toBe("v2 dragon")
		expect(after.get("Elf")!.content).toBe("my own elf")
		expect(after.get("Orc")!.content).toBe("v1 orc")

		const books = await provided(pluginId)
		expect(books).toHaveLength(1)
		const markAfter = (books[0].extraJson as any).provided
		expect(markAfter.version).toBe("0.1.0")
		expect(markAfter.sha256).not.toBe(markBefore.sha256)

		// The second boot changes nothing.
		const snap = await snapshot(pluginId, book.id)
		const again = await syncProvidedBooks(testDb as any, pluginId)
		expect([again.imported, again.upgraded, again.held, again.reimported]).toEqual([[], [], [], []])
		expect(await snapshot(pluginId, book.id)).toEqual(snap)
	}, 60_000)

	test("same version + same content: nothing is written", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedWith("full")
		const snap = await snapshot(pluginId, book.id)
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect([report.imported, report.upgraded, report.held, report.reimported]).toEqual([[], [], [], []])
		expect(await snapshot(pluginId, book.id)).toEqual(snap)
	}, 60_000)

	test("a newer version is unchanged: upgraded, never reported as re-imported", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedWith("full")
		await bump(pluginId, "0.2.0", V2(book.name))
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		try {
			const report = await syncProvidedBooks(testDb as any, pluginId)
			expect(report.upgraded).toEqual(["world"])
			expect(report.reimported).toEqual([])
			expect(info).not.toHaveBeenCalledWith(expect.stringContaining("its content changed (same version)"))
		} finally {
			info.mockRestore()
		}
	}, 60_000)

	test("a disabled book stays disabled, no second book is made, and the change lands (★34)", async () => {
		const { syncProvidedBooks, setProvidedBookDisabled } = await import("./providedBooks")
		const { pluginId, admin, book } = await importedWith("full")
		await setProvidedBookDisabled(testDb as any, pluginId, "world", true, admin.id)
		await putFile(pluginId, "0.1.0", V2(book.name))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.reimported).toEqual(["world"])
		const books = await provided(pluginId)
		expect(books).toHaveLength(1)
		expect((books[0].extraJson as any).provided.disabled).toBe(true)
		expect((await entriesOf(book.id)).get("Dragon")!.content).toBe("v2 dragon")
	}, 60_000)

	test.each(["review", "off"] as const)("under %s a changed file at the same version is held once and writes no entry", async (mode) => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedWith(mode)
		await putFile(pluginId, "0.1.0", V2(book.name))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.held).toEqual(["world"])
		expect(report.reimported).toEqual([])
		expect(report.upgraded).toEqual([])
		const after = await entriesOf(book.id)
		expect(after.get("Dragon")!.content).toBe("v1 dragon")
		expect(after.has("Troll")).toBe(false)
		expect(((await provided(pluginId))[0].extraJson as any).provided.held).toBeTruthy()

		const snap = await snapshot(pluginId, book.id)
		await syncProvidedBooks(testDb as any, pluginId)
		expect(await snapshot(pluginId, book.id)).toEqual(snap)
	}, 60_000)
})

describe("provided books: a changed file carries the cast, its bindings and the stat values", () => {
	const UA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const UB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	const UC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

	interface Member {
		uuid?: string
		name: string
		desc: string
		/** What the file's binding says beside the card. */
		own?: { ownName?: string; ownNickname?: string; spriteSet?: string }
	}
	interface Value {
		/** `book`, or the index of the member in the file. */
		owner: "book" | number
		slot: string
		v: unknown
		dated?: true
	}

	/** A card as the exporter writes it (every field), so a row that holds it unchanged hashes as the file's. */
	const card = (m: Member) => ({
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: {
			name: m.name,
			description: m.desc,
			personality: "",
			scenario: "",
			first_mes: "",
			mes_example: "",
			creator_notes: "",
			system_prompt: "",
			post_history_instructions: "",
			alternate_greetings: [],
			tags: [],
			creator: "",
			character_version: "",
			extensions: {
				depth_prompt: { prompt: "", depth: 4, role: "system" },
				serenepub: m.uuid ? { uuid: m.uuid } : {}
			}
		}
	})

	/** A format 2 book with a cast and stat values. */
	const castFile = (name: string, members: Member[], values: Value[]) =>
		JSON.stringify({
			name,
			description: "",
			entries: [entry(1, "Setting", "a place")],
			extensions: {
				serenepub: {
					formatVersion: 2,
					characters: members.map((m, i) => ({ localId: i + 1, card: card(m) })),
					personas: [],
					bindings: members.map((m, i) => ({
						localId: i + 1,
						bindingText: `{{char:${i + 1}}}`,
						kind: "character",
						characterLocalId: i + 1,
						personaLocalId: null,
						...(m.own ?? {})
					})),
					stats: {
						configs: [],
						values: values.map((x) =>
							x.owner === "book"
								? {
										ownerKind: "lorebook",
										slotId: x.slot,
										value: { v: x.v },
										historyEntryLocalId: null,
										sceneLocalId: null,
										updatedBy: "user",
										note: null
									}
								: {
										ownerKind: "cast_member",
										bindingLocalId: x.owner + 1,
										slotId: x.slot,
										value: { v: x.v },
										historyEntryLocalId: x.dated ? 99 : null,
										sceneLocalId: null,
										updatedBy: "user",
										note: null
									}
						)
					}
				}
			}
		})

	const A1: Member = { uuid: UA, name: "Ada", desc: "Ada v1" }
	const B1: Member = { uuid: UB, name: "Bo", desc: "Bo v1" }
	const RANK = "test:slot/rank@1"
	const AGE = "test:slot/age@1"
	const MOOD = "test:slot/mood@1"
	const ERA = "test:slot/era@1"

	const V1_VALUES: Value[] = [
		{ owner: "book", slot: ERA, v: "old" },
		{ owner: 0, slot: RANK, v: "novice" },
		{ owner: 1, slot: RANK, v: "adept" },
		{ owner: 1, slot: MOOD, v: "calm" }
	]

	/** A plugin whose package carries `text`, imported as an admin's book in the given write mode. */
	async function importedCast(text: string, mode: "full" | "review" = "full") {
		const { syncProvidedBooks } = await import("./providedBooks")
		const seeded = await seedPlugin()
		await putFile(seeded.pluginId, "0.1.0", text)
		await grant(seeded.pluginId, seeded.manifest)
		const first = await syncProvidedBooks(testDb as any, seeded.pluginId)
		expect(first.problems).toEqual([])
		const [book] = await provided(seeded.pluginId)
		await testDb.update(schema.lorebooks).set({ loreWriteMode: mode }).where(eq(schema.lorebooks.id, book.id))
		return { ...seeded, book }
	}

	const markOf = async (pluginId: string) => (await provided(pluginId))[0].extraJson as any

	/** The book's cast: each binding with its card, by the card's name. */
	async function castOf(bookId: number) {
		const rows = await testDb
			.select({ binding: schema.lorebookBindings, character: schema.characters })
			.from(schema.lorebookBindings)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.lorebookBindings.characterId))
			.where(eq(schema.lorebookBindings.lorebookId, bookId))
			.orderBy(schema.lorebookBindings.id)
		return new Map(rows.map((r) => [r.character?.name ?? r.binding.binding, r]))
	}

	/** The template-layer stat values of the book, its cast and nothing else, by `owner|slot`. */
	async function valuesOf(bookId: number) {
		const cast = await castOf(bookId)
		const names = new Map<number, string>([...cast].map(([n, r]) => [r.binding.id, n]))
		const rows = await testDb.select().from(schema.attributeValues).orderBy(schema.attributeValues.id)
		const out = new Map<string, (typeof rows)[number]>()
		for (const r of rows) {
			if (r.ownerKind === "lorebook" && r.ownerId === bookId) out.set(`book|${r.slotId}`, r)
			else if (r.ownerKind === "cast_member" && names.has(r.ownerId)) out.set(`${names.get(r.ownerId)}|${r.slotId}`, r)
		}
		return out
	}

	/** Everything a sync that did nothing must leave alone. */
	async function snapshot(pluginId: string, bookId: number) {
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, bookId))
		const entries = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
			.orderBy(schema.lorebookEntries.id)
		const bindings = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, bookId))
			.orderBy(schema.lorebookBindings.id)
		const ids = bindings.map((b) => b.characterId).filter((x): x is number => x != null)
		const characters = ids.length
			? await testDb.select().from(schema.characters).where(inArray(schema.characters.id, ids)).orderBy(schema.characters.id)
			: []
		const attributes = await testDb
			.select()
			.from(schema.attributeValues)
			.where(isNull(schema.attributeValues.sessionId))
			.orderBy(schema.attributeValues.id)
		const [plugin] = await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		return { book, entries, bindings, characters, attributes, pluginProvided: plugin.provided }
	}

	test("a fresh import records a baseline for every cast member and every stat value", async () => {
		const D: Member = { name: "Dee", desc: "no uuid" }
		const { pluginId, book } = await importedCast(castFile("Cast 1", [A1, B1, D], [...V1_VALUES, { owner: 2, slot: AGE, v: 7 }]))
		const mark = (await markOf(pluginId)).provided
		expect(Object.keys(mark.cast).sort()).toEqual([`n:Dee`, `u:${UA}`, `u:${UB}`].sort())
		expect(Object.keys(mark.stats).sort()).toEqual(
			[
				`lorebook|book|${ERA}`,
				`cast_member|u:${UA}|${RANK}`,
				`cast_member|u:${UB}|${RANK}`,
				`cast_member|u:${UB}|${MOOD}`,
				`cast_member|n:Dee|${AGE}`
			].sort()
		)
		const cast = await castOf(book.id)
		expect(cast.size).toBe(3)
		expect(mark.cast[`u:${UA}`]).toMatchObject({ binding: cast.get("Ada")!.binding.id, character: cast.get("Ada")!.character!.id })
		// The baseline is what the row holds: the stat's `hash` and `up` agree on a value just written.
		const values = await valuesOf(book.id)
		expect(mark.stats[`cast_member|u:${UA}|${RANK}`].id).toBe(values.get(`Ada|${RANK}`)!.id)
		expect(mark.stats[`cast_member|u:${UA}|${RANK}`].hash).toBe(mark.stats[`cast_member|u:${UA}|${RANK}`].up)
	}, 60_000)

	test("same version + changed file under Full: untouched updated, the person's kept, new added, gone left alone", async () => {
		const { markedCharacter } = await import("./providedMarks")
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedCast(castFile("Cast 2", [A1, B1], V1_VALUES))
		const before = await castOf(book.id)
		// Ada has a face: an upgrade that rewrites her card keeps it.
		const [face] = await testDb
			.insert(schema.files)
			.values({ userId: book.userId, kind: "image", hash: "w2-face" } as any)
			.returning()
		const { ensureCardVersion, updateCardVersion } = await import("$lib/server/characters/versions")
		const adaNow = await ensureCardVersion(testDb as any, before.get("Ada")!.character!.id)
		await updateCardVersion(testDb as any, adaNow!.id, { faceMediaId: face.id })

		// The person: edits Bo's card and Bo's rank.
		const boNow = await ensureCardVersion(testDb as any, before.get("Bo")!.character!.id)
		await updateCardVersion(testDb as any, boNow!.id, { description: "Bo mine" })
		const valuesBefore = await valuesOf(book.id)
		await testDb
			.update(schema.attributeValues)
			.set({ value: { v: "mine" } })
			.where(eq(schema.attributeValues.id, valuesBefore.get(`Bo|${RANK}`)!.id))

		const C: Member = { uuid: UC, name: "Cy", desc: "Cy v1" }
		await putFile(
			pluginId,
			"0.1.0",
			castFile(
				"Cast 2",
				[{ ...A1, desc: "Ada v2" }, { ...B1, desc: "Bo v2" }, C],
				[
					{ owner: "book", slot: ERA, v: "old" },
					{ owner: 0, slot: RANK, v: "master" }, // untouched, changed upstream
					{ owner: 1, slot: RANK, v: "grandmaster" }, // the person's, changed upstream
					{ owner: 1, slot: AGE, v: 33 }, // new for an existing member (the Age case)
					{ owner: 2, slot: RANK, v: "newbie" }, // a new member's
					{ owner: 0, slot: AGE, v: 99, dated: true } // dated: out of scope
					// Bo's mood is gone upstream
				]
			)
		)
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		let report: Awaited<ReturnType<typeof syncProvidedBooks>>
		try {
			report = await syncProvidedBooks(testDb as any, pluginId)
		} finally {
			info.mockRestore()
		}
		expect(report.problems).toEqual([])
		expect(report.reimported).toEqual(["world"])
		expect(report.keptEdited).toBe(2) // Bo's card and Bo's rank
		expect(report.goneUpstream).toBe(1) // Bo's mood

		const cast = await castOf(book.id)
		expect([...cast.keys()]).toEqual(["Ada", "Bo", "Cy"])
		expect(cast.get("Ada")!.character!.description).toBe("Ada v2")
		expect(cast.get("Ada")!.character!.avatarMediaId).toBe(face.id)
		expect(markedCharacter(cast.get("Ada")!.character!.extensions, cast.get("Ada")!.character!.uuid)?.plugin).toBe(pluginId)
		expect(cast.get("Bo")!.character!.description).toBe("Bo mine")
		// A new member: a card with the provided mark, a tag, and a name once synced.
		const cy = cast.get("Cy")!
		expect(markedCharacter(cy.character!.extensions, cy.character!.uuid)).toMatchObject({ plugin: pluginId, slug: "world" })
		expect(cy.character!.uuid).toBe(UC)
		expect(cy.binding.binding).toMatch(/^\{\{char:\d+\}\}$/)
		expect(cy.binding.name).toBe("Cy")
		expect(new Set([...cast.values()].map((r) => r.binding.binding)).size).toBe(3)

		const values = await valuesOf(book.id)
		expect(values.get(`Ada|${RANK}`)!.value).toEqual({ v: "master" })
		expect(values.get(`Bo|${RANK}`)!.value).toEqual({ v: "mine" })
		expect(values.get(`Bo|${AGE}`)!.value).toEqual({ v: 33 })
		expect(values.get(`Cy|${RANK}`)!.value).toEqual({ v: "newbie" })
		expect(values.get(`Bo|${MOOD}`)!.value).toEqual({ v: "calm" })
		expect(values.get(`book|${ERA}`)!.value).toEqual({ v: "old" })
		expect(values.has(`Ada|${AGE}`)).toBe(false)
		for (const r of values.values()) {
			expect(r.sessionId).toBeNull()
			expect(r.historyEntryId).toBeNull()
		}

		// Baselines moved with the writes: a later sync finds nothing to do.
		const mark = (await markOf(pluginId)).provided
		expect(Object.keys(mark.cast).sort()).toEqual([`u:${UA}`, `u:${UB}`, `u:${UC}`].sort())
		const snap = await snapshot(pluginId, book.id)
		const again = await syncProvidedBooks(testDb as any, pluginId)
		expect([again.imported, again.upgraded, again.held, again.reimported]).toEqual([[], [], [], []])
		expect(await snapshot(pluginId, book.id)).toEqual(snap)
	}, 60_000)

	test("a book imported before cast was carried: new members and values come in, a differing value is kept, matches get baselines", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedCast(castFile("Cast 3", [A1, B1], V1_VALUES))
		// An old pub's book: its mark has no cast and no stats.
		const stored = (await markOf(pluginId)).provided
		const { cast: _c, stats: _s, ...old } = stored
		await testDb
			.update(schema.lorebooks)
			.set({ extraJson: { ...(book.extraJson as object), provided: old } })
			.where(eq(schema.lorebooks.id, book.id))
		expect((await markOf(pluginId)).provided.cast).toBeUndefined()

		const C: Member = { uuid: UC, name: "Cy", desc: "Cy v1" }
		await putFile(
			pluginId,
			"0.1.0",
			castFile(
				"Cast 3",
				[A1, B1, C],
				[
					{ owner: "book", slot: ERA, v: "old" },
					{ owner: 0, slot: RANK, v: "novice" }, // matches what is held
					{ owner: 1, slot: RANK, v: "grandmaster" }, // differs from what is held, no baseline
					{ owner: 1, slot: MOOD, v: "calm" },
					{ owner: 0, slot: AGE, v: 24 }, // new
					{ owner: 2, slot: AGE, v: 5 } // a new member's
				]
			)
		)
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		let report: Awaited<ReturnType<typeof syncProvidedBooks>>
		try {
			report = await syncProvidedBooks(testDb as any, pluginId)
		} finally {
			info.mockRestore()
		}
		expect(report.problems).toEqual([])
		expect(report.keptEdited).toBe(1) // Bo's rank

		const cast = await castOf(book.id)
		expect([...cast.keys()]).toEqual(["Ada", "Bo", "Cy"]) // nobody twice
		const values = await valuesOf(book.id)
		expect(values.get(`Bo|${RANK}`)!.value).toEqual({ v: "adept" })
		expect(values.get(`Ada|${AGE}`)!.value).toEqual({ v: 24 })
		expect(values.get(`Cy|${AGE}`)!.value).toEqual({ v: 5 })

		const mark = (await markOf(pluginId)).provided
		expect(Object.keys(mark.cast).sort()).toEqual([`u:${UA}`, `u:${UB}`, `u:${UC}`].sort())
		expect(mark.stats[`cast_member|u:${UA}|${RANK}`]).toBeTruthy() // matched: a baseline
		expect(mark.stats[`lorebook|book|${ERA}`]).toBeTruthy()
		expect(mark.stats[`cast_member|u:${UB}|${RANK}`]).toBeUndefined() // differed: stays the person's
		expect(mark.stats[`cast_member|u:${UA}|${AGE}`]).toBeTruthy() // added
	}, 60_000)

	test("a second sync after an upgrade writes nothing", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedCast(castFile("Cast 4", [A1, B1], V1_VALUES))
		await putFile(
			pluginId,
			"0.1.0",
			castFile(
				"Cast 4",
				[{ ...A1, desc: "Ada v2" }, B1, { uuid: UC, name: "Cy", desc: "Cy v1" }],
				[...V1_VALUES, { owner: 2, slot: AGE, v: 5 }]
			)
		)
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		try {
			const report = await syncProvidedBooks(testDb as any, pluginId)
			expect(report.upgraded).toEqual(["world"])
		} finally {
			info.mockRestore()
		}
		const snap = await snapshot(pluginId, book.id)
		const again = await syncProvidedBooks(testDb as any, pluginId)
		expect([again.imported, again.upgraded, again.held, again.reimported]).toEqual([[], [], [], []])
		expect(await snapshot(pluginId, book.id)).toEqual(snap)
	}, 60_000)

	/** A card's versions, lowest number first. */
	const versionsOfCard = (cardId: number) =>
		testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, cardId))
			.orderBy(schema.characterVersions.number)

	/** A cast member's base version (the main line, undated, no life point). */
	async function baseOfMember(memberId: number) {
		const V = schema.characterVersions
		const [base] = await testDb
			.select()
			.from(V)
			.where(and(eq(V.castMemberId, memberId), isNull(V.branchId), isNull(V.year), isNull(V.personalPosition), isNull(V.sourceSessionId)))
			.orderBy(V.id)
		return base
	}

	const ADA_OWN = { ownName: "Captain Ada", ownNickname: "", spriteSet: "ada-set" }

	test("a fresh import makes a v1 for each card and a base for each member, and records the file's own hash", async () => {
		const { pluginId, book } = await importedCast(castFile("Cast 5", [{ ...A1, own: ADA_OWN }, B1], V1_VALUES))
		const cast = await castOf(book.id)
		const ada = cast.get("Captain Ada") ?? cast.get("Ada")!
		for (const name of ["Ada", "Bo"]) {
			const { binding, character } = cast.get(name)!
			const versions = await versionsOfCard(character!.id)
			expect(versions.map((v) => v.number)).toEqual([1])
			const base = await baseOfMember(binding.id)
			expect(base.parentVersionId).toBe(versions[0].id)
		}
		// Ada's binding values are the base's: an own name, an own EMPTY nickname, a sprite set.
		const adaBase = await baseOfMember(ada.binding.id)
		expect(adaBase).toMatchObject({ name: "Captain Ada", nickname: null, spriteSet: "ada-set" })
		expect(adaBase.follows).not.toContain("name")
		expect(adaBase.follows).not.toContain("nickname")
		const boBase = await baseOfMember(cast.get("Bo")!.binding.id)
		expect(boBase.follows).toEqual(expect.arrayContaining(["name", "nickname"]))
		// What the row holds now hashes to what the file's member hashed to, in both shapes.
		const mark = (await markOf(pluginId)).provided
		for (const key of [`u:${UA}`, `u:${UB}`]) expect(mark.cast[key].hash).toBe(mark.cast[key].up)
	}, 60_000)

	test("a member with no base yet (a lift straggler) hashes from its binding columns, the same value", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedCast(castFile("Cast 6", [{ ...A1, own: ADA_OWN }, B1], V1_VALUES))
		const cast = await castOf(book.id)
		const ada = cast.get("Captain Ada") ?? cast.get("Ada")!
		await testDb.delete(schema.characterVersions).where(eq(schema.characterVersions.castMemberId, ada.binding.id))
		await putFile(pluginId, "0.1.0", castFile("Cast 6", [{ ...A1, desc: "Ada v2", own: ADA_OWN }, B1], V1_VALUES))
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		let report: Awaited<ReturnType<typeof syncProvidedBooks>>
		try {
			report = await syncProvidedBooks(testDb as any, pluginId)
		} finally {
			info.mockRestore()
		}
		expect(report.problems).toEqual([])
		expect(report.keptEdited).toBe(0) // unedited: not read as the person's
		expect((await versionsOfCard(ada.character!.id)).map((v) => v.number)).toEqual([1, 2])
	}, 60_000)

	test("an edit to a member's sprite set still reads as the person's", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { writeCastVersion } = await import("$lib/server/characters/versions")
		const { pluginId, book } = await importedCast(castFile("Cast 7", [{ ...A1, own: ADA_OWN }, B1], V1_VALUES))
		const cast = await castOf(book.id)
		const ada = cast.get("Captain Ada") ?? cast.get("Ada")!
		await writeCastVersion(testDb as any, {
			member: ada.binding.id,
			changes: { spriteSet: "mine" },
			writtenBy: `user:${book.userId}`,
			at: { branchId: null, date: null, personalPosition: null }
		})
		await putFile(pluginId, "0.1.0", castFile("Cast 7", [{ ...A1, desc: "Ada v2", own: ADA_OWN }, B1], V1_VALUES))
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		let report: Awaited<ReturnType<typeof syncProvidedBooks>>
		try {
			report = await syncProvidedBooks(testDb as any, pluginId)
		} finally {
			info.mockRestore()
		}
		expect(report.keptEdited).toBe(1)
		expect((await versionsOfCard(ada.character!.id)).map((v) => v.number)).toEqual([1])
		expect((await baseOfMember(ada.binding.id)).spriteSet).toBe("mine")
	}, 60_000)

	test("an upgrade adds a card version, leaves every member pinned to the one it had (unedited too) and writes the file's own values to the base", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { ensureCardVersion, updateCardVersion } = await import("$lib/server/characters/versions")
		const { pluginId, book } = await importedCast(castFile("Cast 8", [{ ...A1, own: ADA_OWN }, B1], V1_VALUES))
		const before = await castOf(book.id)
		const adaBefore = before.get("Captain Ada") ?? before.get("Ada")!
		const bo = before.get("Bo")!
		const boNow = await ensureCardVersion(testDb as any, bo.character!.id)
		await updateCardVersion(testDb as any, boNow!.id, { description: "Bo mine" })
		const frozen = adaBefore.binding

		await putFile(
			pluginId,
			"0.1.0",
			castFile(
				"Cast 8",
				// Ada: new card text; the file drops her own name, gives her a nickname and another sprite set.
				[{ ...A1, desc: "Ada v2", own: { ownNickname: "Add", spriteSet: "ada-set-2" } }, { ...B1, desc: "Bo v2" }, { uuid: UC, name: "Cy", desc: "Cy v1", own: { ownName: "Cyrus" } }],
				V1_VALUES
			)
		)
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		let report: Awaited<ReturnType<typeof syncProvidedBooks>>
		try {
			report = await syncProvidedBooks(testDb as any, pluginId)
		} finally {
			info.mockRestore()
		}
		expect(report.problems).toEqual([])
		expect(report.keptEdited).toBe(1) // Bo's card

		const adaVersions = await versionsOfCard(adaBefore.character!.id)
		expect(adaVersions.map((v) => v.number)).toEqual([1, 2])
		expect(adaVersions[1].description).toBe("Ada v2")
		const adaBase = await baseOfMember(adaBefore.binding.id)
		expect(adaBase.parentVersionId).toBe(adaVersions[0].id) // stays pinned: the person gets the Update offer
		expect(adaBase.follows).toContain("name") // own name gone from the file: follows the card again
		expect(adaBase.follows).not.toContain("nickname")
		expect(adaBase).toMatchObject({ nickname: "Add", spriteSet: "ada-set-2" })

		// A member new in the file: a card with a v1, and a member with a base that reads it.
		const cy = (await castOf(book.id)).get("Cy")!
		const cyVersions = await versionsOfCard(cy.character!.id)
		expect(cyVersions.map((v) => v.number)).toEqual([1])
		const cyBase = await baseOfMember(cy.binding.id)
		expect(cyBase.parentVersionId).toBe(cyVersions[0].id)
		expect(cyBase).toMatchObject({ name: "Cyrus" })
		expect(cyBase.follows).not.toContain("name")

		// Bo was edited: no new version, still on v1.
		const boVersions = await versionsOfCard(bo.character!.id)
		expect(boVersions.map((v) => v.number)).toEqual([1])
		expect((await baseOfMember(bo.binding.id)).parentVersionId).toBe(boVersions[0].id)

		// The binding's frozen columns were not written.
		const [row] = await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, frozen.id))
		expect([row.spriteSet, row.ownName, row.ownNickname]).toEqual([frozen.spriteSet, frozen.ownName, frozen.ownNickname])

		// The recorded baselines moved with the writes: the next sync finds nothing to do.
		const snap = await snapshot(pluginId, book.id)
		const again = await syncProvidedBooks(testDb as any, pluginId)
		expect([again.imported, again.upgraded, again.held, again.reimported]).toEqual([[], [], [], []])
		expect(await snapshot(pluginId, book.id)).toEqual(snap)

		// A second upgrade: Ada's recorded hash still says "unedited", so she is still the plugin's.
		await putFile(
			pluginId,
			"0.1.0",
			castFile(
				"Cast 8",
				[{ ...A1, desc: "Ada v3", own: { ownNickname: "Add", spriteSet: "ada-set-3" } }, { ...B1, desc: "Bo v2" }, { uuid: UC, name: "Cy", desc: "Cy v1", own: { ownName: "Cyrus" } }],
				V1_VALUES
			)
		)
		const info2 = vi.spyOn(console, "info").mockImplementation(() => {})
		let second: Awaited<ReturnType<typeof syncProvidedBooks>>
		try {
			second = await syncProvidedBooks(testDb as any, pluginId)
		} finally {
			info2.mockRestore()
		}
		expect(second.keptEdited).toBe(1) // Bo's card only
		expect((await versionsOfCard(adaBefore.character!.id)).map((v) => v.number)).toEqual([1, 2, 3])
		const adaBase2 = await baseOfMember(adaBefore.binding.id)
		expect(adaBase2.spriteSet).toBe("ada-set-3")
		expect(adaBase2.parentVersionId).toBe(adaVersions[0].id)
	}, 60_000)

	test("a recorded card-less member that the file now gives a card reads it: its versions name the card's v1", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		// v1: the member has no card in the file.
		const cardless = JSON.parse(castFile("Cast 9", [A1], []))
		cardless.extensions.serenepub.characters = []
		cardless.extensions.serenepub.bindings[0].characterLocalId = null
		const { pluginId, book } = await importedCast(JSON.stringify(cardless))
		const [member] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(member.characterId).toBeNull()
		expect((await baseOfMember(member.id)).parentVersionId).toBeNull()
		// The record knows it by its binding text; v2 keys the same member by the card's uuid, so
		// the record is moved onto that key (a member the file names by key and holds without its card).
		const extra = await markOf(pluginId)
		const key = Object.keys(extra.provided.cast)[0]
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...extra,
					provided: { ...extra.provided, cast: { [`u:${UA}`]: extra.provided.cast[key] } }
				} as any
			})
			.where(eq(schema.lorebooks.id, book.id))

		await putFile(pluginId, "0.1.0", castFile("Cast 9", [{ ...A1, desc: "Ada v2" }], []))
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		try {
			const report = await syncProvidedBooks(testDb as any, pluginId)
			expect(report.problems).toEqual([])
		} finally {
			info.mockRestore()
		}
		const [after] = await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, member.id))
		expect(after.characterId).not.toBeNull()
		const versions = await versionsOfCard(after.characterId!)
		expect(versions.map((v) => v.number)).toEqual([1])
		const base = await baseOfMember(member.id)
		expect(base.parentVersionId).toBe(versions[0].id)
		expect(base.follows).toContain("description")
		const read = await memberAsRead(testDb as any, member.id)
		expect(read!.cardless).toBe(false)
		expect(read!.description).toBe("Ada v2")
	}, 60_000)

	test("a recorded card-less member that the file now gives a card reads it from the book's present on", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		// v1: the member has no card in the file.
		const cardless = JSON.parse(castFile("Cast 9c", [A1], []))
		cardless.extensions.serenepub.characters = []
		cardless.extensions.serenepub.bindings[0].characterLocalId = null
		const { pluginId, book } = await importedCast(JSON.stringify(cardless))
		const [member] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(member.characterId).toBeNull()
		expect((await baseOfMember(member.id)).parentVersionId).toBeNull()
		// The record knows it by its binding text; v2 keys the same member by the card's uuid, so
		// the record is moved onto that key (a member the file names by key and holds without its card).
		const extra = await markOf(pluginId)
		const key = Object.keys(extra.provided.cast)[0]
		await testDb
			.update(schema.lorebooks)
			.set({
				storyClockYear: 100,
				extraJson: {
					...extra,
					provided: { ...extra.provided, cast: { [`u:${UA}`]: extra.provided.cast[key] } }
				} as any
			})
			.where(eq(schema.lorebooks.id, book.id))

		await putFile(pluginId, "0.1.0", castFile("Cast 9c", [{ ...A1, desc: "Ada v2" }], []))
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		try {
			const report = await syncProvidedBooks(testDb as any, pluginId)
			expect(report.problems).toEqual([])
		} finally {
			info.mockRestore()
		}
		const [after] = await testDb.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, member.id))
		expect(after.characterId).not.toBeNull()
		const versions = await versionsOfCard(after.characterId!)
		expect(versions.map((v) => v.number)).toEqual([1])
		const base = await baseOfMember(member.id)
		expect(base.parentVersionId).toBeNull()
		const [carrier] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(
				and(
					eq(schema.characterVersions.castMemberId, member.id),
					eq(schema.characterVersions.year, 100),
					isNull(schema.characterVersions.branchId)
				)
			)
		expect(carrier.parentVersionId).toBe(versions[0].id)
		expect(carrier.follows).toContain("description")
	}, 60_000)

	test("under Review a changed file writes no binding, no card and no stat value", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book } = await importedCast(castFile("Cast 5", [A1, B1], V1_VALUES), "review")
		await putFile(
			pluginId,
			"0.1.0",
			castFile(
				"Cast 5",
				[{ ...A1, desc: "Ada v2" }, B1, { uuid: UC, name: "Cy", desc: "Cy v1" }],
				[...V1_VALUES, { owner: 2, slot: AGE, v: 5 }, { owner: 0, slot: AGE, v: 24 }]
			)
		)
		const snap = await snapshot(pluginId, book.id)
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.held).toEqual(["world"])
		expect(report.upgraded).toEqual([])
		const after = await snapshot(pluginId, book.id)
		expect(after.bindings).toEqual(snap.bindings)
		expect(after.characters).toEqual(snap.characters)
		expect(after.attributes).toEqual(snap.attributes)
		expect(after.entries).toEqual(snap.entries)
	}, 60_000)
})

describe("provided books: the book's rules follow the file, the person wins", () => {
	const VIS = "core:ruleset/vis-itineris@1"
	// A person's own choice, written straight to the row: it needs no registration.
	const HOLLOW = "core:ruleset/hollow@1"
	const FREEFORM = "core:ruleset/freeform@1"
	const NONESUCH = "core:ruleset/nonesuch@1"

	/** A book file, naming rules when given; `dragon` varies the content so a file's sha256 can differ with the same rules. */
	const ruled = (name: string, primaryRuleset?: string, dragon = "v1 dragon") =>
		JSON.stringify({
			name,
			description: "",
			entries: [entry(1, "Dragon", dragon)],
			...(primaryRuleset ? { extensions: { serenepub: { primaryRuleset } } } : {})
		})

	const stored = async (id: number) =>
		(await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, id)))[0]
	const markOf = async (id: number) => (((await stored(id)).extraJson as any).provided ?? {}) as any
	const rulesOf = async (id: number) => {
		const b = await stored(id)
		return { primaryRuleset: b.primaryRuleset, rulesetVersion: b.rulesetVersion }
	}

	/** Import a book whose file is `first`, then set its lore write mode. */
	async function importedRuled(first: (name: string) => string, mode: "full" | "review" = "full") {
		const { syncProvidedBooks } = await import("./providedBooks")
		const seeded = await seedPlugin()
		const name = `Ruled ${n}`
		await putFile(seeded.pluginId, "0.1.0", first(name))
		await grant(seeded.pluginId, seeded.manifest)
		const report = await syncProvidedBooks(testDb as any, seeded.pluginId)
		const [book] = await provided(seeded.pluginId)
		await testDb.update(schema.lorebooks).set({ loreWriteMode: mode }).where(eq(schema.lorebooks.id, book.id))
		return { ...seeded, book, name, report }
	}

	test("a fresh import of a file naming rules lands on them, and the mark records them", async () => {
		const { book } = await importedRuled((name) => ruled(name, VIS))
		expect(await rulesOf(book.id)).toEqual({ primaryRuleset: VIS, rulesetVersion: null })
		expect((await markOf(book.id)).rules).toEqual({ primaryRuleset: VIS, rulesetVersion: null })
	}, 60_000)

	test("a changed file naming other rules moves an untouched book, and a second sync writes nothing", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book, name } = await importedRuled((name) => ruled(name, VIS))
		await putFile(pluginId, "0.1.0", ruled(name, FREEFORM, "v2 dragon"))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.upgraded).toEqual(["world"])
		expect(await rulesOf(book.id)).toEqual({ primaryRuleset: FREEFORM, rulesetVersion: null })
		expect((await markOf(book.id)).rules).toEqual({ primaryRuleset: FREEFORM, rulesetVersion: null })

		const snap = await stored(book.id)
		const again = await syncProvidedBooks(testDb as any, pluginId)
		expect([again.imported, again.upgraded, again.held, again.reimported]).toEqual([[], [], [], []])
		expect(await stored(book.id)).toEqual(snap)
	}, 60_000)

	test("rules a person set are kept when the file changes", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book, name } = await importedRuled((name) => ruled(name, VIS))
		await testDb.update(schema.lorebooks).set({ primaryRuleset: HOLLOW }).where(eq(schema.lorebooks.id, book.id))
		await putFile(pluginId, "0.1.0", ruled(name, FREEFORM, "v2 dragon"))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.upgraded).toEqual(["world"])
		expect(report.keptEdited).toBeGreaterThanOrEqual(1)
		expect(await rulesOf(book.id)).toEqual({ primaryRuleset: HOLLOW, rulesetVersion: null })
		expect((await markOf(book.id)).rules).toEqual({ primaryRuleset: VIS, rulesetVersion: null })
	}, 60_000)

	test("a book imported before rules were carried: a default is untouched and follows the file, anything else is the person's", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		// Default rules, no baseline → the file's rules apply.
		const a = await importedRuled((name) => ruled(name))
		expect("rules" in (await markOf(a.book.id))).toBe(true) // recorded at import (Freeform)
		await testDb
			.update(schema.lorebooks)
			.set({ extraJson: { ...(a.book.extraJson as object), provided: { ...(await markOf(a.book.id)), rules: undefined } } })
			.where(eq(schema.lorebooks.id, a.book.id))
		expect("rules" in (await markOf(a.book.id))).toBe(false)
		await putFile(a.pluginId, "0.1.0", ruled(a.name, VIS, "v2 dragon"))
		await syncProvidedBooks(testDb as any, a.pluginId)
		expect(await rulesOf(a.book.id)).toEqual({ primaryRuleset: VIS, rulesetVersion: null })
		expect((await markOf(a.book.id)).rules).toEqual({ primaryRuleset: VIS, rulesetVersion: null })

		// A non-default value, no baseline → kept.
		const b = await importedRuled((name) => ruled(name))
		await testDb
			.update(schema.lorebooks)
			.set({
				primaryRuleset: HOLLOW,
				extraJson: { ...(b.book.extraJson as object), provided: { ...(await markOf(b.book.id)), rules: undefined } }
			})
			.where(eq(schema.lorebooks.id, b.book.id))
		await putFile(b.pluginId, "0.1.0", ruled(b.name, VIS, "v2 dragon"))
		const report = await syncProvidedBooks(testDb as any, b.pluginId)
		expect(report.keptEdited).toBeGreaterThanOrEqual(1)
		expect(await rulesOf(b.book.id)).toEqual({ primaryRuleset: HOLLOW, rulesetVersion: null })
		expect("rules" in (await markOf(b.book.id))).toBe(false)
	}, 60_000)

	test("a file naming rules this pub lacks imports on Freeform, and the sentence reaches the report and the log", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const seeded = await seedPlugin()
		const name = `Ruled ${n}`
		await putFile(seeded.pluginId, "0.1.0", ruled(name, NONESUCH))
		await grant(seeded.pluginId, seeded.manifest)
		const info = vi.spyOn(console, "info").mockImplementation(() => {})
		try {
			const report = await syncProvidedBooks(testDb as any, seeded.pluginId)
			const sentence = `${name} plays ${NONESUCH}, which this pub doesn't have — imported on Freeform.`
			expect(report.warnings).toEqual([sentence])
			expect(info).toHaveBeenCalledWith(`[plugins] '${seeded.pluginId}' provided book world: ${sentence}`)
		} finally {
			info.mockRestore()
		}
		const [book] = await provided(seeded.pluginId)
		expect(await rulesOf(book.id)).toEqual({ primaryRuleset: FREEFORM, rulesetVersion: null })
	}, 60_000)

	test("under Review a changed file naming other rules leaves the rules alone", async () => {
		const { syncProvidedBooks } = await import("./providedBooks")
		const { pluginId, book, name } = await importedRuled((name) => ruled(name, VIS), "review")
		await putFile(pluginId, "0.1.0", ruled(name, FREEFORM, "v2 dragon"))
		const report = await syncProvidedBooks(testDb as any, pluginId)
		expect(report.held).toEqual(["world"])
		expect(await rulesOf(book.id)).toEqual({ primaryRuleset: VIS, rulesetVersion: null })
		expect((await markOf(book.id)).rules).toEqual({ primaryRuleset: VIS, rulesetVersion: null })
	}, 60_000)
})

describe("deleteProvidedBooks — a provided card's followers (★27-6)", () => {
	test("a member in a person's own book following a provided card keeps its words", async () => {
		const { deleteProvidedBooks } = await import("./providedBooks")
		const { insertCard, insertCastMember } = await import("$lib/server/characters/versions")
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const { pluginId, admin } = await seedPlugin()
		const { card } = await insertCard(testDb as any, {
			userId: admin.id,
			name: "Provided Pia",
			description: "Pia keeps bees."
		})
		await testDb
			.update(schema.characters)
			.set({
				extensions: { serenepub: { provided: { plugin: pluginId, slug: "pia", version: "1", uuid: card.uuid } } }
			})
			.where(eq(schema.characters.id, card.id))
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: admin.id, name: "My own book" })
			.returning()
		const { member, base } = await insertCastMember(testDb as any, {
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:pia}}",
			name: ""
		})
		expect(base!.follows).toEqual(expect.arrayContaining(["name", "description"]))
		const before = (await membersAsRead(testDb as any, [member.id])).get(member.id)!
		expect(before.description).toBe("Pia keeps bees.")

		const gone = await deleteProvidedBooks(testDb as any, pluginId)
		expect(gone.characters).toBe(1)
		const [row] = await testDb.select().from(schema.characters).where(eq(schema.characters.id, card.id))
		expect(row.isDeleted).toBe(true)
		const [version] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, base!.id))
		expect(version.follows).toEqual([])
		expect(version.name).toBe("Provided Pia")
		expect(version.description).toBe("Pia keeps bees.")
		const after = (await membersAsRead(testDb as any, [member.id])).get(member.id)!
		expect(after.name).toBe(before.name)
		expect(after.description).toBe(before.description)
	}, 60_000)
})
