import os from "node:os"
import path from "node:path"
import { describe, it, expect, afterEach } from "vitest"
import {
	SandboxManager,
	storageSegment,
	type InvocationRecord,
	type PluginDescriptor
} from "./SandboxManager"
import { HOOK_CANCEL_GRACE_MS } from "./hookGrace"

/**
 * The orchestration layer: dispatch, the security/speed dial, the startup
 * ready-gate, the concurrency mode, the observability record, and the live
 * registry. The backends themselves are covered by their own suites.
 */

let mgr: SandboxManager
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

const call = (m: SandboxManager, over = {}) =>
	m.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 500, ...over })

describe("storageSegment (jail-root invariant)", () => {
	it("collapses traversal ids to one inert segment", () => {
		// A '.'/'..'/empty id must never widen the jail to the shared parent.
		expect(storageSegment("..")).toBe("_")
		expect(storageSegment(".")).toBe("_")
		expect(storageSegment("")).toBe("_")
		expect(storageSegment("...")).toBe("_")
		// separators are filtered out, so nothing can become a second segment
		expect(storageSegment("../../etc")).not.toContain("/")
		expect(storageSegment("a/b")).toBe("a_b")
		expect(storageSegment("..\\..\\x")).not.toMatch(/[\\/]/)
		// ordinary ids are preserved (dots kept when not leading)
		expect(storageSegment("acme/tool")).toBe("acme_tool")
		expect(storageSegment("acme.tool")).toBe("acme.tool")
	})
})

describe("SandboxManager", () => {
	it("dispatches a hook and emits an observability record", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
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
		mgr = new SandboxManager()
		mgr.register(desc())
		mgr.markReady()
		const q = await call(mgr)
		expect(q.ok && q.backend).toBe("quickjs")
		mgr.setBackend("p", "ses")
		const s = await call(mgr)
		expect(s.ok && s.backend).toBe("ses")
	}, 10_000)

	it("refuses a backend the plugin does not support", async () => {
		mgr = new SandboxManager()
		expect(() =>
			mgr.register(desc({ backends: ["quickjs"], backend: "ses" }))
		).toThrow()
		mgr.register(desc({ backends: ["quickjs"], backend: "quickjs" }))
		expect(() => mgr.setBackend("p", "ses")).toThrow(/does not support/)
	})

	it("gates non-lifecycle calls until markReady", async () => {
		mgr = new SandboxManager()
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
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc())
		// no markReady()
		const r = await mgr.callHook(
			"p",
			"v",
			{ n: 1 },
			{ kind: "lifecycle", timeoutMs: 500, lifecycle: true }
		)
		expect(r.ok).toBe(true)
		expect(recs[0].mode).toBe("lifecycle")
	})

	it("calls a lifecycle hook as (input, ctx) on both backends", async () => {
		// The SDK typed `LifecycleCallback` as taking the surface ALONE while both
		// backends have always called every hook `__fn(__input, ctx)` — so an
		// author who followed the type read `storage` and `log` off the input
		// and found neither. This is the sandbox half of that contract, and it
		// is asserted on both backends because a convention that held on one
		// would be a convention an author could not rely on.
		const reflect = `module.exports = { hooks: { boot: function (a0, a1) {
			return {
				arity: arguments.length,
				arg0: a0,
				surfaceOnArg1: !!a1 && typeof a1.log === "function",
				surfaceOnArg0: !!a0 && typeof a0.log === "function"
			};
		} } }`
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: reflect, bundleHash: "h-reflect" }))
		// No markReady(): a lifecycle call is exactly the one that runs before
		// the gate opens, which is the path core's startup hooks take.
		for (const backend of ["quickjs", "ses"] as const) {
			mgr.setBackend("p", backend)
			const r = await mgr.callHook(
				"p",
				"boot",
				{ moment: "startup" },
				{ kind: "lifecycle", timeoutMs: 5_000, lifecycle: true }
			)
			expect(r.ok).toBe(true)
			if (!r.ok) continue
			const v = r.value as Record<string, unknown>
			expect(r.backend).toBe(backend)
			expect(v.arity).toBe(2)
			// Argument 0 is what core sent, verbatim…
			expect(v.arg0).toEqual({ moment: "startup" })
			// …and the surface is argument 1, on both backends, and is not
			// reachable from argument 0.
			expect(v.surfaceOnArg1).toBe(true)
			expect(v.surfaceOnArg0).toBe(false)
		}
	}, 20_000)

	it("a sequential plugin records mode 'sequential' and serializes calls", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ sequential: true }))
		mgr.markReady()
		const results = await Promise.all([call(mgr), call(mgr), call(mgr)])
		expect(results.every((r) => r.ok)).toBe(true)
		expect(recs).toHaveLength(3)
		expect(recs.every((r) => r.mode === "sequential")).toBe(true)
		// serialized: each call started no earlier than the previous finished
		for (let i = 1; i < recs.length; i++)
			expect(recs[i].startedAt).toBeGreaterThanOrEqual(
				recs[i - 1].startedAt
			)
	})

	it("admin can force sequential on a concurrent plugin", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ sequential: false }))
		mgr.markReady()
		mgr.setSequential("p", true)
		await call(mgr)
		expect(recs[0].mode).toBe("sequential")
	})

	it("a call naming no hook ctx kind throws — a host bug, never a typed hook failure", async () => {
		// The kind decides what the hook's `ctx` carries (hookCtx.ts, R-3).
		// Thrown before the gate and the queue, so the dispatcher that forgot
		// its kind hears it on the first call rather than as a `load` outcome
		// in the invocation log.
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc())
		mgr.markReady()
		await expect(
			mgr.callHook("p", "v", { n: 7 }, {
				timeoutMs: 500
			} as unknown as Parameters<SandboxManager["callHook"]>[3])
		).rejects.toThrow(/without a hook ctx kind/)
		await expect(
			mgr.callHook("p", "v", { n: 7 }, {
				kind: "widget",
				timeoutMs: 500
			} as unknown as Parameters<SandboxManager["callHook"]>[3])
		).rejects.toThrow(/without a hook ctx kind/)
		expect(recs).toEqual([])
	})

	it("an unregistered plugin yields a missing outcome and a record", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.markReady()
		const r = await mgr.callHook("ghost", "v", {}, { kind: "task", timeoutMs: 500 })
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("missing")
		expect(recs[0].outcome).toBe("missing")
	})

	it("unregister removes a plugin", async () => {
		mgr = new SandboxManager()
		mgr.register(desc())
		mgr.markReady()
		expect((await call(mgr)).ok).toBe(true)
		mgr.unregister("p")
		const r = await call(mgr)
		expect(r.ok === false && r.outcome).toBe("missing")
	})

	it("the live registry is empty when idle", async () => {
		mgr = new SandboxManager()
		mgr.register(desc())
		mgr.markReady()
		await call(mgr)
		expect(mgr.activeInvocations()).toHaveLength(0)
	})
})

