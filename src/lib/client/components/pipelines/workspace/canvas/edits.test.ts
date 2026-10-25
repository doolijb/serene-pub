import { describe, expect, test } from "vitest"
import type { SpecDocument } from "@serene-pub/sdk"
import { STORY_RESPOND_SPEC_ID, STORY_SWEEP_SPEC_ID, CORE_SPECS } from "@serene-pub/core-catalog"
import {
	addBranch,
	addClause,
	insertNode,
	moveNode,
	nextKey,
	removeBranch,
	removeClause,
	removeNode,
	renameBranch,
	renameKey,
	setInput,
	setLiteral,
	setSlotRef,
	upstreamOf,
	wire,
	extractComposite,
	insertComposite
} from "./edits"
import { flatRows, lineOf } from "./lineModel"

const build = (slug: string): SpecDocument => {
	const entry = CORE_SPECS.find((s) => s.slug === slug)
	if (!entry) throw new Error(`no core spec ${slug}`)
	return entry.build() as SpecDocument
}
/**
 * Story's reply — the real document these edits are walked over. (Adventure's
 * reply was, until it retired 2026-10-19; Story's carries the same shapes: a
 * gather of read chains, junctions, `rank` feeding the context, and maps.)
 */
const story = () => build(STORY_RESPOND_SPEC_ID)

const ref = (node: string, port: string) => ({ __ref: "data", node, port })

/**
 * a → gather g { x: [read, pick (junction on read.kind) { yes: [say], no: [] }], y: [read] } → b
 */
const fixture = (): SpecDocument => ({
	schemaVersion: 1,
	id: "test:spec/fixture",
	version: "1.0.0",
	includes: [],
	presets: [
		{ slug: "p", label: "P", values: [{ nodeKey: "g.x.read", slot: "params", value: 1 }] }
	],
	edges: [],
	input: { genre: "test:genre/a", event: "test:event/e" },
	nodes: [
		{ key: "a", kind: "query", definitionId: "d", definitionVersion: 1, config: {}, position: 0 },
		{
			key: "g.x.read",
			kind: "query",
			definitionId: "d",
			definitionVersion: 1,
			config: { scope: ref("a", "out") },
			clauseId: "g",
			clauseChain: "x",
			position: 1
		},
		{
			key: "g.x.pick.yes.say",
			kind: "task",
			definitionId: "d",
			definitionVersion: 1,
			config: { text: ref("g.x.read", "text") },
			clauseId: "g.x.pick",
			clauseChain: "yes",
			position: 3
		},
		{
			key: "g.y.read",
			kind: "query",
			definitionId: "d",
			definitionVersion: 1,
			config: { scope: ref("a", "out") },
			clauseId: "g",
			clauseChain: "y",
			position: 4
		},
		{
			key: "b",
			kind: "task",
			definitionId: "d",
			definitionVersion: 1,
			config: {
				items: [{ text: ref("g.x.pick.yes.say", "text") }, ref("g.y.read", "text")],
				prompts: { __ref: "slot", slot: "prompts", ofNode: "g.x.read" }
			},
			position: 5
		}
	],
	clauses: [
		{ id: "g", kind: "gather", mode: "parallel", chains: ["x", "y"], position: 1 },
		{
			id: "g.x.pick",
			kind: "junction",
			mode: "parallel",
			on: ref("g.x.read", "kind"),
			branches: { yes: { equals: "y" }, no: { default: true } },
			chains: ["yes", "no"],
			clauseId: "g",
			clauseChain: "x",
			position: 2
		}
	]
})

/** Every ref anywhere in the document's configs and clause ref fields. */
function allRefs(doc: SpecDocument): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = []
	const walk = (v: unknown) => {
		if (v && typeof v === "object") {
			if ("__ref" in (v as object)) out.push(v as Record<string, unknown>)
			else for (const x of Object.values(v as object)) walk(x)
		}
	}
	for (const n of doc.nodes) walk(n.config)
	for (const c of doc.clauses) walk([c.over, c.on, c.repeatWhile])
	return out
}

