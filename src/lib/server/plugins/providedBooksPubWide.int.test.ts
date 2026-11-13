/**
 * 🚧 (m3-core, ★M3-1 "Pub wide", owner 2026-11-05) A live provided book (a plugin's, a primer row) is read by
 * every signed-in person as a shared book is: listed, read, attached; never written. A disabled or ownerless one
 * stays invisible to non-owners.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { LOREBOOK_NOT_FOUND } from "$lib/server/utils/ownedBook"
import { BOOK_LOCK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"
import { removedNodeDefinitionSentence } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db, getCryptoSecretKey: () => "pub-wide-test-secret" }
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
const db = () => testDb as unknown as Db
const noEmit = () => {}
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-pub-wide-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function call(handler: any, userId: number, params: unknown) {
	let error: any
	const res = await handler
		.handler(socket(userId), params, noEmit)
		.catch((e: unknown) => {
			error = e
		})
	return { res, error }
}

async function member() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `pubwide-member-${++n}`)
}

/** A plugin's provided book (own genuine mark, owner row present) with one entry. */
async function providedBook(
	opts: { disabled?: boolean; ownerless?: boolean; plugin?: string } = {}
) {
	const k = ++n
	const pluginId = opts.plugin ?? `acme.pubwide${k}`
	const admin = await testDb.query.users.findFirst({
		where: (u, { eq }) => eq(u.isAdmin, true),
		orderBy: (u, { asc }) => [asc(u.id)]
	})
	if (!opts.ownerless) {
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			version: "0.1.0",
			bundleSource: "",
			bundleHash: "x",
			enabled: true,
			manifest: {},
			adminDenied: []
		} as any)
	}
	const uuid = crypto.randomUUID()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: admin!.id,
			name: `Provided ${k}`,
			uuid,
			extraJson: {
				provided: {
					plugin: pluginId,
					slug: "world",
					version: "0.1.0",
					sha256: "x",
					uuid,
					entries: {},
					...(opts.disabled ? { disabled: true } : {})
				}
			}
		} as any)
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: 0,
			title: "Dragon",
			content: "v1 dragon",
			keys: ["dragon"],
			enabled: true
		} as any)
		.returning()
	return { book, entry, pluginId, admin: admin! }
}

const lore = (lorebookId: number) => ({
	typeId: WORLD_LORE_TYPE_ID,
	lorebookId,
	name: "Mine",
	content: "x",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	priority: 1
})

const doorFor = (userId: number) =>
	({ person: { userId, isAdmin: false, via: "press" } }) as any

async function createSession(userId: number, lorebookId?: number) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return call(sessionsCreateHandler, userId, {
		session: { name: "S", ...(lorebookId != null ? { lorebookId } : {}) },
		characterIds: [],
		personaIds: []
	})
}

describe("providedBooksReadableBy", () => {
	test("null user and an empty id list answer empty; a copy is not included", async () => {
		const { providedBooksReadableBy } = await import("./providedMarks")
		const p = await providedBook()
		expect([
			...(await providedBooksReadableBy(db(), null, [p.book.id]))
		]).toEqual([])
		expect([...(await providedBooksReadableBy(db(), undefined))]).toEqual(
			[]
		)
		const u = await member()
		expect([...(await providedBooksReadableBy(db(), u.id, []))]).toEqual([])
		expect(
			(await providedBooksReadableBy(db(), u.id, [p.book.id])).has(
				p.book.id
			)
		).toBe(true)
		expect((await providedBooksReadableBy(db(), u.id)).has(p.book.id)).toBe(
			true
		)
		// A copy carries the mark but not the uuid.
		const [copy] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: u.id,
				name: "Copy",
				extraJson: (p.book as any).extraJson
			} as any)
			.returning()
		expect(
			(await providedBooksReadableBy(db(), u.id, [copy.id])).has(copy.id)
		).toBe(false)
	})
})

