import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { pluginNodeBindings, nodeDefinitionsOf } from "./pluginBindings"
import { RuntimeManager } from "$lib/server/plugins/RuntimeManager"
import {
	spec,
	compile,
	run,
	pin,
	describeTaskDefinition,
	ok,
	err,
	halt,
	cancelled
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
	describeTaskDefinition({
		id: "acme.tools:task/lookup@1",
		i18n: { name: { en: "Acme lookup" } },
		timeoutMs: 5000,
		ports: {
			in: { q: "core:shape/text@1" },
			out: { main: "core:shape/json@1" }
		}
	}) as any
)

// `(input, ctx)`, where input is the node's own ports — the SDK's handler
// signature, and what `pluginNodeBindings` hands over (D-6b). It used to
// arrive wrapped as `{ input }`, which no authored handler reads.
const BUNDLE = `module.exports = { hooks: {
	lookup: function (i, ctx) {
		return { main: {
			answer: "the answer to " + i.q,
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
				nodeDefinitions: { "acme.tools:task/lookup@1": "lookup" }
			}
		})
		.returning()

	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "acme.tools:task/lookup",
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
			.inlet("input", C.userMessage.v1())
			.task("look", ($) => lookup.v1({ q: $.input.text }))
			.build()
	)

async function execute(seed: string) {
	const bindings = {
		...coreBindings(),
		...(await pluginNodeBindings(db, mgr, {
			seed,
			nowMs: 1_000_000,
			// The running pipeline is the plugin's own (R62).
			specOwner: "acme/tools"
		}))
	}
	const { buildWorld } = await import(
		"$lib/server/pipelines/config/world"
	)
	const { createHost } = await import(
		"$lib/server/pipelines/runtime/host"
	)
	return await run(doc(), {
		world: await buildWorld(db, { sessionId }),
		input: { text: "everything", sessionScope: { sessionId } },
		seed,
		triggerSource: "event",
		bindings,
		host: createHost(db, { sessionId })
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
		expect(nodeDefinitionsOf({ nodeDefinitions: { a: "b", c: 7 } })).toEqual({ a: "b" })
		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.limit(1)
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "acme.tools:task/ghost",
			version: 1,
			kind: "task",
			ownerPluginId: plugin.id,
			transport: "process",
			status: "live",
			ports: { in: {}, out: { main: {} } }
		} as any)
		const bindings = await pluginNodeBindings(db, mgr, {
			specOwner: "acme/tools",
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

/**
 * Binding law B1 (`BINDING_PROBES` in the SDK's `testing.ts`): a hook returns a
 * discriminated `Result`, never a bare value — and both showcase plugins do.
 * The sandbox passes that value through verbatim, so unwrapping it is this
 * seam's job. Read as ports instead, `ok({ main, blocks })` arrived as the
 * ports object `{ kind: 'ok', value: … }`, whose `main` is missing — and the
 * "ensure main" step then set `ports.main = ports`, handing `ok()` a
 * self-referential object for the receipt's redaction and hashing to walk.
 *
 * The manager is faked here rather than bundled into the sandbox because the
 * thing under test is the translation, and a fake is the only way to post a
 * `halt` or a `cancelled` at it deliberately.
 */
describe("a hook's Result is unwrapped, never read as ports", () => {
	const call = async (value: unknown) => {
		const fake = {
			callHook: async () => ({
				ok: true,
				value,
				logs: [],
				durationMs: 0,
				backend: "quickjs"
			})
		}
		const bindings = await pluginNodeBindings(db, fake as any, {
			specOwner: "acme/tools",
			seed: "seed:unwrap",
			nowMs: 1_000_000
		})
		const binding = bindings["acme.tools:task/lookup@1"] as any
		expect(binding).toBeTruthy()
		return (await binding({ q: "x" }, {})) as any
	}

	it("ok(ports) lands as exactly the ports a core binding publishes", async () => {
		expect(await call(ok({ main: 1 }))).toEqual(ok({ main: 1 }))
	})

	it("ok(ports) with no main gets one, and it is never the object itself", async () => {
		const r = await call(ok({ blocks: [] }))
		expect(r.kind).toBe("ok")
		expect(r.value.blocks).toEqual([])
		// The whole ports object is the main port — said with a copy, so the
		// receipt can carry it.
		expect(r.value.main).toEqual({ blocks: [] })
		expect(r.value.main).not.toBe(r.value)
		expect(() => JSON.stringify(r)).not.toThrow()
	})

	it("err, halt and cancelled reach the executor in the hook's own voice", async () => {
		expect(await call(err("nope"))).toEqual(err("nope"))
		expect(await call(halt("not applicable"))).toEqual(
			halt("not applicable")
		)
		// `cancelled()` crosses the transport as a lone `{ kind }`: JSON drops
		// an undefined reason, so the sentence is ours to supply.
		const c = await call({ kind: "cancelled" })
		expect(c.kind).toBe("cancelled")
		expect(c.reason).toMatch(/cancelled/)
		expect(await call(cancelled("the user stopped it"))).toEqual(
			cancelled("the user stopped it")
		)
	})

	it("a bare ports object still reads as ports (pre-B1 packaging)", async () => {
		expect(await call({ main: 1 })).toEqual(ok({ main: 1 }))
		// Including one that carries a `kind` port of its own: `ok()` never
		// produces a third key, so this is ports, not a result.
		expect(await call({ kind: "ok", main: 1 })).toEqual(
			ok({ kind: "ok", main: 1 })
		)
		// And a bare value is still tolerated as `main`.
		expect(await call(7)).toEqual(ok({ main: 7 }))
	})

	it("no returned shape produces a value the receipt cannot serialize", async () => {
		for (const v of [
			ok({ main: 1 }),
			ok({ blocks: [] }),
			ok(7),
			err("nope"),
			halt("not applicable"),
			{ kind: "cancelled" },
			{ main: 1 },
			{ blocks: [] },
			7
		]) {
			const r = await call(v)
			expect(() => JSON.stringify(r)).not.toThrow()
		}
	})
})

describe("R62 · a private node runs only in its own package's pipelines", () => {
	it("another package's pipeline, or a person's, gets a refusal naming the owner; a public node runs for anyone", async () => {
		const pin = "acme.tools:task/lookup@1"
		for (const specOwner of [undefined, "other/pkg"]) {
			const bindings = await pluginNodeBindings(db, mgr, { seed: "s", nowMs: 1, specOwner })
			const out: any = await (bindings[pin] as any)({ q: "x" }, {})
			expect(out.kind ?? out.status ?? JSON.stringify(out)).toMatch(/err/)
			expect(JSON.stringify(out)).toContain("private to 'acme/tools'")
		}
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ isPublic: true } as any)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, "acme.tools:task/lookup"))
		try {
			const bindings = await pluginNodeBindings(db, mgr, { seed: "s", nowMs: 1, specOwner: "other/pkg" })
			expect(JSON.stringify(await (bindings[pin] as any)({ q: "x" }, {}))).not.toContain("private to")
		} finally {
			await db
				.update(schema.pipelineDefinitionRegistry)
				.set({ isPublic: false } as any)
				.where(eq(schema.pipelineDefinitionRegistry.definitionId, "acme.tools:task/lookup"))
		}
	}, 60_000)
})

describe("R62 · the publish door refuses another package's private node", () => {
	it("saves the plugin's own pipeline, refuses a person's or another package's", async () => {
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const [owner] = await db
			.select({ id: schema.plugins.id })
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, "acme/tools"))
		// A person's pipeline (no owning package) may not build on it…
		await expect(saveDocument(db as any, doc(), { publish: false })).rejects.toThrow(
			/private to 'acme\/tools'.*visibility: 'public'/
		)
		// …and its own package's may.
		const saved = await saveDocument(db as any, doc(), { publish: false, sourcePluginId: owner!.id })
		expect(saved.specId).toBeGreaterThan(0)
	}, 60_000)
})

describe("R62 · every door judges a private node the same way", () => {
	it("refuses another package's pipeline at publish; a re-save keeps the stored owner", async () => {
		const { saveDocument } = await import("$lib/server/pipelines/boot/store")
		const [other] = await db
			.insert(schema.plugins)
			.values({ pluginId: "other/pkg", name: "Other", bundleSource: "//", bundleHash: "h-other", enabled: true, manifest: {} })
			.returning()
		const foreign = compile(
			spec("other.pkg:spec/borrow", { version: "1.0.0" })
				.inlet("input", C.userMessage.v1())
				.task("look", ($) => lookup.v1({ q: $.input.text }))
				.build()
		)
		await expect(
			saveDocument(db as any, foreign, { publish: false, sourcePluginId: other.id })
		).rejects.toThrow(/private to 'acme\/tools'/)
		// The plugin's own spec, re-saved with no owner named, is judged as its stored owner's.
		const saved = await saveDocument(db as any, doc(), { publish: false })
		expect(saved.specId).toBeGreaterThan(0)
	}, 60_000)

	it("mayStandIn: a private node stands in only in its own package's spec; public anywhere", async () => {
		const { mayStandIn } = await import("$lib/server/pipelines/entities/bindings")
		const candidate = "acme.tools:task/lookup@1"
		expect(await mayStandIn(db as any, "core:spec/chat-respond", "core:task/concat-candidates@1", candidate)).toBe(false)
		expect(await mayStandIn(db as any, "acme.tools:spec/lookup-turn", "core:task/concat-candidates@1", candidate)).toBe(true)
		await db
			.update(schema.pipelineDefinitionRegistry)
			.set({ isPublic: true } as any)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, "acme.tools:task/lookup"))
		try {
			expect(await mayStandIn(db as any, "core:spec/chat-respond", "core:task/concat-candidates@1", candidate)).toBe(true)
		} finally {
			await db
				.update(schema.pipelineDefinitionRegistry)
				.set({ isPublic: false } as any)
				.where(eq(schema.pipelineDefinitionRegistry.definitionId, "acme.tools:task/lookup"))
		}
	}, 60_000)
})
