import { describe, it, expect } from "vitest"
import {
	PluginEventRegistry,
	compareSubscriptions,
	eventListenersOf,
	subscriptionsOf,
	EVENT_FANOUT_BUDGET_MS,
	EVENT_HOOK_TIMEOUT_MS,
	type EventSubscription
} from "./eventHost"
import { declaredPermissions, reviewMarks } from "./permissions"
import type { SandboxManager } from "./SandboxManager"

/**
 * The registry, against a recording manager.
 *
 * Everything asserted here is about the *fan-out* rather than the plumbing
 * underneath it: who runs, in what order, what one subscriber's failure costs
 * the others, that every return is dropped, and how much time the whole thing
 * may spend. The manager is a fake because none of those questions are about a
 * sandbox — `eventHost.fanout.test.ts` beside this one asks the ones that are,
 * through the real sandboxes.
 */

const EVENT = "core:event/message-created@1"
const OTHER = "core:event/session-created@1"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A manager whose `callHook` is scripted per `pluginId:hookName`. */
function fakeManager(
	answers: Record<
		string,
		(input: any, opts: any) => unknown | Promise<unknown>
	>
) {
	const calls: {
		pluginId: string
		hookName: string
		input: any
		opts: any
	}[] = []
	const mgr = {
		callHook: async (
			pluginId: string,
			hookName: string,
			input: any,
			opts: any
		) => {
			calls.push({ pluginId, hookName, input, opts })
			const fn = answers[`${pluginId}:${hookName}`]
			if (!fn)
				return {
					ok: false,
					reason: "no such hook",
					logs: [],
					durationMs: 0,
					backend: "quickjs",
					outcome: "missing"
				}
			const value = await fn(input, opts)
			return {
				ok: true,
				value,
				logs: [],
				durationMs: 1,
				backend: "quickjs"
			}
		}
	} as unknown as SandboxManager
	return { mgr, calls }
}

/** A manager whose every call fails the way a throwing hook does. */
const failingManager = (reason: string) =>
	({
		callHook: async () => ({
			ok: false,
			reason,
			logs: [],
			durationMs: 1,
			backend: "quickjs",
			outcome: "error"
		})
	}) as unknown as SandboxManager

const sub = (over: Partial<EventSubscription> = {}): EventSubscription => ({
	pluginId: "acme/one",
	event: EVENT,
	hookName: "onEvent",
	timeoutMs: EVENT_HOOK_TIMEOUT_MS,
	index: 0,
	...over
})

/** A manifest that declares the permission every subscription below needs. */
const manifestFor = (
	eventHooks: unknown[],
	events: string[] = [EVENT, OTHER]
) => ({ permissions: { events }, eventHooks })

/**
 * `subscriptionsOf` for a plugin an admin has **reviewed** — declaring an
 * `event:` permission is only a request, and an unreviewed one is refused like
 * any other (permissions.ts). Anything a case names as denied is layered on top,
 * so a denial is still a denial of something that was otherwise granted.
 */
const subsOf = (row: {
	pluginId: string
	manifest?: unknown
	adminDenied?: string[]
}) =>
	subscriptionsOf({
		...row,
		adminDenied: [
			...reviewMarks(declaredPermissions(row.manifest as any)),
			...(row.adminDenied ?? [])
		]
	})

describe("eventListenersOf", () => {
	it("reads the array, tolerant of its json being anything", () => {
		expect(
			eventListenersOf({ eventHooks: [{ event: EVENT, hook: "h" }] })
		).toEqual([{ event: EVENT, hook: "h" }])
		expect(eventListenersOf({})).toEqual([])
		expect(eventListenersOf(null)).toEqual([])
		expect(eventListenersOf("nope")).toEqual([])
		// A map where an array belongs is not half-read into one.
		expect(eventListenersOf({ eventHooks: { a: "b" } })).toEqual([])
		// Non-object entries are dropped; the rest of the array survives them.
		expect(
			eventListenersOf({ eventHooks: [1, null, ["x"], { event: EVENT }] })
		).toEqual([{ event: EVENT }])
	})

	/**
	 * The packager's spelling (D-6). `serene-pub build` writes the same
	 * declarations at `hooks.eventListeners`, and this module is their one
	 * reader, so the two are reconciled here rather than left to disagree — a
	 * subscription that vanished between two vocabularies is a hook that never
	 * fires and never says why.
	 */
	it("reads the packager's hooks.eventListeners too, and prefers the app key", () => {
		expect(
			eventListenersOf({ hooks: { eventListeners: [{ event: EVENT }] } })
		).toEqual([{ event: EVENT }])
		// Both present: the app key wins, because it is the richer shape.
		expect(
			eventListenersOf({
				eventHooks: [{ event: EVENT, hook: "h" }],
				hooks: { eventListeners: [{ event: OTHER }] }
			})
		).toEqual([{ event: EVENT, hook: "h" }])
		// And `hooks` carrying anything else is not half-read.
		expect(eventListenersOf({ hooks: { handlers: [] } })).toEqual([])
	})

	it("says what the packager's entry is missing, naming its own field", () => {
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/packaged",
			manifest: {
				permissions: [`event:${EVENT}`],
				hooks: { eventListeners: [{ event: EVENT }] }
			}
		})
		expect(subscriptions).toEqual([])
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain("hooks.eventListeners[0]")
		expect(problems[0]).toContain("no 'hook'")
		// …and points at the shape that works today.
		expect(problems[0]).toContain("eventHooks")
	})
})

