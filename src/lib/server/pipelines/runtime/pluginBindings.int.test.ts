import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { pluginNodeBindings, nodeTypesOf } from "./pluginBindings"
import { RuntimeManager } from "$lib/server/plugins/RuntimeManager"
import {
	spec,
	compile,
	run,
	pin,
	describeTaskType
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"

/**
 * A plugin's node on the spine (20 §9): a registry row with `transport:
 * 'process'` resolves to a binding that calls the plugin's exported hook
 * through the real `RuntimeManager` sandbox — and the executor never learns
 * which side implemented it. This is the tool architecture's load-bearing
 * seam: an AI-callable tool is exactly such a node.
 */

// The plugin's own type, declared locally the way its authoring package
// would — registration is what lets `compile` validate the spec against it.
const lookup = pin(
	describeTaskType({
		id: "acme.tools:task/lookup@1",
		i18n: { name: { en: "Acme lookup" } },
		timeoutMs: 5000,
		ports: {
			in: { q: "core:shape/text@1" },
			out: { main: "core:shape/json@1" }
		}
	}) as any
)

const BUNDLE = `module.exports = { hooks: {
	lookup: function (i, ctx) {
		return { main: {
			answer: "the answer to " + i.input.q,
			roll: Math.floor(ctx.random() * 6) + 1
		} };
	}
} }`

let db: TestDb
let mgr: RuntimeManager
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "plugin-node-user")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session.id

	const [plugin] = await db
		.insert(schema.plugins)
		.values({
			pluginId: "acme/tools",
			name: "Acme Tools",
			bundleSource: BUNDLE,
			bundleHash: "h-node",
			enabled: true,
			manifest: {
				nodeTypes: { "acme.tools:task/lookup@1": "lookup" }
			}
		})
		.returning()

	await db.insert(schema.pipelineTypeRegistry).values({
		typeId: "acme.tools:task/lookup",
		version: 1,
		kind: "task",
		ownerPluginId: plugin.id,
		transport: "process",
		status: "live",
		ports: { in: { q: {} }, out: { main: {} } }
	} as any)

	mgr = new RuntimeManager({ onInvocation: () => {} })
	mgr.register({
		id: "acme/tools",
		name: "Acme Tools",
		bundleSource: BUNDLE,
		bundleHash: "h-node",
		backends: ["quickjs"],
		backend: "quickjs",
		sequential: false
	})
	mgr.markReady()
}, 60_000)

afterAll(async () => {
	await mgr?.dispose()
})

const doc = () =>
	compile(
		spec("acme.tools:spec/lookup-turn", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.task("look", ($) => lookup.v1({ q: $.input.text }))
			.build()
	)

async function execute(seed: string) {
	const bindings = {
		...coreBindings(),
		...(await pluginNodeBindings(db, mgr, {
			seed,
			nowMs: 1_000_000
		}))
	}
	const { buildWorld } = await import(
		"$lib/server/pipelines/config/world"
	)
	const { createHost } = await import(
		"$lib/server/pipelines/runtime/host"
	)
	return await run(doc(), {
		world: await buildWorld(db as any, { sessionId }),
		input: { text: "everything", sessionScope: { sessionId } },
		seed,
		triggerSource: "event",
		bindings,
		host: createHost(db as any, { sessionId })
	})
}

describe("a process-transport node runs through the executor", () => {
	it("the hook's ports land as an ordinary node output, receipted", async () => {
		const receipt: any = await execute("seed:pn")
		expect(receipt.outcome).toBe("ok")
		const node = receipt.nodes.find((n: any) => n.nodeKey === "look")
		expect(node).toBeTruthy()
		expect(node.result).toBe("ok")
		expect(node.output?.main?.answer).toBe("the answer to everything")
		const roll = node.output?.main?.roll
		expect(roll).toBeGreaterThanOrEqual(1)
		expect(roll).toBeLessThanOrEqual(6)

		// Replay with the recorded seed rolls the same — the plugin node is a
		// pure function of (seed, input) exactly like a script link.
		const again: any = await execute("seed:pn")
		expect(
			again.nodes.find((n: any) => n.nodeKey === "look").output.main.roll
		).toBe(roll)
		// A different seed is a different stream.
		const other: any = await execute("seed:other")
		expect(typeof other.nodes.find((n: any) => n.nodeKey === "look").output.main.roll).toBe("number")
	}, 30_000)

	it("an unmapped or missing hook is a named err, not a mystery", async () => {
		expect(nodeTypesOf({ nodeTypes: { a: "b", c: 7 } })).toEqual({ a: "b" })
		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.limit(1)
		await db.insert(schema.pipelineTypeRegistry).values({
			typeId: "acme.tools:task/ghost",
			version: 1,
			kind: "task",
			ownerPluginId: plugin.id,
			transport: "process",
			status: "live",
			ports: { in: {}, out: { main: {} } }
		} as any)
		const bindings = await pluginNodeBindings(db, mgr, {
			seed: "s",
			nowMs: 0
		})
		const r: any = await (bindings["acme.tools:task/ghost@1"] as any)(
			{},
			{}
		)
		expect(r.kind).toBe("err")
		expect(r.reason).toMatch(/declares no hook/)
	})
})
