import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { SandboxManager, type InvocationRecord } from "./SandboxManager"
import { HOOK_CANCEL_GRACE_MS } from "./hookGrace"
import { syncPluginEngines, _resetEngineHost } from "./engineHost"
import {
	renderTemplate,
	_resetRenderers,
	TemplateEngineError
} from "$lib/server/pipelines/prompt/renderers"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

/**
 * Cancelling a run stops the template engines it started.
 *
 * `hookGrace.test.ts` proves the sequencing on fake time and
 * `SandboxManager.test.ts` proves a stopped run finds the calls it started.
 * Neither could see this path, because a plugin's template engine reached
 * `callHook` with **no run id on it** — an omitted argument, so nothing failed,
 * nothing logged, and the call simply was not in the set a cancel could find.
 * An engine render has a 3s budget, which is long enough for someone to press
 * stop and watch a sandbox keep rendering their prompt.
 *
 * So the assertion here is not "the field is populated". It is that a render
 * started inside a run somebody cancelled is **aborted, and killed if it
 * ignores that** — from the two places a real run renders through: the seam
 * itself, and the two bindings that call it with a run in scope.
 */

const WINDS = "acme.x:template/winds@1"
const DEAF = "acme.x:template/deaf@1"

/**
 * `winds` parks on its signal and returns a string — an engine that cleans up.
 * `deaf` never reaches an await, so no signal can ever be delivered to it: from
 * outside, the one failure mode the grace exists for.
 */
const BUNDLE = `module.exports = { hooks: {
	winds: async function (input, ctx) {
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1) })
		})
		return "WOUND:" + input.template
	},
	deaf: function () { for (;;) {} }
} }`

const STOP = { by: "user:7", reason: "the run was cancelled" }

let db: TestDb
let mgr: SandboxManager
const recs: InvocationRecord[] = []

const untilRunning = async (n: number) => {
	for (let i = 0; i < 600; i++) {
		if (mgr.activeInvocations().length >= n) return true
		await new Promise((r) => setTimeout(r, 10))
	}
	return false
}

beforeAll(async () => {
	db = await createTestDb()
	mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
	await db.insert(schema.plugins).values({
		pluginId: "acme/x",
		name: "Acme X",
		bundleSource: BUNDLE,
		bundleHash: "h-engine-cancel-test",
		enabled: true,
		manifest: { templateEngines: { [WINDS]: "winds", [DEAF]: "deaf" } }
	})
	mgr.register({
		id: "acme/x",
		name: "Acme X",
		bundleSource: BUNDLE,
		bundleHash: "h-engine-cancel-test",
		backends: ["quickjs"],
		backend: "quickjs",
		sequential: false
	})
	mgr.markReady()
	await syncPluginEngines(db, mgr)
}, 60_000)

afterAll(async () => {
	_resetRenderers()
	_resetEngineHost()
	await mgr?.dispose()
})

/**
 * Every test uses its own run id. The policy remembers a cancelled run until
 * the run leaves the registry, so a shared id would have the second test's
 * call adopted into the first test's spent budget and killed on arrival.
 */
