/**
 * A model identifier, as a person should read it.
 *
 * ## The thing this fixes
 *
 * The managed views listed their models as
 * `hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M`, wrapped over two lines, as the
 * card's TITLE — with `Size: 7.0 GB`, `Modified: 10/26/2025` and
 * `Parameters: 12.2B` under it as a right-aligned key/value table, and four
 * buttons below that. One model took 200px of a 400px-wide column; two were
 * visible at a time out of four.
 *
 * Every part of that identifier is already a fact with a column of its own.
 * `bartowski` is a packager, `GGUF` is the format, `Q4_K_M` is the quantisation,
 * `12B` is the parameter count, and `MN` is Mistral Nemo. What is left once
 * those are lifted out is **Lyra v4**, which is the model's actual name and the
 * only part a person recognises.
 *
 * So: the name is the title, the numbers are one quiet line, and the full
 * identifier stays available in a `title` attribute and in the model's own view.
 * A row is two lines and about 56px, so eight fit where two did.
 *
 * ⚠ **Nothing here is a fact in the `ModelFacts` sense.** These are *guesses
 * from a string*, and they are only ever used for the LABEL. Where a host
 * actually told us the parameter size or the quantisation, `ModelFacts` wins and
 * this is not consulted — see `modelDisplay()` below, which takes the facts
 * first. A guess that decorates a name is fine; a guess that fills a column
 * headed "Quantisation" is the guessing this codebase refuses everywhere else.
 *
 * ⚠ Pure. No Svelte, no socket.
 */
import type { ModelFacts } from "$lib/shared/connections/modelFacts"

/** Quantisation suffixes a GGUF filename or Ollama tag carries. */
const QUANT_SOURCE =
	"\\b(IQ\\d[A-Z_]*|Q\\d(?:_[A-Z0-9]+)*|F16|F32|BF16|fp16|fp32|int8|int4)\\b"
const QUANT = new RegExp(QUANT_SOURCE, "i")
/** The same, global, for stripping every occurrence out of a name. */
const QUANT_ALL = new RegExp(QUANT_SOURCE, "gi")

/** A parameter count, as packagers write it. */
const PARAMS = /\b(\d+(?:\.\d+)?)\s*([BbMm])\b/

/**
 * Words that are packaging, not naming. Dropped from a display name wherever
 * they appear.
 *
 * ⚠ `instruct`, `chat` and `it` are NOT here, on purpose. Two checkpoints of
 * one model that differ only by being instruction-tuned are two different things
 * to pick between, and collapsing their names to one would make the list
 * ambiguous exactly where it matters.
 */
const NOISE = new Set([
	"gguf",
	"ggml",
	"onnx",
	"safetensors",
	"hf",
	"co",
	"main",
	"latest",
	"model",
	"models",
	"quantized",
	"quantised",
	"imatrix"
])

const TITLE_WORD = /^[a-z]+$/

/** Capitalise a word that is plainly lower-case prose; leave acronyms alone. */
function pretty(word: string): string {
	if (!TITLE_WORD.test(word)) return word
	return word[0].toUpperCase() + word.slice(1)
}

export interface ModelDisplay {
	/** What to show as the row's title. Never empty. */
	name: string
	/** "12B", or null. */
	parameters: string | null
	/** "Q4_K_M", or null. */
	quantization: string | null
	/** The identifier, verbatim — for a `title` attribute and the model view. */
	identifier: string
}

/**
 * Pull a readable name out of an identifier.
 *
 * ⚠ The LAST path segment only. `hf.co/bartowski/MN-12B-Lyra-v4-GGUF` is a
 * repo path whose leading segments are a host and a packager, and neither is
 * the model. A bare `gpt-4o` has one segment and is returned all but untouched.
 */
export function nameFromIdentifier(identifier: string): string {
	const raw = identifier.trim()
	if (!raw) return raw
	// Strip an Ollama/HF tag, then take the last path segment.
	const withoutTag = raw.split(":")[0]
	const segment = withoutTag.split("/").pop() ?? withoutTag
	// A filename's extension is packaging.
	const withoutExt = segment.replace(/\.(gguf|onnx|safetensors|bin)$/i, "")

	// ⚠ The quant comes out WHOLE and BEFORE the split, because it contains the
	// separator: splitting `Lyra-v4-Q4_K_M` first leaves `Q4`, `K` and `M`, and
	// only the first of those looks like a quantisation — so the row would have
	// read "Lyra v4 K M".
	const withoutQuant = withoutExt.replace(QUANT_ALL, " ")

	// ⚠ Split on `-` and `_` only, never `.`: a dot inside an identifier is
	// almost always a version (`v4.3`, `Qwen2.5`), and splitting on it turned
	// "Cydonia v4.3" into "Cydonia v4 3".
	const words = withoutQuant
		.split(/[-_\s]+/)
		.filter(Boolean)
		.filter((w) => !NOISE.has(w.toLowerCase()))
		.filter((w) => !PARAMS.test(w))

	const name = words.map(pretty).join(" ").trim()
	// Everything was packaging — a file called `Q4_K_M.gguf` is not a name, so
	// fall back to the segment rather than to an empty row.
	return name || withoutExt || raw
}

/**
 * What a row shows for one model.
 *
 * `facts` wins over the identifier for every fact it carries: a host that says
 * `parameter_size: "12.2B"` is telling us, and a regular expression reading
 * `12B` out of a filename is inferring. The identifier is only asked where the
 * host was silent.
 *
 * `name` prefers what the ROW is called — a person's rename, or the friendlier
 * label a listing offered — and only derives one when the name is still the
 * bare identifier, which is what `syncConnectionModels` leaves it as.
 */
export function modelDisplay(model: {
	model: string
	name?: string | null
	facts?: ModelFacts | null
}): ModelDisplay {
	const identifier = model.model
	const given = model.name?.trim() || ""
	const name =
		given && given !== identifier ? given : nameFromIdentifier(identifier)

	const fromId = identifier.split("/").pop() ?? identifier
	const quantMatch = fromId.match(QUANT)
	const paramsMatch = fromId.match(PARAMS)

	return {
		name,
		parameters:
			model.facts?.parameters ??
			(paramsMatch
				? `${paramsMatch[1]}${paramsMatch[2].toUpperCase()}`
				: null),
		quantization: model.facts?.quantization ?? quantMatch?.[0] ?? null,
		identifier
	}
}

/** "7.0 GB", "840 MB" — a size as a person reads it. */
export function formatSize(bytes: number | null | undefined): string | null {
	if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null
	const gb = bytes / 1_000_000_000
	// One decimal, and a trailing `.0` dropped: "7 GB", "11.9 GB", "24 GB".
	// Rounding at 10 instead printed an 11.9 GB file as "12 GB", which is the
	// one number a person is comparing against the memory they have.
	if (gb >= 1) return `${gb.toFixed(1).replace(/\.0$/, "")} GB`
	const mb = bytes / 1_000_000
	return `${Math.round(mb)} MB`
}
