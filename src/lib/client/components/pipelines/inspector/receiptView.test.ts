/**
 * The receipt, projected into what a run inspector draws.
 *
 * Driven by three saved receipts rather than hand-built objects: a receipt is
 * an internal record whose shape grows, and a projection asserted against a
 * literal somebody typed is a projection that agrees with the test and not
 * with the executor. The fixtures are real runs with the operator's name
 * replaced.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	blockRows,
	nodeRows,
	outputView,
	postHistoryView,
	promptView,
	verdict,
	lastStatusOf,
	portrayalsLine,
	wireView,
	type InspectedRun,
	type NodeRow,
	type ReceiptNode
} from "./receiptView"

const fixture = (name: string): InspectedRun =>
	JSON.parse(readFileSync(join(__dirname, "__fixtures__", name), "utf8"))

/** A four-stage adventure turn that ran to the end. */
const adventure = fixture("adventure-run.json")
/** The same spec stopped at its first provider, as a preview. */
const haltedPreview = fixture("halted-preview-run.json")
/** A chat turn stopped at `generate`, carrying the stop sequences. */
const chatHalt = fixture("chat-halt-run.json")

const rowOf = (rows: NodeRow[], nodeKey: string): NodeRow => {
	const row = rows.find((r) => r.nodeKey === nodeKey)
	if (!row) throw new Error(`no row for ${nodeKey}`)
	return row
}

describe("nodeRows", () => {
	it("is one row per node, in seq order", () => {
		const rows = nodeRows(adventure.receipt)
		expect(rows).toHaveLength(30)
		expect(rows.map((r) => r.seq)).toEqual(
			[...rows].map((_, i) => i).sort((a, b) => a - b)
		)
		expect(rows[0].nodeKey).toBe("input")
		expect(rows[29].nodeKey).toBe("commit.reviewed.propose")
	})

	it("sorts by seq even when the receipt does not", () => {
		const shuffled = {
			nodes: [...(adventure.receipt as any).nodes].reverse()
		}
		expect(nodeRows(shuffled).map((r) => r.seq)).toEqual(
			nodeRows(adventure.receipt).map((r) => r.seq)
		)
	})

	it("marks an oracle node and names the model the receipt recorded", () => {
		const scene = rowOf(nodeRows(adventure.receipt), "scene")
		expect(scene.isOracle).toBe(true)
		expect(scene.model).toBe("hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M")
		// A receipt from before the 2026-09-16 rename, read as written: the
		// fixture says `provider` and `core:provider/…`, and so does the row.
		expect(scene.definitionId).toBe("core:provider/generate-text@1")
	})

	it("leaves the model null when the receipt carries none", () => {
		// What a non-admin gets: `connection` is removed at the egress, so the
		// marker says a model was called and nothing about which.
		const embed = rowOf(nodeRows(chatHalt.receipt), "semantic.arm.embed")
		expect(embed.isOracle).toBe(true)
		expect(embed.model).toBeNull()
	})

	it("carries a map iteration in the row's label", () => {
		const say = rowOf(nodeRows(adventure.receipt), "voices.item.say")
		expect(say.label).toBe("voices.item.say [0]")
		expect(rowOf(nodeRows(adventure.receipt), "scene").label).toBe("scene")
	})

	it("buckets a result into a badge and keeps the word", () => {
		const rows = nodeRows(chatHalt.receipt)
		expect(rowOf(rows, "prompt").badge).toBe("ok")
		const generate = rowOf(rows, "generate")
		expect(generate.result).toBe("halt")
		expect(generate.badge).toBe("halt")
		expect(generate.reason).toBe(
			"preview: stopped before generate, nothing sent"
		)
	})

	it("buckets every other outcome the executor can record", () => {
		const rows = nodeRows({
			nodes: [
				{ nodeKey: "a", seq: 0, kind: "task", result: "err" },
				{ nodeKey: "b", seq: 1, kind: "task", result: "cancelled" },
				{ nodeKey: "c", seq: 2, kind: "task", result: "skip" }
			]
		})
		expect(rows.map((r) => r.badge)).toEqual(["error", "halt", "skip"])
	})

	it("flags the nodes whose detail has a wire or a prompt to show", () => {
		const rows = nodeRows(chatHalt.receipt)
		expect(rowOf(rows, "generate").hasWire).toBe(true)
		expect(rowOf(rows, "generate").hasPrompt).toBe(true)
		expect(rowOf(rows, "prompt").hasWire).toBe(false)
		expect(rowOf(rows, "prompt").hasPrompt).toBe(true)
		expect(rowOf(rows, "speaker").hasPrompt).toBe(false)
	})

	it("answers with nothing for a receipt that has no nodes", () => {
		expect(nodeRows(null)).toEqual([])
		expect(nodeRows({})).toEqual([])
		expect(nodeRows({ nodes: "not an array" })).toEqual([])
	})
})

