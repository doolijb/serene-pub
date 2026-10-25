/**
 * What a probe's model list looks like, flattened to one shape.
 *
 * ## Why this is not a per-form job any more
 *
 * `listModels` returns whatever each backend's own endpoint made convenient, and
 * the nine connection forms each normalized it inline: Ollama and LM Studio map
 * `{model, name}`, OpenAI maps `{id}` twice (once as the value, once as the
 * label), the managed KoboldCPP form maps `{name}` for both. That was fine while
 * the only consumer was one `<select>` per form.
 *
 * 0114 added a second consumer — "add these to this connection" — and it must
 * read every shape, because it sits in the shared editor rather than in any one
 * form. Nine inline maps and a tenth that has to agree with all of them is how a
 * backend gets silently dropped from Add all, with no error and an empty list
 * that looks like the host answered nothing.
 *
 * ⚠ Normalizing is all this does. It never invents an identifier: an entry with
 * nothing usable is DROPPED rather than added as `""`, which the
 * `connection_models` check constraint refuses anyway — and which would mean
 * "the server's default model" on most services and an error on the rest.
 *
 * ⚠ It never DISCARDS the rest of an entry: dropping its other keys leaves
 * nothing downstream able to say how big a context is or what a message
 * costs. `readModelFacts` reads them; `modelSync` stores them.
 */
import { readModelFacts, type ModelFacts } from "./modelFacts"

export interface ProbedModel {
	/** What the adapter would send. */
	model: string
	/** What to call it. Falls back to the identifier. */
	name: string
	/**
	 * What the host said ABOUT it — context window, price, quantisation, size.
	 *
	 * Absent when the entry carried nothing, which is most of them: an OpenAI
	 * official listing is `{id, object, created, owned_by}` and none of that is
	 * a fact worth a column. See `modelFacts.ts` for why this is not merged into
	 * `connection_models.context_window`.
	 */
	facts?: ModelFacts
	/**
	 * What the model is FOR, when the adapter could tell — `text-gen`,
	 * `embeddings`, `image-gen`. Read only from an explicit `modality` string
	 * on the entry: each adapter translates its host's own vocabulary (Ollama's
	 * `capabilities`, the managed KoboldCPP's model registry) into this word, so this
	 * reader never has to learn a host's dialect.
	 */
	modality?: string
	/**
	 * 🚧 What the HOST says the model reads and writes (O3): an adapter's own
	 * `reads`/`writes` lists, else the `architecture.input_modalities` /
	 * `output_modalities` OpenRouter (and hosts copying its shape) put on
	 * every entry. Only for a generating model — one that writes text,
	 * pictures or speech. Absent when the host said nothing.
	 */
	reads?: string[]
	writes?: string[]
}

/** The kinds a host's modality words name, in the app's words; others are dropped. */
const HOST_KIND: Readonly<Record<string, string>> = {
	text: "text",
	image: "image",
	audio: "audio",
	video: "video"
}
const kindsFrom = (v: unknown): string[] | undefined => {
	if (!Array.isArray(v)) return undefined
	const out = [
		...new Set(
			v
				.map((k) => (typeof k === "string" ? HOST_KIND[k.trim().toLowerCase()] : undefined))
				.filter((k): k is string => !!k)
		)
	]
	return out.length ? out : undefined
}

/** A host's stated reads and writes, for a model that generates. */
function readsWritesOf(e: Record<string, unknown>): { reads?: string[]; writes?: string[] } {
	const arch = (e.architecture ?? null) as Record<string, unknown> | null
	const writes = kindsFrom(e.writes) ?? kindsFrom(arch?.output_modalities)
	if (!writes) return {}
	const reads = kindsFrom(e.reads) ?? kindsFrom(arch?.input_modalities)
	return { writes, ...(reads ? { reads } : {}) }
}

/** Read one entry, in any of the shapes the adapters produce. */
function readOne(entry: unknown): ProbedModel | null {
	if (typeof entry === "string") {
		const id = entry.trim()
		return id ? { model: id, name: id } : null
	}
	if (!entry || typeof entry !== "object") return null
	const e = entry as Record<string, unknown>
	// `model` (Ollama, LM Studio, llama.cpp), then `id` (OpenAI-compatible),
	// then `name` (the managed KoboldCPP model list, whose files ARE their ids).
	const raw = [e.model, e.id, e.name].find(
		(v) => typeof v === "string" && v.trim()
	) as string | undefined
	if (!raw) return null
	const model = raw.trim()
	const name =
		typeof e.name === "string" && e.name.trim() ? e.name.trim() : model
	const facts = readModelFacts(e)
	const modality =
		typeof e.modality === "string" && e.modality.trim()
			? e.modality.trim()
			: undefined
	return {
		model,
		name,
		...(facts ? { facts } : {}),
		...(modality ? { modality } : {}),
		...(modality === "embeddings" || modality === "ner" ? {} : readsWritesOf(e))
	}
}

/**
 * Every usable entry, de-duplicated by identifier, in the order the host gave
 * them.
 *
 * De-duplicated because a host answering the same id twice is not worth an error
 * and IS worth not sending twice: the (connection_id, model) unique index would
 * refuse the second, and "added 12, skipped 1" for a list of 12 reads as a bug.
 */
export function normalizeProbedModels(models: unknown): ProbedModel[] {
	if (!Array.isArray(models)) return []
	const seen = new Set<string>()
	const out: ProbedModel[] = []
	for (const entry of models) {
		const one = readOne(entry)
		if (!one || seen.has(one.model)) continue
		seen.add(one.model)
		out.push(one)
	}
	return out
}
