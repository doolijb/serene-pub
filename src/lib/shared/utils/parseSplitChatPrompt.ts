import type { ChatCompletionMessageParam } from "openai/resources/index.mjs"
import { ROLE_MARKER_PATTERN } from "$lib/shared/utils/PromptBlockFormatter"
import { liftMediaMarkers } from "$lib/shared/utils/mediaMarkers"
import type { MidSystem } from "$lib/shared/connectionAdapters/midSystem"

// Every rendered message block follows the same "Name: message" convention
// (see assistantBlock/userBlock in defaults.ts's context templates) — used
// to pull the upcoming speaker's name back out for the synthetic handoff
// turn below, so it can address them by name instead of a generic directive.
// The trailing `(?:\s|$)` (not just `\s`) matters: the seed/placeholder turn
// at the very end of a prompt renders as a bare "Name:" with no message yet
// (an empty continuation to be completed) — content is `.trim()`-med
// upstream, so there's no trailing space left for a plain `\s` to match.
const SPEAKER_NAME_PATTERN = /^([^:\n]+):(?:\s|$)/

function extractSpeakerName(content: string): string | null {
	const match = content.match(SPEAKER_NAME_PATTERN)
	return match ? match[1].trim() : null
}

/**
 * How the chat wire wants the parsed messages shaped (B2, 2026-10-03).
 *
 * Both default to the shape this function has always returned, so a caller
 * with no connection in scope — the template editor's preview, the parity
 * harness — gets exactly the messages it got before. Only the assemble node,
 * rendering FOR a chat-wire connection, asks for anything else.
 */
export interface ChatWireShape {
	/**
	 * What to do with a system message below the top of the conversation
	 * (AN3) — `fold` it into the user message beside it as a labelled aside,
	 * or `keep` it where it sits. From the connection type's manifest entry,
	 * `midSystemFor` in `$lib/shared/connectionAdapters/midSystem`.
	 */
	midSystem?: MidSystem
	/**
	 * What to do with a trailing assistant message that is ONLY a speaker's
	 * label — the template's seed line, `Aria:`, with nothing after it.
	 *
	 * `drop` on the chat wire. There the seed line is not a prefill the model
	 * writes into but a whole turn the backend's chat template renders, and it
	 * renders it differently as the trailing turn than it does the same turn
	 * as history (Qwen's puts it after `<think>\n\n</think>` — or, with
	 * thinking on, INSIDE the think block). So the prompt of turn N was never a
	 * prefix of turn N+1's, and a backend that reuses its cache only on an
	 * exact prefix reprocessed the previous reply on every turn.
	 *
	 * Whose turn it is still has to be said where it is not already plain —
	 * see `SPEAKER_CUE` below. A seed carrying text (the extend verb's
	 * partial) is a real prefill and is never dropped.
	 */
	labelSeed?: "keep" | "drop"
}

/** A trailing assistant message that is a label and nothing else — `Aria:`. */
const LABEL_ONLY = /^[^:\n]+:$/

/**
 * The aside a folded system message becomes inside a user message.
 *
 * Bracketed and labelled, so a model reading the user's turn can tell the
 * person's words from the instructions riding with them — the same reason the
 * synthetic handoff turn is bracketed.
 */
export const foldedSystemAside = (text: string): string =>
	`[System note]\n${text}\n[/System note]`

/**
 * The words that say whose turn it is when the seed line is not sent.
 *
 * Deliberately the handoff turn's own wording (see `parseSplitChatPrompt`):
 * one spelling for "this speaker is next", and one that does not read as an
 * instruction to move the story on.
 */
export const speakerCue = (name: string): string => `[Your turn, ${name}]`

/**
 * Fold every system message below the leading run into a user message (AN3).
 *
 * The leading run is merged into ONE system message — a template is free to
 * open with several system blocks, and a Jinja template that raises on a
 * second system message raises on a second one at the top just the same.
 *
 * Each later run of system messages keeps its exact position, as a labelled
 * aside: prepended to the user message right after it, else appended to the
 * user message right before it (the depth-0 reminder, after the newest line),
 * else — between two of the model's own lines, or at the end after one —
 * sent as a user message of its own in that place. The order of several
 * asides is kept.
 */