/**
 * The same chat turn after `recordReplyOutcome` has had it: the adapter sent
 * the payload the run compiled, wrote the message, and the receipt says so.
 */
const sentReply = (): InspectedRun => {
	const run = JSON.parse(JSON.stringify(chatHalt)) as InspectedRun
	const receipt = run.receipt as any
	const node = receipt.nodes.find((n: any) => n.nodeKey === "generate")
	node.result = "ok"
	node.reason = "sent by the reply adapter"
	return {
		...run,
		outcome: "ok",
		haltNodeKey: null,
		haltReason: null
	}
}

describe("verdict", () => {
	it("says a run finished, and how much of it there was", () => {
		expect(verdict(adventure)).toBe("Ran all 30 nodes.")
	})

	it("names the adapter that sent a reply the pipeline only compiled", () => {
		// The reply road's `ok`: every node ran, the last one handed its prompt
		// over rather than sending it, and "Ran all 25 nodes." alone would leave
		// a reader asking which node produced the message.
		expect(verdict(sentReply())).toBe(
			"Ran all 25 nodes; the reply adapter sent generate's prompt and wrote the message."
		)
	})

	it("names a preview halt as a preview", () => {
		expect(verdict(chatHalt)).toBe(
			"Halted at generate as a preview: the adapter sent this prompt."
		)
		expect(verdict(haltedPreview)).toBe(
			"Halted at planWrite as a preview: the adapter sent this prompt."
		)
	})

	it("gives an ordinary halt its node and its reason", () => {
		expect(
			verdict({
				...adventure,
				outcome: "halt",
				haltNodeKey: "keeperWrite",
				haltReason: "the model returned nothing"
			})
		).toBe("Halted at keeperWrite: the model returned nothing.")
	})

	it("says where a failure happened", () => {
		expect(
			verdict({
				...adventure,
				outcome: "err",
				haltNodeKey: "scene",
				haltReason: "timeout after 120000ms"
			})
		).toBe("Failed at scene: timeout after 120000ms.")
	})

	it("separates a cancellation from a failure", () => {
		expect(
			verdict({
				...adventure,
				outcome: "cancelled",
				haltNodeKey: "scene",
				haltReason: null
			})
		).toBe("Stopped at scene on request.")
	})

	it("still answers when the halt names no node", () => {
		expect(
			verdict({
				...adventure,
				outcome: "halt",
				haltNodeKey: null,
				haltReason: "no connection is configured"
			})
		).toBe("Halted: no connection is configured.")
	})

	// The receipt's one status (R-19, R-21): what the run was doing when it
	// died, inside the sentence — and never on a run that finished.
	it("says what the run was doing when it was stopped, failed or halted", () => {
		const stopped = {
			...adventure,
			outcome: "cancelled",
			haltNodeKey: "generate",
			haltReason: null,
			receipt: {
				...(adventure.receipt as Record<string, unknown>),
				lastStatus: {
					nodeKey: "generate",
					text: {
						i18n: { en: "{speaker} is typing" },
						vars: { speaker: "Jasmine" }
					}
				}
			}
		}
		expect(lastStatusOf(stopped)).toEqual({
			nodeKey: "generate",
			text: {
				i18n: { en: "{speaker} is typing" },
				vars: { speaker: "Jasmine" }
			}
		})
		expect(verdict(stopped, { status: "Jasmine is typing" })).toBe(
			"Stopped at generate on request while Jasmine is typing."
		)
		expect(
			verdict(
				{
					...stopped,
					outcome: "err",
					haltReason: "the service fell over"
				},
				{ status: "Jasmine is typing" }
			)
		).toBe("Failed at generate while Jasmine is typing: the service fell over.")
		expect(
			verdict(
				{
					...stopped,
					outcome: "halt",
					haltReason: "the model returned nothing"
				},
				{ status: "Jasmine is typing" }
			)
		).toBe(
			"Halted at generate while Jasmine is typing: the model returned nothing."
		)
		// Absent on a finished run, and on a receipt from before statuses.
		expect(lastStatusOf(adventure)).toBeNull()
		expect(verdict({ ...stopped, outcome: "ok" }, { status: "Jasmine is typing" })).toBe(
			verdict({ ...stopped, outcome: "ok" })
		)
	})
})

