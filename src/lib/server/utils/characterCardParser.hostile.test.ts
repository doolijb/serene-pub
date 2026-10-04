/**
 * Hostile cards (lorebooks consolidation plan, Phase S1 + S2). Every fixture is
 * built here, a few bytes at a time — no file of hostile bytes lives in the tree.
 *
 * ⚠ The three that took the server down before the fix (a WebP that looped
 * until the heap died, a zip64 CHARX that held the event loop for minutes, a
 * CHARX that unpacked one 16 MiB file sixty-four times) are only ever parsed in
 * a CHILD process with a 64 MB heap and a hard timeout. A regression then fails
 * one test instead of taking the test runner down with it.
 */

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { crc32 } from "node:zlib"
import { describe, expect, test } from "vitest"
import { deflateSync, strToU8, zipSync } from "fflate"
import { PNG } from "pngjs"
import {
	CARD_IMAGE_LIMITS,
	CHARX_LIMITS,
	embedCharacterCardInPng,
	getRobustSpecV3Data,
	parseCharacterCard,
	readCharxContainer,
	readZipDirectory,
	validateCardImageChunks,
	validatePngChunkLengths
} from "./characterCardParser"
import { extractCharacterFromPNG } from "./sillyTavernParsers"

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const PARSER_URL = new URL("./characterCardParser.ts", import.meta.url).href

/* ── Isolation: parse in a child with a small heap and a deadline ──────── */

const ISOLATION_TIMEOUT_MS = 15_000

interface IsolatedParse {
	/** Null when the child died (heap exhausted, or killed at the deadline). */
	outcome: { ok: boolean; error?: string; ms: number } | null
	code: number | null
	signal: NodeJS.Signals | null
	stderrTail: string
}

const PROBE = `
import { parseCharacterCard } from ${JSON.stringify(PARSER_URL)}
let input = ""
for await (const chunk of process.stdin) input += chunk
const bytes = Buffer.from(input, "base64")
const started = performance.now()
let outcome
try {
	await parseCharacterCard(bytes)
	outcome = { ok: true }
} catch (e) {
	outcome = { ok: false, error: String((e && e.message) || e) }
}
console.log(JSON.stringify({ ...outcome, ms: performance.now() - started }))
`

function parseInIsolation(bytes: Uint8Array): Promise<IsolatedParse> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"--max-old-space-size=64",
				"--import",
				"tsx",
				"--input-type=module",
				"-e",
				PROBE
			],
			{ cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"] }
		)
		let stdout = ""
		let stderr = ""
		child.stdout.on("data", (c) => (stdout += c))
		child.stderr.on("data", (c) => (stderr = (stderr + c).slice(-2000)))
		const deadline = setTimeout(
			() => child.kill("SIGTERM"),
			ISOLATION_TIMEOUT_MS
		)
		child.on("close", (code, signal) => {
			clearTimeout(deadline)
			const last = stdout.trim().split("\n").pop() ?? ""
			let outcome: IsolatedParse["outcome"] = null
			try {
				outcome = JSON.parse(last)
			} catch {
				outcome = null
			}
			resolve({ outcome, code, signal, stderrTail: stderr.slice(-600) })
		})
		child.stdin.end(Buffer.from(bytes).toString("base64"))
	})
}

/** The child lived, and refused the card with `error`, inside `withinMs`. */
function expectRefusedInIsolation(
	run: IsolatedParse,
	error: RegExp,
	withinMs = 100
) {
	expect(
		run.outcome,
		`child died (code ${run.code}, signal ${run.signal}): ${run.stderrTail}`
	).not.toBeNull()
	expect(run.outcome!.ok).toBe(false)
	expect(run.outcome!.error).toMatch(error)
	expect(run.outcome!.ms).toBeLessThan(withinMs)
}

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const card = (name: string) => ({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name,
		description: "Built in a test",
		first_mes: "Hello.",
		tags: ["fixture"],
		extensions: {}
	}
})

/** The 32-byte WebP of plan S1: one EXIF chunk whose length reads as -8. */
function negativeLengthWebp(): Buffer {
	const b = Buffer.alloc(32)
	b.write("RIFF", 0, "latin1")
	b.writeUInt32LE(24, 4)
	b.write("WEBP", 8, "latin1")
	b.write("EXIF", 12, "latin1")
	b.writeUInt32LE(0xfffffff8, 16) // F8 FF FF FF at offset 16
	return b
}

