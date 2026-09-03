/**
 * Telling a text model from an image model by looking at the file.
 *
 * The models directory holds both now, and a filename cannot decide which is
 * which. Every model in the maintainer's own curated image repo
 * (huggingface.co/koboldcpp/imgmodel) is a `.gguf`, byte-for-byte
 * indistinguishable by name from a text LLM sitting beside it — so any rule of
 * the shape ".safetensors means image, .gguf means text" is wrong, and looks
 * right up until the Recommended tab downloads its first model.
 *
 * What IS decidable is the header. GGUF starts:
 *
 *     magic "GGUF" (4) | version u32-LE | tensor_count u64-LE | kv_count u64-LE
 *
 * An SD.CPP-format GGUF carries zero metadata KV pairs and goes straight to
 * tensor names in the Stable-Diffusion namespaces; a text LLM always carries
 * metadata, the first key of which is conventionally `general.architecture`.
 * One 4 KiB positional read answers the question with no network and no new
 * dependency.
 *
 * ## kv_count === 0 is NOT the whole rule
 *
 * The tempting short version — "no metadata means image" — is only half right.
 * It is sound in one direction (a text GGUF is unloadable without
 * `general.architecture`, which lives in a KV, so zero KVs is certainly not
 * text) and useless in the other: hum-ma/SDXL-models-GGUF ships working SDXL
 * with 135 KVs and `general.architecture = "sdxl"`, and it is a top-3 result of
 * the very Hugging Face query the image search runs. So a non-zero KV count
 * falls through to reading the architecture, not to "text".
 *
 * Nothing here throws. A truncated download, a ComfyUI-format GGUF, an
 * unreadable file and a brand-new architecture all land on `unknown`, which is
 * a visible state in the Manager with a user override attached — not a silent
 * mis-file.
 */

import * as fsPromises from "fs/promises"
import type { FileHandle } from "fs/promises"

export interface ModelKindVerdict {
	kind: Sockets.KoboldCPP.ModelKind
	/**
	 * Why, in one sentence, shown verbatim in the "Unverified" badge's tooltip.
	 * Always populated, including for a confident verdict — a user asking "why
	 * is this in the Image list?" deserves the same answer either way.
	 */
	reason: string
}

/** The extensions koboldcpp can load at all, for either kind. */
export const MODEL_EXTENSION_RE = /\.(gguf|safetensors)$/i

/**
 * One read, not a whole-file scan. `general.architecture` is written first by
 * every writer in practice, and the tensor names an SD.CPP GGUF opens with are
 * within the first few hundred bytes — 4 KiB is generous cover for both without
 * pulling a meaningful amount of a multi-gigabyte file off disk.
 */
const HEADER_WINDOW_BYTES = 4096
/** magic(4) + version u32 + tensor_count u64 + kv_count u64. */
const GGUF_HEADER_BYTES = 24
const GGUF_MAGIC = "GGUF"
/** v1 predates the current string/type encoding; nothing in circulation uses it. */
const GGUF_READABLE_VERSIONS = new Set([2, 3])
/** The GGUF metadata value-type tag for a length-prefixed UTF-8 string. */
const GGUF_TYPE_STRING = 8
const ARCH_KEY = "general.architecture"

/**
 * `general.architecture` values, matched as PREFIXES so a versioned family
 * (llama4, gemma3, phi3, flux1, wan2.2) lands on its base name instead of
 * needing a new entry every release.
 *
 * These lists WILL go stale, and a new architecture lands as `unknown` rather
 * than being guessed at. That is the designed outcome — it is also what makes
 * the Manager's "It's a text model / It's an image model" override load-bearing
 * rather than decorative.
 */
const DIFFUSION_ARCHS = [
	"sd1",
	"sd2",
	"sd3",
	"sdxl",
	"stable_diffusion",
	"flux",
	"hidream",
	"ltxv",
	"wan",
	"chroma",
	"pixart",
	"auraflow",
	"cosmos",
	"qwen_image"
]

