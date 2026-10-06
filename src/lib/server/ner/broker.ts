/**
 * The entity model, spoken for — the annotation lane's `LaneModelBroker`.
 *
 * **Constraint 1's seam.** The lane never calls a loader; it calls this. Where
 * `modelFreeBroker` answers "none" to everything, this answers "none" only while
 * nothing is starred — which is what makes the annotation lane one that CAN have
 * a model without being one that REQUIRES one.
 *
 * ## No star is `none`, never `unconfigured`
 *
 * `LaneModelPeek` has both arms and the loop reads them oppositely: `none` means
 * *pick work and process it with a null identity*, `unconfigured` means *settle
 * every ticket and stop*. The gazetteer and the capitalisation heuristic are the
 * zero-setup path — a lorebook with no keywords and nothing downloaded still
 * gets its names matched — so an install that has starred nothing must take the
 * first branch. Answering `unconfigured` here would make the model-free feature
 * require a model, which is the exact shape the lane primitives were separated
 * from the embedding queue to prevent.
 *
 * ## A star that cannot load degrades to model-free
 *
 * Same rule, second-order. If a starred model fails to load, the loop's
 * residency request answers `unavailable` and that run stops — correct for one
 * run, and fatal as a steady state, because the next tick would peek
 * `configured`, ask again, fail again, and annotation would stop for as long as
 * the broken star existed. Taking the lexical tier down with a model it has
 * nothing to do with is exactly the "an unavailable mechanism subtracts a
 * signal, it never disables a path" rule. So a failed load is REMEMBERED against
 * the model identity that failed, and while that memory stands the broker
 * answers `none`: the lane keeps annotating, without the model. The memory is
 * keyed on the identity, so it clears itself the moment the star names anything
 * else, and `forgetNerLoadFailure()` clears it for a caller that has reason to
 * believe the world changed.
 *
 * ## Through the adapter, never around it
 *
 * The broker names no loader and no backend. It reaches the starred type's
 * module through `getNerAdapter`, loads through that module's `residency`, and
 * the lane's unit of work extracts through the same module's adapter
 * (`leasedNerAdapter`). A module with no `residency` has nothing to load, so its
 * target is leased `resident` at once. That is what lets a NER type that does
 * not run in this process serve the lane with no change here.
 */

import type {
	LaneModelBroker,
	LaneModelPeek,
	ModelLease
} from "$lib/server/indexing/lane"
import type {
	BaseNerAdapter,
	NerResidency
} from "$lib/server/nerAdapters/BaseNerAdapter"
import { getNerAdapter } from "$lib/server/utils/getNerAdapter"
import { DEFAULT_NER_TTL_MINUTES } from "$lib/shared/constants/ner"
import { resolveNerTarget, type NerTarget } from "./target"

/**
 * The TTL last read off the starred connection, so `spec` can answer
 * synchronously.
 *
 * Refreshed by every peek and every request rather than cached forever — a
 * declaration that lies about the configured value is worse than no
 * declaration. The number the model actually runs on is the one
 * `setNerTtlMinutes` applies at load; this is the reporting copy, which is the
 * same split `embeddingBroker` makes.
 */
let lastKnownTtlMinutes = DEFAULT_NER_TTL_MINUTES

/** The model identity whose load failed, and what it said. */
let failed: { modelId: string; reason: string } | null = null

/**
 * The target the last `resident` lease was taken on — what `leasedNerAdapter`
 * builds the adapter from. Replaced by every lease, so a star moved onto
 * another row naming the same model is picked up by the lane's next request.
 */
let leased: NerTarget | null = null

/** Forget a remembered load failure, so the next peek tries the star again. */
export function forgetNerLoadFailure(): void {
	failed = null
}

/** The database, resolved lazily — `db/index.ts` must not be imported for effect. */
const getDb = async (): Promise<Db> => (await import("$lib/server/db")).db

/**
 * The starred target, or null, with the reporting TTL refreshed on the way past.
 *
 * Never throws: the lane peeks on every tick, and a database that has gone away
 * under a background sweep is an ordinary shutdown. A null answer puts the lane
 * on the lexical tier, which is the safe direction.
 */
async function currentTarget() {
	try {
		const target = await resolveNerTarget(await getDb())
		if (target) lastKnownTtlMinutes = target.ttlMinutes
		return target
	} catch (err) {
		console.error("[ner] could not read the starred connection:", err)
		return null
	}
}

