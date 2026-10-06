/**
 * What moving the embedding star costs, and what it does.
 *
 * ## The consequence lives with the star, not with the screens
 *
 * An embedding endpoint is chosen the way every other connection is chosen, with
 * `connections:setDefault`. Moving THAT star has to stop the queue, unload the
 * backend, drop the stale vectors, forget the failure and cooldown state, and
 * start again — because every stored vector came from the model the star named a
 * moment ago. Those five steps live here and the handler calls them, so a screen
 * that can move a star cannot forget one.
 *
 * ## Keyed on the model IDENTITY, never on the connection id
 *
 * Two rows can name the same endpoint and the same model, and they produce
 * byte-identical vectors. Re-indexing on an id change would be hours of work to
 * arrive exactly where it started — and pressing the star twice on one row (it
 * is a button; people do) must be a no-op. `EmbeddingTarget.modelId` is the same
 * string that is written into every embedded row's `embedding_model` column, so
 * comparing it is comparing the only thing that matters.
 *
 * ## Unstarring does not destroy an index
 *
 * Turning embeddings off is not a decision to throw the index away: unstarring
 * stops the queue and leaves every row exactly where it is, so starring the same
 * model again costs nothing. The clear happens only when there is a NEW target
 * whose identity differs from the model the stored vectors came from.
 *
 * ⚠ **Compared against the vectors, not against the star before the write**
 * (plan A10). After an unstar the star before is nothing, so "did the star's
 * model change?" answers yes to a re-star of the very model every vector was
 * made by — and wiped a paid index to rebuild it identically. The vectors carry
 * their model; that is the fact the clear is about.
 *
 * ## Every door that moves the star
 *
 * The star moves whenever what it RESOLVES to moves, and pressing the star is
 * only one way: editing the starred connection's address or type, renaming its
 * model's identifier, Admin → Defaults, deleting the connection or the model.
 * Each of those writes goes through `withStarConsequences`
 * (`connections/starConsequences.ts`), which reads the identity before and
 * hands it here after.
 *
 * A cosmetic respelling of the address — a trailing slash, a capital, a
 * written-out default port — is the same model at the same address: its
 * vectors are re-stamped (`restampEquivalentVectors`), never re-embedded.
 */

import {
	isManagedKoboldCppModelId,
	resolveEmbeddingPair,
	resolveEmbeddingTarget
} from "./target"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
import {
	restampEquivalentVectors,
	clearEmbeddedVectors,
	countEmbeddedRows,
	embeddedBreakdown,
	keptModelIds,
	type EmbeddedRowFilter
} from "./vectors"
import { unloadEmbeddingModel } from "./index"

export interface EmbeddingStarChange {
	/** True when stored vectors from another model were cleared to rebuild. */
	reindexed: boolean
	/** How many rows were cleared. Zero on an unstar, on a no-op, and on a
	 *  re-star of the model the vectors were made by. */
	cleared: number
	/** How many vectors were re-stamped from another spelling of the same
	 *  model's identity (`restampEquivalentVectors`) — kept, not re-embedded. */
	restamped: number
	/** The identity now in force, or null with no star. */
	modelId: string | null
}

/**
 * What the star currently resolves to, as the identity to compare against.
 *
 * Read BEFORE the write by anything that is about to move the star; the
 * comparison is the whole of the decision below.
 */
export async function currentEmbeddingModelId(db: Db): Promise<string | null> {
	return (await resolveEmbeddingTarget(db))?.modelId ?? null
}

/**
 * How many rows a switch would re-index, for the confirmation that precedes it.
 *
 * Its own export (rather than the client computing it from the queue's pending
 * count) because the two are different numbers: the queue counts what is NOT
 * embedded, and the warning is about what IS. Quoting the queue's figure would
 * tell somebody with a fully indexed library that nothing was about to happen.
 *
 * **With a `target`** — the pair about to be starred — it answers what starring
 * THAT pair would clear: every stored vector not made by the model it resolves
 * to, under any spelling of its identity. The same rule `applyEmbeddingStarChange`
 * applies, so the confirmation shows when, and only when, a star is about to
 * throw vectors away: after an unstar (no star to compare row ids with), and
 * never for a second row naming the same address and model. A target that does
 * not resolve would switch embeddings off, which clears nothing: zero.
 * Without one it counts everything stored — the lane card's number.
 *
 * A `target.edit` prices an edit before it is saved — the address or the
 * model identifier as the form holds them — by the same rule: a respelling of
 * the same address clears nothing, another host or another model clears every
 * vector it did not make. Judged against the star as the server holds it
 * (`starredPairEdit`), never the one a screen believes: an edit that touches
 * no star prices at zero, so a screen asks about every such edit and still
 * shows the confirmation only when the save re-embeds.
 *
 * ⚠ No rate estimate accompanies it, deliberately. The queue measures no
 * throughput — there is no rolling rate anywhere in `vectorizationQueue` — and a
 * made-up "roughly N minutes" on a screen whose entire job is to state the cost
 * accurately would be the one number on it that was invented.
 */
