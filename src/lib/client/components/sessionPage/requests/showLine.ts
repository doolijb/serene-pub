/**
 * `show-line`: a Dialogue box tells the page which line its reader is on, so
 * the stage can be drawn as of that line. Core's widgets only (the askers
 * table, `./askers.ts`). Client-only page state; holds no listener and never
 * toasts.
 */
import { SvelteMap } from "svelte/reactivity"

/** The line a Dialogue box's reader is on (`show-line`), by session id — at most one entry. */
export const shownLines = new SvelteMap<number, number>()

/** Answer one `show-line` for the page's session. Throws, in words, on no session or a bad message id. */
export function answerShowLine(
	params: unknown,
	sessionId: number | null
): void {
	if (sessionId == null) throw new Error("show-line needs a session")
	const id = ((params ?? {}) as { messageId?: unknown }).messageId
	if (
		id !== null &&
		!(typeof id === "number" && Number.isInteger(id) && id > 0)
	)
		throw new Error("show-line needs a message id (a whole number) or null")
	if (id === null) {
		if (shownLines.has(sessionId)) shownLines.delete(sessionId)
		return
	}
	// A switch never shows another session's stale line.
	for (const other of [...shownLines.keys()])
		if (other !== sessionId) shownLines.delete(other)
	if (shownLines.get(sessionId) === id) return
	shownLines.set(sessionId, id)
}

/** The shown line for this session, or null (none shown, or another session's). */
export function shownLineOf(
	sessionId: number | null | undefined
): number | null {
	return sessionId == null ? null : (shownLines.get(sessionId) ?? null)
}

/** Forget the shown line. */
export function clearShownLine(): void {
	if (shownLines.size > 0) shownLines.clear()
}
