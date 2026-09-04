/**
 * The media management handlers (28, resplit by 0182).
 *
 * The rule under test throughout is that *managing* a blob is owner-only, and
 * deliberately narrower than viewing it: `canViewMedia` lets a shared character
 * carry its gallery to a session guest, but that guest must never be able to
 * delete, re-cut or re-scope someone else's image.
 *
 * The second rule, new to 0182, is that this panel is the ONLY place a variant
 * is queried — and that what it sends is still metadata. A `variants` row is
 * the only place an on-disk path lives now, so the path-leak assertion below is
 * load-bearing in a way it was not before: it is what proves nobody spread one
 * into a response.
 */
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
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
	const { file } = await createMedia(db, {
		userId: ownerId,
		characterId: charId,
		bytes: png(seed),
		filename
	})
	return file
}

/** Straight at the table, because the whole point of the split is that no
 *  payload builder reads it. */
async function variantsOf(fileId: number) {
	return db
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.fileId, fileId))
}

async function fileRow(fileId: number) {
	const [row] = await db
		.select()
		.from(schema.files)
		.where(eq(schema.files.id, fileId))
	return row ?? null
}

describe("media:list", () => {
	test("returns the owner's files with labels, and what each one stores", async () => {
		const { mediaList } = await import("./media")
		await makeImage(1, "one.png")
		await makeImage(2, "two.png")

		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)

		expect(res.media.length).toBeGreaterThanOrEqual(2)
		// A fresh upload has exactly ONE representation, and it is both the
		// uploaded bytes and what a bare URL serves. That is the healthy state
		// under lazy derivation, not a missing thumbnail.
		for (const m of res.media) {
			expect(m.variants.length).toBeGreaterThanOrEqual(1)
			expect(
				m.variants.some((v) => v.isOriginal && v.isDisplay)
			).toBe(true)
			expect(m.storedBytes).toBeGreaterThan(0)
		}
		expect(res.media[0].attachedTo).toEqual({
			type: "character",
			id: charId,
			name: "Owner Char"
		})
		expect(res.totalBytes).toBeGreaterThan(0)
	})

	test("no longer carries the removed thumbnail fields", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)
		// Both were symptoms of one table doing two jobs: a payload needed a
		// second query for its thumbnail, and "does one exist" was a warning
		// the panel showed. Lazy derivation makes "not yet" the normal state,
		// so the fields went rather than being re-wired.
		expect(res.media[0]).not.toHaveProperty("thumbMediaId")
		expect(res.media[0]).not.toHaveProperty("hasThumbnail")
	})

	test("never leaks a filesystem path", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)
		// Independent of the unit-level check on `toClientMedia`: this is the
		// whole response, including the variant rows that are the only thing
		// holding a path at all.
		expect(JSON.stringify(res)).not.toContain(dataDir)
		expect(JSON.stringify(res)).not.toContain("data/users")
		for (const m of res.media)
			for (const v of m.variants) expect(v).not.toHaveProperty("path")
	})

	test("shows nothing of another user's", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(otherId), {}, emit)
		expect(res.media).toHaveLength(0)
	})

	test("sorts by what storing a file costs, not what showing it costs", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const largest = await mediaList.handler(
			fakeSocket(ownerId),
			{ sort: "largest" },
			emit
		)
		const stored = largest.media.map((m) => m.storedBytes)
		expect([...stored].sort((a, b) => b - a)).toEqual(stored)

		const smallest = await mediaList.handler(
			fakeSocket(ownerId),
			{ sort: "smallest" },
			emit
		)
		const asc = smallest.media.map((m) => m.storedBytes)
		expect([...asc].sort((a, b) => a - b)).toEqual(asc)
	})
})

describe("media:regenerateThumbnail", () => {
	test("derives the thumb variant and replaces it on a second run", async () => {
		const { mediaRegenerateThumbnail } = await import("./media")
		const row = await makeImage(3, "regen.png")
		// Nothing is derived on upload any more, so the first regenerate is
		// also the first derivation.
		expect((await variantsOf(row.id)).map((v) => v.variant)).toEqual([
			MediaVariant.ORIGINAL
		])

		const { emit } = captureEmits()
		const res = await mediaRegenerateThumbnail.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id },
			emit
		)
		expect(res.regenerated).toBe(true)

		const after = await variantsOf(row.id)
		const thumb = after.find((v) => v.variant === MediaVariant.THUMB)
		expect(thumb).toBeTruthy()
		expect(thumb!.cache).toBe(true)

		// Again. The handler dropping the existing row first is the whole
		// behaviour under test — `ensureVariant` returns what is already there,
		// which is what makes it safe on a render path and useless as a "redo
		// this" button on its own.
		await mediaRegenerateThumbnail.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id },
			emit
		)
		const again = await variantsOf(row.id)
		expect(
			again.filter((v) => v.variant === MediaVariant.THUMB)
		).toHaveLength(1)
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
	test("writes one row, because there is no second copy left to drift", async () => {
		const { mediaSetVisibility } = await import("./media")
		const row = await makeImage(5)
		const { emit } = captureEmits()
		await mediaSetVisibility.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id, visibility: "private" },
			emit
		)
		expect((await fileRow(row.id))!.visibility).toBe("private")
		// The old handler wrote `visibility` twice to keep a derivative in
		// step. The column is gone from the variant, so the duplicated-state
		// bug class is structurally absent rather than handled.
		for (const v of await variantsOf(row.id))
			expect(v).not.toHaveProperty("visibility")
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
	test("removes every representation and clears the avatar pointer it fed", async () => {
		const { mediaDelete } = await import("./media")
		const row = await makeImage(7)
		await db
			.update(schema.characters)
			.set({ avatarMediaId: row.id })
			.where(eq(schema.characters.id, charId))

		const { emit } = captureEmits()
		await mediaDelete.handler(fakeSocket(ownerId), { mediaId: row.id }, emit)

		expect(await fileRow(row.id)).toBeNull()
		// The one operation allowed to leave a file with no representations,
		// because it takes the file row with them.
		expect(await variantsOf(row.id)).toHaveLength(0)
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

describe("rev as the cache token", () => {
	test("regenerating bumps rev and leaves the uuid alone", async () => {
		const { mediaRegenerateThumbnail } = await import("./media")
		const row = await makeImage(9, "rotate.png")

		const { emit } = captureEmits()
		await mediaRegenerateThumbnail.handler(
			fakeSocket(ownerId),
			{ mediaId: row.id },
			emit
		)

		const after = (await fileRow(row.id))!
		// The property is unchanged from when the uuid rotated: what the URL
		// serves changed, so the URL string had to change. The mechanism moved,
		// because one uuid is now shared by every variant of the file and
		// rotating it would re-address representations whose bytes are
		// untouched.
		expect(after.rev).toBeGreaterThan(row.rev)
		expect(after.uuid).toBe(row.uuid)
	})

	test("the list serves uuid URLs carrying rev, never row ids", async () => {
		const { mediaList } = await import("./media")
		const { emit } = captureEmits()
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)
		const uuid =
			"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
		for (const m of res.media) {
			expect(m.url).toMatch(new RegExp(`^/media/${uuid}\\?r=\\d+$`))
			expect(m.thumbUrl).toMatch(
				new RegExp(`^/media/${uuid}\\?v=thumb&r=\\d+$`)
			)
			expect(m.originalUrl).toMatch(
				new RegExp(`^/media/${uuid}\\?v=original&r=\\d+$`)
			)
		}
	})
})