/**
 * A permission grant (and the bundle itself) is handed to the sandbox exactly
 * once, at load. `dispatch` loads only when `has()` is false, and `has()` knows
 * nothing about bundles or grants — so without an explicit drop, an admin
 * revoking network / lowering a quota, or a plugin *update*, would keep running
 * against the copy loaded first.
 *
 * `load` is idempotent per bundle hash, so these tests hold the hash fixed and
 * swap the source: a behaviour change is then proof the copy was dropped and
 * re-loaded, since an un-dropped copy can never see the new source.
 */
describe("register refreshes what the sandbox holds", () => {
	const genA =
		"module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 1 }) } }"
	const genB =
		"module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 2 }) } }"
	// Never written to — the hooks below never touch ctx.storage; it exists only
	// so a quota is capable of being granted at all (see `permissionConfig`).
	const dataDir = path.join(os.tmpdir(), "sp-sandbox-reload-test")

	/** Resolve once a call is past its load phase and actually executing. */
	const untilExecuting = async (m: SandboxManager) => {
		for (let i = 0; i < 300; i++) {
			if (m.activeInvocations().length === 1) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	const gen = async (m: SandboxManager) => {
		const r = await m.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 2000 })
		return r.ok ? (r.value as { gen: number }).gen : -1
	}

	it("a bundle update takes effect without a disable/enable cycle", async () => {
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h2" }))
		expect(await gen(mgr)).toBe(2)
	})

	it("a lowered storage quota re-derives grants at the next call", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: genA,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		// identical bundle hash: only the quota moved, yet the copy must go
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		expect(await gen(mgr)).toBe(2)
	})

	it("revoking network drops the copy holding the old allowlist", async () => {
		mgr = new SandboxManager()
		mgr.register(
			desc({
				bundleSource: genA,
				bundleHash: "h1",
				networkHosts: ["a.example.com"]
			})
		)
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1" })) // network denied
		expect(await gen(mgr)).toBe(2)
	})

	it("leaves a warm plugin alone when nothing load-relevant changed", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		// a rename or a concurrency flip is not a reload reason, and an inert
		// `undefined` -> `0` / `[]` quota+host difference must not fake one.
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				name: "Renamed",
				sequential: true,
				storageQuotaBytes: 0,
				networkHosts: []
			})
		)
		expect(await gen(mgr)).toBe(1)
	})

	it("releases from the sandbox that was hosting it, across a flip and back", async () => {
		const genC =
			"module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 3 }) } }"
		mgr = new SandboxManager()
		mgr.register(
			desc({ bundleSource: genA, bundleHash: "h1", backend: "ses" })
		)
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		mgr.register(
			desc({ bundleSource: genB, bundleHash: "h1", backend: "quickjs" })
		)
		const q = await mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 2000 })
		expect(q.ok && q.backend).toBe("quickjs")
		expect(q.ok && (q.value as { gen: number }).gen).toBe(2)
		// Back to SES. The hash never moves, so `load` is a no-op on any copy
		// the SES side still holds — this only reaches gen 3 if the flip away
		// genuinely released the old worker rather than leaving genA loaded.
		mgr.register(
			desc({ bundleSource: genC, bundleHash: "h1", backend: "ses" })
		)
		const s2 = await mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 2000 })
		expect(s2.ok && s2.backend).toBe("ses")
		expect(s2.ok && (s2.value as { gen: number }).gen).toBe(3)
	}, 20_000)

	it("a queued call runs under the current descriptor, not the one it captured", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: slow,
				bundleHash: "h1",
				sequential: true,
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		const first = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 20_000 })
		expect(await untilExecuting(mgr)).toBe(true)
		// Queued behind `first`, so it captured the pre-change descriptor. It
		// must not execute — nor re-install — the grants revoked while it waited.
		const queued = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 20_000 })
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				sequential: true,
				storageQuotaBytes: 1024
			})
		)
		expect((await first).ok).toBe(true)
		const r = await queued
		expect(r.ok && (r.value as { gen: number }).gen).toBe(2)
	}, 30_000)

	it("refreshing one plugin leaves another in the shared sandbox alone", async () => {
		const callQ = async () => {
			const r = await mgr.callHook(
				"q",
				"v",
				{ n: 7 },
				{ kind: "task", timeoutMs: 2000 }
			)
			return r.ok ? (r.value as { gen: number }).gen : -1
		}
		mgr = new SandboxManager()
		mgr.register(desc({ id: "p", bundleSource: genA, bundleHash: "h1" }))
		mgr.register(desc({ id: "q", bundleSource: genA, bundleHash: "h1" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		expect(await callQ()).toBe(1)
		// One QuickJS sandbox hosts both, and `loaded` is manager-wide: changing
		// p must not release, reload or otherwise disturb q.
		mgr.register(desc({ id: "p", bundleSource: genB, bundleHash: "h2" }))
		expect(mgr.isWarm("q")).toBe(true)
		expect(await gen(mgr)).toBe(2)
		expect(await callQ()).toBe(1)
	}, 20_000)

	it("an in-flight call finishes; the reload lands on the call after it", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: slow,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 20_000 })
		// past the load phase, so the drop below lands on a *running* call
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		const r = await inFlight
		// `unload` frees the plugin's state; it does not terminate a running call
		expect(r.ok).toBe(true)
		expect(await gen(mgr)).toBe(2)
	}, 30_000)

	it("a change to an idle plugin re-warms it at once, with no call to trigger it", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: genA,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		expect(mgr.isWarm("p")).toBe(true)
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		// The replacement is already loaded — a lazy drop would leave it cold
		// here and only fault the new copy in on the next call.
		expect(mgr.isWarm("p")).toBe(true)
		expect(await gen(mgr)).toBe(2)
	}, 15_000)

	it("leaves a cold plugin cold — there is nothing in use to replace", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: genA,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		expect(mgr.isWarm("p")).toBe(false)
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		expect(mgr.isWarm("p")).toBe(false)
		expect(await gen(mgr)).toBe(2) // still fresh when it is finally called
	}, 15_000)

	it("holds the swap while a call is in flight, then reloads the moment it drains", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: slow,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 20_000 })
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		// Deferred: the running call keeps the copy it started on, rather than
		// having it pulled out from under it.
		expect(mgr.isWarm("p")).toBe(true)
		expect((await inFlight).ok).toBe(true)
		// Drained → swapped and re-warmed already, without another call.
		expect(mgr.isWarm("p")).toBe(true)
		expect(await gen(mgr)).toBe(2)
	}, 30_000)

	it("a call abandoned by a timeout still releases the held swap", async () => {
		const hang = "module.exports = { hooks: { v: () => { for (;;) {} } } }"
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: hang,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		const doomed = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 300 })
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		const r = await doomed
		expect(r.ok).toBe(false) // killed by the deadline, never returns cleanly
		// The swap must not be pinned by work that never came back.
		expect(await gen(mgr)).toBe(2)
	}, 30_000)

	it("a register racing a cold call cannot strand the old copy", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: genA,
				bundleHash: "h1",
				storageQuotaBytes: 4096
			})
		)
		mgr.markReady()
		// The call captures its descriptor, then the admin change lands before
		// the load finishes — so there is nothing loaded for `register` to drop.
		// Whatever becomes of this call, the *next* one must not go on running
		// the old bundle behind a `has()` that never re-fires.
		const raced = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 5000 })
		mgr.register(
			desc({
				bundleSource: genB,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		await raced
		expect(await gen(mgr)).toBe(2)
	}, 15_000)
})

