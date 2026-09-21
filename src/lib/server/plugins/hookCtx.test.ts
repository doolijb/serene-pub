import { describe, it, expect } from "vitest"
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
		expect(hookCtxGrants("task")).toEqual({ storage: false, fetch: false })
		expect(hookCtxGrants("chain-link")).toEqual({ storage: false, fetch: false })
		for (const kind of ["query", "outlet", "event", "lifecycle"] as const)
			expect(hookCtxGrants(kind), kind).toEqual({ storage: true, fetch: false })
		expect(hookCtxGrants("oracle")).toEqual({ storage: true, fetch: true })
	})

	it("keys follow the sandboxes' order: random, now, log, [storage], [fetch], signal", () => {
		expect(hookCtxKeysFor("task")).toEqual(["random", "now", "log", "signal"])
		expect(hookCtxKeysFor("query")).toEqual(["random", "now", "log", "storage", "signal"])
		expect(hookCtxKeysFor("oracle")).toEqual([
			"random",
			"now",
			"log",
			"storage",
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
