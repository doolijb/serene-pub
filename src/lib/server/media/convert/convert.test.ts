/**
 * The conversion router's contract.
 *
 * Five things earn a test here, and each one is a failure that would otherwise
 * be invisible at the call site:
 *
 *  1. The registry and the format table agree, in BOTH directions. A `decode`
 *     flag set without a converter, or a converter added without the flag, is
 *     drift that nothing else would notice.
 *  2. A refusal is a value with a code and a reason that names the pair —
 *     never a throw, never a passthrough, never a quiet substitute.
 *  3. An animated source is refused rather than flattened, including into GIF,
 *     which CAN carry the animation this build cannot write — and including an
 *     animated WEBP, which is recognised from its container because there is no
 *     way to decode one here.
 *  4. Negotiation picks the first reachable format and passes an
 *     already-acceptable source through untouched.
 *  5. A batch preserves ORDER and isolates FAILURE — asserted by CONTENT, with
 *     the conversions deliberately differing in cost, because a length check
 *     passes on a reordered list and a cheap uniform fixture never reorders.
 */
import { describe, expect, test, vi } from "vitest"
import { PNG } from "pngjs"
import { GifWriter } from "omggif"
import {
	MEDIA_FORMATS,
	formatByMime,
	formatsForKind
} from "$lib/shared/media/formats"
import { decodeImage, encodeRaster, readMotion } from "./codecs"
import {
	CONVERTERS,
	convertMedia,
	convertMediaBatch,
	convertMediaTo,
	converterExists,
	MediaDowngradeError,
	reachableTargets,
	refusalToError,
	type ConversionResult
} from "./index"

// The first encode compiles the webp encoder's wasm, which is well past the 5s
// unit default on a loaded machine. A budget, not a flake.
vi.setConfig({ testTimeout: 60_000 })

/** A solid PNG whose FIRST PIXEL's red channel is `seed` — the tag the order
 *  test identifies a slot's content by. One channel varies down the image so it
 *  does not compress to nothing. */
function solidPng(width: number, height: number, seed: number): Buffer {
	const p = new PNG({ width, height })
	for (let i = 0; i < p.data.length; i += 4) {
		p.data[i] = seed
		p.data[i + 1] = i % 251
		p.data[i + 2] = 200
		p.data[i + 3] = 255
	}
	return PNG.sync.write(p)
}

/** A genuinely multi-frame GIF. Written with omggif rather than checked in as a
 *  byte fixture so the thing being refused is a real animation. */
function animatedGif(frames = 3, size = 8): Buffer {
	const buf = Buffer.alloc(4096)
	const palette = [0xff0000, 0x00ff00]
	const gw = new GifWriter(buf, size, size, { loop: 0, palette })
	for (let f = 0; f < frames; f++) {
		gw.addFrame(0, 0, size, size, new Array(size * size).fill(f % 2), {
			delay: 10,
			palette
		})
	}
	return Buffer.from(buf.subarray(0, gw.end()))
}

async function stillGif(): Promise<Buffer> {
	return encodeRaster(
		await decodeImage(solidPng(8, 8, 90), "image/png"),
		"image/gif"
	)
}

/**
 * WebP containers, written BYTE BY BYTE rather than encoded.
 *
 * `@jsquash/webp` exports a single-frame `encode`, so this build cannot
 * produce an animated WebP at all — and does not need to, because what
 * `readMotion` reads is the RIFF chunk list, never a pixel. Writing the chunks
 * directly tests the parser instead of a round trip through an encoder that
 * could not make one anyway.
 *
 * The shapes were checked against real libwebp output (Pillow's animated
 * writer): an animated file's `VP8X` flags byte reads 0x02 and carries `ANIM`
 * plus one `ANMF` per frame, while a STILL file with alpha reads 0x10 — the
 * neighbouring bit, and the one a wrong constant here would collide with.
 */
function u32(value: number): Buffer {
	const b = Buffer.alloc(4)
	b.writeUInt32LE(value)
	return b
}

function u24(value: number): Buffer {
	const b = Buffer.alloc(3)
	b.writeUIntLE(value, 0, 3)
	return b
}