export async function embeddingReindexCost(
	db: Db,
	target?: Sockets.Vectorization.ReindexCost.Target
): Promise<Sockets.Vectorization.ReindexCost.Response> {
	let filter: EmbeddedRowFilter = {}
	if (target) {
		const pair = target.edit
			? await starredPairEdit(db, target)
			: target.modelId != null
				? {
						registered: {
							connectionId: target.connectionId,
							connectionModelId: target.modelId
						},
						edit: undefined
					}
				: null
		const resolved =
			pair && (await resolveEmbeddingPair(db, pair.registered, pair.edit))
		if (!resolved)
			return { rows: 0, byKind: {}, lorebooks: 0, sessions: 0, target }
		filter = { keepModels: await keptModelIds(db, resolved.modelId) }
	}
	const [rows, breakdown] = await Promise.all([
		countEmbeddedRows(db, filter),
		embeddedBreakdown(db, filter)
	])
	// ⚠ `rows` stays the authority and is computed the same way it always was.
	// The breakdown DECOMPOSES it — see `embeddedBreakdown` for why it cannot
	// name a store the count does not include.
	return {
		rows,
		byKind: breakdown.byKind,
		lorebooks: breakdown.lorebooks,
		sessions: breakdown.sessions,
		...(target ? { target } : {})
	}
}

/**
 * The starred pair an unsaved edit would change, with the part of the edit
 * that changes it — or null when it changes no star: an address edit of a
 * connection the star is not on, or a new identifier for a model it is not on.
 *
 * `target.modelId` names the model an identifier edit renames; an address edit
 * needs none, since the star's own model is the one it moves.
 */
async function starredPairEdit(
	db: Db,
	target: Sockets.Vectorization.ReindexCost.Target
): Promise<{
	registered: { connectionId: number; connectionModelId: number }
	edit: { baseUrl?: string; model?: string }
} | null> {
	const star = await capabilityDefault(db, EMBEDDING_CAPABILITY)
	const starModel = star?.connectionModelId ?? null
	if (star?.connectionId !== target.connectionId || starModel == null)
		return null
	const asked = target.edit ?? {}
	const edit = {
		...(asked.baseUrl !== undefined ? { baseUrl: asked.baseUrl } : {}),
		...(asked.model !== undefined && target.modelId === starModel
			? { model: asked.model }
			: {})
	}
	if (!Object.keys(edit).length) return null
	return {
		registered: {
			connectionId: star.connectionId,
			connectionModelId: starModel
		},
		edit
	}
}

/**
 * Apply the consequence of the embedding star having just moved.
 *
 * `before` is what `currentEmbeddingModelId` answered before the write. It
 * decides only whether anything MOVED (and so whether the queue stops and the
 * backend unloads); what is cleared is decided by the vectors themselves —
 * every one not produced by the model now starred, and none that was.
 *
 * Also the consequence of a DELETE: removing the starred connection, or its
 * starred model, releases the registration by cascade, and this is what stops
 * the queue and unloads the model rather than leaving it resident until its TTL.
 *
 * ⚠ Order is load-bearing: the queue is told to stop and the model unloaded
 * before the clear. `stopVectorization()` does not wait for an `embed()` in
 * flight — that call finishes, and is the one embed a switch can waste — but its
 * write cannot land: every vector write checks that the model it embedded with
 * is still the one loaded (`writeEntryVectorIfFresh`, `writeEmbeddingIfFresh`),
 * and the unload has just made that false. The start at the end re-arms that
 * same run if it has not wound down yet (`startVectorizationQueue`).
 */
export async function applyEmbeddingStarChange(
	db: Db,
	before: string | null
): Promise<EmbeddingStarChange> {
	const after = await currentEmbeddingModelId(db)
	if (after === before)
		return { reindexed: false, cleared: 0, restamped: 0, modelId: after }

	// Imported here rather than at module scope: `vectorizationQueue` pulls in
	// the indexing lane and the whole ranking graph behind it, and this module is
	// reached from `connections:setDefault` — a handler that runs for every star
	// of every modality.
	const {
		stopVectorization,
		startVectorizationQueue,
		clearVectorizationFailureTracking,
		clearInlineEmbedCooldown
	} = await import("./vectorizationQueue")

	stopVectorization()
	unloadEmbeddingModel("the embedding connection changed")
	// The managed KoboldCPP keeps its embedding model loaded beside the chat
	// model, and carries it into every later load. A star that leaves it —
	// for another endpoint, or for none — releases that slot; its next load
	// of any kind goes without it (one reload). A move between two of its own
	// models needs nothing: the new one's first embed swaps the slot.
	if (
		isManagedKoboldCppModelId(before) &&
		!isManagedKoboldCppModelId(after)
	) {
		const { setEmbeddingModel } = await import(
			"$lib/server/koboldcpp/modelManager"
		)
		setEmbeddingModel(null)
	}

	if (!after) {
		// Unstarred: embeddings are off. The vectors stay — see the header.
		return { reindexed: false, cleared: 0, restamped: 0, modelId: null }
	}

	// The same model at the same address, spelled differently, first: those
	// vectors are the new star's, and re-stamping them is what spares them.
	const restamped = await restampEquivalentVectors(db, after)
	// Then only what the new model cannot use. A re-star of the model the
	// index was built with clears nothing and the queue resumes where it was.
	const cleared = await clearEmbeddedVectors(db, { keepModel: after })
	// A different model may be exactly what fixes an item that was failing (a
	// dimension mismatch, a model that refused a long input), so nothing stays
	// excluded from picking until the next full restart.
	clearVectorizationFailureTracking()
	clearInlineEmbedCooldown()
	void startVectorizationQueue({ startFromBeginning: cleared > 0 })
	return { reindexed: cleared > 0, cleared, restamped, modelId: after }
}
