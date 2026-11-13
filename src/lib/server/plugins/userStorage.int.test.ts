import { describe, it, expect, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { SandboxManager, userStorageDir } from "./SandboxManager"
import { removePluginUserFiles, removeUserPluginFiles } from "./userFiles"

/**
 * `ctx.storage.user` (M2b), end to end through the manager on both backends:
 * one folder per person under `extensions_user_data`, a quota per person,
 * the same jail, refusals that say why, and the two removals.
 */

const cleanups: (() => void)[] = []
const mgrs: SandboxManager[] = []
afterEach(async () => {
	await Promise.all(mgrs.splice(0).map((m) => m.dispose()))
	cleanups.splice(0).forEach((f) => f())
})

function tmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "sp-userstore-"))
	cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
	return d
}

const HOOK = `module.exports = { hooks: {
	put: async function (input, ctx) {
		var r = await ctx.storage.user.files.write(input.name, new TextEncoder().encode(input.v));
		return r.kind;
	},
	get: async function (input, ctx) {
		var r = await ctx.storage.user.files.read(input.name);
		return r.kind === "ok" ? new TextDecoder().decode(r.value) : r.reason;
	},
	names: async function (input, ctx) {
		return (await ctx.storage.user.files.list()).map(function (f) { return f.path; });
	},
	escape: async function (input, ctx) {
		try { await ctx.storage.user.files.read("../" + input.other + "/a.txt"); return "no-throw"; }
		catch (e) { return String(e && e.message); }
	},
	refused: async function (input, ctx) {
		try { await ctx.storage.user.usage(); return "no-throw"; }
		catch (e) { return String(e && e.message); }
	},
	pub: function (input, ctx) { ctx.storage.write("pub.txt", "pub"); return ctx.storage.list(); },
	boom: async function (input, ctx) {
		await ctx.storage.user.files.write("never.txt", new TextEncoder().encode("x"));
		throw new Error("fails");
	}
} }`

const ID = "acme/atlas"

function setup(
	backend: "quickjs" | "ses",
	grant: { user?: number; pub?: number } = { user: 100, pub: 10_000 }
) {
	const dir = tmp()
	const mgr = new SandboxManager({ dataDir: dir })
	mgrs.push(mgr)
	mgr.register({
		id: ID,
		name: "Atlas",
		bundleSource: HOOK,
		bundleHash: "h",
		backends: ["quickjs", "ses"],
		backend,
		sequential: false,
		storageQuotaBytes: grant.pub,
		userStorageQuotaBytes: grant.user
	})
	mgr.markReady()
	// The plugin's own frame is open unless a test passes another cause (or none).
	const call = (
		hook: string,
		input: Record<string, unknown>,
		user?: string,
		frameCause: { pluginId: string } | null = { pluginId: ID }
	) =>
		mgr.callHook(ID, hook, input, {
			kind: "outlet",
			timeoutMs: 5000,
			user,
			frameCause: frameCause ?? undefined
		})
	return { dir, mgr, call }
}

