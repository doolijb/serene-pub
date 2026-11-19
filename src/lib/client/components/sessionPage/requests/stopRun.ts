/**
 * 🚧 `stop-run` (core only): **Stop** on a background run the turn line lists
 * (`SessionDossierV1.runsInProgress`). A registered run (an action, a routine)
 * is cancelled by its run id; a summary's activity id goes to
 * `activity:cancel`, which the server judges (the viewer's own, or an admin's).
 * A run the viewer may not stop, an id that is neither, or a blank id, does
 * nothing: the list only offers Stop where it may. No toast.
 */

/** What this answer needs of the page. */
export interface StopRunDeps {
	/** The run this session holds under `id`, when one is registered. */
	runOf(id: string): { mayStop?: boolean } | undefined
	/** True when `id` is one of the summaries the page lists as a background run. */
	isSummary(id: string): boolean
	cancelRun(runId: string): void
	cancelActivity(activityId: string): void
}

/** Answer one `stop-run`. */
export function answerStopRun(params: unknown, deps: StopRunDeps): void {
	const raw = (params as { id?: unknown } | null | undefined)?.id
	const id = typeof raw === "string" ? raw.trim() : ""
	if (!id) return
	const run = deps.runOf(id)
	if (run) {
		if (run.mayStop === true) deps.cancelRun(id)
		return
	}
	if (deps.isSummary(id)) deps.cancelActivity(id)
}
