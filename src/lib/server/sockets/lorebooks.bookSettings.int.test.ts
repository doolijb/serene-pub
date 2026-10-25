/**
 * Book settings, server side (2026-10-21 pass): a book's **Rules** are chosen
 * at creation and changed only when sent explicitly; the name is trimmed and
 * never empty; `extraJson` is no longer writable through the form's save; a
 * share recipient hears the owner's edits; and a recipient's duplicate wears
 * a cover of its own.
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

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-book-settings-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const FREEFORM = "core:ruleset/freeform@1"
const VIS = "core:ruleset/vis-itineris@1"
let n = 0

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `book-settings-${++n}`)
}

async function book(ownerId: number, values: Partial<typeof schema.lorebooks.$inferInsert> = {}) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Codex ${++n}`, ...values })
		.returning()
	return row
}

async function stored(id: number) {
	const [row] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, id))
	return row
}

const quiet = (async () => {}) as any
const as = (id: number) => ({ user: { id } }) as any

describe("a book's Rules", () => {
	test("the choices are every installed ruleset, Freeform first and the default", async () => {
		const { lorebooksRulesChoicesHandler } = await import("./lorebooks")
		const me = await person()
		const res = await lorebooksRulesChoicesHandler.handler(as(me.id), {}, quiet)
		expect(res.defaultId).toBe(FREEFORM)
		expect(res.choices[0].id).toBe(FREEFORM)
		expect(res.choices.map((c) => c.id)).toContain(VIS)
		expect(res.choices.every((c) => c.name && !c.recommended)).toBe(true)
	})

	test("a new book takes the rules picked, Freeform when none, and refuses unknown ones", async () => {
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const me = await person()
		const picked = await lorebooksCreateHandler.handler(
			as(me.id),
			{ name: "Brackenvale", primaryRuleset: VIS },
			quiet
		)
		expect((await stored(picked.lorebook.id)).primaryRuleset).toBe(VIS)
		const plain = await lorebooksCreateHandler.handler(as(me.id), { name: "Plain" }, quiet)
		expect((await stored(plain.lorebook.id)).primaryRuleset).toBe(FREEFORM)
		await expect(
			lorebooksCreateHandler.handler(
				as(me.id),
				{ name: "Nowhere", primaryRuleset: "core:ruleset/nonesuch@1" },
				quiet
			)
		).rejects.toThrow("Those rules aren't installed on this pub.")
	})

	test("an update changes them only when sent on their own, never off the row", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const me = await person()
		const codex = await book(me.id)
		// The form sends the row back whole: a stale rules value in it is ignored.
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id, name: "Renamed", primaryRuleset: VIS } },
			quiet
		)
		expect((await stored(codex.id)).primaryRuleset).toBe(FREEFORM)
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id }, primaryRuleset: VIS },
			quiet
		)
		const after = await stored(codex.id)
		expect(after.primaryRuleset).toBe(VIS)
		expect(after.name).toBe("Renamed")
	})

	test("nobody else's book, and never a session's own notes", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const owner = await person()
		const stranger = await person()
		const codex = await book(owner.id)
		await expect(
			lorebooksUpdateHandler.handler(
				as(stranger.id),
				{ lorebook: { id: codex.id }, primaryRuleset: VIS },
				quiet
			)
		).rejects.toThrow("Lorebook not found.")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, name: "Notes host" })
			.returning()
		const notes = await book(owner.id, { sessionId: session.id })
		await expect(
			lorebooksUpdateHandler.handler(
				as(owner.id),
				{ lorebook: { id: notes.id }, primaryRuleset: VIS },
				quiet
			)
		).rejects.toThrow("A session's own notes play their session's rules.")
	})
})

describe("what the save writes", () => {
	test("the name is trimmed, and a name of spaces is refused", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const me = await person()
		const codex = await book(me.id)
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id, name: "  The Long Road  " } },
			quiet
		)
		expect((await stored(codex.id)).name).toBe("The Long Road")
		await expect(
			lorebooksUpdateHandler.handler(as(me.id), { lorebook: { id: codex.id, name: "   " } }, quiet)
		).rejects.toThrow("A lorebook needs a name.")
		expect((await stored(codex.id)).name).toBe("The Long Road")
	})

	test("extraJson sent with the row is not written", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const me = await person()
		const codex = await book(me.id, { extraJson: { kept: true } })
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id, extraJson: { injected: 1 } } as any },
			quiet
		)
		expect((await stored(codex.id)).extraJson).toEqual({ kept: true })
	})
})

describe("the people a book is shared with", () => {
	test("hear a rename on their own list, built as them", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const owner = await person()
		const reader = await person()
		const stranger = await person()
		const codex = await book(owner.id)
		await testDb.insert(schema.lorebookShares).values({ lorebookId: codex.id, userId: reader.id })

		const rooms = new Map<string, Set<string>>([
			[`user_${reader.id}`, new Set(["tab-reader"])],
			[`user_${stranger.id}`, new Set(["tab-stranger"])]
		])
		const sockets = new Map<string, any>([
			["tab-reader", { id: "tab-reader", user: { id: reader.id }, interest: new Set(["lorebooks:list"]) }],
			[
				"tab-stranger",
				{ id: "tab-stranger", user: { id: stranger.id }, interest: new Set(["lorebooks:list"]) }
			]
		])
		const sent: { target: string; event: string; data: any }[] = []
		const io = {
			to: (target: string) => ({
				emit: (event: string, data: any) => sent.push({ target, event, data })
			}),
			sockets: { adapter: { rooms }, sockets }
		}
		await lorebooksUpdateHandler.handler(
			{ user: { id: owner.id }, io } as any,
			{ lorebook: { id: codex.id, name: "Shared and renamed" } },
			quiet
		)
		const relayed = sent.filter((s) => s.event === "lorebooks:list")
		expect(relayed.map((s) => s.target)).toEqual(["tab-reader"])
		const row = relayed[0].data.lorebookList.find((l: any) => l.id === codex.id)
		expect(row?.name).toBe("Shared and renamed")
		expect(row?.isSharedWithMe).toBe(true)
	})

	test("a reader's duplicate wears a cover of its own, with the same crop", async () => {
		const { lorebooksUpdateHandler, lorebooksDuplicateHandler } = await import("./lorebooks")
		const { PNG } = await import("pngjs")
		const owner = await person()
		const reader = await person()
		const codex = await book(owner.id)
		await testDb.insert(schema.lorebookShares).values({ lorebookId: codex.id, userId: reader.id })
		const p = new PNG({ width: 32, height: 32 })
		p.data.fill(77)
		const set = await lorebooksUpdateHandler.handler(
			as(owner.id),
			{ lorebook: { id: codex.id }, coverFile: PNG.sync.write(p) },
			quiet
		)
		const ownersCover = set.lorebook.coverMediaId!
		await testDb
			.update(schema.files)
			.set({ frame: { x: 0, y: 0, w: 20, h: 20 } })
			.where(eq(schema.files.id, ownersCover))

		const copy = await lorebooksDuplicateHandler.handler(
			as(reader.id),
			{ lorebookId: codex.id },
			quiet
		)
		const copied = await stored(copy.lorebook.id)
		expect(copied.coverMediaId).not.toBe(ownersCover)
		const [file] = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.id, copied.coverMediaId!))
		expect(file).toMatchObject({ userId: reader.id, lorebookId: copied.id })
		expect(file.frame).toEqual({ x: 0, y: 0, w: 20, h: 20 })
	})

	test("the owner's own duplicate keeps the same picture", async () => {
		const { lorebooksUpdateHandler, lorebooksDuplicateHandler } = await import("./lorebooks")
		const { PNG } = await import("pngjs")
		const owner = await person()
		const codex = await book(owner.id)
		const p = new PNG({ width: 32, height: 32 })
		p.data.fill(78)
		const set = await lorebooksUpdateHandler.handler(
			as(owner.id),
			{ lorebook: { id: codex.id }, coverFile: PNG.sync.write(p) },
			quiet
		)
		const copy = await lorebooksDuplicateHandler.handler(as(owner.id), { lorebookId: codex.id }, quiet)
		expect((await stored(copy.lorebook.id)).coverMediaId).toBe(set.lorebook.coverMediaId)
	})
})

describe("a book's own writes from sessions (Personal > Lorebook > Session)", () => {
	async function personalMode(userId: number, mode: "full" | "review" | "off" | null) {
		await testDb
			.insert(schema.userSettings)
			.values({ userId, loreWriteMode: mode })
			.onConflictDoUpdate({
				target: schema.userSettings.userId,
				set: { loreWriteMode: mode }
			})
	}

	test("a new book is Full, and leaves the owner's own mode as the answer", async () => {
		const { bookLoreWriteMode } = await import("$lib/server/state/loreWriteMode")
		const me = await person()
		const codex = await book(me.id)
		expect((await stored(codex.id)).loreWriteMode).toBe("full")
		await personalMode(me.id, "review")
		expect(await bookLoreWriteMode(testDb as unknown as Db, codex.id)).toBe("review")
	})

	test("the book tightens the owner's mode and never loosens it", async () => {
		const { bookLoreWriteMode } = await import("$lib/server/state/loreWriteMode")
		const me = await person()
		await personalMode(me.id, "full")
		const reviewed = await book(me.id, { loreWriteMode: "review" })
		expect(await bookLoreWriteMode(testDb as unknown as Db, reviewed.id)).toBe("review")
		await personalMode(me.id, "off")
		const open = await book(me.id, { loreWriteMode: "full" })
		expect(await bookLoreWriteMode(testDb as unknown as Db, open.id)).toBe("off")
	})

	test("a session reading the book writes at the book's ceiling", async () => {
		const { sessionLoreWriteMode } = await import("$lib/server/state/loreWriteMode")
		const me = await person()
		await personalMode(me.id, null)
		const shut = await book(me.id, { loreWriteMode: "off" })
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: me.id, isGroup: false, name: "Reader", lorebookId: shut.id })
			.returning()
		expect(await sessionLoreWriteMode(testDb as unknown as Db, session.id)).toBe("off")
	})

	test("set only when sent on its own; a stale row value or an unknown mode is not written", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const me = await person()
		const codex = await book(me.id)
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id, loreWriteMode: "off" } },
			quiet
		)
		expect((await stored(codex.id)).loreWriteMode).toBe("full")
		await lorebooksUpdateHandler.handler(
			as(me.id),
			{ lorebook: { id: codex.id }, loreWriteMode: "review" },
			quiet
		)
		expect((await stored(codex.id)).loreWriteMode).toBe("review")
		await expect(
			lorebooksUpdateHandler.handler(
				as(me.id),
				{ lorebook: { id: codex.id }, loreWriteMode: "sometimes" },
				quiet
			)
		).rejects.toThrow("Writes from sessions are Full, Review changes or Off.")
	})
})
