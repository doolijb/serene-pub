// The same-as variant: a thumb row with no path of its own that names the
// source row, for a whole-frame webp already within the thumb edge.
import fs from "node:fs/promises"
import path from "node:path"
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: never
let webp64: Buffer
beforeAll(async () => {
	;({ db } = (await import("$lib/server/db")) as never)
	const { encodeRaster } = await import("./convert/codecs")
	webp64 = await encodeRaster(
		{
			width: 64,
			height: 64,
			data: new Uint8ClampedArray(64 * 64 * 4).fill(200)
		} as never,
		"image/webp",
		{ quality: 80 }
	)
}, 60_000)

let userId: number | undefined
let counter = 0
async function store() {
	const { createMedia, getMediaByUuid } = await import("$lib/server/media")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId ??= (await createTestUser(db, "same-as")).id
	// A distinct hash per file: the bytes differ by an appended trailer.
	const bytes = Buffer.concat([webp64, Buffer.from(String(counter++))])
	const made = await createMedia(db, { userId, bucket: "backgrounds", bytes })
	return (await getMediaByUuid(db, made.file.uuid))!
}

async function filesOnDisk(file: { id: number }): Promise<string[]> {
	const { variantsFor } = await import("./variants")
	const { resolveMediaPath } = await import("./paths")
	const dirs = new Set<string>()
	for (const v of await variantsFor(db, file.id)) {
		if (v.path) dirs.add(path.dirname(resolveMediaPath(v.path)))
	}
	const out: string[] = []
	for (const d of dirs) {
		for (const f of await fs.readdir(d)) out.push(path.join(d, f))
	}
	return out
}

async function exists(p: string) {
	return fs.access(p).then(
		() => true,
		() => false
	)
}

async function thumbRow(fileId: number) {
	const { getVariant } = await import("./variants")
	const { MediaVariant } = await import(
		"$lib/shared/constants/MediaVisibility"
	)
	return getVariant(db, fileId, MediaVariant.THUMB)
}

async function setup() {
	const file = await store()
	const { ensureVariant, variantsFor } = await import("./variants")
	const { MediaVariant } = await import(
		"$lib/shared/constants/MediaVisibility"
	)
	const before = await filesOnDisk(file)
	await ensureVariant(db, file, MediaVariant.THUMB)
	const rows = await variantsFor(db, file.id)
	const original = rows.find((r) => r.isOriginal)!
	const same = rows.find((r) => r.variant === MediaVariant.THUMB)!
	return { file, before, original, same }
}