/** `<fourCC> <u32 size> <payload>`, padded to an even length as the container
 *  requires — the padding is what a naive scan for "ANIM" gets wrong. */
function chunk(fourCC: string, payload: Buffer): Buffer {
	return Buffer.concat([
		Buffer.from(fourCC, "latin1"),
		u32(payload.length),
		payload,
		payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
	])
}

function webpFile(...chunks: Buffer[]): Buffer {
	const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks])
	return Buffer.concat([
		Buffer.from("RIFF", "latin1"),
		u32(body.length),
		body
	])
}

/** The extended-format header. `flags` is the byte whose bit 1 (0x02) means
 *  animation and whose bit 4 (0x10) means alpha. */
function vp8x(flags: number): Buffer {
	return chunk(
		"VP8X",
		Buffer.concat([Buffer.from([flags, 0, 0, 0]), u24(7), u24(7)])
	)
}

/** One animation frame: the 16-byte header, then the frame's own image data —
 *  which is filler here, because nothing under test decodes it. */
function anmf(durationMs: number): Buffer {
	return chunk(
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
}

/** The ordinary animated file: flag set, `ANIM`, and N frames. */
function animatedWebp(frames = 3, durationMs = 120): Buffer {
	return webpFile(
		vp8x(0x02),
		chunk("ANIM", Buffer.alloc(6)),
		...Array.from({ length: frames }, () => anmf(durationMs))
	)
}

async function stillWebp(): Promise<Buffer> {
	return encodeRaster(
		await decodeImage(solidPng(8, 8, 40), "image/png"),
		"image/webp",
		{ lossless: true }
	)
}

async function jpegOf(width: number, height: number, seed: number) {
	return encodeRaster(
		await decodeImage(solidPng(width, height, seed), "image/png"),
		"image/jpeg",
		{ quality: 90 }
	)
}

/** The magic bytes, so "did it really produce that format" is answered by the
 *  file rather than by the label we attached to it. */
function magic(bytes: Buffer): string {
	if (
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return "png"
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg"
	if (bytes.subarray(0, 3).toString("latin1") === "GIF") return "gif"
	if (
		bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
		bytes.subarray(8, 12).toString("latin1") === "WEBP"
	)
		return "webp"
	return "?"
}

function refusal(result: ConversionResult) {
	expect(result.ok, `expected a refusal, got bytes`).toBe(false)
	return result as Extract<ConversionResult, { ok: false }>
}

describe("the registry and the format table agree", () => {
	test("every registered pair is one the table says this build can do", () => {
		for (const entry of CONVERTERS) {
			const source = formatByMime(entry.source)
			const target = formatByMime(entry.target)
			expect(source, entry.source).toBeDefined()
			expect(target, entry.target).toBeDefined()
			expect(source!.decode, `${entry.source} decode`).toBe(true)
			expect(target!.encode, `${entry.target} encode`).toBe(true)
			expect(source!.kind, `${entry.source} → ${entry.target}`).toBe(
				target!.kind
			)
		}
	})

	test("every IMAGE pair the table implies is registered", () => {
		// The reverse direction, so a `decode: true` added to (say) image/bmp
		// without a converter fails here instead of becoming a refusal nobody
		// expected.
		//
		// Image only. The text formats declare decode and encode because UTF-8
		// genuinely needs no codec, but relabelling text/plain as text/markdown
		// changes no bytes and is not a conversion — the next test pins that no
		// document converter exists, so this exclusion cannot hide drift.
		const images = formatsForKind("image")
		for (const source of images) {
			for (const target of images) {
				if (!source.decode || !target.encode) continue
				expect(
					converterExists(source.mime, target.mime),
					`${source.mime} → ${target.mime} is implied by the table but not registered`
				).toBe(true)
			}
		}
	})

	test("nothing but images is registered at all", () => {
		const kinds = new Set(
			CONVERTERS.map((e) => formatByMime(e.source)!.kind)
		)
		expect([...kinds]).toEqual(["image"])
	})

	test("the reachable targets are the four still-image formats", () => {
		expect(reachableTargets("image/png")).toEqual([
			"image/png",
			"image/jpeg",
			"image/gif",
			"image/webp"
		])
		expect(reachableTargets("image/jpg")).toEqual(
			reachableTargets("image/jpeg")
		)
		expect(reachableTargets("application/pdf")).toEqual([])
		expect(CONVERTERS.length).toBe(16)
	})

	test("the table is big enough to be a vocabulary rather than a codec list", () => {
		// The point of declaring formats this build cannot touch: a picker can
		// offer what a backend accepts. If this ever equals the four convertible
		// mimes, the split has collapsed.
		expect(MEDIA_FORMATS.length).toBeGreaterThan(20)
	})
})

describe("converting to one named format", () => {
	test("png → webp is lossless when asked, byte-for-byte in the pixels", async () => {
		const src = solidPng(24, 16, 200)
		const out = await convertMedia(
			{ bytes: src, mime: "image/png" },
			"image/webp",
			{
				lossless: true
			}
		)
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.mime).toBe("image/webp")
		expect(out.ext).toBe("webp")
		expect(out.passthrough).toBe(false)
		expect(magic(out.bytes)).toBe("webp")
		expect([out.width, out.height]).toEqual([24, 16])

		const before = await decodeImage(src, "image/png")
		const after = await decodeImage(out.bytes, "image/webp")
		expect([...after.data.slice(0, 16)]).toEqual([
			...before.data.slice(0, 16)
		])
	})

	test("the other still-image targets really produce those formats", async () => {
		const src = solidPng(12, 12, 77)
		for (const [target, expected] of [
			["image/png", "png"],
			["image/jpeg", "jpeg"],
			["image/gif", "gif"]
		] as const) {
			const out = await convertMedia(
				{ bytes: src, mime: "image/png" },
				target
			)
			expect(out.ok, target).toBe(true)
			if (!out.ok) continue
			expect(magic(out.bytes), target).toBe(expected)
			expect(out.mime, target).toBe(target)
		}
	})

	test("a webp source decodes and re-encodes both ways", async () => {
		const webp = await convertMedia(
			{ bytes: solidPng(10, 10, 33), mime: "image/png" },
			"image/webp",
			{ lossless: true }
		)
		expect(webp.ok).toBe(true)
		if (!webp.ok) return
		const back = await convertMedia(
			{ bytes: webp.bytes, mime: "image/webp" },
			"image/png"
		)
		expect(back.ok).toBe(true)
		if (!back.ok) return
		expect(magic(back.bytes)).toBe("png")
		expect((await decodeImage(back.bytes, "image/png")).data[0]).toBe(33)
	})

	test("an explicit identity target re-encodes rather than passing through", async () => {
		// `deriveDisplay` asks for exactly this: a LOSSLESS webp from a webp
		// original. A passthrough here would hand back the lossy source.
		const src = solidPng(8, 8, 44)
		const out = await convertMedia(
			{ bytes: src, mime: "image/png" },
			"image/png"
		)
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.passthrough).toBe(false)
		expect(magic(out.bytes)).toBe("png")
	})

	test("a mime with a parameter or a common misspelling still routes", async () => {
		const out = await convertMedia(
			{ bytes: solidPng(4, 4, 12), mime: "image/PNG; charset=binary" },
			"image/webp"
		)
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.mime).toBe("image/webp")
	})
})

