/**
 * Why a run produced nothing, in a sentence a person could be shown.
 *
 * Pure, and in its own module so it is tested without the runtime it is
 * re-exported from (`runTurn.ts`).
 *
 * A halt is not a failure (an aborted generation and an empty completion both
 * halt), so this reads the receipt rather than assuming an error. Returns null
 * when the run finished normally.
 *
 * ## Why the step is not named
 *
 * The sentence does not end `(at 'render')`, the node key the run stopped at.
 * That is the spec's internal name for a step, which a person reading the progress card or the
 * failed message cannot act on, and the sentence it followed already says
 * what to do (PLAN-less-confusing D4, 2026-10-11). The key is not lost: the
 * receipt keeps it as `haltNodeKey`, the terminal progress frame carries it
 * beside this sentence, and the run inspector (administrators) shows it.
 */
import type { Receipt } from "@serene-pub/sdk"

/** What a receipt that stopped without giving a reason says. */
export const HALT_WITHOUT_REASON = "The run stopped without saying why."

export function haltExplanation(
	receipt: Pick<Receipt, "outcome" | "haltReason">
): string | null {
	if (receipt.outcome === "ok") return null
	return receipt.haltReason?.trim() || HALT_WITHOUT_REASON
}
