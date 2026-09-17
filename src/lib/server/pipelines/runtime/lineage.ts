/**
 * Run lineage and the cycle caps (01 §8 *Cycle guards, both layers*; R-21
 * (5); built 2026-09-17 as 30 §U5d).
 *
 * Only core emits events, and a pipeline causes another only by writing
 * something core emits an event for. A `form-addressed` answer is exactly
 * that: the run that wrote the form causes the event, the answer pipeline
 * runs as its **child**, and the action the answer fires runs as a
 * **grandchild**. A form whose answer asks another form addressed to the AI
 * would run forever without a stop, so every dispatched run carries where it
 * stands — `parentRunId`, `rootRunId`, `depth` — and the dispatcher enforces
 * two caps **per root**:
 *
 *  - **depth ≤ `MAX_RUN_DEPTH`** — how many dispatches deep a tree may go;
 *  - **descendants ≤ `MAX_RUN_DESCENDANTS`** — how many runs one root may
 *    father in all.
 *
 * A refusal is **receipted**: the would-be child gets a `pipeline_runs` row
 * with `outcome: 'halt'` and the cap in `haltReason`, its lineage columns
 * filled, so the inspector shows where the tree stopped and why rather than
 * a run that silently never happened.
 *
 * ## Counted in memory, written for the reader
 *
 * The descendant count lives here, per root, while the tree is in flight —
 * a child run dispatches from inside its parent's `runSpec`, after the
 * parent's receipt is saved, so the parent is still registered and the tree
 * completes before the root's caller returns. A durable count would be a
 * query over `pipeline_runs.root_run_id`, which is also written; the memory
 * count is what makes the cap hold for runs whose rows are not yet saved. A
 * root that has finished takes its count with it (`releaseRoot`), so a later
 * tree under a new root starts at zero.
 *
 * The static layer 01 §8 also names — a recursive CTE over subscriptions —
 * has one subscription kind in this release (a preset's binding), and the
 * dynamic caps here are the guard that holds for it.
 */

import type { RunLineage } from "@serene-pub/sdk"

export type { RunLineage }

/** How many dispatches deep a tree may go. A root is 0; its answer 1; the answer's action 2. */
export const MAX_RUN_DEPTH = 4
/** How many runs one root may father in all, across every depth. */
export const MAX_RUN_DESCENDANTS = 16

const descendants = new Map<string, number>()

/** The lineage a run dispatched by `parent` carries. */
export function childLineage(parent: {
	runId: string
	lineage?: RunLineage
}): RunLineage {
	return {
		parentRunId: parent.runId,
		rootRunId: parent.lineage?.rootRunId ?? parent.runId,
		depth: (parent.lineage?.depth ?? 0) + 1
	}
}

/**
 * May a run with this lineage be dispatched? The sentence names the cap that
 * refused it; null admits. Admitting **counts** the descendant against the
 * root, so the caller must ask exactly once per dispatch.
 */
export function admitDescendant(lineage: RunLineage): string | null {
	if (lineage.depth > MAX_RUN_DEPTH)
		return (
			`cycle guard: this run would be ${lineage.depth} dispatches deep under root ` +
			`${lineage.rootRunId}, past the cap of ${MAX_RUN_DEPTH} (01 §8) — a form whose ` +
			`answer asks another form addressed to the AI stops here rather than looping`
		)
	const count = (descendants.get(lineage.rootRunId) ?? 0) + 1
	if (count > MAX_RUN_DESCENDANTS)
		return (
			`cycle guard: root ${lineage.rootRunId} has already fathered ${MAX_RUN_DESCENDANTS} ` +
			`runs, the cap (01 §8) — nothing more is dispatched under it`
		)
	descendants.set(lineage.rootRunId, count)
	return null
}

/** How many descendants a root has fathered so far — for a test, and the inspector. */
export function descendantCount(rootRunId: string): number {
	return descendants.get(rootRunId) ?? 0
}

/** A root has finished and its tree with it: forget its count. */
export function releaseRoot(rootRunId: string): void {
	descendants.delete(rootRunId)
}

/** Test seam. */
export function _resetLineage(): void {
	descendants.clear()
}