describe("refusals are values, and they say why", () => {
	test("an animated GIF is refused rather than flattened", async () => {
		const out = refusal(
			await convertMedia(
				{ bytes: animatedGif(), mime: "image/gif" },
				"image/webp"
			)
		)
		expect(out.code).toBe("animation-would-be-lost")
		expect(out.sourceMime).toBe("image/gif")
		expect(out.targetMime).toBe("image/webp")
		expect(out.reason).toContain("image/gif")
		expect(out.reason).toContain("image/webp")
		expect(out.reason).toContain("single frame")
	})

	test("…including into GIF, which the FORMAT could carry", async () => {
		// The refusal is about this build's encoders, not about the target
		// format's capability. Conflating the two is how a flatten gets justified.
		expect(formatByMime("image/gif")!.animated).toBe(true)
		const out = refusal(
			await convertMedia(
				{ bytes: animatedGif(), mime: "image/gif" },
				"image/gif"
			)
		)
		expect(out.code).toBe("animation-would-be-lost")
	})

	test("a STILL gif converts, so the refusal is about motion and not about GIF", async () => {
		const out = await convertMedia(
			{ bytes: await stillGif(), mime: "image/gif" },
			"image/webp",
			{ lossless: true }
		)
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(magic(out.bytes)).toBe("webp")
	})

	test("a cross-kind request is named as a generation, not attempted", async () => {
		const out = refusal(
			await convertMedia(
				{ bytes: solidPng(4, 4, 1), mime: "image/png" },
				"application/pdf"
			)
		)
		expect(out.code).toBe("kind-mismatch")
		expect(out.reason).toContain("generation")
	})

	test("HEIC keeps the advice the upload gives", async () => {
		const out = refusal(
			await convertMedia(
				{ bytes: Buffer.from("ftypheic"), mime: "image/heic" },
				"image/jpeg"
			)
		)
		expect(out.code).toBe("no-converter")
		expect(out.reason).toContain("Most Compatible")
	})

	test("audio says ffmpeg rather than pretending to try", async () => {
		const out = refusal(
			await convertMedia(
				{ bytes: Buffer.from("ID3"), mime: "audio/mpeg" },
				"audio/wav"
			)
		)
		expect(out.code).toBe("no-converter")
		expect(out.reason).toContain("ffmpeg")
	})

	test("an unknown source and an unknown target are told apart", async () => {
		const src = refusal(
			await convertMedia(
				{ bytes: Buffer.from("x"), mime: "application/x-nonesuch" },
				"image/png"
			)
		)
		expect(src.code).toBe("unknown-source-format")

		const dst = refusal(
			await convertMedia(
				{ bytes: solidPng(4, 4, 1), mime: "image/png" },
				"image/nonesuch"
			)
		)
		expect(dst.code).toBe("unknown-target-format")
	})

	test("unreadable bytes are a refusal, not a throw", async () => {
		const out = refusal(
			await convertMedia(
				{
					bytes: Buffer.from("this is not a PNG at all"),
					mime: "image/png"
				},
				"image/webp"
			)
		)
		expect(out.code).toBe("decode-failed")
		expect(out.reason).toContain("image/png")
	})

	test("refusalToError keeps a decision distinguishable from a fault", async () => {
		const downgrade = refusal(
			await convertMedia(
				{ bytes: animatedGif(), mime: "image/gif" },
				"image/webp"
			)
		)
		const broken = refusal(
			await convertMedia(
				{ bytes: Buffer.from("nope"), mime: "image/png" },
				"image/webp"
			)
		)
		expect(refusalToError(downgrade)).toBeInstanceOf(MediaDowngradeError)
		expect(refusalToError(broken)).toBeInstanceOf(Error)
		expect(refusalToError(broken)).not.toBeInstanceOf(MediaDowngradeError)
	})
})

