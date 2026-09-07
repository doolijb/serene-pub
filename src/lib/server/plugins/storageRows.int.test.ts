import { describe, it, expect, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import { QuickJsSandbox } from "./QuickJsSandbox"
import type { PluginSandbox } from "./types"

/**
 * `ctx.storage` as the SDK declares it — `ExtensionStorage`, end to end through
 * both sandboxes.
 *
 * The point of this file, as distinct from `storage.int.test.ts` beside it: that
 * one exercises the older, synchronous file spelling the sandbox endowed before
 * the SDK's interface existed. This one exercises the interface itself — the
 * promise-returning row store with a `files` namespace that every hook's `ctx`
 * has been *typed* as carrying since long before anything provided it. Every
 * call below is written the way an author reading `storage.ts` would write it,
 * which is the only way to find out whether the type is true.
 *
 * Both backends run every case, because a permission that works on SES and
 * throws on QuickJS is a plugin that works until someone flips the dial — and
 * QuickJS is the default.
 */

const cleanups: (() => void)[] = []
const rts: PluginSandbox[] = []
afterEach(async () => {
	await Promise.all(rts.splice(0).map((r) => r.dispose()))
	cleanups.splice(0).forEach((f) => f())
})

function tmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rows-"))
	cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
	return d
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

/** Hooks written from the SDK's types: everything awaited, nothing assumed. */
const HOOK = `module.exports = { hooks: {
	roundTrip: async function (input, ctx) {
		var before = await ctx.storage.get("counter");
		var receipt = await ctx.storage.put("counter", { n: (before ? before.n : 0) + 1 });
		return {
			before: before === undefined ? "absent" : before,
			after: await ctx.storage.get("counter"),
			kind: receipt.kind,
			delta: receipt.value.deltaBytes,
			keys: await ctx.storage.keys()
		};
	},
	promises: function (input, ctx) {
		// The SDK types every one of these as a Promise; a synchronous value
		// dressed up as one would pass an await and fail a then().
		var p = ctx.storage.put("k", 1);
		return typeof p.then === "function" && typeof ctx.storage.usage().then === "function";
	},
	usage: async function (input, ctx) {
		await ctx.storage.put("row", "0123456789");
		ctx.storage.write("f.txt", "0123456789");
		return await ctx.storage.usage();
	},
	querying: async function (input, ctx) {
		await ctx.storage.put("log/a", 1);
		await ctx.storage.put("log/b", 2);
		await ctx.storage.put("other", 3);
		var page = await ctx.storage.query({ prefix: "log/", order: "key" });
		return { keys: page.rows.map(function (r) { return r.key; }), cursor: page.nextCursor || null };
	},
	overBudget: async function (input, ctx) {
		var r = await ctx.storage.put("big", input.blob);
		return { kind: r.kind, reason: r.reason || null, still: await ctx.storage.get("big") };
	},
	bytes: async function (input, ctx) {
		var written = new Uint8Array([0, 1, 2, 254, 255]);
		var w = await ctx.storage.files.write("bin/x.dat", written);
		var got = await ctx.storage.files.read("bin/x.dat");
		return {
			wrote: w.kind,
			isU8: got.value instanceof Uint8Array,
			bytes: Array.prototype.slice.call(got.value),
			listed: (await ctx.storage.files.list()).map(function (f) { return f.path; }),
			stat: await ctx.storage.files.stat("bin/x.dat")
		};
	},
	sweep: async function (input, ctx) {
		await ctx.storage.put("p/1", 1);
		await ctx.storage.put("p/2", 2);
		await ctx.storage.put("q/1", 3);
		var r = await ctx.storage.deleteAll("p/");
		return { removed: r.value.removed, left: await ctx.storage.keys() };
	},
	nulls: async function (input, ctx) {
		await ctx.storage.put("n", null);
		var got = await ctx.storage.get("n");
		return {
			stored: got === null,
			missing: (await ctx.storage.get("absent")) === undefined,
			statMissing: (await ctx.storage.files.stat("nope.txt")) === null
		};
	},
	denied: async function (input, ctx) {
		try { await ctx.storage.query(); return "no-throw"; }
		catch (e) { return String(e && e.message); }
	},
	deniedFiles: async function (input, ctx) {
		try { await ctx.storage.files.list(); return "no-throw"; }
		catch (e) { return String(e && e.message); }
	},
	doomedRows: async function (input, ctx) {
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1); });
		});
		await ctx.storage.put("landed", "should never land");
		ctx.storage.write("landed.txt", "should never land");
		if (input.hang) for (;;) {}
		return "returned";
	}
} }`

const opts = (input: Record<string, unknown>) => ({
	input,
	timeoutMs: 5000,
	seedLabel: "s",
	nowMs: Date.parse("2026-02-03T04:05:06.000Z")
})

const grant = (dir: string) => ({
	storageDir: dir,
	quotaBytes: 100_000,
	rowQuotaBytes: 10_000
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
		20_000
	)
	it(
		`${name} — SES`,
		() =>
			fn(() => {
				const r = new SesWorkerSandbox()
				rts.push(r)
				return r
			}, "ses"),
		20_000
	)
}

describe("ctx.storage — the SDK's row store", () => {
	each(
		"get/put/keys round-trip, over the snapshot the host supplied",
		async (make) => {
			const rt = make()
			await rt.load("p", HOOK, "h", grant(tmp()))
			const r = await rt.invoke(
				{ pluginId: "p", hookName: "roundTrip" },
				{
					...opts({}),
					rows: [
						{
							key: "counter",
							value: { n: 41 },
							bytes: 0,
							updatedAt: "2020-01-01T00:00:00.000Z"
						}
					]
				}
			)
			expect(r.ok).toBe(true)
			if (!r.ok) return
			expect(r.value).toMatchObject({
				before: { n: 41 },
				after: { n: 42 },
				kind: "ok",
				keys: ["counter"]
			})
			// The diff the host is meant to commit — one op for the one key touched.
			expect(r.rowChanges).toEqual([
				{
					op: "put",
					key: "counter",
					value: { n: 42 },
					bytes: 15,
					updatedAt: "2026-02-03T04:05:06.000Z"
				}
			])
		}
	)

	each("the declared members really are promises", async (make) => {
		// The SDK types them as Promise<T>. `await` would tolerate a bare value
		// and hide the lie; `.then` is what an author's library code calls.
		const rt = make()
		await rt.load("p", HOOK, "h", grant(tmp()))
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "promises" },
			opts({})
		)
		expect(r.ok && r.value).toBe(true)
	})

	each("usage() reports rows and files as separate halves", async (make) => {
		const rt = make()
		await rt.load("p", HOOK, "h", grant(tmp()))
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "usage" },
			opts({})
		)
		expect(r.ok).toBe(true)
		if (!r.ok) return
		// "row" + "\"0123456789\"" = 3 + 12; the file is its ten bytes.
		expect(r.value).toEqual({
			quotaBytes: 100_000,
			rowBytes: 15,
			fileBytes: 10,
			usedBytes: 25,
			availableBytes: 99_975
		})
	})

	each(
		"query() filters and orders, and pages inside the call",
		async (make) => {
			const rt = make()
			await rt.load("p", HOOK, "h", grant(tmp()))
			const r = await rt.invoke(
				{ pluginId: "p", hookName: "querying" },
				opts({})
			)
			expect(r.ok && r.value).toEqual({
				keys: ["log/a", "log/b"],
				cursor: null
			})
		}
	)

	each("deleteAll sweeps a prefix and reports the count", async (make) => {
		const rt = make()
		await rt.load("p", HOOK, "h", grant(tmp()))
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "sweep" },
			opts({})
		)
		expect(r.ok && r.value).toEqual({ removed: 2, left: ["q/1"] })
	})

	each(
		"a write past the row budget comes back as err, not a throw",
		async (make) => {
			// The SDK is explicit: "A write that would exceed the quota returns err
			// — it does not throw, and it does not partially apply."
			const rt = make()
			await rt.load("p", HOOK, "h", {
				storageDir: tmp(),
				quotaBytes: 100_000,
				rowQuotaBytes: 100
			})
			const r = await rt.invoke(
				{ pluginId: "p", hookName: "overBudget" },
				opts({ blob: "x".repeat(500) })
			)
			expect(r.ok).toBe(true)
			if (!r.ok) return
			expect(r.value).toMatchObject({ kind: "err" })
			expect((r.value as { reason: string }).reason).toMatch(/row budget/)
			// Not partially applied: the key is still absent afterwards.
			expect((r.value as { still: unknown }).still).toBeUndefined()
			expect(r.rowChanges ?? []).toEqual([])
		}
	)

	each("files.* carries real bytes, as Uint8Array", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", grant(dir))
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "bytes" },
			opts({})
		)
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.value).toMatchObject({
			wrote: "ok",
			isU8: true,
			bytes: [0, 1, 2, 254, 255],
			listed: ["bin/x.dat"],
			stat: { path: "bin/x.dat", bytes: 5 }
		})
		// And the bytes on disk are the bytes, not a utf8 mangling of them.
		expect([...fs.readFileSync(path.join(dir, "bin/x.dat"))]).toEqual([
			0, 1, 2, 254, 255
		])
	})

	each("null crosses as null, and absent as undefined", async (make) => {
		// The QuickJS bridge marshals host values by hand, and collapsing null
		// into undefined would make a stored null indistinguishable from a
		// missing key — on one backend only, which is the worst kind of bug.
		const rt = make()
		await rt.load("p", HOOK, "h", grant(tmp()))
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "nulls" },
			opts({})
		)
		expect(r.ok && r.value).toEqual({
			stored: true,
			missing: true,
			statMissing: true
		})
		expect(r.ok && r.rowChanges).toEqual([
			{
				op: "put",
				key: "n",
				value: null,
				bytes: 5,
				updatedAt: "2026-02-03T04:05:06.000Z"
			}
		])
	})

	each("without the grant, every member refuses by name", async (make) => {
		// Not "is not a function": an author debugging the wrong problem is the
		// failure mode the refusing stub exists to prevent.
		const rt = make()
		await rt.load("p", HOOK, "h") // no config
		const q = await rt.invoke(
			{ pluginId: "p", hookName: "denied" },
			opts({})
		)
		expect(q.ok && q.value).toMatch(/permission not granted/)
		const f = await rt.invoke(
			{ pluginId: "p", hookName: "deniedFiles" },
			opts({})
		)
		expect(f.ok && f.value).toMatch(/permission not granted/)
	})

	each("a killed hook commits NEITHER rows nor files", async (make) => {
		// The headline guarantee, and the reason both halves are buffered in the
		// same handle: the row diff dies inside the worker that was holding it,
		// so there is nothing for the host to commit even by accident.
		const dir = tmp()
		fs.writeFileSync(path.join(dir, "keep.txt"), "original")
		const before = tree(dir)
		const rt = make()
		await rt.load("p", HOOK, "h", grant(dir))
		const running = rt.invoke(
			{ pluginId: "p", hookName: "doomedRows" },
			{
				...opts({ hang: true }),
				timeoutMs: 30_000,
				jobId: "doom"
			}
		)
		await sleep(150) // let it park on the await
		expect(rt.abort("doom")).toBe(true)
		await sleep(250) // its write + put run, then it refuses to end
		expect(await rt.kill("doom")).toBe(true)
		const r = await running
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.outcome).toBe("killed")
		expect((r as { rowChanges?: unknown }).rowChanges).toBeUndefined()
		await sleep(150)
		expect(tree(dir)).toEqual(before)
	})

	each("a hook that returns inside the grace commits BOTH", async (make) => {
		const dir = tmp()
		const rt = make()
		await rt.load("p", HOOK, "h", grant(dir))
		const running = rt.invoke(
			{ pluginId: "p", hookName: "doomedRows" },
			{
				...opts({ hang: false }),
				timeoutMs: 30_000,
				jobId: "grace"
			}
		)
		await sleep(150)
		expect(rt.abort("grace")).toBe(true)
		const r = await running
		expect(r.ok && r.value).toBe("returned")
		expect(r.ok && r.rowChanges).toEqual([
			{
				op: "put",
				key: "landed",
				value: "should never land",
				bytes: 25,
				updatedAt: "2026-02-03T04:05:06.000Z"
			}
		])
		expect(tree(dir)).toEqual({ "landed.txt": "should never land" })
	})
})
