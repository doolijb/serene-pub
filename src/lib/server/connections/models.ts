/**
 * The MODEL half of an (endpoint, model) pair — reading it, merging it, and the
 * one column that mirrors it.
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
 * provider slot, a session override — is a PAIR, and a pair that names only the
 * endpoint means "its default model".
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

import { and, asc, count, eq, inArray, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { CapabilityOverrides, CapabilitySet } from "@serene-pub/sdk"
import {
	capabilityColumn,
	resolveConnectionCapabilities,
	type StoredCapabilities
} from "./resolve"

/**
 * A connection row with its model's answers merged in.
 *
 * A `SelectConnection` and not a new shape, for the reason the header gives —
 * plus three fields the endpoint has no column for, which is exactly the set
 * that only exists once a pair has been formed.
 */
export type ResolvedConnectionPair = SelectConnection & {
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
}

/**
 * The models on an endpoint, in display order.
 *
 * `sort_order` then `name`, which is the order every picker shows and the order
 * `is_default` is chosen from when a write has to pick one. Ordering in the
 * query rather than at each caller: three callers sorting three ways is three
 * different "first model", and one of them is what a fallback would pick.
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
 * The endpoint's default model, or undefined when it has none.
 *
 * ⚠ It does NOT fall back to "the first one". An endpoint with models but no
 * default is a state the writers below cannot produce — every path that creates
 * a model marks one — so reaching for a fallback here would be inventing an
 * answer for a state that means the data is wrong, and inventing it silently.
 * The pair resolver treats "no default" the same way it treats "no models": the
 * endpoint's own legacy column, which is the honest last word.
 */
export async function defaultConnectionModel(
	db: Db,
	connectionId: number
): Promise<SelectConnectionModel | undefined> {
	const [row] = await db
		.select()
		.from(schema.connectionModels)
		.where(
			and(
				eq(schema.connectionModels.connectionId, connectionId),
				eq(schema.connectionModels.isDefault, true)
			)
		)
		.limit(1)
	return row
}

/**
 * Every endpoint's default model, in one query, keyed by connection id.
 *
 * For the two LIST readers — the config panel's choice set and the pipeline
 * world's connection descriptors — each of which renders every connection on the
 * instance and used to take the model straight off the endpoint's column. One
 * query rather than a lookup per row: the panel builds this set once and reads
 * it against every slot, which is the one place a per-row query would cost most
 * (the same argument the cached `resolved` capability set makes).
 *
 * ⚠ Defaults only. A picker showing every model of every endpoint as a top-level
 * row is a different screen — the models live under their endpoint, and what a
 * connection row needs to say here is which one it means when nobody has said.
 */
export async function defaultModelsByConnection(
	db: Db
): Promise<Map<number, SelectConnectionModel>> {
	const rows = await db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.isDefault, true))
	return new Map(rows.map((r) => [r.connectionId, r]))
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
 * A null `model` is not a failure. An endpoint whose `model` column was never
 * filled in has no model rows, and the pair is then the endpoint alone — which
 * is precisely what it was before 0114, so nothing that worked stops working.
 */