describe("an animated WebP is recognised from its container", () => {
	// The gap this closes: `readMotion` probed GIF only, so an animated WebP
	// read as "unknown", and unknown means "convert it". What actually kept the
	// frames was luck of the codec — libwebp's still-image decoder errors on an
	// animated file — so the refusal came back as `decode-failed`, telling the
	// user their file was broken rather than that it was an animation this
	// build will not re-encode. WebP is a STORED format now, and the answer
	// must not depend on a decoder happening to fail.

	test("reports the frame count and duration the ANMF headers state", async () => {
		expect(await readMotion(animatedWebp(3, 120), "image/webp")).toEqual({
			animated: true,
			frames: 3,
			durationMs: 360
		})
	})

	test("either signal is enough, because a muxer writes them separately", async () => {
		// The ANIM chunk with the header flag cleared. Structural evidence of
		// frames outranks a flag byte that disagrees with it, because the
		// disagreement has to resolve toward keeping the original.
		const flagCleared = webpFile(
			vp8x(0x00),
			chunk("ANIM", Buffer.alloc(6)),
			anmf(40),
			anmf(40)
		)
		expect(await readMotion(flagCleared, "image/webp")).toMatchObject({
			animated: true,
			frames: 2
		})

		// And the flag with no frames this walk can enumerate: animated with
		// NOTHING else knowable. `frames` and `durationMs` are null rather than
		// invented, and `animated` is what the router reads.
		const flagOnly = webpFile(vp8x(0x02), chunk("VP8L", Buffer.alloc(8, 1)))
		expect(await readMotion(flagOnly, "image/webp")).toEqual({
			animated: true,
			frames: null,
			durationMs: null
		})
	})

	test("a still WebP is still, including the one with the neighbouring bit set", async () => {
		// 0x10 is alpha. A constant off by one bit position would refuse every
		// transparent PNG → WebP conversion in the app, so this is the guard on
		// the other side of the same byte.
		const alpha = webpFile(
			vp8x(0x10),
			chunk("ALPH", Buffer.alloc(9, 2)),
			chunk("VP8 ", Buffer.alloc(11, 3))
		)
		expect(await readMotion(alpha, "image/webp")).toEqual({
			animated: false,
			frames: 1,
			durationMs: null
		})
		// And a real encoder's output, so the parser is pinned against bytes
		// this build actually writes rather than only against its own fixtures.
		expect(await readMotion(await stillWebp(), "image/webp")).toMatchObject(
			{
				animated: false
			}
		)
	})

	test("a container this cannot walk reads as UNKNOWN, never as still", async () => {
		// Null is the answer that stops a flatten being justified by a failed
		// probe — the same rule the GIF branch follows.
		expect(await readMotion(Buffer.from("RIFF"), "image/webp")).toBeNull()
		expect(
			await readMotion(animatedWebp().subarray(0, 20), "image/webp")
		).toBeNull()
	})

	test("and so it is refused rather than flattened, whatever the target", async () => {
		for (const target of ["image/webp", "image/png", "image/gif"]) {
			const out = refusal(
				await convertMedia(
					{ bytes: animatedWebp(), mime: "image/webp" },
					target
				)
			)
			expect(out.code, target).toBe("animation-would-be-lost")
			expect(out.reason).toContain("3 frames")
			expect(out.reason).toContain("single frame")
		}
		// The negotiating entry point checks separately, so it gets its own
		// assertion rather than an assumption that the two share a guard.
		const negotiated = refusal(
			await convertMediaTo(
				{ bytes: animatedWebp(2, 50), mime: "image/webp" },
				["image/png", "image/jpeg"]
			)
		)
		expect(negotiated.code).toBe("animation-would-be-lost")
		expect(negotiated.reason).toContain("2 frames")
	})

	test("a frame count the container leaves unstated is omitted, not guessed", async () => {
		const out = refusal(
			await convertMedia(
				{
					bytes: webpFile(
						vp8x(0x02),
						chunk("VP8L", Buffer.alloc(8, 1))
					),
					mime: "image/webp"
				},
				"image/png"
			)
		)
		expect(out.code).toBe("animation-would-be-lost")
		expect(out.reason).toContain("This image is animated and")
		// The count is parenthesised when it is known, so no parenthesis at
		// all is the assertion that nothing was invented in its place.
		expect(out.reason).not.toContain("(")
	})

	test("but an accepted animated WebP still passes THROUGH untouched", async () => {
		// The passthrough short-circuit runs before the motion check, and that
		// is the correct order: nothing is re-encoded, so there is nothing to
		// lose. A backend that takes WebP gets the animation intact.
		const bytes = animatedWebp()
		const out = await convertMediaTo({ bytes, mime: "image/webp" }, [
			"image/webp"
		])
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.passthrough).toBe(true)
		expect(out.bytes.equals(bytes)).toBe(true)
	})
})

