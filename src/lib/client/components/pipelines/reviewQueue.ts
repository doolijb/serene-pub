/**
 * The queue wording the two "a run is waiting for you" dialogs share
 * (`PipelineReviewModal`, `CapPauseDialog`).
 *
 * Both hold the card on screen at `queue[0]`, so the cards still to come are
 * `queue.length - 1`. The count was always right; "1 more waiting" read as if
 * the card being looked at were not one of them (owner note 15, 2026-10-02),
 * so the line says where the person is in the queue instead.
 */

/** "Review 1 of 3" — null when the card on screen is the only one. */
export function queuePosition(queueLength: number): string | null {
	return queueLength > 1 ? `1 of ${queueLength}` : null
}

/** "1 more after this one" / "2 more after this one" — null when none follow. */
export function queueAfterThis(queueLength: number): string | null {
	const rest = queueLength - 1
	return rest > 0 ? `${rest} more after this one` : null
}
