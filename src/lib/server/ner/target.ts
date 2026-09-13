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
 * Same reason `embedding/target.ts` does not: that resolver walks three TIERS
 * (capability default, pipeline config, session override) because a text slot
 * can be overridden per pipeline and per session. Entity annotation cannot —
 * every annotation row is compared against every other, so they have to come
 * from one model to be comparable — and it carries
 * `withCompletionTemplate`/`withWireMode`, prompt-shaped facts an entity request
 * has no use for. So this reads tier one directly, through the same
 * `capabilityDefault()` storage boundary.
 *
 * ## The identity string is what a star change is judged on
 *
 * `modelId` is the bare HuggingFace id for a local model and
 * `api::<baseUrl>::<model>` for an endpoint — the same spelling
 * `embedding/target.ts` uses, and for the same reason: two connection rows
 * naming one endpoint and one model produce identical annotations, so comparing
 * ids rather than connection ids is what makes pressing the star twice a no-op
 * instead of a re-scan of every annotated row.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import {
	connectionModelById,
	defaultConnectionModel,
	mergeEndpointModel
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
	 * `local` runs the model in this process; `api` posts to a host.
	 *
	 * There is no `api` type today. The arm exists because the resolver is where
	 * one would be added, and a `mode` invented later would be a second place to
	 * decide something this one already decides.
	 */
	mode: "local" | "api"
	/** What a star change is compared on. See the header. */
	modelId: string
	ttlMinutes: number
	localModelName?: string
	apiBaseUrl?: string
	apiModel?: string
	/** The endpoint row with the starred model merged in. */
	connection: SelectConnection
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

	// The model rides with the connection (0114): the star names a pair, and
	// naming only the endpoint means "its default model".
	const modelRow = registered.connectionModelId
		? await connectionModelById(db, registered.connectionModelId)
		: await defaultConnectionModel(db, registered.connectionId)
	// A model row belongs to exactly one endpoint; one that names another is a
	// pair no backend could serve.
	const model =
		modelRow && modelRow.connectionId === registered.connectionId
			? modelRow
			: undefined
	const connection = mergeEndpointModel(
		endpoint,
		model
	) as unknown as SelectConnection

	const modelName = (connection.model ?? "").trim()
	if (!modelName) return null

	const extra = (endpoint.extraJson ?? {}) as Record<string, unknown>
	// `??` and not `||`: zero means "keep it loaded indefinitely", which is a
	// setting somebody chose and not an absent one.
	const ttl = extra.nerModelTtlMinutes
	const ttlMinutes =
		typeof ttl === "number" && ttl >= 0 ? ttl : DEFAULT_NER_TTL_MINUTES

	const base = {
		connectionId: endpoint.id,
		connectionName: endpoint.name,
		type: endpoint.type,
		ttlMinutes,
		connection
	}

	if (endpoint.type === CONNECTION_TYPE.LOCAL_ONNX_NER)
		return {
			...base,
			mode: "local",
			modelId: modelName,
			localModelName: modelName
		}

	const baseUrl = (endpoint.baseUrl ?? "").trim()
	if (!baseUrl) return null
	return {
		...base,
		mode: "api",
		modelId: `api::${baseUrl}::${modelName}`,
		apiBaseUrl: baseUrl,
		apiModel: modelName
	}
}