const LLM_ARCHS = [
	"llama",
	"qwen",
	"gemma",
	"phi",
	"mistral",
	"mixtral",
	"gpt2",
	"gptj",
	"gptneox",
	"falcon",
	"bert",
	"t5",
	"rwkv",
	"mamba",
	"stablelm",
	"starcoder",
	"deepseek",
	"olmo",
	"command-r",
	"granite",
	"internlm",
	"baichuan",
	"bloom",
	"orion",
	"minicpm",
	"cohere",
	"dbrx",
	"exaone",
	"chatglm",
	"nemotron",
	"jamba",
	"plamo",
	"xverse",
	"arctic",
	"codeshell",
	// Shipping today, and none of them matched anything above — `gpt-oss` is not
	// caught by `gpt2`/`gptj`/`gptneox`, and `glm4`/`glm4moe` are not caught by
	// the older `chatglm`. Left out, a working text model in an existing models
	// directory classifies as `unknown` on the first scan after upgrade, which
	// puts it in the IMAGE list as well as the text one — where "Use for image
	// generation" accepts it, points `sdmodel` at a text LLM, and takes chat
	// down with it on the next load. An arch missing from this list is not a
	// cosmetic gap.
	"gpt-oss",
	"glm4",
	"hunyuan",
	"seed_oss",
	"ernie4_5",
	"smollm",
	"lfm2",
	"deci"
]

/** Is this a file koboldcpp could load as a model of either kind? */
export function isModelFilename(filename: string): boolean {
	return MODEL_EXTENSION_RE.test(filename)
}

/**
 * Could a file with this name be a model of this kind?
 *
 * koboldcpp loads GGUF only for text, but accepts GGUF *or* safetensors for
 * images — so this is asymmetric, and a `.safetensors` arriving on the text tab
 * is a download that could never have worked.
 */
export function extensionAllowedForKind(
	filename: string,
	kind: Sockets.KoboldCPP.ModelKindFilter
): boolean {
	const lower = filename.toLowerCase()
	if (kind === "image") {
		return lower.endsWith(".gguf") || lower.endsWith(".safetensors")
	}
	return lower.endsWith(".gguf")
}

/**
 * Longest matching prefix wins, rather than "check one list then the other".
 *
 * The lists overlap by prefix in at least one real case: `qwen_image` is a
 * diffusion model and `qwen2`/`qwen3` are language models, and both start with
 * `qwen`. Checking either list first would decide that pair by list order,
 * which is not a reason.
 */
function kindForArchitecture(
	architecture: string
): Sockets.KoboldCPP.ModelKindFilter | null {
	const arch = architecture.trim().toLowerCase()
	let bestLength = 0
	let best: Sockets.KoboldCPP.ModelKindFilter | null = null
	for (const prefix of DIFFUSION_ARCHS) {
		if (arch.startsWith(prefix) && prefix.length > bestLength) {
			bestLength = prefix.length
			best = "image"
		}
	}
	for (const prefix of LLM_ARCHS) {
		if (arch.startsWith(prefix) && prefix.length > bestLength) {
			bestLength = prefix.length
			best = "text"
		}
	}
	return best
}

/**
 * A GGUF length-prefixed UTF-8 string: u64-LE byte count, then the bytes.
 *
 * Returns null rather than throwing for anything that would read past the end
 * of the window — a length field read out of a truncated file is arbitrary
 * garbage, and `Buffer.readBigUInt64LE` on a short buffer throws.
 */
function readGgufString(
	buf: Buffer,
	offset: number
): { value: string; next: number } | null {
	if (offset < 0 || offset + 8 > buf.length) return null
	const length = Number(buf.readBigUInt64LE(offset))
	if (!Number.isSafeInteger(length) || length < 0) return null
	const start = offset + 8
	const end = start + length
	if (end > buf.length) return null
	return { value: buf.toString("utf8", start, end), next: end }
}

/**
 * The value of `general.architecture`, or null if this window does not carry
 * one we can read.
 *
 * Two attempts, in order. First the honest one: decode the first KV properly
 * (key string, u32 value type, string value). If that key is something else —
 * a writer that orders metadata differently, or an alignment/padding surprise —
 * fall back to scanning the window for the literal key bytes and decoding what
 * follows. The scan is a fallback rather than the primary because it would
 * happily match the same text appearing inside some other value.
 */
function readArchitecture(buf: Buffer): string | null {
	const firstKey = readGgufString(buf, GGUF_HEADER_BYTES)
	if (firstKey && firstKey.value === ARCH_KEY) {
		const value = readTypedString(buf, firstKey.next)
		if (value !== null) return value
	}

	const found = buf.indexOf(ARCH_KEY, 0, "utf8")
	if (found < 0) return null
	return readTypedString(buf, found + ARCH_KEY.length)
}

