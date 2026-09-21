/**
 * Reconciling an endpoint's model rows against what its service lists.
 *
 * ## The ruling this file is
 *
 * > "Automatically populate available models from API when available. If a
 * > model known to Serene Pub disappears on an API refresh, make it
 * > unavailable globally and make the issue apparent wherever the user sees
 * > it." — 2026-09-14
 *
 * Before this, a probed list was never persisted: a person pressed "Add N
 * from the last test" and chose. That kept a hundred OpenAI ids out of the
 * chat picker, at the cost of every endpoint starting empty and every new
 * model on a host being invisible until somebody remembered to press a
 * button. The ruling trades the other way — the list IS the endpoint's
 * models, and a model a person does not want is switched off rather than
 * never added. What the old design protected against (junk rows) is now a
 * per-row `enabled` decision; what it could not express (a model that
 * silently vanished from the host) is now a first-class state.
 *
 * ## One rule, applied to every endpoint the same way
 *
 * A sync takes ONE listing and does three things to the endpoint's rows:
 *
 *   1. every listed identifier without a row gets one, enabled, named as the
 *      service named it;
 *   2. every row the listing names again has `missing_since` cleared;
 *   3. every row the listing does NOT name has `missing_since` set — to now,
 *      or left at its earlier value, so the sidebar can say since when.
 *
 * A listing that FAILED does none of the three. It records the error on the
 * endpoint and stops. An unreachable host is a fact about the host, not about
 * any model, and marking a whole endpoint missing because it was asleep would
 * be exactly the silent unconfiguring `missing_since` exists to make visible.
 * This is also why the two KoboldCPP adapters answer with an ERROR when their
 * admin API cannot be reached, rather than with an empty list.
 *
 * There is deliberately no per-type policy in here about which endpoints may
 * gain rows. The managed KoboldCPP type lists the ggufs in the Manager's
 * models directory (never koboldcpp's --admindir, which is the binary's);
 * Ollama lists what it has pulled; the local ONNX backends list their
 * catalogue plus the registry. Those are all "what this endpoint can serve",
 * and an endpoint that serves it should have a row for it. What differs per
 * type is where a person goes to ADD or REMOVE one (the manager, a download,
 * a hand-typed id), and that is a question for the client's
 * `modelManagement` table, not for the sync.
 *
 * ## ⚠ Never imported by the resolver
 *
 * This module loads adapter modules (through the lazy loaders) to ask them
 * for a listing. `models.ts` and `capabilityTarget.ts` must not import it —
 * see the ⚠ in `models.ts`'s header for why the resolver's import graph must
 * stay adapter-free.
 */

import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	normalizeProbedModels,
	type ProbedModel
} from "$lib/shared/connections/probedModels"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { getImageAdapter } from "../utils/getImageAdapter"
import { getEmbeddingAdapter } from "../utils/getEmbeddingAdapter"
import { getNerAdapter } from "../utils/getNerAdapter"
import { connectionModels } from "./models"

/** What an adapter's `listModels` answers, in the shape every family shares. */
export interface ModelListing {
	models: unknown[]
	error?: string | null
}

/** What one sync did to one endpoint. */
export interface ModelSyncResult {
	connectionId: number
	/**
	 * Rows this sync actually CREATED.
	 *
	 * Counted from the insert's own `returning()`, not from what it offered: a
	 * concurrent sync of the same endpoint may have written some of them first,
	 * and claiming those would report work this run did not do.
	 */
	added: number
	/** Rows that were missing and the listing named again. */
	restored: number
	/** Rows missing AFTER this sync — newly and still. */
	missing: number
	/** Identifiers the listing named, after normalisation. */
	listed: number
	/** The listing failed; nothing on any row changed. */
	error: string | null
	/** When this ran, as the row now records it. */
	syncedAt: string
}

/**
 * How old a listing may be before an automatic sync re-asks the host.
 *
 * Automatic syncs run whenever the sidebar opens and whenever a connection or
 * model view opens, so without a floor an admin scrolling the index would hit
 * every cloud API on the instance every few seconds. Ten minutes is long
 * enough that browsing costs nothing and short enough that a model pulled on
 * the host shows up before anyone thinks to press Refresh — which is always
 * available and always forces.
 */
export const MODEL_SYNC_STALE_MS = 10 * 60 * 1000

/**
 * How long one listing may take before the sync gives up on it.
 *
 * A sync-all runs every endpoint concurrently, so a single dead host with no
 * timeout of its own (the Ollama client has none) would hold the whole
 * response open. Fifteen seconds is longer than any live host needs and short
 * enough that the index does not look frozen.
 */
export const MODEL_SYNC_TIMEOUT_MS = 15_000

