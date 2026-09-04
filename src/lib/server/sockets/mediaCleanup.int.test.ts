/**
 * Storage cleanup (0182) — the two cull actions and the cache toggle.
 *
 * These are the handlers that can destroy user data, so what is under test is
 * mostly what they REFUSE to do. The invariants themselves live in
 * `cullVariant`; these tests drive them through the panel's two buttons in both
 * orders, because "cull derived" and "cull originals" are two clicks and a
 * UI-only guard could never hold whichever order an admin makes them in.
 *
 * Each test gets its own user. The cull handlers sweep everything the caller
 * owns, so a shared fixture would make every test depend on the ones before it.
 */
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest"
import crypto from "node:crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import {
	MediaFidelity,
	MediaKind,
	MediaVariant
} from "$lib/shared/constants/MediaVisibility"
import { CULL_ORIGINALS_CONFIRM } from "$lib/shared/constants/MediaCleanup"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

function emit() {
	return (_event: string, _data: any) => {}
}

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

let userSeq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-mediacull-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function freshUser(): Promise<number> {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(db, `media-cull-${++userSeq}`)).id
}

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

/**
 * A file whose representations are inserted directly.
 *
 * `createMedia` can only produce the one shape today's codec stack reaches — a
 * web-safe upload whose original IS its display form — and the states that
 * matter here are the ones where a SECOND full-fidelity row exists and is
 * smaller or larger than the original. That state is what an explicit
 * `?v=display` request leaves behind, and inserting it is the only way to reach
 * it deterministically, without betting a destructive-path test on what an
 * encoder happens to produce for a given picture.
 *
 * Real bytes are written for every row so a cull is unlinking something.
 */
async function handBuilt(opts: {
	userId: number
	kind?: string
	originalMime?: string
	originalBytes: number
	displayBytes?: number
	thumbBytes?: number
	/** Which row the bare URL serves. Defaults to the original, which is what a
	 *  never-converted upload looks like. */
	displayIsOriginal?: boolean
}) {
	const { resolveMediaPath } = await import("$lib/server/media")
	const fileHash = crypto.randomBytes(32).toString("hex")

	const [file] = await db
		.insert(schema.files)
		.values({
			userId: opts.userId,
			kind: opts.kind ?? MediaKind.IMAGE,
			hash: fileHash,
			filename: "hand-built.png",
			width: 900,
			height: 594
		})
		.returning()

	async function write(name: string, bytes: number) {
		const rel = path.join(
			"data",
			"users",
			String(opts.userId),
			"uploads",
			`${fileHash}.${name}`
		)
		const abs = resolveMediaPath(rel)
		await fs.mkdir(path.dirname(abs), { recursive: true })
		const buf = Buffer.alloc(bytes, 7)
		await fs.writeFile(abs, buf)
		return {
			path: rel,
			bytes,
			hash: crypto.createHash("sha256").update(buf).digest("hex")
		}
	}

	const originalFile = await write("original.png", opts.originalBytes)
	const [original] = await db
		.insert(schema.variants)
		.values({
			fileId: file.id,
			variant: MediaVariant.ORIGINAL,
			mime: opts.originalMime ?? "image/png",
			isOriginal: true,
			cache: false,
			fidelity: MediaFidelity.FULL,
			width: 900,
			height: 594,
			...originalFile
		})
		.returning()

	let display: typeof original | null = null
	if (opts.displayBytes !== undefined) {
		const displayFile = await write("display.webp", opts.displayBytes)
		;[display] = await db
			.insert(schema.variants)
			.values({
				fileId: file.id,
				variant: MediaVariant.DISPLAY,
				mime: "image/webp",
				// NOT cache: a display form is the default representation of
				// the file, not an optimisation of it, so the safe sweep must
				// never take it.
				isOriginal: false,
				cache: false,
				fidelity: MediaFidelity.FULL,
				width: 900,
				height: 594,
				...displayFile
			})
			.returning()
	}

	let thumb: typeof original | null = null
	if (opts.thumbBytes !== undefined) {
		const thumbFile = await write("thumb.webp", opts.thumbBytes)
		;[thumb] = await db
			.insert(schema.variants)
			.values({
				fileId: file.id,
				variant: MediaVariant.THUMB,
				mime: "image/webp",
				isOriginal: false,
				cache: true,
				fidelity: MediaFidelity.REDUCED,
				width: 320,
				height: 211,
				...thumbFile
			})
			.returning()
	}

	// The pointer and its denormalised copies are written together, always —
	// they exist only so a payload is one row.
	const target =
		opts.displayIsOriginal === false && display ? display : original
	const [updated] = await db
		.update(schema.files)
		.set({
			displayVariantId: target.id,
			displayMime: target.mime,
			displayBytes: target.bytes
		})
		.where(eq(schema.files.id, file.id))
		.returning()

	return { file: updated, original, display, thumb }
}

