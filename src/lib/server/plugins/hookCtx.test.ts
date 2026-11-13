import { describe, it, expect } from "vitest"
import {
	USER_ANNEX_CLOSED,
	USER_STORAGE_CLOSED,
	appletClosedRefusal,
	frameCauseFor,
	frameOpenFor
} from "$lib/server/sockets/appletCause"
import {
	HOOK_CTX_KINDS,
	hookCtxGrants,
	hookCtxKeysFor,
	isHookCtxKind
} from "./hookCtx"

/**
 * The table itself (plans/29 R-3), pinned as data: which kind gets which
 * member, in the order the sandboxes define them, and what the guard refuses.
 */
describe("hookCtx — the table", () => {
	it("grants by kind: task and chain-link neither, oracle both, the rest storage", () => {
		expect(hookCtxGrants("task")).toEqual({ storage: false, package: false, annex: false, fetch: false })
		expect(hookCtxGrants("chain-link")).toEqual({ storage: false, package: false, annex: false, fetch: false })
		for (const kind of ["query", "outlet", "event", "lifecycle"] as const)
			expect(hookCtxGrants(kind), kind).toEqual({ storage: true, package: true, annex: true, fetch: false })
		expect(hookCtxGrants("oracle")).toEqual({ storage: true, package: true, annex: true, fetch: true })
	})

	it("keys follow the sandboxes' order: random, now, log, [storage], [package], [annex], [fetch], signal", () => {
		expect(hookCtxKeysFor("task")).toEqual(["random", "now", "log", "signal"])
		expect(hookCtxKeysFor("query")).toEqual(["random", "now", "log", "storage", "package", "annex", "signal"])
		expect(hookCtxKeysFor("oracle")).toEqual([
			"random",
			"now",
			"log",
			"storage",
			"package",
			"annex",
			"fetch",
			"signal"
		])
	})

	it("refuses a missing kind, an unknown one, and a prototype key", () => {
		for (const kind of HOOK_CTX_KINDS) expect(isHookCtxKind(kind), kind).toBe(true)
		expect(isHookCtxKind(undefined)).toBe(false)
		expect(isHookCtxKind("widget")).toBe(false)
		// `"constructor" in table` is true through Object.prototype; a kind
		// read off a manifest or a registry row must not pass by it.
		expect(isHookCtxKind("constructor")).toBe(false)
		expect(isHookCtxKind("__proto__")).toBe(false)
		expect(isHookCtxKind("toString")).toBe(false)
		expect(() => hookCtxGrants("constructor")).toThrow(/without a hook ctx kind/)
		expect(() => hookCtxGrants(undefined)).toThrow(/plans\/29 R-3/)
	})
})

/**
 * The applet group (`ctx.annex('user')`, `ctx.storage.user`) derives from the
 * frame-origin cause at RUN time, never from the table: INTEGRATING step 8 —
 * a member the kind is not granted is absent, never a stub that refuses — so
 * the table is unchanged and the closed state is a rejection, like "no person
 * is acting".
 */
describe("hookCtx — the applet group follows the frame-origin cause, not the table", () => {
	it("event and lifecycle hooks keep both members on the ctx (they reject when no frame is open)", () => {
		for (const kind of ["event", "lifecycle"] as const) {
			expect(hookCtxGrants(kind).annex, kind).toBe(true)
			expect(hookCtxGrants(kind).storage, kind).toBe(true)
			expect(hookCtxKeysFor(kind), kind).toContain("annex")
		}
	})

	it("the cause opens the applet group only for the plugin whose frame it names", () => {
		expect(frameOpenFor(frameCauseFor("acme.saves"), "acme.saves")).toBe(true)
		expect(frameOpenFor(frameCauseFor("acme.saves"), "acme.other")).toBe(false)
		expect(frameOpenFor(undefined, "acme.saves")).toBe(false)
	})

	it("one sentence everywhere: <thing> is only available while the app is open.", () => {
		expect(appletClosedRefusal("Anything")).toBe("Anything is only available while the app is open.")
		expect(USER_ANNEX_CLOSED).toBe("This person's saved data is only available while the app is open.")
		expect(USER_STORAGE_CLOSED).toBe("Per-person storage is only available while the app is open.")
	})
})