/**
 * Resolve a connection's test/list functions, picking the adapter FAMILY by
 * the type's declared modality.
 *
 * All four families export `testConnection`/`listModels` with the same call
 * shape, which is what lets every caller destructure the two the same way and
 * is why this is one switch rather than a branch at each call site.
 *
 * ⚠ Keyed on `modalityOf`, not on a chain of `isImage`-shaped predicates. The
 * old form was `isImage(type) ? image : text`, which files an embeddings type
 * as TEXT — so a test on an embedding endpoint would load `OpenAIChatAdapter`
 * and probe `/v1/models` for a chat model.
 */
export async function adapterIO(type: string) {
	switch (CONNECTION_TYPE.modalityOf(type)) {
		case "image-gen":
			return await getImageAdapter(type)
		case "embeddings":
			return await getEmbeddingAdapter(type)
		case "ner":
			return await getNerAdapter(type)
		default:
			return await getConnectionAdapter(type)
	}
}

/**
 * Apply ONE listing to ONE endpoint's rows. Pure database work: the listing
 * is handed in, so a test can state exactly what the host said.
 *
 * Idempotent by construction — running the same listing twice adds nothing
 * the second time, and a `missing_since` already set is left at its first
 * value rather than bumped to now.
 */
export async function syncConnectionModels(
	db: Db,
	connectionId: number,
	listing: ModelListing,
	now: Date = new Date()
): Promise<ModelSyncResult> {
	const rows = await connectionModels(db, connectionId)
	const missingBefore = rows.filter((r) => r.missingSince != null).length

	if (listing.error) {
		await db
			.update(schema.connections)
			.set({ modelsSyncedAt: now, modelsSyncError: listing.error })
			.where(eq(schema.connections.id, connectionId))
		return {
			connectionId,
			added: 0,
			restored: 0,
			missing: missingBefore,
			listed: 0,
			error: listing.error,
			syncedAt: now.toISOString()
		}
	}

	const listed = normalizeProbedModels(listing.models)
	const listedIds = new Set(listed.map((m) => m.model))

	// ⚠ `have` is spent twice: it starts as the identifiers this endpoint
	// already has rows for, and each identifier written is added to it. So one
	// listing that names a model twice — a merged catalogue, a host answering
	// the same id from two pages — contributes ONE row rather than a pair the
	// unique index would refuse. `normalizeProbedModels` already de-duplicates
	// on the way in; this is the same invariant held where the write happens,
	// because that is where breaking it costs a whole sync.
	const have = new Set(rows.map((r) => r.model))
	const toInsert: ProbedModel[] = []
	for (const m of listed) {
		if (have.has(m.model)) continue
		have.add(m.model)
		toInsert.push(m)
	}

	let added = 0
	if (toInsert.length) {
		/**
		 * ⚠ `onConflictDoNothing` on the endpoint/model index, and `added` is
		 * counted from what came BACK rather than from what was offered.
		 *
		 * Two syncs of one endpoint overlap for entirely ordinary reasons:
		 * `connections:syncModels` with no id syncs every endpoint
		 * concurrently while the sidebar's own per-endpoint sync runs beside
		 * it, and the window between reading `rows` and writing is as wide as
		 * the listing is slow. On a fresh instance both read zero rows and
		 * both then insert the same identifiers. Without the conflict clause
		 * the loser of that race dies on the unique index — "duplicate key
		 * value violates unique constraint connection_models_endpoint_model",
		 * an endpoint left unsynced and an error on the screen for a race
		 * whose correct outcome is "the rows are there".
		 *
		 * Targeted at that index and nothing else: an empty identifier still
		 * has to fail loudly against `connection_models_identifiers_check`,
		 * because that one is a bug in a caller rather than a lost race.
		 */
		const inserted = await db
			.insert(schema.connectionModels)
			.values(
				toInsert.map((m) => ({
					connectionId,
					model: m.model,
					name: m.name || m.model,
					enabled: true
				}))
			)
			.onConflictDoNothing({
				target: [
					schema.connectionModels.connectionId,
					schema.connectionModels.model
				]
			})
			.returning({ id: schema.connectionModels.id })
		added = inserted.length
	}

	const toRestore = rows
		.filter((r) => listedIds.has(r.model) && r.missingSince != null)
		.map((r) => r.id)
	if (toRestore.length)
		await db
			.update(schema.connectionModels)
			.set({ missingSince: null })
			.where(inArray(schema.connectionModels.id, toRestore))

	// A row nobody has renamed reads as its bare identifier. When the
	// service offers a friendlier name for it — a type's default model
	// ensured at create, before any listing ("claude-sonnet-4-5" against
	// the catalogue's "Claude Sonnet 4.5") — take it. A name a person
	// typed differs from the identifier and is never touched.
	const listedName = new Map(listed.map((m) => [m.model, m.name]))
	for (const r of rows) {
		const offered = listedName.get(r.model)
		if (!offered || offered === r.model || r.name !== r.model) continue
		await db
			.update(schema.connectionModels)
			.set({ name: offered })
			.where(eq(schema.connectionModels.id, r.id))
	}

	const toMark = rows
		.filter((r) => !listedIds.has(r.model) && r.missingSince == null)
		.map((r) => r.id)
	if (toMark.length)
		await db
			.update(schema.connectionModels)
			.set({ missingSince: now })
			.where(inArray(schema.connectionModels.id, toMark))

	await db
		.update(schema.connections)
		.set({ modelsSyncedAt: now, modelsSyncError: null })
		.where(eq(schema.connections.id, connectionId))

	const stillMissing = rows.filter(
		(r) => !listedIds.has(r.model) && r.missingSince != null
	).length

	return {
		connectionId,
		added,
		restored: toRestore.length,
		missing: stillMissing + toMark.length,
		listed: listed.length,
		error: null,
		syncedAt: now.toISOString()
	}
}

