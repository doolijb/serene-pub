/**
 * The media module's contract (28, phase A).
 *
 * Four things are worth a test here because each one is an invariant that
 * something else in the codebase now relies on rather than re-checks:
 * per-user dedupe, the path-derivation precedence, the two-layer permission
 * model, and — the one with teeth — that a client payload cannot carry a
 * filesystem path.
 */
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

// The first createMedia() call compiles the webp encoder wasm, which is well
// past the 5s default on a loaded machine. A per-test budget, not a flake.
vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let dataDir: string

// `canViewMedia` reaches sessionAccess, which resolves the `$lib/server/db`
// singleton rather than taking a handle — so the module has to be the test
// database, not merely called with it.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

async function createTestUser(dbh: TestDb, username: string) {
	const mod = await import("$lib/server/utils/testDb")
	return mod.createTestUser(dbh, username)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-media-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function png(seed = 255): Buffer {
	const p = new PNG({ width: 2, height: 2 })
	for (let i = 0; i < p.data.length; i += 4) {
		p.data[i] = seed
		p.data[i + 1] = 200
		p.data[i + 2] = 100
		p.data[i + 3] = 255
	}
	return PNG.sync.write(p)
}

async function character(userId: number, name: string) {
	const [row] = await db
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return row
}

async function persona(userId: number, name: string) {
	const [row] = await db
		.insert(schema.personas)
		.values({ userId, name, description: "", isDefault: false })
		.returning()
	return row
}

async function session(userId: number) {
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId, name: "S", isGroup: false })
		.returning()
	return row
}

describe("createMedia — dedupe", () => {
	test("identical bytes from one user become one row", async () => {
		const { createMedia } = await import("./index")
		const user = await createTestUser(db, "media-dedupe-a")
		const c = await character(user.id, "C")
		const first = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png()
		})
		const second = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png()
		})
		expect(second.id).toBe(first.id)
	})

	test("identical bytes from two users stay separate", async () => {
		const { createMedia } = await import("./index")
		const a = await createTestUser(db, "media-dedupe-b1")
		const b = await createTestUser(db, "media-dedupe-b2")
		const rowA = await createMedia(db, { userId: a.id, bytes: png(3) })
		const rowB = await createMedia(db, { userId: b.id, bytes: png(3) })
		// Dedupe is per-user by design: instance-wide would put one account's
		// blob lifetime under another's, and make an upload observable by hash
		// timing.
		expect(rowB.id).not.toBe(rowA.id)
		expect(rowB.hash).toBe(rowA.hash)
	})
})

describe("mediaRelPath — deepest known parent wins", () => {
	test("applies one fixed precedence for every source", async () => {
		const { mediaRelPath } = await import("./paths")
		const base = { userId: 7 }
		expect(
			mediaRelPath({ ...base, sessionId: 3, messageId: 9 }, "h", "png")
		).toBe(path.join("data/users/7/sessions/3", "h.png"))
		// A message asset is a session asset: the message is a finer stamp,
		// not a different place on disk.
		expect(
			mediaRelPath(
				{ ...base, characterId: 1, sessionId: 3 },
				"h",
				"png"
			)
		).toBe(path.join("data/users/7/sessions/3", "h.png"))
		expect(mediaRelPath({ ...base, characterId: 1 }, "h", "png")).toBe(
			path.join("data/users/7/characters/1", "h.png")
		)
		expect(mediaRelPath({ ...base, personaId: 2 }, "h", "png")).toBe(
			path.join("data/users/7/personas/2", "h.png")
		)
		expect(mediaRelPath(base, "h", "png")).toBe(
			path.join("data/users/7/uploads", "h.png")
		)
		expect(mediaRelPath(base, "h", "png", { bucket: "backgrounds" })).toBe(
			path.join("data/users/7/backgrounds", "h.png")
		)
	})

	test("a derivative resolves from its parent's path, not its own provenance", async () => {
		const { derivativeRelPath } = await import("./paths")
		expect(
			derivativeRelPath("data/users/7/characters/1/abc.png", "thumb", "webp")
		).toBe(path.join("data/users/7/characters/1", "abc.thumb.webp"))
	})

	test("a path escaping the data dir is refused", async () => {
		const { resolveMediaPath } = await import("./paths")
		expect(() => resolveMediaPath("../../etc/passwd")).toThrow(
			/outside the data directory/
		)
	})
})

