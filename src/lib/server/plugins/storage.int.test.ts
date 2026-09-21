import { describe, it, expect, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import { QuickJsSandbox } from "./QuickJsSandbox"
import { SandboxManager } from "./SandboxManager"
import type { PluginSandbox } from "./types"

/**
 * The scoped storage permission, end to end through the sandbox on both
 * backends: mediated `ctx.storage`, jailed to the grant dir, denied without a
 * grant, and identical behaviour across QuickJS and SES.
 */

const cleanups: (() => void)[] = []
const rts: PluginSandbox[] = []
afterEach(async () => {
	await Promise.all(rts.splice(0).map((r) => r.dispose()))
	cleanups.splice(0).forEach((f) => f())
})

function tmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "sp-storage-"))
	cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
	return d
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Every byte under a directory, so "byte-identical" is a thing a test can assert. */
function tree(root: string): Record<string, string> {
	const out: Record<string, string> = {}
	const walk = (d: string, prefix: string) => {
		if (!fs.existsSync(d)) return
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const rel = prefix ? prefix + "/" + e.name : e.name
			if (e.isDirectory()) walk(path.join(d, e.name), rel)
			else out[rel] = fs.readFileSync(path.join(d, e.name), "utf8")
		}
	}
	walk(root, "")
	return out
}

const HOOK = `module.exports = { hooks: {
	save: function (input, ctx) { ctx.storage.write("k.txt", input.v); return ctx.storage.read("k.txt"); },
	list: function (input, ctx) { ctx.storage.write("a", "1"); ctx.storage.write("b", "2"); return ctx.storage.list().sort(); },
	escape: function (input, ctx) { return ctx.storage.read("../escape"); },
	leak: function (input, ctx) { ctx.storage.write("probe", "x"); try { ctx.storage.list("probe"); return "no-throw"; } catch (e) { return String(e && e.message); } }
} }`

// An outlet's ctx: granted `storage`, not `fetch` (hookCtx.ts, R-3).
const opts = (input: Record<string, unknown>) => ({
	input,
	kind: "outlet" as const,
	timeoutMs: 2000,
	seedLabel: "s",
	nowMs: 1
})

function each(
	name: string,
	fn: (make: () => PluginSandbox, kind: string) => Promise<void>
) {
	it(
		`${name} — QuickJS`,
		() =>
			fn(() => {
				const r = new QuickJsSandbox()
				rts.push(r)
				return r
			}, "quickjs"),
		10_000
	)
	it(
		`${name} — SES`,
		() =>
			fn(() => {
				const r = new SesWorkerSandbox()
				rts.push(r)
				return r
			}, "ses"),
		10_000
	)
}

describe("storage permission", () => {
	each("writes and reads within the scoped dir", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", { storageDir: dir, quotaBytes: 10_000 })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "save" },
			opts({ v: "hello" })
		)
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
		const r = await rt.invoke({ pluginId: "p", hookName: "leak" }, opts({}))
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
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "save" },
			opts({ v: "x" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
	})

	each("jails path traversal", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", { storageDir: dir, quotaBytes: 10_000 })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "escape" },
			opts({})
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/escape/)
	})

	it("the manager grants scoped storage from the descriptor (extensions_data/<id>)", async () => {
		const dir = tmp()
		const mgr = new SandboxManager({ dataDir: dir })
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
			const r = await mgr.callHook(
				"acme/store",
				"save",
				{ v: "persisted" },
				{ kind: "outlet", timeoutMs: 2000 }
			)
			expect(r.ok && r.value).toBe("persisted")
			const onDisk = path.join(
				dir,
				"extensions_data",
				"acme_store",
				"k.txt"
			)
			expect(fs.readFileSync(onDisk, "utf8")).toBe("persisted")
		} finally {
			await mgr.dispose()
		}
	}, 10_000)

	it("the manager denies storage when the descriptor grants none", async () => {
		const dir = tmp()
		const mgr = new SandboxManager({ dataDir: dir })
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
			const r = await mgr.callHook(
				"acme/nostore",
				"save",
				{ v: "x" },
				{ kind: "outlet", timeoutMs: 2000 }
			)
			expect(r.ok).toBe(false)
			if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
		} finally {
			await mgr.dispose()
		}
	}, 10_000)
})

