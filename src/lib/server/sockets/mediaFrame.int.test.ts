/**
 * Cropping an avatar, end to end: the frame on the file, and the thumbnail cut
 * from it.
 *
 * The rules under test are the ones every surface depends on. The frame is the
 * only thing that decides what a thumbnail shows, so setting one has to change
 * the pixels and re-address them (`rev`), and clearing one has to fall back to
 * the default rule rather than to whatever was cut last. Framing is owner-only,
 * like every other media verb, and a frame that does not fit the image is
 * refused with a sentence rather than clamped silently — a caller that measured
 * the wrong image should hear about it.
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

/**
 * Top half one colour, bottom half another, so which region a thumbnail was
 * cut from is readable from a single pixel of it.
 */
function halvesPng(
	width: number,
	height: number,
	top: [number, number, number],
	bottom: [number, number, number],
	seed: number
): Buffer {
	const p = new PNG({ width, height })
	for (let y = 0; y < height; y++) {
		const [r, g, b] = y < height / 2 ? top : bottom
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4
			p.data[i] = r
			p.data[i + 1] = g
			p.data[i + 2] = b
			p.data[i + 3] = 255
		}
	}
	// One pixel carries the seed, so each file has its own hash — uploads
	// dedupe per user on the original's bytes.
	p.data[1] = seed
	return PNG.sync.write(p)
}

const RED: [number, number, number] = [230, 20, 20]
const BLUE: [number, number, number] = [20, 20, 230]

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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-mediaframe-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "media-frame-owner")).id
	otherId = (await createTestUser(db, "media-frame-other")).id
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A tall image: 400 wide, 800 high, red on top and blue underneath. */
async function makeTallImage(seed: number) {
	const { createMedia } = await import("$lib/server/media")
	const { file } = await createMedia(db, {
		userId: ownerId,
		bytes: halvesPng(400, 800, RED, BLUE, seed)
	})
	return file
}

async function fileRow(fileId: number) {
	const [row] = await db
		.select()
		.from(schema.files)
		.where(eq(schema.files.id, fileId))
	return row ?? null
}

async function variantsOf(fileId: number) {
	return db
		.select()
		.from(schema.variants)
		.where(eq(schema.variants.fileId, fileId))
}

/** The thumbnail's own pixels, decoded. The only honest way to say which region
 *  it was cut from. */
async function thumbPixels(fileId: number) {
	const { ensureVariant } = await import("$lib/server/media")
	const { decodeImage } = await import("$lib/server/media/convert/codecs")
	const file = (await fileRow(fileId))!
	const resolved = await ensureVariant(db, file, MediaVariant.THUMB)
	if (!resolved) throw new Error("No thumbnail resolved")
	const raster = await decodeImage(resolved.bytes, resolved.mime)
	const at = (x: number, y: number) => {
		const i = (Math.floor(y) * raster.width + Math.floor(x)) * 4
		return [raster.data[i], raster.data[i + 1], raster.data[i + 2]]
	}
	return { raster, at, hash: resolved.hash }
}

/** Which half of the source a colour came from, with room for the encoder. */
function isRedish(px: number[]) {
	return px[0] > px[2] + 40
}
function isBluish(px: number[]) {
	return px[2] > px[0] + 40
}

describe("an unframed thumbnail", () => {
	test("is the largest square anchored to the top", async () => {
		const file = await makeTallImage(11)
		const { raster, at } = await thumbPixels(file.id)

		expect(raster.width).toBe(raster.height)
		// 400x800 cut to 400x400 from the top: every pixel comes from the red
		// half, including the very bottom row of the thumbnail.
		expect(isRedish(at(raster.width / 2, 2))).toBe(true)
		expect(isRedish(at(raster.width / 2, raster.height - 3))).toBe(true)
	})
})

