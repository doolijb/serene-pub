/**
 * `core:task/cut-out@1` against real migrations and the real media store, with
 * the matting model replaced: the matte → alpha composition, the `auto` skip,
 * the reference fields replaced and every other field (a series `key`) kept,
 * and the `local_models` row the first use files. No model is downloaded —
 * `@huggingface/transformers` is mocked whole.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const { getDb, setDb, notifySpy, pipelineSpy } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		},
		notifySpy: vi.fn(async () => {}),
		pipelineSpy: vi.fn()
	}
})

vi.mock("$lib/server/db", () => ({
	get db() {
		return getDb()
	}
}))

vi.mock("$lib/server/notifications/downloads", () => ({
	notifyDownloadSettled: notifySpy,
	downloadHref: () => "/admin/connections"
}))

/**
 * The transformers.js surface the matting module touches. The "model" keeps
 * the LEFT half of whatever it is shown and drops the right half.
 */
vi.mock("@huggingface/transformers", () => {
	class RawImage {
		constructor(
			public data: Uint8ClampedArray,
			public width: number,
			public height: number,
			public channels: number
		) {}
	}
	return {
		RawImage,
		AutoConfig: { from_pretrained: vi.fn(async () => ({})) },
		ModelRegistry: {
			get_pipeline_files: vi.fn(async () => [
				"config.json",
				"preprocessor_config.json",
				"onnx/model.onnx"
			])
		},
		AutoModelForImageSegmentation: {
			from_pretrained: vi.fn(async (_id: string, opts: any) => {
				opts?.progress_callback?.({
					status: "progress",
					file: "onnx/model.onnx",
					loaded: 50,
					total: 100
				})
				return { dispose: vi.fn() }
			})
		},
		AutoProcessor: { from_pretrained: vi.fn(async () => ({})) },
		pipeline: pipelineSpy.mockImplementation(async () => {
			return async (img: RawImage) => {
				const out = new Uint8ClampedArray(img.data)
				for (let y = 0; y < img.height; y++)
					for (let x = 0; x < img.width; x++)
						out[(y * img.width + x) * 4 + 3] = x < img.width / 2 ? 255 : 0
				return new RawImage(out, img.width, img.height, 4)
			}
		})
	}
})

import {
	composeCutOut,
	cutOutItems,
	parseHexColour,
	scaleMatte
} from "./cutOut"
import {
	MATTING_MODALITY,
	MATTING_MODEL_ID,
	resetMattingForTests
} from "$lib/server/localModels/matting"
import { clearCachedScans } from "$lib/server/localModels/onnxCache"

let testDb: TestDb
let db: Db
let dataDir: string
let userId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-cutout-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	delete process.env.TRANSFORMERS_CACHE
	const { createTestDb, createTestUser } = await import(
		"$lib/server/utils/testDb"
	)
	testDb = await createTestDb()
	db = testDb as unknown as Db
	setDb(testDb)
	userId = (await createTestUser(testDb)).id
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	resetMattingForTests()
	clearCachedScans()
})

/**
 * An opaque w×h PNG: red on the left half, pure green on the right. Each call
 * differs in one blue value, because the media store dedupes identical bytes
 * per user and a shared row would share its meta.
 */
let made = 0
async function sourcePng(w = 8, h = 4, alphaAt?: number) {
	const { encodeRaster } = await import("$lib/server/media/convert/codecs")
	const data = new Uint8ClampedArray(w * h * 4)
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const o = (y * w + x) * 4
			const left = x < w / 2
			data[o] = left ? 220 : 0
			data[o + 1] = left ? 30 : 255
			data[o + 2] = left ? 30 : 0
			data[o + 3] = 255
		}
	data[2] = 30 + (made++ % 200)
	if (alphaAt !== undefined) data[alphaAt * 4 + 3] = 0
	return encodeRaster({ data, width: w, height: h }, "image/png")
}

async function storeSource(meta: Record<string, unknown> | null, alphaAt?: number) {
	const { createMedia } = await import("$lib/server/media")
	const { file } = await createMedia(db, {
		userId,
		bytes: await sourcePng(8, 4, alphaAt),
		filename: "source.png",
		bucket: "generated",
		meta
	})
	return file
}

async function alphaOf(uuid: string) {
	const media = await import("$lib/server/media")
	const { decodeImage } = await import("$lib/server/media/convert/codecs")
	const file = await media.getMediaByUuid(db, uuid)
	const read = await media.readMedia(db, file!.id)
	const raster = await decodeImage(read!.bytes, read!.mime)
	const alpha: number[] = []
	for (let i = 3; i < raster.data.length; i += 4) alpha.push(raster.data[i])
	return { file: file!, raster, alpha }
}

/** A stand-in matte that keeps the left half, at whatever size it is shown. */
const leftHalf = vi.fn(async (r: { width: number; height: number }) => {
	const alpha = new Uint8ClampedArray(r.width * r.height)
	for (let y = 0; y < r.height; y++)
		for (let x = 0; x < r.width; x++)
			alpha[y * r.width + x] = x < r.width / 2 ? 255 : 0
	return { alpha, width: r.width, height: r.height }
})

