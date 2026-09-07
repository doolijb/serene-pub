import { describe, it, expect, beforeAll, afterEach, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { plugins, pluginRows } from "$lib/server/db/schema"
import { upsertPlugin, removePlugin } from "./store"
import {
	clearPluginRows,
	commitPluginRows,
	loadPluginRows,
	makePluginRowPort
} from "./rowStore"
import { SandboxManager } from "./SandboxManager"

/**
 * The row store against a real (in-memory) PGlite database with the actual
 * migrations applied — which also proves `0185_plugin_rows.sql` is valid SQL.
 *
 * Two things are load-bearing here and nowhere else. **Scope**: the table is
 * shared and the only thing keeping one extension out of another's rows is a
 * column the host fills in, so the isolation case below hands two extensions the
 * *same key* and checks that neither can reach the other's value. **The commit
 * ordering**: rows land after the sandbox has already applied its files, so the
 * end-to-end cases assert both halves of "a killed hook commits nothing" against
 * the database and the directory at once.
 *
 * Building the DB is real WASM startup, so the timeouts are generous.
 */
vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

const cleanups: (() => void)[] = []
const managers: SandboxManager[] = []
afterEach(async () => {
	await Promise.all(managers.splice(0).map((m) => m.dispose()))
	cleanups.splice(0).forEach((f) => f())
})

function tmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rowstore-"))
	cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }))
	return d
}

const NOW = "2026-03-04T05:06:07.000Z"

/** An installed, enabled extension — the FK's other end. */
async function install(pluginId: string, bundleSource: string): Promise<void> {
	await upsertPlugin(db, {
		pluginId,
		name: pluginId,
		bundleSource,
		bundleHash: "h-" + pluginId,
		backends: ["quickjs"]
	})
}

describe("plugin row store", () => {
	it("commits a diff and reads it back", async () => {
		await install("acme/rows", "module.exports = { hooks: {} }")
		await commitPluginRows(db, "acme/rows", [
			{ op: "put", key: "a", value: { n: 1 }, bytes: 9, updatedAt: NOW },
			{ op: "put", key: "b", value: "two", bytes: 6, updatedAt: NOW }
		])
		expect(await loadPluginRows(db, "acme/rows")).toEqual([
			{ key: "a", value: { n: 1 }, bytes: 9, updatedAt: NOW },
			{ key: "b", value: "two", bytes: 6, updatedAt: NOW }
		])

		// A put on an existing key is an upsert, not a duplicate.
		await commitPluginRows(db, "acme/rows", [
			{ op: "put", key: "a", value: { n: 2 }, bytes: 9, updatedAt: NOW },
			{ op: "delete", key: "b" }
		])
		expect(await loadPluginRows(db, "acme/rows")).toEqual([
			{ key: "a", value: { n: 2 }, bytes: 9, updatedAt: NOW }
		])
	})

	it("stores JSON null as a value, distinct from a missing key", async () => {
		// SQL NULL in this column IS the extension's null — the column is
		// nullable precisely so `put(key, null)` can be stored at all.
		await install("acme/nulls", "module.exports = { hooks: {} }")
		await commitPluginRows(db, "acme/nulls", [
			{ op: "put", key: "n", value: null, bytes: 5, updatedAt: NOW }
		])
		const rows = await loadPluginRows(db, "acme/nulls")
		expect(rows).toHaveLength(1)
		expect(rows[0]!.value).toBeNull()
	})

	it("scopes by a column, so the same key in two extensions is two rows", async () => {
		// The isolation claim, at its sharpest: identical keys, and neither
		// extension's load can reach the other's value. There is no parameter
		// anywhere on the surface a hook calls that names a plugin, so this is
		// the only place the scope could be got wrong.
		await install("acme/one", "module.exports = { hooks: {} }")
		await install("acme/two", "module.exports = { hooks: {} }")
		await commitPluginRows(db, "acme/one", [
			{
				op: "put",
				key: "secret",
				value: "one's",
				bytes: 13,
				updatedAt: NOW
			}
		])
		await commitPluginRows(db, "acme/two", [
			{
				op: "put",
				key: "secret",
				value: "two's",
				bytes: 13,
				updatedAt: NOW
			}
		])
		expect(
			(await loadPluginRows(db, "acme/one")).map((r) => r.value)
		).toEqual(["one's"])
		expect(
			(await loadPluginRows(db, "acme/two")).map((r) => r.value)
		).toEqual(["two's"])
		// And a delete is scoped too: one extension cannot erase the other's.
		await commitPluginRows(db, "acme/one", [
			{ op: "delete", key: "secret" }
		])
		expect(await loadPluginRows(db, "acme/one")).toEqual([])
		expect(await loadPluginRows(db, "acme/two")).toHaveLength(1)
	})

	it("uninstalling an extension takes its rows with it", async () => {
		// The SDK promises an extension that "the host removes the extension's
		// namespace afterwards regardless"; the FK is that promise, kept by the
		// database rather than by a cleanup path someone has to remember.
		await install("acme/gone", "module.exports = { hooks: {} }")
		await commitPluginRows(db, "acme/gone", [
			{ op: "put", key: "k", value: 1, bytes: 2, updatedAt: NOW }
		])
		await removePlugin(db, "acme/gone")
		expect(
			await db
				.select()
				.from(pluginRows)
				.where(eq(pluginRows.pluginId, "acme/gone"))
		).toEqual([])
	})

	it("clears an extension's rows without uninstalling it", async () => {
		await install("acme/clear", "module.exports = { hooks: {} }")
		await commitPluginRows(db, "acme/clear", [
			{ op: "put", key: "k", value: 1, bytes: 2, updatedAt: NOW }
		])
		await clearPluginRows(db, "acme/clear")
		expect(await loadPluginRows(db, "acme/clear")).toEqual([])
		expect(
			await db
				.select()
				.from(plugins)
				.where(eq(plugins.pluginId, "acme/clear"))
		).toHaveLength(1)
	})

	it("rejects a malformed change before it reaches the table", async () => {
		await install("acme/bad", "module.exports = { hooks: {} }")
		await expect(
			commitPluginRows(db, "acme/bad", [
				{ op: "put", key: "", value: 1, bytes: 1, updatedAt: NOW }
			])
		).rejects.toThrow(/unusable key/)
		expect(await loadPluginRows(db, "acme/bad")).toEqual([])
	})
})