describe("media:setFrame", () => {
	test("cuts the thumbnail from the frame and re-addresses it", async () => {
		const { mediaSetFrame } = await import("./media")
		const file = await makeTallImage(12)
		const before = await thumbPixels(file.id)
		const revBefore = (await fileRow(file.id))!.rev

		const { emit, emitted } = captureEmits()
		const res = await mediaSetFrame.handler(
			fakeSocket(ownerId),
			{ mediaId: file.id, frame: { x: 0, y: 400, w: 400, h: 400 } },
			emit
		)

		expect(res.media.frame).toEqual({ x: 0, y: 400, w: 400, h: 400 })
		// The old thumbnail is gone, not edited: nothing may serve the previous
		// crop from the new URL.
		expect(
			(await variantsOf(file.id)).some(
				(v) => v.variant === MediaVariant.THUMB
			)
		).toBe(false)

		const after = await thumbPixels(file.id)
		expect(after.hash).not.toBe(before.hash)
		expect(after.raster.width).toBe(after.raster.height)
		expect(isBluish(after.at(after.raster.width / 2, 2))).toBe(true)

		const row = (await fileRow(file.id))!
		expect(row.rev).toBeGreaterThan(revBefore)
		const announced = emitted.find((e) => e.event === "media:changed")
		expect(announced?.data).toEqual({
			id: file.id,
			uuid: row.uuid,
			rev: row.rev,
			// Carried so a view holding the old frame learns the new one from
			// the same announcement that re-addresses the pixels.
			frame: { x: 0, y: 400, w: 400, h: 400 }
		})
	})

	test("clearing the frame goes back to the default rule, not to the last cut", async () => {
		const { mediaSetFrame } = await import("./media")
		const file = await makeTallImage(13)
		const { emit } = captureEmits()
		await mediaSetFrame.handler(
			fakeSocket(ownerId),
			{ mediaId: file.id, frame: { x: 0, y: 400, w: 400, h: 400 } },
			emit
		)
		expect(isBluish((await thumbPixels(file.id)).at(200, 2))).toBe(true)

		const res = await mediaSetFrame.handler(
			fakeSocket(ownerId),
			{ mediaId: file.id, frame: null },
			emit
		)
		expect(res.media.frame).toBeNull()
		expect((await fileRow(file.id))!.frame).toBeNull()
		const back = await thumbPixels(file.id)
		expect(isRedish(back.at(back.raster.width / 2, 2))).toBe(true)
	})

	test("refuses a frame that falls outside the image, in a sentence", async () => {
		const { mediaSetFrame } = await import("./media")
		const file = await makeTallImage(14)
		const { emit } = captureEmits()
		await expect(
			mediaSetFrame.handler(
				fakeSocket(ownerId),
				{ mediaId: file.id, frame: { x: 200, y: 0, w: 400, h: 400 } },
				emit
			)
		).rejects.toThrow(/outside the image, which is 400 by 800 pixels\./)
		expect((await fileRow(file.id))!.frame).toBeNull()
	})

	test("refuses a frame smaller than the minimum", async () => {
		const { mediaSetFrame } = await import("./media")
		const file = await makeTallImage(15)
		const { emit } = captureEmits()
		await expect(
			mediaSetFrame.handler(
				fakeSocket(ownerId),
				{ mediaId: file.id, frame: { x: 0, y: 0, w: 8, h: 8 } },
				emit
			)
		).rejects.toThrow(/at least 16 pixels/)
	})

	test("is owner-only", async () => {
		const { mediaSetFrame } = await import("./media")
		const file = await makeTallImage(16)
		const { emit } = captureEmits()
		await expect(
			mediaSetFrame.handler(
				fakeSocket(otherId),
				{ mediaId: file.id, frame: { x: 0, y: 0, w: 100, h: 100 } },
				emit
			)
		).rejects.toThrow(/not found/i)
		expect((await fileRow(file.id))!.frame).toBeNull()
	})
})

describe("the payload", () => {
	test("carries the frame, so an editor opens on the stored crop", async () => {
		const { mediaSetFrame, mediaList } = await import("./media")
		const file = await makeTallImage(17)
		const { emit } = captureEmits()
		await mediaSetFrame.handler(
			fakeSocket(ownerId),
			{ mediaId: file.id, frame: { x: 0, y: 100, w: 400, h: 400 } },
			emit
		)
		const res = await mediaList.handler(fakeSocket(ownerId), {}, emit)
		const listed = res.media.find((m) => m.id === file.id)
		expect(listed?.frame).toEqual({ x: 0, y: 100, w: 400, h: 400 })
	})
})
