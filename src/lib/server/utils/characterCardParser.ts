/**
 * Shared utilities for parsing character cards (PNG, JPEG, WebP, JSON or CHARX)
 * Used by both character and persona import handlers
 */

import {
	CharacterCard,
	JPEG,
	WebP,
	parseImageMetadata,
	type ParsedMetadata,
	type SpecV3
} from "@lenml/char-card-reader"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import text from "png-chunk-text"
import { fileTypeFromBuffer } from "file-type"
import { Inflate, strFromU8 } from "fflate"
import { hasLorebookEntries } from "./lorebookImportMapper"
import {
	CARD_SPRITE_LIMITS,
	bytesOfDataUri,
	decodeBase64Capped,
	embeddedPathOf,
	extractCardSprites,
	spriteAssetsOf,
	type CardSprite,
	type ExtractedSprites
} from "./cardSprites"
import {
	IMPORT_FILE_CAPS,
	cardFileTooLarge,
	megabytes
} from "$lib/shared/imports/fileCaps"
import { assertImportJsonShape } from "$lib/server/imports/jsonShape"

/**
 * `png-chunks-extract`'s `extractChunks` reads each chunk's 32-bit declared
 * length and immediately does `new Uint8Array(length)` — BEFORE checking
 * whether the buffer actually has that many bytes remaining. A crafted PNG
 * (a normal-sized file with one chunk lying about its length, up to ~4GB)
 * can trigger a huge allocation from a tiny upload. This walks the same
 * chunk structure using only bounds checks (no allocation) and throws
 * before `extract()` ever gets a chance to over-allocate. Call this
 * immediately before every `extract(buffer)` call on untrusted input.
 */
export function validatePngChunkLengths(buffer: Buffer | Uint8Array): void {
	if (
		buffer.length < 8 ||
		buffer[0] !== 0x89 ||
		buffer[1] !== 0x50 ||
		buffer[2] !== 0x4e ||
		buffer[3] !== 0x47 ||
		buffer[4] !== 0x0d ||
		buffer[5] !== 0x0a ||
		buffer[6] !== 0x1a ||
		buffer[7] !== 0x0a
	) {
		throw new Error("Invalid .png file header")
	}

	let idx = 8
	let chunks = 0
	while (idx < buffer.length) {
		if (idx + 8 > buffer.length) {
			throw new Error(
				".png file ended prematurely: truncated chunk header"
			)
		}
		// `extract()` keeps an object per chunk too, so the card reader's
		// ceiling guards it as well (S1) — the SillyTavern folder import calls
		// it with only this check in front.
		if (++chunks > CARD_IMAGE_LIMITS.chunks) {
			throw new Error(
				`This .png file has more than ${CARD_IMAGE_LIMITS.chunks} chunks, more than Serene Pub will read.`
			)
		}
		const length =
			(buffer[idx] << 24) |
			(buffer[idx + 1] << 16) |
			(buffer[idx + 2] << 8) |
			buffer[idx + 3]
		const unsignedLength = length >>> 0
		// name(4) + data(unsignedLength) + crc(4)
		const chunkEnd = idx + 8 + unsignedLength + 4
		if (chunkEnd > buffer.length) {
			throw new Error(
				"Malformed .png: a chunk declares a length larger than the file"
			)
		}
		idx = chunkEnd
	}
}

/**
 * Ceilings on a card image's structure, checked before `@lenml/char-card-reader`
 * walks it. The reader keeps an object per chunk (a PNG or RIFF chunk, a JPEG
 * marker segment), so a file of empty chunks is a heap bomb even when every
 * length is honest: 16 MB of them cost 150–430 MB of heap and up to 2s of
 * event loop. A real card has tens; an APNG or animated WebP, a few thousand.
 */
