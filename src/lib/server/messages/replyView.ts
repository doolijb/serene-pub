/**
 * What a reply IS, from what the model has sent so far — the one rule the live
 * row and the stored reply share.
 *
 * A streamed reply is read twice: frame by frame while it streams (the live
 * row, `pipelines/runtime/liveRow.ts`) and once when it ends (the dispatch's
 * result, `pipelines/runtime/dispatch.ts`, which is what the save writes). Two
 * readings that each split reasoning from the body, and each took the
 * speaker's own label off the front, could disagree — a reader watched the
 * reasoning stream into the body and then jump into the fold, or watched a
 * `Verity:` label the record then dropped. So both call this, with the same
 * facts, and differ only in `final`:
 *
 *  1. **Reasoning** — `splitReasoningStream`: the buffer's own delimiters, the
 *     service's native trace, and whether the REQUEST opened a block before the
 *     first token (`ReplyFacts.opensInReasoning`). Never a reading of what the
 *     text looks like.
 *  2. **The speaker boundary** — `trimAtSpeakerBoundary`: the speaker's own
 *     label off the front (`stripOwnLabel`), and the reply cut where another
 *     participant's line begins. After the split, never before: a `Name:` line
 *     inside a reasoning trace is the model talking to itself.
 *
 * The phase rides along so the status (*{speaker} is reasoning* → *is typing*)
 * follows the same split as the text.
 */

import {
	endsInsideReasoning,
	splitReasoningStream,
	type ReasoningOpening,
	type ReplyPhase
} from "$lib/shared/utils/reasoningDelimiters"
import {
	stripOwnLabel,
	trimAtSpeakerBoundary,
	type ComposedStops,
	type ReplyTrim
} from "$lib/server/connections/stops"

/** What the request said about the reply, known before its first token. */
export interface ReplyFacts {
	/** The request opened a reasoning block before the first token. */
	opensInReasoning?: ReasoningOpening
	/** The composed stops — whose `speaker` labels end a runaway reply. */
	stops?: ComposedStops
	/** Every name the speaking turn is labelled with (`ownLabelsFor`). */
	ownLabels?: readonly string[]
}

export interface ReplyView {
	/** The body: no reasoning, no delimiter, no own label, no runaway. */
	content: string
	reasoning: string | undefined
	phase: ReplyPhase
	/** Where the speaker boundary cut, when it did. */
	trimmedAt?: ReplyTrim
}

export function replyView(
	buffer: string,
	nativeReasoning: string | undefined,
	facts: ReplyFacts | undefined,
	opts: { final: boolean }
): ReplyView {
	const split = splitReasoningStream(buffer, nativeReasoning, {
		opensInReasoning: facts?.opensInReasoning,
		final: opts.final
	})
	const streaming = !opts.final
	const bounded = facts?.stops
		? trimAtSpeakerBoundary(split.content, facts.stops, facts.ownLabels, {
				streaming
			})
		: { text: stripOwnLabel(split.content, facts?.ownLabels, { streaming }) }
	// A body that is so far only a held-back label has not started yet.
	const phase: ReplyPhase =
		split.phase === "writing" && bounded.text.trim().length === 0
			? split.reasoning !== undefined
				? "reasoning"
				: "waiting"
			: split.phase
	return {
		content: bounded.text,
		reasoning: split.reasoning,
		phase,
		...("trimmedAt" in bounded && bounded.trimmedAt
			? { trimmedAt: bounded.trimmedAt }
			: {})
	}
}

/**
 * Whether the payload being sent ends inside an open reasoning block — a
 * completion prompt ending `…<think>\n`, or a chat payload whose trailing
 * assistant turn does. Certain when true: the model's first token is reasoning
 * and only the close will ever be written (`ReasoningOpening` `prompt`).
 */
export function promptOpensReasoning(compiled: unknown): boolean {
	const payload = compiled as { prompt?: unknown; messages?: unknown } | null
	if (Array.isArray(payload?.messages) && payload.messages.length) {
		const last = payload.messages[payload.messages.length - 1] as {
			role?: unknown
			content?: unknown
		}
		return (
			last?.role === "assistant" &&
			typeof last.content === "string" &&
			endsInsideReasoning(last.content)
		)
	}
	return typeof payload?.prompt === "string"
		? endsInsideReasoning(payload.prompt)
		: false
}
