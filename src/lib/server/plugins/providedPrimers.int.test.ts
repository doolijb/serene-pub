/**
 * 🚧 (M2e, ★M2e-1) Provided primers: core's primers imported at boot as
 * immutable `starter_kit` rows, idempotent, upgraded as a diff, hidden with
 * the provided-book Disable/Enable, read by the Starter lorebook list, and
 * cloned (never lent) when a person starts from one.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
		getCryptoSecretKey: () => "provided-primers-test-secret"
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
let preClone: { id: number; entries: number }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-provided-primers-")
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
	member = (await createTestUser(testDb, "primers-member")).id
	// A clone a person made before the rows existed: a separate row, no mark.
	const { bookFromKit, resolveKit } = await import(
		"$lib/server/lorebooks/starterKits"
	)
	const kit = await resolveKit(db(), { primerId: VIS_PRIMER })
	expect(kit.source).toBe("primer")
	const copy = await testDb.transaction((tx) =>
		bookFromKit(tx as unknown as Db, kit, {
			userId: adminId,
			name: "Brackenvale (copy)",
			kind: "starter_kit"
		})
	)
	preClone = {
		id: copy.lorebookId,
		entries: (await entriesOf(copy.lorebookId)).length
	}
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function entriesOf(lorebookId: number) {
	return testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
}
async function bookRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, id))
	return row
}
async function primerRow(id = VIS_PRIMER) {
	const { primerRowOf } = await import("$lib/server/lorebooks/starterKits")
	const found = await primerRowOf(db(), id)
	return found!
}
async function snapshot() {
	const books = await testDb
		.select()
		.from(schema.lorebooks)
		.orderBy(schema.lorebooks.id)
	const entries = await testDb
		.select()
		.from(schema.lorebookEntries)
		.orderBy(schema.lorebookEntries.id)
	const chars = await testDb
		.select()
		.from(schema.characters)
		.orderBy(schema.characters.id)
	const binds = await testDb
		.select()
		.from(schema.lorebookBindings)
		.orderBy(schema.lorebookBindings.id)
	return {
		books: books.map((b) => [b.id, b.name, b.extraJson]),
		entries: entries.map((e) => [e.id, e.lorebookId, e.title, e.content]),
		chars: chars.map((c) => [c.id, c.extensions]),
		binds: binds.length
	}
}

describe("the import", () => {
	test("a fresh DB gains one genuine core row per shipped primer, owned by the first admin", async () => {
		const { syncProvidedPrimers } = await import("./providedPrimers")
		const { shippedKits } = await import(
			"$lib/server/lorebooks/starterKits"
		)
		const { markedBook } = await import("./providedMarks")
		const report = await syncProvidedPrimers(db(), { version: "1.0.0" })
		expect(report.problems).toEqual([])
		const kits = shippedKits()
		expect(report.imported.sort()).toEqual(kits.map((k) => k.id).sort())
		for (const k of kits) {
			const { row, mark } = await primerRow(k.id)
			expect(row).toMatchObject({
				kind: "starter_kit",
				userId: adminId,
				sessionId: null
			})
			expect(mark).toMatchObject({
				plugin: "core",
				slug: k.id,
				version: "1.0.0"
			})
			expect(markedBook(row.extraJson, row.uuid)).not.toBeNull()
			const placed = Object.keys(mark.entries).length
			expect(placed).toBe(
				k.content.entries.length +
					k.content.places.length +
					k.content.leads.length
			)
			expect((await entriesOf(row.id)).length).toBeGreaterThanOrEqual(
				placed
			)
		}
	})

	test("a primer's row has card-less members (S4, plan §34.2): no card, its words its own", async () => {
		const { row } = await primerRow()
		const bound = await testDb
			.select({
				characterId: schema.lorebookBindings.characterId,
				name: schema.lorebookBindings.name
			})
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, row.id))
		expect(bound.length).toBe(7)
		expect(bound.every((b) => b.characterId === null)).toBe(true)
		expect(bound.every((b) => b.name)).toBe(true)
	})

	test("a second sync changes nothing (rows, marks, entries, cards)", async () => {
		const { syncProvidedPrimers } = await import("./providedPrimers")
		const before = await snapshot()
		const report = await syncProvidedPrimers(db(), { version: "1.0.0" })
		expect(report).toEqual({ imported: [], upgraded: [], problems: [] })
		expect(await snapshot()).toEqual(before)
	})

	test("a clone made before the rows existed is a separate row, untouched", async () => {
		const row = await bookRow(preClone.id)
		expect((row.extraJson as any)?.provided).toBeUndefined()
		expect((await entriesOf(preClone.id)).length).toBe(preClone.entries)
		const { starterKitCards } = await import(
			"$lib/server/lorebooks/starterKits"
		)
		const cards = await starterKitCards(db(), member)
		expect(cards.find((c) => c.id === `book:${preClone.id}`)).toMatchObject(
			{ source: "admin", mine: false }
		)
	})

	test("no admin: nothing is written, and the next sync (once one exists) imports", async () => {
		const { syncProvidedPrimers } = await import("./providedPrimers")
		await testDb
			.update(schema.users)
			.set({ isAdmin: false })
			.where(eq(schema.users.id, adminId))
		try {
			// Rows exist already; remove one to see the import wait.
			const { row } = await primerRow("core:primer/vis-itineris@1")
			await testDb
				.update(schema.lorebooks)
				.set({ extraJson: {} })
				.where(eq(schema.lorebooks.id, row.id))
			const report = await syncProvidedPrimers(db(), { version: "1.0.0" })
			expect(report.imported).toEqual([])
			expect(report.problems.length).toBe(1)
		} finally {
			await testDb
				.update(schema.users)
				.set({ isAdmin: true })
				.where(eq(schema.users.id, adminId))
		}
		const report = await syncProvidedPrimers(db(), { version: "1.0.0" })
		expect(report.imported).toEqual([VIS_PRIMER])
	})
})

describe("the list, disable and enable", () => {
	test("the list reads the rows: book ids, a provided field, no mine or owner name", async () => {
		const { starterKitCards, shippedKits } = await import(
			"$lib/server/lorebooks/starterKits"
		)
		const cards = await starterKitCards(db(), member)
		expect(cards.some((c) => c.id.startsWith("primer:"))).toBe(false)
		const vis = cards.find((c) => c.provided?.slug === VIS_PRIMER)!
		expect(vis).toMatchObject({
			source: "core",
			name: "Brackenvale",
			counts: { places: 10, cast: 7 },
			provided: { pluginId: "core", slug: VIS_PRIMER, disabled: false }
		})
		expect(vis.id).toMatch(/^book:\d+$/)
		expect(vis.mine).toBeUndefined()
		expect(vis.ownerName).toBeUndefined()
		expect(cards.filter((c) => c.provided).length).toBe(
			shippedKits().length
		)
	})

	test("the owner admin lists a primer row in their lorebooks with provided present", async () => {
		const { buildLorebooksList } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { row } = await primerRow()
		const list: any = await buildLorebooksList(adminId)
		const mine = list.lorebookList.find((b: any) => b.id === row.id)
		expect(mine).toMatchObject({
			kind: "starter_kit",
			provided: { disabled: false }
		})
	})

	test("disable hides it from a person, an admin with includeDisabled still sees it; enable brings it back", async () => {
		const { setProvidedBookDisabled } = await import("./providedBooks")
		const { starterKitCards, resolveKit, STARTER_KIT_SENTENCES } =
			await import("$lib/server/lorebooks/starterKits")
		const { row } = await primerRow()
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, true, adminId)
		const person = await starterKitCards(db(), member)
		expect(person.some((c) => c.provided?.slug === VIS_PRIMER)).toBe(false)
		// Not back from the catalogue either.
		expect(person.some((c) => c.id === `primer:${VIS_PRIMER}`)).toBe(false)
		const admin = await starterKitCards(db(), adminId, {
			includeDisabled: true
		})
		expect(
			admin.find((c) => c.provided?.slug === VIS_PRIMER)?.provided
				?.disabled
		).toBe(true)
		await expect(resolveKit(db(), { lorebookId: row.id })).rejects.toThrow(
			STARTER_KIT_SENTENCES.unknown
		)
		await expect(
			resolveKit(db(), { primerId: VIS_PRIMER })
		).rejects.toThrow(STARTER_KIT_SENTENCES.unknown)
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, false, adminId)
		expect(
			(await starterKitCards(db(), member)).some(
				(c) => c.provided?.slug === VIS_PRIMER
			)
		).toBe(true)
	})

	test("a list with the disabled rows goes to the asking socket only; the plain list goes to the user", async () => {
		const { setProvidedBookDisabled } = await import("./providedBooks")
		const { starterKitsListHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, true, adminId)
		try {
			const run = async (s: any, params: any) => {
				const toUser = vi.fn()
				await starterKitsListHandler.handler(s, params, toUser as any)
				return toUser
			}
			const admin = socket(adminId, true)
			const adminUser = await run(admin, { includeDisabled: true })
			expect(adminUser).not.toHaveBeenCalled()
			expect(admin.emit).toHaveBeenCalledTimes(1)
			const [ev, sent] = admin.emit.mock.calls[0]
			expect(ev).toBe("starterKits:list")
			expect(sent.kits.some((c: any) => c.provided?.slug === VIS_PRIMER)).toBe(true)

			const plainAdmin = socket(adminId, true)
			const plainUser = await run(plainAdmin, {})
			expect(plainAdmin.emit).not.toHaveBeenCalled()
			expect(plainUser).toHaveBeenCalledWith("starterKits:list", expect.anything())

			const asMember = socket(member)
			const memberUser = await run(asMember, { includeDisabled: true })
			expect(asMember.emit).not.toHaveBeenCalled()
			const [, memberSent] = memberUser.mock.calls[0]
			expect(memberUser.mock.calls[0][0]).toBe("starterKits:list")
			expect(memberSent.kits.some((c: any) => c.provided?.slug === VIS_PRIMER)).toBe(false)
		} finally {
			await setProvidedBookDisabled(db(), "core", VIS_PRIMER, false, adminId)
		}
	})

	test("starterKits:list honours includeDisabled for admins only", async () => {
		const { setProvidedBookDisabled } = await import("./providedBooks")
		const { starterKitsListHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, true, adminId)
		try {
			const asMember: any = await starterKitsListHandler.handler(
				socket(member),
				{ includeDisabled: true },
				quiet
			)
			expect(
				asMember.kits.some((c: any) => c.provided?.slug === VIS_PRIMER)
			).toBe(false)
			const asAdmin: any = await starterKitsListHandler.handler(
				socket(adminId, true),
				{ includeDisabled: true },
				quiet
			)
			expect(
				asAdmin.kits.some((c: any) => c.provided?.slug === VIS_PRIMER)
			).toBe(true)
			const plain: any = await starterKitsListHandler.handler(
				socket(adminId, true),
				{},
				quiet
			)
			expect(
				plain.kits.some((c: any) => c.provided?.slug === VIS_PRIMER)
			).toBe(false)
		} finally {
			await setProvidedBookDisabled(
				db(),
				"core",
				VIS_PRIMER,
				false,
				adminId
			)
		}
	})

	test("the event pair: core with no such row is refused and writes nothing; a real slug toggles and re-sends the kit list", async () => {
		const h = await import("$lib/server/sockets/plugins")
		const before = await testDb.select().from(schema.plugins)
		await expect(
			h.pluginsDisableProvidedBook.handler(
				socket(adminId, true),
				{ pluginId: "core", slug: "core:primer/nowhere@1" },
				quiet
			)
		).rejects.toThrow("No such provided book.")
		expect((await testDb.select().from(schema.plugins)).length).toBe(
			before.length
		)
		const sent: string[] = []
		const emit = ((event: string) => {
			sent.push(event)
		}) as any
		const asker = socket(adminId, true)
		const ok: any = await h.pluginsDisableProvidedBook.handler(
			asker,
			{ pluginId: "core", slug: VIS_PRIMER },
			emit
		)
		expect(ok).toMatchObject({
			pluginId: "core",
			slug: VIS_PRIMER,
			disabled: true
		})
		expect(ok.lorebookId).toBe((await primerRow()).row.id)
		// The list carries the disabled rows: the asking socket only.
		expect(sent).not.toContain("starterKits:list")
		expect(asker.emit).toHaveBeenCalledWith("starterKits:list", expect.anything())
		expect(sent).not.toContain("plugins:list")
		await expect(
			h.pluginsEnableProvidedBook.handler(
				socket(member),
				{ pluginId: "core", slug: VIS_PRIMER },
				quiet
			)
		).rejects.toThrow("Only admin")
		await h.pluginsEnableProvidedBook.handler(
			socket(adminId, true),
			{ pluginId: "core", slug: VIS_PRIMER },
			quiet
		)
		expect((await primerRow()).mark.disabled).toBeUndefined()
	})
})

describe("starting from a row", () => {
	test("{ primerId } resolves to the row", async () => {
		const { resolveKit } = await import("$lib/server/lorebooks/starterKits")
		const { row } = await primerRow()
		const kit = await resolveKit(db(), { primerId: VIS_PRIMER })
		expect(kit).toMatchObject({
			source: "book",
			provided: true,
			row: { id: row.id }
		})
	})

	test("a person's start is a clone: theirs, card-less, no mark, deletable; the row is untouched", async () => {
		const { lorebooksCreateHandler, lorebooksDeleteHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const { row } = await primerRow()
		const rowBefore = await bookRow(row.id)
		const res: any = await lorebooksCreateHandler.handler(
			socket(member),
			{
				name: "My vale",
				primaryRuleset: "core:ruleset/freeform@1",
				starterKit: { lorebookId: row.id }
			},
			quiet
		)
		const clone = await bookRow(res.lorebook.id)
		expect(clone).toMatchObject({
			userId: member,
			kind: "book",
			name: "My vale",
			primaryRuleset: "core:ruleset/vis-itineris@1"
		})
		expect((clone.extraJson as any)?.provided).toBeUndefined()
		const cloneMembers = await testDb
			.select({ characterId: schema.lorebookBindings.characterId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, clone.id))
		expect(cloneMembers.length).toBe(7)
		expect(cloneMembers.every((m) => m.characterId === null)).toBe(true)
		expect(
			(
				await testDb
					.select()
					.from(schema.characters)
					.where(eq(schema.characters.userId, member))
			).length
		).toBe(0)
		expect(await bookRow(row.id)).toEqual(rowBefore)
		const del: any = await lorebooksDeleteHandler.handler(
			socket(member),
			{ id: clone.id } as any,
			quiet
		)
		expect(del?.error).toBeUndefined()
		expect(await bookRow(clone.id)).toBeUndefined()
	})

	test("the row's owner cloning it gets a card-less clone, and it has no mark", async () => {
		const { starterKitsCloneHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const { row } = await primerRow()
		const res: any = await starterKitsCloneHandler.handler(
			socket(adminId, true),
			{ id: `book:${row.id}`, name: "Mine" },
			quiet
		)
		expect(res.kit).toMatchObject({ source: "admin", mine: true })
		expect(res.kit.provided).toBeUndefined()
		const id = Number(res.kit.id.slice("book:".length))
		const copy = await bookRow(id)
		expect((copy.extraJson as any)?.provided).toBeUndefined()
		const a = await testDb
			.select({ id: schema.lorebookBindings.characterId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, id))
		expect(a.length).toBe(7)
		expect(a.every((x) => x.id === null)).toBe(true)
	})

	test("starterKits:delete still refuses the row", async () => {
		const { starterKitsDeleteHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const { STARTER_KIT_SENTENCES } = await import(
			"$lib/server/lorebooks/starterKits"
		)
		const { row } = await primerRow()
		await expect(
			starterKitsDeleteHandler.handler(
				socket(adminId, true),
				{ lorebookId: row.id },
				quiet
			)
		).rejects.toThrow(STARTER_KIT_SENTENCES.shippedKeep)
	})
})

describe("deleting a kit whose mark names a plugin", () => {
	test("a plugin's starter row is refused while the plugin is present and deleted once it is gone; a core primer stays refused", async () => {
		const { starterKitsDeleteHandler } = await import(
			"$lib/server/sockets/starterKits"
		)
		const { STARTER_KIT_SENTENCES } = await import(
			"$lib/server/lorebooks/starterKits"
		)
		const pluginId = "acme.kept-kit-delete"
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			version: "0.1.0",
			bundleSource: "",
			bundleHash: "x",
			enabled: false,
			enabledBy: adminId,
			manifest: {},
			adminDenied: []
		} as any)
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: adminId, name: "Plugin kit", kind: "starter_kit" } as any)
			.returning()
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					provided: {
						plugin: pluginId,
						slug: "world",
						version: "0.1.0",
						sha256: "",
						uuid: book.uuid,
						entries: {}
					}
				}
			})
			.where(eq(schema.lorebooks.id, book.id))
		const del = (id: number) =>
			starterKitsDeleteHandler.handler(
				socket(adminId, true),
				{ lorebookId: id },
				quiet
			)
		await expect(del(book.id)).rejects.toThrow(STARTER_KIT_SENTENCES.shippedKeep)
		await testDb.delete(schema.plugins).where(eq(schema.plugins.pluginId, pluginId))
		await del(book.id)
		expect(await bookRow(book.id)).toBeUndefined()
		const { row } = await primerRow()
		await expect(del(row.id)).rejects.toThrow(STARTER_KIT_SENTENCES.shippedKeep)
	})
})

describe("an upgrade is a diff", () => {
	test("untouched-changed is rewritten, new upstream added, person-edited kept, disabled carried", async () => {
		const { syncProvidedPrimers } = await import("./providedPrimers")
		const { setProvidedBookDisabled, rowHashOf } = await import(
			"./providedBooks"
		)
		const { row, mark } = await primerRow()
		const keys = Object.keys(mark.entries)
		const [stale, edited, removed] = keys
		const live = new Map((await entriesOf(row.id)).map((e) => [e.id, e]))
		const original = (k: string) => live.get(mark.entries[k].id)!.content
		const entries = { ...mark.entries }
		// "stale": changed upstream since the mark, untouched by anyone.
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "old upstream text" })
			.where(eq(schema.lorebookEntries.id, entries[stale].id))
		const [staleRow] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entries[stale].id))
		entries[stale] = {
			...entries[stale],
			hash: rowHashOf(staleRow),
			up: "older"
		}
		// "edited": a person changed it, and upstream changed too.
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "the person's words" })
			.where(eq(schema.lorebookEntries.id, entries[edited].id))
		entries[edited] = { ...entries[edited], up: "older" }
		// "removed": no longer in the book; the mark forgets it, so it is new upstream.
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entries[removed].id))
		delete entries[removed]
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					...(row.extraJson as object),
					provided: { ...mark, sha256: "older", entries }
				}
			})
			.where(eq(schema.lorebooks.id, row.id))
		await setProvidedBookDisabled(db(), "core", VIS_PRIMER, true, adminId)
		const countBefore = (await entriesOf(row.id)).length

		const report = await syncProvidedPrimers(db(), { version: "1.0.1" })
		expect(report.upgraded).toEqual([VIS_PRIMER])
		const after = await primerRow()
		expect(after.mark).toMatchObject({ version: "1.0.1", disabled: true })
		expect(after.mark.sha256).not.toBe("older")
		const nowLive = new Map((await entriesOf(row.id)).map((e) => [e.id, e]))
		expect(nowLive.get(after.mark.entries[stale].id)!.content).toBe(
			original(stale)
		)
		expect(nowLive.get(after.mark.entries[edited].id)!.content).toBe(
			"the person's words"
		)
		expect(nowLive.get(after.mark.entries[removed].id)!.content).toBe(
			original(removed)
		)
		expect(nowLive.size).toBe(countBefore + 1)
		// And a second sync at the same version: nothing.
		const again = await syncProvidedPrimers(db(), { version: "1.0.1" })
		expect(again.upgraded).toEqual([])
		expect(await bookRow(row.id)).toMatchObject({
			extraJson: expect.objectContaining({
				provided: expect.objectContaining({ disabled: true })
			})
		})
	})
})
