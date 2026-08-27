import os from "node:os"
import path from "node:path"
import { describe, it, expect, afterEach } from "vitest"
import {
	RuntimeManager,
	storageSegment,
	type InvocationRecord,
	type PluginDescriptor
} from "./RuntimeManager"

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

/**
 * A capability grant (and the bundle itself) is handed to the runtime exactly
 * once, at load. `dispatch` loads only when `has()` is false, and `has()` knows
 * nothing about bundles or grants — so without an explicit drop, an admin
 * revoking network / lowering a quota, or a plugin *update*, would keep running
 * against the copy loaded first.
 *
 * `load` is idempotent per bundle hash, so these tests hold the hash fixed and
 * swap the source: a behaviour change is then proof the copy was dropped and
 * re-loaded, since an un-dropped copy can never see the new source.
 */
describe("register refreshes what the runtime holds", () => {
	const genA = "module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 1 }) } }"
	const genB = "module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 2 }) } }"
	// Never written to — the hooks below never touch ctx.storage; it exists only
	// so a quota is capable of being granted at all (see `capabilityConfig`).
	const dataDir = path.join(os.tmpdir(), "sp-runtime-reload-test")

	/** Resolve once a call is past its load phase and actually executing. */
	const untilExecuting = async (m: RuntimeManager) => {
		for (let i = 0; i < 300; i++) {
			if (m.activeInvocations().length === 1) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	const gen = async (m: RuntimeManager) => {
		const r = await m.callHook("p", "v", { n: 7 }, { timeoutMs: 2000 })
		return r.ok ? (r.value as { gen: number }).gen : -1
	}

	it("a bundle update takes effect without a disable/enable cycle", async () => {
		mgr = new RuntimeManager()
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h2" }))
		expect(await gen(mgr)).toBe(2)
	})

	it("a lowered storage quota re-derives grants at the next call", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		// identical bundle hash: only the quota moved, yet the copy must go
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
		expect(await gen(mgr)).toBe(2)
	})

	it("revoking network drops the copy holding the old allowlist", async () => {
		mgr = new RuntimeManager()
		mgr.register(
			desc({ bundleSource: genA, bundleHash: "h1", networkHosts: ["a.example.com"] })
		)
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1" })) // network denied
		expect(await gen(mgr)).toBe(2)
	})

	it("leaves a warm plugin alone when nothing load-relevant changed", async () => {
		mgr = new RuntimeManager({ dataDir })
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

	it("releases from the runtime that was hosting it, across a flip and back", async () => {
		const genC = "module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 3 }) } }"
		mgr = new RuntimeManager()
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1", backend: "ses" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", backend: "quickjs" }))
		const q = await mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 2000 })
		expect(q.ok && q.backend).toBe("quickjs")
		expect(q.ok && (q.value as { gen: number }).gen).toBe(2)
		// Back to SES. The hash never moves, so `load` is a no-op on any copy
		// the SES side still holds — this only reaches gen 3 if the flip away
		// genuinely released the old worker rather than leaving genA loaded.
		mgr.register(desc({ bundleSource: genC, bundleHash: "h1", backend: "ses" }))
		const s2 = await mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 2000 })
		expect(s2.ok && s2.backend).toBe("ses")
		expect(s2.ok && (s2.value as { gen: number }).gen).toBe(3)
	}, 20_000)

	it("a queued call runs under the current descriptor, not the one it captured", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new RuntimeManager({ dataDir })
		mgr.register(
			desc({ bundleSource: slow, bundleHash: "h1", sequential: true, storageQuotaBytes: 4096 })
		)
		mgr.markReady()
		const first = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 20_000 })
		expect(await untilExecuting(mgr)).toBe(true)
		// Queued behind `first`, so it captured the pre-change descriptor. It
		// must not execute — nor re-install — the grants revoked while it waited.
		const queued = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 20_000 })
		mgr.register(
			desc({ bundleSource: genB, bundleHash: "h1", sequential: true, storageQuotaBytes: 1024 })
		)
		expect((await first).ok).toBe(true)
		const r = await queued
		expect(r.ok && (r.value as { gen: number }).gen).toBe(2)
	}, 30_000)

	it("refreshing one plugin leaves another in the shared runtime alone", async () => {
		const callQ = async () => {
			const r = await mgr.callHook("q", "v", { n: 7 }, { timeoutMs: 2000 })
			return r.ok ? (r.value as { gen: number }).gen : -1
		}
		mgr = new RuntimeManager()
		mgr.register(desc({ id: "p", bundleSource: genA, bundleHash: "h1" }))
		mgr.register(desc({ id: "q", bundleSource: genA, bundleHash: "h1" }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		expect(await callQ()).toBe(1)
		// One QuickJS runtime hosts both, and `loaded` is manager-wide: changing
		// p must not release, reload or otherwise disturb q.
		mgr.register(desc({ id: "p", bundleSource: genB, bundleHash: "h2" }))
		expect(mgr.isWarm("q")).toBe(true)
		expect(await gen(mgr)).toBe(2)
		expect(await callQ()).toBe(1)
	}, 20_000)

it("an in-flight call finishes; the reload lands on the call after it", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: slow, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 20_000 })
		// past the load phase, so the drop below lands on a *running* call
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
		const r = await inFlight
		// `unload` frees the plugin's state; it does not terminate a running call
		expect(r.ok).toBe(true)
		expect(await gen(mgr)).toBe(2)
	}, 30_000)

	it("a change to an idle plugin re-warms it at once, with no call to trigger it", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		expect(await gen(mgr)).toBe(1)
		expect(mgr.isWarm("p")).toBe(true)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
		// The replacement is already loaded — a lazy drop would leave it cold
		// here and only fault the new copy in on the next call.
		expect(mgr.isWarm("p")).toBe(true)
		expect(await gen(mgr)).toBe(2)
	}, 15_000)

	it("leaves a cold plugin cold — there is nothing in use to replace", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		expect(mgr.isWarm("p")).toBe(false)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
		expect(mgr.isWarm("p")).toBe(false)
		expect(await gen(mgr)).toBe(2) // still fresh when it is finally called
	}, 15_000)

	it("holds the swap while a call is in flight, then reloads the moment it drains", async () => {
		const slow =
			"module.exports = { hooks: { v: (i) => { let s = 0; for (let k = 0; k < 8e6; k++) s += k; return { got: i.n, gen: 1, s } } } }"
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: slow, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 20_000 })
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
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
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: hang, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		const doomed = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 300 })
		expect(await untilExecuting(mgr)).toBe(true)
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
		const r = await doomed
		expect(r.ok).toBe(false) // killed by the deadline, never returns cleanly
		// The swap must not be pinned by work that never came back.
		expect(await gen(mgr)).toBe(2)
	}, 30_000)

	it("a register racing a cold call cannot strand the old copy", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: genA, bundleHash: "h1", storageQuotaBytes: 4096 }))
		mgr.markReady()
		// The call captures its descriptor, then the admin change lands before
		// the load finishes — so there is nothing loaded for `register` to drop.
		// Whatever becomes of this call, the *next* one must not go on running
		// the old bundle behind a `has()` that never re-fires.
		const raced = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 5000 })
		mgr.register(desc({ bundleSource: genB, bundleHash: "h1", storageQuotaBytes: 1024 }))
		await raced
		expect(await gen(mgr)).toBe(2)
	}, 15_000)
})

