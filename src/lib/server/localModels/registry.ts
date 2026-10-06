/**
 * The vendor-neutral vocabulary of `local_models`, and the derivations that
 * keep the row honest.
 *
 * ## Why there is no `engine` column
 *
 * A `.gguf` is not owned by KoboldCPP: llama.cpp opens the same bytes. Storing
 * one engine per row would assert an exclusivity that does not exist, would
 * make a model look tied to whichever backend happened to register it, and
 * would need rewriting the day a backend is added. So the compatible engines
 * are DERIVED, here, from what the row actually knows — the file's `format` and
 * the model's `modality`. Derived stays correct when the support table below
 * grows; stored goes quietly stale.
 *
 * ## format is detectable, modality is not
 *
 * `formatForFilename` is a fact about the bytes and needs no provenance.
 * Modality has none of that: the curated image models at
 * huggingface.co/koboldcpp/imgmodel are every one of them `.gguf`, so the
 * extension says what the container is and nothing whatever about what the
 * model is for. That is the half `local_models.kind_source` exists to grade,
 * and it is why `modalityForKind` returns `null` rather than a guess.
 */

import type { LocalModelFormat } from "$lib/server/db/schema"

/**
 * A backend that can open a local model file.
 *
 * ⚠ "Can open", not "Serene Pub manages the process". `koboldcpp` is the only
 * one this app currently downloads a binary for and loads models into; naming
 * the others is what lets a picker say why a file it holds is unusable today
 * rather than pretending the file is wrong.
 */
export type LocalModelEngine = "koboldcpp" | "llamacpp" | "onnx"

/** The extensions that map onto a format we know. */
const FORMAT_BY_EXTENSION: ReadonlyArray<[string, LocalModelFormat]> = [
	[".gguf", "gguf"],
	[".onnx", "onnx"],
	[".safetensors", "safetensors"]
]

/**
 * The container this filename names, or `null` for one we do not know.
 *
 * `null` is a real answer and not an error: a directory scan skips such a file
 * long before this is asked (`isModelFilename`), so reaching `null` here means
 * a caller has a name from somewhere else and should not be inventing a format
 * for it.
 */
export function formatForFilename(filename: string): LocalModelFormat | null {
	const lower = filename.toLowerCase()
	for (const [ext, format] of FORMAT_BY_EXTENSION) {
		if (lower.endsWith(ext)) return format
	}
	return null
}

/**
 * Which engines can open a file of this format in this role.
 *
 * The two asymmetries encoded here are both already load-bearing elsewhere and
 * are stated once, here, rather than re-derived per call site:
 *
 * - **koboldcpp loads GGUF only for text, GGUF *or* safetensors for images.**
 *   Same rule as `extensionAllowedForKind`; a `.safetensors` offered as a text
 *   model is a download that could never have worked.
 * - **ONNX is the embedding/NER lane's format**, and nothing that speaks GGUF
 *   reads it.
 *
 * A `null` modality — the row's honest "nobody knows yet" — returns the union
 * over every role the format is loadable in at all, because "we cannot say what
 * this is for" is not the same claim as "nothing can load it".
 */
export function enginesFor(
	format: LocalModelFormat,
	modality: string | null | undefined
): LocalModelEngine[] {
	switch (format) {
		case "gguf":
			// llama.cpp is the same loader underneath for every text-shaped
			// role; koboldcpp adds sd.cpp, which is why it alone answers for
			// image-gen.
			if (modality === "image-gen") return ["koboldcpp"]
			if (
				modality == null ||
				modality === "text-gen" ||
				modality === "embeddings"
			) {
				return ["koboldcpp", "llamacpp"]
			}
			return []
		case "safetensors":
			// Images only. koboldcpp's text side is GGUF-only, so there is no
			// role in which anything here opens a .safetensors as text.
			if (modality == null || modality === "image-gen") {
				return ["koboldcpp"]
			}
			return []
		case "onnx":
			if (
				modality == null ||
				modality === "embeddings" ||
				modality === "ner"
			) {
				return ["onnx"]
			}
			return []
	}
}

/**
 * The modality a koboldcpp `kind` implies, or `null` when it implies none.
 *
 * ⚠ **The single projection between the two columns.** `kind` and `modality`
 * describe different things — a loader lane and a role — and the only reason
 * they cannot disagree on a koboldcpp row is that every writer that sets one
 * sets the other through this function. Add a write site that sets `kind`
 * alone and the two columns start drifting, which is precisely the defect the
 * vendor-neutral registry exists to avoid.
 *
 * `unknown` maps to `null`, not to `"text-gen"`. The classifier reaching
 * `unknown` means it looked and could not tell; recording a role anyway would
 * turn "we do not know" into an assertion, and the row's `kind_source` would
 * grade that assertion as though something had measured it.
 *
 * `embeddings` is koboldcpp's third loader (`--embeddingsmodel`), decided by
 * the header's `<arch>.pooling_type` (`modelKind.ts`), so a measured kind
 * projects to the measured role here too. Until 2026-10-05 an embedding GGUF
 * was `kind: "text"` because nothing could tell it apart.
 *
 * This does NOT run in the other direction. Modality is an open vocabulary
 * (`ner`, `tts`, …) that no koboldcpp loader serves, so modality → kind is not
 * a projection at all.
 */
export function modalityForKind(
	kind: Sockets.KoboldCPP.ModelKind
): string | null {
	if (kind === "text") return "text-gen"
	if (kind === "image") return "image-gen"
	if (kind === "embeddings") return "embeddings"
	return null
}
