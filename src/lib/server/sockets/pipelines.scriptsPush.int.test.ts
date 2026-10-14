/**
 * `pipelines:scripts` is re-sent to every admin socket that declared it when a
 * write moves what Admin › Scripts says without being a script write — a
 * chain set on a step, a connection's stop guard attached or detached, a
 * plugin installed, switched or uninstalled (PLAN-script-placement D5).
 *
 * Delivered through `emitToInterested`, admin sockets only (`pipelines:` is a
 * mixed family, and the list's handler is admin-gated), nothing to a socket
 * that declared nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"

let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scripts-push-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-scripts-push-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

type Sent = { to: string; event: string; payload: any }

/** A Socket.IO server double: an interested admin, an interested member, an idle admin. */
function fakeIo() {
	const sent: Sent[] = []
	const sockets = new Map<string, any>([
		["admin-1", { id: "admin-1", user: { id: 1, isAdmin: true }, interest: new Set(["pipelines:scripts"]) }],
		["member-2", { id: "member-2", user: { id: 2, isAdmin: false }, interest: new Set(["pipelines:scripts"]) }],
		["idle-3", { id: "idle-3", user: { id: 3, isAdmin: true }, interest: new Set(["sessions:list"]) }]
	])
	const io = {
		to: (room: string) => ({
			emit: (event: string, payload: any) => sent.push({ to: room, event, payload })
		}),
		sockets: { sockets, adapter: { rooms: new Map() } }
	}
	return { io, sent }
}

describe("pipelines:scripts — pushed to every interested admin socket", () => {
	test("an interested admin gets the list; a member and an idle socket get nothing", async () => {
		const { pushScriptsList } = await import("./pipelines")
		const { io, sent } = fakeIo()
		expect(await pushScriptsList(io as any)).toBe(1)
		expect(sent.map((s) => s.to)).toEqual(["admin-1"])
		expect(sent[0].event).toBe("pipelines:scripts")
		expect(Array.isArray(sent[0].payload.scripts)).toBe(true)
		expect(Array.isArray(sent[0].payload.types)).toBe(true)
	}, 60_000)

	test("no admin socket declared it: nothing is built or sent", async () => {
		const { pushScriptsList } = await import("./pipelines")
		const { io, sent } = fakeIo()
		io.sockets.sockets.get("admin-1").interest = new Set()
		expect(await pushScriptsList(io as any)).toBe(0)
		expect(sent).toEqual([])
	}, 60_000)

	test("plugins:setEnabled re-sends it", async () => {
		const { pluginsSetEnabled } = await import("./plugins")
		const { io, sent } = fakeIo()
		const caller = { user: { id: 1, isAdmin: true }, io }
		await pluginsSetEnabled.handler(
			caller as any,
			{ pluginId: "no-such-plugin", enabled: false } as any,
			(async () => {}) as any
		)
		const pushed = sent.filter((s) => s.event === "pipelines:scripts")
		expect(pushed.map((s) => s.to)).toEqual(["admin-1"])
	}, 60_000)
})