describe("negotiating a preferred format", () => {
	test("picks the first reachable target and says which", async () => {
		const out = await convertMediaTo(
			{ bytes: solidPng(8, 8, 5), mime: "image/png" },
			["image/avif", "image/heic", "image/webp", "image/jpeg"]
		)
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.mime).toBe("image/webp")
		expect(magic(out.bytes)).toBe("webp")
	})

	test("honours the caller's order between two reachable targets", async () => {
		const src = { bytes: solidPng(8, 8, 5), mime: "image/png" }
		const first = await convertMediaTo(src, ["image/gif", "image/jpeg"])
		const second = await convertMediaTo(src, ["image/jpeg", "image/gif"])
		expect(first.ok && first.mime).toBe("image/gif")
		expect(second.ok && second.mime).toBe("image/jpeg")
	})

	test("an already-acceptable source is passed through, not re-encoded", async () => {
		// The lossy-substitute guard: a JPEG re-encoded into a "preferred" WebP
		// would spend a generation of quality invisibly.
		const src = await jpegOf(16, 16, 61)
		const out = await convertMediaTo({ bytes: src, mime: "image/jpeg" }, [
			"image/webp",
			"image/jpeg"
		])
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.passthrough).toBe(true)
		expect(out.mime).toBe("image/jpeg")
		expect(out.ext).toBe("jpg")
		expect(out.bytes.equals(src)).toBe(true)
	})

	test("an unreachable list is refused with everything it was offered", async () => {
		const out = refusal(
			await convertMediaTo(
				{ bytes: solidPng(4, 4, 1), mime: "image/png" },
				["image/avif", "image/tiff"]
			)
		)
		expect(out.code).toBe("no-converter")
		expect(out.considered).toEqual(["image/avif", "image/tiff"])
		expect(out.targetMime).toBeNull()
		expect(out.reason).toContain("image/webp") // what it CAN reach
	})

	test("an empty list is refused rather than silently passed through", async () => {
		const out = refusal(
			await convertMediaTo(
				{ bytes: solidPng(4, 4, 1), mime: "image/png" },
				[]
			)
		)
		expect(out.code).toBe("no-converter")
		expect(out.reason).toContain("No target formats were offered")
	})
})

