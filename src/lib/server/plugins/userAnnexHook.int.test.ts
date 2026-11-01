import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { SandboxManager } from "./SandboxManager"
import { getUserAnnex, setUserAnnex } from "./userAnnex"

/**
 * 🚧 (M2b) `ctx.annex('user')` from a hook, end to end through the manager on
 * both backends: loaded before the call, answered from a projection inside it
 * (read-your-writes), buffered writes committed after an OK return, all or
 * nothing. Needs the `user_annexes` table (drizzle/0139) and the built SDK
 * (the grant table's `annex`).
 */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const ID = "acme.saves"

const HOOK = `module.exports = { hooks: {
	keys: function (input, ctx) { return Object.keys(ctx); },
	get: async function (input, ctx) { return await ctx.annex('user').get(input.key); },
	set: async function (input, ctx) {
		return await ctx.annex('user').set(input.key, input.doc, input.base === undefined ? undefined : { base: input.base });
	},
	list: async function (input, ctx) { return await ctx.annex('user').list(input.prefix); },
	remove: async function (input, ctx) {
		return await ctx.annex('user').remove(input.key, input.base === undefined ? undefined : { base: input.base });
	},
	ryw: async function (input, ctx) {
		var a = ctx.annex('user');
		var w1 = await a.set('saves/a', { n: 1 });
		var got = await a.get('saves/a');
		var w2 = await a.set('saves/a', { n: 2 }, { base: w1.version });
		var bad = await a.set('saves/a', { n: 3 }, { base: 1 });
		var listed = await a.list('saves/');
		await a.remove('saves/b');
		return { w1: w1, got: got.doc, w2: w2, bad: bad, listed: listed.map(function (r) { return r.key; }) };
	},
	boom: async function (input, ctx) {
		await ctx.annex('user').set('profile', 'never');
		throw new Error('fails');
	},
	badhost: function (input, ctx) {
		try { ctx.annex('system'); return 'no-throw'; } catch (e) { return String(e && e.message); }
	},
	rejects: async function (input, ctx) {
		try { await ctx.annex('user').get('profile'); return 'no-reject'; } catch (e) { return String(e && e.message); }
	},
	badkey: async function (input, ctx) { return await ctx.annex('user').set('Bad Key', 'x'); },
	undeclared: async function (input, ctx) { return await ctx.annex('user').set('nope', 'x'); }
} }`

let db: TestDb
let u1: number
let u2: number
const cleanups: (() => void)[] = []
const mgrs: SandboxManager[] = []

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	;[{ id: u1 }, { id: u2 }] = await db
		.insert(schema.users)
		.values([{ username: "hook-annex-1" }, { username: "hook-annex-2" }])
		.returning({ id: schema.users.id })
	await db.insert(schema.plugins).values({
		pluginId: ID,
		name: ID,
		bundleSource: "// x",
		bundleHash: "hash-hook-annex",
		enabled: true,
		manifest: {
			annexFields: [
				{ key: "profile", shape: { type: "string" }, see: [], scope: "user" },
				{ key: "saves/", shape: { type: "object", fields: { n: { type: "integer", required: true } } }, see: [], scope: "user" }
			]
		}
	})
}, 120_000)

afterEach(async () => {
	await Promise.all(mgrs.splice(0).map((m) => m.dispose()))
	cleanups.splice(0).forEach((f) => f())
	await db.delete(schema.userAnnexes)
})

afterAll(async () => {
	await db.delete(schema.userAnnexes)
})

function setup(
	backend: "quickjs" | "ses",
	opts: { granted?: boolean; handle?: () => any } = {}
) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-hookannex-"))
	cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
	const mgr = new SandboxManager({ dataDir: dir, annexDb: opts.handle ?? (() => db as any) })
	mgrs.push(mgr)
	mgr.register({
		id: ID,
		name: "Saves",
		bundleSource: HOOK,
		bundleHash: "h",
		backends: ["quickjs", "ses"],
		backend,
		sequential: false,
		userAnnexGranted: opts.granted ?? true
	})
	mgr.markReady()
	const call = (
		hook: string,
		input: Record<string, unknown>,
		user?: string,
		kind: "outlet" | "task" = "outlet"
	) => mgr.callHook(ID, hook, input, { kind, timeoutMs: 8000, user })
	return { call }
}

