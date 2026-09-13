/**
 * The embedding-adapter family.
 *
 * A third family beside `BaseConnectionAdapter` (text) and `BaseImageAdapter`
 * (images), and parallel to both for the same reason they are parallel to each
 * other: an embedding call has no prompt to assemble, no token budget, no
 * streaming and no sampling config, so a subclass of the text base would inherit
 * ten construction parameters it must ignore. What is SHARED is the ACTION —
 * `embedText` comes from `$lib/server/adapters/actions` like every other, which
 * is what makes "this type can do `text->embedding`" derivable from the class
 * rather than asserted twice.
 *
 * ## Why embeddings became an adapter at all
 *
 * `src/lib/server/embedding/index.ts` hand-rolled one OpenAI-compatible client
 * and called it "api mode", which is why Ollama's own `/api/embed` could not be
 * reached and why there was exactly one embedding endpoint per instance. The
 * action surface has named `embedText` since the two families were unified, with
 * a comment saying this was the first follow-up; this is it. The runtime still
 * owns residency (loading, the idle TTL, the readiness flags) because those are
 * properties of the INSTANCE rather than of a call — an adapter is constructed
 * per request and has nowhere to keep them.
 *
 * ## One row, one model
 *
 * An embedding connection names one model, exactly as every other connection
 * does, and the width of its vectors is READ BACK from the first response rather
 * than declared. A width nobody measured is a width that corrupts an index the
 * day a backend changes its default, and `EmbedResult.dimensions` exists for
 * precisely that reason.
 */

import type {
	AdapterActions,
	EmbedRequest,
	EmbedResult
} from "$lib/server/adapters/actions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export { CONNECTION_TYPE }
export type { EmbedRequest, EmbedResult }

/** One model an embedding endpoint offers, in the shape the model picker reads. */
export interface EmbeddingModelOption {
	/** What the adapter sends: a HuggingFace id, an Ollama tag, an API model id. */
	model: string
	/** What a person sees. Defaults to `model` wherever nothing better is known. */
	name?: string
	/** Vector width, where the source publishes one. Never guessed. */
	dimensions?: number
	/** A line for the picker: size, tier, what it is good at. */
	description?: string
}

/** What a concrete embedding-adapter module default-exports. */
export interface EmbeddingAdapterExports {
	Adapter: new (connection: SelectConnection) => BaseEmbeddingAdapter
	/**
	 * What this endpoint can embed with.
	 *
	 * Answers `{models: []}` with an `error` rather than throwing, matching both
	 * other families: a host that is down is a thing the form has to SAY, not an
	 * exception for the socket layer to turn into "An error occurred".
	 */
	listModels: (
		connection: SelectConnection
	) => Promise<{ models: EmbeddingModelOption[]; error?: string }>
	testConnection: (connection: SelectConnection) => Promise<{
		ok: boolean
		error?: string
		extra?: Record<string, unknown>
	}>
}

/**
 * The actions this family does not implement, merged on as an INTERFACE.
 *
 * Same mechanism the other two bases use, and the same reason: `declare x?: …`
 * in a class body declares a PROPERTY, and a subclass implementing it as a
 * method is TS2425 — a surface that compiles and cannot be fulfilled.
 *
 * The text and image actions are included deliberately. Their ABSENCE is the
 * statement: an embedding module implementing `generateText` would be how an
 * embeddings connection derived `text->text` and became offerable as the chat
 * default, so the possibility is typed rather than left to a convention.
 */
export interface BaseEmbeddingAdapter
	extends Partial<Omit<AdapterActions, "embedText">> {}

export abstract class BaseEmbeddingAdapter implements AdapterActions {
	connection: SelectConnection

	constructor(connection: SelectConnection) {
		this.connection = connection
	}

	/**
	 * Turn text into vectors. `text->embedding`, and the one action an embedding
	 * adapter must have.
	 *
	 * Array in, array out, in input order — every backend batches and so does
	 * every caller. An implementation that cannot preserve order must SORT by
	 * whatever ordinal its protocol returns; a vector filed against the wrong row
	 * is a retrieval failure that surfaces as bad results rather than as an error.
	 *
	 * ⚠ Must return `[]` for an empty batch WITHOUT calling the backend. The
	 * queue asks for whatever is pending, and an idle tick that posts an empty
	 * request wakes a model for nothing on every scan.
	 */
	abstract embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult>
}