/** A provider node carrying both an assembled payload and a recorded exchange. */
const nodeWithExchange = (): ReceiptNode => ({
	nodeKey: "generate",
	seq: 0,
	kind: "provider",
	typeId: "core:oracle/generate-text@1",
	result: "ok",
	request: {
		compiledPrompt: {
			messages: [{ role: "user", content: "who leads them?" }],
			blocks: [
				{
					source: "worldLore",
					name: "The Drowned Bell",
					tokens: 25,
					included: true
				}
			],
			promptFormat: "split_session",
			totalTokens: 25
		}
	},
	output: {
		stops: {
			sent: [{ value: "\nRell:", kind: "speaker" }],
			dropped: [],
			wire: "chat"
		},
		wire: {
			request: {
				url: "http://localhost:11434/api/chat",
				method: "POST",
				body: {
					model: "lyra",
					messages: [
						{ role: "system", content: "You are Verity." },
						{ role: "user", content: "who leads them?" }
					],
					options: { stop: ["\nRell:"] }
				}
			},
			response: {
				raw: '{"message":{"content":"Captain Vell."}}',
				streamed: true,
				chunks: 3,
				durationMs: 812,
				truncated: true
			},
			redacted: ["body.api_key"]
		}
	}
})

describe("portrayalsLine", () => {
	/** The server's named list, as `pipelines:run` sends it beside the receipt. */
	const withPortrayals = (
		portrayals: InspectedRun["portrayals"]
	): InspectedRun => ({
		...adventure,
		portrayals
	})

	it("reads 'Tom · AI · Elara · you', in the receipt's order", () => {
		const chips = portrayalsLine(
			withPortrayals([
				{ ref: "character:12", name: "Tom", by: "ai" },
				{
					ref: "character:7",
					name: "Elara",
					by: "person",
					person: { name: "Jody", you: true }
				}
			])
		)
		expect(chips.map((c) => `${c.name} · ${c.portrayedBy}`)).toEqual([
			"Tom · AI",
			"Elara · you"
		])
	})

	it("names another member, and says nobody for a participant nobody portrays", () => {
		const chips = portrayalsLine(
			withPortrayals([
				{
					ref: "character:7",
					name: "Elara",
					by: "person",
					person: { name: "Sam", you: false }
				},
				// The server never names a `none` line — the reference is
				// all it sends, and all the chip shows.
				{ ref: "character:99", name: "character:99", by: "none" },
				{ ref: "envoy:mascot", name: "mascot", by: "ai" }
			])
		)
		expect(chips.map((c) => c.portrayedBy)).toEqual(["Sam", "nobody", "AI"])
		expect(chips[1]!.name).toBe("character:99")
	})

	it("keeps the roles off the line — they are on the receipt, not in the header", () => {
		const chips = portrayalsLine(
			withPortrayals([
				{ ref: "owner", name: "owner", by: "person", person: { name: "Jody", you: true } },
				{ ref: "run-owner", name: "run-owner", by: "person", person: { name: "Jody", you: true } },
				{ ref: "character:12", name: "Tom", by: "ai" }
			])
		)
		expect(chips.map((c) => c.ref)).toEqual(["character:12"])
	})

	it("is empty for a run that pinned nobody", () => {
		expect(portrayalsLine(adventure)).toEqual([])
		expect(portrayalsLine(withPortrayals([]))).toEqual([])
	})
})