export const CARD_IMAGE_LIMITS = {
	chunks: 65_536
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Walk a card image's chunks exactly as `@lenml/char-card-reader`'s metadata
 * parsers will — same format sniff, same loop, same stopping points — and
 * throw before the reader is handed anything it cannot survive:
 *
 * - **WebP** (plan S1): the reader takes a RIFF chunk length as a SIGNED
 *   32-bit value (its PNG parser has `>>> 0`, its WebP parser does not), so a
 *   length with the high bit set steps the walk backwards or not at all and
 *   it pushes chunks until the heap dies. No real chunk is 2 GiB, so any such
 *   length is refused, wherever it sits.
 * - **JPEG** and **PNG** read their lengths unsigned and always advance; they
 *   share only the chunk-count ceiling.
 *
 * Past that the walk mirrors the reader, never stricter: where the reader
 * stops quietly (a chunk running off the end), this stops too, so every card
 * that imported before still does. `validatePngChunkLengths` is the strict
 * walk `png-chunks-extract` needs; this one guards the reader.
 */
export function validateCardImageChunks(buffer: Uint8Array): void {
	const d = buffer
	const len = d.length
	let chunks = 0
	const count = (format: string) => {
		if (++chunks > CARD_IMAGE_LIMITS.chunks) {
			throw new Error(
				`This ${format} file has more than ${CARD_IMAGE_LIMITS.chunks} chunks, more than Serene Pub will read.`
			)
		}
	}

	// The reader's own sniff, in its order: PNG, then JPEG, then WebP.
	if (PNG_SIGNATURE.every((b, i) => i >= len || d[i] === b)) {
		let at = 8
		while (at + 8 <= len) {
			const length =
				((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0
			const end = at + 8 + length
			if (end + 4 > len) return
			count(".png")
			at = end + 4
		}
		return
	}

	if (d[0] === 0xff && d[1] === 0xd8) {
		let at = 2
		while (at < len) {
			if (d[at] !== 0xff) return // the reader throws here
			while (d[at + 1] === 0xff) at++ // fill bytes
			const marker = d[at + 1]
			at += 2
			if (marker === 0xd9 || marker === 0xda) return
			// The length counts its own two bytes; the next marker follows it.
			const length = (d[at] << 8) | d[at + 1]
			count(".jpeg")
			at += length
		}
		return
	}

	const ascii = (from: number) =>
		String.fromCharCode(d[from], d[from + 1], d[from + 2], d[from + 3])
	if (len >= 12 && ascii(0) === "RIFF" && ascii(8) === "WEBP") {
		let at = 12
		while (at + 8 <= len) {
			const length =
				(d[at + 4] | (d[at + 5] << 8) | (d[at + 6] << 16) | (d[at + 7] << 24)) >>> 0
			if (length >= 0x80000000) {
				throw new Error(
					"Malformed .webp: a chunk declares a length larger than the file"
				)
			}
			const end = at + 8 + length
			if (end > len) return
			count(".webp")
			at = end + (length % 2) // chunks are padded to even sizes
		}
	}
}

/**
 * card.toSpecV3() is reliable for V2/V3 cards, but the underlying package's
 * field getters silently drop or corrupt a few fields for older (V1/
 * legacy) cards — which have no `spec`/`data` wrapper at all and fall
 * through to the getters' generic default case:
 *   - tags / alternate_greetings: the default-case getter hardcodes `[]`
 *     rather than ever checking raw_data, so a V1-ish card that happens to
 *     carry real tag/greeting data (some tools add these to otherwise-flat
 *     cards) has it silently discarded.
 *   - creation_date / modification_date / name / description: the
 *     default-case getter returns the literal string "unknown" instead of
 *     omitting the field when absent, which would otherwise get stored as
 *     if it were real data — for `name` in particular, this is how a file
 *     that isn't a character card at all (valid JSON, but none of the
 *     recognized fields) silently produces an "unknown"-named character
 *     instead of failing to import.
 * This re-derives just those fields from the card's own raw source data
 * (which always has the true original shape, V1-flat or V2/V3-nested,
 * regardless of what the getters do), so older-format cards import with
 * full fidelity instead of quietly losing data through getter defaults
 * that only really fit V2/V3.
 *
 * @throws Error if the card has no real name — see the `name` handling
 * above; a missing name means the input wasn't actually a character card.
 */
export function getRobustSpecV3Data(
	card: CharacterCard
): SpecV3.CharacterCardV3["data"] {
	const v3 = card.toSpecV3().data
	const raw = card.raw_data as any
	const rawTop = raw ?? {}
	const rawNested = raw?.data ?? {}

	const rawTags = rawNested.tags ?? rawTop.tags
	const tags = v3.tags?.length
		? v3.tags
		: Array.isArray(rawTags)
			? rawTags
			: []
	const rawAlternateGreetings =
		rawNested.alternate_greetings ?? rawTop.alternate_greetings
	const alternateGreetings = v3.alternate_greetings?.length
		? v3.alternate_greetings
		: Array.isArray(rawAlternateGreetings)
			? rawAlternateGreetings
			: []
	// Typed as `number` (an epoch timestamp) per spec, but the package's own
	// getter fallback for older cards returns the *string* "unknown" instead
	// of omitting the field when there's no real date — a runtime/type
	// mismatch in the library itself, hence the `typeof` check rather than a
	// same-type comparison.
	const creationDate =
		v3.creation_date && typeof v3.creation_date !== "string"
			? v3.creation_date
			: undefined
	const modificationDate =
		v3.modification_date && typeof v3.modification_date !== "string"
			? v3.modification_date
			: undefined
	// Same "unknown" placeholder-default quirk as the dates above, but for
	// name/description — checked against the raw source rather than assumed
	// fake outright, since a card could legitimately be raw-named "unknown".
	const name =
		v3.name === "unknown" &&
		rawNested.name === undefined &&
		rawTop.name === undefined
			? ""
			: v3.name
	const description =
		v3.description === "unknown" &&
		rawNested.description === undefined &&
		rawTop.description === undefined
			? ""
			: v3.description

	if (!name?.trim()) {
		throw new Error(
			"This file doesn't look like a valid character card — no character name was found."
		)
	}

	return {
		...v3,
		name,
		description,
		tags,
		alternate_greetings: alternateGreetings,
		creation_date: creationDate,
		modification_date: modificationDate
	}
}

export interface ParsedCharacterCard {
	card: CharacterCard
	avatarBuffer?: Buffer
	lorebook?: SpecV3.Lorebook
	/**
	 * Card assets this import did NOT keep, counted by asset type. Absent
	 * when there are none. See `unimportedAssets`.
	 */
	unimportedAssets?: Record<string, number>
	/**
	 * The card's sprites with their bytes (DESIGN-sprites §4) — CCv3
	 * `emotion`/`expression` assets, Serene Pub's `x_sp_sprite`, and RisuAI's
	 * older emotion pairs. Absent when the card carries none, or when parsed
	 * with `includeAvatar: false`.
	 */
	sprites?: CardSprite[]
}

/**
 * Count the card's assets that Serene Pub does not keep, by asset type.
 *
 * The V3 spec (§assets) lets an application ignore an asset it has no use
 * for, but says it MUST alert the user when it cannot keep the asset's data,
 * because a re-export will then leave it out. Serene Pub keeps exactly one
 * asset, the main icon, as the avatar; everything else is counted here so the
 * import can say so rather than dropping it silently. Sprites
 * (DESIGN-sprites §4) ARE kept now: pass what `extractCardSprites` took and
 * they are not counted.
 *
 * Covers both places a card carries assets: V3 `data.assets` (CHARX, and
 * RisuAI's PNG exports, which embed them as `chara-ext-asset_:` chunks) and
 * RisuAI's older `extensions.risuai.emotions` / `additionalAssets` pairs.
 */
export function unimportedAssets(
	raw: any,
	taken?: Pick<ExtractedSprites, "used" | "legacyUsed">
): Record<string, number> | undefined {
	const counts: Record<string, number> = {}
	const add = (type: unknown) => {
		const key = typeof type === "string" && type.trim() ? type.trim() : "other"
		counts[key] = (counts[key] ?? 0) + 1
	}
	const assets = raw?.data?.assets ?? raw?.assets
	if (Array.isArray(assets)) {
		const kept = mainIconAsset(raw)
		for (const asset of assets) {
			if (!asset || asset === kept || taken?.used.has(asset)) continue
			add(asset.type)
		}
	}
	const risu = raw?.data?.extensions?.risuai ?? raw?.extensions?.risuai
	if (Array.isArray(risu?.emotions)) {
		const left = risu.emotions.length - (taken?.legacyUsed ?? 0)
		for (let i = 0; i < left; i++) add("emotion")
	}
	if (Array.isArray(risu?.additionalAssets)) {
		for (let i = 0; i < risu.additionalAssets.length; i++) add("x-risu-asset")
	}
	return Object.keys(counts).length > 0 ? counts : undefined
}

/**
 * One sentence for the import toast naming what `unimportedAssets` counted.
 * Undefined when nothing was left behind.
 */
export function describeUnimportedAssets(
	counts: Record<string, number> | undefined
): string | undefined {
	if (!counts) return undefined
	const label: Record<string, [string, string]> = {
		emotion: ["emotion image", "emotion images"],
		expression: ["emotion image", "emotion images"],
		background: ["background", "backgrounds"],
		icon: ["alternate icon", "alternate icons"],
		user_icon: ["user icon", "user icons"]
	}
	const parts = Object.entries(counts).map(([type, n]) => {
		const [one, many] = label[type] ?? ["other asset", "other assets"]
		return `${n} ${n === 1 ? one : many}`
	})
	const total = Object.values(counts).reduce((a, b) => a + b, 0)
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
	return `The card's ${list} ${total === 1 ? "was" : "were"} not imported, so exporting this character will leave ${total === 1 ? "it" : "them"} out.`
}

/**
 * Ceilings on what a CHARX may make us read. The byte ceilings are checked
 * against the size the zip DECLARES before anything is unpacked, and
 * unpacking stops the moment a file outgrows its declaration, so a small
 * upload can neither allocate nor inflate its way into a large one (a zip
 * bomb). `files` caps the directory itself: a real card lists tens of files,
 * a large sprite pack a few hundred.
 */
export const CHARX_LIMITS = {
	/** The one card-JSON ceiling, wherever the JSON sits (plan S4). */
	cardJsonBytes: IMPORT_FILE_CAPS.cardJsonBytes,
	iconBytes: 32 * 1024 * 1024,
	files: 10_000
}

/**
 * What unpacking one CHARX may cost in time — its own inflate steps, summed
 * across card.json, the icon and every sprite (lorebooks plan S2).
 *
 * The byte ceilings bound what a card can make us WRITE, not what it can make
 * us DO: a DEFLATE stream of empty blocks, each declaring a fresh 15-bit
 * Huffman table, writes nothing and costs about 1.8 µs a byte to decode —
 * 457 KB of them held the event loop for 834 ms, so the ~75 MB a 100 MB
 * upload carries was two minutes. An honest stream costs time in proportion
 * to what it writes (1–3 ms a MiB here), so the allowance is a base plus a
 * rate per MiB actually written, five-fold over what this machine needs.
 *
 * And the work is handed back to the event loop every `sliceMs`, so even a
 * card that uses its whole allowance never holds everyone else's requests
 * for longer than one slice.
 */
export const CHARX_UNPACK_TIME = {
	baseMs: 250,
	msPerMiB: 16,
	sliceMs: 15
}

/** One CHARX's unpacking so far: its own time, and what it has written. */
interface UnpackClock {
	spentMs: number
	written: number
	/** Work since the event loop last had a turn. */
	sliceSpentMs: number
}

const unpackClock = (): UnpackClock => ({ spentMs: 0, written: 0, sliceSpentMs: 0 })

/** Charge one step to the clock; refuse past the allowance; yield per slice. */
async function tickUnpack(
	clock: UnpackClock,
	ms: number,
	writtenNow: number,
	name: string
): Promise<void> {
	clock.spentMs += ms
	clock.sliceSpentMs += ms
	const allowance =
		CHARX_UNPACK_TIME.baseMs +
		((clock.written + writtenNow) / (1024 * 1024)) * CHARX_UNPACK_TIME.msPerMiB
	if (clock.spentMs > allowance) {
		throw new Error(
			`This .charx file's "${name}" takes far longer to unpack than its size explains, so Serene Pub stopped.`
		)
	}
	if (clock.sliceSpentMs >= CHARX_UNPACK_TIME.sliceMs) {
		clock.sliceSpentMs = 0
		await new Promise<void>((resolve) => setImmediate(resolve))
	}
}

/** A zip local-file header: "PK\x03\x04". CHARX is a plain zip. */
export function isZipBuffer(buffer: Buffer | Uint8Array): boolean {
	return (
		buffer.length >= 4 &&
		buffer[0] === 0x50 &&
		buffer[1] === 0x4b &&
		buffer[2] === 0x03 &&
		buffer[3] === 0x04
	)
}

/**
 * One file a zip's central directory lists, as `readZipDirectory` checked it.
 * "Entry" is the zip format's word (NOMENCLATURE R5) — never a lorebook entry.
 */
export interface ZipEntry {
	name: string
	/** 0 = stored, 8 = DEFLATE; any other method is refused when read. */
	method: number
	/** Where the file's data starts, past its local header. */
	dataStart: number
	/** The bytes the data takes in the archive. */
	storedBytes: number
	/** The bytes it unpacks to; for a stored file, `storedBytes`. */
	unpackedBytes: number
}

const ZIP_END = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_END = 0x06064b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_LOCAL = 0x04034b50
/** The fixed part of a central-directory record; its name and extras follow. */
const ZIP_CENTRAL_BYTES = 46
/** A size or offset at this value lives in the file's zip64 extra field. */
const ZIP64_SENTINEL = 0xffffffff
/** DEFLATE's ceiling: at best one 258-byte match per two bits. */
const DEFLATE_MAX_RATIO = 1032
/** Compressed bytes per inflate step; one step yields at most ~16.5 MB. */
const INFLATE_STEP_BYTES = 16 * 1024

function unreadableZip(reason: string): Error {
	return new Error(
		`This .charx file could not be read as a zip archive: ${reason}.`
	)
}

/**
 * Read a zip's central directory ourselves and check every number in it
 * before anything is unpacked (lorebooks plan S2). fflate's `unzipSync`
 * trusts the directory: it walks as many records as a zip64 end record
 * claims, one filter call each (4.29e9 from 102 bytes, about seven minutes of
 * blocked event loop); with no zip64 end record it reads a zip64 size
 * sentinel as a real 4 GiB size (fflate #298); and it inflates a name listed
 * twice once per listing. None has an upstream fix in 0.8.3, so the directory
 * is read here and fflate only inflates.
 *
 * Refused: more files than the directory has room for (46 bytes a record) or
 * than `CHARX_LIMITS.files`; a record or local header outside the file; a
 * zip64 sentinel with no zip64 extra to resolve it; data running past the end
 * of the file; a DEFLATE size past what its data could ever unpack to; a
 * name listed twice, since then which one is the card?; and two files whose
 * bytes overlap — different names on one local header let a few KB of
 * upload unpack as hundreds of MB of sprites, each one kept on disk.
 */
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
	const len = bytes.length
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const u16 = (at: number) => view.getUint16(at, true)
	const u32 = (at: number) => view.getUint32(at, true)
	const u64 = (at: number) => Number(view.getBigUint64(at, true))

	// The end record is the last 22 bytes, or sits before a comment of up to 64 KiB.
	let end = -1
	for (let at = len - 22; at >= 0 && at >= len - 22 - 0xffff; at--) {
		if (u32(at) === ZIP_END) {
			end = at
			break
		}
	}
	if (end < 0) throw unreadableZip("it has no end-of-archive record")

	let count = u16(end + 10)
	let directoryStart = u32(end + 16)
	if (end >= 20 && u32(end - 20) === ZIP64_LOCATOR) {
		const record = u64(end - 12)
		if (record + 56 > end || u32(record) !== ZIP64_END) {
			throw unreadableZip("its zip64 end record is missing")
		}
		count = u64(record + 32)
		directoryStart = u64(record + 48)
	}
	if (
		directoryStart > end ||
		count * ZIP_CENTRAL_BYTES > end - directoryStart
	) {
		throw unreadableZip(`it claims ${count} files in ${len} bytes`)
	}
	if (count > CHARX_LIMITS.files) {
		throw new Error(
			`This .charx file lists ${count} files, more than Serene Pub will read.`
		)
	}

	const entries = new Map<string, ZipEntry>()
	/** Each file's bytes in the archive, local header to end of data. */
	const spans: Array<[number, number]> = []
	let at = directoryStart
	for (let i = 0; i < count; i++) {
		if (at + ZIP_CENTRAL_BYTES > end || u32(at) !== ZIP_CENTRAL) {
			throw unreadableZip("its directory is damaged")
		}
		const flags = u16(at + 8)
		const method = u16(at + 10)
		let storedBytes = u32(at + 20)
		let unpackedBytes = u32(at + 24)
		let localStart = u32(at + 42)
		const nameStart = at + ZIP_CENTRAL_BYTES
		const extraStart = nameStart + u16(at + 28)
		const extraEnd = extraStart + u16(at + 30)
		const next = extraEnd + u16(at + 32)
		if (next > end) throw unreadableZip("its directory is damaged")

		// Zip64 (APPNOTE 4.5.3): each field at the sentinel is in the extra
		// with header id 1, in this order.
		if (
			unpackedBytes === ZIP64_SENTINEL ||
			storedBytes === ZIP64_SENTINEL ||
			localStart === ZIP64_SENTINEL
		) {
			let field = -1
			let fieldEnd = -1
			for (let x = extraStart; x + 4 <= extraEnd; x += 4 + u16(x + 2)) {
				if (u16(x) === 0x0001) {
					field = x + 4
					fieldEnd = Math.min(field + u16(x + 2), extraEnd)
					break
				}
			}
			const take = () => {
				if (field < 0 || field + 8 > fieldEnd) {
					throw unreadableZip("a file's zip64 sizes are missing")
				}
				const value = u64(field)
				field += 8
				return value
			}
			if (unpackedBytes === ZIP64_SENTINEL) unpackedBytes = take()
			if (storedBytes === ZIP64_SENTINEL) storedBytes = take()
			if (localStart === ZIP64_SENTINEL) localStart = take()
		}

		// Decoded as fflate decodes names: UTF-8 when flag bit 11 says so.
		const name = strFromU8(
			bytes.subarray(nameStart, extraStart),
			!(flags & 0x0800)
		)
		if (entries.has(name)) throw unreadableZip("it lists one file twice")

		// The data starts past the LOCAL header's own name and extras.
		if (localStart + 30 > len || u32(localStart) !== ZIP_LOCAL) {
			throw unreadableZip("a file's local header is missing")
		}
		const dataStart =
			localStart + 30 + u16(localStart + 26) + u16(localStart + 28)
		if (dataStart + storedBytes > len) {
			throw unreadableZip("a file claims more data than the archive holds")
		}
		if (method === 0) {
			unpackedBytes = storedBytes
		} else if (
			method === 8 &&
			unpackedBytes > storedBytes * DEFLATE_MAX_RATIO
		) {
			throw unreadableZip(
				"a file claims to unpack to more than its data can hold"
			)
		}

		entries.set(name, { name, method, dataStart, storedBytes, unpackedBytes })
		spans.push([localStart, dataStart + storedBytes])
		at = next
	}
	// No two files may share a byte of the archive: sorted by where each
	// starts, each must start at or after the end of the one before.
	spans.sort((a, b) => a[0] - b[0])
	for (let i = 1; i < spans.length; i++) {
		if (spans[i]![0] < spans[i - 1]![1]) {
			throw unreadableZip("two of its files share the same data")
		}
	}
	return entries
}

/**
 * Unpack one checked file. DEFLATE runs in steps and stops the moment the
 * output passes the declared size: fflate's one-shot `inflateSync` writes
 * into a buffer of the declared size but decodes the WHOLE stream regardless
 * (262 KB of zeros declared as 100 bytes cost a full second). Every step is
 * charged to the container's `clock` (`CHARX_UNPACK_TIME`), which refuses a
 * stream that works without writing and yields between slices.
 */
async function unpackZipEntry(
	bytes: Uint8Array,
	entry: ZipEntry,
	clock: UnpackClock
): Promise<Uint8Array> {
	const data = bytes.subarray(
		entry.dataStart,
		entry.dataStart + entry.storedBytes
	)
	if (entry.method === 0) {
		clock.written += data.length
		return data.slice()
	}
	if (entry.method !== 8) {
		throw new Error(
			`This .charx file's "${entry.name}" is compressed in a way Serene Pub cannot unpack.`
		)
	}
	const out = new Uint8Array(entry.unpackedBytes)
	let written = 0
	let overflow = false
	const inflater = new Inflate((chunk) => {
		if (overflow) return
		if (written + chunk.length > out.length) {
			overflow = true
			return
		}
		out.set(chunk, written)
		written += chunk.length
	})
	for (let at = 0; at < data.length && !overflow; ) {
		// No more input than the room left (1 KiB at least), so a small
		// declaration that lies is caught within ~1 MB of output.
		const step = Math.min(
			INFLATE_STEP_BYTES,
			Math.max(1024, out.length - written)
		)
		const stop = Math.min(at + step, data.length)
		const started = performance.now()
		try {
			inflater.push(data.subarray(at, stop), stop === data.length)
		} catch (e: any) {
			throw unreadableZip(`"${entry.name}" is damaged (${e?.message || e})`)
		}
		at = stop
		await tickUnpack(clock, performance.now() - started, written, entry.name)
	}
	if (overflow) {
		throw new Error(
			`This .charx file's "${entry.name}" unpacks to more than it declares.`
		)
	}
	clock.written += written
	return written === out.length ? out : out.subarray(0, written)
}

/** Unpack exactly one named file, refusing it if it declares more than `maxBytes`. */
async function readZipEntry(
	bytes: Uint8Array,
	directory: Map<string, ZipEntry>,
	name: string,
	maxBytes: number,
	clock: UnpackClock
): Promise<Uint8Array | undefined> {
	const entry = directory.get(name)
	if (!entry) return undefined
	if (entry.unpackedBytes > maxBytes) {
		throw new Error(
			`This .charx file's "${name}" is larger than Serene Pub will unpack.`
		)
	}
	return unpackZipEntry(bytes, entry, clock)
}

/**
 * Unpack several named files, in directory order, each skipped if it declares
 * more than `maxEach`, and skipping any that would take the declared total
 * past `maxTotal`. A skipped file is simply absent from the result — a card's
 * sprite the import leaves behind, which `unimportedAssets` then counts.
 */
async function readZipEntries(
	bytes: Uint8Array,
	directory: Map<string, ZipEntry>,
	names: ReadonlySet<string>,
	maxEach: number,
	maxTotal: number,
	clock: UnpackClock
): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>()
	if (names.size === 0) return out
	let total = 0
	for (const entry of directory.values()) {
		if (!names.has(entry.name)) continue
		if (entry.unpackedBytes > maxEach) continue
		if (total + entry.unpackedBytes > maxTotal) continue
		total += entry.unpackedBytes
		out.set(entry.name, await unpackZipEntry(bytes, entry, clock))
	}
	return out
}

/**
 * The URI of the card's main icon, per the V3 spec: the `icon` asset named
 * `main`, else the first `icon` asset. Undefined when the card declares none.
 */
function mainIconAsset(raw: any): any {
	const assets = raw?.data?.assets ?? raw?.assets
	if (!Array.isArray(assets)) return undefined
	const icons = assets.filter(
		(a: any) => a && a.type === "icon" && typeof a.uri === "string"
	)
	return icons.find((a: any) => a.name === "main") ?? icons[0]
}

function mainIconUri(raw: any): string | undefined {
	return mainIconAsset(raw)?.uri
}

/**
 * Read a CHARX container (Character Card V3 §CHARX): a zip with `card.json`
 * at its root, assets referenced as `embeded://<path inside the zip>` — the
 * spec's own spelling, and the correctly spelled form is tolerated too.
 *
 * The main icon becomes the avatar, and the card's sprites (`emotion`,
 * `expression` and `x_sp_sprite` assets) are returned for the import to store
 * (DESIGN-sprites §4). Other assets (backgrounds, alternate icons, a RisuAI
 * `module.risum`) are left behind and counted by `unimportedAssets`.
 * `ccdefault:` and remote `http(s)` icons are skipped — the first names no
 * file in a CHARX, and the second would make an import fetch a URL.
 */
export async function readCharxContainer(
	buffer: Buffer | Uint8Array,
	opts?: { includeAvatar?: boolean }
): Promise<{ raw: any; avatarBuffer?: Buffer; sprites?: ExtractedSprites }> {
	const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)
	// Read and checked once, before anything is unpacked (plan S2).
	const directory = readZipDirectory(bytes)
	// One allowance for the whole card: its files share it.
	const clock = unpackClock()

	const cardBytes = await readZipEntry(
		bytes,
		directory,
		"card.json",
		CHARX_LIMITS.cardJsonBytes,
		clock
	)
	if (!cardBytes) {
		throw new Error(
			"This .charx file has no card.json at its root, so it isn't a character card."
		)
	}
	const cardText = new TextDecoder("utf-8").decode(cardBytes)
	assertImportJsonShape(cardText, "This card's JSON")
	let raw: any
	try {
		raw = JSON.parse(cardText.replace(/^\uFEFF/, ""))
	} catch {
		throw new Error("This .charx file's card.json is not valid JSON.")
	}

	if (!(opts?.includeAvatar ?? true)) return { raw }

	const uri = mainIconUri(raw)
	let avatarBuffer: Buffer | undefined
	const embedded = uri?.match(/^embedd?ed:\/\/\/?(.+)$/)
	if (embedded) {
		const path = embedded[1].replace(/\\/g, "/")
		const icon = await readZipEntry(
			bytes,
			directory,
			path,
			CHARX_LIMITS.iconBytes,
			clock
		)
		if (icon) avatarBuffer = Buffer.from(icon)
	} else if (uri?.startsWith("data:")) {
		const base64 = uri.match(/^data:[^,]*;base64,(.*)$/s)?.[1]
		if (base64 && (base64.length * 3) / 4 <= CHARX_LIMITS.iconBytes) {
			avatarBuffer = Buffer.from(base64, "base64")
		}
	}

	// The card's sprites (DESIGN-sprites §4): every embedded path they name,
	// unpacked in one pass under the card-wide ceilings.
	const paths = new Set<string>()
	for (const a of spriteAssetsOf(raw)) {
		const path = embeddedPathOf(a.uri)
		if (path) paths.add(path)
	}
	const entries = await readZipEntries(
		bytes,
		directory,
		paths,
		CARD_SPRITE_LIMITS.eachBytes,
		CARD_SPRITE_LIMITS.totalBytes,
		clock
	)
	const sprites = extractCardSprites(raw, (uri) => {
		const path = embeddedPathOf(uri)
		if (path) {
			// A view of the unpacked entry, never a copy of it.
			const entry = entries.get(path)
			return entry
				? Buffer.from(entry.buffer, entry.byteOffset, entry.byteLength)
				: null
		}
		return uri.startsWith("data:")
			? bytesOfDataUri(uri, CARD_SPRITE_LIMITS.eachBytes)
			: null
	})
	return { raw, avatarBuffer, sprites }
}