/**
 * The transaction, end to end through both sandboxes. A hook's writes are
 * buffered for the length of the call and applied only if it returns, which is
 * what makes core's forced `kill` safe to use: there is no prefix of a killed
 * hook's writes to find on disk afterwards, so a cancellation is a clean stop
 * rather than a data-integrity event. The other half of the same contract is
 * that a hook which *does* wind itself down inside the cancellation grace keeps
 * what it wrote there — otherwise the grace would buy an author nothing.
 */
const TX_HOOK = `module.exports = { hooks: {
	doom: async function (input, ctx) {
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1) });
		});
		ctx.storage.write("clobber.txt", "should never land");
		ctx.storage.remove("keep.txt");
		if (input.hang) for (;;) {}
		return "returned";
	},
	windDown: async function (input, ctx) {
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1) });
		});
		ctx.storage.write("flushed.txt", "wound-down");
		return ctx.storage.read("flushed.txt");
	},
	boom: function (input, ctx) {
		ctx.storage.write("never.txt", "x");
		throw new Error("the hook failed");
	}
} }`

/** The storage grant every transaction test uses — one dir, ample quota. */
const grant = (dir: string) => ({ storageDir: dir, quotaBytes: 10_000 })

/** Writes, parks until its own signal fires, then reports what it can see. */
const CONCURRENT_HOOK = `module.exports = { hooks: {
	park: async function (input, ctx) {
		ctx.storage.write("mine.txt", input.tag);
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1) });
		});
		return {
			tag: input.tag,
			mine: ctx.storage.read("mine.txt"),
			seen: ctx.storage.list().sort()
		};
	},
	spin: function (input, ctx) {
		ctx.storage.write("doomed.txt", input.tag);
		for (;;) {}
	}
} }`

