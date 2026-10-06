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
 * One 64 KiB positional read answers the question with no network and no new
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
 * a visible state in the managed KoboldCPP with a user override attached — not a silent
 * mis-file.
 *
 * ## Embedding models are told apart by pooling, not by architecture
 *
 * koboldcpp has a third loader, `--embeddingsmodel`, which holds an embedding
 * GGUF beside the text model. The architecture cannot say which files belong
 * there: Qwen3-Embedding is `qwen3`, exactly as the Qwen3 chat models are. What
 * every embedding GGUF carries, and no chat GGUF does, is `<arch>.pooling_type`
 * — how its per-token vectors become one. So the header is decoded KV by KV
 * until that key turns up, and the architecture lists below decide only when it
 * does not. A `rank` pooling is a reranker, which none of the three loaders
 * serves, so it is `unknown` with a sentence saying so.
 */

import * as fsPromises from "fs/promises"
import type { FileHandle } from "fs/promises"

/** A kind the classifier can decide — every kind except `unknown`. Also what
 * a models directory is chosen by (`modelsDir.ts`). */
export type DecidedModelKind = Exclude<Sockets.KoboldCPP.ModelKind, "unknown">

export interface ModelKindVerdict {
	kind: Sockets.KoboldCPP.ModelKind
	/**
	 * Why, in one sentence, shown verbatim in the "Unverified" badge's tooltip.
	 * Always populated, including for a confident verdict — a user asking "why
	 * is this in the Image list?" deserves the same answer either way.
	 */
	reason: string
}

/** The extensions koboldcpp can load at all, for any kind. */
export const MODEL_EXTENSION_RE = /\.(gguf|safetensors)$/i

/**
 * One read, not a whole-file scan. `general.architecture` is written first by
 * every writer in practice, and the tensor names an SD.CPP GGUF opens with are
 * within the first few hundred bytes. `<arch>.pooling_type` is written with the
 * model's own parameters, ahead of the tokenizer's vocabulary arrays — at byte
 * 470 of nomic-embed-text-v1.5 — but behind every `general.*` key, and a
 * quantizer's description, tags and base-model list can run to a few KiB.
 * 64 KiB is generous cover for all of it without pulling a meaningful amount of
 * a multi-gigabyte file off disk.
 */
const HEADER_WINDOW_BYTES = 64 * 1024
/** magic(4) + version u32 + tensor_count u64 + kv_count u64. */
const GGUF_HEADER_BYTES = 24
const GGUF_MAGIC = "GGUF"
/** v1 predates the current string/type encoding; nothing in circulation uses it. */
const GGUF_READABLE_VERSIONS = new Set([2, 3])
/** GGUF metadata value-type tags that are not fixed-width scalars. */
const GGUF_TYPE_STRING = 8
const GGUF_TYPE_ARRAY = 9
/** Byte width of every fixed-width GGUF value type, by tag: u8 i8 u16 i16 u32
 * i32 f32 bool, then (after string 8 and array 9) u64 i64 f64. */
const GGUF_SCALAR_BYTES: Readonly<Record<number, number>> = {
	0: 1,
	1: 1,
	2: 2,
	3: 2,
	4: 4,
	5: 4,
	6: 4,
	7: 1,
	10: 8,
	11: 8,
	12: 8
}
const ARCH_KEY = "general.architecture"
/** `<arch>.pooling_type`, llama.cpp's `LLM_KV_POOLING_TYPE`. */
const POOLING_KEY_SUFFIX = ".pooling_type"
/** llama.cpp's `enum llama_pooling_type`, 0–3: the values an embedding model
 * declares. */
const EMBEDDING_POOLING_NAMES: readonly string[] = [
	"none",
	"mean",
	"cls",
	"last"
]
/** `LLAMA_POOLING_TYPE_RANK`: a reranker's head, not an embedding. */
const RERANK_POOLING = 4