/**
 * The 102-byte CHARX of plan S2: a local-header magic (so it routes as a
 * CHARX), a zip64 end record claiming 4,294,967,295 files, its locator and
 * the classic end record.
 */
function zip64CountBomb(): Buffer {
	const b = Buffer.alloc(102)
	b.writeUInt32LE(0x04034b50, 0)
	b.writeUInt32LE(0x06064b50, 4) // zip64 end of central directory
	b.writeBigUInt64LE(44n, 8)
	b.writeUInt32LE(0xffffffff, 4 + 24) // files on this disk
	b.writeUInt32LE(0xffffffff, 4 + 32) // files in all
	b.writeUInt32LE(0, 4 + 48) // directory offset
	b.writeUInt32LE(0x07064b50, 60) // zip64 locator
	b.writeUInt32LE(4, 60 + 8) // -> the zip64 record at 4
	b.writeUInt32LE(1, 60 + 16)
	b.writeUInt32LE(0x06054b50, 80) // end of central directory
	b.writeUInt16LE(0xffff, 80 + 8)
	b.writeUInt16LE(0xffff, 80 + 10)
	b.writeUInt32LE(0xffffffff, 80 + 12)
	b.writeUInt32LE(0xffffffff, 80 + 16)
	return b
}

interface FixtureFile {
	name: string
	/** The bytes as they sit in the archive — already deflated when `method` is 8. */
	stored: Uint8Array
	method: 0 | 8
	/** What the directory declares the file unpacks to. */
	unpackedBytes: number
	crc?: number
	/** Both sizes 0xFFFFFFFF, the real ones in a zip64 extra (APPNOTE 4.5.3). */
	sizesInZip64Extra?: boolean
	/** How many directory records name this file; more than one is a duplicate. */
	records?: number
	/** More directory records, under OTHER names, pointing at this file's local header. */
	aliases?: string[]
	/**
	 * Written as a streaming zip writer writes it (general-purpose bit 3): the
	 * local header's CRC and sizes are zero, and a data descriptor carrying
	 * them follows the data. Only the central directory has the real sizes.
	 */
	dataDescriptor?: boolean
}

function zip64SizesExtra(unpacked: number, stored: number): Buffer {
	const x = Buffer.alloc(20)
	x.writeUInt16LE(0x0001, 0)
	x.writeUInt16LE(16, 2)
	x.writeBigUInt64LE(BigInt(unpacked), 4)
	x.writeBigUInt64LE(BigInt(stored), 12)
	return x
}

/** A zip written by hand, so its directory can say things zipSync never would. */
function zipFixture(files: FixtureFile[]): Buffer {
	const local: Buffer[] = []
	const central: Buffer[] = []
	let offset = 0
	for (const f of files) {
		const name = Buffer.from(f.name, "utf8")
		const zip64 = f.sizesInZip64Extra ?? false
		const extra = zip64
			? zip64SizesExtra(f.unpackedBytes, f.stored.length)
			: Buffer.alloc(0)
		const storedField = zip64 ? 0xffffffff : f.stored.length
		const unpackedField = zip64 ? 0xffffffff : f.unpackedBytes

		const flags = 0x0800 | (f.dataDescriptor ? 0x0008 : 0) // UTF-8 names
		const header = Buffer.alloc(30)
		header.writeUInt32LE(0x04034b50, 0)
		header.writeUInt16LE(zip64 ? 45 : 20, 4)
		header.writeUInt16LE(flags, 6)
		header.writeUInt16LE(f.method, 8)
		if (!f.dataDescriptor) {
			header.writeUInt32LE(f.crc ?? 0, 14)
			header.writeUInt32LE(storedField, 18)
			header.writeUInt32LE(unpackedField, 22)
		}
		header.writeUInt16LE(name.length, 26)
		header.writeUInt16LE(extra.length, 28)

		const recordFor = (recordName: Buffer) => {
			const record = Buffer.alloc(46)
			record.writeUInt32LE(0x02014b50, 0)
			record.writeUInt16LE(zip64 ? 45 : 20, 4)
			record.writeUInt16LE(zip64 ? 45 : 20, 6)
			record.writeUInt16LE(flags, 8)
			record.writeUInt16LE(f.method, 10)
			record.writeUInt32LE(f.crc ?? 0, 16)
			record.writeUInt32LE(storedField, 20)
			record.writeUInt32LE(unpackedField, 24)
			record.writeUInt16LE(recordName.length, 28)
			record.writeUInt16LE(extra.length, 30)
			record.writeUInt32LE(offset, 42)
			return [record, recordName, extra]
		}
		for (let i = 0; i < (f.records ?? 1); i++) central.push(...recordFor(name))
		for (const alias of f.aliases ?? []) central.push(...recordFor(Buffer.from(alias, "utf8")))

		const descriptor = Buffer.alloc(f.dataDescriptor ? 16 : 0)
		if (f.dataDescriptor) {
			descriptor.writeUInt32LE(0x08074b50, 0)
			descriptor.writeUInt32LE(f.crc ?? 0, 4)
			descriptor.writeUInt32LE(f.stored.length, 8)
			descriptor.writeUInt32LE(f.unpackedBytes, 12)
		}
		local.push(header, name, extra, Buffer.from(f.stored), descriptor)
		offset +=
			header.length + name.length + extra.length + f.stored.length + descriptor.length
	}
	const directory = Buffer.concat(central)
	const records = files.reduce(
		(n, f) => n + (f.records ?? 1) + (f.aliases?.length ?? 0),
		0
	)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(records, 8)
	end.writeUInt16LE(records, 10)
	end.writeUInt32LE(directory.length, 12)
	end.writeUInt32LE(offset, 16)
	return Buffer.concat([...local, directory, end])
}