/**
 * An admin kill has to terminate the sandbox the call is actually running on.
 * A backend change can land while a call is in flight (deferred until it
 * drains), so the plugin's current descriptor may name a sandbox that call was
 * never on — and acting on that one kills a bystander while the target runs on.
 */
describe("admin kill resolves the sandbox the call is on", () => {
	const slow =
		"module.exports = { hooks: { v: () => { let s = 0; for (let k = 0; k < 9e7; k++) s += k; return { gen: 1 } } } }"
	const gen2 = "module.exports = { hooks: { v: () => ({ gen: 2 }) } }"
	const dataDir = path.join(os.tmpdir(), "sp-sandbox-kill-test")

	const untilRunning = async (m: SandboxManager) => {
		for (let i = 0; i < 600; i++) {
			if (m.activeInvocations().length >= 1) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	it("does not orphan the loaded copy, leaving revoked grants live", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: slow,
				bundleHash: "h1",
				storageQuotaBytes: 8_000_000,
				networkHosts: ["evil.example.com"]
			})
		)
		mgr.markReady()
		const running = mgr.callHook("p", "v", {}, { kind: "task", timeoutMs: 60_000 })
		expect(await untilRunning(mgr)).toBe(true)
		const [call] = mgr.activeInvocations()
		mgr.setBackend("p", "ses") // deferred — p is busy, so the call stays on quickjs
		expect(await mgr.killCall(call.callId)).toBe(true)
		await running.catch(() => {})
		// Grants narrowed, same bundle hash. If the kill orphaned the quickjs
		// copy, `load` short-circuits on the hash and the old grants stay live.
		mgr.setBackend("p", "quickjs")
		mgr.register(
			desc({
				bundleSource: gen2,
				bundleHash: "h1",
				storageQuotaBytes: 1024
			})
		)
		const r = await mgr.callHook("p", "v", {}, { kind: "task", timeoutMs: 5000 })
		expect(r.ok && (r.value as { gen: number }).gen).toBe(2)
	}, 60_000)

	it("kills the target and spares the bystanders", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({
				id: "p",
				bundleSource:
					"module.exports = { hooks: { v: () => { for(;;){} } } }",
				backend: "ses"
			})
		)
		mgr.register(desc({ id: "q", bundleSource: gen2 }))
		mgr.markReady()
		await mgr.callHook("q", "v", {}, { kind: "task", timeoutMs: 5000 })
		expect(mgr.isWarm("q")).toBe(true)
		const doomed = mgr.callHook("p", "v", {}, { kind: "task", timeoutMs: 12_000 })
		expect(await untilRunning(mgr)).toBe(true)
		const [call] = mgr.activeInvocations()
		mgr.setBackend("p", "quickjs") // deferred — the call is still on SES
		const started = Date.now()
		expect(await mgr.killCall(call.callId)).toBe(true)
		const r = await doomed
		expect(r.ok).toBe(false)
		// SES has no inner interrupt: terminating its worker is the only thing
		// that stops this hook, so a kill aimed elsewhere would leave it running
		// to its own 12s deadline.
		expect(Date.now() - started).toBeLessThan(5000)
		// ...and the shared QuickJS sandbox, which it was never on, is untouched.
		expect(mgr.isWarm("q")).toBe(true)
	}, 60_000)

	it("does not leak a SES worker when a flipped plugin is released", async () => {
		mgr = new SandboxManager({ dataDir })
		mgr.register(
			desc({ bundleSource: gen2, bundleHash: "h1", backend: "ses" })
		)
		mgr.markReady()
		await mgr.callHook("p", "v", {}, { kind: "task", timeoutMs: 8000 })
		// A leaked worker thread has no public surface, so this reads the map
		// directly rather than inventing API for one invariant.
		const workers = () =>
			(mgr as unknown as { sesWorkers: Map<string, unknown> }).sesWorkers
		expect(workers().has("p")).toBe(true)
		mgr.register(
			desc({ bundleSource: gen2, bundleHash: "h2", backend: "quickjs" })
		)
		await mgr.callHook("p", "v", {}, { kind: "task", timeoutMs: 8000 })
		expect(workers().has("p")).toBe(false)
	}, 60_000)
})

