/**
 * An account's avatar (`users:current:updateAvatar`) and a lorebook's cover
 * image (`lorebooks:update`'s `coverFile`): each is a role pointer at a file,
 * set by a picture and cleared by `null`, and each picture is seen by the
 * people who see what wears it.
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-avatar-cover-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `pictured-${++n}`)
}

async function picture(shade: number, size = 4) {
	const { PNG } = await import("pngjs")
	const p = new PNG({ width: size, height: size })
	p.data.fill(shade)
	return PNG.sync.write(p)
}

function recorder() {
	const events: { event: string; data: unknown }[] = []
	const emit = (async (event: string, data: unknown) => {
		events.push({
			event,
			data:
				typeof data === "function"
					? await (data as () => unknown)()
					: data
		})
	}) as any
	return { events, emit, names: () => events.map((e) => e.event) }
}

async function fileRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.files)
		.where(eq(schema.files.id, id))
	return row
}

describe("the account's avatar", () => {
	test("a picture sets it, the payloads carry its address, and null clears it", async () => {
		const { usersCurrentUpdateAvatar, buildUsersCurrent } = await import(
			"./users"
		)
		const me = await person()
		const rec = recorder()

		const res = await usersCurrentUpdateAvatar.handler(
			{ user: { id: me.id } } as any,
			{ avatarFile: await picture(40) },
			rec.emit
		)
		expect(res.avatarMediaId).toEqual(expect.any(Number))
		expect(res.avatarMedia).toMatchObject({
			uuid: expect.any(String),
			rev: expect.any(Number)
		})
		expect(rec.names()).toEqual([
			"users:current:updateAvatar",
			"users:current"
		])
		const { user } = await buildUsersCurrent(me.id)
		expect(user.avatarMediaId).toBe(res.avatarMediaId)
		expect(user.avatarMedia?.uuid).toBe(res.avatarMedia?.uuid)

		// A personal file: no entity parent.
		const file = await fileRow(res.avatarMediaId!)
		expect(file).toMatchObject({
			userId: me.id,
			characterId: null,
			lorebookId: null
		})

		const cleared = await usersCurrentUpdateAvatar.handler(
			{ user: { id: me.id } } as any,
			{ avatarFile: null },
			recorder().emit
		)
		expect(cleared).toEqual({ avatarMediaId: null, avatarMedia: null })
	})

	test("an upload with no bytes is refused and says so", async () => {
		const { usersCurrentUpdateAvatar } = await import("./users")
		const me = await person()
		const rec = recorder()
		await expect(
			usersCurrentUpdateAvatar.handler(
				{ user: { id: me.id } } as any,
				{ avatarFile: "not a picture" as any },
				rec.emit
			)
		).rejects.toThrow("No picture came with that upload.")
		expect(rec.names()).toEqual(["users:current:updateAvatar:error"])
	})

	test("any signed-in person may see it; the owner's other personal files stay theirs", async () => {
		const { usersCurrentUpdateAvatar } = await import("./users")
		const { canViewMedia, createMedia } = await import("$lib/server/media")
		const me = await person()
		const someone = await person()
		const res = await usersCurrentUpdateAvatar.handler(
			{ user: { id: me.id } } as any,
			{ avatarFile: await picture(41) },
			recorder().emit
		)
		expect(
			await canViewMedia(
				await fileRow(res.avatarMediaId!),
				someone.id,
				db()
			)
		).toBe(true)

		const other = await createMedia(db(), {
			userId: me.id,
			bytes: await picture(42)
		})
		expect(await canViewMedia(other.file, someone.id, db())).toBe(false)
	})

	test("it is not offered as a background, and the tray counts it as in use", async () => {
		const { usersCurrentUpdateAvatar } = await import("./users")
		const { listUserBackgrounds, handleUserBackgroundUpload } =
			await import("$lib/server/utils")
		const { isFileReferenced } = await import(
			"$lib/server/attachments/tray"
		)
		const me = await person()
		const background = await handleUserBackgroundUpload({
			userId: me.id,
			backgroundFile: await picture(43)
		})
		const res = await usersCurrentUpdateAvatar.handler(
			{ user: { id: me.id } } as any,
			{ avatarFile: await picture(44) },
			recorder().emit
		)
		const listed = (await listUserBackgrounds({ userId: me.id })).map(
			(m) => m.id
		)
		expect(listed).toContain(background.file.id)
		expect(listed).not.toContain(res.avatarMediaId)
		expect(await isFileReferenced(db(), res.avatarMediaId!)).toBe(true)
	})

	test("a private file is never worn as an avatar", async () => {
		const { usersCurrentUpdateAvatar } = await import("./users")
		const { createMedia } = await import("$lib/server/media")
		const { MediaVisibility } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		const me = await person()
		const secret = await picture(45)
		await createMedia(db(), {
			userId: me.id,
			bytes: secret,
			visibility: MediaVisibility.PRIVATE
		})
		await expect(
			usersCurrentUpdateAvatar.handler(
				{ user: { id: me.id } } as any,
				{ avatarFile: secret },
				recorder().emit
			)
		).rejects.toThrow(/private files/)
		const [row] = await testDb
			.select({ avatarMediaId: schema.users.avatarMediaId })
			.from(schema.users)
			.where(eq(schema.users.id, me.id))
		expect(row.avatarMediaId).toBeNull()
	})

	test("re-cropping it re-sends the account, so the rail redraws", async () => {
		const { usersCurrentUpdateAvatar } = await import("./users")
		const { mediaSetFrame } = await import("./media")
		const me = await person()
		const res = await usersCurrentUpdateAvatar.handler(
			{ user: { id: me.id } } as any,
			// Big enough to crop: a crop is at least 16px a side.
			{ avatarFile: await picture(46, 32) },
			recorder().emit
		)
		const rec = recorder()
		await mediaSetFrame.handler(
			{ user: { id: me.id } } as any,
			{
				mediaId: res.avatarMediaId!,
				frame: { x: 0, y: 0, w: 20, h: 20 }
			},
			rec.emit
		)
		const current = rec.events.find((e) => e.event === "users:current")
		expect(current).toBeDefined()
		expect((current!.data as any).user.avatarMedia.rev).toBeGreaterThan(
			res.avatarMedia!.rev
		)
	})
})

describe("a lorebook's cover image", () => {
	async function book(ownerId: number) {
		const [row] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: ownerId, name: `Atlas ${++n}` })
			.returning()
		return row
	}

	test("coverFile sets it as lorebook-owned media, absent leaves it, null clears it", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const me = await person()
		const atlas = await book(me.id)
		const socket = { user: { id: me.id } } as any

		const set = await lorebooksUpdateHandler.handler(
			socket,
			{ lorebook: { id: atlas.id }, coverFile: await picture(50) },
			recorder().emit
		)
		const coverId = set.lorebook.coverMediaId!
		expect(coverId).toEqual(expect.any(Number))
		expect(set.lorebook.coverMedia).toMatchObject({
			uuid: expect.any(String)
		})
		expect(await fileRow(coverId)).toMatchObject({
			lorebookId: atlas.id,
			characterId: null
		})

		const renamed = await lorebooksUpdateHandler.handler(
			socket,
			{ lorebook: { id: atlas.id, name: "Atlas renamed" } },
			recorder().emit
		)
		expect(renamed.lorebook.coverMediaId).toBe(coverId)

		const cleared = await lorebooksUpdateHandler.handler(
			socket,
			{ lorebook: { id: atlas.id }, coverFile: null },
			recorder().emit
		)
		expect(cleared.lorebook.coverMediaId).toBeNull()
		expect(cleared.lorebook.coverMedia).toBeNull()
	})

	test("a stranger's save is refused before any file is written", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const owner = await person()
		const stranger = await person()
		const atlas = await book(owner.id)
		const rec = recorder()
		await expect(
			lorebooksUpdateHandler.handler(
				{ user: { id: stranger.id } } as any,
				{ lorebook: { id: atlas.id }, coverFile: await picture(51) },
				rec.emit
			)
		).rejects.toThrow("Lorebook not found.")
		expect(rec.names()).toEqual(["lorebooks:update:error"])
		const strangersFiles = await testDb
			.select()
			.from(schema.files)
			.where(eq(schema.files.userId, stranger.id))
		expect(strangersFiles).toEqual([])
	})

	test("the people it is shared with see the cover; nobody else does", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const { canViewMedia } = await import("$lib/server/media")
		const owner = await person()
		const reader = await person()
		const stranger = await person()
		const atlas = await book(owner.id)
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: atlas.id, userId: reader.id })
		const res = await lorebooksUpdateHandler.handler(
			{ user: { id: owner.id } } as any,
			{ lorebook: { id: atlas.id }, coverFile: await picture(52) },
			recorder().emit
		)
		const cover = await fileRow(res.lorebook.coverMediaId!)
		expect(await canViewMedia(cover, reader.id, db())).toBe(true)
		expect(await canViewMedia(cover, stranger.id, db())).toBe(false)
	})

	test("a cover that reuses a card's picture is judged by the book that wears it", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const { canViewMedia, createMedia } = await import("$lib/server/media")
		const { isFileReferenced } = await import(
			"$lib/server/attachments/tray"
		)
		const owner = await person()
		const reader = await person()
		const atlas = await book(owner.id)
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: atlas.id, userId: reader.id })
		const bytes = await picture(53)
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Private card",
				description: "Not shared."
			})
			.returning()
		const existing = await createMedia(db(), {
			userId: owner.id,
			characterId: card.id,
			bytes
		})
		expect(await canViewMedia(existing.file, reader.id, db())).toBe(false)

		const res = await lorebooksUpdateHandler.handler(
			{ user: { id: owner.id } } as any,
			{ lorebook: { id: atlas.id }, coverFile: bytes },
			recorder().emit
		)
		expect(res.lorebook.coverMediaId).toBe(existing.file.id)
		expect(
			await canViewMedia(await fileRow(existing.file.id), reader.id, db())
		).toBe(true)
		expect(await isFileReferenced(db(), existing.file.id)).toBe(true)
	})

	test("the list and the book's own read carry the cover's address", async () => {
		const {
			lorebooksUpdateHandler,
			lorebooksListHandler,
			lorebooksGetHandler
		} = await import("./lorebooks")
		const me = await person()
		const atlas = await book(me.id)
		const socket = { user: { id: me.id } } as any
		const set = await lorebooksUpdateHandler.handler(
			socket,
			{ lorebook: { id: atlas.id }, coverFile: await picture(54) },
			recorder().emit
		)
		const list = await lorebooksListHandler.handler(
			socket,
			{},
			recorder().emit
		)
		const row = list.lorebookList.find((l) => l.id === atlas.id)
		expect(row?.coverMedia?.uuid).toBe(set.lorebook.coverMedia?.uuid)
		const got = await lorebooksGetHandler.handler(
			socket,
			{ id: atlas.id },
			recorder().emit
		)
		expect(got.lorebook?.coverMedia?.uuid).toBe(
			set.lorebook.coverMedia?.uuid
		)
	})
})