/**
 * The `chara-ext-asset_:<key>` tEXt chunks of a PNG card, by key — where a
 * RisuAI PNG export keeps the assets its `__asset:<key>` URIs name. The
 * values stay base64 until a sprite actually asks for one.
 */
export function pngAssetChunks(buffer: Buffer): Map<string, string> {
	const out = new Map<string, string>()
	if (buffer[0] !== 0x89 || buffer[1] !== 0x50) return out
	try {
		validatePngChunkLengths(buffer)
		for (const chunk of extract(buffer)) {
			if (chunk.name !== "tEXt") continue
			const { keyword, text: value } = text.decode(chunk.data)
			if (keyword?.startsWith("chara-ext-asset_:")) {
				out.set(keyword.slice("chara-ext-asset_:".length), value)
			}
		}
	} catch {
		// A PNG the card reader accepted but whose chunks do not walk: no
		// embedded assets, which is the honest answer.
	}
	return out
}

/**
 * How many bytes a base64 string decodes to, without decoding it: the
 * ceilings below are checked on this, before a byte is allocated.
 */
function base64DecodedBytes(b64: string): number {
	let pad = 0
	while (pad < 2 && b64.charCodeAt(b64.length - 1 - pad) === 0x3d) pad++
	return Math.floor((b64.length * 3) / 4) - pad
}