/**
 * Stopping one hook has to stop **that** hook. `abortCall` asks the hook itself
 * — its `ctx.signal` fires, and a hook parked on an await winds down in its own
 * frame and returns normally. `killCall` no longer disposes anything, so on the
 * shared QuickJS sandbox a kill lands on one call and every other call, of every
 * other plugin, runs on.
 */
describe("a call is stopped on its own, not by squashing its plugin", () => {
	const park = `module.exports = { hooks: {
		park: async function (input, ctx) {
			var woke = await new Promise(function (res) {
				ctx.signal.addEventListener("abort", function () { res("woke") })
			})
			return { id: input.id, woke: woke }
		},
		spin: function () { for (;;) {} }
	} }`

	const untilRunning = async (m: SandboxManager, n: number) => {
		for (let i = 0; i < 600; i++) {
			if (m.activeInvocations().length >= n) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

	/** In dispatch order — `callId` is stamped before anything can await. */
	const byCallId = (m: SandboxManager) =>
		[...m.activeInvocations()].sort((a, b) => a.callId - b.callId)

	it("abortCall wakes one call and leaves the concurrent one running", async () => {
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: park, bundleHash: "h1" }))
		mgr.markReady()
		const a = mgr.callHook("p", "park", { id: "a" }, { kind: "task", timeoutMs: 30_000 })
		let bSettled = false
		const b = mgr
			.callHook("p", "park", { id: "b" }, { kind: "task", timeoutMs: 30_000 })
			.then((r) => {
				bSettled = true
				return r
			})
		expect(await untilRunning(mgr, 2)).toBe(true)
		const [first] = byCallId(mgr)
		expect(await mgr.abortCall(first.callId)).toBe(true)
		const ra = await a
		// The *targeted* call came back — same plugin, same hook, same sandbox
		// as the one still running, so only the address distinguishes them.
		expect(ra.ok && (ra.value as { id: string }).id).toBe("a")
		await sleep(50)
		expect(bSettled).toBe(false)
		const [second] = byCallId(mgr)
		expect(await mgr.abortCall(second.callId)).toBe(true)
		expect((await b).ok).toBe(true)
	}, 60_000)

	it("killCall stops one quickjs call and spares another plugin's", async () => {
		mgr = new SandboxManager()
		mgr.register(
			desc({ id: "keeper", bundleSource: park, bundleHash: "h1" })
		)
		mgr.register(desc({ id: "hog", bundleSource: park, bundleHash: "h1" }))
		mgr.markReady()
		let keptSettled = false
		const kept = mgr
			.callHook("keeper", "park", { id: "k" }, { kind: "task", timeoutMs: 60_000 })
			.then((r) => {
				keptSettled = true
				return r
			})
		expect(await untilRunning(mgr, 1)).toBe(true)
		await sleep(100) // parked, so the hog below cannot starve its load
		const doomed = mgr.callHook("hog", "spin", {}, { kind: "task", timeoutMs: 60_000 })
		expect(await untilRunning(mgr, 2)).toBe(true)
		const target = mgr
			.activeInvocations()
			.find((c) => c.pluginId === "hog")!
		expect(await mgr.killCall(target.callId)).toBe(true)
		const rd = await doomed
		expect(rd.ok === false && rd.outcome).toBe("killed")
		// This is the regression the whole change exists to prevent: killing one
		// quickjs call used to dispose the sandbox every quickjs plugin shares.
		await sleep(100)
		expect(keptSettled).toBe(false)
		expect(mgr.isWarm("keeper")).toBe(true)
		const survivor = mgr
			.activeInvocations()
			.find((c) => c.pluginId === "keeper")!
		expect(await mgr.abortCall(survivor.callId)).toBe(true)
		const rk = await kept
		expect(rk.ok && (rk.value as { id: string }).id).toBe("k")
	}, 90_000)

	it("a stopped call still emits its observability record", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ bundleSource: park, bundleHash: "h1" }))
		mgr.markReady()
		const doomed = mgr.callHook("p", "spin", {}, { kind: "task", timeoutMs: 60_000 })
		expect(await untilRunning(mgr, 1)).toBe(true)
		const [call] = byCallId(mgr)
		expect(await mgr.killCall(call.callId)).toBe(true)
		await doomed
		expect(recs).toHaveLength(1)
		expect(recs[0]).toMatchObject({ ok: false, outcome: "killed" })
	}, 60_000)

	it("stopping a call that has already finished is false, not a throw", async () => {
		mgr = new SandboxManager()
		mgr.register(desc())
		mgr.markReady()
		await call(mgr)
		expect(await mgr.abortCall(1)).toBe(false)
		expect(await mgr.killCall(1)).toBe(false)
	}, 15_000)
})