describe("a live provided book is read pub-wide, never written", () => {
	test("listed, read, entries, applet door, attach, refused writes, session entries", async () => {
		const {
			lorebooksGetHandler,
			lorebooksUpdateHandler,
			lorebooksListHandler
		} = await import("$lib/server/sockets/lorebooks")
		const {
			entryListHandler,
			createEntryHandler,
			entrySessionEntriesHandler
		} = await import("$lib/server/sockets/entries")
		const { runLibraryLorebooks } = await import(
			"$lib/server/sockets/appletLibrary"
		)
		const { applyLibraryChange } = await import(
			"$lib/server/library/writes"
		)
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const { sessionLoreWriteMode, bookLoreWriteMode } = await import(
			"$lib/server/state/loreWriteMode"
		)
		const m = await member()
		const p = await providedBook()

		const list = await call(lorebooksListHandler, m.id, {})
		const row = (list.res as any).lorebookList.find(
			(b: any) => b.id === p.book.id
		)
		expect(row).toMatchObject({
			bookAccess: "shared",
			isSharedWithMe: true
		})
		expect(row.provided).toBeTruthy()
		// m3b-F: the row names its plugin by display name, not by id.
		await testDb
			.update(schema.plugins)
			.set({ name: "Mundi" })
			.where(eq(schema.plugins.pluginId, p.pluginId))
		const named = await call(lorebooksListHandler, m.id, {})
		expect(
			(named.res as any).lorebookList.find((b: any) => b.id === p.book.id)
				.provided
		).toEqual({ disabled: false, pluginName: "Mundi" })

		const got = await call(lorebooksGetHandler, m.id, { id: p.book.id })
		expect((got.res as any).lorebook).toMatchObject({
			id: p.book.id,
			bookAccess: "shared"
		})
		const entries = await call(entryListHandler, m.id, {
			lorebookId: p.book.id,
			typeId: WORLD_LORE_TYPE_ID
		})
		expect(entries.error).toBeUndefined()
		expect((entries.res as any).entryList.map((e: any) => e.id)).toEqual([
			p.entry.id
		])

		const door = await runLibraryLorebooks(doorFor(m.id), {})
		expect(door.rows.find((r) => r.id === p.book.id)).toMatchObject({
			canEdit: false
		})

		// Attach: only sessions:create. A later move is refused by the book
		// lock (★B-5, 2026-11-08) through sessions:update; the library's
		// attach-lorebook op no longer exists (★B-4), so it refuses in the
		// SDK's removal sentence.
		const created = await createSession(m.id, p.book.id)
		expect(created.error).toBeUndefined()
		expect(created.res.session.lorebookId).toBe(p.book.id)
		const plain = await createSession(m.id)
		expect(plain.error).toBeUndefined()
		const upd = await call(sessionsUpdateHandler, m.id, {
			session: { id: plain.res.session.id, lorebookId: p.book.id }
		})
		expect(upd.error?.message).toBe(BOOK_LOCK_REFUSAL)
		const third = await createSession(m.id)
		await expect(
			applyLibraryChange(db(), doorFor(m.id).person, "attach-lorebook" as never, {
				lorebookId: p.book.id,
				sessionId: third.res.session.id
			})
		).rejects.toThrow(removedNodeDefinitionSentence("core:outlet/attach-lorebook")!)

		// Not editable.
		const rename = await call(lorebooksUpdateHandler, m.id, {
			lorebook: { id: p.book.id, name: "Mine now" }
		})
		expect(rename.error?.message).toBe(LOREBOOK_NOT_FOUND)
		const add = await call(createEntryHandler, m.id, {
			entry: lore(p.book.id)
		})
		expect(add.error?.message).toBe(LOREBOOK_NOT_FOUND)

		// The member's session reads the entries; writes follow the book's mode.
		const se = await call(entrySessionEntriesHandler, m.id, {
			sessionId: created.res.session.id
		})
		expect((se.res as any).ownerOnly).toBeUndefined()
		expect(await sessionLoreWriteMode(db(), created.res.session.id)).toBe(
			await bookLoreWriteMode(db(), p.book.id)
		)
	})

	test("a disabled and an ownerless provided book stay invisible", async () => {
		const { lorebooksGetHandler, lorebooksListHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { runLibraryLorebooks } = await import(
			"$lib/server/sockets/appletLibrary"
		)
		const m = await member()
		const disabled = await providedBook({ disabled: true })
		const ownerless = await providedBook({ ownerless: true })
		const list = await call(lorebooksListHandler, m.id, {})
		for (const p of [disabled, ownerless]) {
			expect(
				(list.res as any).lorebookList.some(
					(b: any) => b.id === p.book.id
				)
			).toBe(false)
			const got = await call(lorebooksGetHandler, m.id, { id: p.book.id })
			expect((got.res as any).lorebook).toBeNull()
			const door = await runLibraryLorebooks(doorFor(m.id), {})
			expect(door.rows.some((r) => r.id === p.book.id)).toBe(false)
			const attach = await createSession(m.id, p.book.id)
			expect(attach.error?.message ?? attach.res?.error).toBeTruthy()
		}
	})
})

describe("a primer row", () => {
	test("is listed readOnly and read, but still never attached", async () => {
		const { syncProvidedPrimers } = await import("./providedPrimers")
		await syncProvidedPrimers(db(), { version: "1.0.0" })
		const { primerRowOf, kitIsNotReadSentence } = await import(
			"$lib/server/lorebooks/starterKits"
		)
		const { row } = (await primerRowOf(db(), VIS_PRIMER))!
		const m = await member()
		const { lorebooksGetHandler, lorebooksListHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const list = await call(lorebooksListHandler, m.id, {})
		const listed = (list.res as any).lorebookList.find(
			(b: any) => b.id === row.id
		)
		expect(listed).toMatchObject({ bookAccess: "shared" })
		expect(listed.readOnly).toBeTruthy()
		expect(listed.provided).toBeTruthy()
		// m3b-F: core's own primer comes with core, which is `null`.
		expect(listed.provided.pluginName).toBeNull()
		const got = await call(lorebooksGetHandler, m.id, { id: row.id })
		expect((got.res as any).lorebook).toMatchObject({
			id: row.id,
			bookAccess: "shared"
		})
		const attach = await createSession(m.id, row.id)
		expect(attach.error?.message ?? attach.res?.error).toBe(
			kitIsNotReadSentence(row.name)
		)
	})
})

describe("🚧 ★M3-core-1: a member's cast never lands in the provided book", () => {
	test("a member who seats their own character attaches the book and mints no binding row in it", async () => {
		const m = await member()
		const p = await providedBook()
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: m.id, name: "Mel", description: "A member's own card." } as never)
			.returning({ id: schema.characters.id })
		const before = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, p.book.id))
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const made = await call(sessionsCreateHandler, m.id, {
			session: { name: "S", lorebookId: p.book.id },
			characterIds: [card!.id],
			personaIds: []
		})
		expect(made.error).toBeUndefined()
		const after = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, p.book.id))
		expect(after.length).toBe(before.length)
	})
})