function cardJsonTooLarge(bytes: number): Error {
	return new Error(
		`This card's JSON is ${megabytes(bytes)}, larger than the ${megabytes(IMPORT_FILE_CAPS.cardJsonBytes)} Serene Pub will read.`
	)
}

/**
 * A card's JSON text, parsed — or a sentence saying it could not be. What the
 * parse may build is measured first (`IMPORT_JSON_LIMITS`): the byte ceiling
 * alone let 16 MiB of `{}`s parse to 5.6 million objects.
 */
function parseCardJson(text: string): any {
	assertImportJsonShape(text, "This card's JSON")
	try {
		return JSON.parse(text.replace(/^\uFEFF/, ""))
	} catch {
		throw new Error("This card's JSON is damaged, so Serene Pub can't read it.")
	}
}

/**
 * A card file sent as base64 (`characters:importCard`), decoded — or refused
 * with a sentence, BEFORE it is decoded, when it would come to more than
 * `IMPORT_FILE_CAPS.cardBytes` (plan S4).
 */
export function decodeCardFileBase64(base64: string): Buffer {
	const tooLarge = cardFileTooLarge(base64DecodedBytes(base64))
	if (tooLarge) throw new Error(tooLarge)
	return Buffer.from(base64, "base64")
}

/** The keywords a PNG card's text chunk may carry its JSON under. */
const PNG_CARD_KEYWORDS = ["chara", "character_card"]

