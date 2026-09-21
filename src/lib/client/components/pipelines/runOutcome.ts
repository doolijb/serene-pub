/**
 * A run's terminal outcome, projected into what the progress card draws.
 *
 * Pure, and in a `.ts` rather than in the component (`inspector/receiptView.ts`'s
 * pattern), so "what icon, what caption" is assertable against a wire frame
 * without a socket or a DOM.
 *
 * ## Why the frame carries `outcome`
 *
 * Two flags — `cancelled` and `error` — cannot describe a terminal frame:
 * anything that is neither would draw a check mark, INCLUDING a
 * `receipt.outcome` of `err` or `halt` whose frame never set `error`
 * ("Progress card says 'Respond finished ✓' on an errored run"). So every
 * terminal frame carries its own `outcome` (`runReply.ts`, `sockets/sessions.ts`'s
 * `sessions:triggerFunction` — the only two callers of `pipelines:progress`);
 * `outcomeOf` keeps the two-flag reading only as the fallback for a future
 * caller of this same event that has not been taught to say which yet. Image
 * generation is NOT such a caller: `images:progress` is a different wire
 * event entirely, read by `ImageConnectionForm`, never by this card.
 */

import type { RunProgress } from "$lib/shared/sockets/progress"
import type { StatusText } from "@serene-pub/sdk"

export type RunOutcome = NonNullable<RunProgress["outcome"]>

/**
 * The terminal frame's outcome — its own field when the caller set one,
 * else the two-flag reading every caller used before `outcome` existed.
 * "ok" only when neither flag fired either: a frame carrying `error` with no
 * `outcome` is still a failure, never a check mark.
 */
export function outcomeOf(
	event: Pick<RunProgress, "outcome" | "cancelled" | "error">
): RunOutcome {
	if (event.outcome) return event.outcome
	if (event.cancelled) return "cancelled"
	if (event.error) return "err"
	return "ok"
}

/** The icon key the card draws for each outcome — never a check mark on `err`/`halt`. */
export type OutcomeIcon = "check" | "ban" | "warning"

export function outcomeIcon(outcome: RunOutcome): OutcomeIcon {
	if (outcome === "ok") return "check"
	if (outcome === "cancelled") return "ban"
	return "warning"
}

/**
 * The caption beside the run's title, as a locale map with `en` — the
 * component resolves the locale (`statusText`), the same way a node's own
 * status does. `halt` takes the node it stopped at as `{node}`.
 */
export function outcomeStatusText(
	outcome: RunOutcome,
	haltNodeKey?: string
): StatusText {
	if (outcome === "halt")
		return {
			i18n: { en: "halted at {node}" },
			...(haltNodeKey ? { vars: { node: haltNodeKey } } : {})
		}
	return {
		ok: { i18n: { en: "finished" } },
		cancelled: { i18n: { en: "stopped" } },
		err: { i18n: { en: "failed" } }
	}[outcome]
}
