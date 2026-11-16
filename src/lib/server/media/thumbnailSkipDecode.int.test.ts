// deriveThumb: a webp whose stored size already says it is its own thumbnail
// is served as itself without being decoded; anything else decodes as before.
import { beforeAll, describe, expect, test, vi } from "vitest"
import { PNG } from "pngjs"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const decodeSpy = vi.fn()
vi.mock("./thumbnailWorker", async (orig) => {
	const real = await orig<typeof import("./thumbnailWorker")>()
	return {
		...real,
		decodeForThumbnail: (
			...a: Parameters<typeof real.decodeForThumbnail>
		) => {
			decodeSpy()
			return real.decodeForThumbnail(...a)
		}
	}
})

function png(w: number, h: number): Buffer {
	const p = new PNG({ width: w, height: h })
	p.data.fill(200)
	return PNG.sync.write(p)
}

let db: never
let webp64: Buffer
let webpBig: Buffer
beforeAll(async () => {
	;({ db } = (await import("$lib/server/db")) as never)
	const { encodeRaster } = await import("./convert/codecs")
	const raster = (w: number, h: number) => ({
		width: w,
		height: h,
		data: new Uint8ClampedArray(w * h * 4).fill(200)
	})
	webp64 = await encodeRaster(raster(64, 64) as never, "image/webp", {
		quality: 80
	})
	webpBig = await encodeRaster(raster(600, 600) as never, "image/webp", {
		quality: 80
	})
}, 60_000)

let userId: number | undefined
async function store(bytes: Buffer, _mime: string) {
	const { createMedia, getMediaByUuid } = await import("$lib/server/media")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId ??= (await createTestUser(db, "thumb-skip")).id
	const made = await createMedia(db, { userId, bucket: "backgrounds", bytes })
	return (await getMediaByUuid(db, made.file.uuid))!
}

describe("thumbnail derivation skips a needless decode", () => {
	test("a small whole-frame webp with stored size is its own thumbnail, undecoded", async () => {
		const file = await store(webp64, "image/webp")
		expect([file.width, file.height]).toEqual([64, 64])
		const { ensureVariant } = await import("./variants")
		const { MediaVariant } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		decodeSpy.mockClear()
		const got = await ensureVariant(db, file, MediaVariant.THUMB)
		expect(got).not.toBeNull()
		expect(got!.variant).not.toBe(MediaVariant.THUMB)
		expect(got!.bytes.equals(webp64)).toBe(true)
		expect(decodeSpy).not.toHaveBeenCalled()
	}, 60_000)

	test("an oversize webp still decodes and gets a thumbnail", async () => {
		const file = await store(webpBig, "image/webp")
		const { ensureVariant } = await import("./variants")
		const { MediaVariant } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		decodeSpy.mockClear()
		const got = await ensureVariant(db, file, MediaVariant.THUMB)
		expect(got!.variant).toBe(MediaVariant.THUMB)
		expect(decodeSpy).toHaveBeenCalled()
	}, 60_000)

	test("a non-webp source still decodes", async () => {
		const file = await store(png(32, 32), "image/png")
		const { ensureVariant } = await import("./variants")
		const { MediaVariant } = await import(
			"$lib/shared/constants/MediaVisibility"
		)
		decodeSpy.mockClear()
		await ensureVariant(db, file, MediaVariant.THUMB)
		expect(decodeSpy).toHaveBeenCalled()
	}, 60_000)
})