/**
 * The base64 text an image card carries its JSON in, found exactly where
 * `@lenml/char-card-reader`'s own `parse_char_info` looks: a PNG's `ccv3`
 * chunk, else its `chara` / `character_card` one; a JPEG's or WebP's Exif
 * UserComment. Undefined when the image carries none.
 */
function imageCardText(
	buffer: Uint8Array,
	meta: ParsedMetadata
): string | undefined {
	if (meta.format === "png") {
		const named = meta.chunks.find((c) =>
			PNG_CARD_KEYWORDS.some((k) => c.keyword?.toLowerCase() === k)
		)
		return meta.chunks.find((c) => c.keyword === "ccv3")?.text ?? named?.text
	}
	if (meta.format === "jpeg") {
		const exif = meta.segments.find((s) => s.type === "EXIF")
		return exif ? JPEG.extract_user_comment(buffer, exif) : undefined
	}
	const exif = meta.chunks.find((c) => c.type === "EXIF")
	return exif ? WebP.extract_user_comment(buffer, exif) : undefined
}

/**
 * An image card's `CharacterCard`, built as `CharacterCard.from_file` builds
 * one — the reader's own metadata walk, the same chunk it reads, the same
 * `chara_card_v1` wrapper — with two differences (plan S4):
 *
 * - The JSON is measured before it is decoded and parsed, and refused past
 *   `IMPORT_FILE_CAPS.cardJsonBytes`. `from_file` parsed whatever the chunk
 *   held.
 * - No fallback avatar. `from_file` base64-encoded the WHOLE file to offer it
 *   as `card.avatar`, only for the import to decode it straight back; the
 *   caller takes the file's own bytes instead (see `parseCharacterCard`).
 */