describe("canViewMedia — two layers", () => {
	test("scoped media inherits the character's sharing", async () => {
		const { createMedia, canViewMedia } = await import("./index")
		const owner = await createTestUser(db, "media-perm-owner")
		const guest = await createTestUser(db, "media-perm-guest")
		const stranger = await createTestUser(db, "media-perm-stranger")
		const c = await character(owner.id, "Shared")
		const row = await createMedia(db, {
			userId: owner.id,
			characterId: c.id,
			bytes: png(11)
		})

		expect(await canViewMedia(row, owner.id)).toBe(true)
		expect(await canViewMedia(row, guest.id)).toBe(false)

		// Share the character into a session the guest participates in. No
		// second grant on the media: it inherits, which is the point.
		const s = await session(owner.id)
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id })
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id })

		expect(await canViewMedia(row, guest.id)).toBe(true)
		expect(await canViewMedia(row, stranger.id)).toBe(false)
	})

	test("private narrows what scoped would have allowed", async () => {
		const { createMedia, canViewMedia } = await import("./index")
		const { MediaVisibility } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		const owner = await createTestUser(db, "media-priv-owner")
		const guest = await createTestUser(db, "media-priv-guest")
		const c = await character(owner.id, "Private")
		const row = await createMedia(db, {
			userId: owner.id,
			characterId: c.id,
			bytes: png(12),
			visibility: MediaVisibility.PRIVATE
		})
		const s = await session(owner.id)
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id })
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id })

		// The guest can see the character; the image is still the owner's.
		expect(await canViewMedia(row, guest.id)).toBe(false)
		expect(await canViewMedia(row, owner.id)).toBe(true)
	})

	test("a personal blob with no entity parent is owner-only", async () => {
		const { createMedia, canViewMedia } = await import("./index")
		const owner = await createTestUser(db, "media-bg-owner")
		const other = await createTestUser(db, "media-bg-other")
		const row = await createMedia(db, {
			userId: owner.id,
			bytes: png(13),
			bucket: "backgrounds"
		})
		expect(await canViewMedia(row, owner.id)).toBe(true)
		expect(await canViewMedia(row, other.id)).toBe(false)
	})

	test("a thumbnail is judged by its original, never by itself", async () => {
		const { createMedia, canViewMedia, thumbsByParent } = await import(
			"./index"
		)
		const owner = await createTestUser(db, "media-thumb-owner")
		const guest = await createTestUser(db, "media-thumb-guest")
		const c = await character(owner.id, "ThumbShare")
		const original = await createMedia(db, {
			userId: owner.id,
			characterId: c.id,
			bytes: png(14)
		})
		const thumb = (await thumbsByParent(db, [original.id])).get(original.id)
		expect(thumb).toBeTruthy()
		// The thumbnail itself carries no characterId at all, so without
		// resolving the parent this would be owner-only.
		expect(thumb!.characterId).toBeNull()

		const s = await session(owner.id)
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id })
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id })

		expect(await canViewMedia(thumb!, guest.id)).toBe(true)
	})
})

describe("toClientMedia — the path never leaves the server", () => {
	test("no field of a client payload contains the on-disk path", async () => {
		const { createMedia, toClientMedia } = await import("./index")
		const user = await createTestUser(db, "media-payload-user")
		const c = await character(user.id, "Payload")
		const row = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(15),
			filename: "portrait.png"
		})

		const payload = toClientMedia(row)
		expect(row.path).toBeTruthy()
		expect(JSON.stringify(payload)).not.toContain(row.path)
		expect(JSON.stringify(payload)).not.toContain(dataDir)
		expect((payload as any).path).toBeUndefined()
		// What it does carry is a proxy addressed by uuid, not a location —
		// and not the row id either, so the size of the instance's media table
		// does not leak into a URL.
		expect(payload.url).toBe(`/media/${row.uuid}`)
		expect(payload.url).not.toContain(String(row.id))
		expect(payload.filename).toBe("portrait.png")
	})
})

