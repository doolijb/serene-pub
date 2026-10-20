/**
 * 🚧 **Every chat prompt ends on a user turn** (owner ruling 2026-10-18, the
 * Dungeon Crawler 100-turn walk, B1). A strict chat model — a Jinja template
 * that raises on a trailing system message, a service that answers a prompt
 * ending on its own line with nothing — returned an empty reply on every
 * Narrator call, because the prompt ended on the post-history reminder
 * (`[system] Response reminder`) or, on a round nobody spoke in, on the
 * Narrator's last line.
 *
 * The host repairs what it can, once, here — the last thing before a chat
 * request goes out, after the JSON instruction door has had its say:
 *
 *  - **system text after the conversation** (the reminder, the JSON
 *    instruction) is folded into the final user turn as a labelled aside
 *    (`foldedSystemAside`, the AN3 fold's own wording), or — after the
 *    model's own line — sent as a user turn of its own in that place;
 *  - **a prompt ending on the model's own line** gets the handoff turn the
 *    chat wire already writes between two of its lines (`speakerCue`:
 *    *[Your turn, Narrator]*) — unless the connection continues a reply on
 *    the chat wire (Anthropic's prefill), where a trailing assistant turn is
 *    how a continuation is asked for, and stays;
 *  - **a prompt with no conversation at all** (system text only) is handed
 *    the same cue when the seed line it dropped says whose turn it is.
 *
 * Anything still not ending on a user turn is refused, in a sentence, and
 * logged by the caller: sent, it is an empty reply that reads as a model
 * fault. Off the chat wire nothing here applies — a completion prompt is one
 * string that ends where the model writes.
 */

import { foldedSystemAside, speakerCue } from "$lib/shared/utils/parseSplitChatPrompt"

/** A chat message as the compiled prompt carries it. */
export interface ChatTurn {
	role: string
	content?: unknown
	[key: string]: unknown
}

export type EndOnUserTurn =
	| { ok: true; messages: ChatTurn[]; repaired: string | null }
	| { ok: false; refusal: string }

/** The sentence a prompt that cannot be repaired is refused with. */
export const NO_USER_TURN_REFUSAL =
	"this prompt has no turn for the model to answer: it ends without a user's turn, and a chat model " +
	"answers nothing to that. The prompt's template must place the conversation, or a request, after its instructions."

const textOf = (m: ChatTurn | undefined): string => (typeof m?.content === "string" ? m.content : String(m?.content ?? ""))

/** `Narrator: …` → `Narrator`; the same reading the chat wire's handoff turn uses. */
const speakerOf = (m: ChatTurn | undefined): string | null => {
	const match = textOf(m).match(/^([^:\n]+):(?:\s|$)/)
	return match ? match[1]!.trim() : null
}

/**
 * The repaired messages, or the refusal. `prefill` — the connection continues
 * a reply on the chat wire, so a trailing assistant turn is a continuation
 * and stays. `seedLabel` — whose turn it is, when the render dropped a
 * label-only seed line (`parseChatWire`).
 */
export function endOnUserTurn(
	messages: readonly ChatTurn[],
	opts: { prefill?: boolean; seedLabel?: string | null } = {}
): EndOnUserTurn {
	if (!messages.length) return { ok: true, messages: [...messages], repaired: null }
	let out = [...messages]
	const repairs: string[] = []

	// System text after the conversation: into the final user turn, or a user
	// turn of its own after the model's line. The leading run (the system
	// prompt) is never touched.
	let last = out.length - 1
	while (last >= 0 && out[last]!.role === "system") last--
	if (last >= 0 && last < out.length - 1) {
		const asides = out.slice(last + 1).map((m) => foldedSystemAside(textOf(m)))
		const before = out[last]!
		if (before.role === "user") {
			out = [...out.slice(0, last), { ...before, content: [textOf(before), ...asides].filter(Boolean).join("\n\n") }]
			repairs.push("the instructions after the conversation were folded into the last user turn")
		} else {
			out = [...out.slice(0, last + 1), { role: "user", content: asides.join("\n\n") }]
			repairs.push("the instructions after the model's last line were sent as a user turn")
		}
	}

	const end = out[out.length - 1]!
	if (end.role === "assistant" && !opts.prefill) {
		const name = speakerOf(end) ?? opts.seedLabel ?? null
		out.push({ role: "user", content: name ? speakerCue(name) : "[Your turn]" })
		repairs.push("the prompt ended on the model's own line, so the handoff turn was added")
	} else if (end.role === "system" && opts.seedLabel) {
		out.push({ role: "user", content: speakerCue(opts.seedLabel) })
		repairs.push("the prompt held only instructions, so the handoff turn was added")
	}

	// A tool result is answered by the model as it stands; only a prompt
	// still ending on instructions alone is refused.
	if (out[out.length - 1]!.role === "system") return { ok: false, refusal: NO_USER_TURN_REFUSAL }
	// Unrepaired, the very array it was handed: a request that needed nothing
	// is the bytes it was.
	return repairs.length
		? { ok: true, messages: out, repaired: repairs.join("; ") }
		: { ok: true, messages: messages as ChatTurn[], repaired: null }
}
