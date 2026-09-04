/**
 * The media module's contract (28, phase A; resplit by 0182).
 *
 * Five things are worth a test here because each one is an invariant that
 * something else in the codebase now relies on rather than re-checks: per-user
 * dedupe, the path-derivation precedence, the two-layer permission model, that
 * a derived representation is absent until something asks for it, and — the one
 * with teeth — that a client payload cannot carry a filesystem path.
 *
 * Two more earned their place later, both about a representation that is NOT
 * the one asked for: an animated upload keeping itself rather than being
 * flattened into a display form, and `readMedia` falling back from a culled
 * original to the display form VISIBLY, because two export handlers read that
 * fallback to choose which of two errors to report.
 */
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest"
import crypto from "node:crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	MediaFidelity,
	MediaVariant
} from "$lib/shared/constants/MediaVisibility"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FileRow } from "./index"

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

/** A PNG with pixels to spare, for the assertions about a thumbnail's
 *  dimensions. One channel varies so it does not compress to nothing and make
 *  "the thumbnail is smaller" vacuous. */
function bigPng(width: number, height: number, seed: number): Buffer {
	const p = new PNG({ width, height })
	for (let i = 0; i < p.data.length; i += 4) {
		p.data[i] = seed
		p.data[i + 1] = i % 255
		p.data[i + 2] = 200
		p.data[i + 3] = 255
	}
	return PNG.sync.write(p)
}

async function variantsOf(fileId: number) {
	return db
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.fileId, fileId))
}

/** The stored thumbnail, or undefined when nothing has asked for one yet —
 *  which since 0182 is the state a fresh upload is in. */
async function thumbOf(fileId: number) {
	return (await variantsOf(fileId)).find(
		(v) => v.variant === MediaVariant.THUMB
	)
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

/**
 * An animated WebP, written byte by byte.
 *
 * There is no encoder in this build that can produce one (`@jsquash/webp`
 * exports a single-frame `encode`), and none is needed: what the upload path
 * reads is the RIFF chunk list — the `VP8X` animation flag, the `ANIM` chunk
 * and one `ANMF` header per frame, each carrying a 24-bit duration in ms.
 * `convert/convert.test.ts` covers the parser itself against every container
 * shape; this is the one fixture the upload path needs.
 */
function animatedWebp(frames = 3, durationMs = 120): Buffer {
	const u32 = (value: number) => {
		const b = Buffer.alloc(4)
		b.writeUInt32LE(value)
		return b
	}
	const u24 = (value: number) => {
		const b = Buffer.alloc(3)
		b.writeUIntLE(value, 0, 3)
		return b
	}
	const chunk = (fourCC: string, payload: Buffer) =>
		Buffer.concat([
			Buffer.from(fourCC, "latin1"),
			u32(payload.length),
			payload,
			payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
		])
	const body = Buffer.concat([
		Buffer.from("WEBP", "latin1"),
		chunk(
			"VP8X",
			Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(7), u24(7)])
		),
		chunk("ANIM", Buffer.alloc(6)),
		...Array.from({ length: frames }, () =>
			chunk(
				"ANMF",
				Buffer.concat([
					u24(0),
					u24(0),
					u24(7),
					u24(7),
					u24(durationMs),
					Buffer.from([0]),
					chunk("VP8L", Buffer.alloc(8, 1))
				])
			)
		)
	])
	return Buffer.concat([
		Buffer.from("RIFF", "latin1"),
		u32(body.length),
		body
	])
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

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
		expect(second.file.id).toBe(first.file.id)
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
		expect(rowB.file.id).not.toBe(rowA.file.id)
		expect(rowB.file.hash).toBe(rowA.file.hash)
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
			mediaRelPath({ ...base, characterId: 1, sessionId: 3 }, "h", "png")
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

	test("a variant resolves from its file's provenance, not from a stored path", async () => {
		const { variantRelPath } = await import("./paths")
		// This test used to assert the opposite, and it had to: a derivative
		// carried no provenance of its own, so the only thing it could derive a
		// location from was string surgery on its parent's stored path. 0182
		// put provenance on the file, so every variant of a file answers to the
		// same rule as its original and there is no parse left to get wrong.
		expect(
			variantRelPath(
				{ userId: 7, characterId: 1, hash: "abc" },
				MediaVariant.THUMB,
				"webp"
			)
		).toBe(path.join("data/users/7/characters/1", "abc.thumb.webp"))
		// The one case where the two answers differ: `bucket` is not a column,
		// so provenance cannot reproduce it and a background's variant lands in
		// `uploads` rather than beside its original. Harmless — a variant is
		// always resolved through its own stored path — and pinned here so it
		// does not read as a bug later.
		expect(
			variantRelPath(
				{ userId: 7, hash: "abc" },
				MediaVariant.THUMB,
				"webp"
			)
		).toBe(path.join("data/users/7/uploads", "abc.thumb.webp"))
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
		const created = await createMedia(db, {
			userId: owner.id,
			characterId: c.id,
			bytes: png(11)
		})

		expect(await canViewMedia(created.file, owner.id)).toBe(true)
		expect(await canViewMedia(created.file, guest.id)).toBe(false)

		// Share the character into a session the guest participates in. No
		// second grant on the media: it inherits, which is the point.
		const s = await session(owner.id)
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: c.id })
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id })

		expect(await canViewMedia(created.file, guest.id)).toBe(true)
		expect(await canViewMedia(created.file, stranger.id)).toBe(false)
	})

	test("private narrows what scoped would have allowed", async () => {
		const { createMedia, canViewMedia } = await import("./index")
		const { MediaVisibility } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		const owner = await createTestUser(db, "media-priv-owner")
		const guest = await createTestUser(db, "media-priv-guest")
		const c = await character(owner.id, "Private")
		const created = await createMedia(db, {
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
		expect(await canViewMedia(created.file, guest.id)).toBe(false)
		expect(await canViewMedia(created.file, owner.id)).toBe(true)
	})

	test("a personal blob with no entity parent is owner-only", async () => {
		const { createMedia, canViewMedia } = await import("./index")
		const owner = await createTestUser(db, "media-bg-owner")
		const other = await createTestUser(db, "media-bg-other")
		const created = await createMedia(db, {
			userId: owner.id,
			bytes: png(13),
			bucket: "backgrounds"
		})
		expect(await canViewMedia(created.file, owner.id)).toBe(true)
		expect(await canViewMedia(created.file, other.id)).toBe(false)
	})

	// A fourth test used to sit here: that a thumbnail was judged by its
	// original rather than by itself, because a derivative lived in this table
	// with all four provenance columns NULL and would otherwise have been
	// owner-only. It is gone rather than updated, because there is no longer
	// anything to assert — `canViewMedia` takes a FILE row, a variant has no
	// provenance columns to be judged by, and no access-checked path resolves
	// one without its file. The mechanism stopped existing (0182) instead of
	// being fixed, and TypeScript now refuses the call the test was making.
})