describe("a batch preserves order and isolates failure", () => {
	test("result[i] is input[i], by CONTENT, with the costs deliberately uneven", async () => {
		// The expensive conversion is FIRST and the trivial one is third, so a
		// completion-ordered implementation — a concurrent loop pushing into a
		// shared array — puts the 2x2 ahead of the 640x640 and this fails. Every
		// slot carries a different first-pixel red, so identity is checked by the
		// pixels rather than by the shape of the list.
		const inputs = [
			{ bytes: solidPng(640, 640, 250), mime: "image/png" },
			{ bytes: animatedGif(), mime: "image/gif" },
			{ bytes: solidPng(2, 2, 10), mime: "image/png" },
			{ bytes: Buffer.from("truncated upload"), mime: "image/png" },
			{ bytes: solidPng(160, 160, 120), mime: "image/png" }
		]

		const results = await convertMediaBatch(inputs, ["image/webp"], {
			lossless: true
		})

		const identified = await Promise.all(
			results.map(async (r) => {
				if (!r.ok) return r.code
				const raster = await decodeImage(r.bytes, r.mime)
				return `${raster.width}x${raster.height}#${raster.data[0]}`
			})
		)

		expect(identified).toEqual([
			"640x640#250",
			"animation-would-be-lost",
			"2x2#10",
			"decode-failed",
			"160x160#120"
		])
	})

	test("one file failing costs only its own slot", async () => {
		const results = await convertMediaBatch(
			[
				{ bytes: Buffer.from("junk"), mime: "image/png" },
				{ bytes: solidPng(6, 6, 3), mime: "image/png" },
				{ bytes: Buffer.from("junk too"), mime: "image/png" }
			],
			["image/webp"]
		)
		expect(results.map((r) => r.ok)).toEqual([false, true, false])
		expect(results[1].ok && magic(results[1].bytes)).toBe("webp")
	})

	test("an empty batch is an empty list, not an error", async () => {
		expect(await convertMediaBatch([], ["image/webp"])).toEqual([])
	})
})
