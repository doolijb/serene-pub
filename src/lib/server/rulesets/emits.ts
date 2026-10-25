/**
 * 🚧 **Events a ruleset's functions raise, emitted at the end** (PLAN-
 * rulesets-functions D3; owner's nine additions (1), 2026-10-22).
 *
 * A function never emits anything mid-run: its handler answers `emits`, the
 * resolve outlet collects them (`PendingEmit`, checked against the
 * function's header), and they are queued here under the run. When the
 * run's receipt is saved, the run's host dispatches them — the same place
 * and the same rules as the fires an answered form makes (`dispatchFires`):
 * after the receipt, only for a run that went to the end, each through the
 * one emitter (`emitSessionEvent`) as the run's **child** lineage, so what an
 * event sets off cascades through the session's registrations under the
 * depth cap.
 *
 * ## The toggles (on by default)
 *
 *  · per node — the resolve step's `emits` parameter (`false`: what its
 *    functions raise is reported on its facts and never emitted);
 *  · per pipeline — the spec document's `emits` (`false`: nothing any of its
 *    steps raises is emitted).
 *
 * A call with no run (a direct caller, a preview) queues nothing: its emits
 * are on its facts alone.
 */

import type { RunLineage } from "@serene-pub/sdk"
import type { PendingEmit } from "./types"

type Db = any

interface Queued {
	sessionId: number
	emits: PendingEmit[]
	/** When it was queued — a run whose host never takes its emits (a direct caller) is forgotten after `STALE_MS`. */
	at: number
}

/** How long a run's emits wait for its host before they are dropped. */
const STALE_MS = 10 * 60 * 1000

/**
 * Per run id, until its host takes them. On `globalThis`: a Vite SSR reload
 * re-evaluates this module, and a second map would lose a run's emits
 * between its resolve step and its receipt.
 */
const KEY = Symbol.for("serene-pub.rulesetEmits")
const queued = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<string, Queued>()) as Map<string, Queued>

/** Whether a toggle lets emits through: anything but an explicit `false` (or `"false"`, `"off"`). */
export const emitsOn = (toggle: unknown): boolean => !(toggle === false || toggle === "false" || toggle === "off")

/** 🚧 Queue what a run's resolve step raised, for its host to emit after the receipt. */
export function queueRulesetEmits(runId: string | undefined, sessionId: number, emits: readonly PendingEmit[]): boolean {
	if (!runId || !emits.length) return false
	const now = Date.now()
	for (const [id, q] of queued) if (now - q.at > STALE_MS) queued.delete(id)
	const q = queued.get(runId) ?? { sessionId, emits: [], at: now }
	q.emits.push(...emits)
	queued.set(runId, q)
	return true
}

/** 🚧 Take (and forget) what a run queued. */
export function takeRulesetEmits(runId: string): Queued | undefined {
	const q = queued.get(runId)
	queued.delete(runId)
	return q
}

/** What a run's host hands the dispatch: the run, and whether it went to the end. */
export interface EmitDispatchRun {
	runId: string
	outcome: string
	lineage?: RunLineage
	userId: number
	io?: unknown
	signal?: AbortSignal
	/** The spec document's `emits` toggle (default on). */
	pipelineEmits?: unknown
}

/** What the dispatch did, event by event — for the trail and the tests. */
export interface EmitDispatchReport {
	emitted: string[]
	skipped: { event: string; why: string }[]
}

/**
 * 🚧 Emit what a run's functions raised — called by the run's host once
 * its receipt is saved (beside `dispatchFires`). Nothing for a run that did
 * not go to the end, or a pipeline whose `emits` is off; each event through
 * `emitSessionEvent` (injected in a test) with the run as its cause and
 * the run's child lineage, so the cycle caps hold. Never throws.
 */
export async function dispatchRulesetEmits(
	db: Db,
	run: EmitDispatchRun,
	emitter?: (db: Db, opts: Record<string, unknown>) => Promise<unknown>
): Promise<EmitDispatchReport> {
	const report: EmitDispatchReport = { emitted: [], skipped: [] }
	const q = takeRulesetEmits(run.runId)
	if (!q?.emits.length) return report
	const skipAll = (why: string) => {
		for (const e of q.emits) report.skipped.push({ event: e.event, why })
		return report
	}
	if (run.outcome !== "ok") return skipAll(`the run did not go to the end (${run.outcome})`)
	if (!emitsOn(run.pipelineEmits)) return skipAll("the pipeline's emits are off")
	const { childLineage } = await import("$lib/server/pipelines/runtime/lineage")
	const emit = emitter ?? (await import("$lib/server/pipelines/runtime/sessionEvents")).emitSessionEvent
	const lineage = childLineage({ runId: run.runId, lineage: run.lineage })
	for (const e of q.emits) {
		try {
			await emit(db, {
				sessionId: q.sessionId,
				userId: run.userId,
				event: e.event,
				payload: {
					cause: { kind: "run", runId: run.runId },
					raisedBy: { function: e.key, ...(e.owner ? { owner: e.owner } : {}) },
					...(e.payload !== undefined ? { values: e.payload } : {}),
					lineage
				},
				lineage,
				...(run.io ? { io: run.io } : {}),
				...(run.signal ? { signal: run.signal } : {})
			})
			report.emitted.push(e.event)
		} catch (err) {
			report.skipped.push({ event: e.event, why: err instanceof Error ? err.message : String(err) })
		}
	}
	return report
}
