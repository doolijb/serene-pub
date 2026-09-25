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
 * At a session event's door (`dispatchSessionEvent`) a cap **parks** the
 * would-be child for the session owner instead of refusing it (E1c,
 * `capPause.ts`): Continue grants the tree one more window of each cap
 * (`grantWindow`), Cancel receipts it as stopped. At the fire door (an
 * answer's action) a cap is still a **receipted** refusal: the would-be
 * child gets a `pipeline_runs` row with `outcome: 'halt'` and the cap in
 * `haltReason`, its lineage filled.
 *
 * ## Counted in memory, for the tree's whole life
 *
 * The descendant count lives here, per root, while the tree is in flight.
 * A durable count would be a query over `pipeline_runs.root_run_id`, which
 * is also written, but the memory count is what makes the cap hold for runs
 * whose rows are not yet saved.
 *
 * A tree outlives its root's run: a child a write caused is dispatched on
 * the session's queue after the root has returned. So a tree is forgotten
 * only when its root has finished (`beginRoot` … `releaseRoot`, which
 * `runSpec` holds around every root) **and** no branch is open
 * (`openBranch` / `closeBranch`, held around every queued child dispatch
 * and every parked one). Forgetting it at the root's return would reset the
 * count under a chain still running, and leave an entry nothing removes.
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

interface Tree {
	/** Runs admitted under this root so far. */
	count: number
	/** Listener-lane runs admitted under this root (R65): their own budget. */
	laneCount?: number
	/** Queued or parked child dispatches not yet settled. */
	open: number
	/** The root's own run has returned. */
	rootDone: boolean
	/** Windows granted by the session owner's Continue — each adds one of each cap. */
	windows: number
}

/**
 * On `globalThis`: a Vite SSR reload re-evaluates this module, and a second
 * map would reset every count under a chain still in flight.
 */
const TREES_KEY = Symbol.for("serene-pub.runTrees")
const trees = ((globalThis as Record<symbol, unknown>)[TREES_KEY] ??= new Map<
	string,
	Tree
>()) as Map<string, Tree>

const treeOf = (root: string): Tree => {
	let t = trees.get(root)
	if (!t)
		trees.set(
			root,
			(t = { count: 0, open: 0, rootDone: false, windows: 0 })
		)
	return t
}

const forgetIfDone = (root: string) => {
	const t = trees.get(root)
	if (t && t.rootDone && t.open <= 0) trees.delete(root)
}

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
 * A lineage on the listener lane (R65): a run's own data event — the
 * turn-order recompute after a write, or a spec bound to `message-completed`
 * — rides the tree without deepening it. `echo` counts the consecutive
 * listener-lane hops instead, and a counted hop (`childLineage`) resets it,
 * so a loop made only of writes answering their own events stops at the
 * depth cap, while one recompute after a deep form answer never parks.
 * App-side only: the SDK's `RunLineage` and every receipt keep three fields.
 */
export type LaneLineage = RunLineage & { echo?: number }

export function listenerLineage(parent: {
	runId: string
	lineage?: LaneLineage
}): LaneLineage {
	return {
		parentRunId: parent.runId,
		rootRunId: parent.lineage?.rootRunId ?? parent.runId,
		depth: parent.lineage?.depth ?? 0,
		echo: (parent.lineage?.echo ?? 0) + 1
	}
}

/** The caps a root is held to now, with the windows its owner granted. */
export function capsOf(rootRunId: string): {
	depth: number
	descendants: number
} {
	const w = 1 + (trees.get(rootRunId)?.windows ?? 0)
	return { depth: MAX_RUN_DEPTH * w, descendants: MAX_RUN_DESCENDANTS * w }
}

/**
 * May a run with this lineage be dispatched? The sentence names the cap that
 * refused it; null admits. Admitting **counts** the descendant against the
 * root, so the caller must ask exactly once per dispatch.
 *
 * `count: false` (R65) is the listener lane (`listenerLineage`): held to
 * the depth cap by its `echo` — consecutive listener hops — and never
 * spending the tree's descendant budget, which counting the turn-order
 * recompute once starved a message's own form answers of.
 */
export function admitDescendant(
	lineage: LaneLineage,
	opts: { count?: boolean } = {}
): string | null {
	const caps = capsOf(lineage.rootRunId)
	if (opts.count === false) {
		const echo = lineage.echo ?? 0
		if (echo > caps.depth)
			return (
				`cycle guard: ${echo} writes in a row under root ${lineage.rootRunId} each answered ` +
				`the event the last one caused, past the cap of ${caps.depth} (01 §8, R65) — a ` +
				`pipeline that answers its own write stops here rather than looping`
			)
		// Its own budget, never the tree's: a pipeline that answers a write
		// with two writes doubles every hop, and the echo cap alone would let
		// 2+4+8+16 runs through before the first park (R65 review).
		const tree = treeOf(lineage.rootRunId)
		if ((tree.laneCount ?? 0) + 1 > caps.descendants)
			return (
				`cycle guard: root ${lineage.rootRunId} has already answered ${caps.descendants} ` +
				`of its own writes, the cap (01 §8, R65) — nothing more is dispatched under it`
			)
		tree.laneCount = (tree.laneCount ?? 0) + 1
		return null
	}
	if (lineage.depth > caps.depth)
		return (
			`cycle guard: this run would be ${lineage.depth} dispatches deep under root ` +
			`${lineage.rootRunId}, past the cap of ${caps.depth} (01 §8) — a form whose ` +
			`answer asks another form addressed to the AI stops here rather than looping`
		)
	const tree = treeOf(lineage.rootRunId)
	if (tree.count + 1 > caps.descendants)
		return (
			`cycle guard: root ${lineage.rootRunId} has already fathered ${caps.descendants} ` +
			`runs, the cap (01 §8) — nothing more is dispatched under it`
		)
	tree.count++
	return null
}

/** Continue at a cap (E1c): one more window of each cap for this tree. */
export function grantWindow(rootRunId: string): void {
	treeOf(rootRunId).windows++
}

/** How many descendants a root has fathered so far — for a test, and the inspector. */
export function descendantCount(rootRunId: string): number {
	return trees.get(rootRunId)?.count ?? 0
}

/** A root's run has started: its tree exists until it returns and every branch settles. */
export function beginRoot(rootRunId: string): void {
	treeOf(rootRunId)
}

/**
 * A child dispatch under this root is queued or parked: the tree stays. A
 * root with no tree here has already returned (`runSpec` begins every root),
 * so a tree made now is made done, and goes with its last branch.
 */
export function openBranch(rootRunId: string): void {
	const t = trees.get(rootRunId)
	if (t) t.open++
	else trees.set(rootRunId, { count: 0, open: 1, rootDone: true, windows: 0 })
}

/** That dispatch settled. */
export function closeBranch(rootRunId: string): void {
	const t = trees.get(rootRunId)
	if (!t) return
	t.open--
	forgetIfDone(rootRunId)
}

/** The root's own run has returned; its tree goes when no branch is open. */
export function releaseRoot(rootRunId: string): void {
	const t = trees.get(rootRunId)
	if (!t) return
	t.rootDone = true
	forgetIfDone(rootRunId)
}

/** How many trees are held — for a test of the lifetime. */
export const _treeCount = () => trees.size

/** Test seam. */
export function _resetLineage(): void {
	trees.clear()
}