describe("toClientMedia — the path never leaves the server", () => {
	test("no field of a client payload contains the on-disk path", async () => {
		const { createMedia, toClientMedia } = await import("./index")
		const user = await createTestUser(db, "media-payload-user")
		const c = await character(user.id, "Payload")
		const created = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(15),
			filename: "portrait.png"
		})

		const payload = toClientMedia(created.file)
		// The path lives on the variant, and `toClientMedia` is not handed that
		// row at all — so the leak is two type errors deep rather than a review
		// catch.
		expect(created.original.path).toBeTruthy()
		expect(JSON.stringify(payload)).not.toContain(created.original.path)
		expect(JSON.stringify(payload)).not.toContain(dataDir)
		expect((payload as any).path).toBeUndefined()
		// What it does carry is a proxy addressed by uuid, not a location —
		// and not the row id either, so the size of the instance's media table
		// does not leak into a URL. `r` rides along as a cache token.
		//
		// Asserted as an equality, not an absence. `not.toContain(String(row.id))`
		// was non-deterministic: the url is `/media/<uuid>` and `row.id` is a
		// small identity integer, so the assertion failed whenever the random
		// uuid happened to contain that digit — which for a single-digit id is
		// most of the time. What the test MEANS is that the url is keyed by uuid.
		expect(payload.url).toBe(
			`/media/${created.file.uuid}?r=${created.file.rev}`
		)
		expect(payload.filename).toBe("portrait.png")
	})
})

