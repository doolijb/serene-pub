/**
 * The end-to-end read (M0, P4b): a plugin action's handler reads
 * `worlds/<id>/world.json` from its own storage and the caller gets `out.main`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { SandboxManager, storageSegment } from "./SandboxManager"
import { declaredPermissions, reviewMarks } from "./permissions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
vi.mock("$lib/server/plugins", () => ({ getManager: () => mgr }))

const ID = "acme.worlds"
const HANDLER = `${ID}:query/world-load@1`
const BUNDLE = `module.exports = { hooks: {
	loadWorld: function (input, ctx) {
		var text = ctx.storage.read("worlds/" + input.id + "/world.json");
		return { kind: "ok", value: { main: JSON.parse(text) } };
	},
	bare: function (input, ctx) { return { main: { bare: true } }; },
	broken: function (input, ctx) { return { kind: "err", reason: "no such world" }; }
} }`
const manifest = {
	permissions: ["storage"],
	pluginActions: {
		"world.load": { params: {}, handler: HANDLER },
		"world.bare": { params: {}, handler: `${ID}:query/bare@1` },
		"world.broken": { params: {}, handler: `${ID}:query/broken@1` }
	},
	nodeDefinitions: [
		{ id: HANDLER, kind: "query" },
		{ id: `${ID}:query/bare@1`, kind: "query" },
		{ id: `${ID}:query/broken@1`, kind: "query" }
	],
	hooks: {
		nodeHandlers: {
			[HANDLER]: "loadWorld",
			[`${ID}:query/bare@1`]: "bare",
			[`${ID}:query/broken@1`]: "broken"
		}
	}
}

let mgr: SandboxManager
let dir: string
let invokePluginAction: typeof import("./pluginActions").invokePluginAction

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	db = await createTestDb()
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-pa-"))
	const world = path.join(dir, "extensions_data", storageSegment(ID), "worlds", "a")
	fs.mkdirSync(world, { recursive: true })
	fs.writeFileSync(path.join(world, "world.json"), JSON.stringify({ name: "Vila", places: 3 }))
	mgr = new SandboxManager({ dataDir: dir })
	mgr.register({
		id: ID,
		name: "Worlds",
		bundleSource: BUNDLE,
		bundleHash: "h",
		backends: ["quickjs"],
		backend: "quickjs",
		sequential: false,
		storageQuotaBytes: 1_000_000
	})
	mgr.markReady()
	await db.insert(schema.plugins).values({
		pluginId: ID,
		name: "Worlds",
		version: "1.0.0",
		bundleSource: BUNDLE,
		bundleHash: "h",
		enabled: true,
		manifest,
		adminDenied: reviewMarks(declaredPermissions(manifest as never))
	} as never)
	;({ invokePluginAction } = await import("./pluginActions"))
}, 60_000)
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const run = (action: string, input: Record<string, unknown> = { id: "a" }) =>
	invokePluginAction(db as never, { pluginId: ID, action, input, userId: 1, manager: mgr })

describe("a plugin action returns out.main", () => {
	it("returns the world.json the handler read from storage", async () => {
		expect(await run("world.load")).toEqual({ name: "Vila", places: 3 })
	})
	it("a bare object return is read as its ports (main)", async () => {
		expect(await run("world.bare")).toEqual({ bare: true })
	})
	it("an err Result comes back as the refusal sentence", async () => {
		await expect(run("world.broken")).rejects.toThrow("'Worlds' could not do 'world.broken': no such world")
	})
})
