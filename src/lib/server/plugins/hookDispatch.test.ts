import { describe, it, expect } from "vitest"
import { makePluginHookDispatch, hookTypesOf } from "./hookDispatch"
import type { PluginHookRequest } from "$lib/server/pipelines/scripts/pluginDispatch"

/**
 * The port that turns a plugin-owned chain link into a `manager.callHook` and
 * its result back into the Scripts sandbox shape. Proven against fakes: the
 * routing (ownerPluginId → runtime id, type id → hook name) and the result
 * translation are the whole job, and both are pure given the db + manager.
 */

/** A `db.select({...}).from().where().limit()` that answers with fixed rows. */
function fakeDb(rows: any[]) {
	const q = {
		from: () => q,
		where: () => q,
		limit: () => Promise.resolve(rows)
	}
	return { select: () => q } as any
}

/** A manager whose `callHook` records its args and returns a fixed result. */
function fakeManager(result: any) {
	const calls: any[] = []
	return {
		calls,
		mgr: {
			callHook: async (
				pluginId: string,
				hookName: string,
				input: any,
				opts: any
			) => {
				calls.push({ pluginId, hookName, input, opts })
				return result
			}
		} as any
	}
}

const req = (over: Partial<PluginHookRequest> = {}): PluginHookRequest => ({
	ownerPluginId: 7,
	typeId: "acme:script:text/transform@1",
	value: "hello",
	extras: { speaker: "Ada" },
	seedLabel: "seed:1",
	nowMs: 1000,
	timeoutMs: 200,
	runId: "run-1",
	user: "42",
	...over
})

describe("hookTypesOf", () => {
	it("reads the map, tolerant of junk", () => {
		expect(
			hookTypesOf({ hookTypes: { "a:script:text/transform@1": "trim" } })
		).toEqual({ "a:script:text/transform@1": "trim" })
		expect(hookTypesOf({})).toEqual({})
		expect(hookTypesOf(null)).toEqual({})
		expect(hookTypesOf("nope")).toEqual({})
		// non-string hook values are dropped
		expect(hookTypesOf({ hookTypes: { x: 5, y: "ok" } })).toEqual({ y: "ok" })
	})
})

describe("makePluginHookDispatch", () => {
	it("resolves owner + hook and forwards a success as a ScriptRunResult", async () => {
		const db = fakeDb([
			{
				pluginId: "acme/tool",
				manifest: {
					hookTypes: { "acme:script:text/transform@1": "trim" }
				}
			}
		])
		const { mgr, calls } = fakeManager({
			ok: true,
			value: "HELLO",
			logs: ["did"],
			durationMs: 4,
			backend: "quickjs"
		})
		const port = makePluginHookDispatch(db, mgr)

		const res = await port.runHook(req())

		// forwarded correctly
		expect(calls).toHaveLength(1)
		expect(calls[0].pluginId).toBe("acme/tool")
		expect(calls[0].hookName).toBe("trim")
		expect(calls[0].input).toEqual({
			value: "hello",
			extras: { speaker: "Ada" }
		})
		expect(calls[0].opts).toMatchObject({
			timeoutMs: 200,
			seedLabel: "seed:1",
			nowMs: 1000,
			runId: "run-1",
			user: "42",
			lifecycle: false
		})
		// translated to the sandbox shape — no backend/outcome leak
		expect(res).toEqual({
			ok: true,
			value: "HELLO",
			logs: ["did"],
			durationMs: 4
		})
	})

	it("forwards a failure, dropping backend/outcome", async () => {
		const db = fakeDb([
			{
				pluginId: "acme/tool",
				manifest: { hookTypes: { "acme:script:text/transform@1": "trim" } }
			}
		])
		const { mgr } = fakeManager({
			ok: false,
			reason: "boom",
			logs: [],
			durationMs: 2,
			backend: "ses",
			outcome: "error"
		})
		const res = await makePluginHookDispatch(db, mgr).runHook(req())
		expect(res).toEqual({ ok: false, reason: "boom", logs: [], durationMs: 2 })
	})

	it("fails cleanly when the owner is gone (never throws)", async () => {
		const { mgr, calls } = fakeManager({ ok: true, value: 1 })
		const res = await makePluginHookDispatch(fakeDb([]), mgr).runHook(req())
		expect(res.ok).toBe(false)
		if (!res.ok) expect(res.reason).toMatch(/no longer installed/)
		expect(calls).toHaveLength(0) // the hook was never dispatched
	})

	it("fails cleanly when no hook is declared for the type", async () => {
		const db = fakeDb([{ pluginId: "acme/tool", manifest: { hookTypes: {} } }])
		const { mgr, calls } = fakeManager({ ok: true, value: 1 })
		const res = await makePluginHookDispatch(db, mgr).runHook(req())
		expect(res.ok).toBe(false)
		if (!res.ok) expect(res.reason).toMatch(/no hook/)
		expect(calls).toHaveLength(0)
	})

	it("resolves each owner once (caches for the run)", async () => {
		let queries = 0
		const q: any = {
			from: () => q,
			where: () => q,
			limit: () => {
				queries++
				return Promise.resolve([
					{
						pluginId: "acme/tool",
						manifest: {
							hookTypes: { "acme:script:text/transform@1": "trim" }
						}
					}
				])
			}
		}
		const db = { select: () => q } as any
		const { mgr } = fakeManager({ ok: true, value: "x", logs: [], durationMs: 1 })
		const port = makePluginHookDispatch(db, mgr)
		await port.runHook(req())
		await port.runHook(req())
		expect(queries).toBe(1)
	})
})
