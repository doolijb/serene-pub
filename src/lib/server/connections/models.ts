/**
 * The MODEL half of an (endpoint, model) pair — reading it and merging it.
 *
 * ## The ruling this file is
 *
 * > "Endpoint/Model split. We would still need to be able to manage different
 * > models independently with their own settings, and choose via
 * > connection+model for i.e. system defaults & service node overrides."
 * > — 2026-09-10
 *
 * `connections` is the ENDPOINT: where the compute is, what the key is, which
 * wire protocol it speaks. `connection_models` is what is reachable through it.
 * A selection anywhere in the app — a capability default, a pipeline config's
 * connection slot, and since 0130 those two are the whole list — is a PAIR, and
 * both halves are required:
 * connections have no default model, so a pair naming only the endpoint is
 * incomplete and resolves as unconfigured rather than guessing.
 *
 * ## The merge is a ROW, deliberately
 *
 * `mergeEndpointModel` returns something shaped exactly like a `connections`
 * row, with the model's answers substituted in. That is the whole reason the
 * adapters did not move: `this.connection.model` reads the pair's model,
 * `withCompletionTemplate` dereferences the pair's template because
 * `promptFormat` is already the merged one, and `resolveWireMode`,
 * `capabilityRefusal` and `resolveContinueRefusal` all keep taking a row and
 * keep being right — because the row they are handed is the pair.
 *
 * The alternative was a second object travelling beside the connection, and
 * every reader of a connection field having to learn which of the two to ask.
 * Seven adapters, five dispatch paths and the whole capability guard would each
 * have become a place that could ask the wrong one, and asking the wrong one is
 * silent: you get the endpoint's answer, which is the answer that used to be
 * correct.
 *
 * ## ⚠ Nothing here may reach an adapter module
 *
 * `capabilityTarget.ts`'s rule, inherited: this file is imported by the
 * resolver, and the resolver must not transitively import an adapter (one of
 * them cannot be PARSED on Android). `resolveConnectionCapabilities` reads the
 * static manifest only, which is what makes the capability merge legal here.
 */

import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { CapabilityOverrides, CapabilitySet } from "@serene-pub/sdk"
import {
	capabilityColumn,
	resolveConnectionCapabilities,
	type StoredCapabilities
} from "./resolve"
import {
	hostDeclaredCapabilities,
	type HostDeclaredCapabilities
} from "$lib/shared/connections/hostCapabilities"

/**
 * A connection row with its model's answers merged in.
 *
 * A `SelectConnection` and not a new shape, for the reason the header gives —
 * plus the fields the endpoint has no column for. `model` is one of them now:
 * the endpoint carries no identifier since the per-connection default went
 * away, so the merge writes it — the model's identifier, or null when no
 * model was merged — and every adapter keeps reading `connection.model`
 * without having moved.
 */
export type ResolvedConnectionPair = SelectConnection & {
	/**
	 * What the adapter sends. Written by the merge from the model row, or
	 * null when no model was merged. Never read off the endpoint.
	 */
	model: string | null
	/** Which model row this pair resolved to, or null when the endpoint has none. */
	connectionModelId: number | null
	/** Its display name, for a queue label and a receipt. Never the identifier. */
	connectionModelName: string | null
	/**
	 * The model's own context window, or null for "the sampling config decides".
	 *
	 * Read at exactly one place (`dispatchStep`) and deliberately not layered
	 * into the summarizer or the graph builder — both pin 4096 outright and
	 * their own comments say widening them is a decision for those contracts,
	 * not a side effect of a schema change.
	 */
	contextWindow: number | null
	/**
	 * What the model is FOR (`text-gen`, `embeddings`, `image-gen`), as the
	 * host said, or null when it said nothing. `capabilityRefusal` refuses a
	 * transform of another modality — see `modelModalityAllows`.
	 */
	connectionModelModality: string | null
	/**
	 * What the model's own HOST declared, as capability switches — the layer
	 * between the preset and the probe (`hostDeclaredCapabilities`). Null when
	 * no model was merged or its host said nothing. Carried on the pair so every
	 * re-resolution of it (`resolveWireMode`, the cache rebuilt below) sees it.
	 */
	hostCapabilities: HostDeclaredCapabilities | null
}