async function cullOriginals(userId: number) {
	const { mediaCullOriginals } = await import("./media")
	return mediaCullOriginals.handler(
		fakeSocket(userId),
		{ confirm: CULL_ORIGINALS_CONFIRM },
		emit()
	)
}

async function cullDerived(userId: number) {
	const { mediaCullDerived } = await import("./media")
	return mediaCullDerived.handler(fakeSocket(userId), {}, emit())
}

describe("media:cullDerived", () => {
	test("takes only the re-derivable rows, and does not bump rev", async () => {
		const userId = await freshUser()
		const { file, thumb } = await handBuilt({
			userId,
			originalBytes: 300,
			displayBytes: 200,
			thumbBytes: 50
		})

		const res = await cullDerived(userId)
		expect(res.variants).toBe(1)
		expect(res.bytes).toBe(thumb!.bytes)

		const left = await variantsOf(file.id)
		expect(left.map((v) => v.variant).sort()).toEqual([
			MediaVariant.DISPLAY,
			MediaVariant.ORIGINAL
		])

		// Culling a cache row changes nothing that was already served — the
		// other rows' bytes are untouched — so the cache token must not move.
		// A bump here would re-fetch the entire library for nothing.
		const after = (await fileRow(file.id))!
		expect(after.rev).toBe(file.rev)
		expect(after.displayVariantId).toBe(file.displayVariantId)
	})

	test("sweeps only the caller's own library", async () => {
		const ownerId = await freshUser()
		const otherId = await freshUser()
		const { file } = await handBuilt({
			userId: ownerId,
			originalBytes: 300,
			thumbBytes: 50
		})

		const res = await cullDerived(otherId)
		expect(res.variants).toBe(0)
		expect(await variantsOf(file.id)).toHaveLength(2)
	})
})

