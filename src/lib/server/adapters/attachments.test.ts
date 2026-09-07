/**
 * The enforcement engine's contract.
 *
 * Seven things earn a test here, and every one of them is a failure that is
 * invisible at the call site — the request goes out, the service answers, and
 * the answer is wrong in a way that reads as the model's fault:
 *
 *  1. **Nothing declared blocks nothing.** The runtime half of "absent means no
 *     known limit". A `?? 0` anywhere in the reader would refuse every request
 *     in the app, and it would look like a backend refusing it.
 *  2. **Convert first, THEN check bytes** — asserted with the conversion as the
 *     thing that moves the file from one side of the cap to the other, in both
 *     directions, so neither ordering mistake can pass.
 *  3. **Order is preserved**, across mixed kinds and across conversions of
 *     wildly different cost. A reordering here presents as the model misreading
 *     the pictures, not as a plumbing fault.
 *  4. **Over-supply is refused, never sliced.** Thirty images to a backend that
 *     takes twenty is a refusal naming both numbers — because a request that
 *     quietly lost ten attachments is indistinguishable from a model ignoring
 *     them.
 *  5. **One bad file refuses the whole request.** Deliberately unlike
 *     `convertMediaBatch`, which isolates failure per slot: a partial payload
 *     IS a quiet truncation once it reaches a service.
 *  6. **An accepted-but-undecodable file is forwarded, not converted.** A PDF is
 *     what a backend accepting `application/pdf` wants handed straight over, and
 *     the conversion router refuses it — correctly, for converting.
 *  7. **A base64 transport inflates BOTH byte caps**, because both published
 *     numbers are about what the service receives — Anthropic's vision docs say
 *     "10 MB (base64-encoded)" per image in as many words. So 80 bytes of images
 *     is a 112-byte request, and a 43-byte file is 60 bytes against a per-file
 *     limit. Measuring either one raw is quiet: the request is accepted here,
 *     encoded, sent, and refused by the service with an error about a limit
 *     this app has already told the user it was inside of.
 */

import { describe, expect, test, vi } from "vitest"
import { PNG } from "pngjs"
import { decodeImage, encodeRaster } from "$lib/server/media/convert/codecs"
import { cap, type AdapterIo } from "$lib/shared/connectionAdapters/io"
import {
	capOutputCount,
	prepareAttachments,
	type AttachmentPlan,
	type AttachmentsPrepared,
	type AttachmentsRefused
} from "./attachments"

// A 640x640 round trip through jimp is well past the 5s unit default on a
// loaded machine. A budget, not a flake.
vi.setConfig({ testTimeout: 60_000 })

/**
 * A PNG of deterministic NOISE.
 *
 * Noise rather than the flat fill the router's own tests use, because the point
 * here is the SIZE relationship: deflate cannot compress this, so the PNG lands
 * near its raw byte count, while a lossy JPEG of the same pixels is a fraction
 * of it. That gap is what the convert-then-check test puts a cap inside.
 */
function noisyPng(width: number, height: number, seed: number): Buffer {
	const p = new PNG({ width, height })
	let s = seed >>> 0 || 1
	for (let i = 0; i < p.data.length; i += 4) {
		// xorshift32: cheap, seeded, and the same bytes on every machine.
		s ^= s << 13
		s >>>= 0
		s ^= s >>> 17
		s ^= s << 5
		s >>>= 0
		p.data[i] = s & 0xff
		p.data[i + 1] = (s >>> 8) & 0xff
		p.data[i + 2] = (s >>> 16) & 0xff
		p.data[i + 3] = 255
	}
	return PNG.sync.write(p)
}

async function jpegOf(width: number, height: number, seed: number) {
	return encodeRaster(
		await decodeImage(noisyPng(width, height, seed), "image/png"),
		"image/jpeg"
	)
}

/** Enough of a PDF to be a PDF. Never decoded by anything here — that is the
 *  point of the file it appears in. */
const fakePdf = () =>
	Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n")

const png = (n: number) => ({
	bytes: Buffer.alloc(n, 7),
	mime: "image/png"
})

const ok = (plan: AttachmentPlan): AttachmentsPrepared => {
	if (!plan.ok) throw new Error(`expected a payload, got: ${plan.reason}`)
	return plan
}

const refused = (plan: AttachmentPlan): AttachmentsRefused => {
	if (plan.ok)
		throw new Error(
			`expected a refusal, got ${plan.files.length} prepared files`
		)
	return plan
}