describe("wireView", () => {
	it("lists what was sent and what the wire rule held back", () => {
		const generate = rowOf(nodeRows(chatHalt.receipt), "generate")
		const wire = wireView(generate.raw)
		expect(wire).not.toBeNull()
		expect(wire!.wire).toBe("chat")
		expect(wire!.sent).toEqual([])
		expect(wire!.dropped).toHaveLength(8)
		expect(wire!.dropped[0]).toEqual({
			value: "</s>",
			kind: "format",
			why: null
		})
		expect(wire!.dropped[7]).toEqual({
			value: "Ardan Kell:",
			kind: "speaker",
			why: null
		})
		expect(wire!.structured).toBeNull()
	})

	it("names the structured-output mode when the node asked for one", () => {
		const write = rowOf(nodeRows(adventure.receipt), "planWrite")
		const wire = wireView(write.raw)
		expect(wire!.structured).toEqual({
			mode: "schema",
			capability: "json_schema"
		})
		expect(wire!.wire).toBe("chat")
		expect(wire!.dropped).toHaveLength(8)
	})

	it("carries a stop's own explanation when the receipt has one", () => {
		const wire = wireView({
			output: {
				stops: {
					sent: [
						{
							value: "###",
							kind: "explicit",
							why: "the author's own list"
						}
					],
					dropped: [],
					wire: "completions"
				}
			}
		})
		expect(wire!.sent[0].why).toBe("the author's own list")
	})

	/**
	 * The exchange itself: what the adapter rendered the prompt into, and what
	 * came back before anything was parsed out of it.
	 */
	it("reads the request and the response the adapter recorded", () => {
		const wire = wireView(nodeWithExchange())
		expect(wire!.calls).toHaveLength(1)
		const call = wire!.calls[0]
		expect(call.url).toBe("http://localhost:11434/api/chat")
		expect(call.method).toBe("POST")
		// Pretty-printed, because the tab exists to be read.
		expect(call.body).toContain('"messages": [')
		expect(call.body).toContain('"stop": [')
		expect(call.raw).toContain("Captain Vell")
		expect(call.streamed).toBe(true)
		expect(call.chunks).toBe(3)
		expect(call.durationMs).toBe(812)
		expect(call.truncated).toBe(true)
		expect(call.redacted).toEqual(["body.api_key"])
	})

	it("lists every call a node made, where it made more than one", () => {
		const one = nodeWithExchange()
		const exchange = (one.output as any).wire
		const wire = wireView({
			...one,
			output: {
				...(one.output as any),
				wire: { calls: [exchange, exchange] }
			}
		})
		expect(wire!.calls).toHaveLength(2)
		expect(wire!.calls[1].url).toBe("http://localhost:11434/api/chat")
	})

	it("shows the stop lists with no exchange, as a non-admin receives them", () => {
		const node = nodeWithExchange()
		const output = { ...(node.output as any) }
		delete output.wire
		const wire = wireView({ ...node, output })
		expect(wire!.calls).toEqual([])
		expect(wire!.wire).toBe("chat")
	})

	it("answers with nothing for a node that never reached the wire", () => {
		const lines = rowOf(nodeRows(adventure.receipt), "lines")
		expect(wireView(lines.raw)).toBeNull()
		expect(wireView(null)).toBeNull()
	})
})

