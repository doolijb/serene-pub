/**
 * Tool calls read off a STREAM (20 §9).
 *
 * ## The defect this closes
 *
 * Every adapter that reads native tool calls read them off the ASSEMBLED
 * response — one object, with the name and the arguments already whole. A
 * connection carrying `extraJson.stream` never reaches that object: the call
 * arrives as a series of deltas and the assembled reply is never built. So a
 * streaming connection surfaced no `toolCall` at all, a tool loop's predicate
 * never fired, and every loop ran to its declared ceiling — six requests to
 * answer one question, reported as `ok` because a bounded loop is not an error.
 *
 * ## One normaliser, not two spellings
 *
 * The streamed halves end in `normalizeToolCall`, which is the SAME function
 * `BaseConnectionAdapter.toolCallFrom` delegates to. A second spelling here
 * would be a second place for the JSON-string rule to be forgotten, and a tool
 * handed its own arguments as one long string parameter reads as a model
 * mistake rather than as ours.
 *
 * ## Two accumulators because there are two wire shapes
 *
 * OpenAI and Ollama fragment a call across `tool_calls` entries keyed by index;
 * Anthropic opens a CONTENT BLOCK, fills it with JSON fragments and closes it.
 * The events are genuinely different, so folding them into one feed method
 * would mean a discriminator inside the accumulator — the branch each adapter
 * already has for free at its own call site.
 */

import type { ToolCall } from "$lib/server/adapters/actions"

/**
 * Normalize whatever a service called its tool call into the one shape the
 * pipeline speaks — `{ tool, args }`, the same `parse-tool-call` publishes.
 *
 * Here rather than three times over because the services differ only in where
 * the name and the arguments sit, and some of them (OpenAI, and every
 * accumulated stream) send the arguments as a JSON **string**.
 */
export function normalizeToolCall(
	name: unknown,
	args: unknown
): ToolCall | null {
	if (typeof name !== "string" || !name) return null
	let parsed: unknown = args
	if (typeof args === "string") {
		try {
			parsed = JSON.parse(args)
		} catch {
			// A service that promised JSON and sent something else. The call
			// still happened and the name is still the model's intent, so the
			// tool is run with no arguments rather than the turn being lost —
			// and `run-tool` answers with whatever the tool says about that.
			parsed = {}
		}
	}
	return {
		tool: name,
		args:
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {}
	}
}

/**
 * One partially-received call, keyed by the slot it is arriving in.
 *
 * `args` stays a STRING until the call closes: `{"que` is not JSON and
 * `ry":"ashguard"}` is not either, and only their concatenation parses. A call
 * is therefore readable at the end of a stream and at no point inside it.
 */
interface PartialCall {
	order: number
	name: string
	args: string
	/** Ollama hands arguments over already parsed; there is nothing to join. */
	parsedArgs?: unknown
}

/**
 * The OpenAI/Ollama shape: `delta.tool_calls`, entries keyed by `index`.
 *
 * ⚠ **`index` is the slot, not the arrival order, and it is optional.** OpenAI
 * sends it on every entry and Ollama sends none at all, so an entry without one
 * falls back to its position in the array — which is the same slot for a
 * service that emits each call whole.
 *
 * ⚠ **`name` arrives once and `arguments` many times.** An accumulator that
 * assigned both on every delta would end holding the last fragment as the whole
 * argument object.
 */
export class ToolCallDeltaAccumulator {
	private readonly calls = new Map<number, PartialCall>()
	private seen = 0

	/** Feed one delta's `tool_calls` array. Anything else is ignored. */
	push(toolCalls: unknown): void {
		if (!Array.isArray(toolCalls)) return
		for (let i = 0; i < toolCalls.length; i++) {
			const entry: any = toolCalls[i]
			if (!entry || typeof entry !== "object") continue
			const index = typeof entry.index === "number" ? entry.index : i
			let call = this.calls.get(index)
			if (!call) {
				call = { order: this.seen++, name: "", args: "" }
				this.calls.set(index, call)
			}
			const fn = entry.function ?? entry
			if (typeof fn?.name === "string" && fn.name) call.name = fn.name
			if (typeof fn?.arguments === "string") call.args += fn.arguments
			else if (fn?.arguments && typeof fn.arguments === "object")
				// Ollama's SDK parses for us. Recorded separately so a later
				// string fragment could not be concatenated onto an object.
				call.parsedArgs = fn.arguments
		}
	}

	/**
	 * The FIRST call the model asked for, or null.
	 *
	 * First by arrival, not by index: the loop runs one tool per iteration and
	 * receipts it as one step, and a batch collapsed into one node would lose
	 * exactly the per-step timing and per-step review the loop exists to give
	 * (`TextGenResult.toolCall`).
	 */
	first(): ToolCall | null {
		let best: PartialCall | undefined
		for (const call of this.calls.values())
			if (!best || call.order < best.order) best = call
		if (!best) return null
		return normalizeToolCall(
			best.name,
			best.parsedArgs !== undefined ? best.parsedArgs : best.args
		)
	}
}

/**
 * The Anthropic shape: a `tool_use` CONTENT BLOCK, opened, filled and closed.
 *
 * `content_block_start` carries the name; `input_json_delta` carries the
 * arguments as `partial_json` fragments; `content_block_stop` ends it. A block
 * for a zero-argument tool carries `input: {}` and no delta whatsoever, which is
 * why the empty accumulation still produces a call rather than being read as
 * "nothing arrived".
 */
export class ToolUseBlockAccumulator {
	private readonly blocks = new Map<number, PartialCall>()
	private seen = 0

	/** Feed one stream event. Anything that is not a tool_use block is ignored. */
	push(event: unknown): void {
		const e: any = event
		if (!e || typeof e !== "object") return
		const index = typeof e.index === "number" ? e.index : 0
		if (
			e.type === "content_block_start" &&
			e.content_block?.type === "tool_use"
		) {
			this.blocks.set(index, {
				order: this.seen++,
				name:
					typeof e.content_block.name === "string"
						? e.content_block.name
						: "",
				args: ""
			})
			return
		}
		if (e.type === "content_block_delta") {
			const block = this.blocks.get(index)
			if (!block) return
			if (
				e.delta?.type === "input_json_delta" &&
				typeof e.delta.partial_json === "string"
			)
				block.args += e.delta.partial_json
		}
	}

	/** The first block opened, or null. Same rule as its sibling above. */
	first(): ToolCall | null {
		let best: PartialCall | undefined
		for (const block of this.blocks.values())
			if (!best || block.order < best.order) best = block
		if (!best) return null
		// An empty accumulation is `{}`, not a parse failure: a tool that takes
		// no arguments streams no fragments at all.
		return normalizeToolCall(best.name, best.args || "{}")
	}
}
