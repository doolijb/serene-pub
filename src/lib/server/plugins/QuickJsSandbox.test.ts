import { describe, it, expect, afterEach } from "vitest"
import { QuickJsSandbox } from "./QuickJsSandbox"

/**
 * The QuickJS plugin backend, exercised through the worker path (the default).
 * Proves the sandbox runs a hook, captures logs, seeds RNG and pins the clock
 * deterministically, and turns every fault into a typed failure rather than a
 * crash — timeout, throw, missing.
 *
 * And the granularity claim cancellation stands on: QuickJS is interruptible
 * per call, so *both* stop paths are per job here. Aborting or killing one hook
 * has to leave a concurrent job — and another plugin's job on the same shared
 * sandbox — running.
 */

/** Parks on an await until its own `ctx.signal` fires, then returns normally. */
const PARK = `async function (input, ctx) {
	var woke = await new Promise(function (res) {
		ctx.signal.addEventListener("abort", function () { res("woke") })
	})
	return { id: input.id, woke: woke, aborted: ctx.signal.aborted }
}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let rt: QuickJsSandbox
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
	rt = new QuickJsSandbox()
	const src = `module.exports = { hooks: { ${name}: ${body} } }`
	await rt.load("p1", src, "h1")
}

describe("QuickJsSandbox", () => {
	it("re-stores when only the permission grant changes", async () => {
		rt = new QuickJsSandbox()
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
				loaded: Map<
					string,
					{
						config?: {
							quotaBytes?: number
							networkHosts?: string[]
						}
					}
				>
			}
		).loaded.get("p1")
		expect(held?.config?.quotaBytes).toBe(1024)
		expect(held?.config?.networkHosts).toBeUndefined()
	})

	it("settles a pending store ack when the worker dies", async () => {
		rt = new QuickJsSandbox()
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
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "greet" },
			opts({ name: "Ada" })
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value).toEqual({ msg: "hi Ada" })
			expect(r.backend).toBe("quickjs")
		}
	})

	it("captures ctx.log output", async () => {
		await withHook(
			"noisy",
			"(input, ctx) => { ctx.log('a'); ctx.log(2); return 1 }"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "noisy" },
			opts({})
		)
		expect(r.ok).toBe(true)
		// "[log]" — a one-argument call names no level (see prelude.ts).
		if (r.ok) expect(r.logs).toEqual(["[log] a", "[log] 2"])
	})

	it("passthrough (undefined return) is preserved", async () => {
		await withHook("void", "() => { }")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "void" },
			opts({})
		)
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toBeUndefined()
	})

	it("seeds Math.random deterministically by label", async () => {
		await withHook("roll", "() => Math.random()")
		const a = await rt.invoke(
			{ pluginId: "p1", hookName: "roll" },
			opts({}, { seedLabel: "x" })
		)
		const b = await rt.invoke(
			{ pluginId: "p1", hookName: "roll" },
			opts({}, { seedLabel: "x" })
		)
		const c = await rt.invoke(
			{ pluginId: "p1", hookName: "roll" },
			opts({}, { seedLabel: "y" })
		)
		expect(a.ok && b.ok && c.ok).toBe(true)
		if (a.ok && b.ok && c.ok) {
			expect(a.value).toBe(b.value) // same label → same roll
			expect(a.value).not.toBe(c.value) // different label → different
		}
	})

	it("pins Date.now to nowMs", async () => {
		await withHook("clock", "() => Date.now()")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "clock" },
			opts({}, { nowMs: 42 })
		)
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toBe(42)
	})

	it("turns a throw into an error outcome, not a crash", async () => {
		await withHook("boom", "() => { throw new Error('nope') }")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "boom" },
			opts({})
		)
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
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "ghost" },
			opts({})
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("missing")
	})

	it("reports a missing plugin", async () => {
		rt = new QuickJsSandbox()
		const r = await rt.invoke({ pluginId: "nope", hookName: "x" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("missing")
	})

	it("runs async hooks — the abort capability is what required them", async () => {
		// A hook can only observe an abort by being suspended at an await, so
		// enabling one meant enabling the other: the host drives the job queue
		// now instead of refusing a thenable.
		await withHook(
			"later",
			"async (input) => await Promise.resolve(input.n * 2)"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "later" },
			opts({ n: 21 })
		)
		expect(r.ok && r.value).toBe(42)
	})

	it("ctx.signal wakes a hook parked on an await, which returns normally", async () => {
		await withHook("park", PARK)
		const running = rt.invoke(
			{ pluginId: "p1", hookName: "park" },
			opts({ id: "a" }, { timeoutMs: 8000, jobId: "a" })
		)
		expect(rt.abort("a")).toBe(true)
		const r = await running
		// A returning hook is just a returning hook: an ordinary success, not a
		// kill and not a timeout. Core does nothing special with it.
		expect(r.ok).toBe(true)
		if (r.ok)
			expect(r.value).toEqual({ id: "a", woke: "woke", aborted: true })
	}, 15_000)

	it("aborting one job leaves a concurrent job on the same sandbox running", async () => {
		await withHook("park", PARK)
		const a = rt.invoke(
			{ pluginId: "p1", hookName: "park" },
			opts({ id: "a" }, { timeoutMs: 15_000, jobId: "a" })
		)
		let bSettled = false
		const b = rt
			.invoke(
				{ pluginId: "p1", hookName: "park" },
				opts({ id: "b" }, { timeoutMs: 15_000, jobId: "b" })
			)
			.then((r) => {
				bSettled = true
				return r
			})
		expect(rt.abort("a")).toBe(true)
		const ra = await a
		expect(ra.ok && (ra.value as { id: string }).id).toBe("a")
		await sleep(50)
		// The whole point: one hook stopped, not the sandbox they share.
		expect(bSettled).toBe(false)
		expect(rt.abort("b")).toBe(true)
		const rb = await b
		expect(rb.ok && (rb.value as { id: string }).id).toBe("b")
	}, 30_000)

	it("kills one call and spares another plugin's call on the shared sandbox", async () => {
		rt = new QuickJsSandbox()
		await rt.load(
			"keeper",
			`module.exports = { hooks: { park: ${PARK} } }`,
			"h1"
		)
		await rt.load(
			"hog",
			"module.exports = { hooks: { spin: () => { for (;;) {} } } }",
			"h2"
		)
		let keptSettled = false
		const kept = rt
			.invoke(
				{ pluginId: "keeper", hookName: "park" },
				opts({ id: "k" }, { timeoutMs: 30_000, jobId: "keep" })
			)
			.then((r) => {
				keptSettled = true
				return r
			})
		await sleep(100) // let it park before the hog blocks the thread
		const doomed = rt.invoke(
			{ pluginId: "hog", hookName: "spin" },
			opts({}, { timeoutMs: 30_000, jobId: "doom" })
		)
		await sleep(100)
		// Cooperative first, and it does nothing: this hook never suspends, so
		// it never reads its signal. That is the case forced kill exists for,
		// and from out here it is one failure mode, not three.
		expect(rt.abort("doom")).toBe(true)
		await sleep(100)
		expect(await rt.kill("doom")).toBe(true)
		const rd = await doomed
		expect(rd.ok).toBe(false)
		if (!rd.ok) expect(rd.outcome).toBe("killed")
		// Nothing was disposed: the bystander is still parked, still addressable
		// by its own handle, and finishes normally.
		expect(keptSettled).toBe(false)
		expect(rt.has("keeper")).toBe(true)
		expect(rt.abort("keep")).toBe(true)
		const rk = await kept
		expect(rk.ok && (rk.value as { id: string }).id).toBe("k")
	}, 60_000)

	it("a hook cannot catch its own kill, and the worker is free after it", async () => {
		rt = new QuickJsSandbox()
		await rt.load(
			"p1",
			`module.exports = { hooks: {
				stubborn: () => { while (true) { try { for (;;) {} } catch (e) {} } },
				ping: () => "pong"
			} }`,
			"h1"
		)
		const running = rt.invoke(
			{ pluginId: "p1", hookName: "stubborn" },
			opts({}, { timeoutMs: 30_000, jobId: "s" })
		)
		await sleep(100)
		expect(await rt.kill("s")).toBe(true)
		const r = await running
		expect(r.ok === false && r.outcome).toBe("killed")
		// The host settling is not proof the guest stopped — this is. QuickJS
		// marks the interrupt uncatchable, so the swallowing loop above cannot
		// survive it; if it had, it would still own the worker thread and this
		// call could not run at all.
		const after = await rt.invoke(
			{ pluginId: "p1", hookName: "ping" },
			opts({}, { timeoutMs: 3000 })
		)
		expect(after.ok && after.value).toBe("pong")
	}, 30_000)

	it("abort and kill report an unknown handle rather than guessing", async () => {
		await withHook("v", "() => 1")
		expect(rt.abort("nobody")).toBe(false)
		expect(await rt.kill("nobody")).toBe(false)
	})

	it("has no host reach — require/process are absent in the guest", async () => {
		await withHook(
			"escape",
			"() => ({ req: typeof require, proc: typeof process, gt: typeof globalThis.process })"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "escape" },
			opts({})
		)
		expect(r.ok).toBe(true)
		if (r.ok)
			expect(r.value).toEqual({
				req: "undefined",
				proc: "undefined",
				gt: "undefined"
			})
	})

	it("load is idempotent on identical bytes and replaceable on new bytes", async () => {
		rt = new QuickJsSandbox()
		await rt.load("p1", "module.exports={hooks:{v:()=>1}}", "h1")
		await rt.load("p1", "module.exports={hooks:{v:()=>1}}", "h1") // no-op
		expect(rt.has("p1")).toBe(true)
		await rt.load("p1", "module.exports={hooks:{v:()=>2}}", "h2") // replace
		const r = await rt.invoke({ pluginId: "p1", hookName: "v" }, opts({}))
		expect(r.ok && r.value).toBe(2)
	})
})