describe("blockRows", () => {
	it("is one row per allocated block", () => {
		const prompt = rowOf(nodeRows(adventure.receipt), "planPrompt")
		const rows = blockRows((prompt.raw as any).output.context)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toEqual({
			source: "worldLore",
			name: "The Drowned Bell",
			tokens: 25,
			included: true,
			why: ["scored 0.554, 25 tokens", "score 0.554", "filled_scored"]
		})
	})

	it("is empty for a prompt that allocated nothing", () => {
		const prompt = rowOf(nodeRows(chatHalt.receipt), "prompt")
		expect(blockRows((prompt.raw as any).output.context)).toEqual([])
		expect(blockRows(null)).toEqual([])
	})

	it("falls back to the block's own id when it carries no name", () => {
		expect(
			blockRows({
				blocks: [{ source: "history", id: 12, tokens: 4 }]
			})
		).toEqual([
			{
				source: "history",
				name: "history #12",
				tokens: 4,
				included: false,
				why: []
			}
		])
	})
})

describe("promptView", () => {
	it("reads the payload a provider actually sent", () => {
		const scene = rowOf(nodeRows(adventure.receipt), "scene")
		const view = promptView(scene.raw, adventure.receipt)
		expect(view).not.toBeNull()
		expect(view!.source).toBe("sent")
		expect(view!.messages.map((m) => m.role)).toEqual(["user"])
		expect(view!.totalTokens).toBe(25)
		expect(view!.blocks).toHaveLength(1)
	})

	it("reads what a halted preview would have sent", () => {
		const generate = rowOf(nodeRows(chatHalt.receipt), "generate")
		const view = promptView(generate.raw, chatHalt.receipt)
		expect(view!.source).toBe("prepared")
		expect(view!.messages.map((m) => m.role)).toEqual([
			"system",
			"assistant",
			"user",
			"assistant"
		])
	})

	it("reads an assemble node's own rendered context", () => {
		const prompt = rowOf(nodeRows(adventure.receipt), "planPrompt")
		const view = promptView(prompt.raw, adventure.receipt)
		expect(view!.source).toBe("assembled")
		expect(view!.messages.map((m) => m.role)).toEqual([
			"system",
			"assistant",
			"system",
			"user"
		])
		expect(view!.promptFormat).toBe("split_session")
		expect(view!.budget).toEqual({ total: 7296, used: 25, remaining: 7271 })
	})

	it("prefers what the adapter sent over what the pipeline handed it", () => {
		const view = promptView(nodeWithExchange(), null)
		expect(view!.source).toBe("wire")
		// The turns as the adapter rendered them — the system turn is only ever
		// visible here.
		expect(view!.messages.map((m) => m.role)).toEqual(["system", "user"])
		// And the allocation stays on screen: it is the same request.
		expect(view!.blocks).toHaveLength(1)
		expect(view!.totalTokens).toBe(25)
	})

	it("reads a flat completion body as the one prompt it is", () => {
		const node = nodeWithExchange()
		const wire = (node.output as any).wire
		const view = promptView(
			{
				...node,
				output: {
					...(node.output as any),
					wire: {
						...wire,
						request: {
							...wire.request,
							url: "http://localhost:11434/api/generate",
							body: { prompt: "### Instruction:\nhi", raw: true }
						}
					}
				}
			},
			null
		)
		expect(view!.source).toBe("wire")
		expect(view!.messages).toEqual([
			{ role: "prompt", content: "### Instruction:\nhi" }
		])
	})

	it("falls back to the assembled payload when no exchange was recorded", () => {
		const node = nodeWithExchange()
		const output = { ...(node.output as any) }
		delete output.wire
		const view = promptView({ ...node, output }, null)
		expect(view!.source).toBe("sent")
	})

	it("answers with nothing for a node that never built one", () => {
		const rows = nodeRows(adventure.receipt)
		expect(
			promptView(rowOf(rows, "input").raw, adventure.receipt)
		).toBeNull()
		expect(
			promptView(rowOf(rows, "lines").raw, adventure.receipt)
		).toBeNull()
	})
})