/** A card.json as a well-formed deflated fixture file. */
function cardJsonFile(json: unknown, overrides: Partial<FixtureFile> = {}): FixtureFile {
	const raw = strToU8(JSON.stringify(json))
	return {
		name: "card.json",
		stored: deflateSync(raw),
		method: 8,
		unpackedBytes: raw.length,
		crc: crc32(raw),
		...overrides
	}
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
	t.writeUInt16LE(1, 8) // IFD0: one entry, the Exif IFD pointer
	t.writeUInt16LE(0x8769, 10)
	t.writeUInt16LE(4, 12)
	t.writeUInt32LE(1, 14)
	t.writeUInt32LE(26, 18)
	t.writeUInt16LE(1, 26) // Exif IFD: one entry, UserComment
	t.writeUInt16LE(0x9286, 28)
	t.writeUInt16LE(7, 30)
	t.writeUInt32LE(comment.length, 32)
	t.writeUInt32LE(44, 36)
	return Buffer.concat([t, comment])
}

const cardComment = (json: unknown) =>
	userCommentTiff(Buffer.from(JSON.stringify(json)).toString("base64"))

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

function riff(chunks: Buffer[]): Buffer {
	const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks])
	const head = Buffer.alloc(8)
	head.write("RIFF", 0, "latin1")
	head.writeUInt32LE(body.length, 4)
	return Buffer.concat([head, body])
}

/** A real 1×1 lossless WebP, encoded once by libwebp (via sharp). */
const REAL_WEBP = Buffer.from(
	"524946461e000000574542505650384c110000002f000000000750bc2217a5ff8188e87f0000",
	"hex"
)

/** The extended WebP layout a card tool writes: VP8X, the image, then EXIF. */
function webpCard(json: unknown): Buffer {
	const vp8x = Buffer.alloc(10)
	vp8x[0] = 0x08 // the EXIF flag; a 1×1 canvas stores 0 × 0
	const image = REAL_WEBP.subarray(12) // the VP8L chunk, with its pad byte
	return riff([riffChunk("VP8X", vp8x), image, riffChunk("EXIF", cardComment(json))])
}

/** A real 1×1 baseline JPEG, encoded once by libjpeg (via sharp). */
const REAL_JPEG = Buffer.from(
	"/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKABiz//2Q==",
	"base64"
)

/** The JPEG with an APP1 Exif segment carrying the card, right after SOI. */
function jpegCard(json: unknown): Buffer {
	const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), cardComment(json)])
	const app1 = Buffer.alloc(4)
	app1[0] = 0xff
	app1[1] = 0xe1
	app1.writeUInt16BE(payload.length + 2, 2)
	return Buffer.concat([REAL_JPEG.subarray(0, 2), app1, payload, REAL_JPEG.subarray(2)])
}

function pngCard(json: unknown): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data.fill(255)
	return embedCharacterCardInPng(PNG.sync.write(png), json)
}

