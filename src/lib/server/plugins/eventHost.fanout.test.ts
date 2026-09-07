import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it, expect, afterEach } from "vitest"
import { SandboxManager, type PluginDescriptor } from "./SandboxManager"
import { HOOK_CANCEL_GRACE_MS } from "./hookGrace"
import { PluginEventRegistry, type EventSubscription } from "./eventHost"
import type { PluginRowPort } from "./rowStore"

/**
 * The fan-out through the real sandbox: what one subscriber's failure actually
 * costs its siblings, and whether a cancelled run reaches all of them.
 *
 * `eventHost.test.ts` proves the registry's own rules against a fake manager.
 * None of those could see the properties below, because all four live *under*
 * `callHook` — the per-call row snapshot, the sandbox's per-call file
 * transaction, the live call registry a cancel resolves through, and the grace
 * policy's one budget. A fan-out that composed with none of them would pass
 * every test in that file.
 *
 * So each subscriber here is a real hook in a real sandbox that really writes
 * to storage, and the assertions are about what is in the store afterwards.
 */

/**
 * Four subscribers, differing only in how they end. Every one of them writes
 * first, so "did it commit" is a question about the call's transaction rather
 * than about whether it got as far as writing — and each writes a key naming
 * *itself*, so the surviving rows say which calls committed rather than only
 * that something did.
 */
const BUNDLE = `module.exports = { hooks: {
	writeAndReturn: async function (input, ctx) {
		await ctx.storage.put(input.payload.key + ":returned", input.payload.mark);
		return { wrote: true };
	},
	writeAndThrow: async function (input, ctx) {
		await ctx.storage.put(input.payload.key + ":threw", input.payload.mark);
		throw new Error("boom, after writing");
	},
	writeAndWedge: async function (input, ctx) {
		await ctx.storage.put(input.payload.key + ":wedged", input.payload.mark);
		await new Promise(function () {});
		return { wrote: true };
	},
	writeAndWind: async function (input, ctx) {
		await ctx.storage.put(input.payload.key + ":wound", input.payload.mark);
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1); });
		});
		return { wound: true };
	}
} }`

const EVENT = "core:event/message-created@1"
const STOP = { by: "user:7", reason: "the run was cancelled" }

let mgr: SandboxManager
const cleanups: (() => void)[] = []
afterEach(async () => {
	await mgr?.dispose()
	cleanups.splice(0).forEach((f) => f())
})

function tmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "sp-fanout-"))
	cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
	return d
}

/**
 * The row store as a map. A real `plugin_rows` table would answer the same
 * questions and need a database to do it; what matters here is that `load` and
 * `commit` are per call and per plugin, which this is.
 */
function memoryRows() {
	const store = new Map<string, Map<string, unknown>>()
	const of = (pluginId: string) => {
		const m = store.get(pluginId) ?? new Map<string, unknown>()
		store.set(pluginId, m)
		return m
	}
	const port: PluginRowPort = {
		load: async (pluginId) =>
			[...of(pluginId)].map(([key, value]) => ({
				key,
				value,
				bytes: 0,
				updatedAt: new Date(0).toISOString()
			})),
		commit: async (pluginId, changes) => {
			const m = of(pluginId)
			for (const c of changes)
				if (c.op === "put") m.set(c.key, c.value)
				else m.delete(c.key)
		}
	}
	return { port, keys: (pluginId: string) => [...of(pluginId).keys()].sort() }
}

function managerWith(rows: PluginRowPort, ids: string[]): SandboxManager {
	const dataDir = tmp()
	const m = new SandboxManager({ dataDir, rows })
	for (const id of ids) m.register(descriptorFor(id))
	m.markReady()
	return m
}

const descriptorFor = (id: string): PluginDescriptor => ({
	id,
	name: id,
	bundleSource: BUNDLE,
	bundleHash: "h-fanout",
	backends: ["quickjs"],
	backend: "quickjs",
	sequential: false,
	storageQuotaBytes: 64 * 1024
})

const sub = (
	pluginId: string,
	hookName: string,
	over: Partial<EventSubscription> = {}
): EventSubscription => ({
	pluginId,
	event: EVENT,
	hookName,
	timeoutMs: 5_000,
	index: 0,
	...over
})

/** Wait until at least `n` calls are in flight, or give up. */
async function untilRunning(n: number): Promise<number> {
	for (let i = 0; i < 600; i++) {
		if (mgr.activeInvocations().length >= n)
			return mgr.activeInvocations().length
		await new Promise((r) => setTimeout(r, 10))
	}
	return mgr.activeInvocations().length
}