/**
 * An admin kill has to terminate the runtime the call is actually running on.
 * A backend change can land while a call is in flight (deferred until it
 * drains), so the plugin's current descriptor may name a runtime that call was
 * never on — and acting on that one kills a bystander while the target runs on.
 */
describe("admin kill resolves the runtime the call is on", () => {
	const slow =
		"module.exports = { hooks: { v: () => { let s = 0; for (let k = 0; k < 9e7; k++) s += k; return { gen: 1 } } } }"
	const gen2 = "module.exports = { hooks: { v: () => ({ gen: 2 }) } }"
	const dataDir = path.join(os.tmpdir(), "sp-runtime-kill-test")

	const untilRunning = async (m: RuntimeManager) => {
		for (let i = 0; i < 600; i++) {
			if (m.activeInvocations().length >= 1) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	it("does not orphan the loaded copy, leaving revoked grants live", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(
			desc({
				bundleSource: slow,
				bundleHash: "h1",
				storageQuotaBytes: 8_000_000,
				networkHosts: ["evil.example.com"]
			})
		)
		mgr.markReady()
		const running = mgr.callHook("p", "v", {}, { timeoutMs: 60_000 })
		expect(await untilRunning(mgr)).toBe(true)
		const [call] = mgr.activeInvocations()
		mgr.setBackend("p", "ses") // deferred — p is busy, so the call stays on quickjs
		expect(await mgr.killCall(call.callId)).toBe(true)
		await running.catch(() => {})
		// Grants narrowed, same bundle hash. If the kill orphaned the quickjs
		// copy, `load` short-circuits on the hash and the old grants stay live.
		mgr.setBackend("p", "quickjs")
		mgr.register(desc({ bundleSource: gen2, bundleHash: "h1", storageQuotaBytes: 1024 }))
		const r = await mgr.callHook("p", "v", {}, { timeoutMs: 5000 })
		expect(r.ok && (r.value as { gen: number }).gen).toBe(2)
	}, 60_000)

	it("kills the target and spares the bystanders", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(
			desc({
				id: "p",
				bundleSource: "module.exports = { hooks: { v: () => { for(;;){} } } }",
				backend: "ses"
			})
		)
		mgr.register(desc({ id: "q", bundleSource: gen2 }))
		mgr.markReady()
		await mgr.callHook("q", "v", {}, { timeoutMs: 5000 })
		expect(mgr.isWarm("q")).toBe(true)
		const doomed = mgr.callHook("p", "v", {}, { timeoutMs: 12_000 })
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
		// ...and the shared QuickJS runtime, which it was never on, is untouched.
		expect(mgr.isWarm("q")).toBe(true)
	}, 60_000)

	it("does not leak a SES worker when a flipped plugin is released", async () => {
		mgr = new RuntimeManager({ dataDir })
		mgr.register(desc({ bundleSource: gen2, bundleHash: "h1", backend: "ses" }))
		mgr.markReady()
		await mgr.callHook("p", "v", {}, { timeoutMs: 8000 })
		// A leaked worker thread has no public surface, so this reads the map
		// directly rather than inventing API for one invariant.
		const workers = () => (mgr as unknown as { sesWorkers: Map<string, unknown> }).sesWorkers
		expect(workers().has("p")).toBe(true)
		mgr.register(desc({ bundleSource: gen2, bundleHash: "h2", backend: "quickjs" }))
		await mgr.callHook("p", "v", {}, { timeoutMs: 8000 })
		expect(workers().has("p")).toBe(false)
	}, 60_000)
})