/**
 * A DEFLATE stream that works without writing: dynamic-Huffman blocks that
 * each declare a fresh 15-bit literal table and hold nothing but their
 * end-of-block, then a final empty stored block. Every block makes the
 * decoder build a 32,768-slot lookup table from ~23 bytes of input, and none
 * writes a byte — so no output ceiling ever stops it.
 *
 * Eight blocks are written bit by bit, which ends on a byte boundary, and
 * that group is repeated to `bytes`.
 */
function workWithoutWriting(bytes: number): Uint8Array {
	const out: number[] = []
	let cur = 0
	let n = 0
	const put = (v: number, len: number) => {
		for (let i = 0; i < len; i++) {
			cur |= ((v >> i) & 1) << n
			if (++n === 8) {
				out.push(cur)
				cur = 0
				n = 0
			}
		}
	}
	// A Huffman code is written most significant bit first.
	const putCode = (code: number, len: number) => {
		for (let i = len - 1; i >= 0; i--) put((code >> i) & 1, 1)
	}
	const canonical = (lens: number[]) => {
		const max = Math.max(...lens)
		const count = new Array<number>(max + 1).fill(0)
		for (const l of lens) if (l) count[l]!++
		const next: number[] = []
		let code = 0
		count[0] = 0
		for (let b = 1; b <= max; b++) next[b] = code = (code + count[b - 1]!) << 1
		return lens.map((l) => (l ? next[l]!++ : 0))
	}
	// Literal/length: symbols 0–13 at lengths 1–14, 14 and end-of-block at
	// 15 — a complete code whose longest is 15 bits. Two distance codes.
	const litlen = new Array<number>(257).fill(0)
	for (let i = 0; i < 14; i++) litlen[i] = i + 1
	litlen[14] = 15
	litlen[256] = 15
	const lengths = [...litlen, 1, 1]
	// The lengths, run-length coded: literal 1–15, then zeros by 18 (11–138).
	const runs: Array<[number, number, number]> = []
	for (let i = 0; i < lengths.length; ) {
		let zeros = 0
		while (lengths[i + zeros] === 0 && zeros < 138) zeros++
		if (zeros >= 11) {
			runs.push([18, zeros - 11, 7])
			i += zeros
		} else {
			runs.push([lengths[i]!, 0, 0])
			i++
		}
	}
	const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
	const used = [...new Set(runs.map((r) => r[0]))].sort((a, b) => a - b)
	const clen = new Array<number>(19).fill(0)
	// k symbols at 4 bits and the rest at 5 make a complete code: 2k + m = 32.
	used.forEach((sym, i) => (clen[sym] = i < 32 - used.length ? 4 : 5))
	const clCodes = canonical(clen)
	let hclen = 19
	while (clen[ORDER[hclen - 1]!] === 0) hclen--
	const llCodes = canonical(litlen)
	for (let b = 0; b < 8; b++) {
		put(0, 1) // not the last block
		put(2, 2) // dynamic Huffman
		put(0, 5) // 257 literal/length codes
		put(1, 5) // 2 distance codes
		put(hclen - 4, 4)
		for (let i = 0; i < hclen; i++) put(clen[ORDER[i]!]!, 3)
		for (const [sym, extra, len] of runs) {
			putCode(clCodes[sym]!, clen[sym]!)
			if (len) put(extra, len)
		}
		putCode(llCodes[256]!, litlen[256]!) // end of block, and nothing else
	}
	const group = Buffer.from(out)
	const body = Buffer.alloc(Math.max(group.length, bytes - group.length))
	for (let at = 0; at < body.length; at += group.length) group.copy(body, at)
	const whole = body.subarray(0, body.length - (body.length % group.length))
	// The final block: stored, empty (last-block bit, type 00, aligned, LEN 0).
	return Buffer.concat([whole, Buffer.from([0x01, 0x00, 0x00, 0xff, 0xff])])
}

/* ── S1: card images ───────────────────────────────────────────────────── */