describe("mediaFor — grouping and ordering", () => {
	test("returns originals only, in position order, without a variant filter", async () => {
		const { createMedia, mediaFor, reorderMedia } = await import("./index")
		const user = await createTestUser(db, "media-order-user")
		const c = await character(user.id, "Ordered")
		const a = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(21),
			position: 0
		})
		const b = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(22),
			position: 1
		})

		// Both originals generated thumbnails; none of them appear here,
		// because a thumbnail has no characterId to match on.
		let rows = await mediaFor(db, { characterId: c.id })
		expect(rows.map((r) => r.id)).toEqual([a.id, b.id])
		expect(rows.every((r) => r.variant === null)).toBe(true)

		await reorderMedia(db, { characterId: c.id }, [b.id, a.id])
		rows = await mediaFor(db, { characterId: c.id })
		expect(rows.map((r) => r.id)).toEqual([b.id, a.id])
	})

	test("a persona's media does not leak into a character's", async () => {
		const { createMedia, mediaFor } = await import("./index")
		const user = await createTestUser(db, "media-scope-user")
		const c = await character(user.id, "C2")
		const p = await persona(user.id, "P2")
		await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(31)
		})
		await createMedia(db, {
			userId: user.id,
			personaId: p.id,
			bytes: png(32)
		})
		expect(await mediaFor(db, { characterId: c.id })).toHaveLength(1)
		expect(await mediaFor(db, { personaId: p.id })).toHaveLength(1)
	})
})

describe("deleteMedia", () => {
	test("removes the row, its file, and its derivative", async () => {
		const { createMedia, deleteMedia, getMedia, thumbsByParent } =
			await import("./index")
		const { resolveMediaPath } = await import("./paths")
		const user = await createTestUser(db, "media-delete-user")
		const c = await character(user.id, "Deletable")
		const row = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(41)
		})
		const thumb = (await thumbsByParent(db, [row.id])).get(row.id)
		expect(thumb).toBeTruthy()

		await deleteMedia(db, row.id)

		expect(await getMedia(db, row.id)).toBeNull()
		expect(await getMedia(db, thumb!.id)).toBeNull()
		await expect(
			fs.access(resolveMediaPath(row.path))
		).rejects.toBeTruthy()
		await expect(
			fs.access(resolveMediaPath(thumb!.path))
		).rejects.toBeTruthy()
	})
})

describe("uuid addressing", () => {
	test("rotates the original's uuid when its thumbnail is re-cut", async () => {
		const { createMedia, deleteMedia, ensureThumbnail, getMedia, thumbsByParent } =
			await import("./index")
		const user = await createTestUser(db, "media-uuid-rotate-user")
		const big = new PNG({ width: 800, height: 600 })
		for (let i = 0; i < big.data.length; i += 4) {
			big.data[i] = 12
			big.data[i + 1] = i % 255
			big.data[i + 2] = 200
			big.data[i + 3] = 255
		}
		const row = await createMedia(db, {
			userId: user.id,
			bytes: PNG.sync.write(big)
		})
		const uuidBefore = (await getMedia(db, row.id))!.uuid
		const thumbBefore = (await thumbsByParent(db, [row.id])).get(row.id)!

		// What the regenerate handler and the backfill both do: drop the old
		// derivative, rotate the parent's address, re-cut.
		const { rotateMediaUuid } = await import("./index")
		await deleteMedia(db, thumbBefore.id)
		await rotateMediaUuid(db, row.id)
		await ensureThumbnail(db, (await getMedia(db, row.id))!)

		const uuidAfter = (await getMedia(db, row.id))!.uuid
		const thumbAfter = (await thumbsByParent(db, [row.id])).get(row.id)!

		// Both addresses change: the thumbnail is a new row with its own uuid,
		// and the original's rotates because what its `?v=thumb` form resolves
		// to is now different. That is what makes an immutable cache safe.
		expect(uuidAfter).not.toBe(uuidBefore)
		expect(thumbAfter.uuid).not.toBe(thumbBefore.uuid)
	})

	test("a uuid is unique per row and stable across an unrelated write", async () => {
		const { createMedia, getMedia, reorderMedia } = await import("./index")
		const user = await createTestUser(db, "media-uuid-stable-user")
		const c = await character(user.id, "UuidStable")
		const a = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(51)
		})
		const b = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(52)
		})
		expect(a.uuid).not.toBe(b.uuid)

		// Reordering changes `position`, not the bytes — so the address must
		// hold, or every reorder would bust every cached image in the gallery.
		await reorderMedia(db, { characterId: c.id }, [b.id, a.id])
		expect((await getMedia(db, a.id))!.uuid).toBe(a.uuid)
	})
})