/**
 * The admin unload (the memory lever): drop the loaded copy while keeping the
 * plugin registered, under the same drain discipline as every other change —
 * and outranking a swap held for the same drain, because cold is what was
 * asked for.
 */
describe("unload drops the copy and keeps the registration", () => {
	const genA =
		"module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 1 }) } }"
	const genB =
		"module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 2 }) } }"

	const untilExecuting = async (m: SandboxManager) => {
		for (let i = 0; i < 300; i++) {
			if (m.activeInvocations().length === 1) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	const gen = async (m: SandboxManager) => {
		const r = await m.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 8000 })
		return r.ok ? (r.value as { gen: number }).gen : -1
	}

	it("a warm quiescent plugin goes cold now, and the next call reloads it", async () => {
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		expect(mgr.isWarm("p")).toBe(true)
		mgr.unload("p")
		expect(mgr.isWarm("p")).toBe(false)
		// Still registered: the next call faults it back in, same bundle.
		expect(await gen(mgr)).toBe(1)
		expect(mgr.isWarm("p")).toBe(true)
	}, 15_000)

	it("waits for an in-flight call, then releases on the drain", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: slow, bundleHash: "h1" }))
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 20_000 })
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.unload("p")
		// Deferred: the running call keeps the copy it started on.
		expect(mgr.isWarm("p")).toBe(true)
		expect((await inFlight).ok).toBe(true)
		expect(mgr.isWarm("p")).toBe(false)
	}, 30_000)

	it("outranks a swap held for the same drain — cold, not re-warmed", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: slow, bundleHash: "h1" }))
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { kind: "task", timeoutMs: 20_000 })
		expect(await untilExecuting(mgr)).toBe(true)
		// A registration change *and* an unload land while it runs. Were the
		// swap to win, the drain would re-warm the copy the admin just asked
		// to drop.
		mgr.register(desc({ bundleSource: genB, bundleHash: "h2" }))
		mgr.unload("p")
		expect((await inFlight).ok).toBe(true)
		expect(mgr.isWarm("p")).toBe(false)
		// The unload dropped the copy, not the change: the next call runs the
		// new bundle.
		expect(await gen(mgr)).toBe(2)
	}, 30_000)

	it("frees a SES plugin's dedicated worker, and the next call rebuilds it", async () => {
		mgr = new SandboxManager()
		mgr.register(
			desc({ bundleSource: genA, bundleHash: "h1", backend: "ses" })
		)
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		const workers = () =>
			(mgr as unknown as { sesWorkers: Map<string, unknown> }).sesWorkers
		expect(workers().has("p")).toBe(true)
		mgr.unload("p")
		// The whole point is the memory: an empty dedicated thread is most of
		// it, so unload takes the worker too — where a swap would keep it.
		expect(workers().has("p")).toBe(false)
		expect(mgr.isWarm("p")).toBe(false)
		expect(await gen(mgr)).toBe(1)
	}, 30_000)

	it("an unknown id is a no-op — the list clicked in may trail an uninstall", () => {
		mgr = new SandboxManager()
		mgr.markReady()
		expect(() => mgr.unload("ghost")).not.toThrow()
	})
})

