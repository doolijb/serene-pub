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
	EMPHASIS,
	escapeRegExp,
	labelSpellings,
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
	/**
	 * 🚧 The labels of the session's other non-cast voices — the player
	 * label, the envoys this turn is not (lair fix 2, 2026-10-22). One that
	 * OPENS a reply is the transcript bleeding through (a delver's line that
	 * began *Dungeon Master: As you walk along the path…*), and comes off the
	 * front as the reply's own label does — the last guard behind the stops
	 * (`ComposeStopsInput.nonCastLabels`). Mid-reply, the stops and the cut
	 * are what hold.
	 */
	strayLabels?: readonly string[]
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
	// The labels a reply never opens with: its own, and a stray voice's.
	const front = facts?.strayLabels?.length
		? [...(facts.ownLabels ?? []), ...facts.strayLabels]
		: facts?.ownLabels
	const bounded = facts?.stops
		? trimAtSpeakerBoundary(split.content, facts.stops, front, {
				streaming
			})
		: { text: stripOwnLabel(split.content, front, { streaming }) }
	const text = facts?.strayLabels?.length
		? reanchorOwnLabel(
				bounded.text,
				split.content,
				facts.ownLabels,
				facts.strayLabels,
				streaming
			)
		: bounded.text
	// A body that is so far only a held-back label has not started yet.
	const phase: ReplyPhase =
		split.phase === "writing" && text.trim().length === 0
			? split.reasoning !== undefined
				? "reasoning"
				: "waiting"
			: split.phase
	return {
		content: text,
		reasoning: split.reasoning,
		phase,
		...("trimmedAt" in bounded && bounded.trimmedAt
			? { trimmedAt: bounded.trimmedAt }
			: {})
	}
}


/**
 * The re-anchor rule (owner, 2026-11-04: keep the text, drop both labels): a
 * reply that OPENED with a stray voice's label (`Narrator: The wind rises.`)
 * and then hands over to the speaker (`Aria: Hi there.`) loses the speaker's
 * own label where it opens a later line — first occurrence only, text kept.
 * A reply with no stray front label is untouched. While streaming, a line
 * that is so far only the start of the own label is held back until it
 * resolves.
 */
function reanchorOwnLabel(
	text: string,
	raw: string,
	own: readonly string[] | undefined,
	stray: readonly string[],
	streaming: boolean
): string {
	const names = (own ?? [])
		.map((n) => n?.trim())
		.filter((n): n is string => !!n)
	if (
		!names.length ||
		stripOwnLabel(raw, stray, { streaming: false }) === raw
	)
		return text
	const alt = names.map(escapeRegExp).join("|")
	const label = new RegExp(
		`(\\n)[ \\t]*${EMPHASIS}(?:${alt})${EMPHASIS}:${EMPHASIS}[ \\t]*`
	)
	if (label.test(text)) return text.replace(label, "$1")
	if (!streaming) return text
	const at = text.lastIndexOf("\n")
	if (at < 0) return text
	const lead = text.slice(at + 1).trimStart()
	return lead.length > 0 &&
		names.some((name) =>
			labelSpellings(name).some(
				(f) => f.length > lead.length && f.startsWith(lead)
			)
		)
		? text.slice(0, at + 1)
		: text
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
