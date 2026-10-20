/**
 * 🚧 Each run's **turn message** (PLAN-rulesets §26, §29): the live row the run
 * opened — a placeholder it created or a row it claimed — kept after it
 * settles. The host notes it when the row opens (`host.ts`, the
 * create-message commit); a Task, which never sees the run's live row (the
 * executor hands that to the host alone), asks for it by run id. The ruleset
 * handler's `apply` anchors its writes there, so retaking or swiping the
 * turn retracts them with the row (`rulesets/resolve.ts`).
 *
 * Bounded rather than cleared at the run's end: a run that throws never
 * reaches its end, and the newest few hundred runs are the only ones still
 * writing.
 */

/** On `globalThis`: a Vite SSR reload re-evaluates this module mid-run. */
const KEY = Symbol.for("serene-pub.runTurnMessages")
const rows = ((globalThis as Record<symbol, unknown>)[KEY] ??= new Map<string, number>()) as Map<
	string,
	number
>
const CAP = 512

/** Note `runId`'s turn row. */
export function noteTurnMessage(runId: string | undefined, messageId: number): void {
	if (!runId) return
	rows.delete(runId)
	rows.set(runId, messageId)
	while (rows.size > CAP) rows.delete(rows.keys().next().value!)
}

/** The turn row `runId` opened, or undefined when it has opened none. */
export function turnMessageOf(runId: string | undefined): number | undefined {
	return runId ? rows.get(runId) : undefined
}
