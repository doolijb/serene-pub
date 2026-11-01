/**
 * 🚧 M2a a6: the presses waiting on their run's answer (a frame's or a
 * component's `invoke` with a `requestId`), by the run id the fire named.
 * The answer is the fire's own (`sessions:fireAction`, at the run's end):
 * matched by the press's own run id (`askedRunId`, on every answer — a
 * refusal before any run, an error, a halt, a Stop, success), else `runId`;
 * an answer naming neither (an older server) goes to the oldest press of
 * that action still waiting. A supersede and the bare park ack (the press's
 * own run waits at a review gate) settle nothing: the real answer comes later.
 */
import type { PressAnswer, PressHearing } from "$lib/shared/widgets/invokeAction"

/** The press's answer, as a press hears it. */
export function pressAnswerOf(msg: Sockets.Sessions.FireAction.Response): PressAnswer {
	if (msg.success && msg.runId) return { ok: true, runId: msg.runId, ...(msg.parked ? { parked: true as const } : {}) }
	if (msg.halted && msg.runId) return { ok: true, runId: msg.runId, halted: true, reason: msg.reason ?? msg.error ?? "" }
	if (msg.cancelled) return { ok: false, error: "cancelled", cancelled: true }
	return { ok: false, error: msg.error ?? "The press was refused." }
}

export function createPressAnswers() {
	const waiting: { runId: string; action: string; hearing: PressHearing }[] = []
	return {
		/** A press fired as `runId` (its action's identity or key), and who waits on its answer. */
		wait(runId: string, action: string, hearing: PressHearing) {
			hearing.fired(runId)
			waiting.push({ runId, action, hearing })
			// Answers always come (the server says every end); a bound only against a lost socket.
			if (waiting.length > 64) waiting.shift()
		},
		/** One `sessions:fireAction` answer of this session. */
		settle(msg: Sockets.Sessions.FireAction.Response) {
			// a supersede re-sent the same run id: the run that replaces it answers later
			if (msg.cancelled && msg.cancelledBy === "system:superseded") return
			// the bare park ack (the press's own run waits at a review gate): the real answer comes when it settles
			if (msg.parked && !msg.success) return
			// `askedRunId` is the press's own run id; `runId` names a run that stood behind the answer
			const id = msg.askedRunId ?? msg.runId
			let at = id ? waiting.findIndex((w) => w.runId === id) : -1
			if (at < 0 && !id) at = waiting.findIndex((w) => w.action === msg.action)
			if (at < 0) return
			const [w] = waiting.splice(at, 1)
			w.hearing.answered(pressAnswerOf(msg))
		}
	}
}