describe("media:cullOriginals", () => {
	test("requires the exact phrase the warning showed", async () => {
		const userId = await freshUser()
		const { mediaCullOriginals } = await import("./media")
		const { file } = await handBuilt({
			userId,
			originalBytes: 300,
			displayBytes: 200
		})

		for (const confirm of ["", "delete originals", "yes", undefined]) {
			await expect(
				mediaCullOriginals.handler(
					fakeSocket(userId),
					{ confirm } as any,
					emit()
				)
			).rejects.toThrow(new RegExp(CULL_ORIGINALS_CONFIRM))
		}
		// And nothing moved while it was being refused.
		expect(await variantsOf(file.id)).toHaveLength(2)
	})

	test("re-points the display pointer and bumps rev when it takes the display target", async () => {
		const userId = await freshUser()
		const { file, original, display } = await handBuilt({
			userId,
			originalBytes: 300,
			displayBytes: 200
		})
		expect(file.displayVariantId).toBe(original.id)

		const res = await cullOriginals(userId)
		expect(res.files).toBe(1)
		expect(res.freedBytes).toBe(original.bytes)
		// Nothing had to be derived: a smaller full-fidelity copy was already
		// there.
		expect(res.addedBytes).toBe(0)

		expect(await variantsOf(file.id)).toHaveLength(1)
		const after = (await fileRow(file.id))!
		expect(after.displayVariantId).toBe(display!.id)
		// The bare URL's bytes just changed, which is the one thing rev is for.
		expect(after.rev).toBeGreaterThan(file.rev)
		// And the denormalised copies moved with the pointer, or the next
		// payload would describe bytes that no longer exist.
		expect(after.displayBytes).toBe(display!.bytes)
		expect(after.displayMime).toBe(display!.mime)
	})

	test("skips a file whose web-safe copy is bigger than the original", async () => {
		const userId = await freshUser()
		const { file, original } = await handBuilt({
			userId,
			originalBytes: 100,
			displayBytes: 500
		})

		const res = await cullOriginals(userId)
		// Culling here would free the small file and keep the big one, which is
		// the opposite of what an admin means by "reclaim space". A JPEG
		// photograph is exactly this case, and reclaiming nothing is correct.
		expect(res.files).toBe(0)
		expect(res.freedBytes).toBe(0)
		expect(res.skipped.reduce((n, s) => n + s.files, 0)).toBe(1)
		expect(res.skipped[0].reason).toMatch(/larger/i)

		const left = await variantsOf(file.id)
		expect(left.some((v) => v.id === original.id)).toBe(true)
		expect((await fileRow(file.id))!.rev).toBe(file.rev)
	})

	test("refuses a file with nothing to fall back on", async () => {
		const userId = await freshUser()
		// A document, so no encoder can produce a web-safe image copy of it —
		// the deterministic form of "a fresh upload has one representation and
		// it is also the display form".
		const { file, original } = await handBuilt({
			userId,
			kind: MediaKind.DOCUMENT,
			originalMime: "application/pdf",
			originalBytes: 300
		})

		const res = await cullOriginals(userId)
		expect(res.files).toBe(0)
		expect(res.skipped.reduce((n, s) => n + s.files, 0)).toBe(1)

		const left = await variantsOf(file.id)
		expect(left).toHaveLength(1)
		expect(left[0].id).toBe(original.id)
	})

	test("a freshly uploaded image never loses its last representation", async () => {
		const userId = await freshUser()
		const { createMedia } = await import("$lib/server/media")
		const { file } = await createMedia(db, {
			userId,
			bytes: png(11),
			filename: "fresh.png"
		})
		expect(await variantsOf(file.id)).toHaveLength(1)

		await cullOriginals(userId)

		// Two answers are safe here and which one this is depends on whether a
		// smaller web-safe copy can be made: refuse, or derive one first and
		// then cull. What must NEVER happen is the file being left with
		// nothing, so that is what is asserted rather than which answer it was.
		const left = await variantsOf(file.id)
		expect(left.length).toBeGreaterThanOrEqual(1)
		if (!left.some((v) => v.isOriginal)) {
			expect(
				left.some(
					(v) => v.fidelity === MediaFidelity.FULL && !v.isOriginal
				)
			).toBe(true)
		}
		// Whatever survived, the pointer still names a row that exists — the
		// bare URL has to resolve to something.
		const after = (await fileRow(file.id))!
		expect(left.some((v) => v.id === after.displayVariantId)).toBe(true)
	})
})

