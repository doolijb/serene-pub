/**
 * What a connection does with a system message that is NOT at the top of the
 * conversation — and therefore what the chat-wire message builder must do with
 * one before it is sent (AN3, owner-approved 2026-10-02).
 *
 * ## The defect this exists to close
 *
 * A context template places some system text at a DEPTH: the post-history
 * reminder (depth 0, right after the newest message), the author's note
 * (depth ~4), and depth-placed inject scripts. On the chat wire each of those
 * is its own `{role: "system"}` message in the middle of the conversation —
 * and several backends do not keep it there:
 *
 *   - **Anthropic** takes system text only as the top-level `system` field;
 *     the adapter hoists every system message there, so the depth is lost.
 *   - **Ollama** templates collect every system message into `.System`,
 *     rendered once at the top. Same loss.
 *   - **KoboldCPP, llama.cpp and LM Studio** render the model's own Jinja
 *     chat template — and Qwen's RAISES on a system message that is not
 *     first ("System message must be at the beginning"). KoboldCPP then falls
 *     back to rendering without it, so the post-history reminder and the
 *     example dialogue never reached the model at all.
 *
 * So the text is FOLDED instead, as a labelled aside, into the user message
 * right after it — else the one right before it (the depth-0 case), else a
 * user message of its own in the same place — which keeps its position in the
 * conversation on every backend. `parseSplitChatPrompt` does it, in one
 * place; this says WHEN.
 *
 * ## `keep` and `fold`, and nothing in between
 *
 *   - `keep` — the protocol honours a mid-conversation system message where
 *     it sits. OpenAI's Chat Completions does.
 *   - `fold` — it hoists or rejects one, so the builder folds it.
 *
 * Only the CHAT wire is described. On the completion wire the prompt is one
 * string in the connection's own delimiters and a mid-conversation system
 * block is rendered in place, which every flat template handles.
 *
 * ⚠ Static, like `continuesIn` and `sendsAttachments`: a fact about the code
 * and the protocol, read off the manifest so the browser can show it and no
 * adapter module is imported. A type that declares nothing answers `keep` —
 * the shape every request had before this existed.
 */

import type { WireMode } from "@serene-pub/sdk"
import { ADAPTER_MANIFEST } from "./manifest"

/** How a connection's chat wire treats a system message below the top. */
export type MidSystem = "keep" | "fold"

/**
 * The answer for one connection type on one wire.
 *
 * `keep` on the completion wire always, and for a type the manifest does not
 * describe — both are "nothing to change".
 */
export function midSystemFor(
	type: string | null | undefined,
	wireMode: WireMode | null | undefined
): MidSystem {
	if (wireMode !== "chat") return "keep"
	return (type ? ADAPTER_MANIFEST[type]?.midSystem : undefined) ?? "keep"
}
