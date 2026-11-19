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
 * ## Who reads the reason
 *
 * The reason is a message the run threw, which the SDK copies verbatim: it can
 * carry URLs, model file names and node keys. A halt's words are for the
 * people in the session only when the code that raised it says so (a marker at
 * the raise site, stamped on the receipt as `meta.peopleSentence`; a review
 * rejection is one by its record). Such a sentence names no step and is read
 * by everyone. Any other reason is detail: an administrator reads it
 * (`haltExplanationFor`), everyone else reads one plain sentence for the
 * surface and the suggestion to ask an administrator, and only an administrator
 * is sent the step the run stopped at (`haltStepShownTo`; the receipt keeps it
 * as `haltNodeKey`). A surface calls the helper at its emit, with the text it
 * would otherwise send.
 */
import type { Receipt } from "@serene-pub/sdk"
import { ADMINISTRATOR_SUGGESTION } from "$lib/server/utils/administratorSuggestion"
import {
	connectionsVisibleTo,
	type ConnectionSubject
} from "$lib/server/connections/visibility"

/** What a receipt that stopped without giving a reason says. */
export const HALT_WITHOUT_REASON = "The run stopped without saying why."

export function haltExplanation(
	receipt: Pick<Receipt, "outcome" | "haltReason">
): string | null {
	if (receipt.outcome === "ok") return null
	return receipt.haltReason?.trim() || HALT_WITHOUT_REASON
}

export { ADMINISTRATOR_SUGGESTION }

/** A surface that shows a non-administrator a plain sentence in place of a run's halt. */
export type HaltSurface =
	| "action"
	| "summary"
	| "prompt"
	| "reply"
	| "routine"
	| "save"
	| "delete"

const PLAIN_HALT_SENTENCES: Record<HaltSurface, string> = {
	action: "The action could not finish.",
	summary: "The summary could not be written.",
	prompt: "The prompt could not be compiled.",
	reply: "The reply could not be generated.",
	routine: "A background routine could not run.",
	save: "Your message could not be saved. Your text was kept.",
	delete: "The message was not deleted."
}

/**
 * What `reader` is shown of a halt: `said` unchanged for an administrator, the
 * surface's plain sentence and the suggestion for anyone else (`null` is every
 * member at once).
 */
export function haltExplanationFor(
	reader: ConnectionSubject | null | undefined,
	surface: HaltSurface,
	said: string
): string {
	if (connectionsVisibleTo(reader)) return said
	return `${PLAIN_HALT_SENTENCES[surface]} ${ADMINISTRATOR_SUGGESTION}`
}

/**
 * What a failed reply's row stores when its reason is a receipt's or a caught
 * foreign error's (DG3, 2026-11-17: "never publish raw errors directly to the
 * message body"): the reply surface's plain sentence and the suggestion, for
 * every member alike. The reason itself stays on the run record, where an
 * administrator reads it.
 */
export function plainReplyFailure(): string {
	return haltExplanationFor(null, "reply", "")
}

/**
 * The reply surface's plain sentence alone, without the suggestion: what an
 * administrator reads as a failed reply's message, the reason sitting under it.
 */
export function plainReplySentence(): string {
	return PLAIN_HALT_SENTENCES.reply
}

/**
 * Did a model call end this run?
 *
 * Fails closed, from the receipt's rows alone. A run that ended `halt` is never
 * a model-call failure: its reason is a deliberate stop (a review rejection, a
 * script halt, an empty completion) a person can act on. A run that ended `err`
 * is one when ANY row that is `err` and not `recoveredAsEmpty` is an `oracle`:
 * rows are ordered by when a node started and a parallel `gather` / `each`
 * reports the first failing chain, so "the last failing row" can belong to a
 * different chain than the one that ended the run, and only "any" cannot hide
 * a model-call failure's URL or file name. A plugin's own model-call step is an
 * `oracle` too.
 */
export function haltedAtModelCall(
	receipt: Pick<Receipt, "outcome" | "nodes">
): boolean {
	if (receipt.outcome !== "err") return false
	return receipt.nodes.some(
		(n) => n.kind === "oracle" && n.result === "err" && !n.recoveredAsEmpty
	)
}

/** The executor's halt reason for a write the reviewer rejected (`executor.ts`, the review gate). */
export const REVIEW_REJECTED_REASON = "rejected at review"

/**
 * Did the reviewer reject this run's write? The review record, or on a
 * compacted receipt, whose reviews are dropped with its nodes (an
 * event-triggered halt), the executor's halt reason for a reject.
 */
export function rejectedAtReview(receipt: {
	outcome: string
	haltReason?: string
	reviews?: ReadonlyArray<{ action: string }>
}): boolean {
	return (
		receipt.outcome === "halt" &&
		((receipt.reviews ?? []).some((r) => r.action === "reject") ||
			receipt.haltReason === REVIEW_REJECTED_REASON)
	)
}

type HaltReceipt = Pick<
	Receipt,
	"outcome" | "nodes" | "haltReason" | "reviews" | "meta"
>

/**
 * The sentence for the people in the session that ended this run, if any: the
 * one stamped on the receipt, or the review rejection's.
 */
export function receiptPeopleSentence(
	receipt: Pick<HaltReceipt, "outcome" | "haltReason" | "reviews" | "meta">
): string | undefined {
	const stamped = receipt.meta?.peopleSentence
	if (typeof stamped === "string" && stamped !== "") return stamped
	return rejectedAtReview(receipt) ? REVIEW_REJECTED_REASON : undefined
}

/**
 * What `reader` is shown of a halted run on `surface`: its people sentence for
 * every reader; else `said` for an administrator; else the surface's plain
 * sentence and the suggestion.
 */
export function receiptHaltFor(
	reader: ConnectionSubject | null | undefined,
	surface: HaltSurface,
	receipt: HaltReceipt,
	said: string
): string {
	const people = receiptPeopleSentence(receipt)
	if (people !== undefined) return people
	if (connectionsVisibleTo(reader)) return said
	return haltExplanationFor(reader, surface, said)
}

/**
 * Is `reader` sent the step a run stopped at? Only an administrator, and a
 * people sentence names no step.
 */
export function haltStepShownTo(
	reader: ConnectionSubject | null | undefined,
	receipt: Pick<HaltReceipt, "outcome" | "haltReason" | "reviews" | "meta">
): boolean {
	return (
		connectionsVisibleTo(reader) &&
		receiptPeopleSentence(receipt) === undefined
	)
}
