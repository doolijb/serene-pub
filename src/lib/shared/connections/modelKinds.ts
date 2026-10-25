/**
 * 🚧 **A model's reads and writes** (O3, PROPOSAL-layering §13; 0109).
 *
 * What a GENERATING model is for is two sets of media kinds — what it reads
 * and what it writes — never one modality. One model can write
 * a reply AND speak it (`text->text+audio`), read pictures AND hear a voice
 * note; a single `text-gen` could say neither.
 *
 * The check a transform is judged by is the one the brief rules: **the
 * transform's in ⊆ reads, and its out ⊆ writes.** A half that is NULL is "not
 * stated" and gates nothing — the endpoint's capability layers judge it, as
 * they always did (so a model upgraded from `text-gen` keeps the Vision
 * switch's answer for pictures). Embedding and NER models keep their single
 * modality (one active per modality) and are judged by it alone.
 *
 * Client-safe: no adapter, no database. The model page's **What it's for**
 * control reads `MODEL_PURPOSES`, and `connections:updateModel` accepts what
 * it offers — one list, so the two cannot drift.
 */

import { isTransformId, parseTransform } from "@serene-pub/sdk"

/** Which half of a model a purpose is about. */
export type ModelSide = "reads" | "writes"

/** One of the **What it's for** choices. */
export interface ModelPurpose {
	/** Stable key, for the control and its tests. */
	key: "writes-replies" | "draws-pictures" | "speaks" | "hears" | "sees"
	/** The words on the control. */
	label: string
	/** The half it sets, and the kind it adds there. */
	side: ModelSide
	kind: string
}

/** The five choices, in the order the control shows them (ruled, §13 O3). */
export const MODEL_PURPOSES: readonly ModelPurpose[] = [
	{ key: "writes-replies", label: "Writes replies", side: "writes", kind: "text" },
	{ key: "draws-pictures", label: "Draws pictures", side: "writes", kind: "image" },
	{ key: "speaks", label: "Speaks", side: "writes", kind: "audio" },
	{ key: "hears", label: "Hears", side: "reads", kind: "audio" },
	{ key: "sees", label: "Sees", side: "reads", kind: "image" }
]

/**
 * What each generating modality writes — the 0109 data upgrade's table, and
 * the reading of a row whose `writes` nobody has stated yet.
 */
export const WRITES_OF_MODALITY: Readonly<Record<string, readonly string[]>> = {
	"text-gen": ["text"],
	"image-gen": ["image"],
	tts: ["audio"]
}

/** Modalities that stay SINGLE — one active per modality (embeddings, NER). */
export const SINGLE_MODALITIES: ReadonlySet<string> = new Set([
	"embeddings",
	"ner"
])

/** The fields a model row (or a merged pair) carries for this. */
export interface ModelKindFields {
	modality?: string | null
	reads?: readonly string[] | null
	writes?: readonly string[] | null
}

/** A model's reads and writes; `null` on a half means "not stated". */
export interface ModelKinds {
	reads: string[] | null
	writes: string[] | null
}

const kindList = (v: unknown): string[] | null =>
	Array.isArray(v)
		? [...new Set(v.filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim()))]
		: null

/**
 * The model's stated sets — the columns where a person or a probe stated
 * them, else what its generating modality writes. A single-purpose model
 * (embeddings, NER) and a model nobody said anything about state nothing.
 */
export function modelKindsOf(row: ModelKindFields | null | undefined): ModelKinds {
	const reads = kindList(row?.reads)
	const writes =
		kindList(row?.writes) ??
		(row?.modality && WRITES_OF_MODALITY[row.modality]
			? [...WRITES_OF_MODALITY[row.modality]]
			: null)
	return { reads, writes }
}

/**
 * Whether the model may do this capability — the O3 check, replacing the old
 * "same output modality" rule.
 *
 *  - a feature (`tools`, `streaming`) is never gated here;
 *  - a single-purpose model (embeddings, NER) does only its own modality's
 *    transforms (`modalityOfTransform`, passed in so this stays free of the
 *    sections table);
 *  - a generating model: the transform's in ⊆ reads and out ⊆ writes, each
 *    half gating only when stated.
 */
export function modelKindsAllow(
	row: ModelKindFields | null | undefined,
	capability: string,
	modalityOfTransform: (id: string) => string | null
): boolean {
	if (!isTransformId(capability)) return true
	const modality = row?.modality ?? null
	if (modality && SINGLE_MODALITIES.has(modality))
		return modalityOfTransform(capability) === modality
	const { reads, writes } = modelKindsOf(row)
	let parsed: { in: readonly string[]; out: readonly string[] }
	try {
		parsed = parseTransform(capability as never) as never
	} catch {
		return true
	}
	if (reads && !parsed.in.every((k) => reads.includes(k))) return false
	if (writes && !parsed.out.every((k) => writes.includes(k))) return false
	return true
}

/**
 * The single modality a generating model is FILED under — the Models list's
 * grouping and every reader of `connection_models.modality` that predates the
 * sets: replies first, then pictures, then speech. Null when it writes none
 * of the three.
 */
export function modalityOfWrites(writes: readonly string[] | null | undefined): string | null {
	if (!writes?.length) return null
	if (writes.includes("text")) return "text-gen"
	if (writes.includes("image")) return "image-gen"
	if (writes.includes("audio")) return "tts"
	return null
}

/** Is this purpose on, for the control? A half not stated reads as off. */
export function purposeOn(kinds: ModelKinds, purpose: ModelPurpose): boolean {
	return !!kinds[purpose.side]?.includes(purpose.kind)
}

/**
 * The half a toggle writes: the purpose added to or taken off its side. A
 * reads set always keeps `text` — every generating model is prompted in words
 * — so ticking **Hears** states `["text","audio"]`, never `["audio"]`.
 * Only the touched half is returned, so ticking **Speaks** never states what
 * a model reads (and never takes a picture away from it).
 */
export function toggledPurpose(
	kinds: ModelKinds,
	purpose: ModelPurpose,
	on: boolean
): Partial<ModelKinds> {
	const current = kinds[purpose.side] ?? (purpose.side === "reads" ? ["text"] : [])
	const next = on
		? [...new Set([...current, purpose.kind])]
		: current.filter((k) => k !== purpose.kind)
	const withText =
		purpose.side === "reads" ? [...new Set(["text", ...next])] : next
	// Nothing written is "Not sure", never "writes nothing": an empty set
	// would refuse every transform, which no person unticking boxes means.
	return { [purpose.side]: withText.length ? withText : null }
}

/**
 * Read a `reads`/`writes` value off a socket payload: a list of kind words,
 * NULL for "not stated", or the error sentence.
 */
export function parseKindList(
	raw: unknown,
	side: ModelSide
): { value: string[] | null } | { error: string } {
	if (raw == null) return { value: null }
	if (!Array.isArray(raw) || raw.some((k) => typeof k !== "string"))
		return {
			error:
				side === "reads"
					? "Say what this model reads as a list of kinds — text, image, audio."
					: "Say what this model writes as a list of kinds — text, image, audio."
		}
	return { value: kindList(raw) ?? [] }
}