describe("mediaFor — grouping and ordering", () => {
	test("returns files only, in position order, without a variant filter", async () => {
		const { createMedia, ensureVariant, mediaFor, reorderMedia } =
			await import("./index")
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

		// Derived deliberately: the claim is that a stored representation
		// cannot appear in its parent's listing, and a file holding nothing but
		// its original would not test it.
		await ensureVariant(db, a.file, MediaVariant.THUMB)
		expect((await variantsOf(a.file.id)).map((v) => v.variant)).toContain(
			MediaVariant.THUMB
		)

		// The `variant IS NULL` filter this used to need is gone: a variant has
		// no `characterId` column at all, so it is unreachable from here
		// structurally rather than by a filter every call site had to remember.
		let rows = await mediaFor(db, { characterId: c.id })
		expect(rows.map((r) => r.id)).toEqual([a.file.id, b.file.id])

		await reorderMedia(db, { characterId: c.id }, [b.file.id, a.file.id])
		rows = await mediaFor(db, { characterId: c.id })
		expect(rows.map((r) => r.id)).toEqual([b.file.id, a.file.id])
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

describe("deleteFile", () => {
	test("removes the file row, every variant of it, and the bytes", async () => {
		const { createMedia, deleteFile, ensureVariant, getMedia } =
			await import("./index")
		const { resolveMediaPath } = await import("./paths")
		const user = await createTestUser(db, "media-delete-user")
		const c = await character(user.id, "Deletable")
		const created = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes: png(41)
		})
		// Derived first, because the case worth asserting is a file with more
		// than one stored representation and laziness means a fresh upload has
		// exactly one.
		await ensureVariant(db, created.file, MediaVariant.THUMB)
		const before = await variantsOf(created.file.id)
		expect(before.map((v) => v.variant).sort()).toEqual([
			MediaVariant.ORIGINAL,
			MediaVariant.THUMB
		])

		await deleteFile(db, created.file.id)

		// The one operation allowed to leave nothing behind — the file itself
		// is going away, so there is nothing left to orphan.
		expect(await getMedia(db, created.file.id)).toBeNull()
		expect(await variantsOf(created.file.id)).toHaveLength(0)
		for (const variant of before) {
			await expect(
				fs.access(resolveMediaPath(variant.path))
			).rejects.toBeTruthy()
		}
	})
})

describe("uuid addressing", () => {
	test("holds the uuid when a thumbnail is re-cut, and bumps rev instead", async () => {
		const { createMedia, ensureVariant, getMedia } = await import("./index")
		const { backfillThumbnails } = await import("./backfill")
		const user = await createTestUser(db, "media-uuid-rotate-user")
		const created = await createMedia(db, {
			userId: user.id,
			bytes: bigPng(800, 600, 12)
		})
		await ensureVariant(db, created.file, MediaVariant.THUMB)
		const before = (await getMedia(db, created.file.id))!
		const thumbBefore = (await thumbOf(created.file.id))!

		// Pretend it was cut under the old 320px target — the one case laziness
		// cannot cover, because the row exists and so nothing will ever ask for
		// it again.
		await db
			.update(schema.variants)
			.set({ width: 320, height: 240 })
			.where(eq(schema.variants.id, thumbBefore.id))
		await backfillThumbnails()

		const after = (await getMedia(db, created.file.id))!
		// This test used to assert the uuid ROTATED here, and to delete and
		// re-cut the derivative by hand to make it. 0182 reversed that: one
		// uuid per file, shared by every variant, is what lets a render site
		// address the thumbnail of a file it already holds without a second
		// query. `rev` carries invalidation instead — and it has to move,
		// because the bytes behind an already-served immutable URL just
		// changed.
		expect(after.uuid).toBe(before.uuid)
		expect(after.rev).toBeGreaterThan(before.rev)
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
		expect(a.file.uuid).not.toBe(b.file.uuid)

		// Reordering changes `position`, not the bytes — so the address must
		// hold, or every reorder would bust every cached image in the gallery.
		await reorderMedia(db, { characterId: c.id }, [b.file.id, a.file.id])
		expect((await getMedia(db, a.file.id))!.uuid).toBe(a.file.uuid)
	})
})

describe("thumbnails", () => {
	test("do not exist until something asks for one", async () => {
		const { createMedia, ensureVariant } = await import("./index")
		const user = await createTestUser(db, "media-thumb-lazy-user")
		const created = await createMedia(db, {
			userId: user.id,
			bytes: png(61)
		})
		// The behaviour 0182 deliberately reversed. An upload used to encode a
		// thumbnail inline, which meant a codec problem could stall or fail the
		// upload itself; the first request pays now, where the cost can fall
		// back to the display form. A lone original is the healthy state.
		expect(
			(await variantsOf(created.file.id)).map((v) => v.variant)
		).toEqual([MediaVariant.ORIGINAL])

		await ensureVariant(db, created.file, MediaVariant.THUMB)
		expect(await thumbOf(created.file.id)).toBeTruthy()
	})

	test("are capped at the long edge with aspect preserved", async () => {
		const { createMedia, ensureVariant } = await import("./index")
		const { THUMB_MAX_EDGE } = await import("./thumbnail")
		const user = await createTestUser(db, "media-thumb-size-user")
		const created = await createMedia(db, {
			userId: user.id,
			bytes: bigPng(1200, 800, 71)
		})
		await ensureVariant(db, created.file, MediaVariant.THUMB)

		const thumb = await thumbOf(created.file.id)
		expect(thumb).toBeTruthy()
		expect(Math.max(thumb!.width!, thumb!.height!)).toBe(THUMB_MAX_EDGE)
		// 1200x800 is 3:2; the thumbnail has to still be 3:2.
		expect(thumb!.width! / thumb!.height!).toBeCloseTo(1200 / 800, 2)
		expect(thumb!.bytes).toBeLessThan(created.original.bytes)
	})

	test("the backfill re-cuts a thumbnail made under a smaller target", async () => {
		const { createMedia, ensureVariant } = await import("./index")
		const { backfillThumbnails } = await import("./backfill")
		const { THUMB_MAX_EDGE } = await import("./thumbnail")
		const user = await createTestUser(db, "media-thumb-stale-user")
		const created = await createMedia(db, {
			userId: user.id,
			bytes: bigPng(1000, 1000, 81)
		})
		await ensureVariant(db, created.file, MediaVariant.THUMB)
		const original = (await thumbOf(created.file.id))!

		// Pretend it was generated under the old 320px target.
		await db
			.update(schema.variants)
			.set({ width: 320, height: 320 })
			.where(eq(schema.variants.id, original.id))

		await backfillThumbnails()

		const recut = (await thumbOf(created.file.id))!
		expect(Math.max(recut.width!, recut.height!)).toBe(THUMB_MAX_EDGE)
		// A replacement row, not an edit of the old one — the sweep drops the
		// stale variant and derives a fresh one, which is the only thing that
		// lets `ensureVariant` run at all: it no-ops when a row exists.
		expect(recut.id).not.toBe(original.id)
	})

	test("the backfill leaves an up-to-date thumbnail alone", async () => {
		const { createMedia, ensureVariant } = await import("./index")
		const { backfillThumbnails } = await import("./backfill")
		const user = await createTestUser(db, "media-thumb-fresh-user")
		const created = await createMedia(db, {
			userId: user.id,
			bytes: bigPng(900, 600, 91)
		})
		// Derived here rather than left to the sweep: "the sweep changed
		// nothing" needs a row that existed before it ran.
		await ensureVariant(db, created.file, MediaVariant.THUMB)
		const before = (await thumbOf(created.file.id))!
		await backfillThumbnails()
		expect((await thumbOf(created.file.id))!.id).toBe(before.id)
	})
})

describe("an animated upload keeps itself", () => {
	test("an animated WebP records its duration and refuses a still display form", async () => {
		const { createMedia, displayDerivable, ensureVariant, getMedia } =
			await import("./index")
		const user = await createTestUser(db, "media-anim-webp-user")
		const created = await createMedia(db, {
			userId: user.id,
			bytes: animatedWebp(3, 120),
			filename: "spin.webp"
		})

		// The upload probe reads the container, so the row can say "animated"
		// without anything decoding a frame — which matters here, because the
		// webp decoder in this build cannot decode an animated file at all.
		expect((await getMedia(db, created.file.id))!.durationMs).toBe(360)

		// WebP is web-safe, so the original IS the display form and there is no
		// second copy — exactly what an animated GIF gets.
		expect(created.file.displayVariantId).toBe(created.original.id)
		expect(created.file.displayMime).toBe("image/webp")

		// And an explicit `?v=display` declines rather than storing a flattened
		// still. Null, not a throw: a failed derivation falls back to the
		// display form, which here is the animation itself.
		expect(
			await ensureVariant(db, created.file, MediaVariant.DISPLAY)
		).toBeNull()
		expect(
			(await variantsOf(created.file.id)).map((v) => v.variant)
		).toEqual([MediaVariant.ORIGINAL])

		// …and the column is NOT what stands between the file and a flatten. A
		// row written before this format was probed carries a null duration,
		// which the cheap gate reads as "nothing forbids it" — so the refusal
		// has to come from the BYTES, and does.
		await db
			.update(schema.files)
			.set({ durationMs: null })
			.where(eq(schema.files.id, created.file.id))
		const silent = (await getMedia(db, created.file.id))!
		expect(displayDerivable(silent).ok).toBe(true)
		expect(await ensureVariant(db, silent, MediaVariant.DISPLAY)).toBeNull()
		expect(
			(await variantsOf(created.file.id)).map((v) => v.variant)
		).toEqual([MediaVariant.ORIGINAL])
	})
})

/**
 * Give a file a real, stored DISPLAY variant: bytes from the conversion router,
 * row inserted here.
 *
 * `ensureVariant(…, DISPLAY)` is the production path and it is deliberately
 * ALLOWED to decline — a lossless WebP of a photograph is routinely larger than
 * its source, and `deriveDisplay` throws such an encode away rather than
 * growing the library — so a test that needs a SECOND full-fidelity row cannot
 * bet on what the encoder happened to produce for one picture. Same reason
 * `mediaCleanup.int.test.ts` builds its fixtures by hand; the bytes are still
 * real, and still the router's.
 */
async function withDisplayVariant(file: FileRow, source: Buffer) {
	const { convertMedia, variantRelPath, resolveMediaPath } = await import(
		"./index"
	)
	const encoded = await convertMedia(
		{ bytes: source, mime: "image/png" },
		"image/webp",
		{ lossless: true }
	)
	if (!encoded.ok) throw new Error(encoded.reason)

	const relPath = variantRelPath(file, MediaVariant.DISPLAY, encoded.ext)
	const abs = resolveMediaPath(relPath)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, encoded.bytes)

	const [row] = await db
		.insert(schema.variants)
		.values({
			fileId: file.id,
			variant: MediaVariant.DISPLAY,
			mime: encoded.mime,
			bytes: encoded.bytes.byteLength,
			path: relPath,
			hash: crypto
				.createHash("sha256")
				.update(encoded.bytes)
				.digest("hex"),
			width: encoded.width,
			height: encoded.height,
			isOriginal: false,
			// NOT a cache entry — the display form is the file's default
			// representation, and the safe sweep must never take it.
			cache: false,
			fidelity: MediaFidelity.FULL
		})
		.returning()
	return { row, bytes: encoded.bytes }
}

describe("readMedia — the culled-original fallback", () => {
	test("resolves the display form and reports that it is NOT the original", async () => {
		const { createMedia, cullVariant, readMedia } = await import("./index")
		const user = await createTestUser(db, "media-culled-read-user")
		const c = await character(user.id, "Culled")
		const bytes = bigPng(600, 400, 33)
		const created = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes,
			filename: "avatar.png"
		})
		const display = await withDisplayVariant(created.file, bytes)

		const culled = await cullVariant(db, created.original.id)
		expect(culled.ok).toBe(true)
		// The original was also the display target, as every web-safe upload's
		// is, so the pointer had to move before the bytes could go.
		expect(culled.ok && culled.repointed).toBe(true)

		const read = await readMedia(db, created.file.id, MediaVariant.ORIGINAL)
		expect(read).toBeTruthy()
		// The fallback is VISIBLE, and that is the whole contract: two export
		// handlers read `row.isOriginal` to tell a storage decision apart from
		// a format problem, and a fallback that looked like the original would
		// make both of them report the wrong one.
		expect(read!.row.isOriginal).toBe(false)
		expect(read!.variant).toBe(MediaVariant.DISPLAY)
		expect(read!.mime).toBe("image/webp")
		expect(read!.bytes.equals(display.bytes)).toBe(true)
	})

	test("a card export blames the culled original, not the mime it fell back to", async () => {
		const { createMedia, cullVariant } = await import("./index")
		const { charactersExportCard } = await import(
			"$lib/server/sockets/characters"
		)
		const user = await createTestUser(db, "media-culled-export-user")
		const c = await character(user.id, "Exportable")
		const bytes = bigPng(320, 320, 44)
		const created = await createMedia(db, {
			userId: user.id,
			characterId: c.id,
			bytes,
			filename: "avatar.png"
		})
		await withDisplayVariant(created.file, bytes)
		await db
			.update(schema.characters)
			.set({ avatarMediaId: created.file.id })
			.where(eq(schema.characters.id, c.id))

		// The export works while the original is stored — otherwise the
		// negative assertion below would pass for the wrong reason.
		const exported = await charactersExportCard.handler(
			fakeSocket(user.id),
			{ id: c.id, format: "png" },
			noopEmit
		)
		expect(exported.filename.endsWith(".png")).toBe(true)

		expect((await cullVariant(db, created.original.id)).ok).toBe(true)

		// Now `readMedia` hands back the WebP display form, and TWO things are
		// true of it: it is not the original, and it is not a PNG. The handler
		// checks them in the order that names the cause — reporting the mime
		// would send someone to re-upload a PNG they already uploaded.
		const err = await charactersExportCard
			.handler(fakeSocket(user.id), { id: c.id, format: "png" }, noopEmit)
			.then(() => null)
			.catch((e: unknown) => e as Error)
		expect(err).toBeInstanceOf(Error)
		expect(err!.message).toContain("no longer stored in its original form")
		expect(err!.message).not.toContain("isn't a PNG")
	})
})