/**
 * The grace policy, end to end on a real sandbox.
 *
 * `hookGrace.test.ts` proves the sequencing on fake time, where a race can be
 * asserted rather than hoped for. What it cannot prove is that the two ends are
 * connected: that a stopped run finds the calls it started, that an ask really
 * reaches a hook parked inside a sandbox on another thread, and that a hook
 * which returns inside the grace comes back as an ordinary success rather than
 * a corpse. That is what these do, which is why they pay for a real QuickJS
 * worker and a real 2s budget.
 */
describe("stopping a run stops the hooks it started", () => {
	/**
	 * `winds` wakes on its signal and returns — a hook that cleans up. `deaf`
	 * never reaches an await, so the signal can never be delivered to it: from
	 * outside, the one indistinguishable failure mode the policy is built for.
	 */
	const hooks = `module.exports = { hooks: {
		winds: async function (input, ctx) {
			await new Promise(function (res) {
				ctx.signal.addEventListener("abort", function () { res(1) })
			})
			return { id: input.id, wound: true }
		},
		deaf: function () { for (;;) {} }
	} }`

	const untilRunning = async (m: SandboxManager, n: number) => {
		for (let i = 0; i < 600; i++) {
			if (m.activeInvocations().length >= n) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	const RUN = { by: "user:7", reason: "the run was cancelled" }

	it("wakes a run's hook, which returns as an ordinary success", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ bundleSource: hooks, bundleHash: "h1" }))
		mgr.markReady()
		const running = mgr.callHook(
			"p",
			"winds",
			{ id: "a" },
			{ kind: "task", timeoutMs: 60_000, runId: "r1" }
		)
		expect(await untilRunning(mgr, 1)).toBe(true)
		// The live record carries the run, which is the only reason a stop can
		// find this call at all.
		expect(mgr.activeInvocations()[0].runId).toBe("r1")

		const started = Date.now()
		mgr.stopRun("r1", RUN)
		const r = await running

		// It wound down in its own frame and returned. Not killed, and nowhere
		// near the budget — the grace is a ceiling, not a wait.
		expect(r.ok && (r.value as { wound: boolean }).wound).toBe(true)
		expect(Date.now() - started).toBeLessThan(HOOK_CANCEL_GRACE_MS)
		expect(recs[0]).toMatchObject({ ok: true, outcome: "ok", runId: "r1" })
	}, 60_000)

	it("kills a hook that cannot hear the ask, after the budget", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(desc({ bundleSource: hooks, bundleHash: "h1" }))
		mgr.markReady()
		const doomed = mgr.callHook(
			"p",
			"deaf",
			{},
			{ kind: "task", timeoutMs: 60_000, runId: "r1" }
		)
		expect(await untilRunning(mgr, 1)).toBe(true)

		const started = Date.now()
		mgr.stopRun("r1", RUN)
		const r = await doomed
		const elapsed = Date.now() - started

		expect(r.ok).toBe(false)
		expect(!r.ok && r.outcome).toBe("killed")
		// It got the grace, and no more than the grace.
		expect(elapsed).toBeGreaterThanOrEqual(HOOK_CANCEL_GRACE_MS - 50)
		expect(elapsed).toBeLessThan(HOOK_CANCEL_GRACE_MS * 2)
		// Provenance: killed because somebody stopped the run, which is a
		// different thing to know from a hook that blew its own deadline.
		expect(recs[0].outcome).toBe("killed")
		expect(recs[0].reason).toMatch(/cancellation grace/)
		expect(recs[0].reason).toContain("user:7")
	}, 60_000)

	it("spends one budget on five of a run's hooks, not five", async () => {
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: hooks, bundleHash: "h1" }))
		mgr.markReady()
		// Five deaf hooks: nothing here can shorten the wait by cooperating, so
		// the elapsed time is the budget arithmetic and nothing else.
		const doomed = [1, 2, 3, 4, 5].map(() =>
			mgr.callHook("p", "deaf", {}, { kind: "task", timeoutMs: 60_000, runId: "r1" })
		)
		expect(await untilRunning(mgr, 5)).toBe(true)

		const started = Date.now()
		mgr.stopRun("r1", RUN)
		const results = await Promise.all(doomed)
		const elapsed = Date.now() - started

		expect(results.every((r) => !r.ok && r.outcome === "killed")).toBe(true)
		// The claim, as the thing that would actually be felt: cancelling a run
		// with five hooks in flight does not cost five graces.
		expect(elapsed).toBeLessThan(HOOK_CANCEL_GRACE_MS * 2)
	}, 90_000)

	it("leaves another run's hook alone", async () => {
		mgr = new SandboxManager()
		mgr.register(desc({ bundleSource: hooks, bundleHash: "h1" }))
		mgr.markReady()
		let otherSettled = false
		const other = mgr
			.callHook(
				"p",
				"winds",
				{ id: "b" },
				{ kind: "task", timeoutMs: 60_000, runId: "r2" }
			)
			.then((r) => {
				otherSettled = true
				return r
			})
		const doomed = mgr.callHook(
			"p",
			"winds",
			{ id: "a" },
			{ kind: "task", timeoutMs: 60_000, runId: "r1" }
		)
		expect(await untilRunning(mgr, 2)).toBe(true)

		mgr.stopRun("r1", RUN)
		expect((await doomed).ok).toBe(true)
		// Same plugin, same hook, same sandbox — only the run distinguishes
		// them, so this is the assertion that the grouping is real.
		await new Promise((r) => setTimeout(r, 100))
		expect(otherSettled).toBe(false)
		expect(await mgr.abortCall(mgr.activeInvocations()[0].callId)).toBe(
			true
		)
		expect((await other).ok).toBe(true)
	}, 60_000)
})

