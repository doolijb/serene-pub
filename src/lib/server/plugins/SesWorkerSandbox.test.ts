import { describe, it, expect, afterEach } from "vitest"
import { HOOK_CTX_KINDS, hookCtxKeysFor } from "./hookCtx"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import { QuickJsSandbox } from "./QuickJsSandbox"

/**
 * The SES plugin backend. Proves the same behavioural contract as QuickJS
 * (run, log, determinism via ctx, typed failures), plus the two SES-specific
 * facts: frozen primordials reject prototype mutation, and the deadline is the
 * worker kill (no inner interrupt). Also asserts cross-backend parity: the same
 * hook + seed yields an identical result on either backend.
 *
 * Cancellation follows that same split, and both halves are pinned here: the
 * cooperative `abort` is per job exactly as on QuickJS, while forced `kill` is
 * the worker — so a bystander call dying with the target is asserted on
 * purpose. If that assertion ever starts failing, the interface doc at
 * `PluginSandbox.kill` is the thing that changed.
 */

/** Parks on an await until its own `ctx.signal` fires, then returns normally. */
const PARK = `async function (input, ctx) {
	var woke = await new Promise(function (res) {
		ctx.signal.addEventListener("abort", function () { res("woke") })
	})
	return { id: input.id, woke: woke, aborted: ctx.signal.aborted }
}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let rt: SesWorkerSandbox
afterEach(async () => {
	await rt?.dispose()
})

const opts = (input: Record<string, unknown>, extra = {}) => ({
	input,
	// A task's ctx unless a test says otherwise — the kind decides what
	// `ctx` carries (hookCtx.ts, R-3), and these tests need none of it.
	kind: "task" as const,
	timeoutMs: 500,
	seedLabel: "seed-a",
	nowMs: 1_700_000_000_000,
	...extra
})

async function withHook(name: string, body: string) {
	rt = new SesWorkerSandbox()
	const src = `module.exports = { hooks: { ${name}: ${body} } }`
	await rt.load("p1", src, "h1")
}

describe("SesWorkerSandbox", () => {
	it("runs a hook and returns its value", async () => {
		await withHook("greet", "(input) => ({ msg: 'hi ' + input.name })")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "greet" },
			opts({ name: "Ada" })
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.value).toEqual({ msg: "hi Ada" })
			expect(r.backend).toBe("ses")
		}
	})

	it("captures ctx.log and seeds ctx.random / ctx.now", async () => {
		await withHook(
			"mix",
			"(i, c) => { c.log('x'); return { r: c.random(), t: c.now() } }"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "mix" },
			opts({}, { nowMs: 42 })
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			// "[log]" — a one-argument call names no level (see prelude.ts).
			expect(r.logs).toEqual(["[log] x"])
			expect((r.value as { t: number }).t).toBe(42)
			expect(typeof (r.value as { r: number }).r).toBe("number")
		}
	})

	it("ctx.random is deterministic by seed label", async () => {
		await withHook("roll", "(i, c) => c.random()")
		const a = await rt.invoke(
			{ pluginId: "p1", hookName: "roll" },
			opts({}, { seedLabel: "x" })
		)
		const b = await rt.invoke(
			{ pluginId: "p1", hookName: "roll" },
			opts({}, { seedLabel: "x" })
		)
		expect(a.ok && b.ok && a.value === b.value).toBe(true)
	})

	it("turns a throw into an error outcome", async () => {
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

	it("frozen primordials reject prototype mutation (a SES-hostile bundle)", async () => {
		rt = new SesWorkerSandbox()
		await rt.load(
			"p1",
			"Array.prototype.foo = 1; module.exports = { hooks: { v: () => 1 } }",
			"h1"
		)
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
		const miss = await rt.invoke(
			{ pluginId: "p1", hookName: "ghost" },
			opts({})
		)
		expect(miss.ok === false && miss.outcome).toBe("missing")
		const noPlugin = await rt.invoke(
			{ pluginId: "nope", hookName: "x" },
			opts({})
		)
		expect(noPlugin.ok === false && noPlugin.outcome).toBe("missing")
	})

	it("runs async hooks (real V8 async — awaited capabilities work here)", async () => {
		await withHook(
			"later",
			"async (input) => { return await Promise.resolve(input.n * 2); }"
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
		// The message only reaches the worker while its loop is free — which is
		// exactly when the hook is parked and able to wake.
		expect(rt.abort("a")).toBe(true)
		const r = await running
		expect(r.ok).toBe(true)
		if (r.ok)
			expect(r.value).toEqual({ id: "a", woke: "woke", aborted: true })
	}, 15_000)

	it("aborting one job leaves a concurrent job in the same worker running", async () => {
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
		expect(bSettled).toBe(false) // one hook stopped, not the worker
		expect(rt.abort("b")).toBe(true)
		const rb = await b
		expect(rb.ok && (rb.value as { id: string }).id).toBe("b")
	}, 30_000)

	it("kill stops a hook that ignores the signal — and costs the worker", async () => {
		rt = new SesWorkerSandbox()
		await rt.load(
			"p1",
			`module.exports = { hooks: { park: ${PARK}, spin: function () { for (;;) {} }, quick: function () { return "up" } } }`,
			"h1"
		)
		const kept = rt.invoke(
			{ pluginId: "p1", hookName: "park" },
			opts({ id: "k" }, { timeoutMs: 30_000, jobId: "keep" })
		)
		await sleep(100)
		const doomed = rt.invoke(
			{ pluginId: "p1", hookName: "spin" },
			opts({}, { timeoutMs: 30_000, jobId: "doom" })
		)
		await sleep(100)
		// Cooperative first, and useless here: the hook never suspends, so the
		// worker never gets to read the message.
		expect(rt.abort("doom")).toBe(true)
		await sleep(100)
		expect(await rt.kill("doom")).toBe(true)
		const rd = await doomed
		expect(rd.ok === false && rd.outcome).toBe("killed")
		// The documented cost, asserted rather than assumed: V8 has no interrupt
		// point below the thread, so terminating the worker is the only forced
		// stop SES has — and the plugin's other in-flight call goes with it.
		const rk = await kept
		expect(rk.ok).toBe(false)
		if (!rk.ok) {
			expect(rk.outcome).toBe("killed")
			expect(rk.reason).toMatch(/terminated/)
		}
		// ...and the sandbox heals: the next call rebuilds the worker and
		// re-stores the bundle, with no re-load from the manager.
		const after = await rt.invoke(
			{ pluginId: "p1", hookName: "quick" },
			opts({}, { timeoutMs: 8000 })
		)
		expect(after.ok && after.value).toBe("up")
	}, 60_000)

	it("abort and kill report an unknown handle rather than guessing", async () => {
		await withHook("v", "() => 1")
		expect(rt.abort("nobody")).toBe(false)
		expect(await rt.kill("nobody")).toBe(false)
	}, 15_000)

	it("has no host reach — require/process absent in the compartment", async () => {
		await withHook(
			"escape",
			"() => ({ req: typeof require, proc: typeof process })"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "escape" },
			opts({})
		)
		expect(r.ok).toBe(true)
		if (r.ok)
			expect(r.value).toEqual({ req: "undefined", proc: "undefined" })
	})
})

describe("cross-backend parity", () => {
	it("the same hook + seed yields an identical result on QuickJS and SES", async () => {
		const src =
			"module.exports = { hooks: { calc: (input, ctx) => ({ sum: input.a + input.b, r: ctx.random(), t: ctx.now() }) } }"
		const qjs = new QuickJsSandbox()
		const ses = new SesWorkerSandbox()
		try {
			await qjs.load("p", src, "h")
			await ses.load("p", src, "h")
			const o = opts({ a: 2, b: 3 }, { seedLabel: "parity", nowMs: 99 })
			const rq = await qjs.invoke({ pluginId: "p", hookName: "calc" }, o)
			const rs = await ses.invoke({ pluginId: "p", hookName: "calc" }, o)
			expect(rq.ok && rs.ok).toBe(true)
			if (rq.ok && rs.ok) {
				expect(rq.value).toEqual(rs.value) // functional parity, exact
				expect(rq.value).toEqual({
					sum: 5,
					r: (rs.value as { r: number }).r,
					t: 99
				})
			}
		} finally {
			await qjs.dispose()
			await ses.dispose()
		}
	}, 10_000)

	it("re-stores when only the permission grant changes", async () => {
		rt = new SesWorkerSandbox()
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
		rt = new SesWorkerSandbox()
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

/**
 * The hook ctx per kind (plans/29 R-3): what `ctx` carries is decided by the
 * kind of hook, from one table both backends read (`hookCtx.ts`). Observed
 * from INSIDE the sandbox — `Object.keys(ctx)` is what a hook can reach, not
 * what a docblock says — and pinned against the table, so the table and the
 * program cannot drift apart without this failing.
 */
describe("SesWorkerSandbox — the hook ctx per kind", () => {
	for (const kind of HOOK_CTX_KINDS) {
		it(`a ${kind} hook sees exactly ${hookCtxKeysFor(kind).join(", ")}`, async () => {
			await withHook("keys", "(input, ctx) => Object.keys(ctx)")
			const r = await rt.invoke(
				{ pluginId: "p1", hookName: "keys" },
				opts({}, { kind })
			)
			expect(r.ok).toBe(true)
			if (r.ok) expect(r.value).toEqual(hookCtxKeysFor(kind))
		})
	}

	it("a task hook calling ctx.fetch throws a TypeError — the member is absent, not a stub", async () => {
		await withHook(
			"reach",
			"(input, ctx) => { try { ctx.fetch('https://example.com/'); return 'reached' } catch (e) { return { name: e.name, message: e.message } } }"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "reach" },
			opts({}, { kind: "task" })
		)
		expect(r.ok).toBe(true)
		if (r.ok) expect((r.value as { name: string }).name).toBe("TypeError")
	})

	it("a task hook cannot reach past the ctx to the hosts' globals either", async () => {
		// The ctx member is absent AND the host behind it is not endowed: a
		// hook that names `__fetch` directly finds nothing to call.
		await withHook(
			"globals",
			"() => ({ fetch: typeof __fetch, storage: typeof __storage })"
		)
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "globals" },
			opts({}, { kind: "task" })
		)
		expect(r.ok && r.value).toEqual({ fetch: "undefined", storage: "undefined" })
		const o = await rt.invoke(
			{ pluginId: "p1", hookName: "globals" },
			opts({}, { kind: "oracle" })
		)
		expect(o.ok && o.value).toEqual({ fetch: "function", storage: "object" })
	})

	it("a chain-link hook has no storage either — parity with an in-app script", async () => {
		await withHook("rows", "(input, ctx) => typeof ctx.storage")
		const r = await rt.invoke(
			{ pluginId: "p1", hookName: "rows" },
			opts({}, { kind: "chain-link" })
		)
		expect(r.ok && r.value).toBe("undefined")
	})

	it("a call naming no kind is refused as a host bug, never as a hook failure", async () => {
		await withHook("v", "() => 1")
		await expect(
			rt.invoke(
				{ pluginId: "p1", hookName: "v" },
				{ ...opts({}), kind: undefined as unknown as "task" }
			)
		).rejects.toThrow(/without a hook ctx kind/)
	})
})