function readImageCard(buffer: Buffer): CharacterCard {
	const text = imageCardText(buffer, parseImageMetadata(buffer))
	if (!text) throw new Error("This image carries no character card.")
	const bytes = base64DecodedBytes(text)
	if (bytes > IMPORT_FILE_CAPS.cardJsonBytes) throw cardJsonTooLarge(bytes)
	return CharacterCard.from_json({
		spec: "chara_card_v1",
		spec_version: "1.0",
		data: {},
		...parseCardJson(Buffer.from(text, "base64").toString("utf8"))
	} as any)
}

/**
 * The avatar a card's JSON declares for itself — a `data:` URI at `avatar` or
 * `data.avatar`, decoded under the icon ceiling. A web address is never
 * fetched (an import does not fetch URLs), so it declares nothing.
 */
function declaredAvatar(raw: any): Buffer | undefined {
	const uri = [raw?.avatar, raw?.data?.avatar].find(
		(v): v is string => typeof v === "string" && v.startsWith("data:")
	)
	return uri
		? (bytesOfDataUri(uri, CHARX_LIMITS.iconBytes) ?? undefined)
		: undefined
}

/**
 * Parse a character card from a buffer (PNG, JPEG, WebP, JSON or CHARX)
 * Extracts card instance, avatar, and lorebook if present
 *
 * Every boundary is measured before it is crossed (plan S4): the file against
 * `IMPORT_FILE_CAPS.cardBytes`, the card's JSON against `cardJsonBytes`
 * wherever it sits, a `data:` avatar against the icon ceiling. A refusal is a
 * sentence that says which.
 *
 * @param buffer - Buffer containing the character card file (image, JSON or CHARX)
 * @param opts.includeAvatar - Default true. Set false to leave the avatar
 *   (and sprites) out — for callers such as CharaVault's content-safety check
 *   and description/lorebook-presence lookup, which never read them.
 * @returns ParsedCharacterCard with card instance, avatarBuffer, and lorebook (if present)
 * @throws Error if parsing fails
 */