function foldMidSystem(
	messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
	let lead = 0
	while (lead < messages.length && messages[lead].role === "system") lead++
	const head: ChatCompletionMessageParam[] = []
	if (lead > 0)
		head.push(
			lead === 1
				? messages[0]
				: ({
						role: "system",
						content: messages
							.slice(0, lead)
							.map((m) => String(m.content ?? ""))
							.join("\n\n")
					} as ChatCompletionMessageParam)
		)
	const rest = messages.slice(lead)
	if (!rest.some((m) => m.role === "system")) return [...head, ...rest]

	const withAsides = (
		m: ChatCompletionMessageParam,
		pre: string[],
		post: string[]
	): ChatCompletionMessageParam =>
		({
			...m,
			content: [
				...pre.map(foldedSystemAside),
				String(m.content ?? ""),
				...post.map(foldedSystemAside)
			]
				.filter((p) => p !== "")
				.join("\n\n")
		}) as ChatCompletionMessageParam

	const out: ChatCompletionMessageParam[] = []
	let pending: string[] = []
	for (let i = 0; i < rest.length; i++) {
		const m = rest[i]
		if (m.role === "system") {
			pending.push(String(m.content ?? ""))
			if (rest[i + 1]?.role === "system") continue
			const next = rest[i + 1]
			const prev = out[out.length - 1]
			if (next?.role === "user") continue // prepended below
			if (prev?.role === "user")
				out[out.length - 1] = withAsides(prev, [], pending)
			else
				out.push({
					role: "user",
					content: pending.map(foldedSystemAside).join("\n\n")
				})
			pending = []
			continue
		}
		if (pending.length && m.role === "user") {
			out.push(withAsides(m, pending, []))
			pending = []
			continue
		}
		out.push(m)
	}
	return [...head, ...out]
}

/**
 * Parse a split chat prompt into OpenAI chat format.
 * Injects a synthetic handoff user turn between consecutive assistant
 * messages — chat completion APIs (Ollama, OpenAI, etc.) reject requests with
 * 2+ adjacent same-role messages, which happens in multi-character chats where
 * several characters (or a character then the Narrator) respond in a row.
 *
 * The handoff turn names the upcoming speaker directly — "[Your turn,
 * Narrator]" rather than a generic "[Continue]" — deliberately avoiding any
 * wording that reads as an instruction to advance the plot/story. A literal
 * "[Continue]" was found to actively undermine a Narrator config's own "do
 * not move the plot forward" instruction: the model doesn't distinguish a
 * synthetic structural bridge from a real user directive, so the last thing
 * it sees before generating was, in effect, being told to keep the story
 * moving — the opposite of what a narrate-only turn needs.
 *
 * Merging consecutive same-role turns into one combined message was
 * considered and rejected — that teaches the model multiple named speakers
 * can share a single turn, eroding the one-turn-one-speaker boundary the
 * rest of the prompt structure relies on to keep voices separate.
 *
 * ## The chat wire's two adjustments (`shape`)
 *
 * In order: a label-only seed line is dropped (`labelSeed: "drop"`), system
 * text below the top is folded (`midSystem: "fold"`), the handoff turns above
 * are inserted, and then — only when a seed was dropped — whose turn it is
 * is said, if the conversation does not already make it plain:
 *
 *   - **One assistant voice** (every line the model wrote is the seed's
 *     speaker's): nothing. The system prompt names who the model plays, and
 *     adding a cue would put a turn-specific line at the end of a prompt the
 *     next turn must start with — the cache-prefix property this exists for.
 *   - **Several voices** (a group, or a narrator beside a character): the
 *     cue, appended to the last user message or, when the conversation ends
 *     on the model's own lines, as the handoff turn the run of them already
 *     gets.
 */
export function parseSplitChatPrompt(
	prompt: string,
	shape: ChatWireShape = {}
): ChatCompletionMessageParam[] {
	return parseChatWire(prompt, shape).messages
}

/**
 * `parseSplitChatPrompt`, plus the label of a seed line it did not send.
 *
 * The label still matters after the line is gone: it is whose reply this is,
 * and the reply's own copy of it is stripped off by `stripOwnLabel` — which
 * reads it from the payload (`seedLabelOf`). A narrator's or an envoy's name
 * is known nowhere else at that point, so it rides the payload as `seedLabel`.
 */