describe("subscriptionsOf", () => {
	it("reads a well-formed declaration, defaulting the timeout", () => {
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([{ event: EVENT, hook: "onMessage" }])
		})
		expect(problems).toEqual([])
		expect(subscriptions).toEqual([
			{
				pluginId: "acme/one",
				event: EVENT,
				hookName: "onMessage",
				timeoutMs: EVENT_HOOK_TIMEOUT_MS,
				index: 0
			}
		])
	})

	it("ignores a declared kind or priority — neither is a field any more", () => {
		// The two the registry used to read. A manifest written against the old
		// SDK still installs and still subscribes; what it asked for is simply
		// not a thing the fan-out has, and an author's stale `kind: "filter"`
		// can no longer be mistaken for an opt-in to rewriting a sibling's value.
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([
				{
					event: EVENT,
					hook: "onMessage",
					kind: "filter",
					priority: -10
				}
			])
		})
		expect(problems).toEqual([])
		expect(subscriptions[0]).toEqual({
			pluginId: "acme/one",
			event: EVENT,
			hookName: "onMessage",
			timeoutMs: EVENT_HOOK_TIMEOUT_MS,
			index: 0
		})
	})

	it("lets one plugin subscribe more than one hook to one event", () => {
		const { subscriptions } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([
				{ event: EVENT, hook: "a" },
				{ event: EVENT, hook: "b" }
			])
		})
		expect(subscriptions.map((s) => s.hookName)).toEqual(["a", "b"])
	})

	it("refuses an entry that is not an event reference, keeping the rest", () => {
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([
				{ event: "message-created", hook: "a" },
				{ event: EVENT, hook: "b" }
			])
		})
		expect(subscriptions.map((s) => s.hookName)).toEqual(["b"])
		expect(problems[0]).toMatch(/is not an event reference/)
	})

	it("refuses an entry that names no hook", () => {
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([{ event: EVENT }])
		})
		expect(subscriptions).toEqual([])
		expect(problems[0]).toMatch(/no 'hook'/)
	})

	it("refuses a subscription the manifest never asked permission for", () => {
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/one",
			// Declares the hook, but requests permission for a different event.
			manifest: manifestFor([{ event: EVENT, hook: "a" }], [OTHER])
		})
		expect(subscriptions).toEqual([])
		expect(problems[0]).toMatch(/not a granted event permission/)
	})

	it("refuses a subscription whose permission an admin has denied", () => {
		const manifest = manifestFor([{ event: EVENT, hook: "a" }])
		expect(
			subsOf({ pluginId: "acme/one", manifest }).subscriptions
		).toHaveLength(1)
		const denied = subsOf({
			pluginId: "acme/one",
			manifest,
			adminDenied: [`event:${EVENT}`]
		})
		expect(denied.subscriptions).toEqual([])
		expect(denied.problems[0]).toMatch(/not a granted event permission/)
	})

	it("reads the compiled flat permission form too", () => {
		const { subscriptions } = subsOf({
			pluginId: "acme/one",
			manifest: {
				permissions: [`event:${EVENT}`],
				eventHooks: [{ event: EVENT, hook: "a" }]
			}
		})
		expect(subscriptions).toHaveLength(1)
	})

	it("registers a repeated (event, hook) pair once", () => {
		const { subscriptions, problems } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([
				{ event: EVENT, hook: "a", timeoutMs: 11 },
				{ event: EVENT, hook: "a", timeoutMs: 22 }
			])
		})
		expect(subscriptions).toHaveLength(1)
		expect(subscriptions[0]!.timeoutMs).toBe(11) // the first declaration stands
		expect(problems[0]).toMatch(/already subscribed/)
	})

	it("clamps a declared timeout into the fan-out budget", () => {
		const { subscriptions } = subsOf({
			pluginId: "acme/one",
			manifest: manifestFor([
				{
					event: EVENT,
					hook: "a",
					timeoutMs: 10 * EVENT_FANOUT_BUDGET_MS
				},
				{ event: EVENT, hook: "b", timeoutMs: -1 },
				{ event: EVENT, hook: "c", timeoutMs: "soon" },
				{ event: EVENT, hook: "d", timeoutMs: 40 }
			])
		})
		expect(subscriptions.map((s) => s.timeoutMs)).toEqual([
			EVENT_FANOUT_BUDGET_MS,
			EVENT_HOOK_TIMEOUT_MS,
			EVENT_HOOK_TIMEOUT_MS,
			40
		])
	})
})

