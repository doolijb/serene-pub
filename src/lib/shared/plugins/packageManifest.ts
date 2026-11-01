/**
 * Reads a package zip's manifest in the browser without reading the whole file
 * (packages may be hundreds of MB): the end of the zip, its central directory,
 * then the one entry. Picks the manifest the way the server's unzip does, so
 * what the page shows is what an install will see.
 */
import { inflateSync } from "fflate"

/** Where `serene-pub build` writes, relative to the package root. */
export const PLUGIN_BUILD_DIR = "dist/plugin"
export const PLUGIN_MANIFEST_PATH = `${PLUGIN_BUILD_DIR}/manifest.json`

export type PackageManifestRead =
	| { ok: true; manifest: Record<string, unknown> }
	| { ok: false; problem: string }

const MANIFEST_MAX_BYTES = 4 * 1024 * 1024
const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

const UNREADABLE = "That file isn't a readable zip."

/** A problem the reader reports in plain words; anything else thrown is "not a readable zip". */
class Problem extends Error {}

async function bytesAt(
	zip: Blob,
	start: number,
	end: number
): Promise<Uint8Array> {
	if (start < 0 || end > zip.size || end < start)
		throw new Error("out of range")
	return new Uint8Array(await zip.slice(start, end).arrayBuffer())
}

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

interface Entry {
	name: string
	method: number
	compressed: number
	size: number
	offset: number
}

/**
 * The manifest inside a package zip, parsed. Never throws: a zip it cannot
 * read, or a manifest it cannot use, comes back as a sentence.
 */
export async function readPackageManifest(
	zip: Blob
): Promise<PackageManifestRead> {
	try {
		const tailLen = Math.min(zip.size, 22 + 65535)
		const tail = await bytesAt(zip, zip.size - tailLen, zip.size)
		const tv = view(tail)
		let eocd = -1
		for (let i = tail.length - 22; i >= 0; i--)
			if (tv.getUint32(i, true) === EOCD_SIG) {
				eocd = i
				break
			}
		if (eocd < 0) throw new Error("no end of central directory")
		const count = tv.getUint16(eocd + 10, true)
		const cdSize = tv.getUint32(eocd + 12, true)
		const cdOffset = tv.getUint32(eocd + 16, true)
		if (
			count === 0xffff ||
			cdSize === 0xffffffff ||
			cdOffset === 0xffffffff
		)
			throw new Problem(
				"This package is too large to read here. Its permissions show on its page once it is installed."
			)

		const cd = await bytesAt(zip, cdOffset, cdOffset + cdSize)
		const cv = view(cd)
		const decoder = new TextDecoder()
		const entries: Entry[] = []
		let pos = 0
		for (let n = 0; n < count; n++) {
			if (cv.getUint32(pos, true) !== CENTRAL_SIG)
				throw new Error("bad central entry")
			const nameLen = cv.getUint16(pos + 28, true)
			const extraLen = cv.getUint16(pos + 30, true)
			const commentLen = cv.getUint16(pos + 32, true)
			entries.push({
				method: cv.getUint16(pos + 10, true),
				compressed: cv.getUint32(pos + 20, true),
				size: cv.getUint32(pos + 24, true),
				offset: cv.getUint32(pos + 42, true),
				name: decoder.decode(cd.subarray(pos + 46, pos + 46 + nameLen))
			})
			pos += 46 + nameLen + extraLen + commentLen
		}

		const files = entries.filter((e) => !e.name.endsWith("/"))
		let found = files.find((e) => e.name === PLUGIN_MANIFEST_PATH)
		if (!found) {
			const roots = new Set(files.map((e) => e.name.split("/")[0]))
			const [only] = [...roots]
			if (roots.size === 1)
				found = files.find(
					(e) => e.name === `${only}/${PLUGIN_MANIFEST_PATH}`
				)
		}
		if (!found)
			throw new Problem(`There's no ${PLUGIN_MANIFEST_PATH} in this zip.`)
		if (found.size > MANIFEST_MAX_BYTES)
			throw new Problem(
				"The manifest in this zip is too large to read here."
			)

		const head = view(await bytesAt(zip, found.offset, found.offset + 30))
		if (head.getUint32(0, true) !== LOCAL_SIG)
			throw new Error("bad local header")
		const dataStart =
			found.offset +
			30 +
			head.getUint16(26, true) +
			head.getUint16(28, true)
		const raw = await bytesAt(zip, dataStart, dataStart + found.compressed)
		let data: Uint8Array
		if (found.method === 0) data = raw
		else if (found.method === 8) data = inflateSync(raw)
		else
			throw new Problem(
				"The manifest in this zip is packed in a way this page can't read."
			)

		let parsed: unknown
		try {
			parsed = JSON.parse(decoder.decode(data))
		} catch {
			throw new Problem("The manifest in this zip isn't valid JSON.")
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Problem("The manifest in this zip isn't valid JSON.")
		return { ok: true, manifest: parsed as Record<string, unknown> }
	} catch (e) {
		return {
			ok: false,
			problem: e instanceof Problem ? e.message : UNREADABLE
		}
	}
}