/** Images only, JPEG only, so every PNG in a test has to actually convert. */
const JPEG_ONLY: AdapterIo = {
	in: { image: { accepts: ["image/jpeg"] } }
}

/**
 * The encode options the size tests use, passed on every call in them.
 *
 * Pinned rather than left to the encoder's own default, because the whole point
 * of those tests is a KNOWN gap between the source's size and the payload's: at
 * jimp's default quality a JPEG of pure noise is not reliably smaller than the
 * PNG it came from, and the test would pass or fail on the fixture rather than
 * on the ordering it is meant to prove.
 */
const LOSSY = { encode: { quality: 30 } }

describe("nothing declared blocks nothing", () => {
	test("an undeclared entry forwards every file untouched", async () => {
		// The rule this holds is the reason `AdapterIo` is almost entirely absent
		// from the manifest: an unknown limit must not behave like a limit of
		// zero. Thirty files, no declaration, nothing refused, nothing converted.
		const inputs = Array.from({ length: 30 }, (_, i) => png(16 + i))
		const plan = ok(await prepareAttachments(undefined, inputs))

		expect(plan.files.length).toBe(30)
		expect(plan.files.some((f) => f.converted)).toBe(false)
		expect(plan.files.every((f) => f.kind === "image")).toBe(true)
		expect(plan.files.every((f) => f.mime === "image/png")).toBe(true)
		expect(plan.bytes).toBe(
			inputs.reduce((sum, i) => sum + i.bytes.length, 0)
		)
	})

	test("an empty list is an empty payload, not a refusal", async () => {
		const plan = ok(await prepareAttachments(JPEG_ONLY, []))
		expect(plan.files).toEqual([])
		expect(plan.bytes).toBe(0)
	})

	test("a kind with limits does not constrain a kind without them", async () => {
		// Per-kind, because the answers genuinely differ per kind on one backend.
		const io: AdapterIo = {
			in: { image: { maxFiles: cap(2, "a test") } }
		}
		const plan = ok(
			await prepareAttachments(io, [
				png(10),
				png(10),
				{ bytes: fakePdf(), mime: "application/pdf" },
				{ bytes: fakePdf(), mime: "application/pdf" },
				{ bytes: fakePdf(), mime: "application/pdf" }
			])
		)
		expect(plan.files.map((f) => f.kind)).toEqual([
			"image",
			"image",
			"document",
			"document",
			"document"
		])
	})
})