/**
 * The starvation case, which is a policy problem and not a sandbox one.
 *
 * One shared QuickJS worker hosts every quickjs plugin. A hook spinning
 * synchronously holds that thread, so a *different* job parked in its drive
 * loop cannot run the loop that would notice its own deadline — and the
 * sandbox's fallback for a deadline that never fires is a wall-clock backstop
 * that terminates the whole worker, taking the spinner, every other plugin's
 * in-flight calls and the loaded bundles with it. One misbehaving extension
 * would break every other one.
 *
 * The fix is that this layer stops the starved call *per job*, inside the
 * sandbox's own margin: a shared-memory flag plus a host-side settle needs no
 * cooperation from the blocked thread, and settling the call clears the
 * backstop before it can fire.
 */
describe("a starved call is stopped on its own, not by breaking the worker", () => {
	const park = `module.exports = { hooks: {
		park: async function (input, ctx) {
			await new Promise(function () {})
			return { never: true }
		},
		spin: function () { for (;;) {} }
	} }`

	const untilRunning = async (m: SandboxManager, n: number) => {
		for (let i = 0; i < 600; i++) {
			if (m.activeInvocations().length >= n) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	it("kills the starved call and lets the thread's holder run to its own deadline", async () => {
		const recs: InvocationRecord[] = []
		mgr = new SandboxManager({ onInvocation: (r) => recs.push(r) })
		mgr.register(
			desc({ id: "starved", bundleSource: park, bundleHash: "h1" })
		)
		mgr.register(desc({ id: "hog", bundleSource: park, bundleHash: "h1" }))
		mgr.markReady()

		// Parked, so it is yielding the worker — which is what lets the hog's
		// bundle be stored before it takes the thread.
		const starved = mgr.callHook("starved", "park", {}, { kind: "task", timeoutMs: 500 })
		expect(await untilRunning(mgr, 1)).toBe(true)
		await new Promise((r) => setTimeout(r, 100))
		// A deadline far beyond the starved call's + the sandbox's 1000ms
		// margin: the whole point is that the thread is still held when the
		// worker-wide backstop would have fired.
		const hog = mgr.callHook("hog", "spin", {}, { kind: "task", timeoutMs: 4_000 })
		expect(await untilRunning(mgr, 2)).toBe(true)

		const rs = await starved
		expect(rs.ok).toBe(false)
		expect(!rs.ok && rs.outcome).toBe("killed")
		// Provenance: it overran its own deadline. Distinct from the sentence a
		// cancelled run's hook gets, and it names the deadline it blew.
		expect(!rs.ok && rs.reason).toMatch(/overran its 500ms deadline/)

		// The regression this exists to prevent: the hog is *still running*.
		// Under the worker-wide backstop it would already be dead, along with
		// every other plugin's call and the loaded bundles.
		expect(mgr.activeInvocations().map((c) => c.pluginId)).toEqual(["hog"])

		const rh = await hog
		// And it ended on its own inner interrupt — a timeout, not the error a
		// terminated worker reports to everything it was carrying.
		expect(rh.ok).toBe(false)
		expect(!rh.ok && rh.outcome).toBe("timeout")
		expect(recs.map((r) => r.outcome).sort()).toEqual(["killed", "timeout"])
	}, 60_000)
})