function expectInvariant(doc: SpecDocument) {
	const flat = flatRows(lineOf(doc).rows).map((r) => r.key)
	const all = [...doc.nodes.map((n) => n.key), ...doc.clauses.map((c) => c.id)]
	expect(new Set(flat).size).toBe(flat.length)
	expect([...flat].sort()).toEqual([...all].sort())
	const positions = [...doc.nodes.map((n) => n.position), ...doc.clauses.map((c) => c.position)]
	expect([...positions].sort((a, b) => a - b)).toEqual(all.map((_, i) => i))
	// Run order is position order.
	const posOf = new Map([
		...doc.nodes.map((n) => [n.key, n.position] as const),
		...doc.clauses.map((c) => [c.id, c.position] as const)
	])
	expect(flat.map((k) => posOf.get(k))).toEqual(flat.map((_, i) => i))
}

const posOf = (doc: SpecDocument, key: string) =>
	doc.nodes.find((n) => n.key === key)?.position ?? doc.clauses.find((c) => c.id === key)!.position

describe("insertNode", () => {
	test("after a spine node lands right after it and renumbers", () => {
		const doc = story()
		const before = JSON.stringify(doc)
		const next = insertNode(doc, {
			after: "rank",
			key: "extra",
			definitionId: "core:x",
			definitionVersion: 1,
			kind: "task"
		})
		expect(JSON.stringify(doc)).toBe(before)
		expect(posOf(next, "extra")).toBe(posOf(next, "rank") + 1)
		expect(posOf(next, "sceneNow")).toBe(posOf(next, "extra") + 1)
		expect(next.nodes.find((n) => n.key === "extra")!.clauseId).toBeUndefined()
		expectInvariant(next)
	})

	test("inside a gather chain carries clauseId and clauseChain", () => {
		const next = insertNode(story(), {
			after: "gather.history.read",
			key: "gather.history.more",
			definitionId: "core:x",
			definitionVersion: 1,
			kind: "query"
		})
		const n = next.nodes.find((x) => x.key === "gather.history.more")!
		expect(n.clauseId).toBe("gather")
		expect(n.clauseChain).toBe("history")
		const history = lineOf(next).rows.find((r) => r.key === "gather")!
		if (history.kind !== "clause") throw new Error("not a clause")
		expect(history.branches.find((b) => b.name === "history")!.rows.map((r) => r.key)).toEqual([
			"gather.history.read",
			"gather.history.more",
			"gather.history.attachments"
		])
		expectInvariant(next)
	})

	test("first in an empty container, by container", () => {
		const next = insertNode(fixture(), {
			after: null,
			container: { clauseId: "g.x.pick", chain: "no" },
			key: "g.x.pick.no.skip",
			definitionId: "d",
			definitionVersion: 1,
			kind: "task"
		})
		const n = next.nodes.find((x) => x.key === "g.x.pick.no.skip")!
		expect(n.clauseChain).toBe("no")
		expect(n.clauseKind).toBe("junction")
		expect(posOf(next, "g.x.pick.no.skip")).toBe(posOf(next, "g.x.pick.yes.say") + 1)
		expectInvariant(next)
	})

	test("refuses a taken key or one with ':'", () => {
		const spec = { after: null, definitionId: "d", definitionVersion: 1, kind: "task" }
		expect(() => insertNode(fixture(), { ...spec, key: "a" })).toThrow(/in use/)
		expect(() => insertNode(fixture(), { ...spec, key: "x:y" })).toThrow(/':'/)
	})
})

describe("removeNode", () => {
	test("removing rank in Story's reply severs the context's refs", () => {
		const doc = story()
		expect(allRefs(doc).some((r) => r.node === "rank")).toBe(true)
		const { doc: next, severed } = removeNode(doc, "rank")
		expect(next.nodes.some((n) => n.key === "rank")).toBe(false)
		expect(allRefs(next).some((r) => r.__ref === "data" && r.node === "rank")).toBe(false)
		expect(severed).toContainEqual({ key: "context", path: "relationshipsPerspectives.band" })
		expect(severed).toContainEqual({ key: "context", path: "relationshipsKnown.band" })
		expectInvariant(next)
	})

	test("a slot ref of the removed node loses its ofNode; array refs splice; presets follow", () => {
		const { doc: next, severed } = removeNode(fixture(), "g.y.read")
		const b = next.nodes.find((n) => n.key === "b")!
		expect((b.config.items as unknown[]).length).toBe(1)
		expect(severed).toEqual([{ key: "b", path: "items.1" }])
		const r = removeNode(fixture(), "g.x.read")
		const b2 = r.doc.nodes.find((n) => n.key === "b")!
		expect(b2.config.prompts).toEqual({ __ref: "slot", slot: "prompts" })
		expect(r.doc.clauses.find((c) => c.id === "g.x.pick")!.on).toBeUndefined()
		expect(r.severed).toEqual(
			expect.arrayContaining([
				{ key: "g.x.pick.yes.say", path: "text" },
				{ key: "b", path: "prompts" },
				{ key: "g.x.pick", path: "on" }
			])
		)
		expect(r.doc.presets[0].values).toEqual([])
		expectInvariant(r.doc)
	})
})