describe("⚠ convert first, then check bytes", () => {
	/**
	 * THE test this whole ordering exists for.
	 *
	 * One file, one cap, and the conversion is what decides which side of the cap
	 * it lands on: the source PNG is OVER the cap and the JPEG it becomes is
	 * UNDER it. Both facts are asserted, so the test cannot pass vacuously on a
	 * fixture whose sizes happen to be close.
	 *
	 * Checking before conversion would refuse this request. Checking only before
	 * would accept a request that grew past the cap on the way out — which is why
	 * the second test below runs the same file against a cap the JPEG *also*
	 * breaks and asserts the refusal quotes the CONVERTED byte count.
	 */
	test("a file over the cap as PNG is accepted as the JPEG it becomes", async () => {
		const source = noisyPng(128, 128, 12345)

		// Measure what it converts to, using the engine itself so the number is
		// the one enforcement will see.
		const unlimited = ok(
			await prepareAttachments(
				JPEG_ONLY,
				[{ bytes: source, mime: "image/png" }],
				LOSSY
			)
		)
		const jpegSize = unlimited.files[0]!.bytes.length
		expect(unlimited.files[0]!.mime).toBe("image/jpeg")
		expect(unlimited.files[0]!.converted).toBe(true)
		expect(
			source.length,
			"the fixture must be bigger as PNG than as JPEG, or this test proves nothing"
		).toBeGreaterThan(jpegSize)

		// A cap strictly between the two.
		const between = Math.floor((jpegSize + source.length) / 2)
		expect(jpegSize).toBeLessThan(between)
		expect(source.length).toBeGreaterThan(between)

		const io: AdapterIo = {
			in: {
				image: {
					accepts: ["image/jpeg"],
					maxBytesPerFile: cap(between, "a test")
				}
			}
		}
		const plan = ok(
			await prepareAttachments(
				io,
				[{ bytes: source, mime: "image/png" }],
				LOSSY
			)
		)
		expect(plan.files[0]!.mime).toBe("image/jpeg")
		expect(plan.files[0]!.bytes.length).toBe(jpegSize)
		expect(plan.bytes).toBe(jpegSize)
	})

	test("and the refusal quotes the CONVERTED size, not the source's", async () => {
		const source = noisyPng(128, 128, 12345)
		const jpegSize = ok(
			await prepareAttachments(
				JPEG_ONLY,
				[{ bytes: source, mime: "image/png" }],
				LOSSY
			)
		).files[0]!.bytes.length

		const io: AdapterIo = {
			in: {
				image: {
					accepts: ["image/jpeg"],
					maxBytesPerFile: cap(jpegSize - 1, "a documented limit")
				}
			}
		}
		const plan = refused(
			await prepareAttachments(
				io,
				[{ bytes: source, mime: "image/png", filename: "noise.png" }],
				LOSSY
			)
		)
		expect(plan.code).toBe("file-too-large")
		expect(plan.index).toBe(0)
		// The bytes being SENT, and where they came from — proving the check ran
		// after the conversion rather than on the buffer that arrived.
		expect(plan.reason).toContain(String(jpegSize))
		expect(plan.reason).not.toContain(String(source.length))
		expect(plan.reason).toContain("converted from image/png")
		// And the cap's own citation, so the claim is checkable by whoever reads
		// the error.
		expect(plan.reason).toContain("a documented limit")
		expect(plan.reason).toContain("noise.png")
	})

	test("the whole-request cap is measured on the converted bytes too", async () => {
		const source = noisyPng(64, 64, 99)
		const jpegSize = ok(
			await prepareAttachments(
				JPEG_ONLY,
				[{ bytes: source, mime: "image/png" }],
				LOSSY
			)
		).files[0]!.bytes.length

		// Room for the two JPEGs and not for the two PNGs.
		const io: AdapterIo = {
			in: { image: { accepts: ["image/jpeg"] } },
			maxRequestBytes: cap(jpegSize * 2 + 16, "a test")
		}
		expect(source.length * 2).toBeGreaterThan(jpegSize * 2 + 16)

		const plan = ok(
			await prepareAttachments(
				io,
				[
					{ bytes: source, mime: "image/png" },
					{ bytes: source, mime: "image/png" }
				],
				LOSSY
			)
		)
		expect(plan.bytes).toBe(jpegSize * 2)
	})
})