/** Ask the endpoint's adapter for its listing, bounded by the sync timeout. */
async function fetchListing(
	connection: SelectConnection
): Promise<ModelListing> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<ModelListing>((resolve) => {
		timer = setTimeout(
			() =>
				resolve({
					models: [],
					error: `The host did not answer within ${Math.round(MODEL_SYNC_TIMEOUT_MS / 1000)} seconds.`
				}),
			MODEL_SYNC_TIMEOUT_MS
		)
	})
	try {
		const { listModels } = await adapterIO(connection.type)
		const listing = (await Promise.race([
			listModels(connection as any),
			timeout
		])) as ModelListing
		return {
			models: Array.isArray(listing?.models) ? listing.models : [],
			error: listing?.error ?? null
		}
	} catch (e: any) {
		return { models: [], error: e?.message ?? String(e) }
	} finally {
		if (timer) clearTimeout(timer)
	}
}

export interface SyncOptions {
	/** Re-ask the host even when the last listing is fresh. */
	force?: boolean
	now?: Date
}

/**
 * Sync one endpoint from its adapter. Answers `null` when the endpoint does
 * not exist, or when its listing is fresh and the sync was not forced — the
 * caller then has nothing to broadcast.
 *
 * The listing rides back beside the result for the one caller that still
 * shows it transiently (`connections:refreshModels`, for the document-view
 * forms).
 */
export async function syncConnectionModelsById(
	db: Db,
	connectionId: number,
	opts: SyncOptions = {}
): Promise<{ result: ModelSyncResult; listing: ModelListing } | null> {
	const [connection] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, connectionId))
		.limit(1)
	if (!connection) return null
	const now = opts.now ?? new Date()
	if (
		!opts.force &&
		connection.modelsSyncedAt &&
		now.getTime() - connection.modelsSyncedAt.getTime() <
			MODEL_SYNC_STALE_MS
	)
		return null
	const listing = await fetchListing(connection)
	const result = await syncConnectionModels(db, connectionId, listing, now)
	return { result, listing }
}

/**
 * Sync every endpoint — or every endpoint of the given types — concurrently.
 *
 * Concurrent because the slow case is a dead host, and ten of them in series
 * is ten timeouts end to end. `allSettled` so one adapter throwing (an
 * unsupported type, say) cannot take the rest of the instance's listings down
 * with it; such a failure is recorded on its own row like any other error.
 */
export async function syncManyConnectionModels(
	db: Db,
	opts: SyncOptions & { types?: string[] } = {}
): Promise<ModelSyncResult[]> {
	const rows = await db
		.select({ id: schema.connections.id })
		.from(schema.connections)
		.where(
			opts.types?.length
				? inArray(schema.connections.type, opts.types)
				: undefined
		)
	const settled = await Promise.allSettled(
		rows.map((r) => syncConnectionModelsById(db, r.id, opts))
	)
	const out: ModelSyncResult[] = []
	settled.forEach((s, i) => {
		if (s.status === "fulfilled") {
			if (s.value) out.push(s.value.result)
			return
		}
		const message = s.reason?.message ?? String(s.reason)
		console.error(
			`[modelSync] connection ${rows[i].id} failed to sync:`,
			s.reason
		)
		out.push({
			connectionId: rows[i].id,
			added: 0,
			restored: 0,
			missing: 0,
			listed: 0,
			error: message,
			syncedAt: (opts.now ?? new Date()).toISOString()
		})
	})
	return out
}