describe.each(["quickjs", "ses"] as const)("ctx.annex('user') on %s", (backend) => {
	it("get / set / list / remove from a hook, saved after the call", async () => {
		const { call } = setup(backend)
		const w = await call("set", { key: "profile", doc: "hi" }, String(u1))
		expect(w.ok && w.value).toEqual({ ok: true, version: 1 })
		expect(await getUserAnnex(db as any, u1, ID, "profile")).toMatchObject({ doc: "hi", version: 1 })
		// the result never carries the buffered writes
		expect(w.ok && "userAnnexWrites" in w).toBe(false)
		const g = await call("get", { key: "profile" }, String(u1))
		expect(g.ok && g.value).toMatchObject({ key: "profile", doc: "hi", version: 1 })
		const l = await call("list", {}, String(u1))
		expect(l.ok && (l.value as any[]).map((r) => r.key)).toEqual(["profile"])
		// another person sees nothing
		const other = await call("get", { key: "profile" }, String(u2))
		expect(other.ok && other.value).toBeNull()
		const r = await call("remove", { key: "profile" }, String(u1))
		expect(r.ok && r.value).toEqual({ ok: true, version: 1 })
		expect(await getUserAnnex(db as any, u1, ID, "profile")).toBeNull()
	})

	it("a stale base answers at once with the fresh document, and saves nothing", async () => {
		const { call } = setup(backend)
		await setUserAnnex(db as any, u1, ID, "profile", "first")
		const r = await call("set", { key: "profile", doc: "second", base: 0 }, String(u1))
		expect(r.ok && r.value).toMatchObject({ ok: false, stale: true, fresh: { doc: "first", version: 1 } })
		expect(await getUserAnnex(db as any, u1, ID, "profile")).toMatchObject({ doc: "first", version: 1 })
		const ok = await call("set", { key: "profile", doc: "second", base: 1 }, String(u1))
		expect(ok.ok && ok.value).toEqual({ ok: true, version: 2 })
	})

	it("answers from a projection of its own writes, and saves the last word once", async () => {
		const { call } = setup(backend)
		const r = await call("ryw", {}, String(u1))
		expect(r.ok).toBe(true)
		if (!r.ok) return
		const v = r.value as any
		expect(v.w1).toEqual({ ok: true, version: 1 })
		expect(v.got).toEqual({ n: 1 })
		expect(v.w2).toEqual({ ok: true, version: 2 })
		expect(v.bad).toMatchObject({ ok: false, stale: true, fresh: { version: 2, doc: { n: 2 } } })
		expect(v.listed).toEqual(["saves/a"])
		// saved once: the last document, one step on the stored version
		expect(await getUserAnnex(db as any, u1, ID, "saves/a")).toMatchObject({ doc: { n: 2 }, version: 1 })
	})

	it("a thrown hook commits nothing", async () => {
		const { call } = setup(backend)
		const r = await call("boom", {}, String(u1))
		expect(r.ok).toBe(false)
		expect(await getUserAnnex(db as any, u1, ID, "profile")).toBeNull()
	})

	it("a change between the snapshot and the commit fails the call and saves nothing", async () => {
		let fireOnce = true
		// The commit's transaction is the only one this test's handle opens:
		// change the person's data just before it, as another call would have.
		const handle = () =>
			new Proxy(db as any, {
				get(t, p) {
					const v = Reflect.get(t, p)
					if (p === "transaction")
						return async (cb: any, cfg: any) => {
							if (fireOnce) {
								fireOnce = false
								await setUserAnnex(db as any, u1, ID, "profile", "elsewhere")
							}
							return t.transaction(cb, cfg)
						}
					return typeof v === "function" ? v.bind(t) : v
				}
			})
		const { call } = setup(backend, { handle })
		const r = await call("set", { key: "profile", doc: "mine" }, String(u1))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/saved data changed while this call ran, so nothing of it was saved/)
		expect(await getUserAnnex(db as any, u1, ID, "profile")).toMatchObject({ doc: "elsewhere" })
	})

	it("a key or document the SDK refuses is refused in the call; an undeclared key fails the call at the commit", async () => {
		const { call } = setup(backend)
		const bad = await call("badkey", {}, String(u1))
		expect(bad.ok && (bad.value as any).refused).toMatch(/lowercase letters/)
		const und = await call("undeclared", {}, String(u1))
		expect(und.ok).toBe(false)
		if (!und.ok) expect(und.reason).toMatch(/not a user annex key/)
		expect(await getUserAnnex(db as any, u1, ID, "nope")).toBeNull()
	})

	it("rejects with a sentence when no person is acting", async () => {
		const { call } = setup(backend)
		for (const user of [undefined, "0", "-1", "abc"]) {
			const r = await call("rejects", {}, user)
			expect(r.ok && r.value).toBe("annex('user'): no person is acting for this call")
		}
	})

	it("rejects with a sentence when the user annex was not granted", async () => {
		const { call } = setup(backend, { granted: false })
		const r = await call("rejects", {}, String(u1))
		expect(r.ok && r.value).toBe("annex('user'): this extension was not granted the user annex")
	})

	it("any host but 'user' throws, naming the hosts", async () => {
		const { call } = setup(backend)
		const r = await call("badhost", {}, String(u1))
		expect(r.ok && r.value).toBe("annex: unknown host 'system'; a hook may name: 'user'.")
	})

	it("a task hook has no annex (a task is pure)", async () => {
		const { call } = setup(backend)
		const t = await call("keys", {}, String(u1), "task")
		expect(t.ok && (t.value as string[]).includes("annex")).toBe(false)
		const o = await call("keys", {}, String(u1), "outlet")
		expect(o.ok && (o.value as string[])).toContain("annex")
	})
})
