/**
 * Byte ceilings at every place a card is parsed (lorebooks plan S4). Each
 * hostile fixture is built here, just over its ceiling, and must be refused
 * with a plain sentence BEFORE the parse it guards — never crash, never
 * decode first and refuse after.
 *
 * The fixtures run to tens of megabytes, which is the point of them, but all
 * of it is flat bytes (spaces, one long string): nothing here asks the runner
 * for more than a few hundred megabytes at the worst moment.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { PNG } from "pngjs"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import { fileTypeFromBuffer } from "file-type"
import { strToU8, zipSync } from "fflate"
import {
	decodeCardFileBase64,
	embedCharacterCardInPng,
	getRobustSpecV3Data,
	parseCharacterCard,
	parseCharacterCardFromBase64
} from "./characterCardParser"
import { IMPORT_FILE_CAPS, MIB } from "$lib/shared/imports/fileCaps"
import { CARD_SPRITE_LIMITS, extractCardSprites } from "./cardSprites"

const card = (name: string, extra: Record<string, unknown> = {}) => ({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name,
		description: "Built in a test",
		first_mes: "Hello.",
		tags: ["fixture"],
		extensions: {},
		...extra
	}
})

function pngCard(json: unknown): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data.fill(255)
	return embedCharacterCardInPng(PNG.sync.write(png), json)
}

/** A little-endian TIFF whose Exif IFD carries `text` as its UserComment. */
function userCommentTiff(text: string): Buffer {
	const comment = Buffer.concat([
		Buffer.from("ASCII\0\0\0", "latin1"),
		Buffer.from(text, "utf8")
	])
	const t = Buffer.alloc(44)
	t.write("II", 0, "latin1")
	t.writeUInt16LE(42, 2)
	t.writeUInt32LE(8, 4)
	t.writeUInt16LE(1, 8)
	t.writeUInt16LE(0x8769, 10)
	t.writeUInt16LE(4, 12)
	t.writeUInt32LE(1, 14)
	t.writeUInt32LE(26, 18)
	t.writeUInt16LE(1, 26)
	t.writeUInt16LE(0x9286, 28)
	t.writeUInt16LE(7, 30)
	t.writeUInt32LE(comment.length, 32)
	t.writeUInt32LE(44, 36)
	return Buffer.concat([t, comment])
}

function riffChunk(type: string, data: Uint8Array): Buffer {
	const head = Buffer.alloc(8)
	head.write(type, 0, "latin1")
	head.writeUInt32LE(data.length, 4)
	return Buffer.concat([
		head,
		Buffer.from(data),
		data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
	])
}

/** A real 1×1 lossless WebP, encoded once by libwebp (via sharp). */
const REAL_WEBP = Buffer.from(
	"524946461e000000574542505650384c110000002f000000000750bc2217a5ff8188e87f0000",
	"hex"
)

function webpCard(json: unknown): Buffer {
	const vp8x = Buffer.alloc(10)
	vp8x[0] = 0x08
	const exif = userCommentTiff(
		Buffer.from(JSON.stringify(json)).toString("base64")
	)
	const body = Buffer.concat([
		Buffer.from("WEBP", "latin1"),
		riffChunk("VP8X", vp8x),
		REAL_WEBP.subarray(12),
		riffChunk("EXIF", exif)
	])
	const head = Buffer.alloc(8)
	head.write("RIFF", 0, "latin1")
	head.writeUInt32LE(body.length, 4)
	return Buffer.concat([head, body])
}

/** A description long enough to push a card's JSON past its ceiling. */
const overJsonCap = () => "x".repeat(IMPORT_FILE_CAPS.cardJsonBytes + 1)

afterEach(() => {
	vi.restoreAllMocks()
})

/**
 * What parsing came to, as one short string: the error's message, or
 * "parsed". Asserting on this rather than on the promise keeps a failure's
 * report small — vitest pretty-prints a received value, and a parsed card
 * carrying a 20 MB avatar Buffer is enough to take the worker down.
 */
const outcomeOf = (work: Promise<unknown>) =>
	work.then(
		() => "parsed",
		(e) => String(e?.message ?? e)
	)