describe("S1 — a card image's chunks are checked before the card reader walks them", () => {
	test("the 32-byte WebP is refused quickly, without exhausting a 64 MB heap", async () => {
		const run = await parseInIsolation(negativeLengthWebp())
		expectRefusedInIsolation(run, /Malformed \.webp/)
	}, 30_000)

	test("any RIFF chunk length with the high bit set is refused, wherever it sits", () => {
		expect(() => validateCardImageChunks(negativeLengthWebp())).toThrow(
			/Malformed \.webp/
		)
		const late = webpCard(card("Late"))
		const tail = riffChunk("JUNK", new Uint8Array(0))
		tail.writeUInt32LE(0x80000000, 4)
		expect(() => validateCardImageChunks(Buffer.concat([late, tail]))).toThrow(
			/Malformed \.webp/
		)
	})

	test("an image of more chunks than a card ever needs is refused", () => {
		const prior = CARD_IMAGE_LIMITS.chunks
		CARD_IMAGE_LIMITS.chunks = 3
		try {
			const empties = Array.from({ length: 4 }, () =>
				riffChunk("JUNK", new Uint8Array(0))
			)
			expect(() => validateCardImageChunks(riff(empties))).toThrow(
				/more than 3 chunks/
			)
			const segment = Buffer.from([0xff, 0xe5, 0x00, 0x02])
			const jpeg = Buffer.concat([
				Buffer.from([0xff, 0xd8]),
				segment,
				segment,
				segment,
				segment,
				Buffer.from([0xff, 0xd9])
			])
			expect(() => validateCardImageChunks(jpeg)).toThrow(/more than 3 chunks/)
			const png = pngCard(card("Crowded")) // IHDR, IDAT, tEXt, IEND
			expect(() => validateCardImageChunks(png)).toThrow(/more than 3 chunks/)
		} finally {
			CARD_IMAGE_LIMITS.chunks = prior
		}
	})

	test("the SillyTavern folder import's PNG walk has the same chunk ceiling", async () => {
		const png = pngCard(card("Folder Card")) // IHDR, IDAT, tEXt, IEND
		expect((await extractCharacterFromPNG(png))?.data.name).toBe("Folder Card")
		const prior = CARD_IMAGE_LIMITS.chunks
		CARD_IMAGE_LIMITS.chunks = 3
		try {
			expect(() => validatePngChunkLengths(png)).toThrow(/more than 3 chunks/)
			// Refused before `png-chunks-extract` builds an object per chunk.
			expect(await extractCharacterFromPNG(png)).toBeNull()
		} finally {
			CARD_IMAGE_LIMITS.chunks = prior
		}
	})
})

/* ── S2: CHARX containers ──────────────────────────────────────────────── */

describe("S2 — a CHARX's directory is read and checked before anything unpacks", () => {
	test("the 102-byte zip64 CHARX is refused in under 100ms", async () => {
		const run = await parseInIsolation(zip64CountBomb())
		expectRefusedInIsolation(run, /claims 4294967295 files/)
	}, 30_000)

	test("a declared-size bomb — card.json named 64 times at 16 MiB each — is refused", async () => {
		const sixteenMiB = 16 * 1024 * 1024
		const zeros = new Uint8Array(sixteenMiB)
		const bomb = zipFixture([
			{
				name: "card.json",
				stored: deflateSync(zeros, { level: 1 }),
				method: 8,
				unpackedBytes: sixteenMiB,
				records: 64
			}
		])
		expect(bomb.length).toBeLessThan(32 * 1024)
		const run = await parseInIsolation(bomb)
		expectRefusedInIsolation(run, /lists one file twice/)
	}, 30_000)

	test("a zip64 size far past what its data can hold is refused, never allocated", async () => {
		const lie = zipFixture([
			cardJsonFile(card("Liar"), {
				stored: deflateSync(new Uint8Array(0)),
				unpackedBytes: 2 ** 32 + 5,
				sizesInZip64Extra: true
			})
		])
		await expect(readCharxContainer(lie)).rejects.toThrow(/more than its data can hold/)
	})

	test("a file that unpacks past what it declares is stopped mid-stream", async () => {
		const underDeclared = zipFixture([
			{
				name: "card.json",
				stored: deflateSync(new Uint8Array(8 * 1024 * 1024), { level: 1 }),
				method: 8,
				unpackedBytes: 64
			}
		])
		await expect(readCharxContainer(underDeclared)).rejects.toThrow(
			/unpacks to more than it declares/
		)
	})

	test("a directory listing more files than a card ever needs is refused", () => {
		const prior = CHARX_LIMITS.files
		CHARX_LIMITS.files = 2
		try {
			const crowded = Buffer.from(
				zipSync({
					"card.json": strToU8(JSON.stringify(card("Crowded"))),
					"a.txt": strToU8("a"),
					"b.txt": strToU8("b")
				})
			)
			expect(() => readZipDirectory(crowded)).toThrow(/lists 3 files/)
		} finally {
			CHARX_LIMITS.files = prior
		}
	})

	test("a DEFLATE stream that works without writing is stopped within its allowance", async () => {
		// Four MB of empty dynamic blocks: seven seconds of held event loop
		// before, and not one byte written, so no size ceiling ever fired.
		const busy = zipFixture([
			{ name: "card.json", stored: workWithoutWriting(4 * 1024 * 1024), method: 8, unpackedBytes: 1024 }
		])
		const run = await parseInIsolation(busy)
		expectRefusedInIsolation(run, /takes far longer to unpack than its size explains/, 1500)
	}, 30_000)

	test("two names on one file's bytes are refused", () => {
		// The sprite form of the declared-size bomb: a name listed twice is
		// refused, so the same data is listed under many names instead.
		const aliased = zipFixture([
			cardJsonFile(card("Aliased"), { aliases: ["assets/a.png", "assets/b.png"] })
		])
		expect(() => readZipDirectory(aliased)).toThrow(/share the same data/)
	})

	test("the directory reader refuses the 102-byte bomb without walking it", () => {
		const started = performance.now()
		expect(() => readZipDirectory(zip64CountBomb())).toThrow(
			/claims 4294967295 files in 102 bytes/
		)
		expect(performance.now() - started).toBeLessThan(100)
	})
})

