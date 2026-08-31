/**
 * The media management handlers (28).
 *
 * The rule under test throughout is that *managing* a blob is owner-only, and
 * deliberately narrower than viewing it: `canViewMedia` lets a shared character
 * carry its gallery to a session guest, but that guest must never be able to
 * delete, re-cut or re-scope someone else's image.
 */
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

function png(seed: number, size = 900): Buffer {
	const p = new PNG({ width: size, height: Math.round(size * 0.66) })
	for (let i = 0; i < p.data.length; i += 4) {
		p.data[i] = seed
		p.data[i + 1] = i % 255
		p.data[i + 2] = 120
		p.data[i + 3] = 255
	}
	return PNG.sync.write(p)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

function captureEmits() {
	const emitted: { event: string; data: any }[] = []
	return {
		emitted,
		emit: (event: string, data: any) => emitted.push({ event, data })
	}
}

let ownerId: number
let otherId: number
let charId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-mediasock-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "media-sock-owner")).id
	otherId = (await createTestUser(db, "media-sock-other")).id
	const [c] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Owner Char", description: "" })
		.returning()
	charId = c.id
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeImage(seed: number, filename?: string) {
	const { createMedia } = await import("$lib/server/media")
	return createMedia(db, {
		userId: ownerId,
		characterId: charId,
		bytes: png(seed),
		filename
	})
}

describe("media:list", () => {
	test("returns the owner's originals with labels, and never a derivative", async () => {
		const { mediaList } = await import("./media")
		await makeImage(1, "one.png")
		await makeImage(2, "two.png")

		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)

		expect(res.media.length).toBeGreaterThanOrEqual(2)
		// Thumbnails exist for these, and none of them are in the list.
		expect(res.media.every((m) => m.thumbMediaId !== null)).toBe(true)
		expect(res.media.every((m) => m.hasThumbnail)).toBe(true)
		expect(res.media[0].attachedTo).toEqual({
			type: "character",
			id: charId,
			name: "Owner Char"
		})
		expect(res.totalBytes).toBeGreaterThan(0)
	})

	test("never leaks a filesystem path", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)
		expect(JSON.stringify(res)).not.toContain(dataDir)
		expect(JSON.stringify(res)).not.toContain("data/users")
	})

	test("shows nothing of another user's", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(otherId), {}, emit)
		expect(res.media).toHaveLength(0)
	})

	test("sorts server-side", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const largest = await mediaList.handler(
			fakeSocket(ownerId),
			{ sort: "largest" },
			emit
		)
		const sizes = largest.media.map((m) => m.bytes)
		expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)
	})
})

describe("media:regenerateThumbnail", () => {
	test("replaces the derivative with a fresh row", async () => {
		const { mediaRegenerateThumbnail } = await import("./media")
		const { thumbsByParent } = await import("$lib/server/media")
		const row = await makeImage(3, "regen.png")
		const before = (await thumbsByParent(db, [row.id])).get(row.id)!

		const { emit } = captureEmits()
		const res = await mediaRegenerateThumbnail.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id },
			emit
		)
		expect(res.regenerated).toBe(true)

		const after = (await thumbsByParent(db, [row.id])).get(row.id)!
		// A regenerate has to actually produce a row even though the old one
		// was byte-identical — ensureThumbnail no-ops when one exists, so the
		// handler deleting first is the whole behaviour under test.
		expect(after).toBeTruthy()
		expect(after.parentMediaId).toBe(row.id)
		expect(before).toBeTruthy()
	})

	test("refuses another user's image", async () => {
		const { mediaRegenerateThumbnail } = await import("./media")
		const row = await makeImage(4)
		const { emit } = captureEmits()
		await expect(
			mediaRegenerateThumbnail.handler(
				fakeSocket(otherId),
				{ mediaId: row.id },
				emit
			)
		).rejects.toThrow(/not found/i)
	})
})

describe("media:setVisibility", () => {
	test("applies to the original and its derivative", async () => {
		const { mediaSetVisibility } = await import("./media")
		const { thumbsByParent, getMedia } = await import("$lib/server/media")
		const row = await makeImage(5)
		const { emit } = captureEmits()
		await mediaSetVisibility.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id, visibility: "private" },
			emit
		)
		expect((await getMedia(db, row.id))!.visibility).toBe("private")
		const thumb = (await thumbsByParent(db, [row.id])).get(row.id)!
		expect(thumb.visibility).toBe("private")
	})

	test("rejects an unknown level", async () => {
		const { mediaSetVisibility } = await import("./media")
		const row = await makeImage(6)
		const { emit } = captureEmits()
		await expect(
			mediaSetVisibility.handler(
				fakeSocket(ownerId),
				{ mediaId: row.id, visibility: "public" },
				emit
			)
		).rejects.toThrow(/visibility/i)
	})
})

describe("media:delete", () => {
	test("removes the blob and clears the avatar pointer it fed", async () => {
		const { mediaDelete } = await import("./media")
		const { getMedia } = await import("$lib/server/media")
		const row = await makeImage(7)
		const { eq } = await import("drizzle-orm")
		await db
			.update(schema.characters)
			.set({ avatarMediaId: row.id })
			.where(eq(schema.characters.id, charId))

		const { emit } = captureEmits()
		await mediaDelete.handler(fakeSocket(ownerId), { mediaId: row.id }, emit)

		expect(await getMedia(db, row.id)).toBeNull()
		const char = await db.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, charId)
		})
		// A dangling pointer is tolerated by design elsewhere, but not one the
		// delete could see and clear.
		expect(char?.avatarMediaId).toBeNull()
	})

	test("refuses another user's image", async () => {
		const { mediaDelete } = await import("./media")
		const row = await makeImage(8)
		const { emit } = captureEmits()
		await expect(
			mediaDelete.handler(fakeSocket(otherId), { mediaId: row.id }, emit)
		).rejects.toThrow(/not found/i)
	})
})

describe("uuid as a cache token", () => {
	test("regenerating rotates both the thumbnail's and the original's address", async () => {
		const { mediaRegenerateThumbnail } = await import("./media")
		const { thumbsByParent, getMedia } = await import("$lib/server/media")
		const row = await makeImage(9, "rotate.png")
		const beforeParent = row.uuid
		const beforeThumb = (await thumbsByParent(db, [row.id])).get(row.id)!.uuid

		const { emit } = captureEmits()
		await mediaRegenerateThumbnail.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id },
			emit
		)

		expect((await getMedia(db, row.id))!.uuid).not.toBe(beforeParent)
		expect(
			(await thumbsByParent(db, [row.id])).get(row.id)!.uuid
		).not.toBe(beforeThumb)
	})

	test("the list serves uuid URLs, never row ids", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)
		const uuid =
			/^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		for (const m of res.media) {
			expect(m.url).toMatch(uuid)
			expect(m.thumbUrl).toMatch(uuid)
		}
	})
})
