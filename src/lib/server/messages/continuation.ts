/**
 * Joining a continuation onto the text it continues — the one seam.
 *
 * ## Why there is a join at all
 *
 * A continue prompts the model with the partial reply on the **seed line** (the
 * `-2` placeholder, `prompt/messages.ts`), so what comes back is the
 * continuation and not the whole message. The stored row still has to end up
 * holding both, and the row is written by `generateResponse.ts` — three times
 * per turn (mid-stream, final, non-streamed), which is why this is a function
 * and not three expressions that agree by review.
 *
 * ## ⚠ What each wire mode actually does with the prefill
 *
 * Not the same thing, and the difference is a fact about the endpoint rather
 * than about this code:
 *
 * - **Completion wire mode** — a true prefill. The seed's assistant block is the
 *   one block in the whole prompt rendered with `includeClose: false`
 *   (`contextHandlebarsHelpers.ts`, keyed on the `-2` id), so the prompt ends
 *   `…<assistant-open>Alice: the rain had just` with nothing after it and the
 *   model continues the string. This is the case the join is written for.
 * - **Chat wire mode, OpenAI-compatible** (OpenAI, KoboldCPP's chat mode,
 *   LM Studio, Ollama, llama.cpp) — the seed arrives as a trailing
 *   `{role: "assistant"}` message and is forwarded verbatim. The Chat
 *   Completions API has no prefill concept: whether the server continues that
 *   turn or opens a new one is the server's chat template's decision, so an
 *   echoed prefix is a normal outcome here rather than a malfunction.
 * - **Chat wire mode, Anthropic** — the Messages API *does* support assistant
 *   prefill, and this app does not use it: `AnthropicAdapter` requires the last
 *   message to be a user turn and appends `{role: "user", content: "Please
 *   continue."}` after the seed. So the model sees the partial as its own
 *   previous turn plus an instruction — which continues correctly and echoes
 *   more often than the completion path does.
 *
 * Echoing is therefore expected on two of the three paths, which is why the
 * echo case below is the first thing this function tests rather than a
 * defensive afterthought.
 *
 * ## The trimmed-prefill invariant (ruling 2026-09-08)
 *
 * Since that ruling the text this is handed has already had its edge whitespace
 * removed twice: `messages/store.ts` trims every committed body on save, and
 * `prompt/messages.ts` trims the seed again before the model ever sees it. So
 * `prefill` normally arrives with nothing to trim, and the `trimEnd` below
 * stands for the two cases that escape the rule — a row written before the
 * ruling, and a mid-stream partial, which the store deliberately leaves
 * untouched because the frames split anywhere.
 *
 * That invariant does **not** change what this function returns. The signal a
 * mid-word join would need was never on this side of the seam (see the note on
 * the space below), so the trim removed nothing this could have used, and every
 * case here answers exactly as it did before.
 */

/**
 * The stored text for a continued message: what was there, plus what came back.
 *
 * @param prefill the text already on the row — what the model was asked to
 *   continue. Empty means this is not a continue and `generated` stands alone.
 * @param generated the model's reply, already stripped of the start string and
 *   of any reasoning block by the caller.
 */
export function joinContinuation(prefill: string, generated: string): string {
	if (!prefill) return generated

	const before = prefill.trimEnd()
	const after = generated.trimStart()

	// The model repeated what it was given before carrying on — the normal
	// outcome on both chat paths above. Its version IS the whole message, and
	// taking it wholesale is what keeps the seam invisible: splicing the tail
	// onto the stored prefill instead would insert a separator in the middle of
	// the model's own sentence (`"…world" + " " + ", she said"`).
	if (after.startsWith(before)) return after

	// Nothing came back. The row keeps exactly what it had rather than gaining a
	// trailing separator.
	if (!after) return prefill

	/**
	 * Exactly one space, never two.
	 *
	 * ⚠ **And never zero, which is the known limitation.** When the model
	 * continues *mid-word* — the completion path's prefill can end anywhere,
	 * including "the sto" — the correct seam is no separator at all, and the
	 * only statement anyone makes about that is whether the model's own first
	 * character was a space. That signal is gone before this is called: the
	 * caller trims the reply's leading whitespace so the reasoning parser can
	 * see a leading `<think>` at position 0, and the signal is meaningless on
	 * the two chat paths anyway, where the model is answering a message rather
	 * than continuing a line. So a space it is — which is what shipped before
	 * the prefill reached the model at all, and is wrong in the same rare place
	 * it was already wrong.
	 *
	 * The 2026-09-08 ruling made this an **accepted** limitation rather than an
	 * open one: mid-word continues cannot be told apart from ordinary ones, so
	 * the fix chosen was to guarantee the prefill is clean at both ends of the
	 * round trip instead of guessing at the seam. `"the sto"` + `"re."` still
	 * joins as `"the sto re."`, and no heuristic belongs here to pretend
	 * otherwise.
	 */
	return before + " " + after
}
