/**
 * WHICH connection embeds — the star, and nothing else.
 *
 * ## ONE store, and there must never be a second
 *
 * "Is the embedding backend on, and which one is it" is answered by the
 * `text->embedding` row in `connection_defaults` and by nothing else. **No star
 * means embeddings are off**, everywhere — which is why there is no enabled flag
 * anywhere in the schema and why adding one would be a fact in two places that
 * every handler would then have to write in step.
 * `connection_defaults.connection_id` is ON DELETE SET NULL, so deleting the
 * connection turns embeddings off by itself rather than stranding a dangling
 * id.
 *
 * ## Why this does not go through `resolveCapabilityTarget`
 *
 * That resolver walks three TIERS — capability default, pipeline config, session
 * override — because a text slot can be overridden per pipeline and per session.
 * Embeddings cannot: every stored vector has to come from ONE model to be
 * comparable, so an embedding target is an instance property by construction. A
 * resolver offering two lower tiers would be offering a thing that must never
 * happen, and it would carry `withCompletionTemplate`/`withWireMode` —
 * prompt-shaped facts an embedding request has no use for. So this reads tier one
 * directly, through the same `capabilityDefault()` storage boundary.
 *
 * ## The identity string is load-bearing and unchanged
 *
 * `modelId` is written into every embedded row's `embedding_model` column and is
 * what staleness compares against. It is the bare HuggingFace id for a local
 * model and `api::<baseUrl>::<model>` for an endpoint — byte for byte what the
 * singleton produced. A new spelling would mark every vector on every upgraded
 * install stale, and the re-index would run unasked.
 *
 * The one exception is the managed KoboldCPP, which could not embed before it
 * had a spelling of its own: `koboldcpp_managed::<model>`, with no address in
 * it (`buildManagedKoboldCppModelId`).
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import {
	connectionModelById,
	mergeEndpointModel
} from "$lib/server/connections/models"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { hostKey } from "$lib/shared/connections/hostKey"
import { normalizeModelName } from "$lib/server/koboldcpp/modelManager"
import {
	DEFAULT_EMBEDDING_TTL_MINUTES,
	EMBEDDING_CAPABILITY
} from "$lib/shared/constants/embeddings"

/**
 * The transform `connection_defaults` keys the embedding star by, and the
 * idle-unload default.
 *
 * ⚠ Re-exported from `$lib/shared/constants/embeddings`, never declared here.
 * The sidebar reads the same capability id to find the star, and a second
 * spelling of a PRIMARY KEY value is a row nothing ever matches again.
 */
export {
	EMBEDDING_CAPABILITY,
	DEFAULT_EMBEDDING_TTL_MINUTES
} from "$lib/shared/constants/embeddings"

/**
 * The composite identifier for an endpoint-backed vector.
 *
 * Changes if EITHER the endpoint or the model changes, so staleness detection
 * (unmodified, model-string-based) catches both. Lives here rather than in
 * `index.ts` so a caller that only wants to know what is configured does not
 * have to import the pipeline module.
 */
export function buildApiModelId(baseUrl: string, model: string): string {
	return `api::${baseUrl}::${model}`
}

const MANAGED_KOBOLDCPP_IDENTITY_PREFIX = "koboldcpp_managed::"

/**
 * The identity of a vector made by KoboldCPP, run by Serene Pub: the model,
 * and NOT the address.
 *
 * ⚠ Not `buildApiModelId`. The managed row's `baseUrl` is display only — the
 * process is wherever `koboldCppManagerBaseUrl` says, and nothing keeps the
 * two in step — so an identity carrying it would name a column that does not
 * decide which model answers, and a change to it (or to the manager's port, the
 * day the row follows) would throw away an index made by the very same model.
 * There is one managed process per install, so the model alone is the whole
 * identity.
 *
 * The model is `normalizeModelName`'s: the file name without a directory or
 * `.gguf`, the one spelling koboldcpp's answer and the stored row agree on.
 *
 * The prefix is spelled out rather than read off `CONNECTION_TYPE`: it is
 * written into every vector, and renaming the type must not re-index anybody.
 */
export function buildManagedKoboldCppModelId(model: string): string {
	return `${MANAGED_KOBOLDCPP_IDENTITY_PREFIX}${normalizeModelName(model)}`
}

