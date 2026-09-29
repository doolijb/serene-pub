/**
 * Whether a request is sent as a stream, as the AUTHOR of a node says it.
 *
 * ## Two values, and why there is no third
 *
 * `auto` is the connection's own answer — `extraJson.stream`, whose default
 * differs per adapter (`|| false` on Ollama, OpenAI, llama.cpp and LM Studio;
 * `?? true` on KoboldCPP and Anthropic). A node set to `auto` sends exactly
 * what it sent before this parameter existed, which is what makes the default
 * safe to ship on published pins.
 *
 * `off` forces the single-request branch, which every text adapter has and
 * every image backend can do by simply not being polled. It is the cheap answer
 * for a step nobody is watching — a summarizer, a state keeper, a planner.
 *
 * There is deliberately no `on`. Turning streaming ON is a claim about the
 * connection rather than about this step: an adapter with no streaming branch
 * could not honour it, and the node has nowhere to report that it did not. Only
 * `off` is deliverable everywhere, so only `off` is offered.
 *
 * ## Why an unknown value reads as `auto`
 *
 * The mode arrives from a stored config row, which is `jsonb` and is written by
 * a panel. An unrecognised string means an author's intent that this build
 * cannot act on, and falling back to the connection's answer is the one
 * interpretation that cannot change what a working pipeline sends.
 */
export type StreamingMode = "auto" | "off"

/** Read a stored value as a mode. Anything that is not `off` is `auto`. */
export function streamingModeFrom(value: unknown): StreamingMode {
	return value === "off" ? "off" : "auto"
}
