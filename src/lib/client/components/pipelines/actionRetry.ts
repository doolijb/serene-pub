/**
 * 🚧 Retry for a halted action run (Dungeon Crawler walk, 2026-10-16):
 * "Answer halted at …" offered only Inspect and Dismiss. A reply row retries
 * through its own verb (`sessionMessages:regenerate`); an action run has no
 * row to retry from, so the press that fired it is kept by the run id the
 * client named it with (`sessions:fireAction`'s `runId`), and Retry fires the
 * same press again under a new run id.
 *
 * Module-scoped and bounded: the progress card reads the press the page
 * sent. A run fired from another tab, or before a reload, has no press here,
 * and no Retry.
 */
import type { RunProgress } from "$lib/shared/sockets/progress"
import { outcomeOf } from "./runOutcome"

type FireParams = Sockets.Sessions.FireAction.Params

const KEPT = 20
const fired = new Map<string, Omit<FireParams, "runId">>()

/** The page fired an action: keep its press by the run id it named. */
export function rememberFiredAction(params: FireParams): void {
	if (!params.runId) return
	const { runId, ...press } = params
	fired.delete(runId)
	fired.set(runId, press)
	while (fired.size > KEPT) fired.delete(fired.keys().next().value!)
}

/**
 * The press to fire again for a run that ended without its answer — a halt
 * or an error, never a cancel (the person stopped it) or a success — when
 * this page fired it; else null.
 */
export function actionRetryOf(
	run: Pick<RunProgress, "runId" | "outcome" | "cancelled" | "error">
): Omit<FireParams, "runId"> | null {
	const outcome = outcomeOf(run)
	if (outcome !== "halt" && outcome !== "err") return null
	return fired.get(run.runId) ?? null
}

/** For tests: forget every kept press. */
export function _forgetFiredActions(): void {
	fired.clear()
}