export const nerBroker: LaneModelBroker = {
	get spec() {
		return {
			/**
			 * The ROLE is `"ner"` whether or not anything is starred, and the
			 * peek is what says whether one is. An admin surface enumerating the
			 * lanes wants to know which kind of model this lane would load — that
			 * is what a declaration is for — and a role that flipped to null when
			 * nothing was configured would make the lane's IDENTITY depend on a
			 * setting.
			 */
			role: "ner",
			ttlMinutes: lastKnownTtlMinutes
		}
	},

	async peek(): Promise<LaneModelPeek> {
		const target = await currentTarget()
		if (!target) return { kind: "none" }
		if (failed && failed.modelId === target.modelId) return { kind: "none" }
		return { kind: "configured", modelId: target.modelId }
	},

	async request(opts): Promise<ModelLease> {
		const target = await currentTarget()
		if (!target) return { kind: "none", modelId: null }
		if (failed && failed.modelId === target.modelId)
			return { kind: "none", modelId: null }

		let residency: NerResidency | null
		try {
			residency = await residencyFor(target.type)
		} catch (err) {
			// A type no NER module serves cannot load anything, which is the
			// same steady state as a model that cannot: remembered, and the
			// lane annotates without it.
			const reason =
				err instanceof Error
					? `the entity connection cannot run: ${err.message}`
					: "the entity connection cannot run"
			console.warn(`[ner] ${reason} — annotating without it`)
			return refuse(target, reason)
		}
		// Nothing to load: a backend that is up whenever its host is. A call
		// that fails then subtracts that row's spans and nothing more.
		if (!residency) return lease(target)

		if (residency.resident() === target.modelId) return lease(target)

		if (!opts?.wait) {
			/**
			 * Constraint 3, at the only call site where it bites. A promotion
			 * runs inside a turn and a first-ever local model load is a
			 * download; waiting for it here would stall the reply for minutes.
			 * So the load is STARTED and the answer is `pending` — the turn
			 * degrades to the lexical tier and the background pass uses what
			 * this warmed.
			 */
			if (!residency.loading())
				void this.request({ wait: true }).catch(() => {})
			return {
				kind: "pending",
				modelId: null,
				reason: "the entity model is not resident yet — it has been requested"
			}
		}

		try {
			await residency.load(target.modelId, target.ttlMinutes)
		} catch (err) {
			const reason =
				err instanceof Error
					? `the entity model failed to load: ${err.message}`
					: "the entity model failed to load"
			console.warn(`[ner] ${reason} — annotating without it`)
			return refuse(target, reason)
		}

		if (residency.resident() !== target.modelId)
			return refuse(target, "the entity model did not come up")
		return lease(target)
	}
}

/**
 * The residency of the backend a connection type names, or null for one with
 * nothing to load. Throws for a type no NER module serves.
 */
async function residencyFor(type: string): Promise<NerResidency | null> {
	const mod = await getNerAdapter(type)
	return mod.residency ? await mod.residency() : null
}

/** A `resident` lease on `target`, remembered for `leasedNerAdapter`. */
function lease(target: NerTarget): ModelLease {
	leased = target
	return { kind: "resident", modelId: target.modelId }
}

/** Remember that `target` cannot run, and say so as an `unavailable` lease. */
function refuse(target: NerTarget, reason: string): ModelLease {
	failed = { modelId: target.modelId, reason }
	return { kind: "unavailable", modelId: null, reason }
}

/**
 * The adapter the lane extracts through while its lease on `modelId` holds,
 * and null otherwise.
 *
 * The lane leases before every item and hands the leased identity to the unit
 * of work, which asks here. Null when:
 *
 *  - **the lease moved on.** The last lease names another identity, or none.
 *  - **an in-process model is not resident.** Unloaded on its idle timer or
 *    swapped underneath the pass. Answering null rather than letting the
 *    adapter load on demand is what keeps a 100MB download out of whoever asked
 *    first, and keeps another model's spans out of a row whose neighbours came
 *    from this one.
 *
 * Throws only when the adapter module cannot load; the caller treats that as a
 * subtracted signal.
 */
export async function leasedNerAdapter(
	modelId: string
): Promise<BaseNerAdapter | null> {
	const target = leased
	if (!target || target.modelId !== modelId) return null
	const mod = await getNerAdapter(target.type)
	if (mod.residency && (await mod.residency()).resident() !== modelId)
		return null
	return new mod.Adapter(target.connection)
}
