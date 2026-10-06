/**
 * WHICH connection reads entities — the star, and nothing else.
 *
 * ## ONE store, and there must never be a second
 *
 * "Is a model reading entities, and which one" is answered by the
 * `text->entities` row in `connection_defaults` and by nothing else. **No star
 * means the lane runs model-free**, which is a working state rather than an off
 * one: the gazetteer and the capitalisation heuristic are the zero-setup path
 * and keep running whatever is or is not configured.
 * `connection_defaults.connection_id` is ON DELETE SET NULL, so deleting the
 * connection returns the lane to model-free by itself rather than stranding a
 * dangling id.
 *
 * ## Why this does not go through `resolveCapabilityTarget`
 *
 * Same reason `embedding/target.ts` does not: that resolver walks two TIERS
 * (capability default, then pipeline config) because a text slot can be
 * overridden per pipeline. Entity annotation cannot —
 * every annotation row is compared against every other, so they have to come
 * from one model to be comparable — and it carries
 * `withCompletionTemplate`/`withWireMode`, prompt-shaped facts an entity request
 * has no use for. So this reads tier one directly, through the same
 * `capabilityDefault()` storage boundary.
 *
 * ## The identity string is what a star change is judged on
 *
 * `modelId` is the model the starred pair names, exactly as the adapter is sent
 * it — the bare HuggingFace id for a local model. Two connection rows naming
 * one model produce identical annotations, so comparing ids rather than
 * connection ids is what makes pressing the star twice a no-op instead of a
 * re-scan of every annotated row.
 *
 * ⚠ It is also what every annotation row is stamped with
 * (`entry_annotations.entity_model`), and a star move clears every row whose
 * stamp differs. Respelling it re-annotates every install's whole corpus.
 *
 * ## The type routes, and nothing here branches on it
 *
 * The target carries the connection's TYPE and the merged connection, and the
 * broker reaches the backend through `getNerAdapter(type)`. There is no
 * local/hosted arm: where a model runs is its adapter module's business, so a
 * new NER type is an adapter module and a registry entry, with no change here.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import {
	connectionModelById,
	mergeEndpointModel,
	type ResolvedConnectionPair
} from "$lib/server/connections/models"
import {
	DEFAULT_NER_TTL_MINUTES,
	NER_CAPABILITY
} from "$lib/shared/constants/ner"

export {
	NER_CAPABILITY,
	DEFAULT_NER_TTL_MINUTES
} from "$lib/shared/constants/ner"

export interface NerTarget {
	connectionId: number
	connectionName: string
	/** The connection TYPE — what routes a target to its adapter. */
	type: string
	/**
	 * The model the adapter is sent, and the identity a star change is compared
	 * on and every annotation row is stamped with. See the header.
	 */
	modelId: string
	ttlMinutes: number
	/** The endpoint row with the starred model merged in — what the adapter is built on. */
	connection: ResolvedConnectionPair
}

/**
 * Is anything registered to read entities?
 *
 * The cheap half, and the one the lane's broker asks on every peek: one indexed
 * lookup, no connection read. Deliberately answers on the REGISTRATION rather
 * than on whether the target fully resolves — a half-finished connection is
 * still somebody's intent, and the error they need is the one the connection's
 * own Test button gives, beside the field that is empty.
 */
export async function nerEnabled(db: Db): Promise<boolean> {
	const registered = await capabilityDefault(db, NER_CAPABILITY)
	return registered?.connectionId != null
}

/**
 * The starred entity connection, resolved to everything a backend needs.
 *
 * Returns null for every shape of "nothing to do": no star, a cleared star, a
 * star pointing at a row that is gone, a connection with no model. Null rather
 * than a throw for an unfinished connection — the lane peeks at this on every
 * tick, and a row somebody is part-way through creating is not an error.
 */
export async function resolveNerTarget(db: Db): Promise<NerTarget | null> {
	const registered = await capabilityDefault(db, NER_CAPABILITY)
	if (!registered?.connectionId) return null

	const [endpoint] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, registered.connectionId))
		.limit(1)
	if (!endpoint) return null

	// The star names a pair, and both halves are required: a registration
	// naming only the endpoint is incomplete, and the lane treats it as off
	// rather than guessing a model.
	const modelRow = registered.connectionModelId
		? await connectionModelById(db, registered.connectionModelId)
		: undefined
	// A model row belongs to exactly one endpoint; one that names another is a
	// pair no backend could serve.
	const model =
		modelRow && modelRow.connectionId === registered.connectionId
			? modelRow
			: undefined
	const connection = mergeEndpointModel(endpoint, model)

	const modelName = (connection.model ?? "").trim()
	if (!modelName) return null

	const extra = (endpoint.extraJson ?? {}) as Record<string, unknown>
	// `??` and not `||`: zero means "keep it loaded indefinitely", which is a
	// setting somebody chose and not an absent one.
	const ttl = extra.nerModelTtlMinutes
	const ttlMinutes =
		typeof ttl === "number" && ttl >= 0 ? ttl : DEFAULT_NER_TTL_MINUTES

	return {
		connectionId: endpoint.id,
		connectionName: endpoint.name,
		type: endpoint.type,
		modelId: modelName,
		ttlMinutes,
		connection
	}
}