describe("the two actions in either order", () => {
	test("never leaves a file with zero representations", async () => {
		// Same library twice, swept in opposite orders. The point is that the
		// order cannot matter: a two-step "cull originals, then cull cache"
		// would otherwise delete every copy of a file whose display form was
		// the cache row.
		for (const order of ["derived-first", "originals-first"] as const) {
			const userId = await freshUser()
			const rich = await handBuilt({
				userId,
				originalBytes: 300,
				displayBytes: 200,
				thumbBytes: 50
			})
			const bare = await handBuilt({
				userId,
				originalBytes: 300,
				thumbBytes: 50
			})

			if (order === "derived-first") {
				await cullDerived(userId)
				await cullOriginals(userId)
			} else {
				await cullOriginals(userId)
				await cullDerived(userId)
			}

			for (const { file } of [rich, bare]) {
				const left = await variantsOf(file.id)
				expect(left.length).toBeGreaterThanOrEqual(1)
				const after = (await fileRow(file.id))!
				expect(left.some((v) => v.id === after.displayVariantId)).toBe(
					true
				)
			}
			// The one with nothing to fall back on keeps its original both
			// ways round.
			expect(
				(await variantsOf(bare.file.id)).some((v) => v.isOriginal)
			).toBe(true)
		}
	})
})

describe("media:cleanupPreview", () => {
	test("prices both actions without deriving anything", async () => {
		const userId = await freshUser()
		const { mediaCleanupPreview } = await import("./media")
		const { file, thumb } = await handBuilt({
			userId,
			originalBytes: 300,
			thumbBytes: 50
		})
		const before = await variantsOf(file.id)

		const res = await mediaCleanupPreview.handler(
			fakeSocket(userId),
			{},
			emit()
		)
		expect(res.derived).toEqual({
			files: 1,
			variants: 1,
			bytes: thumb!.bytes
		})
		// No non-original full-fidelity row exists, so there is nothing this
		// original could safely be replaced by — and pricing that would mean
		// doing the encode, which is the expensive half the preview refuses.
		expect(res.originals).toEqual({ files: 0, bytes: 0 })
		expect(res.skipped.reduce((n, s) => n + s.files, 0)).toBe(1)
		expect(res.derivedCacheEnabled).toBe(true)

		expect(await variantsOf(file.id)).toHaveLength(before.length)
		expect((await fileRow(file.id))!.rev).toBe(file.rev)
	})

	test("counts an original as cullable once a smaller copy exists", async () => {
		const userId = await freshUser()
		const { mediaCleanupPreview } = await import("./media")
		const { original } = await handBuilt({
			userId,
			originalBytes: 300,
			displayBytes: 200
		})

		const res = await mediaCleanupPreview.handler(
			fakeSocket(userId),
			{},
			emit()
		)
		expect(res.originals).toEqual({ files: 1, bytes: original.bytes })
		expect(res.skipped).toEqual([])
	})

	test("sees only the caller's own library", async () => {
		const ownerId = await freshUser()
		const otherId = await freshUser()
		const { mediaCleanupPreview } = await import("./media")
		await handBuilt({ userId: ownerId, originalBytes: 300, thumbBytes: 50 })

		const res = await mediaCleanupPreview.handler(
			fakeSocket(otherId),
			{},
			emit()
		)
		expect(res.derived).toEqual({ files: 0, variants: 0, bytes: 0 })
		expect(res.originals).toEqual({ files: 0, bytes: 0 })
	})
})

describe("media:setCachePolicy", () => {
	test("round-trips, for a user who has no settings row yet", async () => {
		const userId = await freshUser()
		const { mediaSetCachePolicy, mediaCleanupPreview } = await import(
			"./media"
		)
		// A plain UPDATE would report success and change nothing here, which is
		// why this is an upsert.
		const off = await mediaSetCachePolicy.handler(
			fakeSocket(userId),
			{ derivedCacheEnabled: false },
			emit()
		)
		expect(off.derivedCacheEnabled).toBe(false)
		expect(
			(
				await mediaCleanupPreview.handler(
					fakeSocket(userId),
					{},
					emit()
				)
			).derivedCacheEnabled
		).toBe(false)

		const on = await mediaSetCachePolicy.handler(
			fakeSocket(userId),
			{ derivedCacheEnabled: true },
			emit()
		)
		expect(on.derivedCacheEnabled).toBe(true)
		expect(
			(
				await mediaCleanupPreview.handler(
					fakeSocket(userId),
					{},
					emit()
				)
			).derivedCacheEnabled
		).toBe(true)
	})
})