describe("an engine render inside a cancelled run", () => {
	it("is woken by the cancel, and comes back as an ordinary render", async () => {
		const rendering = renderTemplate(WINDS, {
			template: "the context",
			variables: {},
			runId: "run-woken",
			user: "7"
		})
		expect(await untilRunning(1)).toBe(true)

		// The association the whole change exists to make. Without it the call
		// below is not in the set `stopRun` looks through, and nothing here
		// would fail — the render would just outlive its run.
		expect(mgr.activeInvocations()[0].runId).toBe("run-woken")
		expect(mgr.activeInvocations()[0].user).toBe("7")

		const started = Date.now()
		mgr.stopRun("run-woken", STOP)
		expect(await rendering).toBe("WOUND:the context")
		// It wound down in its own frame: the grace is a ceiling, not a wait.
		expect(Date.now() - started).toBeLessThan(HOOK_CANCEL_GRACE_MS)
	}, 60_000)

	it("is killed when it cannot hear the ask, and says why", async () => {
		const rendering = renderTemplate(DEAF, {
			template: "the context",
			variables: {},
			runId: "run-deaf",
			user: "7"
		})
		expect(await untilRunning(1)).toBe(true)

		const started = Date.now()
		mgr.stopRun("run-deaf", STOP)
		const err = await rendering.then(
			() => null,
			(e: unknown) => e as Error
		)
		const elapsed = Date.now() - started

		expect(err).toBeInstanceOf(TemplateEngineError)
		expect(err!.message).toContain(DEAF)
		/**
		 * The discriminator, and it is the sentence rather than the clock: an
		 * engine has a 3s budget of its own, so "it stopped eventually" would
		 * also be true of a render nobody cancelled. This says it was stopped
		 * because a person stopped the run, and names them.
		 */
		expect(err!.message).toMatch(/cancellation grace/)
		expect(err!.message).toContain("user:7")
		expect(elapsed).toBeGreaterThanOrEqual(HOOK_CANCEL_GRACE_MS - 50)
		expect(elapsed).toBeLessThan(HOOK_CANCEL_GRACE_MS * 2)

		const rec = recs.find((r) => r.runId === "run-deaf")
		expect(rec).toMatchObject({ ok: false, outcome: "killed" })
	}, 60_000)

	it("leaves a render that belongs to no run alone", async () => {
		// The other half of "optional": a preview or an admin template test
		// renders with no run, and cancelling a run must not reach it. This is
		// also what proves the run id is doing the work above rather than
		// `stopRun` stopping everything in flight.
		let settled = false
		const rendering = renderTemplate(WINDS, {
			template: "a preview",
			variables: {}
		}).then((v) => {
			settled = true
			return v
		})
		expect(await untilRunning(1)).toBe(true)
		expect(mgr.activeInvocations()[0].runId).toBeUndefined()

		mgr.stopRun("run-unrelated", STOP)
		await new Promise((r) => setTimeout(r, 200))
		expect(settled).toBe(false)

		expect(await mgr.abortCall(mgr.activeInvocations()[0].callId)).toBe(
			true
		)
		expect(await rendering).toBe("WOUND:a preview")
	}, 60_000)
})

/**
 * The seam is only reached with a run on it if the bindings put one there, and
 * the SDK's `TaskCtx` carries no run id for them to read — so `runTurn` passes
 * it to `coreBindings` and these two are what spend it. A binding that dropped
 * it again would leave the tests above passing and the gap exactly where it was.
 */
describe("the bindings that render hand over their run", () => {
	it("assemble, rendering the story string through a plugin's engine", async () => {
		const bindings = coreBindings({ runId: "run-assemble", user: "7" })
		const rendering = bindings["core:task/assemble@2"]!(
			{
				template: { source: "the story string", engine: WINDS },
				decisions: [],
				messages: [],
				budget: { total: 100 }
			},
			{} as any
		) as Promise<any>
		expect(await untilRunning(1)).toBe(true)
		expect(mgr.activeInvocations()[0].runId).toBe("run-assemble")

		mgr.stopRun("run-assemble", STOP)
		const result = await rendering
		expect(result.kind).toBe("ok")
		expect(result.value.context.rendered).toBe("WOUND:the story string")
	}, 60_000)

	it("build-template-context, rendering a variable layout through one", async () => {
		const bindings = coreBindings({ runId: "run-context", user: "7" })
		const building = bindings["core:task/build-template-context@1"]!(
			{
				cast: { sessionCharacters: [], sessionPersonas: [] },
				// One layout, on the one variable an empty cast still renders.
				variables: { characters: { engine: WINDS, source: "the cast" } }
			},
			{} as any
		) as Promise<any>
		expect(await untilRunning(1)).toBe(true)
		expect(mgr.activeInvocations()[0].runId).toBe("run-context")

		mgr.stopRun("run-context", STOP)
		const result = await building
		expect(result.kind).toBe("ok")
		expect(result.value.templateContext.characters).toBe("WOUND:the cast")
	}, 60_000)
})
