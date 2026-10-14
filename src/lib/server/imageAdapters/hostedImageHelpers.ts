/**
 * Small pieces the hosted image dialects share (Gemini image, AI Horde,
 * NovelAI, BFL Flux): a cancellable sleep, the `editImage` → `generateImage`
 * fold, reading a picture's pixel size from its header, unpacking a ZIP
 * answer, and fetching a picture a service answered with a URL.
 *
 * Not a base class: each dialect's wire is its own, and these are the only
 * parts that came out identical four times.
 */
import { inflateRawSync } from "node:zlib"
import type { ImageEditRequest } from "$lib/server/adapters/actions"
import type { ImageGenRequest } from "$lib/shared/imageGen/types"

/** Resolves after `ms`, or at once when `signal` aborts. Never rejects. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve()
		const timer = setTimeout(done, ms)
		function done() {
			clearTimeout(timer)
			signal.removeEventListener("abort", done)
			resolve()
		}
		signal.addEventListener("abort", done, { once: true })
	})
}

/**
 * An edit as the generation request it is on a wire that takes the canvas
 * as one more input image: the first canvas is `init`, any further canvases
 * join the references, the mask applies to `init`.
 */
export function editAsGenerate(req: ImageEditRequest): ImageGenRequest {
	const { init: canvases, prompt, mask, references, ...rest } = req
	const [init, ...more] = canvases
	const refs = [...more, ...(references ?? [])]
	return {
		...rest,
		prompt: prompt ?? "",
		...(init ? { init } : {}),
		...(refs.length ? { references: refs } : {}),
		...(mask ? { mask } : {})
	}
}

/**
 * Width and height from a PNG, JPEG or WebP header; null for anything else
 * (or a header too short to read). NovelAI's director tools need the
 * picture's own size beside its bytes.
 */
export function imagePixelSize(
	bytes: Uint8Array
): { width: number; height: number } | null {
	const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	// PNG: signature, then IHDR's width and height.
	if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47)
		return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
	// WebP: RIFF....WEBP, then one of three chunk kinds.
	if (
		b.length >= 30 &&
		b.toString("ascii", 0, 4) === "RIFF" &&
		b.toString("ascii", 8, 12) === "WEBP"
	) {
		const kind = b.toString("ascii", 12, 16)
		if (kind === "VP8X")
			return {
				width: 1 + b.readUIntLE(24, 3),
				height: 1 + b.readUIntLE(27, 3)
			}
		if (kind === "VP8L") {
			const bits = b.readUInt32LE(21)
			return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
		}
		if (kind === "VP8 ")
			return {
				width: b.readUInt16LE(26) & 0x3fff,
				height: b.readUInt16LE(28) & 0x3fff
			}
		return null
	}
	// JPEG: walk the segments to the first start-of-frame.
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null
			const marker = b[i + 1]
			const len = b.readUInt16BE(i + 2)
			const isSof =
				marker >= 0xc0 &&
				marker <= 0xcf &&
				marker !== 0xc4 &&
				marker !== 0xc8 &&
				marker !== 0xcc
			if (isSof)
				return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
			i += 2 + len
		}
	}
	return null
}

/**
 * The files of a ZIP archive, by name, read through its central directory
 * (which always carries the sizes, unlike a streamed local header). Stored
 * and deflated entries only — what a service's answer uses. Throws on
 * anything that is not a ZIP, so a JSON error body is never mistaken for an
 * empty archive.
 */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
	const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	// End of central directory: 22 bytes plus a comment of up to 64 KiB.
	let eocd = -1
	for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
		if (b.readUInt32LE(i) === 0x06054b50) {
			eocd = i
			break
		}
	if (eocd < 0) throw new Error("The answer is not a ZIP archive.")
	const count = b.readUInt16LE(eocd + 10)
	let p = b.readUInt32LE(eocd + 16)
	const out = new Map<string, Uint8Array>()
	for (let n = 0; n < count; n++) {
		if (b.readUInt32LE(p) !== 0x02014b50)
			throw new Error("The ZIP archive's directory is damaged.")
		const method = b.readUInt16LE(p + 10)
		const compressed = b.readUInt32LE(p + 20)
		const nameLen = b.readUInt16LE(p + 28)
		const extraLen = b.readUInt16LE(p + 30)
		const commentLen = b.readUInt16LE(p + 32)
		const local = b.readUInt32LE(p + 42)
		const name = b.toString("utf8", p + 46, p + 46 + nameLen)
		p += 46 + nameLen + extraLen + commentLen
		if (name.endsWith("/")) continue
		const start =
			local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
		const data = b.subarray(start, start + compressed)
		if (method === 0) out.set(name, new Uint8Array(data))
		else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)))
		else throw new Error(`The ZIP entry ${name} uses an unsupported compression.`)
	}
	return out
}

/** The MIME type a picture's first bytes declare; PNG when unsure. */
export function sniffImageMime(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"
	if (
		bytes.length > 12 &&
		Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
	)
		return "image/webp"
	return "image/png"
}

/** A picture a service answered with a URL, as base64 and its type. */
export async function fetchPicture(
	url: string,
	signal: AbortSignal,
	headers: Record<string, string> = {}
): Promise<{ base64: string; mime: string } | undefined> {
	try {
		const res = await fetch(url, { signal, headers })
		if (!res.ok) return undefined
		const bytes = new Uint8Array(await res.arrayBuffer())
		const declared = res.headers?.get?.("content-type") ?? ""
		return {
			base64: Buffer.from(bytes).toString("base64"),
			mime: declared.startsWith("image/")
				? declared.split(";")[0]
				: sniffImageMime(bytes)
		}
	} catch {
		return undefined
	}
}

/** A failed answer's body, parsed when it is JSON, with its text. */
export async function readFailure(
	res: Response
): Promise<{ text: string; body: any }> {
	const text = await res.text().catch(() => "")
	try {
		return { text, body: JSON.parse(text) }
	} catch {
		return { text, body: null }
	}
}