describe("moveNode", () => {
	test("swaps with the neighbour; a no-op at the ends", () => {
		const doc = story()
		const next = moveNode(doc, "sceneNow", "up")
		expect(posOf(next, "sceneNow")).toBeLessThan(posOf(next, "rank"))
		expectInvariant(next)
		const first = moveNode(doc, "input", "up")
		expect(flatRows(lineOf(first).rows).map((r) => r.key)).toEqual(
			flatRows(lineOf(doc).rows).map((r) => r.key)
		)
	})

	test("moves a clause with its members", () => {
		const next = moveNode(fixture(), "g", "up")
		expect(flatRows(lineOf(next).rows).map((r) => r.key)).toEqual([
			"g",
			"g.x.read",
			"g.x.pick",
			"g.x.pick.yes.say",
			"g.y.read",
			"a",
			"b"
		])
		expectInvariant(next)
		const inner = moveNode(fixture(), "g.x.pick", "up")
		expect(posOf(inner, "g.x.pick")).toBeLessThan(posOf(inner, "g.x.read"))
		expectInvariant(inner)
	})
})

describe("renameKey", () => {
	test("renaming the gather to reads rewrites every member and every ref", () => {
		const doc = story()
		const next = renameKey(doc, "gather", "reads")
		const keys = [...next.nodes.map((n) => n.key), ...next.clauses.map((c) => c.id)]
		expect(keys.some((k) => k === "gather" || k.startsWith("gather."))).toBe(false)
		expect(keys).toContain("reads.history.read")
		for (const r of allRefs(next)) {
			expect(String(r.node ?? "").startsWith("gather.")).toBe(false)
			expect(String(r.ofNode ?? "").startsWith("gather.")).toBe(false)
		}
		for (const n of next.nodes) expect(n.clauseId).not.toBe("gather")
		const context = next.nodes.find((n) => n.key === "context")!
		expect(context.config.cast).toEqual(ref("reads.cast.read", "cast"))
		expectInvariant(next)
	})

	test("nested clause ids, clauseIds, slot ofNode and presets move", () => {
		const next = renameKey(fixture(), "g", "h")
		expect(next.clauses.map((c) => c.id).sort()).toEqual(["h", "h.x.pick"])
		expect(next.clauses.find((c) => c.id === "h.x.pick")!.clauseId).toBe("h")
		expect(next.nodes.find((n) => n.key === "h.x.pick.yes.say")!.clauseId).toBe("h.x.pick")
		expect(next.clauses.find((c) => c.id === "h.x.pick")!.on).toEqual(ref("h.x.read", "kind"))
		const b = next.nodes.find((n) => n.key === "b")!
		expect((b.config.prompts as any).ofNode).toBe("h.x.read")
		expect(next.presets[0].values[0].nodeKey).toBe("h.x.read")
		expectInvariant(next)
	})

	test("a node rename rewrites its refs; refuses a taken key", () => {
		const next = renameKey(fixture(), "a", "start")
		expect(next.nodes.find((n) => n.key === "g.x.read")!.config.scope).toEqual(
			ref("start", "out")
		)
		expect(() => renameKey(fixture(), "a", "b")).toThrow(/in use/)
	})
})