/** Whether an identity names a vector from KoboldCPP, run by Serene Pub. */
export function isManagedKoboldCppModelId(
	id: string | null | undefined
): boolean {
	return !!id && id.startsWith(MANAGED_KOBOLDCPP_IDENTITY_PREFIX)
}

/**
 * Whether two identities name the same model at the same address, spelled
 * differently — `api::https://host/v1::m` and `api::https://HOST:443/v1/::m`.
 *
 * ⚠ The identity string itself stays byte for byte what it always was (see the
 * header): respelling it would mark every stored vector stale on upgrade. So
 * the forgiveness lives here, in a comparison, and the star's consequence uses
 * it to re-stamp such vectors with the spelling now in force instead of paying
 * to embed them again (`restampEquivalentVectors`).
 *
 * The address is compared by `hostKey` — the one rule for "the same address,
 * typed twice": a trailing slash, the case of the scheme and host, a default
 * port written out, and nothing more — plus the query string, which `hostKey`
 * drops and which can name a deployment. `localhost` and `127.0.0.1` stay two
 * addresses, the safe direction for a rule whose mistake would be keeping
 * vectors from a different model. The model name is compared exactly. A local
 * model's identity is its bare id and matches only itself.
 */
export function sameEmbeddingModel(a: string, b: string): boolean {
	if (a === b) return true
	const pa = splitApiModelId(a)
	const pb = splitApiModelId(b)
	return (
		!!pa &&
		!!pb &&
		pa.model === pb.model &&
		addressKey(pa.baseUrl) === addressKey(pb.baseUrl)
	)
}

/**
 * `buildApiModelId`, read back. The model is after the LAST `::` — an IPv6
 * address carries `::` of its own, a model name does not.
 */
function splitApiModelId(
	id: string
): { baseUrl: string; model: string } | null {
	if (!id.startsWith("api::")) return null
	const cut = id.lastIndexOf("::")
	if (cut <= 3) return null
	return { baseUrl: id.slice(5, cut), model: id.slice(cut + 2) }
}

function addressKey(baseUrl: string): string | null {
	const host = hostKey(baseUrl)
	if (host === null) return null
	try {
		return host + new URL(baseUrl.trim()).search
	} catch {
		return host
	}
}

export interface EmbeddingTarget {
	connectionId: number
	connectionName: string
	/** The connection TYPE — what routes an API target to its adapter. */
	type: string
	/**
	 * `local` runs the model in this process; `api` posts to a host.
	 *
	 * ⚠ Not a substitute for `type`. Both `openai-embeddings` and
	 * `ollama-embeddings` are `api`, and they speak different routes.
	 */
	mode: "local" | "api"
	/** What goes in `embedding_model`. See the header. */
	modelId: string
	ttlMinutes: number
	localModelName?: string
	apiBaseUrl?: string
	/** Plaintext, for a caller that has to put it on a wire itself. */
	apiKey?: string | null
	apiModel?: string
	/**
	 * The endpoint row with the starred model merged in — what an embedding
	 * adapter is constructed from.
	 *
	 * ⚠ Its `extraJson.apiKey` is still the ENCRYPTED envelope. The adapter
	 * decrypts what it needs at the moment it builds a header; nothing puts a
	 * plaintext key back on the row.
	 */
	connection: SelectConnection
}

/**
 * Is anything registered to embed?
 *
 * The cheap half, and the one the queue's enabled-gate and the periodic scan
 * ask on every tick: one indexed lookup, no connection read, no decryption.
 * Deliberately answers on the REGISTRATION rather than on whether the target
 * fully resolves — a half-finished connection is still somebody's intent to have
 * embeddings on, and reporting "off" for it would silently stop the queue that
 * would otherwise surface the real error.
 */
export async function embeddingsEnabled(db: Db): Promise<boolean> {
	const registered = await capabilityDefault(db, EMBEDDING_CAPABILITY)
	return registered?.connectionId != null
}