export function parseChatWire(
	prompt: string,
	shape: ChatWireShape = {}
): { messages: ChatCompletionMessageParam[]; seedLabel?: string } {
	const blocks = prompt.split(
		new RegExp(`(?=${ROLE_MARKER_PATTERN}\\s*)`, "g")
	)
	let parsed = blocks
		.map((block) => {
			const match = block.match(
				new RegExp(`^${ROLE_MARKER_PATTERN}\\s*([\\s\\S]*)$`)
			)
			if (!match) return null
			// 🚧 Media markers (PLAN-composer-attachments §3.5.4): lifted off
			// THIS block onto its own message, in order, and removed from the
			// text — so a history line's image rides that line's turn. Only
			// placement writes a live marker; every other value a template
			// renders is neutralised first (`neutralizeRenderScope`). A block
			// with none is the object it always was: no `attachments` key.
			const { content, uuids } = liftMediaMarkers(match[2].trim())
			return uuids.length
				? {
						role: match[1],
						content,
						attachments: uuids.map((uuid) => ({ uuid }))
					}
				: { role: match[1], content }
		})
		.filter(Boolean) as ChatCompletionMessageParam[]

	// The seed line, when it is only a label and the wire does not want it.
	let cueFor: string | null = null
	let seedLabel: string | undefined
	const last = parsed[parsed.length - 1]
	if (
		shape.labelSeed === "drop" &&
		last?.role === "assistant" &&
		typeof last.content === "string" &&
		LABEL_ONLY.test(last.content.trim())
	) {
		const seedName = last.content.trim().slice(0, -1).trim()
		seedLabel = seedName
		parsed = parsed.slice(0, -1)
		const otherVoice = parsed.some(
			(m) =>
				m.role === "assistant" &&
				(extractSpeakerName(String(m.content ?? "")) ?? seedName) !==
					seedName
		)
		if (otherVoice) cueFor = seedName
	}

	if (shape.midSystem === "fold") parsed = foldMidSystem(parsed)

	// Only inject synthetic handoff turns in the trailing run of assistant
	// messages (i.e. after the last user message). Older history is left intact
	// so the model's perception of the conversation structure is not distorted.
	const lastUserIdx = parsed.reduce(
		(acc, msg, i) => (msg.role === "user" ? i : acc),
		-1
	)
	const head = lastUserIdx >= 0 ? parsed.slice(0, lastUserIdx + 1) : []
	const tail = parsed.slice(lastUserIdx + 1)

	const fixedTail: ChatCompletionMessageParam[] = []
	for (const msg of tail) {
		const prev = fixedTail[fixedTail.length - 1]
		if (prev && prev.role === msg.role) {
			const upcomingSpeaker = extractSpeakerName(
				(msg.content as string) ?? ""
			)
			fixedTail.push({
				role: "user",
				content: upcomingSpeaker
					? speakerCue(upcomingSpeaker)
					: "[Your turn]"
			})
		}
		fixedTail.push(msg)
	}

	const out = [...head, ...fixedTail]
	if (cueFor !== null) {
		const cue = speakerCue(cueFor)
		const end = out[out.length - 1]
		if (end?.role === "user" && typeof end.content === "string")
			out[out.length - 1] = {
				...end,
				content: end.content === cue ? cue : `${end.content}\n\n${cue}`
			} as ChatCompletionMessageParam
		else out.push({ role: "user", content: cue })
	}
	return seedLabel === undefined ? { messages: out } : { messages: out, seedLabel }
}

/**
 * A history entry's date, as the key a template sees.
 *
 * `2024`, `2024-03`, `2024-03-07` — the parts that exist, and no placeholders
 * for the ones that do not, because a lorebook that only records a year should
 * not render as though it recorded a day.
 *
 * Lifted out of the 0.5 keyword path, where it was private, so the pipeline's
 * assembler produces the same keys rather than a second formatting of the same
 * data. Two implementations of a date key is two sets of `{{#if}}` branches in
 * a user's story string that quietly stop matching.
 */