describe("branches", () => {
	test("renameBranch rewrites member keys, nested ids and refs", () => {
		const next = renameBranch(fixture(), "g", "x", "left")
		expect(next.clauses.find((c) => c.id === "g")!.chains).toEqual(["left", "y"])
		const keys = [...next.nodes.map((n) => n.key), ...next.clauses.map((c) => c.id)]
		expect(keys.some((k) => k.startsWith("g.x."))).toBe(false)
		expect(keys).toEqual(expect.arrayContaining(["g.left.read", "g.left.pick", "g.left.pick.yes.say"]))
		expect(next.nodes.find((n) => n.key === "g.left.read")!.clauseChain).toBe("left")
		expect(next.nodes.find((n) => n.key === "g.left.pick.yes.say")!.clauseId).toBe("g.left.pick")
		expect(allRefs(next).some((r) => String(r.node ?? r.ofNode).startsWith("g.x."))).toBe(false)
		expectInvariant(next)

		const j = renameBranch(fixture(), "g.x.pick", "yes", "accept")
		expect(Object.keys(j.clauses.find((c) => c.id === "g.x.pick")!.branches!)).toEqual([
			"accept",
			"no"
		])
		expect(j.nodes.some((n) => n.key === "g.x.pick.accept.say")).toBe(true)
		expectInvariant(j)
	})

	test("addBranch and removeBranch", () => {
		const added = addBranch(fixture(), "g.x.pick", "maybe", { equals: "m" })
		const pick = added.clauses.find((c) => c.id === "g.x.pick")!
		expect(pick.chains).toEqual(["yes", "no", "maybe"])
		expect(pick.branches!.maybe).toEqual({ equals: "m" })
		expectInvariant(added)

		const { doc, severed } = removeBranch(fixture(), "g", "x")
		expect(doc.clauses.map((c) => c.id)).toEqual(["g"])
		expect(doc.nodes.map((n) => n.key).sort()).toEqual(["a", "b", "g.y.read"])
		expect(severed).toContainEqual({ key: "b", path: "items.0.text" })
		expect(severed).toContainEqual({ key: "b", path: "prompts" })
		expectInvariant(doc)
	})
})

describe("clauses", () => {
	test("addClause: an each gets chains ['item'] and requires max; a junction gets branches", () => {
		expect(() =>
			addClause(fixture(), { after: "a", id: "loopy", kind: "each", chains: [] })
		).toThrow(/max/)
		const e = addClause(fixture(), { after: "a", id: "each1", kind: "each", max: 3, chains: [] })
		const c = e.clauses.find((x) => x.id === "each1")!
		expect(c.chains).toEqual(["item"])
		expect(c.max).toBe(3)
		expect(posOf(e, "each1")).toBe(posOf(e, "a") + 1)
		expectInvariant(e)
		const j = addClause(fixture(), {
			after: "g.y.read",
			id: "g.y.route",
			kind: "junction",
			chains: ["one", "two"],
			branches: { two: { default: true } }
		})
		const jc = j.clauses.find((x) => x.id === "g.y.route")!
		expect(jc.branches).toEqual({ one: {}, two: { default: true } })
		expect(jc.clauseId).toBe("g")
		expect(jc.clauseChain).toBe("y")
		expectInvariant(j)
	})

	test("removeClause takes members and nested clauses and severs refs to them", () => {
		const { doc, severed } = removeClause(fixture(), "g")
		expect(doc.clauses).toEqual([])
		expect(doc.nodes.map((n) => n.key).sort()).toEqual(["a", "b"])
		expect(severed.filter((s) => s.key === "b").map((s) => s.path).sort()).toEqual([
			"items.0.text",
			"items.1",
			"prompts"
		])
		expectInvariant(doc)

		const adv = removeClause(story(), "gather")
		expect(allRefs(adv.doc).some((r) => String(r.node).startsWith("gather."))).toBe(false)
		expectInvariant(adv.doc)
	})
})