/**
 * The endpoint's models, in display order.
 *
 * `sort_order` then `name`, which is the order every picker shows. Ordering
 * in the query rather than at each caller: three callers sorting three ways
 * is three different "first models".
 */
export async function connectionModels(
	db: Db,
	connectionId: number
): Promise<SelectConnectionModel[]> {
	return await db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, connectionId))
		.orderBy(
			asc(schema.connectionModels.sortOrder),
			asc(schema.connectionModels.name),
			asc(schema.connectionModels.id)
		)
}

/**
 * Every model on the instance, in the same display order — for the list,
 * which renders every endpoint with its models in one message.
 */
export async function allConnectionModels(
	db: Db
): Promise<SelectConnectionModel[]> {
	return await db
		.select()
		.from(schema.connectionModels)
		.orderBy(
			asc(schema.connectionModels.sortOrder),
			asc(schema.connectionModels.name),
			asc(schema.connectionModels.id)
		)
}

/** One model row by id, or undefined. */
export async function connectionModelById(
	db: Db,
	id: number
): Promise<SelectConnectionModel | undefined> {
	const [row] = await db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.id, id))
		.limit(1)
	return row
}

/**
 * The two capability columns, layered — endpoint first, model over it.
 *
 * The DURABLE halves layer; the cache is rebuilt rather than merged, because a
 * cache of two things merged from two caches is a third thing that can be stale
 * in a new way. Rebuilding is a handful of object iterations over the static
 * manifest (`resolveConnectionCapabilities`), which is the same live-resolution
 * argument `resolveWireMode` makes and for the same payoff: immune to a cache
 * written by a build that had never heard of the key.
 *
 * ## Which layer wins, per half
 *
 * - `overrides` merge PER KEY, model over endpoint. A person switching vision
 *   off for one checkpoint must not have to restate every endpoint-level switch
 *   to do it, and an endpoint-level switch must keep applying to the models
 *   nobody has spoken about.
 * - `probe` REPLACES rather than merging, and only when the model has one. A
 *   probe answers for a model that was loaded at the time; the endpoint's probe
 *   answered for whatever was loaded when the endpoint was tested, which before
 *   the split was the endpoint's one model and after it is nobody in
 *   particular. Merging the two would let a vision-capable checkpoint's answer
 *   leak onto a text-only sibling — which is the exact defect the per-model
 *   column exists to close.
 */
export function layerCapabilities(
	endpoint: { capabilities?: Record<string, unknown> | null },
	model?: { capabilities?: Record<string, unknown> | null } | null
): StoredCapabilities {
	const base = capabilityColumn(endpoint)
	if (!model) return base
	const over = capabilityColumn(model)
	const overrides: CapabilityOverrides | undefined =
		base.overrides || over.overrides
			? { ...(base.overrides ?? {}), ...(over.overrides ?? {}) }
			: undefined
	return {
		...(base.resolved ? { resolved: base.resolved } : {}),
		...(overrides ? { overrides } : {}),
		...((over.probe ?? base.probe)
			? { probe: over.probe ?? base.probe }
			: {})
	}
}

/**
 * The endpoint row with the model's answers substituted in — the PAIR.
 *
 * Pure, and returns a NEW object rather than mutating: the `withWireMode` /
 * `withCompletionTemplate` precedent, so a caller holding the row it passed in
 * still holds a plain row.
 *
 * A null `model` is not a failure, but it is incomplete: the merged pair
 * carries a null identifier, and resolution refuses it with the fix attached
 * rather than guessing a row.
 */