export async function parseCharacterCard(
	buffer: Buffer,
	opts?: { includeAvatar?: boolean }
): Promise<ParsedCharacterCard> {
	const tooLarge = cardFileTooLarge(buffer.length)
	if (tooLarge) throw new Error(tooLarge)
	// The card reader's `from_file` only understands image formats
	// (PNG/JPEG/WebP) and throws "Unsupported image format" on a plain JSON
	// buffer. Sniff the actual file type so JSON character cards route to
	// from_json() instead. A CHARX is recognised by its zip magic before any of
	// that: its avatar comes from the archive's main icon, never from the JSON.
	let card: CharacterCard
	let avatarBuffer: Buffer | undefined
	let sprites: ExtractedSprites | undefined
	const includeAvatar = opts?.includeAvatar ?? true
	if (isZipBuffer(buffer)) {
		const charx = await readCharxContainer(buffer, opts)
		card = CharacterCard.from_json(charx.raw)
		avatarBuffer = charx.avatarBuffer
		sprites = charx.sprites
	} else {
		const fileType = await fileTypeFromBuffer(buffer)
		const isImage = !!fileType?.mime.startsWith("image/")
		if (isImage) {
			// Checked before the card reader walks a single chunk (plan S1).
			validateCardImageChunks(buffer)
			card = readImageCard(buffer)
		} else {
			if (buffer.length > IMPORT_FILE_CAPS.cardJsonBytes)
				throw cardJsonTooLarge(buffer.length)
			card = CharacterCard.from_json(parseCardJson(buffer.toString("utf8")))
		}
		if (includeAvatar) {
			// What the JSON declares first, as the reader's `card.avatar` did;
			// else an image card IS its own picture — its bytes as they came,
			// never a base64 round trip of them.
			avatarBuffer =
				declaredAvatar(card.raw_data) ?? (isImage ? buffer : undefined)
			// A RisuAI PNG keeps assets in `chara-ext-asset_:` chunks named by
			// `__asset:<key>`; a JSON card can only carry `data:` URIs and
			// RisuAI's raw base64 pairs.
			const chunks =
				fileType?.mime === "image/png" || fileType?.mime === "image/apng"
					? pngAssetChunks(buffer)
					: new Map<string, string>()
			sprites = extractCardSprites(card.raw_data, (uri) => {
				if (uri.startsWith("__asset:")) {
					const b64 = chunks.get(uri.slice("__asset:".length))
					return b64
						? decodeBase64Capped(b64, CARD_SPRITE_LIMITS.eachBytes)
						: null
				}
				return uri.startsWith("data:")
					? bytesOfDataUri(uri, CARD_SPRITE_LIMITS.eachBytes)
					: null
			})
		}
	}

	if (!card) {
		throw new Error("Failed to parse character card")
	}

	// Extract lorebook if present. card.character_book's getter is only
	// spec-aware for v2/v3 — for anything else (V1/legacy cards, which have
	// no `spec` field, or an image-embedded card explicitly tagged
	// "chara_card_v1") it unconditionally returns a hardcoded placeholder
	// (`{entries: [], ...}`) and never even looks at the real embedded
	// book. Reading raw_data directly sidesteps that entirely — V1 cards
	// keep character_book at the top level (readImageCard spreads the parsed
	// payload straight onto raw_data, as from_file did), while V2/V3 nest it
	// under raw_data.data, so checking both covers every shape.
	// hasLorebookEntries also tolerates the legacy object-keyed-by-index
	// entries shape, not just a real array, and correctly treats a genuinely
	// bookless card (including v2/v3's own placeholder) as absent rather than
	// offering to import an empty book for every single card.
	const rawData = card.raw_data as any
	const candidateBook =
		rawData?.character_book ??
		rawData?.data?.character_book ??
		card.character_book
	let lorebook: SpecV3.Lorebook | undefined
	if (candidateBook && hasLorebookEntries(candidateBook)) {
		lorebook = candidateBook as SpecV3.Lorebook
	}

	const unimported = unimportedAssets(card.raw_data, sprites)
	return {
		card,
		avatarBuffer,
		lorebook,
		...(unimported ? { unimportedAssets: unimported } : {}),
		...(sprites && sprites.sprites.length > 0
			? { sprites: sprites.sprites }
			: {})
	}
}