describe("config", () => {
	test("wire, setLiteral and setSlotRef round trip, including a deep path", () => {
		let doc = fixture()
		doc = wire(doc, "a", "deep.list.1.text", { node: "input", port: "fields" })
		const a = doc.nodes.find((n) => n.key === "a")!
		expect(Array.isArray((a.config.deep as any).list)).toBe(true)
		expect((a.config.deep as any).list[1].text).toEqual(ref("input", "fields"))
		doc = wire(doc, "a", "deep.list.1.text", null)
		expect((doc.nodes.find((n) => n.key === "a")!.config.deep as any).list[1]).toEqual({})

		doc = setLiteral(doc, "a", "limits.max", 7)
		expect((doc.nodes.find((n) => n.key === "a")!.config.limits as any).max).toBe(7)
		doc = setLiteral(doc, "a", "limits.max", undefined)
		expect(doc.nodes.find((n) => n.key === "a")!.config.limits).toEqual({})

		doc = setSlotRef(doc, "a", "prompts", { __ref: "slot", slot: "prompts", ofNode: "b" })
		expect(doc.nodes.find((n) => n.key === "a")!.config.prompts).toEqual({
			__ref: "slot",
			slot: "prompts",
			ofNode: "b"
		})
		doc = setSlotRef(doc, "a", "prompts", null)
		expect("prompts" in doc.nodes.find((n) => n.key === "a")!.config).toBe(false)

		// A clause's own refs.
		doc = wire(doc, "g.x.pick", "on", { node: "a", port: "out" })
		expect(doc.clauses.find((c) => c.id === "g.x.pick")!.on).toEqual(ref("a", "out"))
		expect(() => wire(doc, "g", "config", { node: "a", port: "out" })).toThrow()

		// The input never changed.
		expect(fixture().nodes[0].config).toEqual({})
		expectInvariant(doc)
	})

	test("setInput merges and clears", () => {
		const doc = setInput(fixture(), { event: "test:event/f", events: ["x"] })
		expect(doc.input).toEqual({ genre: "test:genre/a", event: "test:event/f", events: ["x"] })
		expectInvariant(doc)
		expect(setInput(doc, { events: undefined }).input).toEqual({
			genre: "test:genre/a",
			event: "test:event/f"
		})
	})
})

describe("upstreamOf", () => {
	test("excludes sibling branches and later nodes", () => {
		const doc = fixture()
		expect(upstreamOf(doc, "g.x.pick.yes.say")).toEqual(["a", "g", "g.x.read", "g.x.pick"])
		expect(upstreamOf(doc, "g.y.read")).toEqual(["a", "g"])
		expect(upstreamOf(doc, "b")).toEqual([
			"a",
			"g",
			"g.x.read",
			"g.x.pick",
			"g.x.pick.yes.say",
			"g.y.read"
		])
		expect(upstreamOf(doc, "a")).toEqual([])
	})

	test("in Story's reply: a gather chain sees the spine before it, never another chain", () => {
		const doc = story()
		const up = upstreamOf(doc, "gather.history.attachments")
		// `reading` is the reply's duties step (PLAN-layering §4), where the
		// retired `tasks` step stood.
		expect(up).toEqual(["input", "placeholder", "contextBudget", "reading", "gather", "gather.history.read"])
		const context = upstreamOf(doc, "context")
		expect(context).toContain("gather.cast.read")
		expect(context).toContain("rank")
		expect(context).not.toContain("lines")
	})

	// The per-entry maps are the sweep routine's (PLAN-layering lane 3), not
	// the reply's.
	test("in Story's sweep: a map's item sees the map and the item's earlier members", () => {
		const sweep = build(STORY_SWEEP_SPEC_ID)
		// Never a later member, nor the other branch's map.
		const item = upstreamOf(sweep, "sweep.due.lore.full.entry.item.content")
		expect(item).toContain("sweep.due.lore.full.entry")
		expect(item).toContain("sweep.due.lore.full.entry.item.name")
		expect(item).not.toContain("sweep.due.lore.full.entry.item.write")
		expect(item).not.toContain("sweep.due.lore.review.entry.item.name")
	})
})

describe("nextKey", () => {
	test("returns the base or the first free numbered key", () => {
		const doc = fixture()
		expect(nextKey(doc, "c")).toBe("c")
		expect(nextKey(doc, "a")).toBe("a2")
		const two = insertNode(doc, {
			after: "a",
			key: "a2",
			definitionId: "d",
			definitionVersion: 1,
			kind: "task"
		})
		expect(nextKey(two, "a")).toBe("a3")
		expect(nextKey(doc, "g")).toBe("g2")
	})
})

describe("array order", () => {
	test("after an insert the node array runs in position order, so compile's spine edges follow the line", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const next = insertNode(doc, { after: "rank", container: null, key: "rerank", definitionId: "core:task/rank-hybrid", definitionVersion: 1, kind: "task", config: {} })
		const positions = next.nodes.map((n) => n.position)
		expect(positions).toEqual([...positions].sort((a, b) => a - b))
		const i = next.nodes.findIndex((n) => n.key === "rerank")
		expect(next.nodes[i - 1].key).toBe("rank")
	})
})