export function mergeEndpointModel(
	endpoint: SelectConnection,
	model?: SelectConnectionModel | null
): ResolvedConnectionPair {
	if (!model)
		return {
			...endpoint,
			model: null,
			connectionModelId: null,
			connectionModelName: null,
			contextWindow: null,
			connectionModelModality: null,
			hostCapabilities: null
		}
	const capabilities = layerCapabilities(endpoint, model)
	const merged: ResolvedConnectionPair = {
		...endpoint,
		// THE substitution. Everything downstream that says `connection.model`
		// — seven adapters, the image request builder, the managed loader — is
		// reading this, and reading it correctly, without having moved.
		model: model.model,
		// `??` and not `||` on all three: an override is present or it is not,
		// and `0` / `""` are values a person can mean. `token_counter` in
		// particular has a non-null default on the endpoint, so `||` would let
		// the endpoint's value through for a model that had deliberately been
		// set to something falsy.
		promptFormat: model.promptFormat ?? endpoint.promptFormat,
		tokenCounter: model.tokenCounter ?? endpoint.tokenCounter,
		/**
		 * The adapter's bag, model over endpoint, SHALLOW.
		 *
		 * ⚠ Shallow on purpose. `extra_json` is the adapter's private state and
		 * core does not know its shape; a deep merge would have to decide what
		 * an array means, and core deciding that is core acquiring an opinion
		 * about a structure it has no business reading. The encrypted `apiKey`
		 * lives on the ENDPOINT and the model sockets refuse the key outright,
		 * so this cannot shadow it with a plaintext one.
		 */
		extraJson: {
			...(endpoint.extraJson ?? {}),
			...(model.extraJson ?? {})
		},
		capabilities: capabilities as Record<string, unknown>,
		connectionModelId: model.id,
		connectionModelName: model.name,
		contextWindow: model.contextWindow ?? null,
		connectionModelModality: model.modality ?? null,
		// The model's facts and launch options, read as switches. Resolved
		// live like the rest of the pair, so a host that starts or stops
		// listing `image` moves the answer on its next sync, with no cache.
		hostCapabilities:
			hostDeclaredCapabilities({
				facts: model.facts as Record<string, unknown> | null,
				extraJson: model.extraJson
			}) ?? null
	}
	// The cache, rebuilt from the LAYERED durable halves — see
	// `layerCapabilities`. Written onto the merged object only; neither stored
	// row is touched, because a resolution is a read.
	merged.capabilities = {
		...capabilities,
		resolved: resolveConnectionCapabilities(merged as any)
	} as Record<string, unknown>
	return merged
}

/**
 * What the pair's capabilities come out as. A convenience over the merge, for
 * the two callers that want the SET and not the row.
 */
export function pairCapabilities(
	endpoint: SelectConnection,
	model?: SelectConnectionModel | null
): CapabilitySet {
	return resolveConnectionCapabilities(
		mergeEndpointModel(endpoint, model) as any
	)
}

/**
 * The endpoint names a model it can send, one way or another.
 *
 * The shared spine of the paths that create a connection ALREADY knowing
 * which model it is for: `connections:create` with a `model` field (every
 * connection form), `ollama:connectModel`, and `koboldcpp:connectModel`. Each
 * gets a real row, spelled once here rather than three times with three sets
 * of edge cases. It ensures a ROW, nothing more — connections have no default
 * model, so nothing here marks one and nothing mirrors one anywhere.
 *
 * Idempotent by the (connection_id, model) unique index: called twice with the
 * same identifier it returns what is already there rather than inserting a
 * duplicate — which is what makes it safe on the managed flows, whose whole
 * pattern is "find or create the connection for this gguf".
 *
 * A blank identifier is a no-op and not an error. `''` reaches here from a form
 * field somebody cleared, the check constraint would refuse it, and refusing the
 * whole save because the model box is empty would stop a person from creating an
 * endpoint before they know what is on it.
 */
export async function ensureConnectionModel(
	db: Db,
	connectionId: number,
	model: string | null | undefined,
	name?: string | null,
	/**
	 * What the model is for, when the caller KNOWS — the managed KoboldCPP's Use-for
	 * handlers read it off the same registry its listing does. Written on
	 * insert, and onto an existing row that says otherwise, so the default
	 * registered right after is judged by the right modality rather than
	 * waiting for the next sync.
	 */
	modality?: string | null
): Promise<SelectConnectionModel | undefined> {
	const identifier = (model ?? "").trim()
	if (!identifier) return undefined
	const [existing] = await db
		.select()
		.from(schema.connectionModels)
		.where(
			and(
				eq(schema.connectionModels.connectionId, connectionId),
				eq(schema.connectionModels.model, identifier)
			)
		)
		.limit(1)
	if (existing) {
		if (!modality || existing.modality === modality) return existing
		const [updated] = await db
			.update(schema.connectionModels)
			.set({ modality })
			.where(eq(schema.connectionModels.id, existing.id))
			.returning()
		return updated
	}
	const [row] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId,
			model: identifier,
			name: (name ?? "").trim() || identifier,
			enabled: true,
			modality: modality ?? null
		})
		.returning()
	return row
}

