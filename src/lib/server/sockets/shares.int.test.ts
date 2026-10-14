/**
 * Shares (PLAN-private-messages §4 "Shares", §6.7): the explicit, revocable
 * read grant on a character or a lorebook. Proves the access helpers
 * (`canViewCharacter`'s share branch, `canViewLorebook`), the replace-set
 * handlers (`characters:share`, `lorebooks:share`), the reads that follow
 * them (`characters:list|get`, `lorebooks:list|get`) and Jump's searches.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
}, 60_000)

let n = 0
async function people() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const k = n++
	const owner = await createTestUser(db, `share-owner-${k}`)
	const nia = await createTestUser(db, `share-nia-${k}`)
	const tomas = await createTestUser(db, `share-tomas-${k}`)
	const stranger = await createTestUser(db, `share-stranger-${k}`)
	return { owner, nia, tomas, stranger, k }
}

function socket(userId: number, isAdmin = false) {
	return { id: `s-${userId}`, user: { id: userId, isAdmin } } as any
}

/** Run a handler; collect what it emitted to the asker. */
async function call(handler: any, userId: number, params: unknown) {
	const emitted: { event: string; data: any }[] = []
	let error: unknown
	const res = await handler
		.handler(socket(userId), params, async (event: string, data: any) => {
			emitted.push({
				event,
				data: typeof data === "function" ? await data() : data
			})
		})
		.catch((e: unknown) => {
			error = e
		})
	return { res, emitted, error }
}

describe("canViewCharacter — the share branch", () => {
	test("a share lets the recipient view; revoking it ends the view", async () => {
		const { canViewCharacter } = await import("$lib/server/utils/sessionAccess")
		const { owner, nia } = await people()
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Wren", description: "" })
			.returning()
		expect(await canViewCharacter(c.id, nia.id)).toBe(false)
		await db
			.insert(schema.characterShares)
			.values({ characterId: c.id, userId: nia.id })
		expect(await canViewCharacter(c.id, nia.id)).toBe(true)
		await db
			.delete(schema.characterShares)
			.where(eq(schema.characterShares.userId, nia.id))
		expect(await canViewCharacter(c.id, nia.id)).toBe(false)
	})
})

describe("canViewLorebook — owner · shared · admin", () => {
	test("each road, and the stranger refused", async () => {
		const { canViewLorebook, lorebookAccessFor } = await import(
			"$lib/server/utils/ownedBook"
		)
		const { owner, nia, stranger } = await people()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const admin = await createTestUser(db, `share-admin-${n}`)
		await db
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, admin.id))
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: "Atlas" })
			.returning()
		await db
			.insert(schema.lorebookShares)
			.values({ lorebookId: book.id, userId: nia.id })

		expect(await lorebookAccessFor(book.id, owner.id)).toBe("owner")
		expect(await lorebookAccessFor(book.id, nia.id)).toBe("shared")
		expect(await lorebookAccessFor(book.id, admin.id)).toBe("admin")
		// The caller's own word on admin wins over the account row.
		expect(await lorebookAccessFor(book.id, admin.id, { isAdmin: false })).toBe(
			null
		)
		expect(await canViewLorebook(book.id, stranger.id)).toBe(false)
		expect(await canViewLorebook(book.id + 10_000, owner.id)).toBe(false)
		expect(await canViewLorebook(book.id, nia.id)).toBe(true)
	})
})

