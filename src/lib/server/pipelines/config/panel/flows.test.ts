/**
 * The *Receives* / *Carries out* lines (owner ruling 2026-10-12), over a
 * hand-built graph: what a step and a set of steps say they take in and hand
 * on, in words.
 */

import { describe, it, expect } from "vitest"
import {
	effectOf,
	flowLinesOf,
	outletWriteLine,
	portLabel,
	stepFlowsOf,
	type FlowDefinition,
	type FlowGraph,
	type FlowNode
} from "$lib/server/pipelines/config/panel/flows"

const DEFS: Record<string, FlowDefinition> = {
	"core:inlet/user-message": {
		kind: "inlet",
		ports: { out: { sessionScope: "core:shape/session-scope@1", speaker: "core:shape/participant-ref@1" } }
	},
	"core:query/world-lore": {
		kind: "query",
		ports: { in: { scope: "core:shape/session-scope@1" }, out: { main: "core:shape/context-candidates@1" } }
	},
	"core:query/session-history": {
		kind: "query",
		ports: { in: { scope: "core:shape/session-scope@1" }, out: { main: "core:shape/messages@1" } }
	},
	"core:task/assemble": {
		kind: "task",
		ports: {
			in: { candidates: "core:shape/context-candidates@1", messages: "core:shape/messages@1" },
			out: { main: "core:shape/assembled-context@1" }
		},
		effects: "none"
	},
	"core:oracle/generate": {
		kind: "oracle",
		ports: { in: { context: "core:shape/assembled-context@1" }, out: { text: "core:shape/text@1" } },
		effects: "external"
	},
	"core:outlet/update-message": {
		kind: "outlet",
		ports: { in: { text: "core:shape/text@1", speaker: "core:shape/participant-ref@1" }, out: { main: "core:shape/write-result@1" } },
		effects: "write"
	},
	"plugin:outlet/stamp": { kind: "outlet", name: "Stamp the scroll", ports: { in: { text: "core:shape/text@1" } }, effects: "write" }
}

const NODES: FlowNode[] = [
	{ key: "input", kind: "inlet", definitionId: "core:inlet/user-message" },
	{ key: "world", kind: "query", definitionId: "core:query/world-lore", clauseId: "gather" },
	{ key: "history", kind: "query", definitionId: "core:query/session-history", clauseId: "gather" },
	{ key: "assemble", kind: "task", definitionId: "core:task/assemble" },
	{ key: "generate", kind: "oracle", definitionId: "core:oracle/generate" },
	{ key: "save", kind: "outlet", definitionId: "core:outlet/update-message" },
	{ key: "stamp", kind: "outlet", definitionId: "plugin:outlet/stamp" }
]

const HEADINGS: Record<string, string> = {
	world: "World lore",
	history: "Session history",
	assemble: "Assemble",
	generate: "Narrator",
	save: "Update message",
	stamp: "Stamp the scroll",
	gather: "Gather"
}

const graph: FlowGraph = {
	nodes: NODES,
	edges: [
		{ from: "input", fromPort: "sessionScope", to: "world", toPort: "scope" },
		{ from: "input", fromPort: "sessionScope", to: "history", toPort: "scope" },
		{ from: "world", fromPort: "main", to: "assemble", toPort: "candidates" },
		{ from: "history", fromPort: "main", to: "assemble", toPort: "messages" },
		{ from: "assemble", fromPort: "main", to: "generate", toPort: "context" },
		{ from: "generate", fromPort: "text", to: "save", toPort: "text" },
		{ from: "input", fromPort: "speaker", to: "save", toPort: "speaker" },
		{ from: "generate", fromPort: "text", to: "stamp", toPort: "text.body" }
	],
	definitionOf: (n) => DEFS[n.definitionId ?? ""],
	headingOf: (a) => HEADINGS[a] ?? a
}

describe("portLabel", () => {
	it("names a shape in plain words", () => {
		expect(portLabel({ port: "messages", shape: "core:shape/messages@1" })).toBe("the conversation")
		expect(portLabel({ port: "cast", shape: "core:shape/session-cast@1" })).toBe("the cast")
	})
	it("reads a source's share of the context by its band, never a number", () => {
		expect(
			portLabel({
				port: "main",
				shape: "core:shape/context-candidates@1",
				producer: { heading: "World lore", isSource: true }
			})
		).toBe("world lore, a share of the context")
		expect(portLabel({ port: "candidates", shape: "core:shape/context-candidates@1" })).toBe(
			"a share of the context"
		)
	})
	it("falls back to the port's name when the shape says little", () => {
		expect(portLabel({ port: "continuationPrefill", shape: "core:shape/text@1" })).toBe("continuation prefill")
		expect(portLabel({ port: "speaker", shape: "core:shape/participant-ref@1" })).toBe("speaker")
	})
	it("reads a generic port by the step that produces it", () => {
		expect(
			portLabel({ port: "text", shape: "core:shape/text@1", producer: { heading: "Narrator", isSource: false } })
		).toBe("narrator's text")
		expect(
			portLabel({ port: "main", shape: "core:shape/json@1", producer: { heading: "Voices", isSource: false } })
		).toBe("voices' result")
	})
	it("prefers the feeding port's shape when the receiving one says little", () => {
		expect(
			portLabel({ port: "main", shape: "core:shape/json@1", producerShape: "core:shape/write-result@1" })
		).toBe("what was saved")
	})
})