/**
 * `general.architecture` values, matched as PREFIXES so a versioned family
 * (llama4, gemma3, phi3, flux1, wan2.2) lands on its base name instead of
 * needing a new entry every release.
 *
 * These lists WILL go stale, and a new architecture lands as `unknown` rather
 * than being guessed at. That is the designed outcome — it is also what makes
 * the managed KoboldCPP's "It's a text model / It's an image model" override load-bearing
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

/**
 * Architectures that only ever embed, for a header that carries no readable
 * `<arch>.pooling_type` — an older conversion, or a key past the window. The
 * fallback, never the rule: an embedding model on a chat architecture (`qwen3`)
 * is found by its pooling key or not at all. `bert` lived in {@link LLM_ARCHS}
 * until 2026-10-05, which listed every BGE and MiniLM GGUF as a chat model.
 */
const EMBEDDING_ARCHS = [
	"bert",
	"nomic-bert",
	"jina-bert",
	"modern-bert",
	"neo-bert",
	"gemma-embedding"
]

/** Is this a file koboldcpp could load as a model of any kind? */
export function isModelFilename(filename: string): boolean {
	return MODEL_EXTENSION_RE.test(filename)
}

/**
 * Could a file with this name be a model of this kind?
 *
 * koboldcpp loads GGUF only for text and embeddings, but accepts GGUF *or*
 * safetensors for images — so this is asymmetric, and a `.safetensors`
 * arriving on the text tab is a download that could never have worked.
 */
