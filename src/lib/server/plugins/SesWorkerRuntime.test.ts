import { describe, it, expect, afterEach } from "vitest"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import { QuickJsRuntime } from "./QuickJsRuntime"

/**
 * The SES plugin backend. Proves the same behavioural contract as QuickJS
 * (run, log, determinism via ctx, typed failures), plus the two SES-specific
 * facts: frozen primordials reject prototype mutation, and the deadline is the
 * worker kill (no inner interrupt). Also asserts cross-backend parity: the same
 * hook + seed yields an identical result on either backend.
 */

let rt: SesWorkerRuntime
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
	rt = new SesWorkerRuntime()
	const src = `module.exports = { hooks: { ${name}: ${body} } }`
	await rt.load("p1", src, "h1")
}

describe("SesWorkerRuntime", () => {
	it("runs a hook and returns its value", async () => {
		await withHook("greet", "(input) => ({ msg: 'hi ' + input.name })")
		const r = await rt.invoke({ pluginId: "p1", hookName: "greet" }, opts({ name: "Ada" }))
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value).toEqual({ msg: "hi Ada" })
			expect(r.backend).toBe("ses")
		}
	})

	it("captures ctx.log and seeds ctx.random / ctx.now", async () => {
		await withHook("mix", "(i, c) => { c.log('x'); return { r: c.random(), t: c.now() } }")
		const r = await rt.invoke({ pluginId: "p1", hookName: "mix" }, opts({}, { nowMs: 42 }))
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.logs).toEqual(["x"])
			expect((r.value as { t: number }).t).toBe(42)
			expect(typeof (r.value as { r: number }).r).toBe("number")
		}
	})

	it("ctx.random is deterministic by seed label", async () => {
		await withHook("roll", "(i, c) => c.random()")
		const a = await rt.invoke({ pluginId: "p1", hookName: "roll" }, opts({}, { seedLabel: "x" }))
		const b = await rt.invoke({ pluginId: "p1", hookName: "roll" }, opts({}, { seedLabel: "x" }))
		expect(a.ok && b.ok && a.value === b.value).toBe(true)
	})

	it("turns a throw into an error outcome", async () => {
		await withHook("boom", "() => { throw new Error('nope') }")
		const r = await rt.invoke({ pluginId: "p1", hookName: "boom" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.outcome).toBe("error")
			expect(r.reason).toMatch(/nope/)
		}
	})

	it("frozen primordials reject prototype mutation (a SES-hostile bundle)", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p1", "Array.prototype.foo = 1; module.exports = { hooks: { v: () => 1 } }", "h1")
		const r = await rt.invoke({ pluginId: "p1", hookName: "v" }, opts({}))
		expect(r.ok).toBe(false) // core-js/prototype-patching style code dies here
	})

	it("stops a runaway hook via the worker kill (no inner interrupt)", async () => {
		await withHook("hang", "() => { while (true) {} }")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "hang" },
			opts({}, { timeoutMs: 200 })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.outcome).toBe("timeout")
			expect(r.durationMs).toBeGreaterThanOrEqual(150)
			expect(r.durationMs).toBeLessThan(1200)
		}
	}, 10_000)

	it("reports missing hook and missing plugin", async () => {
		await withHook("real", "() => 1")
		const miss = await rt.invoke({ pluginId: "p1", hookName: "ghost" }, opts({}))
		expect(miss.ok === false && miss.outcome).toBe("missing")
		const noPlugin = await rt.invoke({ pluginId: "nope", hookName: "x" }, opts({}))
		expect(noPlugin.ok === false && noPlugin.outcome).toBe("missing")
	})

	it("runs async hooks (real V8 async — awaited capabilities work here)", async () => {
		await withHook(
			"later",
			"async (input) => { return await Promise.resolve(input.n * 2); }"
		)
		const r = await rt.invoke({ pluginId: "p1", hookName: "later" }, opts({ n: 21 }))
		expect(r.ok && r.value).toBe(42)
	})

	it("has no host reach — require/process absent in the compartment", async () => {
		await withHook("escape", "() => ({ req: typeof require, proc: typeof process })")
		const r = await rt.invoke({ pluginId: "p1", hookName: "escape" }, opts({}))
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toEqual({ req: "undefined", proc: "undefined" })
	})
})

describe("cross-backend parity", () => {
	it("the same hook + seed yields an identical result on QuickJS and SES", async () => {
		const src =
			"module.exports = { hooks: { calc: (input, ctx) => ({ sum: input.a + input.b, r: ctx.random(), t: ctx.now() }) } }"
		const qjs = new QuickJsRuntime()
		const ses = new SesWorkerRuntime()
		try {
			await qjs.load("p", src, "h")
			await ses.load("p", src, "h")
			const o = opts({ a: 2, b: 3 }, { seedLabel: "parity", nowMs: 99 })
			const rq = await qjs.invoke({ pluginId: "p", hookName: "calc" }, o)
			const rs = await ses.invoke({ pluginId: "p", hookName: "calc" }, o)
			expect(rq.ok && rs.ok).toBe(true)
			if (rq.ok && rs.ok) {
				expect(rq.value).toEqual(rs.value) // functional parity, exact
				expect(rq.value).toEqual({ sum: 5, r: (rs.value as { r: number }).r, t: 99 })
			}
		} finally {
			await qjs.dispose()
			await ses.dispose()
		}
	}, 10_000)

	it("re-stores when only the capability grant changes", async () => {
		rt = new SesWorkerRuntime()
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
		rt = new SesWorkerRuntime()
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
})