/* ── Real cards still import ───────────────────────────────────────────── */

describe("real cards still import", () => {
	test("PNG", async () => {
		const parsed = await parseCharacterCard(pngCard(card("Png Card")))
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Png Card")
	})

	test("WebP (EXIF UserComment)", async () => {
		const webp = webpCard(card("Webp Card"))
		expect(() => validateCardImageChunks(webp)).not.toThrow()
		const parsed = await parseCharacterCard(webp)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Webp Card")
	})

	test("JPEG (Exif UserComment)", async () => {
		const jpeg = jpegCard(card("Jpeg Card"))
		expect(() => validateCardImageChunks(jpeg)).not.toThrow()
		const parsed = await parseCharacterCard(jpeg)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Jpeg Card")
	})

	test("CHARX written by fflate, with an embedded icon", async () => {
		const png = pngCard(card("Icon"))
		const charx = Buffer.from(
			zipSync({
				"card.json": strToU8(
					JSON.stringify({
						spec: "chara_card_v3",
						spec_version: "3.0",
						data: {
							...card("Charx Card").data,
							assets: [
								{ type: "icon", uri: "embeded://assets/icon.png", name: "main", ext: "png" }
							]
						}
					})
				),
				"assets/icon.png": png
			})
		)
		const parsed = await parseCharacterCard(charx)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Charx Card")
		expect(parsed.avatarBuffer?.equals(png)).toBe(true)
	})

	test("CHARX whose sizes live in zip64 extras (fflate #298 read them as 4 GiB)", async () => {
		const charx = zipFixture([
			cardJsonFile(card("Zip64 Card"), { sizesInZip64Extra: true })
		])
		const parsed = await parseCharacterCard(charx)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Zip64 Card")
	})

	test("CHARX written by a streaming writer: sizes in data descriptors, not local headers", async () => {
		const png = pngCard(card("Icon"))
		const json = {
			spec: "chara_card_v3",
			spec_version: "3.0",
			data: {
				...card("Streamed Card").data,
				assets: [{ type: "icon", uri: "embeded://assets/icon.png", name: "main", ext: "png" }]
			}
		}
		const charx = zipFixture([
			cardJsonFile(json, { dataDescriptor: true }),
			{
				name: "assets/icon.png",
				stored: deflateSync(png),
				method: 8,
				unpackedBytes: png.length,
				crc: crc32(png),
				dataDescriptor: true
			}
		])
		const parsed = await parseCharacterCard(charx)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Streamed Card")
		expect(parsed.avatarBuffer?.equals(png)).toBe(true)
	})

	test("CHARX with a stored (uncompressed) card.json", async () => {
		const raw = strToU8(JSON.stringify(card("Stored Card")))
		const charx = zipFixture([
			{ name: "card.json", stored: raw, method: 0, unpackedBytes: raw.length, crc: crc32(raw) }
		])
		const parsed = await parseCharacterCard(charx)
		expect(getRobustSpecV3Data(parsed.card).name).toBe("Stored Card")
	})
})
