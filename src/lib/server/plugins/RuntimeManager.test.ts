import { describe, it, expect, afterEach } from "vitest"
import { RuntimeManager, type InvocationRecord, type PluginDescriptor } from "./RuntimeManager"

/**
 * The orchestration layer: dispatch, the security/speed dial, the startup
 * ready-gate, the concurrency mode, the observability record, and the live
 * registry. The backends themselves are covered by their own suites.
 */

let mgr: RuntimeManager
afterEach(async () => {
	await mgr?.dispose()
})

const desc = (over: Partial<PluginDescriptor> = {}): PluginDescriptor => ({
	id: "p",
	name: "Test Plugin",
	bundleSource: "module.exports = { hooks: { v: (i) => ({ got: i.n }) } }",
	bundleHash: "h1",
	backends: ["quickjs", "ses"],
	backend: "quickjs",
	sequential: false,
	...over
})

const call = (m: RuntimeManager, over = {}) =>
	m.callHook("p", "v", { n: 7 }, { timeoutMs: 500, ...over })

describe("RuntimeManager", () => {
	it("dispatches a hook and emits an observability record", async () => {
		const recs: InvocationRecord[] = []
		mgr = new RuntimeManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc())
		mgr.markReady()
		const r = await call(mgr)
		expect(r.ok && r.value).toEqual({ got: 7 })
		expect(recs).toHaveLength(1)
		expect(recs[0]).toMatchObject({
			pluginId: "p",
			pluginName: "Test Plugin",
			bundleHash: "h1",
			hookName: "v",
			backend: "quickjs",
			mode: "concurrent",
			ok: true,
			outcome: "ok"
		})
		expect(recs[0].durationMs).toBeGreaterThanOrEqual(0)
	})

	it("the dial routes calls to the selected backend", async () => {
		mgr = new RuntimeManager()
		mgr.register(desc())
		mgr.markReady()
		const q = await call(mgr)
		expect(q.ok && q.backend).toBe("quickjs")
		mgr.setBackend("p", "ses")
		const s = await call(mgr)
		expect(s.ok && s.backend).toBe("ses")
	}, 10_000)

	it("refuses a backend the plugin does not support", async () => {
		mgr = new RuntimeManager()
		expect(() => mgr.register(desc({ backends: ["quickjs"], backend: "ses" }))).toThrow()
		mgr.register(desc({ backends: ["quickjs"], backend: "quickjs" }))
		expect(() => mgr.setBackend("p", "ses")).toThrow(/does not support/)
	})

	it("gates non-lifecycle calls until markReady", async () => {
		mgr = new RuntimeManager()
		mgr.register(desc())
		let done = false
		const p = call(mgr).then((r) => {
			done = true
			return r
		})
		await new Promise((r) => setTimeout(r, 30))
		expect(done).toBe(false) // still gated
		mgr.markReady()
		const r = await p
		expect(done && r.ok).toBe(true)
	})

	it("lifecycle calls bypass the ready-gate and record as lifecycle", async () => {
		const recs: InvocationRecord[] = []
		mgr = new RuntimeManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc())
		// no markReady()
		const r = await mgr.callHook("p", "v", { n: 1 }, { timeoutMs: 500, lifecycle: true })
		expect(r.ok).toBe(true)
		expect(recs[0].mode).toBe("lifecycle")
	})

	it("a sequential plugin records mode 'sequential' and serializes calls", async () => {
		const recs: InvocationRecord[] = []
		mgr = new RuntimeManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ sequential: true }))
		mgr.markReady()
		const results = await Promise.all([call(mgr), call(mgr), call(mgr)])
		expect(results.every((r) => r.ok)).toBe(true)
		expect(recs).toHaveLength(3)
		expect(recs.every((r) => r.mode === "sequential")).toBe(true)
		// serialized: each call started no earlier than the previous finished
		for (let i = 1; i < recs.length; i++)
			expect(recs[i].startedAt).toBeGreaterThanOrEqual(recs[i - 1].startedAt)
	})

	it("admin can force sequential on a concurrent plugin", async () => {
		const recs: InvocationRecord[] = []
		mgr = new RuntimeManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ sequential: false }))
		mgr.markReady()
		mgr.setSequential("p", true)
		await call(mgr)
		expect(recs[0].mode).toBe("sequential")
	})

	it("an unregistered plugin yields a missing outcome and a record", async () => {
		const recs: InvocationRecord[] = []
		mgr = new RuntimeManager({ onInvocation: (r) => recs.push(r) })
		mgr.markReady()
		const r = await mgr.callHook("ghost", "v", {}, { timeoutMs: 500 })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("missing")
		expect(recs[0].outcome).toBe("missing")
	})

	it("unregister removes a plugin", async () => {
		mgr = new RuntimeManager()
		mgr.register(desc())
		mgr.markReady()
		expect((await call(mgr)).ok).toBe(true)
		mgr.unregister("p")
		const r = await call(mgr)
		expect(r.ok === false && r.outcome).toBe("missing")
	})

	it("the live registry is empty when idle", async () => {
		mgr = new RuntimeManager()
		mgr.register(desc())
		mgr.markReady()
		await call(mgr)
		expect(mgr.activeInvocations()).toHaveLength(0)
	})
})