describe("S4 — a card file is measured before it is decoded", () => {
	test("base64 over the card ceiling is refused without being decoded", () => {
		const over = IMPORT_FILE_CAPS.cardBytes + 3
		const base64 = "A".repeat(Math.ceil(over / 3) * 4)
		const from = vi.spyOn(Buffer, "from")
		expect(() => decodeCardFileBase64(base64)).toThrow(
			/^This card file is \d+ MB, larger than the 64 MB Serene Pub will read\.$/
		)
		expect(from.mock.calls.length).toBe(0)
	})

	test("parseCharacterCardFromBase64 holds the same ceiling", async () => {
		const base64 = "A".repeat(
			Math.ceil((IMPORT_FILE_CAPS.cardBytes + 3) / 3) * 4
		)
		expect(await outcomeOf(parseCharacterCardFromBase64(base64))).toMatch(
			/larger than the 64 MB Serene Pub will read/
		)
	})

	test("a file exactly at the ceiling is decoded", () => {
		const bytes = Buffer.alloc(3 * 1024, 7)
		expect(
			decodeCardFileBase64(bytes.toString("base64")).equals(bytes)
		).toBe(true)
	})
})

describe("S4 — a card's JSON is measured before JSON.parse", () => {
	test("a JSON card over 16 MB is refused before it is parsed", async () => {
		const bytes = Buffer.alloc(IMPORT_FILE_CAPS.cardJsonBytes + 1, 0x20)
		const parse = vi.spyOn(JSON, "parse")
		expect(await outcomeOf(parseCharacterCard(bytes))).toMatch(
			/^This card's JSON is 17 MB, larger than the 16 MB Serene Pub will read\./
		)
		expect(parse.mock.calls.length).toBe(0)
	})

	test("a PNG card whose chara chunk carries over 16 MB of JSON is refused", async () => {
		const png = pngCard(card("Heavy", { description: overJsonCap() }))
		const parse = vi.spyOn(JSON, "parse")
		expect(await outcomeOf(parseCharacterCard(png))).toMatch(
			/^This card's JSON is \d+ MB, larger than the 16 MB Serene Pub will read\./
		)
		expect(parse.mock.calls.length).toBe(0)
	})

	test("a WebP card whose EXIF comment carries over 16 MB of JSON is refused", async () => {
		const webp = webpCard(card("Heavy", { description: overJsonCap() }))
		const parse = vi.spyOn(JSON, "parse")
		expect(await outcomeOf(parseCharacterCard(webp))).toMatch(
			/larger than the 16 MB Serene Pub will read/
		)
		expect(parse.mock.calls.length).toBe(0)
	})

	test("a CHARX card.json over 16 MB is still refused (the CHARX ceiling is the same one)", async () => {
		const charx = Buffer.from(
			zipSync({
				"card.json": strToU8(
					JSON.stringify(
						card("Heavy", { description: overJsonCap() })
					)
				)
			})
		)
		expect(await outcomeOf(parseCharacterCard(charx))).toMatch(/card\.json/)
	})
})

describe("S4 — the avatar on the non-CHARX path", () => {
	test("a PNG card's avatar is the file itself, never a base64 round trip of it", async () => {
		const png = pngCard(card("Png Card"))
		const toString = vi.spyOn(Buffer.prototype, "toString")
		const parsed = await parseCharacterCard(png)
		expect(parsed.avatarBuffer?.equals(png)).toBe(true)
		expect(
			toString.mock.calls.filter(([enc]) => enc === "base64").length
		).toBe(0)
	})

	test("a JSON card's web-address avatar is not decoded as if it were base64", async () => {
		const json = card("Linked", { avatar: "https://example.com/face.png" })
		const parsed = await parseCharacterCard(
			Buffer.from(JSON.stringify(json))
		)
		expect(parsed.avatarBuffer).toBeUndefined()
	})

	test("a JSON card's data-URI avatar still decodes", async () => {
		const face = Buffer.from("fake-avatar-bytes")
		const json = card("Inline", {
			avatar: `data:image/png;base64,${face.toString("base64")}`
		})
		const parsed = await parseCharacterCard(
			Buffer.from(JSON.stringify(json))
		)
		expect(parsed.avatarBuffer?.equals(face)).toBe(true)
	})

	test("includeAvatar: false reads no avatar from a PNG either", async () => {
		const parsed = await parseCharacterCard(pngCard(card("Png Card")), {
			includeAvatar: false
		})
		expect(parsed.avatarBuffer).toBeUndefined()
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Png Card")
	})
})