export function mergeEndpointModel(
	endpoint: SelectConnection,
	model?: SelectConnectionModel | null
): ResolvedConnectionPair {
	if (!model)
		return {
			...endpoint,
			connectionModelId: null,
			connectionModelName: null,
			contextWindow: null
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
		contextWindow: model.contextWindow ?? null
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
 * Keep `connections.model` in step with the endpoint's default model.
 *
 * ⚠ THE ONLY WRITER of that column outside the migration, and the reason its
 * docblock can say "read by nothing after 0114". The column survives the version
 * freeze so a downgrade, a backup restored into an older build, and the two
 * managed flows that genuinely do mean "one connection, one model" all keep
 * finding the string where it has always been.
 *
 * It writes NULL when the endpoint has no default model, which is the honest
 * answer and the pre-0114 state for a connection nobody finished setting up.
 *
 * Called after every write that can move the default: creating the first model,
 * deleting the current default, and `setDefaultConnectionModel`. Not called on a
 * plain rename — the mirror carries the IDENTIFIER, and a rename does not touch
 * it.
 */
export async function mirrorDefaultModel(
	db: Db,
	connectionId: number
): Promise<void> {
	const current = await defaultConnectionModel(db, connectionId)
	await db
		.update(schema.connections)
		.set({ model: current?.model ?? null })
		.where(eq(schema.connections.id, connectionId))
}

/**
 * Make one model the endpoint's default, in two statements.
 *
 * ⚠ Two statements and not one `SET is_default = (id = $1)`. The partial unique
 * index is checked per tuple as the update walks the table, so a single
 * statement that promotes one row before demoting the other fails on an index
 * whose whole job is to make that state impossible — and which row is written
 * first is the planner's choice, so it would fail intermittently. Clear, then
 * set. In a transaction, so a crash between them cannot leave an endpoint with
 * no default at all.
 */
export async function setDefaultConnectionModel(
	db: Db,
	connectionId: number,
	modelId: number
): Promise<void> {
	await (db as any).transaction(async (tx: Db) => {
		await tx
			.update(schema.connectionModels)
			.set({ isDefault: false })
			.where(
				and(
					eq(schema.connectionModels.connectionId, connectionId),
					eq(schema.connectionModels.isDefault, true),
					ne(schema.connectionModels.id, modelId)
				)
			)
		await tx
			.update(schema.connectionModels)
			.set({ isDefault: true })
			.where(
				and(
					eq(schema.connectionModels.id, modelId),
					eq(schema.connectionModels.connectionId, connectionId)
				)
			)
	})
	await mirrorDefaultModel(db, connectionId)
}

/**
 * The endpoint has a default model naming `model`, one way or another.
 *
 * The shared spine of the three paths that create a connection ALREADY knowing
 * which model it is for: `connections:create` with a `model` field (every
 * connection form), `ollama:connectModel`, and `koboldcpp:connectModel`. Each
 * used to write the string onto the row and stop; each now gets a real pair,
 * spelled once here rather than three times with three sets of edge cases.
 *
 * Idempotent by the (connection_id, model) unique index: called twice with the
 * same identifier it promotes what is already there rather than inserting a
 * duplicate — which is what makes it safe on the managed flows, whose whole
 * pattern is "find or create the connection for this gguf".
 *
 * A blank identifier is a no-op and not an error. `''` reaches here from a form
 * field somebody cleared, the check constraint would refuse it, and refusing the
 * whole save because the model box is empty would stop a person from creating an
 * endpoint before they know what is on it.
 */
export async function ensureDefaultModel(
	db: Db,
	connectionId: number,
	model: string | null | undefined,
	name?: string | null
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
		if (!existing.isDefault)
			await setDefaultConnectionModel(db, connectionId, existing.id)
		else await mirrorDefaultModel(db, connectionId)
		return (await connectionModelById(db, existing.id)) ?? existing
	}
	// Whether this becomes the default: only if nothing else already is. The
	// first model on an endpoint has to be, or a pair naming just the endpoint
	// resolves to nothing; a later one must NOT silently steal the star from a
	// model somebody chose.
	const current = await defaultConnectionModel(db, connectionId)
	const [row] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId,
			model: identifier,
			name: (name ?? "").trim() || identifier,
			isDefault: !current,
			enabled: true
		})
		.returning()
	if (!current) await mirrorDefaultModel(db, connectionId)
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
		await ensureDefaultModel(db, connectionId, identifier, m.name)
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
 * ## ⚠ It deletes the MODEL, and the endpoint only if that empties it
 *
 * The managed delete paths used to run `DELETE FROM connections WHERE model =
 * $1`, and their own comment gave the reason: "a connection names exactly one
 * model". After 0114 that sentence is false, and the statement it justified
 * became a way to delete an endpoint serving four other ggufs because one of
 * them was removed from the Manager's directory.
 *
 * So: drop the model rows, then drop the endpoints that are left with nothing.
 * For every row the managed flows actually create — one connection, one model —
 * that is byte-identical to the old behaviour, including the
 * `connection_defaults` release the FK cascade performs on the way out. For a
 * connection somebody added a second model to by hand it is the answer they
 * would expect and the old statement could not give.
 *
 * The survivors are re-mirrored, because deleting a model can move a default and
 * the mirror is only honest if every path that can move one says so.
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
	const remaining = await db
		.select({
			connectionId: schema.connectionModels.connectionId,
			n: count()
		})
		.from(schema.connectionModels)
		.where(inArray(schema.connectionModels.connectionId, ids))
		.groupBy(schema.connectionModels.connectionId)
	const survivors = new Set(remaining.map((r) => r.connectionId))
	const emptied = ids.filter((id) => !survivors.has(id))
	if (emptied.length)
		await db
			.delete(schema.connections)
			.where(inArray(schema.connections.id, emptied))
	for (const id of survivors) {
		// Deleting the default leaves the endpoint with none, which
		// `defaultConnectionModel` refuses to guess at — so promote the first in
		// display order, which is the order every picker shows and therefore the
		// one a person would have called "the top one".
		const current = await defaultConnectionModel(db, id)
		if (!current) {
			const [first] = await connectionModels(db, id)
			if (first) await setDefaultConnectionModel(db, id, first.id)
			else await mirrorDefaultModel(db, id)
		} else await mirrorDefaultModel(db, id)
	}
}
