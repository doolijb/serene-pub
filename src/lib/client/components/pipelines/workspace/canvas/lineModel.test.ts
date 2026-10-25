import { describe, expect, test } from "vitest"
import type { SpecDocument } from "@serene-pub/sdk"
import {
	STORY_RESPOND_SPEC_ID,
	STORY_SWEEP_SPEC_ID,
	CORE_SPECS,
	LAIR_REPLY_SPEC_ID
} from "@serene-pub/core-catalog"
import {
	clauseStatus,
	diffOf,
	flatRows,
	lineOf,
	portsOf,
	receiptIndex
} from "./lineModel"

const build = (slug: string): SpecDocument => {
	const entry = CORE_SPECS.find((s) => s.slug === slug)
	if (!entry) throw new Error(`no core spec ${slug}`)
	return entry.build() as SpecDocument
}

describe("lineOf", () => {
	test("every node and clause of Story's reply lands on the line exactly once", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const model = lineOf(doc)
		const flat = flatRows(model.rows)
		const keys = flat.map((r) => r.key)
		expect(new Set(keys).size).toBe(keys.length)
		expect(keys.length).toBe(doc.nodes.length + doc.clauses.length)
		expect(model.nodeCount).toBe(doc.nodes.length)
	})

	test("a gather opens into its chains, each chain in position order", () => {
		const model = lineOf(build(STORY_RESPOND_SPEC_ID))
		const gather = model.rows.find((r) => r.kind === "clause" && r.key === "gather")
		expect(gather?.kind).toBe("clause")
		if (gather?.kind !== "clause") return
		expect(gather.branches.length).toBeGreaterThanOrEqual(8)
		const history = gather.branches.find((b) => b.name === "history")!
		expect(history.rows.map((r) => r.key)).toEqual([
			"gather.history.read",
			"gather.history.attachments"
		])
		expect(model.depthOf.get("gather.history.read")).toBe(1)
		expect(model.pathOf.get("gather.history.read")).toEqual(["gather"])
	})

	test("the Lair's junctions nest: via › turn holds the channel junction", () => {
		const model = lineOf(build(LAIR_REPLY_SPEC_ID))
		const via = model.rows.find((r) => r.kind === "clause" && r.key === "via")
		expect(via?.kind).toBe("clause")
		if (via?.kind !== "clause") return
		expect(via.clause.kind).toBe("junction")
		const turn = via.branches.find((b) => b.name === "turn")!
		expect(turn.predicate?.default).toBe(true)
		const channel = turn.rows.find((r) => r.kind === "clause")
		expect(channel?.key).toBe("via.turn.channel")
		expect(model.depthOf.get("via.turn.channel")).toBe(1)
		// Something inside the story branch sits three containers deep or more.
		const deepest = Math.max(...model.depthOf.values())
		expect(deepest).toBeGreaterThanOrEqual(3)
	})
})

describe("portsOf", () => {
	test("a node's in ports name their sources and its out ports their consumers", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const ports = portsOf(doc, "gather.history.read")
		const scope = ports.in.find((p) => p.port === "scope")
		expect(scope?.from).toBe("input.sessionScope")
		expect(scope?.source).toBe("edge")
		expect(ports.in.some((p) => p.source === "slot")).toBe(true)
		expect(ports.out.length).toBeGreaterThan(0)
		for (const o of ports.out)
			for (const to of o.to) expect(to).toMatch(/^[a-zA-Z0-9.$]+\.[a-zA-Z0-9.]+$/)
	})

	// Story's reply carries no `each` (its loops are the sweep routine's,
	// PLAN-layering lane 3): the sweep's per-entry writes are the fixture.
	test("a clause's in ports are its own refs — what an each iterates over", () => {
		const doc = build(STORY_SWEEP_SPEC_ID)
		const each = doc.clauses.find((c) => c.kind === "each")!
		expect(each, "the sweep carries an each").toBeTruthy()
		const ports = portsOf(doc, each.id)
		expect(ports.in.some((p) => p.port === "over")).toBe(true)
	})

	test("edges come before slots, slots before literals", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const ports = portsOf(doc, "contextBudget")
		const order = ports.in.map((p) => p.source)
		const firstSlot = order.indexOf("slot")
		const firstLiteral = order.indexOf("literal")
		if (firstSlot >= 0) expect(order.slice(0, firstSlot)).not.toContain("literal")
		if (firstLiteral >= 0)
			expect(order.slice(firstLiteral)).not.toContain("edge")
	})
})

describe("diffOf", () => {
	test("a document against itself marks nothing", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const d = diffOf(doc, doc)
		expect(d.marks.size).toBe(0)
	})

	test("a removed node, an added node and a changed config each get their mark", () => {
		const base = build(STORY_RESPOND_SPEC_ID)
		const next: SpecDocument = JSON.parse(JSON.stringify(base))
		next.nodes = next.nodes.filter((n) => n.key !== "sceneNow")
		next.nodes.push({
			...next.nodes.find((n) => n.key === "rank")!,
			key: "rerank",
			position: 999
		})
		next.nodes.find((n) => n.key === "rank")!.config = { changed: true }
		const d = diffOf(base, next)
		expect(d.marks.get("sceneNow")).toBe("removed")
		expect(d.marks.get("rerank")).toBe("added")
		expect(d.marks.get("rank")).toBe("changed")
		expect(d.removed).toEqual(["sceneNow"])
	})
})

describe("receiptIndex", () => {
	test("iterations fold into one entry carrying the worst result", () => {
		const index = receiptIndex({
			nodes: [
				{ seq: 1, nodeKey: "input", result: "ok", elapsedMs: 1 },
				{ seq: 2, nodeKey: "voices.item.say", result: "ok", iteration: 0, elapsedMs: 10, tokens: 5 },
				{ seq: 3, nodeKey: "voices.item.say", result: "halt", iteration: 1, elapsedMs: 4, reason: "preview" },
				{ seq: 4, nodeKey: "save", result: "ok", dry: true }
			]
		})
		expect(index.get("voices.item.say")?.iterations).toBe(2)
		expect(index.get("voices.item.say")?.status).toBe("halt")
		expect(index.get("voices.item.say")?.elapsedMs).toBe(14)
		expect(index.get("voices.item.say")?.tokens).toBe(5)
		expect(index.get("save")?.status).toBe("dry")
		expect(index.get("input")?.status).toBe("ok")
	})

	test("a clause's status is the worst of its members'", () => {
		const model = lineOf(build(STORY_SWEEP_SPEC_ID))
		const each = [...model.clauses.values()].find((c) => c.kind === "each")!
		const member = [...model.pathOf.entries()].find(
			([k, path]) => path.includes(each.id) && model.nodes.has(k)
		)![0]
		const index = receiptIndex({
			nodes: [{ seq: 1, nodeKey: member, result: "err" }]
		})
		expect(clauseStatus(model, index, each.id)).toBe("err")
		// A clause the failed node is not inside reads nothing.
		const other = [...model.clauses.values()].find(
			(c) => !model.pathOf.get(member)!.includes(c.id)
		)!
		expect(other, "the sweep has a clause beside the failed one").toBeTruthy()
		expect(clauseStatus(model, index, other.id)).toBeNull()
	})
})