describe("dispatch order", () => {
	it("is the plugin's own declaration order, tie-broken by plugin id", () => {
		const subs = [
			sub({ pluginId: "b/two", hookName: "b1", index: 1 }),
			sub({ pluginId: "b/two", hookName: "b0", index: 0 }),
			sub({ pluginId: "a/one", hookName: "a1", index: 1 }),
			sub({ pluginId: "a/one", hookName: "a0", index: 0 })
		]
		expect(
			[...subs].sort(compareSubscriptions).map((s) => s.hookName)
		).toEqual(["a0", "a1", "b0", "b1"])
	})

	it("compares plugin ids by code unit, not by locale", () => {
		// A locale-dependent order is not the same order on two machines, which
		// is the whole property this comparator exists to provide. These two
		// sort one way under `localeCompare` and the other by code unit.
		const a = sub({ pluginId: "a/zebra" })
		const b = sub({ pluginId: "a/Zebra" })
		expect(compareSubscriptions(a, b)).toBeGreaterThan(0)
		expect("a/Zebra".localeCompare("a/zebra")).toBeGreaterThan(0)
	})

	it("is the same order whatever order the registry was filled in", () => {
		// Install order is what registration order actually is, and it differs
		// between two instances running the same extensions. Nothing may depend
		// on it — so every permutation has to land in one order.
		const subs = [
			sub({ pluginId: "c/three", hookName: "c0" }),
			sub({ pluginId: "a/one", hookName: "a1", index: 1 }),
			sub({ pluginId: "a/one", hookName: "a0", index: 0 }),
			sub({ pluginId: "b/two", hookName: "b0" })
		]
		const expected = ["a0", "a1", "b0", "c0"]
		for (const seed of [0, 1, 2, 3]) {
			const shuffled = subs.map((_, i) => subs[(i + seed) % subs.length]!)
			const reg = new PluginEventRegistry()
			reg.replace(shuffled)
			expect(reg.subscribers(EVENT).map((s) => s.hookName)).toEqual(
				expected
			)
		}
	})

	it("groups by event and answers an unsubscribed one with nothing", () => {
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ hookName: "a" }),
			sub({ event: OTHER, hookName: "b" })
		])
		expect(reg.events()).toEqual([EVENT, OTHER].sort())
		expect(reg.subscribers(EVENT).map((s) => s.hookName)).toEqual(["a"])
		expect(reg.subscribers("core:event/nobody@1")).toEqual([])
	})
})