describe("the storage transaction", () => {
	// The control for the test below: the same hook, the same abort, the same
	// write + remove — and it returns. Without this, "the directory did not
	// change" could equally mean the doomed hook never reached its writes.
	each("the same writes DO land when that hook returns", async (make) => {
		const dir = tmp()
		fs.writeFileSync(path.join(dir, "keep.txt"), "original")
		const rt = make()
		await rt.load("p", TX_HOOK, "h", grant(dir))
		const running = rt.invoke(
			{ pluginId: "p", hookName: "doom" },
			{ ...opts({ hang: false }), timeoutMs: 30_000, jobId: "doom" }
		)
		await sleep(150) // let it park on the await
		expect(rt.abort("doom")).toBe(true)
		const r = await running
		expect(r.ok && r.value).toBe("returned")
		expect(tree(dir)).toEqual({ "clobber.txt": "should never land" })
	})

	each("a killed hook leaves the directory byte-identical", async (make) => {
		const dir = tmp()
		fs.writeFileSync(path.join(dir, "keep.txt"), "original")
		const before = tree(dir)
		const rt = make()
		await rt.load("p", TX_HOOK, "h", grant(dir))
		const running = rt.invoke(
			{ pluginId: "p", hookName: "doom" },
			{ ...opts({ hang: true }), timeoutMs: 30_000, jobId: "doom" }
		)
		await sleep(150) // let it park on the await
		// Aborted exactly as the control above, so the write + remove run — and
		// then it refuses to end, which is what forced kill exists for.
		expect(rt.abort("doom")).toBe(true)
		await sleep(250)
		expect(await rt.kill("doom")).toBe(true)
		const r = await running
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("killed")
		await sleep(150) // let the worker finish unwinding before we look
		// Not "the clobber did not land" — the whole directory, unchanged.
		expect(tree(dir)).toEqual(before)
	})

	each("a hook winding down in the grace keeps its writes", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", TX_HOOK, "h", grant(dir))
		const running = rt.invoke(
			{ pluginId: "p", hookName: "windDown" },
			{ ...opts({}), timeoutMs: 30_000, jobId: "grace" }
		)
		await sleep(150) // let it park on the await
		expect(rt.abort("grace")).toBe(true)
		const r = await running
		// Returning after an abort is an ordinary success, and its writes commit
		// exactly as any other success's do. This is the contract the grace
		// window offers an author: return in time and your data lands.
		expect(r.ok).toBe(true)
		if (r.ok) expect(r.value).toBe("wound-down")
		expect(tree(dir)).toEqual({ "flushed.txt": "wound-down" })
	})

	each("a hook that throws commits nothing", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", TX_HOOK, "h", grant(dir))
		const r = await rt.invoke({ pluginId: "p", hookName: "boom" }, opts({}))
		expect(r.ok).toBe(false)
		// A call that did not finish never decided what its data should be.
		expect(tree(dir)).toEqual({})
	})

	it("two plugins' concurrent calls cannot see or corrupt each other", async () => {
		const dirA = tmp()
		const dirB = tmp()
		const rt = new QuickJsSandbox() // one shared worker, two live calls
		rts.push(rt)
		await rt.load("a", CONCURRENT_HOOK, "h", grant(dirA))
		await rt.load("b", CONCURRENT_HOOK, "h", grant(dirB))
		const a = rt.invoke(
			{ pluginId: "a", hookName: "park" },
			{ ...opts({ tag: "alpha" }), timeoutMs: 30_000, jobId: "a" }
		)
		const b = rt.invoke(
			{ pluginId: "b", hookName: "park" },
			{ ...opts({ tag: "beta" }), timeoutMs: 30_000, jobId: "b" }
		)
		await sleep(250) // both buffered, both parked, neither committed
		expect(tree(dirA)).toEqual({})
		expect(tree(dirB)).toEqual({})
		expect(rt.abort("a")).toBe(true)
		expect(rt.abort("b")).toBe(true)
		const [ra, rb] = await Promise.all([a, b])
		expect(ra.ok && ra.value).toEqual({
			tag: "alpha",
			mine: "alpha",
			seen: ["mine.txt"]
		})
		expect(rb.ok && rb.value).toEqual({
			tag: "beta",
			mine: "beta",
			seen: ["mine.txt"]
		})
		expect(tree(dirA)).toEqual({ "mine.txt": "alpha" })
		expect(tree(dirB)).toEqual({ "mine.txt": "beta" })
	}, 30_000)

	it("killing one call does not take a sibling call's writes with it", async () => {
		// The sharper case than two plugins: two calls of the SAME plugin, so
		// one storage directory and two buffers over it. The buffer belongs to
		// the call, not to the grant.
		const dir = tmp()
		const rt = new QuickJsSandbox()
		rts.push(rt)
		await rt.load("p", CONCURRENT_HOOK, "h", grant(dir))
		const kept = rt.invoke(
			{ pluginId: "p", hookName: "park" },
			{ ...opts({ tag: "kept" }), timeoutMs: 30_000, jobId: "kept" }
		)
		await sleep(200) // let it park before the spinner takes the thread
		const doomed = rt.invoke(
			{ pluginId: "p", hookName: "spin" },
			{ ...opts({ tag: "doomed" }), timeoutMs: 30_000, jobId: "doomed" }
		)
		await sleep(200)
		expect(await rt.kill("doomed")).toBe(true)
		const rd = await doomed
		expect(rd.ok).toBe(false)
		expect(rt.abort("kept")).toBe(true)
		const rk = await kept
		expect(rk.ok).toBe(true)
		expect(tree(dir)).toEqual({ "mine.txt": "kept" })
	}, 30_000)
})