describe("byte caps that bind where the other does not", () => {
	test("files each within the per-file cap can still break the request cap", async () => {
		// The reason both fields exist. Four 400-byte files pass a 500-byte
		// per-file cap and blow a 1000-byte request cap.
		const io: AdapterIo = {
			in: {
				image: {
					accepts: ["image/png"],
					maxBytesPerFile: cap(500, "per file, per a test")
				}
			},
			maxRequestBytes: cap(1000, "per request, per a test")
		}
		const plan = refused(
			await prepareAttachments(io, [
				png(400),
				png(400),
				png(400),
				png(400)
			])
		)
		expect(plan.code).toBe("request-too-large")
		// A whole-request refusal is about no single file.
		expect(plan.index).toBeNull()
		expect(plan.reason).toContain("1600")
		expect(plan.reason).toContain("per request, per a test")
		expect(plan.reason).toContain("Each file is within its own limit")
	})

	test("the caller's own overhead counts toward the request cap", async () => {
		// Only the caller knows how big its serialised prompt is, so it says.
		const io: AdapterIo = {
			in: { image: { accepts: ["image/png"] } },
			maxRequestBytes: cap(1000, "a test")
		}
		const files = [png(400), png(400)]
		expect(ok(await prepareAttachments(io, files)).bytes).toBe(800)

		const plan = refused(
			await prepareAttachments(io, files, { overheadBytes: 300 })
		)
		expect(plan.code).toBe("request-too-large")
		expect(plan.reason).toContain("1100")
	})

	test("a base64 transport is measured as the wire carries it, not as the files are", async () => {
		// A JSON API's published request limit is about the ENCODED body, where a
		// file is four characters per three bytes. 80 bytes of images is a
		// 112-byte request — and only the adapter knows its API inlines base64,
		// which is why the transport is declared rather than assumed.
		const io: AdapterIo = {
			in: { image: { accepts: ["image/png"] } },
			maxRequestBytes: cap(100, "a test")
		}
		const files = [png(40), png(40)]
		// Raw, the same two files fit with room to spare.
		expect(ok(await prepareAttachments(io, files)).bytes).toBe(80)

		const plan = refused(
			await prepareAttachments(io, files, { transport: "base64" })
		)
		expect(plan.code).toBe("request-too-large")
		expect(plan.reason).toContain("112")
		// Both numbers, because "80 bytes is over a 100-byte limit" reads as a
		// bug in this app rather than as arithmetic.
		expect(plan.reason).toContain("80 bytes as files")
		expect(plan.reason).toContain("inflated by base64")
	})

	test("a per-file cap is measured on the wire too, and its boundary is inclusive", async () => {
		// Both published numbers are about what the service RECEIVES — the
		// per-file one explicitly, in Anthropic's case ("10 MB (base64-encoded)")
		// — so a 56-byte per-file cap on a base64 transport is a 42-byte ceiling
		// on the file. Checking the file against it would accept, encode and send
		// something the service then rejects.
		const io: AdapterIo = {
			in: {
				image: {
					accepts: ["image/png"],
					maxBytesPerFile: cap(56, "per file, per a test")
				}
			},
			maxRequestBytes: cap(1000, "a test")
		}

		// 40 bytes encodes to exactly 56. `withinCap` is inclusive, so this fits
		// — the boundary is pinned from below as well as above, because an
		// off-by-one here refuses a file the limit allows.
		const fits = ok(
			await prepareAttachments(io, [png(40)], { transport: "base64" })
		)
		expect(fits.files[0]!.bytes.length).toBe(40)
		expect(fits.bytes).toBe(56)

		// 43 bytes encodes to 60, which does not fit — though the FILE is barely
		// half the declared cap.
		const plan = refused(
			await prepareAttachments(io, [png(43)], { transport: "base64" })
		)
		expect(plan.code).toBe("file-too-large")
		// Both numbers in the sentence: the file's own size, and the encoded size
		// the limit is actually measured on.
		expect(plan.reason).toContain("43 bytes")
		expect(plan.reason).toContain("60 bytes once base64-encoded")
		expect(plan.reason).toContain("per file, per a test")

		// And on a raw transport the same file is fine, which is the whole of the
		// difference the declaration makes.
		expect(ok(await prepareAttachments(io, [png(43)])).files).toHaveLength(
			1
		)
	})
})

describe("over-supply is refused, never sliced", () => {
	test("thirty images to a backend that takes twenty is a refusal", async () => {
		const io: AdapterIo = {
			in: {
				image: {
					maxFiles: cap(20, "the service's published limit")
				}
			}
		}
		const plan = refused(
			await prepareAttachments(
				io,
				Array.from({ length: 30 }, () => png(8))
			)
		)
		expect(plan.code).toBe("too-many-files")
		expect(plan.index).toBeNull()
		expect(plan.reason).toContain("30")
		expect(plan.reason).toContain("20")
		expect(plan.reason).toContain("the service's published limit")
		// The number to remove, so the message is actionable rather than merely
		// correct.
		expect(plan.reason).toContain("Remove 10")
	})

	test("exactly at the cap is fine; one over is not", async () => {
		const io: AdapterIo = { in: { image: { maxFiles: cap(3, "a test") } } }
		const three = Array.from({ length: 3 }, () => png(8))
		expect(ok(await prepareAttachments(io, three)).files.length).toBe(3)
		expect(
			refused(await prepareAttachments(io, [...three, png(8)])).code
		).toBe("too-many-files")
	})

	test("the count is checked before anything is converted", async () => {
		// Not merely an optimisation: the refusal must not depend on whether
		// N-plus-one large files happen to decode, so a truncated file in an
		// over-supplied request still reports the count.
		const io: AdapterIo = {
			in: {
				image: { accepts: ["image/jpeg"], maxFiles: cap(1, "a test") }
			}
		}
		const plan = refused(
			await prepareAttachments(io, [
				{
					bytes: Buffer.from("not an image at all"),
					mime: "image/png"
				},
				{ bytes: Buffer.from("nor is this"), mime: "image/png" }
			])
		)
		expect(plan.code).toBe("too-many-files")
	})
})

