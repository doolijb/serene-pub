/**
 * 🚧 M2a a6: the session page hears `sessions:runEnded` for its own session —
 * the end of a press's run, whoever pressed, with its outcome and (on a halt
 * or an error) its sentence — and tells its widgets and frames `run:ended`.
 * Interest-scoped by the session (`SCOPED_EVENTS`), so another session's push
 * never reaches this page; the `sessionId` check stays as the filter.
 *
 * Returns the release, for the page's per-session interest list.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"

export function hearRunEnded(
	sessionId: number,
	widgets: { announceRunEnded(run: { runId: string; outcome: "ok" | "halt" | "err" | "cancelled"; reason?: string }): void }
): () => void {
	return declareInterest<"sessions:runEnded">(interestKey("sessions:runEnded", sessionId), (res) => {
		if (res?.sessionId !== sessionId || typeof res.runId !== "string") return
		widgets.announceRunEnded({ runId: res.runId, outcome: res.outcome, ...(res.reason ? { reason: res.reason } : {}) })
	})
}