describe("thumbnails", () => {
	test("are capped at the long edge with aspect preserved", async () => {
		const { createMedia, thumbsByParent } = await import("./index")
		const { THUMB_MAX_EDGE } = await import("./thumbnail")
		const user = await createTestUser(db, "media-thumb-size-user")
		const big = new PNG({ width: 1200, height: 800 })
		for (let i = 0; i < big.data.length; i += 4) {
			big.data[i] = i % 255
			big.data[i + 1] = 90
			big.data[i + 2] = 40
			big.data[i + 3] = 255
		}
		const row = await createMedia(db, {
			userId: user.id,
			bytes: PNG.sync.write(big)
		})
		const thumb = (await thumbsByParent(db, [row.id])).get(row.id)
		expect(thumb).toBeTruthy()
		expect(Math.max(thumb!.width!, thumb!.height!)).toBe(THUMB_MAX_EDGE)
		// 1200x800 is 3:2; the thumbnail has to still be 3:2.
		expect(thumb!.width! / thumb!.height!).toBeCloseTo(1200 / 800, 2)
		expect(thumb!.bytes).toBeLessThan(row.bytes)
	})

	test("the backfill re-cuts a thumbnail made under a smaller target", async () => {
		const { createMedia, thumbsByParent } = await import("./index")
		const { backfillThumbnails } = await import("./backfill")
		const { THUMB_MAX_EDGE } = await import("./thumbnail")
		const user = await createTestUser(db, "media-thumb-stale-user")
		const big = new PNG({ width: 1000, height: 1000 })
		for (let i = 0; i < big.data.length; i += 4) {
			big.data[i] = 50
			big.data[i + 1] = i % 255
			big.data[i + 2] = 10
			big.data[i + 3] = 255
		}
		const row = await createMedia(db, {
			userId: user.id,
			bytes: PNG.sync.write(big)
		})
		const original = (await thumbsByParent(db, [row.id])).get(row.id)!

		// Pretend it was generated under the old 320px target.
		await db
			.update(schema.media)
			.set({ width: 320, height: 320 })
			.where(eq(schema.media.id, original.id))

		await backfillThumbnails()

		const recut = (await thumbsByParent(db, [row.id])).get(row.id)!
		expect(Math.max(recut.width!, recut.height!)).toBe(THUMB_MAX_EDGE)
		// A replacement row, not an edit of the old one — the bytes changed,
		// so the hash and therefore the identity did too.
		expect(recut.id).not.toBe(original.id)
	})

	test("the backfill leaves an up-to-date thumbnail alone", async () => {
		const { createMedia, thumbsByParent } = await import("./index")
		const { backfillThumbnails } = await import("./backfill")
		const user = await createTestUser(db, "media-thumb-fresh-user")
		const big = new PNG({ width: 900, height: 600 })
		for (let i = 0; i < big.data.length; i += 4) {
			big.data[i] = 200
			big.data[i + 1] = 30
			big.data[i + 2] = i % 255
			big.data[i + 3] = 255
		}
		const row = await createMedia(db, {
			userId: user.id,
			bytes: PNG.sync.write(big)
		})
		const before = (await thumbsByParent(db, [row.id])).get(row.id)!
		await backfillThumbnails()
		const after = (await thumbsByParent(db, [row.id])).get(row.id)!
		expect(after.id).toBe(before.id)
	})
})