describe("outputView", () => {
	it("shows a long string as text rather than as escaped JSON", () => {
		const scene = rowOf(nodeRows(adventure.receipt), "scene")
		const view = outputView((scene.raw as any).output)
		expect(view.texts.map((t) => t.key)).toEqual(["main", "text"])
		expect(view.texts[0].value).toContain("The Drowned Bell")
		expect(Object.keys(view.rest as object)).toEqual([
			"connection",
			"stops",
			"toolCall"
		])
	})

	it("leaves short values in the JSON half", () => {
		const generate = rowOf(nodeRows(chatHalt.receipt), "generate")
		const view = outputView((generate.raw as any).output)
		expect(view.texts).toEqual([])
		expect(Object.keys(view.rest as object)).toEqual(["stops"])
	})

	it("treats a multi-line string as text however short it is", () => {
		const view = outputView({ note: "one\ntwo", id: 4 })
		expect(view.texts).toEqual([{ key: "note", value: "one\ntwo" }])
		expect(view.rest).toEqual({ id: 4 })
	})

	it("handles an output that is not an object at all", () => {
		expect(outputView("a bare string").texts).toEqual([
			{ key: "output", value: "a bare string" }
		])
		expect(outputView(undefined).empty).toBe(true)
		expect(outputView(null).empty).toBe(true)
	})

	/**
	 * The generate node of a reply the adapter sent: the stop record the halt
	 * left, plus the reply `recordReplyOutcome` writes onto it.
	 */
	const replied = (reply: Record<string, unknown>) => ({
		...((rowOf(nodeRows(chatHalt.receipt), "generate").raw as any)
			.output as Record<string, unknown>),
		reply
	})

	it("shows the reply as text, whatever its length", () => {
		const view = outputView(
			replied({
				text: "Short.",
				finishReason: "stop",
				tokensPrompt: 1181,
				tokensCompletion: 78
			})
		)
		expect(view.texts).toEqual([
			{
				key: "reply",
				value: "Short.",
				note: "stopped on the model's end token · 1181 prompt · 78 completion"
			}
		])
		// What the line does not say stays where the rest of the output is.
		expect(Object.keys(view.rest as object)).toEqual(["stops"])
	})

	it("names the response limit as what ended a cut-off reply", () => {
		const view = outputView(
			replied({
				text: "The Ashguard ride at",
				finishReason: "length",
				tokensCompletion: 512
			})
		)
		expect(view.texts[0].note).toBe(
			"hit the response token limit · 512 completion"
		)
	})

	it("says the reasoning half of a completion count, after it", () => {
		// Said AFTER the completion count and never instead of it: this is a
		// breakdown of that number, so "480 completion · 412 reasoning" is one
		// cost read two ways rather than two costs.
		const view = outputView(
			replied({
				text: "Short.",
				tokensCompletion: 480,
				tokensReasoning: 412
			})
		)
		expect(view.texts[0].note).toBe("480 completion · 412 reasoning")
		// Said on the line, so it does not repeat in the JSON half.
		expect((view.rest as any)?.reply).toBeUndefined()
	})

	it("shows a finish reason it does not know in the service's own word", () => {
		const view = outputView(
			replied({ text: "…", finishReason: "tool_calls" })
		)
		expect(view.texts[0].note).toBe("tool_calls")
	})

	it("says nothing above a reply whose service reported nothing", () => {
		const view = outputView(replied({ text: "x", truncated: true }))
		expect(view.texts[0]).toEqual({ key: "reply", value: "x" })
		expect((view.rest as any).reply).toEqual({ truncated: true })
	})
})