describe("one step", () => {
	it("receives its wired in-ports, naming the feeding step and not the session", () => {
		const { receives } = stepFlowsOf(graph, "save")
		expect(receives).toEqual([
			{ port: "text", shape: "core:shape/text@1", label: "narrator's text", from: "Narrator" },
			// From the inlet: the session or the event, so no `from`.
			{ port: "speaker", shape: "core:shape/participant-ref@1", label: "speaker" }
		])
	})
	it("carries out its wired out-ports, and an outlet its write", () => {
		expect(stepFlowsOf(graph, "generate").carriesOut).toEqual([
			{ port: "text", shape: "core:shape/text@1", label: "narrator's text" }
		])
		expect(stepFlowsOf(graph, "save").carriesOut).toEqual([
			{ port: "session", shape: "core:outlet/update-message", label: "saves the finished reply" }
		])
	})
	it("carries its definition's effect", () => {
		expect(stepFlowsOf(graph, "generate").effect).toBe("external")
		expect(stepFlowsOf(graph, "save").effect).toBe("write")
		expect(stepFlowsOf(graph, "world").effect).toBeUndefined()
	})
	it("reads a path into a port as the port", () => {
		expect(stepFlowsOf(graph, "stamp").receives).toEqual([
			{ port: "text", shape: "core:shape/text@1", label: "narrator's text", from: "Narrator" }
		])
	})
	it("reads an inlet asked about as what the run starts with", () => {
		expect(stepFlowsOf(graph, "input").carriesOut.map((l) => l.label)).toEqual(["the session", "speaker"])
	})
	it("reads a clause as its members, the flows between them left out", () => {
		const { receives, carriesOut, effect } = stepFlowsOf(graph, "gather")
		expect(receives.map((l) => l.label)).toEqual(["the session"])
		expect(carriesOut.map((l) => l.label)).toEqual([
			"world lore, a share of the context",
			"the conversation"
		])
		expect(effect).toBeUndefined()
	})
})

describe("a set of steps (a group)", () => {
	it("is the union of its steps' lines with the flows between them left out", () => {
		const { receives, carriesOut } = flowLinesOf(
			graph,
			new Set(["input", "gather", "world", "history", "assemble", "generate"])
		)
		// assemble ← world/history and generate ← assemble flow inside: absent.
		expect(receives).toEqual([
			{ port: "scope", shape: "core:shape/session-scope@1", label: "the session" }
		])
		expect(carriesOut).toEqual([{ port: "text", shape: "core:shape/text@1", label: "narrator's text" }])
	})
	it("never holds an inlet: what it feeds is received from the session", () => {
		const { receives } = flowLinesOf(graph, new Set(["save"]))
		expect(receives.find((l) => l.port === "speaker")?.from).toBeUndefined()
	})
	it("lists each outlet's write once, deduplicated by label", () => {
		const { carriesOut } = flowLinesOf(graph, new Set(["save", "stamp"]))
		expect(carriesOut.map((l) => l.label)).toEqual(["saves the finished reply", "stamp the scroll"])
	})
})

describe("outletWriteLine / effectOf", () => {
	it("names a known outlet's write in plain words, else by its definition's name", () => {
		expect(outletWriteLine("core:outlet/set-turn-order@1").label).toBe("sets the turn order")
		expect(outletWriteLine("core:outlet/record-event@1").label).toBe("records an event")
		expect(outletWriteLine("core:outlet/create-message@1").label).toBe("writes the reply")
		expect(outletWriteLine("core:outlet/graph-proposal@1").label).toBe("proposes a state change")
		expect(outletWriteLine("acme:outlet/ring-bell@2").label).toBe("ring bell")
	})
	it("keeps only the four declared effects", () => {
		expect(effectOf({ effects: "emit" })).toBe("emit")
		expect(effectOf({ effects: "bogus" })).toBeUndefined()
		expect(effectOf(undefined)).toBeUndefined()
	})
})