describe("S4 review — an image a card names many times is read once", () => {
	const emotions = (n: number, uri: string) =>
		Array.from({ length: n }, (_, i) => ({
			type: "emotion",
			name: `e${i}`,
			uri,
			ext: "png"
		}))
	const v3 = (assets: unknown[]) => ({
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: { name: "Many Sprites", description: "", assets, extensions: {} }
	})
	/** Distinct memory behind the sprites' bytes, in bytes. */
	const retained = (sprites: { bytes: Buffer }[] = []) => {
		const seen = new Set<ArrayBufferLike>()
		let total = 0
		for (const s of sprites) {
			if (seen.has(s.bytes.buffer)) continue
			seen.add(s.bytes.buffer)
			total += s.bytes.byteLength
		}
		return total
	}

	test("a CHARX entry named by 64 sprites is one copy, not 64", async () => {
		// The resolver copied the entry for every asset naming it: an 18 KB
		// CHARX kept 16 × 16 MB (S4 review).
		const image = new Uint8Array(1 * MIB).fill(7)
		const zip = Buffer.from(
			zipSync({
				"card.json": strToU8(
					JSON.stringify(v3(emotions(64, "embeded://assets/a.png")))
				),
				"assets/a.png": image
			})
		)
		const parsed = await parseCharacterCard(zip)
		expect(parsed.sprites).toHaveLength(64)
		expect(retained(parsed.sprites)).toBeLessThanOrEqual(image.length)
	})

	test("a PNG asset chunk named by 64 sprites is decoded once", async () => {
		// Every `__asset:0` decoded the chunk's base64 again: 512 of them
		// spent 3.5 s in one synchronous block (S4 review).
		const asset = Buffer.alloc(1 * MIB, 7)
		const chunks = extract(pngCard(v3(emotions(64, "__asset:0"))))
		chunks.splice(chunks.length - 1, 0, {
			name: "tEXt",
			data: new Uint8Array(
				Buffer.concat([
					Buffer.from("chara-ext-asset_:0\0", "latin1"),
					Buffer.from(asset.toString("base64"), "latin1")
				])
			)
		})
		const parsed = await parseCharacterCard(Buffer.from(encode(chunks)))
		expect(parsed.sprites).toHaveLength(64)
		expect(retained(parsed.sprites)).toBeLessThanOrEqual(asset.length)
	})

	test("nothing past the sprite count ceiling is read at all", () => {
		const uris = Array.from(
			{ length: CARD_SPRITE_LIMITS.count + 88 },
			(_, i) =>
				`data:image/png;base64,${Buffer.from(`img${i}`).toString("base64")}`
		)
		const raw = v3(
			uris.map((uri, i) => ({ type: "emotion", name: `e${i}`, uri }))
		)
		let reads = 0
		const out = extractCardSprites(raw, (uri) => {
			reads++
			return Buffer.from(uri)
		})
		expect(out.sprites).toHaveLength(CARD_SPRITE_LIMITS.count)
		expect(reads).toBe(CARD_SPRITE_LIMITS.count)
	})
})

describe("S4 — valid cards under every ceiling still import", () => {
	test("PNG, WebP and JSON cards with a few MB of text", async () => {
		// A positive control for the JSON.parse spies above: under the
		// ceiling, the parse they watch for does happen.
		const parse = vi.spyOn(JSON, "parse")
		const big = "y".repeat(4 * MIB)
		for (const bytes of [
			pngCard(card("Big Png", { description: big })),
			webpCard(card("Big Webp", { description: big })),
			Buffer.from(JSON.stringify(card("Big Json", { description: big })))
		]) {
			const parsed = await parseCharacterCard(bytes)
			expect(getRobustSpecV3Data(parsed.card).description?.length).toBe(
				big.length
			)
		}
		expect(parse.mock.calls.length).toBeGreaterThanOrEqual(3)
	})

	test("an APNG card, its avatar the file itself", async () => {
		// An animation control chunk after IHDR is what makes a PNG an APNG.
		const chunks = extract(pngCard(card("Apng Card")))
		const actl = new Uint8Array(8)
		actl[3] = 1 // one frame
		chunks.splice(1, 0, { name: "acTL", data: actl })
		const apng = Buffer.from(encode(chunks))
		expect((await fileTypeFromBuffer(apng))?.mime).toBe("image/apng")
		const parsed = await parseCharacterCard(apng)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Apng Card")
		expect(parsed.avatarBuffer?.equals(apng)).toBe(true)
	})

	test("an image that carries no card says so in a sentence", async () => {
		const png = new PNG({ width: 1, height: 1 })
		expect(await outcomeOf(parseCharacterCard(PNG.sync.write(png)))).toBe(
			"This image carries no character card."
		)
	})
})