describe("postHistoryView", () => {
	/** An assemble node with the decision its binding recorded. */
	const decided = (postHistory: Record<string, unknown>): ReceiptNode => ({
		nodeKey: "scenePrompt",
		seq: 0,
		kind: "task",
		typeId: "core:task/assemble@2",
		result: "ok",
		output: { postHistory }
	})

	it("says where an included reminder landed", () => {
		const view = postHistoryView(
			decided({
				included: true,
				reason: "included",
				trigger: 0,
				depth: 0,
				targetIndex: 12,
				hasCharInstructions: false,
				hasExampleDialogue: false
			})
		)
		expect(view).toEqual({
			source: "decision",
			included: true,
			line: "Post-history reminder: included at message 12",
			notes: []
		})
	})

	it("says which two numbers suppressed one", () => {
		const view = postHistoryView(
			decided({
				included: false,
				reason: "below_token_trigger",
				historyTokens: 278,
				trigger: 100000,
				depth: 0,
				targetIndex: 12,
				hasCharInstructions: false,
				hasExampleDialogue: false
			})
		)
		expect(view!.included).toBe(false)
		expect(view!.line).toBe(
			"Post-history reminder: suppressed, 278 tokens is below the 100000 trigger"
		)
	})

	it("names what a suppressed block took down with it", () => {
		const view = postHistoryView(
			decided({
				included: false,
				reason: "below_token_trigger",
				historyTokens: 278,
				trigger: 100000,
				depth: 0,
				targetIndex: 12,
				hasCharInstructions: true,
				hasExampleDialogue: true
			})
		)
		expect(view!.notes).toEqual([
			"Character reminder suppressed with it",
			"Example dialogue suppressed with it"
		])
	})

	it("names what an included block carries", () => {
		const view = postHistoryView(
			decided({
				included: true,
				reason: "included",
				historyTokens: 278,
				trigger: 100,
				depth: 0,
				targetIndex: 12,
				hasCharInstructions: true,
				hasExampleDialogue: true
			})
		)
		expect(view!.notes).toEqual([
			"Includes the character reminder",
			"Includes the example dialogue"
		])
	})

	it("separates a configuration with no reminder from a suppressed one", () => {
		const view = postHistoryView(
			decided({
				included: false,
				reason: "empty",
				trigger: 0,
				depth: 0,
				targetIndex: 12,
				hasCharInstructions: false,
				hasExampleDialogue: false
			})
		)
		expect(view!.line).toBe(
			"Post-history reminder: none in this configuration"
		)
	})

	it("labels the context node's copy as the one that has not been gated", () => {
		const view = postHistoryView({
			nodeKey: "sceneContext",
			seq: 0,
			kind: "task",
			typeId: "core:task/build-template-context@1",
			result: "ok",
			output: {
				templateContext: {
					postHistory: {
						targetIndex: 0,
						instructions: "Write one reply only.",
						hasContent: true,
						gatedBy: "assemble"
					}
				}
			}
		})
		expect(view).toEqual({
			source: "carried",
			included: true,
			line: "Post-history reminder: carried, gated at assemble",
			notes: []
		})
	})

	it("claims nothing about a receipt recorded before the decision was kept", () => {
		// The saved runs predate the field. An inspector that inferred a verdict
		// from the ungated copy beside it would report the opposite of what the
		// prompt shows.
		const rows = nodeRows(chatHalt.receipt)
		expect(postHistoryView(rowOf(rows, "prompt").raw)).toBeNull()
		expect(postHistoryView(rowOf(rows, "context").raw)).toBeNull()
		expect(
			postHistoryView(rowOf(nodeRows(adventure.receipt), "scene").raw)
		).toBeNull()
	})

	it("answers with nothing for a node that has no output at all", () => {
		expect(postHistoryView(null)).toBeNull()
		expect(postHistoryView({ nodeKey: "input", seq: 0 })).toBeNull()
	})
})