describe("characters:share", () => {
	test("replace-set, owner only, and the reads that follow", async () => {
		const { charactersShare, charactersList, charactersGet } = await import(
			"./characters"
		)
		const { owner, nia, tomas, stranger } = await people()
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Wren", description: "" })
			.returning()

		// Not the owner: refused, nothing written.
		const refused = await call(charactersShare, nia.id, {
			characterId: c.id,
			userIds: [nia.id]
		})
		expect(refused.error).toBeTruthy()
		expect(refused.emitted.map((e) => e.event)).toEqual([
			"characters:share:error"
		])

		const first = await call(charactersShare, owner.id, {
			characterId: c.id,
			userIds: [nia.id, tomas.id]
		})
		expect(first.error).toBeUndefined()
		expect(first.res).toEqual({
			characterId: c.id,
			sharedWith: [
				expect.objectContaining({ id: nia.id }),
				expect.objectContaining({ id: tomas.id })
			]
		})

		// A recipient's list carries it, marked; the stranger's does not.
		const niaList = await call(charactersList, nia.id, {})
		const row = niaList.res.characterList.find((r: any) => r.id === c.id)
		expect(row).toMatchObject({
			isSharedWithMe: true,
			ownerName: owner.username,
			folderId: null
		})
		const strangerList = await call(charactersList, stranger.id, {})
		expect(
			strangerList.res.characterList.some((r: any) => r.id === c.id)
		).toBe(false)
		// The owner's own rows are unchanged: no share marks.
		const ownerList = await call(charactersList, owner.id, {})
		const own = ownerList.res.characterList.find((r: any) => r.id === c.id)
		expect(own.isSharedWithMe).toBeUndefined()

		// get: the owner reads who; the recipient reads that it is theirs.
		const ownerGet = await call(charactersGet, owner.id, { id: c.id })
		expect(ownerGet.res.character.sharedWith.map((p: any) => p.id)).toEqual([
			nia.id,
			tomas.id
		])
		expect(ownerGet.res.character.isSharedWithMe).toBeUndefined()
		const niaGet = await call(charactersGet, nia.id, { id: c.id })
		expect(niaGet.res.character).toMatchObject({
			isOwner: false,
			isSharedWithMe: true
		})
		expect(niaGet.res.character.sharedWith).toBeUndefined()

		// Replace-set: Nia is revoked.
		const second = await call(charactersShare, owner.id, {
			characterId: c.id,
			userIds: [tomas.id]
		})
		expect(second.res.sharedWith.map((p: any) => p.id)).toEqual([tomas.id])
		const niaAfter = await call(charactersGet, nia.id, { id: c.id })
		expect(niaAfter.res.character).toBeNull()
	})

	test("refuses a recipient who is deleted, unknown or the owner", async () => {
		const { charactersShare } = await import("./characters")
		const { owner, nia, tomas } = await people()
		await db
			.update(schema.users)
			.set({ isDeleted: true })
			.where(eq(schema.users.id, tomas.id))
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Wren", description: "" })
			.returning()
		for (const userIds of [[nia.id, tomas.id], [999_999], [owner.id], "x"]) {
			const r = await call(charactersShare, owner.id, {
				characterId: c.id,
				userIds
			})
			expect(r.error).toBeTruthy()
		}
		const rows = await db
			.select()
			.from(schema.characterShares)
			.where(eq(schema.characterShares.characterId, c.id))
		expect(rows).toEqual([])
	})
})

describe("lorebooks:share", () => {
	test("replace-set, owner only, and the reads that follow", async () => {
		const {
			lorebooksShareHandler,
			lorebooksListHandler,
			lorebooksGetHandler
		} = await import("./lorebooks")
		const { owner, nia, stranger } = await people()
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: "Atlas" })
			.returning()

		const refused = await call(lorebooksShareHandler, nia.id, {
			lorebookId: book.id,
			userIds: [nia.id]
		})
		expect(refused.error).toBeTruthy()

		const shared = await call(lorebooksShareHandler, owner.id, {
			lorebookId: book.id,
			userIds: [nia.id]
		})
		expect(shared.res).toEqual({
			lorebookId: book.id,
			sharedWith: [expect.objectContaining({ id: nia.id })]
		})

		const niaList = await call(lorebooksListHandler, nia.id, {})
		expect(
			niaList.res.lorebookList.find((b: any) => b.id === book.id)
		).toMatchObject({ isSharedWithMe: true, ownerName: owner.username })
		const ownerList = await call(lorebooksListHandler, owner.id, {})
		expect(
			ownerList.res.lorebookList.find((b: any) => b.id === book.id)
				.isSharedWithMe
		).toBeUndefined()

		const niaGet = await call(lorebooksGetHandler, nia.id, { id: book.id })
		expect(niaGet.res.lorebook).toMatchObject({
			id: book.id,
			isSharedWithMe: true
		})
		expect(niaGet.res.lorebook.sharedWith).toBeUndefined()
		const ownerGet = await call(lorebooksGetHandler, owner.id, { id: book.id })
		expect(ownerGet.res.lorebook.sharedWith.map((p: any) => p.id)).toEqual([
			nia.id
		])
		const strangerGet = await call(lorebooksGetHandler, stranger.id, {
			id: book.id
		})
		expect(strangerGet.res).toEqual({ lorebook: null, lorebookId: book.id })

		// Revoke all.
		await call(lorebooksShareHandler, owner.id, {
			lorebookId: book.id,
			userIds: []
		})
		const niaAfter = await call(lorebooksGetHandler, nia.id, { id: book.id })
		expect(niaAfter.res.lorebook).toBeNull()
	})
})

describe("jump — shared items reach the recipient", () => {
	test("characters and lorebooks shared with the asker are found", async () => {
		const { jumpSearch } = await import("./jump")
		const { owner, nia, stranger, k } = await people()
		const name = `Quillon${k}`
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: owner.id, name, description: "" })
			.returning()
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name })
			.returning()
		await db
			.insert(schema.characterShares)
			.values({ characterId: c.id, userId: nia.id })
		await db
			.insert(schema.lorebookShares)
			.values({ lorebookId: book.id, userId: nia.id })

		const ids = async (userId: number, kind: string) => {
			const { res } = await call(jumpSearch, userId, { query: name })
			return (
				res.groups.find((g: any) => g.kind === kind)?.hits.map((h: any) => h.id) ??
				[]
			)
		}
		expect(await ids(nia.id, "character")).toEqual([c.id])
		expect(await ids(nia.id, "lorebook")).toEqual([book.id])
		expect(await ids(stranger.id, "character")).toEqual([])
		expect(await ids(stranger.id, "lorebook")).toEqual([])
	})
})