describe.each(["quickjs", "ses"] as const)("ctx.storage.user on %s", (backend) => {
	it("reads back what the same person wrote, and never what another did", async () => {
		const { dir, call } = setup(backend)
		const put = await call("put", { name: "a.txt", v: "mine" }, "7")
		expect(put.ok && put.value).toBe("ok")
		const again = await call("get", { name: "a.txt" }, "7")
		expect(again.ok && again.value).toBe("mine")
		const other = await call("get", { name: "a.txt" }, "8")
		expect(other.ok && other.value).toBe("storage: not found")
		const names8 = await call("names", {}, "8")
		expect(names8.ok && names8.value).toEqual([])
		expect(
			fs.readFileSync(
				path.join(dir, "extensions_user_data", "acme_atlas", "7", "a.txt"),
				"utf8"
			)
		).toBe("mine")
		expect(fs.existsSync(path.join(dir, "extensions_user_data", "acme_atlas", "8"))).toBe(false)
	}, 30_000)

	it("the quota is per person", async () => {
		const { call } = setup(backend)
		const big = "x".repeat(80)
		expect((await call("put", { name: "f", v: big }, "1")).ok).toBe(true)
		const second = await call("put", { name: "g", v: big }, "1")
		expect(second.ok && second.value).toBe("err")
		const other = await call("put", { name: "f", v: big }, "2")
		expect(other.ok && other.value).toBe("ok")
	}, 30_000)

	it("is jailed to the person's folder", async () => {
		const { call } = setup(backend)
		await call("put", { name: "a.txt", v: "secret" }, "1")
		const r = await call("escape", { other: "1" }, "2")
		expect(r.ok && r.value).toMatch(/escapes/)
	}, 30_000)

	it("refuses with a sentence when no person is acting", async () => {
		const { call } = setup(backend)
		for (const user of [undefined, "0", "-1", "1.5", "abc", "../1"]) {
			const r = await call("refused", {}, user)
			expect(r.ok && r.value).toBe("storage.user: no person is acting for this call")
		}
	}, 30_000)

	it("refuses with the one closed sentence unless the plugin's own frame caused the call", async () => {
		const { dir, call } = setup(backend)
		for (const cause of [null, { pluginId: "acme/other" }]) {
			const r = await call("refused", {}, "7", cause)
			expect(r.ok && r.value).toBe(
				"storage.user: Per-person storage is only available while the app is open."
			)
		}
		expect(fs.existsSync(path.join(dir, "extensions_user_data", "acme_atlas", "7"))).toBe(false)
		// The pub-wide store is not applet-group reach.
		const pub = await call("pub", {}, "7", null)
		expect(pub.ok && pub.value).toEqual(["pub.txt"])
	}, 30_000)

	it("refuses with a sentence when per-user storage is not granted", async () => {
		const { call } = setup(backend, { pub: 10_000 })
		const r = await call("refused", {}, "7")
		expect(r.ok && r.value).toBe("storage.user: per-user storage is not granted")
		// the pub-wide store is untouched by the missing grant
		const pub = await call("pub", {}, "7")
		expect(pub.ok && pub.value).toEqual(["pub.txt"])
	}, 30_000)

	it("works with only the per-user grant, and a throwing hook keeps nothing", async () => {
		const { dir, call } = setup(backend, { user: 1000 })
		expect((await call("put", { name: "a", v: "1" }, "3")).ok).toBe(true)
		const boom = await call("boom", {}, "3")
		expect(boom.ok).toBe(false)
		expect(fs.existsSync(path.join(dir, "extensions_user_data", "acme_atlas", "3", "never.txt"))).toBe(false)
		expect(fs.existsSync(path.join(dir, "extensions_user_data", "acme_atlas", "3", "a"))).toBe(true)
	}, 30_000)
})

describe("userStorageDir", () => {
	it("opens a folder only for a positive integer", () => {
		expect(userStorageDir("/d", "a/b", 7)).toBe(path.join("/d", "extensions_user_data", "a_b", "7"))
		expect(userStorageDir("/d", "a", "12")).toBe(path.join("/d", "extensions_user_data", "a", "12"))
		for (const bad of [undefined, null, "", "0", "-3", "1.5", "01", "1/2", "..", 0, -1])
			expect(userStorageDir("/d", "a", bad as any)).toBeUndefined()
	})
})

describe("removing the files", () => {
	function seed(dir: string) {
		for (const [seg, uid] of [["a", "1"], ["a", "2"], ["b", "1"]])
			fs.mkdirSync(path.join(dir, "extensions_user_data", seg, uid), { recursive: true })
		fs.writeFileSync(path.join(dir, "extensions_user_data", "a", "1", "f"), "x")
	}
	it("an account takes its folder from every plugin and no one else's", async () => {
		const dir = tmp()
		seed(dir)
		expect(await removeUserPluginFiles(dir, 1)).toBe(2)
		const root = path.join(dir, "extensions_user_data")
		expect(fs.existsSync(path.join(root, "a", "1"))).toBe(false)
		expect(fs.existsSync(path.join(root, "b", "1"))).toBe(false)
		expect(fs.existsSync(path.join(root, "a", "2"))).toBe(true)
	})
	it("no data folder yet is not an error", async () => {
		expect(await removeUserPluginFiles(tmp(), 1)).toBe(0)
	})
	it("an uninstall that deletes takes the plugin's folder for everyone", async () => {
		const dir = tmp()
		seed(dir)
		await removePluginUserFiles(dir, "a")
		const root = path.join(dir, "extensions_user_data")
		expect(fs.existsSync(path.join(root, "a"))).toBe(false)
		expect(fs.existsSync(path.join(root, "b", "1"))).toBe(true)
	})
})