describe("same-as variant", () => {
	test("first thumb request writes one same-as row and no second file", async () => {
		const { file, before, original, same } = await setup()
		const { MediaFidelity } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		expect(same).toBeDefined()
		expect(same.path).toBeNull()
		expect(same.sameAsVariantId).toBe(original.id)
		expect(same.fidelity).toBe(MediaFidelity.REDUCED)
		expect(same.hash).toBe(original.hash)
		expect((await filesOnDisk(file)).sort()).toEqual(before.sort())
	}, 60_000)

	test("a second request locates the source file without reading bytes", async () => {
		const { file, original } = await setup()
		const { locateVariant } = await import("./variants")
		const { MediaVariant } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		const { resolveMediaPath } = await import("./paths")
		const readSpy = vi.spyOn(fs, "readFile")
		try {
			const got = await locateVariant(db, file, MediaVariant.THUMB)
			expect(got?.kind).toBe("stored")
			if (got?.kind !== "stored") throw new Error("unreachable")
			expect(got.absPath).toBe(resolveMediaPath(original.path!))
			expect(got.row.hash).toBe(original.hash)
			expect(readSpy).not.toHaveBeenCalled()
		} finally {
			readSpy.mockRestore()
		}
	}, 60_000)

	test("ensureVariant on an existing same-as row resolves to the source", async () => {
		const { file, original } = await setup()
		const { ensureVariant } = await import("./variants")
		const { MediaVariant } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		const got = await ensureVariant(db, file, MediaVariant.THUMB)
		expect(got?.row?.id).toBe(original.id)
		expect(got?.variant).toBe(MediaVariant.ORIGINAL)
	}, 60_000)

	test("culling the same-as row frees nothing and keeps the source", async () => {
		const { file, original, same } = await setup()
		const { cullVariant } = await import("./cull")
		const { resolveMediaPath } = await import("./paths")
		const out = await cullVariant(db, same.id)
		expect(out).toMatchObject({ ok: true, freedBytes: 0 })
		expect(await thumbRow(file.id)).toBeNull()
		expect(await exists(resolveMediaPath(original.path!))).toBe(true)
	}, 60_000)

	test("the original is not cullable when only a same-as row sits beside it", async () => {
		const { original } = await setup()
		const { cullVariant } = await import("./cull")
		const { resolveMediaPath } = await import("./paths")
		const out = await cullVariant(db, original.id)
		expect(out.ok).toBe(false)
		expect(await exists(resolveMediaPath(original.path!))).toBe(true)
	}, 60_000)

	test("backfill never selects or re-cuts a same-as row", async () => {
		const { file, original, same } = await setup()
		const { backfillThumbnails } = await import("./backfill")
		const { resolveMediaPath } = await import("./paths")
		await backfillThumbnails()
		const after = await thumbRow(file.id)
		expect(after?.id).toBe(same.id)
		expect(await exists(resolveMediaPath(original.path!))).toBe(true)
	}, 60_000)

	test("removing the source drops the same-as rows naming it", async () => {
		const { file, original } = await setup()
		const { removeVariant } = await import("./variants")
		await removeVariant(db, original)
		expect(await thumbRow(file.id)).toBeNull()
	}, 60_000)

	test("deleteFile removes every row and every real file", async () => {
		const { file } = await setup()
		const { deleteFile } = await import("$lib/server/media")
		const { variantsFor } = await import("./variants")
		const { resolveMediaPath } = await import("./paths")
		const paths = (await variantsFor(db, file.id))
			.filter((v) => v.path)
			.map((v) => resolveMediaPath(v.path!))
		expect(paths.length).toBeGreaterThan(0)
		await deleteFile(db, file.id)
		expect(await variantsFor(db, file.id)).toEqual([])
		for (const p of paths) expect(await exists(p)).toBe(false)
	}, 60_000)

	test("the database refuses a row with both or neither of path and same_as", async () => {
		const { file, original } = await setup()
		const schema = await import("$lib/server/db/schema")
		const base = {
			fileId: file.id,
			variant: "fitted",
			mime: "image/webp",
			bytes: 1,
			hash: "x",
			isOriginal: false,
			cache: true,
			fidelity: "reduced"
		}
		await expect(
			(db as any).insert(schema.variants).values({
				...base,
				path: "a/b.webp",
				sameAsVariantId: original.id
			})
		).rejects.toThrow()
		await expect(
			(db as any).insert(schema.variants).values({
				...base,
				path: null,
				sameAsVariantId: null
			})
		).rejects.toThrow()
	}, 60_000)

	test("with the derived-form cache off no same-as row is written", async () => {
		const file = await store()
		const schema = await import("$lib/server/db/schema")
		await (db as any)
			.insert(schema.userSettings)
			.values({ userId: file.userId, derivedMediaCacheEnabled: false })
			.onConflictDoUpdate({
				target: schema.userSettings.userId,
				set: { derivedMediaCacheEnabled: false }
			})
		const { ensureVariant } = await import("./variants")
		const { MediaVariant } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		const got = await ensureVariant(db, file, MediaVariant.THUMB)
		expect(got).not.toBeNull()
		expect(await thumbRow(file.id)).toBeNull()
		await (db as any)
			.update(schema.userSettings)
			.set({ derivedMediaCacheEnabled: true })
			.where(eq(schema.userSettings.userId, file.userId))
	}, 60_000)
})
