/**
 * Use case 109 — dev mode: entry file in, memory-only overlay out, hot reload (13 §11).
 *
 * The reason this file exists is the collision: a loader that evaluates `src/index.ts` looks
 * exactly like the thing F6 forbids. It is not, and the difference is testable rather than
 * rhetorical — core still receives a manifest and documents, and the overlay writes nothing.
 */

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
	spec,
	slot,
	ok,
	pin,
	describeTaskType,
	S,
	defineExtension,
	pipelineHook,
	component,
	devOverlay,
	reloadPlan,
	DEV_INVARIANTS,
	run
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { publish as publishDoc } from "./helpers.js"

const rollA = pin(
	describeTaskType({
		id: "dev.demo:roll@1",
		timeoutMs: 200,
		ports: { in: { n: S.json }, out: { main: S.json } }
	})
)
const rollB = pin(
	describeTaskType({
		id: "dev.demo:roll-two@1",
		timeoutMs: 200,
		ports: { in: { n: S.json }, out: { main: S.json, total: S.json } }
	})
)

const pipeline = (id: string) =>
	spec(id, { version: "1.0.0" })
		.input("input", C.userMessage.v1())
		.query("history", ($) => C.chatHistory.v1({ scope: $.input.chatScope }))
		.task("prompt", ($) =>
			C.assemble.v2({ candidates: $.history.messages })
		)
		.provider("generate", ($) =>
			C.generateText.v1({
				context: $.prompt.context,
				connection: slot.connection()
			})
		)
		.build()

const ext = (over: Partial<Parameters<typeof defineExtension>[0]> = {}) =>
	defineExtension({
		slug: "dev.demo",
		name: "Dev Demo",
		version: "0.0.1",
		hooks: [pipelineHook(rollA, async () => ok({ main: 1 }))],
		components: [
			component({
				surface: "core:surface/chat-message@1",
				slug: "dice",
				label: "Dice",
				framework: "svelte",
				entry: "./Dice.js"
			})
		],
		pipelines: [pipeline("dev.demo:turn")],
		...over
	})

describe("109 · dev overlay and hot reload", () => {
	test("an overlay is data — documents and rows, not an Extension", () => {
		const o = devOverlay(ext(), "/src/index.ts", 1)
		// This is the F6 reconciliation, checked: core receives what an installed plugin
		// hands it. Dev mode changes where the data was produced, not what core gets.
		assert.equal(o.documents[0]!.schemaVersion, 1)
		assert.ok(
			o.documents[0]!.edges.length > 0,
			"compiled, not a builder chain"
		)
		assert.equal(o.types[0]!.id, "dev.demo:roll")
		assert.equal(
			JSON.stringify(o.types).includes("function"),
			false,
			"rows are data"
		)
	})

	test("the overlay is marked dev, so a receipt can say where it came from", () => {
		const o = devOverlay(ext(), "/src/index.ts", 1)
		assert.equal(o.source, "dev")
		assert.equal(o.types[0]!.release, "dev")
		assert.equal(o.types[0]!.owner, "dev.demo")
	})

	test("changing a handler is hot — that is the loop a developer is in", () => {
		const a = devOverlay(ext(), "/src/index.ts", 1)
		const b = devOverlay(
			ext({ hooks: [pipelineHook(rollA, async () => ok({ main: 2 }))] }),
			"/src/index.ts",
			2
		)
		const plan = reloadPlan(a, b, [
			{
				runId: "run:1",
				specId: "dev.demo:turn",
				typeIds: ["dev.demo:roll"]
			}
		])
		assert.deepEqual(
			plan.hot.map((c) => c.kind),
			["binding-changed"]
		)
		assert.equal(plan.deferred.length, 0)
	})

	test("a component change is hot even with runs in flight", () => {
		const a = devOverlay(ext(), "/src/index.ts", 1)
		const b = devOverlay(
			ext({
				components: [
					component({
						surface: "core:surface/chat-message@1",
						slug: "dice",
						label: "Dice v2",
						framework: "svelte",
						entry: "./Dice.js"
					})
				]
			}),
			"/src/index.ts",
			2
		)
		const plan = reloadPlan(a, b, [
			{
				runId: "run:1",
				specId: "dev.demo:turn",
				typeIds: ["dev.demo:roll"]
			}
		])
		assert.ok(plan.hot.some((c) => c.kind === "component-changed"))
		assert.equal(plan.blockedBy.length, 0)
	})

	test("a pipeline edit waits for the run using it, and says which one", () => {
		const a = devOverlay(ext(), "/src/index.ts", 1)
		const edited = pipeline("dev.demo:turn")
		edited.nodes = edited.nodes.slice(0, 3)
		const b = devOverlay(ext({ pipelines: [edited] }), "/src/index.ts", 2)

		const plan = reloadPlan(a, b, [
			{ runId: "run:7", specId: "dev.demo:turn", typeIds: [] }
		])
		assert.deepEqual(
			plan.deferred.map((c) => c.kind),
			["pipeline-changed"]
		)
		assert.deepEqual(plan.blockedBy, ["run:7"])
		// The developer sees why they are waiting, rather than a reload that appears to
		// have done nothing.
		assert.match(plan.summary, /waiting on 1 run/)
	})

	test("the same edit applies immediately when nothing is running", () => {
		const a = devOverlay(ext(), "/src/index.ts", 1)
		const edited = pipeline("dev.demo:turn")
		edited.nodes = edited.nodes.slice(0, 3)
		const b = devOverlay(ext({ pipelines: [edited] }), "/src/index.ts", 2)
		const plan = reloadPlan(a, b, [])
		assert.equal(plan.deferred.length, 0)
		assert.match(plan.summary, /applied/)
	})

	test("a type whose ports moved is never swapped under a running node", () => {
		const a = devOverlay(ext(), "/src/index.ts", 1)
		const b = devOverlay(
			ext({
				hooks: [
					pipelineHook(rollB, async () => ok({ main: 1, total: 2 }))
				]
			}),
			"/src/index.ts",
			2
		)
		const plan = reloadPlan(a, b, [
			{ runId: "run:2", specId: "x", typeIds: ["dev.demo:roll"] }
		])
		// Removing the old type is the cold half: a run may be mid-node, and its edges were
		// validated against ports that no longer exist.
		assert.ok(plan.deferred.some((c) => c.kind === "type-removed"))
		assert.deepEqual(plan.blockedBy, ["run:2"])
	})

	test("the invariants are stated as data, because the persistence one stops being true quietly", () => {
		assert.deepEqual(
			DEV_INVARIANTS.map((i) => i.id),
			["D1", "D2", "D3", "D4"]
		)
		for (const i of DEV_INVARIANTS)
			assert.ok(
				i.breaks.length > 30,
				`${i.id} does not say what it breaks`
			)
	})
})