describe("two extensions on one event", () => {
	it("both run, and one throwing leaves the other's committed rows alone", async () => {
		const rows = memoryRows()
		mgr = managerWith(rows.port, ["a/one", "b/two"])
		const reg = new PluginEventRegistry()
		reg.replace([
			sub("a/one", "writeAndThrow"),
			sub("b/two", "writeAndReturn")
		])

		const fanout = await reg.notify(mgr, EVENT, {
			key: "seen",
			mark: "here"
		})

		expect(fanout.deliveries.map((d) => [d.pluginId, d.outcome])).toEqual([
			["a/one", "error"],
			["b/two", "ok"]
		])
		expect(fanout.deliveries[0]!.reason).toMatch(/boom, after writing/)
		// The thrower wrote before it threw, and its transaction discarded the
		// write. Its sibling's is untouched — a different plugin's failure is
		// not an event a plugin can even observe.
		expect(rows.keys("a/one")).toEqual([])
		expect(rows.keys("b/two")).toEqual(["seen:returned"])
	}, 30_000)

	it("gives each subscriber of ONE extension its own transaction", async () => {
		// The case two plugins cannot prove: same extension, same storage
		// namespace, two subscribers to one event. A transaction shared across
		// the fan-out would lose the good write with the bad one.
		const rows = memoryRows()
		mgr = managerWith(rows.port, ["a/one"])
		const reg = new PluginEventRegistry()
		reg.replace([
			sub("a/one", "writeAndThrow", { index: 0 }),
			sub("a/one", "writeAndReturn", { index: 1 })
		])

		const fanout = await reg.notify(mgr, EVENT, { key: "own", mark: "x" })

		expect(fanout.deliveries.map((d) => d.outcome)).toEqual(["error", "ok"])
		// One key, not none and not both: a transaction shared across the
		// fan-out would either have rolled the good write back with the bad one
		// or committed them together.
		expect(rows.keys("a/one")).toEqual(["own:returned"])
	}, 30_000)

	it("commits nothing for a killed subscriber, and everything for its sibling", async () => {
		const rows = memoryRows()
		mgr = managerWith(rows.port, ["a/one", "b/two"])
		const reg = new PluginEventRegistry()
		reg.replace([
			sub("a/one", "writeAndWedge"),
			sub("b/two", "writeAndReturn")
		])

		const fanning = reg.notify(mgr, EVENT, { key: "seen", mark: "here" })
		await untilRunning(1)
		const wedged = mgr
			.activeInvocations()
			.find((c) => c.hookName === "writeAndWedge")
		expect(wedged).toBeTruthy()
		expect(await mgr.killCall(wedged!.callId, "killed by the test")).toBe(
			true
		)

		const fanout = await fanning

		expect(fanout.deliveries.map((d) => [d.pluginId, d.outcome])).toEqual([
			["a/one", "error"],
			["b/two", "ok"]
		])
		// "A killed hook commits nothing" is the guarantee the per-call
		// transaction exists for, and a fan-out must not be the thing that
		// spends it.
		expect(rows.keys("a/one")).toEqual([])
		expect(rows.keys("b/two")).toEqual(["seen:returned"])
	}, 30_000)
})

describe("a fan-out inside a cancelled run", () => {
	it("reaches every subscriber, not just the first, on one budget", async () => {
		const rows = memoryRows()
		const ids = ["a/one", "b/two", "c/three"]
		mgr = managerWith(rows.port, ids)
		const reg = new PluginEventRegistry()
		reg.replace(ids.map((id) => sub(id, "writeAndWind")))

		const fanning = reg.notify(
			mgr,
			EVENT,
			{ key: "seen", mark: "here" },
			{ runId: "run-fan", user: "7" }
		)
		expect(await untilRunning(3)).toBe(3)

		// The association a cancel resolves through: `callsOfRun` filters the
		// live registry by run id, so a fan-out whose subscribers did not all
		// carry it would be one a cancel reached partly.
		const live = mgr.activeInvocations()
		expect(live.map((c) => c.runId)).toEqual([
			"run-fan",
			"run-fan",
			"run-fan"
		])
		expect(new Set(live.map((c) => c.pluginId))).toEqual(new Set(ids))

		const startedAt = Date.now()
		mgr.stopRun("run-fan", STOP)
		const fanout = await fanning
		const elapsed = Date.now() - startedAt

		// All three woke on their own signal and returned in their own frame —
		// so all three are ordinary successes, and all three committed.
		expect(fanout.deliveries.map((d) => d.outcome)).toEqual([
			"ok",
			"ok",
			"ok"
		])
		for (const id of ids) expect(rows.keys(id)).toEqual(["seen:wound"])
		// One budget for the three of them: the grace is a ceiling on the run,
		// not a wait each hook is entitled to in turn.
		expect(elapsed).toBeLessThan(HOOK_CANCEL_GRACE_MS)
	}, 30_000)
})
