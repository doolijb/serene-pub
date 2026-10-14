/**
 * Where a failed press is said: once, and on the progress card when there is one
 * (PLAN-less-confusing D4, 2026-10-11).
 *
 * A press that ran and failed is said on the progress card above the composer
 * (which offers Inspect to an administrator) and not also as a toast. The toast
 * is for a failure no card is showing, which is a press refused before any run started: no run, so no
 * card and no `runId` on the answer.
 *
 * Pure, so the rule is tested without a socket or a page.
 */

/** The half of a `sessions:fireAction` answer this reads. */
export interface FireFailureAnswer {
	error?: string
	/** The run that failed, when one ran (`Sockets.Sessions.FireAction.Response.runId`). */
	runId?: string
}

/** The half of the progress card's `lastFinished` this reads (`stores/runProgress`). */
export interface FinishedRun {
	runId: string
	error?: string
}

/**
 * True when the session's progress card is already saying this failure: the answer
 * names a run, and that run is the one the card shows as just ended, with its
 * reason. Dismissed, replaced by a newer run, or never drawn reads false, and
 * the caller says it itself.
 */
export function failureOnProgressCard(
	answer: FireFailureAnswer,
	lastFinished: FinishedRun | undefined
): boolean {
	return (
		!!answer.error &&
		!!answer.runId &&
		lastFinished?.runId === answer.runId &&
		!!lastFinished.error
	)
}