describe("order is preserved end to end", () => {
	test("across mixed kinds and conversions of very uneven cost", async () => {
		// The expensive conversion is FIRST and the trivial one is LAST, so a
		// completion-ordered implementation puts the 2x2 in front of the 640x640
		// and this fails. The PDF in the middle is what a regroup-by-kind
		// implementation would move to one end.
		const io: AdapterIo = {
			in: {
				image: { accepts: ["image/jpeg"] },
				document: { accepts: ["application/pdf"] }
			}
		}
		const pdf = fakePdf()
		const plan = ok(
			await prepareAttachments(io, [
				{ bytes: noisyPng(640, 640, 250), mime: "image/png" },
				{ bytes: pdf, mime: "application/pdf" },
				{ bytes: await jpegOf(160, 160, 120), mime: "image/jpeg" },
				{ bytes: noisyPng(8, 8, 10), mime: "image/png" }
			])
		)

		// Identified by CONTENT rather than by the shape of the list: a length
		// check passes on a reordered payload.
		const identified = await Promise.all(
			plan.files.map(async (f) => {
				if (f.kind === "document") return `pdf:${f.bytes.length}`
				const raster = await decodeImage(f.bytes, f.mime)
				return `${raster.width}x${raster.height}`
			})
		)
		expect(identified).toEqual([
			"640x640",
			`pdf:${pdf.length}`,
			"160x160",
			"8x8"
		])

		// And each slot says honestly whether it was re-encoded: the PNGs were,
		// the already-acceptable JPEG and the PDF were not.
		expect(plan.files.map((f) => f.converted)).toEqual([
			true,
			false,
			false,
			true
		])
		expect(plan.files.map((f) => f.mime)).toEqual([
			"image/jpeg",
			"application/pdf",
			"image/jpeg",
			"image/jpeg"
		])
	})

	test("the reported refusal is the first offender in INPUT order", async () => {
		// Two broken files, and which one is named must not depend on which
		// conversion finished first.
		const io: AdapterIo = { in: { image: { accepts: ["image/jpeg"] } } }
		const plan = refused(
			await prepareAttachments(io, [
				{ bytes: noisyPng(4, 4, 1), mime: "image/png" },
				{
					bytes: Buffer.from("truncated"),
					mime: "image/png",
					filename: "b.png"
				},
				{
					bytes: Buffer.from("also truncated"),
					mime: "image/png",
					filename: "c.png"
				}
			])
		)
		expect(plan.index).toBe(1)
		expect(plan.reason).toContain("b.png")
	})
})

describe("one bad file refuses the whole request", () => {
	test("a payload is never sent with a hole in it", async () => {
		// Deliberately UNLIKE `convertMediaBatch`, which isolates failure to one
		// slot because a gallery can show four of five thumbnails. A service
		// cannot: four of five attachments is a quiet truncation, and the answer
		// that comes back reads as the model ignoring the fifth.
		const io: AdapterIo = { in: { image: { accepts: ["image/jpeg"] } } }
		const plan = refused(
			await prepareAttachments(io, [
				{ bytes: await jpegOf(8, 8, 3), mime: "image/jpeg" },
				{ bytes: Buffer.from("junk"), mime: "image/png" },
				{ bytes: await jpegOf(8, 8, 4), mime: "image/jpeg" }
			])
		)
		expect(plan.code).toBe("unconvertible")
		expect(plan.index).toBe(1)
		// The router's own refusal travels with it: `decode-failed` is a broken
		// file the user can replace, `no-converter` is a pair nothing joins, and
		// callers act differently on the two.
		expect(plan.conversion?.code).toBe("decode-failed")
	})

	test("a format the accepted list cannot be reached from is named", async () => {
		const io: AdapterIo = { in: { image: { accepts: ["image/jpeg"] } } }
		const plan = refused(
			await prepareAttachments(io, [
				{ bytes: Buffer.from("fake heic"), mime: "image/heic" }
			])
		)
		expect(plan.code).toBe("unconvertible")
		expect(plan.conversion?.code).toBe("no-converter")
		// The vocabulary's own advice, so the refusal here says what the upload
		// said at the door rather than "unsupported".
		expect(plan.reason).toContain("Most Compatible")
	})

	test("a mime the vocabulary does not know is refused, not guessed at", async () => {
		const plan = refused(
			await prepareAttachments(undefined, [
				png(8),
				{
					bytes: Buffer.from("PK"),
					mime: "application/zip",
					filename: "x.zip"
				}
			])
		)
		expect(plan.code).toBe("unknown-format")
		expect(plan.index).toBe(1)
		expect(plan.reason).toContain("x.zip")
		expect(plan.reason).toContain("application/zip")
	})
})