/**
 * Add models the probe listed, without disturbing what is already there.
 *
 * ⚠ A probed list is NEVER auto-persisted — this runs only when somebody presses
 * "Add all". `listModels` on a large OpenAI-compatible host returns a hundred
 * ids including embeddings, moderation and whisper endpoints, and writing those
 * as rows would fill every picker on the instance with things nobody can chat
 * to. Which of them are worth keeping is a person's judgement, and the endpoint
 * has no way to make it.
 *
 * Returns how many rows it actually created, which is what the socket answers
 * with — "added 3 of 40" is the sentence that tells somebody the other 37 were
 * already there rather than silently dropped.
 */
export async function importProbedModels(
	db: Db,
	connectionId: number,
	models: { model: string; name?: string | null }[]
): Promise<{ added: number; skipped: number }> {
	let added = 0
	let skipped = 0
	for (const m of models) {
		const identifier = (m.model ?? "").trim()
		if (!identifier) {
			skipped++
			continue
		}
		const before = await db
			.select({ id: schema.connectionModels.id })
			.from(schema.connectionModels)
			.where(
				and(
					eq(schema.connectionModels.connectionId, connectionId),
					eq(schema.connectionModels.model, identifier)
				)
			)
			.limit(1)
		if (before.length) {
			skipped++
			continue
		}
		await ensureConnectionModel(db, connectionId, identifier, m.name)
		added++
	}
	return { added, skipped }
}

/**
 * Which endpoints of these types serve a model with this identifier.
 *
 * ## Why this exists at all
 *
 * "Is there already a connection for this gguf?" is asked three times — Ollama's
 * connect-model, KoboldCPP's, and its image sibling — and before 0114 all three
 * asked it as `WHERE connections.model = $1`, because an endpoint named exactly
 * one model. It can now name several, so that predicate answers about the
 * MIRROR: a host serving four ggufs would report "no connection for this one"
 * while sitting right there with it in its model list, and each of the three
 * would helpfully create a duplicate endpoint.
 *
 * Ids and not rows, so the callers keep their own `findFirst` with its own
 * columns — one query shape here, four different projections there.
 */
export async function endpointIdsServingModel(
	db: Db,
	model: string,
	types: string[]
): Promise<number[]> {
	if (!model || !types.length) return []
	const rows = await db
		.select({ id: schema.connections.id })
		.from(schema.connections)
		.innerJoin(
			schema.connectionModels,
			eq(schema.connectionModels.connectionId, schema.connections.id)
		)
		.where(
			and(
				inArray(schema.connections.type, types),
				eq(schema.connectionModels.model, model)
			)
		)
	return [...new Set(rows.map((r) => r.id))]
}

/**
 * Forget a model that is no longer on disk, everywhere it is named.
 *
 * It deletes the MODEL rows and never an endpoint. Every caller is a runtime
 * with ONE endpoint for the whole host or process — an Ollama per host, the
 * managed KoboldCPP — so an endpoint left with no models is that runtime with
 * nothing downloaded, which is a state to show ("No models yet"), not a
 * connection to remove. Removing it would take the runtime's view, its
 * settings and every registration naming it down with the last model.
 *
 * A registration that named a deleted model keeps its endpoint and loses the
 * model (`connection_defaults.connection_model_id` is ON DELETE SET NULL), and
 * resolves as incomplete, with the fix attached.
 */
export async function forgetModelEverywhere(
	db: Db,
	model: string,
	types: string[]
): Promise<void> {
	const ids = await endpointIdsServingModel(db, model, types)
	if (!ids.length) return
	await db
		.delete(schema.connectionModels)
		.where(
			and(
				inArray(schema.connectionModels.connectionId, ids),
				eq(schema.connectionModels.model, model)
			)
		)
}