/** A hook that reads its rows, writes both halves, and can be made to hang. */
const HOOK = `module.exports = { hooks: {
	bump: async function (input, ctx) {
		var prev = await ctx.storage.get("counter");
		await ctx.storage.put("counter", (prev || 0) + 1);
		ctx.storage.write("side.txt", "wrote " + ((prev || 0) + 1));
		return prev === undefined ? "first" : prev;
	},
	doom: async function (input, ctx) {
		await new Promise(function (res) {
			ctx.signal.addEventListener("abort", function () { res(1); });
		});
		await ctx.storage.put("doomed", "never");
		ctx.storage.write("doomed.txt", "never");
		for (;;) {}
	}
} }`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("rows through the manager, end to end", () => {
	function manager(dataDir: string): SandboxManager {
		const mgr = new SandboxManager({
			dataDir,
			rows: makePluginRowPort(() => db)
		})
		managers.push(mgr)
		return mgr
	}

	it("a returning hook's rows land, and are there for the next call", async () => {
		await install("acme/bump", HOOK)
		const dir = tmp()
		const mgr = manager(dir)
		mgr.register({
			id: "acme/bump",
			name: "Bump",
			bundleSource: HOOK,
			bundleHash: "h",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false,
			storageQuotaBytes: 100_000
		})
		mgr.markReady()

		const first = await mgr.callHook(
			"acme/bump",
			"bump",
			{},
			{ timeoutMs: 5000 }
		)
		expect(first.ok && first.value).toBe("first")
		expect(await loadPluginRows(db, "acme/bump")).toEqual([
			{
				key: "counter",
				value: 1,
				bytes: 8,
				updatedAt: expect.any(String)
			}
		])
		// The diff is transport: no caller above the manager ever sees it.
		expect((first as { rowChanges?: unknown }).rowChanges).toBeUndefined()

		// The next call reads what the last one committed — the snapshot is a
		// real read, not an empty start.
		const second = await mgr.callHook(
			"acme/bump",
			"bump",
			{},
			{ timeoutMs: 5000 }
		)
		expect(second.ok && second.value).toBe(1)
		expect((await loadPluginRows(db, "acme/bump"))[0]!.value).toBe(2)
		expect(
			fs.readFileSync(
				path.join(dir, "extensions_data", "acme_bump", "side.txt"),
				"utf8"
			)
		).toBe("wrote 2")
	}, 60_000)

	it("a killed hook commits neither its rows nor its files", async () => {
		await install("acme/doom", HOOK)
		const dir = tmp()
		const mgr = manager(dir)
		mgr.register({
			id: "acme/doom",
			name: "Doom",
			bundleSource: HOOK,
			bundleHash: "h",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false,
			storageQuotaBytes: 100_000
		})
		mgr.markReady()

		const running = mgr.callHook(
			"acme/doom",
			"doom",
			{},
			{ timeoutMs: 30_000, runId: "run-1" }
		)
		await sleep(200)
		const [call] = mgr.activeInvocations()
		expect(call).toBeTruthy()
		await mgr.abortCall(call!.callId)
		await sleep(250) // its put + write run, then it refuses to end
		await mgr.killCall(call!.callId, "test kill")
		const r = await running
		expect(r.ok).toBe(false)

		await sleep(200)
		expect(await loadPluginRows(db, "acme/doom")).toEqual([])
		const storeDir = path.join(dir, "extensions_data", "acme_doom")
		expect(fs.existsSync(storeDir) ? fs.readdirSync(storeDir) : []).toEqual(
			[]
		)
	}, 60_000)

	it("a row commit that cannot be applied fails the call", async () => {
		// The extension is registered with the manager but never installed, so
		// the FK refuses its rows. A hook must not be told its data landed when
		// it did not — the same ruling the file half makes for its own commit.
		const dir = tmp()
		const mgr = manager(dir)
		mgr.register({
			id: "acme/unregistered",
			name: "Unregistered",
			bundleSource: HOOK,
			bundleHash: "h",
			backends: ["quickjs"],
			backend: "quickjs",
			sequential: false,
			storageQuotaBytes: 100_000
		})
		mgr.markReady()
		const r = await mgr.callHook(
			"acme/unregistered",
			"bump",
			{},
			{ timeoutMs: 5000 }
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/rows could not be committed/)
	}, 60_000)
})
