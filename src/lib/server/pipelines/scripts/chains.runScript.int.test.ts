/**
 * A script step runs its chain (PLAN-pipeline-canvas-and-genre-authoring P3).
 *
 * `core:task/run-script@1` passes its input through; the `out:main` seam
 * declared on it accepts `core:script:data/transform@1`, and the applier
 * runs the chain there like any other seam — JSON in, JSON out, in the
 * sandbox. Nothing in the binding knows a script exists, which is the point.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { compile, ok, run, spec } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { makeScriptApplier } from "./chains"
import { scriptBudgetsByNode } from "./runSeams"

let db: TestDb
const DATA = "core:script:data/transform"

const doc = compile(
	spec("test:spec/script-step", { version: "1.0.0" })
		.inlet("input", C.userMessage.v1())
		.task("step", ($: any) => C.runScript.v1({ input: $.input.text }))
		.build()
)

/**
 * A transform rewrites the variable it is handed: the kind's first in port
 * is the subject, the script declares the same name as its out, and what it
 * returns IS the new value (the applier's rule in `chains.ts`; `host.ts`
 * hands the return back as is).
 */
let doubleId: number
/** A link that never returns — only the time limit stops it. */
let spinId: number

beforeAll(async () => {
	db = await createTestDb()
	await db.insert(schema.pipelineDefinitionRegistry).values([
		{
			definitionId: DATA,
			version: 1,
			kind: "script",
			transport: "node",
			status: "live",
			ports: { in: { value: {} }, out: { value: {} } },
			semantics: "transform"
		}
	])
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: `${DATA}@1`,
			name: "wrap",
			enabled: true,
			source: `return { wrapped: value, length: String(value).length }`,
			varsIn: ["value"],
			varsOut: ["value"]
		})
		.returning()
	doubleId = row.id
	const [spin] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: `${DATA}@1`,
			name: "spin",
			enabled: true,
			source: `for (;;) {}`,
			varsIn: ["value"],
			varsOut: ["value"]
		})
		.returning()
	spinId = spin.id
}, 60_000)

describe("the script step", () => {
	it("declares one seam, out:main, accepting data/transform", () => {
		const slots = (C.runScript as any).slots ?? (C.runScript as any).descriptor?.slots
		const scripts = slots?.scripts
		expect(scripts?.kind).toBe("scripts")
		expect(scripts?.port).toBe("main")
		expect(scripts?.phase).toBe("after")
		expect(scripts?.accepts).toContain(`${DATA}@1`)
	})

	it("runs the chain over what the step passes through", async () => {
		const receipt: any = await run(doc, {
			world: {
				overrides: [
					{ nodeKey: "step", slot: "scripts", path: "", value: [doubleId], scopeKind: "session" }
				],
				samplingConfigs: [],
				connections: [],
				activeConnection: {}
			} as any,
			input: { text: "quiet" },
			seed: "script-step",
			triggerSource: "ui",
			applyScripts: makeScriptApplier(db, { seed: "seed", nowMs: 1_000_000 }),
			bindings: {
				"core:inlet/user-message@1": async (i: any) => ok(i),
				// The real binding is identity; spelled out here so the test owns it.
				"core:task/run-script@1": async (i: any) => ok({ main: i.input ?? null })
			}
		})
		expect(receipt.outcome).toBe("ok")
		const node = receipt.nodes.find((n: any) => n.nodeKey === "step")
		expect(node.result).toBe("ok")
		expect(node.scripts).toMatchObject([{ scriptId: doubleId, result: "ok", changed: true }])
		if (node.output) expect(node.output.main).toEqual({ wrapped: "quiet", length: 5 })
	}, 60_000)

	it("declares its time limit as params.budgetMs, 250 ms by default", () => {
		const world: any = { overrides: [], samplingConfigs: [], connections: [], activeConnection: {} }
		expect(scriptBudgetsByNode(doc, world)).toEqual({ step: 250 })
		const set: any = {
			...world,
			overrides: [
				{ nodeKey: "step", slot: "params", path: "budgetMs", value: 5000, scopeKind: "config" }
			]
		}
		// Outside the declared bounds is clamped to them, never taken as is.
		expect(scriptBudgetsByNode(doc, set)).toEqual({ step: 1000 })
	})

	it("stops a script past the step's own time limit, and the receipt says so", async () => {
		const world: any = {
			overrides: [
				{ nodeKey: "step", slot: "scripts", path: "", value: [spinId, doubleId], scopeKind: "session" },
				{ nodeKey: "step", slot: "params", path: "budgetMs", value: 5, scopeKind: "session" }
			],
			samplingConfigs: [],
			connections: [],
			activeConnection: {}
		}
		const receipt: any = await run(doc, {
			world,
			input: { text: "quiet" },
			seed: "script-step-budget",
			triggerSource: "ui",
			applyScripts: makeScriptApplier(db, {
				seed: "seed",
				nowMs: 1_000_000,
				budgetMsByNode: scriptBudgetsByNode(doc, world)
			}),
			bindings: {
				"core:inlet/user-message@1": async (i: any) => ok(i),
				"core:task/run-script@1": async (i: any) => ok({ main: i.input ?? null })
			}
		})
		const node = receipt.nodes.find((n: any) => n.nodeKey === "step")
		// The slow link is stopped at the step's 5 ms, not the seam's 250 —
		// the chain's later link still runs and is recorded…
		expect(node.scripts[0]).toMatchObject({ scriptId: spinId, result: "err" })
		expect(node.scripts[0].reason).toMatch(/timeout after 5ms/)
		expect(node.scripts[1]).toMatchObject({ scriptId: doubleId, result: "ok", changed: true })
		// …but a script step whose script failed HALTS (PLAN-dc-after-walk2
		// Q0-1/Q0-3): its answer is its script's, and handing its input on as
		// that answer is how an interview answer wrote nothing yet was marked
		// answered.
		expect(node.result).toBe("halt")
		expect(node.reason).toMatch(/the script '.*' failed: timeout after 5ms/)
		expect(receipt.outcome).toBe("halt")
	}, 60_000)
})
