import { describe, it, expect, afterEach } from "vitest"
import { QuickJsRuntime } from "./QuickJsRuntime"

/**
 * The QuickJS plugin backend, exercised through the worker path (the default).
 * Proves the sandbox runs a hook, captures logs, seeds RNG and pins the clock
 * deterministically, and turns every fault into a typed failure rather than a
 * crash — timeout, throw, missing, async-refused.
 */

let rt: QuickJsRuntime
afterEach(async () => {
	await rt?.dispose()
})

const opts = (input: Record<string, unknown>, extra = {}) => ({
	input,
	timeoutMs: 500,
	seedLabel: "seed-a",
	nowMs: 1_700_000_000_000,
	...extra
})

async function withHook(name: string, body: string) {
	rt = new QuickJsRuntime()
	const src = `module.exports = { hooks: { ${name}: ${body} } }`
	await rt.load("p1", src, "h1")
}

describe("QuickJsRuntime", () => {
	it("re-stores when only the capability grant changes", async () => {
		rt = new QuickJsRuntime()
		const src = "module.exports = { hooks: {} }"
		await rt.load("p1", src, "h1", {
			quotaBytes: 8_000_000,
			networkHosts: ["a.example.com"]
		})
		// Same bytes, narrowed grant. Keyed on the bundle hash alone this is a
		// no-op and the plugin keeps executing under the wider grant — so the
		// stored config, which has no public surface, is what has to be checked.
		await rt.load("p1", src, "h1", { quotaBytes: 1024 })
		const held = (
			rt as unknown as {
				loaded: Map<string, { config?: { quotaBytes?: number; networkHosts?: string[] } }>
			}
		).loaded.get("p1")
		expect(held?.config?.quotaBytes).toBe(1024)
		expect(held?.config?.networkHosts).toBeUndefined()
	})

	it("settles a pending store ack when the worker dies", async () => {
		rt = new QuickJsRuntime()
		// An ack needs an event-loop round trip, so disposing before awaiting
		// the load guarantees the worker is terminated with the store still in
		// flight. A stranded ack would leave `load` pending forever — hanging
		// the call that asked for it, which the manager counts as in flight and
		// gates that plugin's refresh on.
		const load = rt.load("p1", "module.exports = { hooks: {} }", "h1")
		await rt.dispose()
		const outcome = await Promise.race([
			load.then(() => "settled"),
			new Promise((r) => setTimeout(() => r("stranded"), 3000))
		])
		expect(outcome).toBe("settled")
	})

	it("runs a hook and returns its value", async () => {
		await withHook("greet", "(input) => ({ msg: 'hi ' + input.name })")
		const r = await rt.invoke({ pluginId: "p1", hookName: "greet" }, opts({ name: "Ada" }))
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value).toEqual({ msg: "hi Ada" })
			expect(r.backend).toBe("quickjs")
		}
	})

	it("captures ctx.log output", async () => {
		await withHook("noisy", "(input, ctx) => { ctx.log('a'); ctx.log(2); return 1 }")
		const r = await rt.invoke({ pluginId: "p1", hookName: "noisy" }, opts({}))
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.logs).toEqual(["a", "2"])
	})

	it("passthrough (undefined return) is preserved", async () => {
		await withHook("void", "() => { }")
		const r = await rt.invoke({ pluginId: "p1", hookName: "void" }, opts({}))
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toBeUndefined()
	})

	it("seeds Math.random deterministically by label", async () => {
		await withHook("roll", "() => Math.random()")
		const a = await rt.invoke({ pluginId: "p1", hookName: "roll" }, opts({}, { seedLabel: "x" }))
		const b = await rt.invoke({ pluginId: "p1", hookName: "roll" }, opts({}, { seedLabel: "x" }))
		const c = await rt.invoke({ pluginId: "p1", hookName: "roll" }, opts({}, { seedLabel: "y" }))
		expect(a.ok && b.ok && c.ok).toBe(true)
		if (a.ok && b.ok && c.ok) {
			expect(a.value).toBe(b.value) // same label → same roll
			expect(a.value).not.toBe(c.value) // different label → different
		}
	})

	it("pins Date.now to nowMs", async () => {
		await withHook("clock", "() => Date.now()")
		const r = await rt.invoke({ pluginId: "p1", hookName: "clock" }, opts({}, { nowMs: 42 }))
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toBe(42)
	})

	it("turns a throw into an error outcome, not a crash", async () => {
		await withHook("boom", "() => { throw new Error('nope') }")
		const r = await rt.invoke({ pluginId: "p1", hookName: "boom" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.outcome).toBe("error")
			expect(r.reason).toMatch(/nope/)
		}
	})

	it("stops an infinite loop via the inner deadline", async () => {
		await withHook("hang", "() => { while (true) {} }")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "hang" },
			opts({}, { timeoutMs: 150 })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(["timeout", "killed"]).toContain(r.outcome)
			expect(r.durationMs).toBeLessThan(1500)
		}
	}, 10_000)

	it("reports a missing hook", async () => {
		await withHook("real", "() => 1")
		const r = await rt.invoke({ pluginId: "p1", hookName: "ghost" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("missing")
	})

	it("reports a missing plugin", async () => {
		rt = new QuickJsRuntime()
		const r = await rt.invoke({ pluginId: "nope", hookName: "x" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("missing")
	})

	it("refuses async hooks (until the capability bridge lands)", async () => {
		await withHook("later", "async () => 1")
		const r = await rt.invoke({ pluginId: "p1", hookName: "later" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/async/i)
	})

	it("has no host reach — require/process are absent in the guest", async () => {
		await withHook(
			"escape",
			"() => ({ req: typeof require, proc: typeof process, gt: typeof globalThis.process })"
		)
		const r = await rt.invoke({ pluginId: "p1", hookName: "escape" }, opts({}))
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toEqual({ req: "undefined", proc: "undefined", gt: "undefined" })
	})

	it("load is idempotent on identical bytes and replaceable on new bytes", async () => {
		rt = new QuickJsRuntime()
		await rt.load("p1", "module.exports={hooks:{v:()=>1}}", "h1")
		await rt.load("p1", "module.exports={hooks:{v:()=>1}}", "h1") // no-op
		expect(rt.has("p1")).toBe(true)
		await rt.load("p1", "module.exports={hooks:{v:()=>2}}", "h2") // replace
		const r = await rt.invoke({ pluginId: "p1", hookName: "v" }, opts({}))
		expect(r.ok && r.value).toBe(2)
	})
})
