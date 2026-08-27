import { describe, it, expect, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import { QuickJsRuntime } from "./QuickJsRuntime"
import { RuntimeManager } from "./RuntimeManager"
import type { PluginRuntime } from "./types"

/**
 * The scoped storage capability, end to end through the sandbox on both
 * backends: mediated `ctx.storage`, jailed to the grant dir, denied without a
 * grant, and identical behaviour across QuickJS and SES.
 */

const cleanups: (() => void)[] = []
const rts: PluginRuntime[] = []
afterEach(async () => {
	await Promise.all(rts.splice(0).map((r) => r.dispose()))
	cleanups.splice(0).forEach((f) => f())
})

function tmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "sp-storage-"))
	cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
	return d
}

const HOOK = `module.exports = { hooks: {
	save: function (input, ctx) { ctx.storage.write("k.txt", input.v); return ctx.storage.read("k.txt"); },
	list: function (input, ctx) { ctx.storage.write("a", "1"); ctx.storage.write("b", "2"); return ctx.storage.list().sort(); },
	escape: function (input, ctx) { return ctx.storage.read("../escape"); },
	leak: function (input, ctx) { ctx.storage.write("probe", "x"); try { ctx.storage.list("probe"); return "no-throw"; } catch (e) { return String(e && e.message); } }
} }`

const opts = (input: Record<string, unknown>) => ({
	input,
	timeoutMs: 2000,
	seedLabel: "s",
	nowMs: 1
})

function each(name: string, fn: (make: () => PluginRuntime, kind: string) => Promise<void>) {
	it(`${name} — QuickJS`, () => fn(() => { const r = new QuickJsRuntime(); rts.push(r); return r }, "quickjs"), 10_000)
	it(`${name} — SES`, () => fn(() => { const r = new SesWorkerRuntime(); rts.push(r); return r }, "ses"), 10_000)
}

describe("storage capability", () => {
	each("writes and reads within the scoped dir", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", { storageDir: dir, quotaBytes: 10_000 })
		const r = await rt.invoke({ pluginId: "p", hookName: "save" }, opts({ v: "hello" }))
		expect(r.ok && r.value).toBe("hello")
		expect(fs.readFileSync(path.join(dir, "k.txt"), "utf8")).toBe("hello")
	})

	each("list reflects what was written", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", { storageDir: dir, quotaBytes: 10_000 })
		const r = await rt.invoke({ pluginId: "p", hookName: "list" }, opts({}))
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toEqual(["a", "b"])
	})

	each("does not leak host paths in fs error messages", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", { storageDir: dir, quotaBytes: 10_000 })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "leak" },
			opts({})
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			const msg = String(r.value)
			expect(msg).not.toBe("no-throw") // readdir on a file did throw
			expect(msg).not.toContain(dir) // no absolute jail path leaked
			expect(msg).not.toContain(os.tmpdir()) // no host layout at all
			expect(msg).toMatch(/^storage:/) // sanitized, code-only message
		}
	})

	each("denies storage without a grant", async (make) => {
		const rt = make()
		await rt.load("p", HOOK, "h") // no config
		const r = await rt.invoke({ pluginId: "p", hookName: "save" }, opts({ v: "x" }))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
	})

	each("jails path traversal", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", { storageDir: dir, quotaBytes: 10_000 })
		const r = await rt.invoke({ pluginId: "p", hookName: "escape" }, opts({}))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/escape/)
	})

	it("the manager grants scoped storage from the descriptor (extensions_data/<id>)", async () => {
		const dir = tmp()
		const mgr = new RuntimeManager({ dataDir: dir })
		try {
			mgr.register({
				id: "acme/store",
				name: "Store",
				bundleSource: HOOK,
				bundleHash: "h",
				backends: ["quickjs"],
				backend: "quickjs",
				sequential: false,
				storageQuotaBytes: 10_000
			})
			mgr.markReady()
			const r = await mgr.callHook("acme/store", "save", { v: "persisted" }, { timeoutMs: 2000 })
			expect(r.ok && r.value).toBe("persisted")
			const onDisk = path.join(dir, "extensions_data", "acme_store", "k.txt")
			expect(fs.readFileSync(onDisk, "utf8")).toBe("persisted")
		} finally {
			await mgr.dispose()
		}
	}, 10_000)

	it("the manager denies storage when the descriptor grants none", async () => {
		const dir = tmp()
		const mgr = new RuntimeManager({ dataDir: dir })
		try {
			mgr.register({
				id: "acme/nostore",
				name: "NoStore",
				bundleSource: HOOK,
				bundleHash: "h",
				backends: ["quickjs"],
				backend: "quickjs",
				sequential: false
				// no storageQuotaBytes → denied
			})
			mgr.markReady()
			const r = await mgr.callHook("acme/nostore", "save", { v: "x" }, { timeoutMs: 2000 })
			expect(r.ok).toBe(false)
			if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
		} finally {
			await mgr.dispose()
		}
	}, 10_000)
})