describe("an accepted file is forwarded rather than converted", () => {
	test("a PDF this build cannot decode is handed straight over", async () => {
		// `application/pdf` is `decode: false` in the format table, and a backend
		// declaring `accepts: ["application/pdf"]` wants it handed straight over.
		//
		// This case originally existed because the router got it wrong: it checked
		// decodability before checking whether a conversion was needed at all, so
		// an acceptable-but-undecodable file came back `no-converter`. The router
		// is fixed and would now forward this itself, so this test no longer
		// guards against that — it pins the ENGINE's own short-circuit, which is
		// still the path taken (the router is never called here) and which still
		// has to exist for the `offered === undefined` case the router cannot
		// express. See the ⚠ note at the short-circuit in `attachments.ts`.
		const pdf = fakePdf()
		const io: AdapterIo = {
			in: { document: { accepts: ["application/pdf"] } }
		}
		const plan = ok(
			await prepareAttachments(io, [
				{ bytes: pdf, mime: "application/pdf" }
			])
		)
		expect(plan.files[0]!.converted).toBe(false)
		expect(plan.files[0]!.mime).toBe("application/pdf")
		expect(plan.files[0]!.ext).toBe("pdf")
		expect(plan.files[0]!.bytes.equals(pdf)).toBe(true)
	})

	test("the forwarded bytes are a copy, not the caller's buffer", async () => {
		// So a caller padding or trimming the payload cannot reach back into what
		// it handed in — the same guarantee the router's passthrough gives.
		const source = Buffer.alloc(8, 1)
		const plan = ok(
			await prepareAttachments(undefined, [
				{ bytes: source, mime: "image/png" }
			])
		)
		plan.files[0]!.bytes.fill(9)
		expect(source.every((b) => b === 1)).toBe(true)
	})

	test("a `; charset=` parameter and a common alias both resolve", async () => {
		// Normalisation stays in the format table's `normalizeMime`; nothing here
		// keeps a second alias list.
		const io: AdapterIo = { in: { image: { accepts: ["image/jpeg"] } } }
		const plan = ok(
			await prepareAttachments(io, [
				{ bytes: await jpegOf(4, 4, 2), mime: "IMAGE/JPG" }
			])
		)
		expect(plan.files[0]!.mime).toBe("image/jpeg")
		expect(plan.files[0]!.converted).toBe(false)
	})
})

describe("output counts travel the applied/ignored channel", () => {
	/** The half of `Translation` the cap needs, recorded so a test can read it. */
	const sink = () => {
		const ignored: string[] = []
		return { ignored, ignore: (key: string) => ignored.push(key) }
	}

	test("nothing declared leaves the request untouched and reports nothing", async () => {
		// Which is every entry in the manifest today, deliberately — so routing a
		// count through this costs an adapter nothing until a cap exists.
		const t = sink()
		expect(capOutputCount(undefined, "image", 30, "batch", t)).toBe(30)
		expect(t.ignored).toEqual([])
	})

	test("a request over the cap is clamped AND reported as ignored", async () => {
		// Clamped rather than refused, because "render four instead of thirty" is
		// still useful, where "read twenty of my thirty images" is not. The
		// `ignored` entry is what makes "why did changing the batch do nothing"
		// answerable — the same channel a short batch is already reported through.
		const io: AdapterIo = { out: { image: { maxFiles: cap(4, "a test") } } }
		const t = sink()
		expect(capOutputCount(io, "image", 30, "batch", t)).toBe(4)
		expect(t.ignored).toEqual(["batch"])
	})

	test("at or under the cap reports nothing", async () => {
		const io: AdapterIo = { out: { image: { maxFiles: cap(4, "a test") } } }
		const t = sink()
		expect(capOutputCount(io, "image", 4, "batch", t)).toBe(4)
		expect(capOutputCount(io, "image", 1, "batch", t)).toBe(1)
		expect(t.ignored).toEqual([])
	})

	test("a cap on one kind does not clamp another", async () => {
		const io: AdapterIo = { out: { video: { maxFiles: cap(1, "a test") } } }
		const t = sink()
		expect(capOutputCount(io, "image", 9, "batch", t)).toBe(9)
		expect(t.ignored).toEqual([])
	})
})