describe("composite steps", () => {
	test("lifting lore…rank takes the names and retrieval clauses with it, lists outside reads, and keeps inner refs", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const comp = extractComposite(doc, { from: "lore", to: "rank" })
		const keys = comp.nodes.map((n) => n.key)
		expect(keys).toContain("lore")
		expect(keys).toContain("rank")
		expect(keys).toContain("names.arm.link")
		expect(keys).toContain("retrieval.on.eligible")
		// The retrieval junction (2026-10-19) sits between the names and rank.
		expect(comp.clauses.map((c) => c.id)).toEqual(["names", "retrieval"])
		// lore reads the gather's candidates: an outside read, listed.
		expect(comp.reads.some((r) => r.node.startsWith("gather."))).toBe(true)
		// loreLinked reads lore.main inside: kept as a ref to a member.
		const loreLinked = comp.nodes.find((n) => n.key === "loreLinked")!
		expect(JSON.stringify(loreLinked.config)).toMatch(/"node":"lore"/)
		// The heads sit on no container.
		expect(comp.nodes.find((n) => n.key === "lore")!.clauseId).toBeUndefined()
	})

	test("inserting the composite prefixes every member and rewrites the refs between them", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const comp = extractComposite(doc, { from: "lore", to: "rank" })
		const target = build(STORY_RESPOND_SPEC_ID)
		// `retrieval` is a key Story's reply already uses (its junction), so
		// the composite goes in under another.
		expect(() =>
			insertComposite(build(STORY_RESPOND_SPEC_ID), { after: "contextBudget", container: null, key: "retrieval", composite: comp })
		).toThrow(/already in use/)
		const next = insertComposite(target, { after: "contextBudget", container: null, key: "lifted", composite: comp, fragmentId: "acme.lab:composite/retrieval" })
		const keys = next.nodes.map((n) => n.key)
		expect(keys).toContain("lifted.lore")
		expect(keys).toContain("lifted.rank")
		expect(keys).toContain("lifted.names.arm.link")
		expect(next.clauses.some((c) => c.id === "lifted.names")).toBe(true)
		expect(next.clauses.some((c) => c.id === "lifted.retrieval")).toBe(true)
		const linked = next.nodes.find((n) => n.key === "lifted.loreLinked")!
		expect(JSON.stringify(linked.config)).toMatch(/"node":"lifted\.lore"/)
		expect(JSON.stringify(linked.config)).toMatch(/"node":"lifted\.names\.arm\.link"/)
		// Outside reads are untouched.
		const lore = next.nodes.find((n) => n.key === "lifted.lore")!
		expect(JSON.stringify(lore.config)).toMatch(/"node":"gather\./)
		// Placement: right after contextBudget, in run order, before the original lore.
		const flat = flatRows(lineOf(next).rows).map((r) => r.key)
		expect(flat.indexOf("lifted.lore")).toBe(flat.indexOf("contextBudget") + 1)
		expect(flat.indexOf("lifted.rank")).toBeLessThan(flat.indexOf("gather"))
		expect(next.includes.at(-1)).toEqual({ key: "lifted", fragmentId: "acme.lab:composite/retrieval" })
		// Invariant: every node and clause once, positions 0..n-1.
		const all = flatRows(lineOf(next).rows)
		expect(all.length).toBe(next.nodes.length + next.clauses.length)
		expect(new Set(all.map((r) => r.key)).size).toBe(all.length)
	})

	test("inserting into a clause branch carries the container's prefix and membership", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		// Two spine steps (the scene reads; `place`…`eligible` until
		// 2026-10-19, when `eligible` moved into the retrieval junction).
		const comp = extractComposite(doc, { from: "sceneNow", to: "scenePlaces" })
		const next = insertComposite(doc, { after: null, container: { clauseId: "gather", chain: "history" }, key: "extra", composite: comp })
		const n = next.nodes.find((x) => x.key === "gather.history.extra.sceneNow")!
		expect(n).toBeTruthy()
		expect(n.clauseId).toBe("gather")
		expect(n.clauseChain).toBe("history")
		const flat = flatRows(lineOf(next).rows).map((r) => r.key)
		expect(flat.indexOf("gather.history.extra.sceneNow")).toBeLessThan(flat.indexOf("gather.history.read"))
	})

	test("a composite lifted from inside a container loses that container's prefix", () => {
		const doc = build(STORY_RESPOND_SPEC_ID)
		const comp = extractComposite(doc, { from: "gather.history.read", to: "gather.history.attachments" })
		expect(comp.nodes.map((n) => n.key)).toEqual(["read", "attachments"])
		expect(comp.nodes[1].clauseId).toBeUndefined()
	})
})