describe("notify", () => {
	it("runs every subscriber of an event, in dispatch order", async () => {
		const { mgr, calls } = fakeManager({
			"a/one:first": () => "ignored",
			"b/two:second": () => "ignored"
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "b/two", hookName: "second" }),
			sub({ pluginId: "a/one", hookName: "first" })
		])

		const fanout = await reg.notify(mgr, EVENT, { id: 7 })

		expect(calls.map((c) => c.hookName)).toEqual(["first", "second"])
		expect(fanout.deliveries.map((d) => [d.hookName, d.outcome])).toEqual([
			["first", "ok"],
			["second", "ok"]
		])
		// The envelope, so a hook subscribed to several events knows which fired.
		expect(calls[0]!.input).toEqual({ event: EVENT, payload: { id: 7 } })
	})

	it("keeps a thrown subscriber from touching its sibling's result", async () => {
		const ran: string[] = []
		const { mgr } = fakeManager({
			"a/one:boom": () => {
				ran.push("boom")
				throw new Error("hook exploded")
			},
			"b/two:fine": () => {
				ran.push("fine")
				return "kept"
			}
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "a/one", hookName: "boom" }),
			sub({ pluginId: "b/two", hookName: "fine" })
		])

		const fanout = await reg.notify(mgr, EVENT, {})

		expect(ran).toEqual(["boom", "fine"])
		expect(fanout.deliveries.map((d) => d.outcome)).toEqual(["error", "ok"])
		expect(fanout.deliveries[0]!.reason).toMatch(/hook exploded/)
	})

	it("survives every subscriber failing, and never rejects", async () => {
		const reg = new PluginEventRegistry()
		reg.replace([sub({ hookName: "a" }), sub({ hookName: "b", index: 1 })])
		const fanout = await reg.notify(failingManager("killed"), EVENT, {})
		expect(fanout.deliveries.map((d) => d.outcome)).toEqual([
			"error",
			"error"
		])
	})

	it("ignores what a subscriber returns", async () => {
		const { mgr } = fakeManager({
			"a/one:wrapped": () => ({ kind: "ok", value: "rewritten" }),
			"b/two:bare": () => "rewritten",
			"c/three:silent": () => undefined
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "a/one", hookName: "wrapped" }),
			sub({ pluginId: "b/two", hookName: "bare" }),
			sub({ pluginId: "c/three", hookName: "silent" })
		])
		const fanout = await reg.notify(mgr, EVENT, "original")
		// Fire-and-forget (11 §3): nothing a subscriber returns leaves the
		// fan-out, so no subscriber can rewrite what a sibling — or the emitter
		// — is given. There is no shape here for a value to travel in.
		for (const d of fanout.deliveries) {
			expect(d).not.toHaveProperty("value")
			expect(d.outcome).toBe("ok")
		}
	})

	it("treats a halt as a success, and an err as the one failure", async () => {
		const { mgr } = fakeManager({
			"a/one:decline": () => ({
				kind: "halt",
				reason: "not my chat type"
			}),
			"b/two:no": () => ({ kind: "err", reason: "cannot" }),
			"c/three:kindish": () => ({ kind: "message", body: "hi" })
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "a/one", hookName: "decline" }),
			sub({ pluginId: "b/two", hookName: "no" }),
			sub({ pluginId: "c/three", hookName: "kindish" })
		])

		const fanout = await reg.notify(mgr, EVENT, {})

		// Declining is the applicability check most subscribers to a hot event
		// do first, and 11 §3 calls it normal — so it is not a failure. A
		// returned object whose own `kind` is not one of the SDK's four is not
		// a verdict about itself either.
		expect(fanout.deliveries.map((d) => d.outcome)).toEqual([
			"halt",
			"error",
			"ok"
		])
		expect(fanout.deliveries[0]!.reason).toMatch(/not my chat type/)
		expect(fanout.deliveries[1]!.reason).toMatch(/cannot/)
	})

	it("dispatches nothing when nobody subscribes", async () => {
		const { mgr, calls } = fakeManager({})
		const reg = new PluginEventRegistry()
		expect(await reg.notify(mgr, EVENT, {})).toEqual({
			event: EVENT,
			deliveries: []
		})
		expect(calls).toEqual([])
	})
})