/**
 * Parse a character card sent as base64, refusing one too large to decode
 * (see `decodeCardFileBase64`).
 */
export async function parseCharacterCardFromBase64(
	base64String: string
): Promise<ParsedCharacterCard> {
	return parseCharacterCard(decodeCardFileBase64(base64String))
}

/** Plain input for buildCharacterCardV3 — deliberately decoupled from the DB row shape. */
export interface CharacterCardV3Input {
	name: string
	description?: string | null
	personality?: string | null
	scenario?: string | null
	firstMessage?: string | null
	exampleDialogues?: string | string[] | null
	creatorNotes?: string | null
	systemPrompt?: string | null
	postHistoryInstructions?: string | null
	alternateGreetings?: string[] | null
	tags?: string[]
	creator?: string | null
	characterVersion?: string | null
	depthPrompt?: string | null
	depthPromptDepth?: number | null
	depthPromptRole?: string | null
	source?: string[] | null
	groupOnlyGreetings?: string[] | null
	aliases?: string[] | null
	summary?: string | null
	category?: string | null
	/** Stable per-row identity — see lorebooks.uuid for the export/import dedup rationale. */
	uuid: string
	/** The character's whole shared lorebook, embedded when the exporting user opts in — see charactersExportCard. */
	lorebook?: SpecV3.Lorebook
}

/**
 * Build a CharacterCard V3 JSON object from a character's data. Used for
 * both JSON export and PNG-embedded export (characters:exportCard). Serene
 * Pub exports V3 exclusively — V3 is a strict superset of V2 (same fields,
 * plus character_book/uuid support), so there's no separate V2 builder to
 * maintain.
 */
export function buildCharacterCardV3(character: CharacterCardV3Input) {
	return {
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: {
			name: character.name,
			description: character.description || "",
			personality: character.personality || "",
			scenario: character.scenario || "",
			first_mes: character.firstMessage || "",
			mes_example:
				typeof character.exampleDialogues === "string"
					? character.exampleDialogues
					: (character.exampleDialogues || []).join("<START>"),
			creator_notes: character.creatorNotes || "",
			system_prompt: character.systemPrompt || "",
			post_history_instructions: character.postHistoryInstructions || "",
			alternate_greetings: character.alternateGreetings || [],
			tags: character.tags || [],
			creator: character.creator || "",
			character_version: character.characterVersion || "",
			...(character.lorebook
				? { character_book: character.lorebook }
				: {}),
			extensions: {
				depth_prompt: {
					prompt: character.depthPrompt || "",
					depth: character.depthPromptDepth || 4,
					role: character.depthPromptRole || "system"
				},
				...(character.source && character.source.length > 0
					? { source: character.source }
					: {}),
				...(character.groupOnlyGreetings &&
				character.groupOnlyGreetings.length > 0
					? { group_only_greetings: character.groupOnlyGreetings }
					: {}),
				serenepub: {
					uuid: character.uuid,
					...(character.aliases && character.aliases.length > 0
						? { aliases: character.aliases }
						: {}),
					...(character.summary
						? { summary: character.summary }
						: {}),
					...(character.category
						? { category: character.category }
						: {})
				}
			}
		}
	}
}

/**
 * Embed a character card JSON object into a PNG's tEXt chunks, replacing any
 * existing "chara"/"ccv3" chunk. Mirrors how SillyTavern and other tools
 * embed character data directly in the avatar PNG.
 */
export function embedCharacterCardInPng(
	pngBuffer: Buffer,
	cardData: unknown
): Buffer {
	validatePngChunkLengths(pngBuffer)
	const chunks = extract(pngBuffer)

	const base64Data = Buffer.from(JSON.stringify(cardData), "utf-8").toString(
		"base64"
	)
	const textChunk = text.encode("chara", base64Data)

	// Remove any existing "chara" or "ccv3" chunks
	const filteredChunks = chunks.filter((chunk) => {
		if (chunk.name === "tEXt") {
			const decoded = text.decode(chunk.data)
			return decoded.keyword !== "chara" && decoded.keyword !== "ccv3"
		}
		return true
	})

	// Insert the new chunk before the IEND chunk
	const iendIndex = filteredChunks.findIndex((chunk) => chunk.name === "IEND")
	if (iendIndex !== -1) {
		filteredChunks.splice(iendIndex, 0, textChunk)
	} else {
		filteredChunks.push(textChunk)
	}

	return Buffer.from(encode(filteredChunks))
}
