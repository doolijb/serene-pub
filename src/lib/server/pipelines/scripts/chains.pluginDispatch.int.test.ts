import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { makeScriptApplier } from "./chains"
import type {
	PluginHookDispatch,
	PluginHookRequest
} from "./pluginDispatch"
import { RuntimeManager } from "$lib/server/plugins/RuntimeManager"
import { makePluginHookDispatch } from "$lib/server/plugins/hookDispatch"

/**
 * The unification, end to end: a chain link whose script type is plugin-owned
 * (`transport: 'process'`) is dispatched to the plugin runtime through the same
 * applier, and its result folds through the same transform/verdict/skip law as
 * a core script. Two proofs: the applier's routing against a fake port (fast,
 * exact), and a real plugin hook firing through `makePluginHookDispatch` + a
 * live `RuntimeManager` (the whole path, callHook and all).
 */

let db: TestDb

/** Insert a plugin-owned script type into the registry; returns its pinned id. */
async function processType(opts: {
	namespace: string
	content: string
	operation: string
	semantics: "transform" | "verdict"
	ownerPluginId: number
	inPort: string
}): Promise<string> {
	const typeId = `${opts.namespace}:script:${opts.content}/${opts.operation}`
	await db.insert(schema.pipelineTypeRegistry).values({
		typeId,
		version: 1,
		kind: "script",
		ownerPluginId: opts.ownerPluginId,
		transport: "process",
		status: "live",
		ports: { in: { [opts.inPort]: {} }, out: { [opts.inPort]: {} } },
		semantics: opts.semantics
	})
	return `${typeId}@1`
}

/** A `pipeline_scripts` row that attaches a type to a chain — no source; the
 * plugin provides execution. */
async function scriptRow(typeId: string, subject: string): Promise<number> {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId,
			name: `link:${typeId}`,
			enabled: true,
			source: "",
			varsIn: [subject],
			varsOut: [subject]
		})
		.returning()
	return row.id
}

const site = (accepts: string[]) =>
	({
		nodeKey: "node",
		slot: "hook",
		phase: "before",
		port: "text",
		accepts,
		extras: [],
		origin: "substrate"
	}) as any

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("the applier routes plugin-owned types through the dispatch port", () => {
	it("folds a plugin transform exactly like a core one", async () => {
		const typeId = await processType({
			namespace: "alpha",
			content: "text",
			operation: "transform",
			semantics: "transform",
			ownerPluginId: 999,
			inPort: "value"
		})
		const rowId = await scriptRow(typeId, "value")

		const seen: PluginHookRequest[] = []
		const dispatch: PluginHookDispatch = {
			async runHook(req) {
				seen.push(req)
				return {
					ok: true,
					value: String(req.value).toUpperCase(),
					logs: ["ran"],
					durationMs: 3
				}
			}
		}

		const applier = makeScriptApplier(db as any, {
			seed: "s",
			nowMs: 1000,
			pluginDispatch: dispatch,
			runId: "run-1",
			user: "42"
		})

		const out = await applier(site([typeId]), [rowId], "hello")

		// folded — the value the plugin returned replaced the flowing value
		expect(out.value).toBe("HELLO")
		expect(out.applications).toHaveLength(1)
		expect(out.applications[0]).toMatchObject({ result: "ok", typeId })

		// routed with the right address + run identity + gated subject/extras
		expect(seen).toHaveLength(1)
		expect(seen[0]).toMatchObject({
			ownerPluginId: 999,
			typeId,
			value: "hello",
			runId: "run-1",
			user: "42"
		})
		// same per-link seed address form as a core script
		expect(seen[0]!.seedLabel).toBe("s:scripts:node:hook:0:" + rowId)
	})

	it("reduces a plugin verdict by the same earliest-index law", async () => {
		const typeId = await processType({
			namespace: "alpha",
			content: "text",
			operation: "stop",
			semantics: "verdict",
			ownerPluginId: 999,
			inPort: "text"
		})
		const rowId = await scriptRow(typeId, "text")

		const dispatch: PluginHookDispatch = {
			async runHook() {
				return { ok: true, value: 3, logs: [], durationMs: 1 }
			}
		}
		const applier = makeScriptApplier(db as any, {
			seed: "s",
			nowMs: 1000,
			pluginDispatch: dispatch
		})

		const out = await applier(site([typeId]), [rowId], "hello")
		// index 3 wins → text sliced to "hel"; the application is marked won
		expect(out.value).toBe("hel")
		expect(out.applications[0]).toMatchObject({ verdict: 3, won: true })
	})

	it("skips a plugin link when no dispatch is present (extensions off)", async () => {
		const typeId = await processType({
			namespace: "gamma",
			content: "text",
			operation: "transform",
			semantics: "transform",
			ownerPluginId: 999,
			inPort: "value"
		})
		const rowId = await scriptRow(typeId, "value")

		const applier = makeScriptApplier(db as any, { seed: "s", nowMs: 1000 })
		const out = await applier(site([typeId]), [rowId], "hello")

		expect(out.value).toBe("hello") // untouched
		expect(out.applications[0]).toMatchObject({ result: "skip" })
		expect(out.applications[0]!.reason).toMatch(/disabled/)
	})
})

describe("a real plugin hook fires through the applier", () => {
	const BUNDLE = `module.exports = { hooks: {
		shout: function (input, ctx) { return String(input.value).toUpperCase() + "!"; }
	} }`
	let manager: RuntimeManager

	afterAll(async () => {
		await manager?.dispose()
	})

	it("dispatches to the loaded bundle and folds its output", async () => {
		const [plugin] = await db
			.insert(schema.plugins)
			.values({
				pluginId: "beta/tool",
				name: "Beta Tool",
				bundleSource: BUNDLE,
				bundleHash: "h1",
				backends: ["quickjs"],
				backend: "quickjs",
				enabled: true,
				manifest: {
					hookTypes: { "beta:script:text/transform@1": "shout" }
				}
			})
			.returning()

		const typeId = await processType({
			namespace: "beta",
			content: "text",
			operation: "transform",
			semantics: "transform",
			ownerPluginId: plugin.id,
			inPort: "value"
		})
		const rowId = await scriptRow(typeId, "value")

		manager = new RuntimeManager()
		manager.register({
			id: "beta/tool",
			name: "Beta Tool",
			bundleSource: BUNDLE,
			bundleHash: "h1",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false
		})
		manager.markReady()

		const applier = makeScriptApplier(db as any, {
			seed: "s",
			nowMs: 1000,
			pluginDispatch: makePluginHookDispatch(db as any, manager),
			runId: "run-e2e"
		})

		const out = await applier(site([typeId]), [rowId], "hello")

		// the sandboxed hook actually ran and its return value folded in
		expect(out.value).toBe("HELLO!")
		expect(out.applications[0]).toMatchObject({ result: "ok" })
	}, 20_000)
})