export function extensionAllowedForKind(
	filename: string,
	kind: DecidedModelKind
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
function kindForArchitecture(architecture: string): DecidedModelKind | null {
	const arch = architecture.trim().toLowerCase()
	let bestLength = 0
	let best: DecidedModelKind | null = null
	const lists: [readonly string[], DecidedModelKind][] = [
		[DIFFUSION_ARCHS, "image"],
		[LLM_ARCHS, "text"],
		// `gemma-embedding` against `gemma` is the same overlap qwen_image is.
		[EMBEDDING_ARCHS, "embeddings"]
	]
	for (const [prefixes, kind] of lists) {
		for (const prefix of prefixes) {
			if (arch.startsWith(prefix) && prefix.length > bestLength) {
				bestLength = prefix.length
				best = kind
			}
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

/** A decoded metadata value. Arrays are stepped over, never kept. */
type GgufValue = string | number | boolean

/**
 * One metadata value of type `type` at `offset`, and where the next byte after
 * it is — or null if it runs past the window or is not a type this decoder
 * knows. `value` is undefined for an array: only its length is needed.
 */
function readGgufValue(
	buf: Buffer,
	offset: number,
	type: number,
	depth = 0
): { value: GgufValue | undefined; next: number } | null {
	if (type === GGUF_TYPE_STRING) return readGgufString(buf, offset)
	if (type === GGUF_TYPE_ARRAY) {
		// Nested arrays are legal and unused; two levels is already generous.
		if (depth > 1 || offset + 12 > buf.length) return null
		const elementType = buf.readUInt32LE(offset)
		const count = Number(buf.readBigUInt64LE(offset + 4))
		if (!Number.isSafeInteger(count) || count < 0) return null
		let next = offset + 12
		const width = GGUF_SCALAR_BYTES[elementType]
		if (width !== undefined) {
			next += count * width
			return next > buf.length ? null : { value: undefined, next }
		}
		for (let i = 0; i < count; i++) {
			const element = readGgufValue(buf, next, elementType, depth + 1)
			if (!element) return null
			next = element.next
		}
		return { value: undefined, next }
	}
	const width = GGUF_SCALAR_BYTES[type]
	if (width === undefined || offset + width > buf.length) return null
	const next = offset + width
	switch (type) {
		case 0:
			return { value: buf.readUInt8(offset), next }
		case 1:
			return { value: buf.readInt8(offset), next }
		case 2:
			return { value: buf.readUInt16LE(offset), next }
		case 3:
			return { value: buf.readInt16LE(offset), next }
		case 4:
			return { value: buf.readUInt32LE(offset), next }
		case 5:
			return { value: buf.readInt32LE(offset), next }
		case 6:
			return { value: buf.readFloatLE(offset), next }
		case 7:
			return { value: buf[offset] !== 0, next }
		case 10:
			return { value: Number(buf.readBigUInt64LE(offset)), next }
		case 11:
			return { value: Number(buf.readBigInt64LE(offset)), next }
		default:
			return { value: buf.readDoubleLE(offset), next }
	}
}

/**
 * The metadata KV pairs in this window, decoded in file order for as far as the
 * window reaches.
 *
 * GGUF has no index, so finding the Nth key means decoding (or measuring) every
 * value before it. The walk ends quietly at the first value that runs past the
 * window — in practice the tokenizer's vocabulary array, megabytes long and
 * written after everything this file reads — or at anything it cannot decode,
 * with whatever it had read by then. Never a throw: a half-read header is the
 * normal state of a file that is still being downloaded.
 */
function readGgufMetadata(
	buf: Buffer,
	kvCount: bigint
): Map<string, GgufValue> {
	const out = new Map<string, GgufValue>()
	let offset = GGUF_HEADER_BYTES
	for (let i = 0n; i < kvCount; i++) {
		const key = readGgufString(buf, offset)
		if (!key || key.next + 4 > buf.length) break
		const type = buf.readUInt32LE(key.next)
		const value = readGgufValue(buf, key.next + 4, type)
		if (!value) break
		if (value.value !== undefined) out.set(key.value, value.value)
		offset = value.next
	}
	return out
}

/**
 * The value of `general.architecture`, or null if this window does not carry
 * one we can read.
 *
 * Two attempts, in order. First the honest one: the KV walk above, which finds
 * the key wherever a writer put it. If the walk stopped short of it — a value
 * type it does not know, or an alignment/padding surprise — fall back to
 * scanning the window for the literal key bytes and decoding what follows. The
 * scan is a fallback rather than the primary because it would happily match
 * the same text appearing inside some other value.
 */
function readArchitecture(
	buf: Buffer,
	metadata: ReadonlyMap<string, GgufValue>
): string | null {
	const decoded = metadata.get(ARCH_KEY)
	if (typeof decoded === "string") return decoded

	const found = buf.indexOf(ARCH_KEY, 0, "utf8")
	if (found < 0) return null
	return readTypedString(buf, found + ARCH_KEY.length)
}

/**
 * What an `<arch>.pooling_type` value says the file is. Only called when the
 * key is present — its absence says nothing, and falls through to the
 * architecture.
 */
function verdictForPooling(
	architecture: string,
	pooling: number
): ModelKindVerdict {
	const key = `${architecture}${POOLING_KEY_SUFFIX}`
	const name = EMBEDDING_POOLING_NAMES[pooling]
	if (name !== undefined) {
		return {
			kind: "embeddings",
			reason: `The GGUF header sets ${key} to ${pooling} (${name}), which only an embedding model declares.`
		}
	}
	if (pooling === RERANK_POOLING) {
		return {
			kind: "unknown",
			reason: `The GGUF header sets ${key} to ${pooling} (rank): a reranker, which scores passages against a query. It is not a text, image or embedding model.`
		}
	}
	return {
		kind: "unknown",
		reason: `The GGUF header sets ${key} to ${pooling}, a pooling type this build does not recognise.`
	}
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

	const metadata = readGgufMetadata(buf, kvCount)
	const architecture = readArchitecture(buf, metadata)
	if (architecture === null) {
		return {
			kind: "unknown",
			reason: `The GGUF header has ${kvCount} metadata entries but no readable general.architecture in its first ${buf.length} bytes.`
		}
	}
	// Before the architecture, and not overridable by it: `qwen3` is a chat
	// architecture AND Qwen3-Embedding's.
	const pooling = metadata.get(`${architecture}${POOLING_KEY_SUFFIX}`)
	if (typeof pooling === "number" && Number.isInteger(pooling)) {
		return verdictForPooling(architecture, pooling)
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
	if (kind === "embeddings") {
		return {
			kind: "embeddings",
			reason: `The GGUF header says general.architecture is "${architecture}", an architecture that only embeds.`
		}
	}
	// Named, not swallowed: "which architecture?" is the first thing anyone
	// adding it to a list above will want to know.
	return {
		kind: "unknown",
		reason: `The GGUF header says general.architecture is "${architecture}", which this build recognises as neither a diffusion, a language nor an embedding model.`
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