/**
 * The admin unload (the memory lever): drop the loaded copy while keeping the
 * plugin registered, under the same drain discipline as every other change —
 * and outranking a swap held for the same drain, because cold is what was
 * asked for.
 */
describe("unload drops the copy and keeps the registration", () => {
	const genA = "module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 1 }) } }"
	const genB = "module.exports = { hooks: { v: (i) => ({ got: i.n, gen: 2 }) } }"

	const untilExecuting = async (m: RuntimeManager) => {
		for (let i = 0; i < 300; i++) {
			if (m.activeInvocations().length === 1) return true
			await new Promise((r) => setTimeout(r, 10))
		}
		return false
	}

	const gen = async (m: RuntimeManager) => {
		const r = await m.callHook("p", "v", { n: 7 }, { timeoutMs: 8000 })
		return r.ok ? (r.value as { gen: number }).gen : -1
	}

	it("a warm quiescent plugin goes cold now, and the next call reloads it", async () => {
		mgr = new RuntimeManager()
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
		mgr = new RuntimeManager()
		mgr.register(desc({ bundleSource: slow, bundleHash: "h1" }))
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 20_000 })
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
		mgr = new RuntimeManager()
		mgr.register(desc({ bundleSource: slow, bundleHash: "h1" }))
		mgr.markReady()
		const inFlight = mgr.callHook("p", "v", { n: 7 }, { timeoutMs: 20_000 })
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
		mgr = new RuntimeManager()
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
		mgr = new RuntimeManager()
		mgr.markReady()
		expect(() => mgr.unload("ghost")).not.toThrow()
	})
})