/**
 * The starred embedding connection, resolved to everything a backend needs.
 *
 * Returns null for every shape of "nothing to do": no star, a cleared star, a
 * star pointing at a row that is gone, a connection with no model, an API
 * connection with no base URL yet.
 *
 * ⚠ **Null rather than a throw for an unfinished connection**, which is a change
 * from the singleton it replaces. That version threw "API vectorization is
 * enabled but not fully configured", because with one config and a separate
 * on/off switch, on-and-incomplete genuinely was contradictory. A connection row
 * cannot be contradictory: it is a row somebody is part-way through creating,
 * and the queue peeks at this on every idle tick. The error the person needs is
 * the one the connection's own Test button gives, beside the field that is
 * empty.
 */
export async function resolveEmbeddingTarget(
	db: Db
): Promise<EmbeddingTarget | null> {
	const registered = await capabilityDefault(db, EMBEDDING_CAPABILITY)
	if (!registered?.connectionId) return null
	return resolveEmbeddingPair(db, {
		connectionId: registered.connectionId,
		connectionModelId: registered.connectionModelId ?? null
	})
}

/** An unsaved edit to a pair: the address and the model identifier, as typed. */
export interface EmbeddingPairEdit {
	baseUrl?: string
	model?: string
}

/**
 * A connection and one of its models, resolved as if they were starred.
 *
 * `resolveEmbeddingTarget` is this applied to the star. Its own export for the
 * question asked BEFORE a star moves — what identity would this pair stamp,
 * and so what would starring it clear (`embeddingReindexCost`) — which has to
 * get the same answer the star will, or the confirmation prices a different
 * switch from the one it performs.
 *
 * `edit` asks the same of an edit not saved yet — the starred connection's
 * address, or its model's identifier, as the form holds them — so the
 * confirmation in front of that save prices what the save will do.
 */
export async function resolveEmbeddingPair(
	db: Db,
	registered: { connectionId: number; connectionModelId: number | null },
	edit?: EmbeddingPairEdit
): Promise<EmbeddingTarget | null> {
	const [stored] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, registered.connectionId))
		.limit(1)
	if (!stored) return null
	const endpoint =
		edit?.baseUrl !== undefined ? { ...stored, baseUrl: edit.baseUrl } : stored

	// The star names a pair, and both halves are required: a registration
	// naming only the endpoint is incomplete, and the lane treats it as off
	// rather than guessing a model.
	const modelRow = registered.connectionModelId
		? await connectionModelById(db, registered.connectionModelId)
		: undefined
	// A model row belongs to exactly one endpoint; one that names another is a
	// pair no backend could serve.
	const owned =
		modelRow && modelRow.connectionId === registered.connectionId
			? modelRow
			: undefined
	const model =
		owned && edit?.model !== undefined ? { ...owned, model: edit.model } : owned
	const connection = mergeEndpointModel(endpoint, model)

	const modelName = (connection.model ?? "").trim()
	if (!modelName) return null

	const extra = (endpoint.extraJson ?? {}) as Record<string, unknown>
	// `??` and not `||`: zero means "keep it loaded indefinitely", which is a
	// setting somebody chose and not an absent one.
	const ttl = extra.embeddingModelTtlMinutes
	const ttlMinutes =
		typeof ttl === "number" && ttl >= 0
			? ttl
			: DEFAULT_EMBEDDING_TTL_MINUTES

	const base = {
		connectionId: endpoint.id,
		connectionName: endpoint.name,
		type: endpoint.type,
		ttlMinutes,
		connection
	}

	if (endpoint.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)
		return {
			...base,
			mode: "local",
			modelId: modelName,
			localModelName: modelName
		}

	// Before the address check: the managed row's address is display only, so
	// it neither enters the identity nor is required (see
	// `buildManagedKoboldCppModelId`). Its adapter reads the real one.
	if (endpoint.type === CONNECTION_TYPE.KOBOLDCPP_MANAGED)
		return {
			...base,
			mode: "api",
			modelId: buildManagedKoboldCppModelId(modelName),
			apiModel: modelName
		}

	const baseUrl = (endpoint.baseUrl ?? "").trim()
	if (!baseUrl) return null
	return {
		...base,
		mode: "api",
		modelId: buildApiModelId(baseUrl, modelName),
		apiBaseUrl: baseUrl,
		apiKey: decryptApiKeyField(extra.apiKey) ?? null,
		apiModel: modelName
	}
}