describe("composition (pure)", () => {
	test("the matte becomes the alpha channel; colour is untouched", () => {
		const original = {
			data: new Uint8ClampedArray([
				10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, 128
			]),
			width: 2,
			height: 2
		}
		const out = composeCutOut(original, new Uint8ClampedArray([255, 0, 128, 255]))
		expect([...out.data]).toEqual([
			10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 128,
			// already half transparent: the lower of the two wins
			1, 2, 3, 128
		])
		// The source buffer is not written through.
		expect(original.data[7]).toBe(255)
	})

	test("a green-screen key drops the key colour even where the matte kept it", () => {
		const key = parseHexColour("#00ff00")
		expect(key).toEqual([0, 255, 0])
		const original = {
			data: new Uint8ClampedArray([0, 255, 0, 255, 200, 40, 40, 255]),
			width: 2,
			height: 1
		}
		const out = composeCutOut(original, new Uint8ClampedArray([255, 255]), key)
		expect(out.data[3]).toBe(0)
		expect(out.data[7]).toBe(255)
		expect(parseHexColour("#0f0")).toEqual([0, 255, 0])
		expect(parseHexColour("green")).toBeNull()
	})

	test("a small matte scales to the original's size", async () => {
		const alpha = await scaleMatte(
			{ alpha: new Uint8ClampedArray([255, 0]), width: 2, height: 1 },
			8,
			4
		)
		expect(alpha.length).toBe(32)
		// Far left kept, far right dropped, at every row.
		for (let y = 0; y < 4; y++) {
			expect(alpha[y * 8]).toBeGreaterThan(200)
			expect(alpha[y * 8 + 7]).toBeLessThan(55)
		}
	})
})

describe("cutOutItems", () => {
	test("cuts out an opaque picture into a new PNG; key and other fields ride across", async () => {
		leftHalf.mockClear()
		const source = await storeSource({ prompt: "a fox" })
		const item = {
			uuid: source.uuid,
			kind: "image",
			mime: "image/png",
			bytes: 1,
			key: "joy",
			text: "a fox"
		}
		const [out] = (await cutOutItems(db, [item], "auto", {
			matte: leftHalf
		})) as Array<Record<string, unknown>>
		expect(leftHalf).toHaveBeenCalledTimes(1)
		expect(out.uuid).not.toBe(source.uuid)
		expect(out.key).toBe("joy")
		expect(out.text).toBe("a fox")
		expect(out.mime).toBe("image/png")
		expect(out.width).toBe(8)
		expect(out.height).toBe(4)

		const { file, alpha } = await alphaOf(out.uuid as string)
		for (let y = 0; y < 4; y++)
			for (let x = 0; x < 8; x++)
				expect(alpha[y * 8 + x]).toBe(x < 4 ? 255 : 0)
		expect(file.meta).toEqual({ cutOutOf: source.uuid, model: "BiRefNet_lite" })
		expect(file.userId).toBe(userId)
		// The source is left exactly as it was.
		const again = await alphaOf(source.uuid)
		expect(again.alpha.every((a) => a === 255)).toBe(true)
	})

	test("auto skips native alpha, an earlier cut-out, and pixels already transparent; always does not", async () => {
		leftHalf.mockClear()
		const native = await storeSource({ transparent: "native" }, undefined)
		const cut = await storeSource({ cutOutOf: "x" }, 1)
		const alphaPixels = await storeSource(null, 2)
		const items = [native, cut, alphaPixels].map((f) => ({
			uuid: f.uuid,
			kind: "image",
			mime: "image/png",
			bytes: 1
		}))
		const auto = await cutOutItems(db, items, "auto", { matte: leftHalf })
		expect(auto).toEqual(items)
		expect(leftHalf).not.toHaveBeenCalled()

		const always = (await cutOutItems(db, [items[0]], "always", {
			matte: leftHalf
		})) as Array<{ uuid: string }>
		expect(leftHalf).toHaveBeenCalledTimes(1)
		expect(always[0].uuid).not.toBe(native.uuid)
	})

	test("off hands the list on; an unknown reference passes through", async () => {
		leftHalf.mockClear()
		const items = [{ uuid: "00000000-0000-4000-8000-000000000000", kind: "image" }]
		expect(await cutOutItems(db, items, "off", { matte: leftHalf })).toEqual(items)
		expect(await cutOutItems(db, items, "auto", { matte: leftHalf })).toEqual(items)
		expect(leftHalf).not.toHaveBeenCalled()
	})
})

describe("the matting model's local_models row", () => {
	test("first use downloads once, files a `matting` row, and tells the person whose run it was", async () => {
		notifySpy.mockClear()
		const source = await storeSource({ prompt: "an owl" })
		const progress: Array<number | null> = []
		const [out] = (await cutOutItems(
			db,
			[{ uuid: source.uuid, kind: "image", mime: "image/png", bytes: 1 }],
			"always",
			{ onProgress: ({ percent }) => progress.push(percent) }
		)) as Array<{ uuid: string }>

		const [row] = await testDb
			.select()
			.from(schema.localModels)
			.where(eq(schema.localModels.filename, MATTING_MODEL_ID))
		expect(row).toMatchObject({
			modality: MATTING_MODALITY,
			format: "onnx",
			status: "complete",
			quantization: "fp32"
		})
		expect(progress).toContain(50)
		expect(notifySpy).toHaveBeenCalledWith(
			expect.objectContaining({ userId, source: "onnx", key: `matting:${MATTING_MODEL_ID}` }),
			expect.anything()
		)
		// The mocked pipeline kept the left half.
		const { alpha } = await alphaOf(out.uuid)
		expect(alpha[0]).toBe(255)
		expect(alpha[7]).toBe(0)
		expect(pipelineSpy).toHaveBeenCalledWith(
			"background-removal",
			expect.any(String),
			expect.objectContaining({ dtype: "fp32" })
		)
	})
})