// ── 110 · Host services: the executor sequences, the host does I/O ─────────
describe("110 · host services", () => {
	const chain = () =>
		spec("host:demo", { version: "1.0.0" })
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.chatHistory.v1({ scope: $.input.chatScope })
			)
			.consume("save", ($) => C.createMessage.v1({ text: $.input.text }))

	test("a Query's read reaches the host, and the host sees which node asked", async () => {
		const seen: any[] = []
		const r = await run(publishDoc(chain() as any), {
			input: { text: "hi", chatScope: { chatId: 7 } },
			seed: "seed:h",
			bindings: {
				"core:input/user-message@1": async (i: any) => ok(i),
				"core:query/chat-history@1": async (i: any, ctx: any) =>
					ok({
						main: ctx.read("chat_messages", i.scope),
						messages: ctx.read("chat_messages", i.scope)
					}),
				"core:consumer/create-message@1": async (i: any, ctx: any) =>
					ok(await ctx.commit(i))
			},
			host: {
				read: (table, q, node) => {
					seen.push({ table, q, node: node.key })
					return [{ id: 1, content: "earlier" }]
				}
			}
		})
		assert.equal(r.outcome, "ok")
		assert.equal(seen[0].table, "chat_messages")
		// The node is passed so the host can enforce scope rather than trusting
		// the query it was handed.
		assert.equal(seen[0].node, "history")
	})

	test("a Consumer describes the write and the host performs it", async () => {
		// The binding never touches storage. That is what keeps the effect inside
		// the substrate the review gate, the budget and the receipt sit in — and
		// it is the same contract a sidecar Consumer has to obey anyway (F19).
		const written: any[] = []
		const r = await run(publishDoc(chain() as any), {
			input: { text: "hi", chatScope: { chatId: 7 } },
			seed: "seed:h",
			bindings: {
				"core:input/user-message@1": async (i: any) => ok(i),
				"core:query/chat-history@1": async () =>
					ok({ main: [], messages: [] }),
				"core:consumer/create-message@1": async (i: any, ctx: any) =>
					ok(await ctx.commit(i))
			},
			host: {
				commit: async (payload, node) => {
					written.push({ payload, node: node.key })
					return { id: 42 }
				}
			}
		})
		assert.equal(r.outcome, "ok")
		assert.deepEqual((written[0].payload as any).text, "hi")
		// The host's row identity lands inside the discriminated write result
		// rather than replacing it — `committed` and `pending` stay the same
		// shape, which is what forces a downstream port to handle both (13 §7j-b).
		assert.equal((r.nodes.at(-1)!.output as any).status, "committed")
		assert.deepEqual((r.nodes.at(-1)!.output as any).ids, { id: 42 })
	})

	test("with no host, every service is the in-memory stand-in", async () => {
		// What keeps the SDK's own suite hermetic: an author writing tests needs no
		// database to run a spec that reads and writes.
		const r = await run(publishDoc(chain() as any), {
			input: { text: "hi", chatScope: {} },
			seed: "seed:h",
			bindings: {
				"core:input/user-message@1": async (i: any) => ok(i),
				"core:query/chat-history@1": async (i: any, ctx: any) =>
					ok({ main: ctx.read("x"), messages: [] }),
				"core:consumer/create-message@1": async (i: any, ctx: any) =>
					ok(await ctx.commit(i))
			}
		})
		assert.equal(r.outcome, "ok")
	})
})
