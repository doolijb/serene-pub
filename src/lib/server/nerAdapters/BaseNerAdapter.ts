/**
 * The NER adapter family.
 *
 * A fourth family beside `BaseConnectionAdapter` (text), `BaseImageAdapter`
 * (images) and `BaseEmbeddingAdapter` (embeddings), parallel to all three for
 * the reason they are parallel to each other: an entity call has no prompt to
 * assemble, no token budget, no streaming and no sampling config, so a subclass
 * of the text base would inherit ten construction parameters it must ignore.
 * What is SHARED is the ACTION — `extractEntities` comes from
 * `$lib/server/adapters/actions` like every other, which is what makes "this
 * type can do `text->entities`" derivable from the class rather than asserted
 * twice.
 *
 * ## Why entity extraction became an adapter at all
 *
 * The annotation lane ran model-free: a gazetteer of names the world already
 * declares, plus capitalised runs. That tier is the zero-setup path and is not
 * going anywhere — but a proper noun written in lower case, and any name the
 * world has no row for, were invisible to it. Making the model a CONNECTION is
 * what lets there be several configured, one starred, and a switch between them
 * that states its cost, instead of a hidden setting with one possible value.
 *
 * ## The adapter is the production path
 *
 * The annotation lane reads spans through `extractEntities` and loads through
 * the module's `residency`, both reached by `getNerAdapter(type)`. Neither the
 * lane nor its broker names a backend, so a new NER type is a module here plus
 * its registry and manifest entries, and nothing in the lane changes.
 *
 * ## One row, one model
 *
 * A NER connection names one model, exactly as every other connection does. The
 * LABELS it emits are the model's own (`PER`, `LOC`, `ORG`, …) and are carried
 * through untranslated: mapping them onto this app's `EntityRef` kinds would be
 * a guess, and `ranking/entities.ts` resolves a span against the gazetteer by
 * NAME instead, which is an answer.
 */

import type {
	AdapterActions,
	ActionOptions,
	EntitySpan,
	ExtractEntitiesRequest
} from "$lib/server/adapters/actions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export { CONNECTION_TYPE }
export type { EntitySpan, ExtractEntitiesRequest }

/** One model an entity backend offers, in the shape the model picker reads. */
export interface NerModelOption {
	/** What the adapter sends: a HuggingFace id, or a hosted model id. */
	model: string
	/** What a person sees. Defaults to `model` wherever nothing better is known. */
	name?: string
	/** A line for the picker: size, languages, what it labels. */
	description?: string
}

/** What a concrete NER-adapter module default-exports. */
export interface NerAdapterExports {
	Adapter: new (connection: AdapterConnection) => BaseNerAdapter
	/**
	 * What this backend can extract with.
	 *
	 * Answers `{models: []}` with an `error` rather than throwing, matching all
	 * three other families: a host that is down is a thing the form has to SAY,
	 * not an exception for the socket layer to turn into "An error occurred".
	 */
	listModels: (
		connection: SelectConnection
	) => Promise<{ models: NerModelOption[]; error?: string }>
	testConnection: (connection: SelectConnection) => Promise<{
		ok: boolean
		error?: string
		extra?: Record<string, unknown>
	}>
	/**
	 * The residency of a backend whose model runs in THIS process, or absent
	 * for one that has nothing to load.
	 *
	 * What the annotation lane's broker (`ner/broker.ts`) loads through, so
	 * the broker never names a loader. Absent is a real answer, not a
	 * missing one: a hosted endpoint or a prompted text model is up whenever
	 * its host is, so the broker leases it at once and a failed call
	 * subtracts that row's spans. A thunk because the residency module holds
	 * the loaded pipeline and must stay behind a dynamic import (see
	 * `LocalOnnxNerAdapter`).
	 */
	residency?: () => Promise<NerResidency>
}

/**
 * Load, and say what is loaded, for one in-process NER backend.
 *
 * `resident()` and `loading()` are synchronous on purpose: the broker reads
 * them back to back with no await between, which is what stops two callers
 * that arrive together from both starting a load.
 */
export interface NerResidency {
	/** The model loaded and ready to run, or null. */
	resident(): string | null
	/** Whether a load is in flight. */
	loading(): boolean
	/**
	 * Load (or hot-swap to) `model`, with the idle timer armed on
	 * `ttlMinutes`. Throws when the model cannot load.
	 */
	load(model: string, ttlMinutes: number): Promise<void>
}

/**
 * The actions this family does not implement, merged on as an INTERFACE.
 *
 * Same mechanism the other three bases use, and the same reason: `declare x?: …`
 * in a class body declares a PROPERTY, and a subclass implementing it as a
 * method is TS2425 — a surface that compiles and cannot be fulfilled.
 *
 * The text, image and embedding actions are included deliberately. Their
 * ABSENCE is the statement: a NER module implementing `generateText` would be
 * how an entity connection derived `text->text` and became offerable as the chat
 * default, so the possibility is typed rather than left to a convention.
 */
export interface BaseNerAdapter
	extends Partial<Omit<AdapterActions, "extractEntities">> {}

export abstract class BaseNerAdapter implements AdapterActions {
	connection: AdapterConnection

	constructor(connection: AdapterConnection) {
		this.connection = connection
	}

	/**
	 * Read the names out of a passage. `text->entities`, and the one action a
	 * NER adapter must have.
	 *
	 * ⚠ Every span's `start`/`end` are offsets into `req.text`, satisfying
	 * `req.text.slice(start, end) === span.text`. That is not a nicety: the
	 * merge in `ranking/entities.ts` compares these against the gazetteer's own
	 * claimed spans, so an offset taken from a normalised copy of the passage
	 * would claim the wrong words and double-count a name tier one resolved.
	 *
	 * ⚠ Must return `[]` for empty text WITHOUT calling the backend. The lane
	 * annotates whatever is stale, and an empty row must not wake a model.
	 */
	abstract extractEntities(
		req: ExtractEntitiesRequest,
		opts?: ActionOptions
	): Promise<EntitySpan[]>
}