/** A GGUF metadata value at `offset`, if it is a string. */
function readTypedString(buf: Buffer, offset: number): string | null {
	if (offset + 4 > buf.length) return null
	if (buf.readUInt32LE(offset) !== GGUF_TYPE_STRING) return null
	return readGgufString(buf, offset + 4)?.value ?? null
}

/**
 * Classify the first bytes of a `.gguf` file. Pure — the file read lives in
 * `classifyModelFile` so this can be exercised against literal headers.
 */
export function classifyGgufHeader(buf: Buffer): ModelKindVerdict {
	if (buf.length < GGUF_HEADER_BYTES) {
		return {
			kind: "unknown",
			reason: `The file is shorter than a ${GGUF_HEADER_BYTES}-byte GGUF header — most likely a truncated or still-copying download.`
		}
	}
	if (buf.toString("latin1", 0, 4) !== GGUF_MAGIC) {
		return {
			kind: "unknown",
			reason: "The file does not begin with the GGUF magic bytes, so koboldcpp cannot load it either."
		}
	}
	const version = buf.readUInt32LE(4)
	if (!GGUF_READABLE_VERSIONS.has(version)) {
		return {
			kind: "unknown",
			reason: `The file declares GGUF version ${version}, which this build does not know how to read.`
		}
	}

	const kvCount = buf.readBigUInt64LE(16)
	if (kvCount === 0n) {
		// Sound in exactly one direction: a text GGUF cannot load without
		// `general.architecture`, and that lives in a KV. Zero KVs is therefore
		// certainly-not-text, which for this directory means image.
		return {
			kind: "image",
			reason: "SD.CPP GGUF: the header carries no metadata KV pairs, which a text model could not load without."
		}
	}

	const architecture = readArchitecture(buf)
	if (architecture === null) {
		return {
			kind: "unknown",
			reason: `The GGUF header has ${kvCount} metadata entries but no readable general.architecture in its first ${HEADER_WINDOW_BYTES} bytes.`
		}
	}
	const kind = kindForArchitecture(architecture)
	if (kind === "image") {
		return {
			kind: "image",
			reason: `The GGUF header says general.architecture is "${architecture}", a diffusion model.`
		}
	}
	if (kind === "text") {
		return {
			kind: "text",
			reason: `The GGUF header says general.architecture is "${architecture}", a language model.`
		}
	}
	// Named, not swallowed: "which architecture?" is the first thing anyone
	// adding it to a list above will want to know.
	return {
		kind: "unknown",
		reason: `The GGUF header says general.architecture is "${architecture}", which this build recognises as neither a diffusion nor a language model.`
	}
}

/**
 * What kind of model this file is, by looking at it.
 *
 * The caller decides what to do with the answer: `kind !== "unknown"` is a
 * measurement worth recording as `kind_source: "detected"`, and `unknown` means
 * the row keeps whatever it had and stays open to a re-read.
 */
export async function classifyModelFile(
	filePath: string
): Promise<ModelKindVerdict> {
	const lower = filePath.toLowerCase()

	if (lower.endsWith(".safetensors")) {
		// No read needed, and no ambiguity to resolve: koboldcpp loads GGUF only
		// for text, so a .safetensors in this directory can only be for images.
		return {
			kind: "image",
			reason: "A .safetensors file can only be an image model — koboldcpp loads text models from GGUF only."
		}
	}

	if (!lower.endsWith(".gguf")) {
		return {
			kind: "unknown",
			reason: "Not a file koboldcpp can load as a model (.gguf or .safetensors)."
		}
	}

	let handle: FileHandle | undefined
	try {
		handle = await fsPromises.open(filePath, "r")
		const buf = Buffer.alloc(HEADER_WINDOW_BYTES)
		const { bytesRead } = await handle.read(buf, 0, HEADER_WINDOW_BYTES, 0)
		return classifyGgufHeader(buf.subarray(0, bytesRead))
	} catch (err: any) {
		// Gone, unreadable, or held by something else — routine while a download
		// is landing, and never a reason to fail the listing that asked.
		return {
			kind: "unknown",
			reason: `The file could not be read (${err?.code ?? err?.message ?? "unknown error"}).`
		}
	} finally {
		await handle?.close().catch(() => {})
	}
}