describe("one budget for the fan-out, not N", () => {
	it("caps each subscriber by what is left of the whole", async () => {
		const slow = async () => {
			await sleep(40)
			return null
		}
		const { mgr, calls } = fakeManager({
			"a/one:slow": slow,
			"b/two:slow": slow,
			"c/three:slow": slow,
			"d/four:slow": slow
		})
		const link = (pluginId: string) =>
			sub({ pluginId, hookName: "slow", timeoutMs: 250 })
		const reg = new PluginEventRegistry()
		reg.replace([
			link("a/one"),
			link("b/two"),
			link("c/three"),
			link("d/four")
		])

		const startedAt = Date.now()
		await reg.notify(mgr, EVENT, "v", { budgetMs: 100 })
		const elapsed = Date.now() - startedAt

		// Four subscribers declaring 250ms each do NOT get 1000ms between them.
		// Every one is handed what is left of the one budget instead of the
		// deadline it asked for: the budget is a ceiling, never an extension.
		const granted: number[] = calls.map((c) => c.opts.timeoutMs)
		expect(granted).toHaveLength(4)
		expect(granted.every((t) => t <= 100)).toBe(true)
		// So the whole fan-out costs one budget rather than four.
		expect(elapsed).toBeLessThan(4 * 250)
	})

	it("stops waiting on a fan-out when the budget expires", async () => {
		const { mgr } = fakeManager({
			"a/one:quick": () => null,
			"b/two:wedged": async () => {
				await sleep(1_000)
				return null
			}
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "a/one", hookName: "quick" }),
			sub({ pluginId: "b/two", hookName: "wedged" })
		])

		const startedAt = Date.now()
		const fanout = await reg.notify(mgr, EVENT, {}, { budgetMs: 60 })

		// The emitter returns on the budget, not on the slowest subscriber — an
		// event hook may not make the action that caused it wait.
		expect(Date.now() - startedAt).toBeLessThan(500)
		expect(fanout.deliveries.map((d) => [d.hookName, d.outcome])).toEqual([
			["quick", "ok"],
			["wedged", "skipped"]
		])
		expect(fanout.deliveries[1]!.reason).toMatch(/abandoned, not stopped/)
	})

	it("cannot be asked for more than the constant", async () => {
		const { mgr, calls } = fakeManager({ "acme/one:h": () => null })
		const reg = new PluginEventRegistry()
		reg.replace([sub({ hookName: "h", timeoutMs: EVENT_FANOUT_BUDGET_MS })])
		await reg.notify(mgr, EVENT, "v", { budgetMs: 60 * 60 * 1000 })
		expect(calls[0]!.opts.timeoutMs).toBeLessThanOrEqual(
			EVENT_FANOUT_BUDGET_MS
		)
	})
})

describe("cancellation", () => {
	it("forwards the run id to every subscriber, not just the first", async () => {
		const { mgr, calls } = fakeManager({
			"a/one:h": () => null,
			"b/two:h": () => null,
			"c/three:h": () => null
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "a/one", hookName: "h" }),
			sub({ pluginId: "b/two", hookName: "h" }),
			sub({ pluginId: "c/three", hookName: "h" })
		])

		await reg.notify(mgr, EVENT, {}, { runId: "run-9", user: "42" })

		// The grace policy groups in-flight hooks by run id and has nothing else
		// to group by, so a subscriber dispatched without one is a subscriber a
		// cancelled run cannot reach.
		expect(calls.map((c) => c.opts.runId)).toEqual([
			"run-9",
			"run-9",
			"run-9"
		])
		expect(calls.every((c) => c.opts.user === "42")).toBe(true)
	})

	it("dispatches nothing once the emitter's signal has fired", async () => {
		const { mgr, calls } = fakeManager({ "acme/one:h": () => null })
		const reg = new PluginEventRegistry()
		reg.replace([sub({ hookName: "h" }), sub({ hookName: "h2", index: 1 })])
		const ac = new AbortController()
		ac.abort()

		const notified = await reg.notify(mgr, EVENT, {}, { signal: ac.signal })

		// Every subscriber is accounted for, not just dropped: a cancelled
		// fan-out still reports one delivery per subscription.
		expect(calls).toEqual([])
		expect(notified.deliveries).toHaveLength(2)
		expect(notified.deliveries.every((d) => d.outcome === "skipped")).toBe(
			true
		)
		expect(notified.deliveries[0]!.reason).toMatch(/run was cancelled/)
	})

	it("contains a manager that rejects outright", async () => {
		const broken = {
			callHook: async () => {
				throw new Error("the sandbox is gone")
			}
		} as unknown as SandboxManager
		const reg = new PluginEventRegistry()
		reg.replace([sub({ hookName: "h" })])
		const fanout = await reg.notify(broken, EVENT, {})
		expect(fanout.deliveries[0]!.outcome).toBe("error")
		expect(fanout.deliveries[0]!.reason).toMatch(/the sandbox is gone/)
	})
})

describe("the pinned clock", () => {
	it("gives every subscriber of one occurrence the same instant and a distinct seed", async () => {
		const { mgr, calls } = fakeManager({
			"a/one:h": () => null,
			"b/two:h": () => null
		})
		const reg = new PluginEventRegistry()
		reg.replace([
			sub({ pluginId: "a/one", hookName: "h" }),
			sub({ pluginId: "b/two", hookName: "h" })
		])

		await reg.notify(mgr, EVENT, {}, { nowMs: 1_700_000_000_000 })

		expect(calls.map((c) => c.opts.nowMs)).toEqual([
			1_700_000_000_000, 1_700_000_000_000
		])
		const seeds = calls.map((c) => c.opts.seedLabel)
		expect(new Set(seeds).size).toBe(2)
		for (const s of seeds) expect(s).toContain("1700000000000")
	})
})
