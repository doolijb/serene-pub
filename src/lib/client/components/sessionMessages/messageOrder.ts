/**
 * The `messages` widget's order maths, as pure functions.
 *
 * `order` decides which end of the scroll region the newest message sits at,
 * and four things follow from it: the sequence the log draws, where an
 * autoscroll lands, how close to the older end the reader has to be before the
 * next page is pulled, and where the scroll sits once that page has been added.
 * The log component and the session page both need those answers, so they live
 * here rather than in either of them.
 */

/** Which end of the log the newest message sits at. */
export type MessageOrder = "oldest-first" | "newest-first"

/** How close to the older end a reader gets before the next page is pulled. */
export const OLDER_LOAD_THRESHOLD_PX = 200

/** The scroll geometry these functions read, as an element reports it. */
export interface ScrollMetrics {
	scrollTop: number
	scrollHeight: number
	clientHeight: number
}

/**
 * The messages in the sequence the log draws them: conversation order under
 * `oldest-first`, and a reversed copy under `newest-first`. The input array is
 * handed straight back when nothing is reversed, so the common order allocates
 * nothing.
 */
export function orderedMessages<T>(messages: T[], order: MessageOrder): T[] {
	return order === "newest-first" ? [...messages].reverse() : messages
}

/**
 * The position in CONVERSATION order of the row drawn at `row`, so a message
 * keeps the index (and the "is this the newest one" answer) it has in the
 * session whichever way the log is drawn.
 */
export function conversationIndex(
	row: number,
	total: number,
	order: MessageOrder
): number {
	return order === "newest-first" ? total - 1 - row : row
}

/** Where the scroll region lands when it follows the newest message. */
export function autoscrollTarget(
	order: MessageOrder,
	metrics: Pick<ScrollMetrics, "scrollHeight">
): number {
	return order === "newest-first" ? 0 : metrics.scrollHeight
}

/**
 * Is the reader within `threshold` of the end the older messages are at — the
 * top under `oldest-first`, the bottom under `newest-first`?
 */
export function atOlderEdge(
	order: MessageOrder,
	metrics: ScrollMetrics,
	threshold: number = OLDER_LOAD_THRESHOLD_PX
): boolean {
	if (order === "newest-first") {
		const fromBottom =
			metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
		return fromBottom <= threshold
	}
	return metrics.scrollTop <= threshold
}

/**
 * Where the scroll sits after a page of older messages has been added, so the
 * reader keeps looking at the same message.
 *
 * Under `oldest-first` the new rows land ABOVE the viewport and push everything
 * down by the height they added, so the scroll moves down by that much. Under
 * `newest-first` they land below it, nothing above the viewport moved, and the
 * scroll stays exactly where it was.
 */
export function restoredScrollTop(
	order: MessageOrder,
	anchor: { previousScrollTop: number; previousScrollHeight: number },
	scrollHeight: number
): number {
	if (order === "newest-first") return anchor.previousScrollTop
	const addedHeight = scrollHeight - anchor.previousScrollHeight
	return anchor.previousScrollTop + addedHeight
}
