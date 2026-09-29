/**
 * `sessionPresets:list` is re-sent to every socket that declared it when a
 * write changes what the list holds without being a preset write — a plugin
 * installed, switched or uninstalled, a preset's actions set from the
 * Pipelines view — so an open session-create screen (anybody's, not just the
 * admin's who made the change) never shows stale presets.
 *
 * Delivered through `emitToInterested`, cut per recipient: the admin table to
 * admin sockets, the picker's cut to everyone else, nothing to a socket that
 * declared nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "presets-push-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-presets-push-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

type Sent = { to: string; event: string; payload: any }

/** A Socket.IO server double: three sockets, two of them interested. */
function fakeIo() {
	const sent: Sent[] = []
	const sockets = new Map<string, any>([
		["admin-1", { id: "admin-1", user: { id: 1, isAdmin: true }, interest: new Set(["sessionPresets:list"]) }],
		["guest-2", { id: "guest-2", user: { id: 2, isAdmin: false }, interest: new Set(["sessionPresets:list"]) }],
		["idle-3", { id: "idle-3", user: { id: 3, isAdmin: false }, interest: new Set(["sessions:list"]) }]
	])
	const io = {
		to: (room: string) => ({
			emit: (event: string, payload: any) => sent.push({ to: room, event, payload })
		}),
		sockets: { sockets, adapter: { rooms: new Map() } }
	}
	return { io, sent }
}

async function withDisabledPreset<T>(run: (id: number) => Promise<T>): Promise<T> {
	const [row] = await db
		.insert(schema.sessionPresets)
		.values({ name: "Push test (off)", genreId: "core:genre/chat", enabled: false })
		.returning()
	try {
		return await run(row.id)
	} finally {
		await db.delete(schema.sessionPresets).where(eq(schema.sessionPresets.id, row.id))
	}
}

describe("sessionPresets:list — pushed to every interested socket", () => {
	test("each interested socket gets its own cut; an uninterested one gets nothing", async () => {
		const { pushSessionPresetsList } = await import("./sessionAdmin")
		const { io, sent } = fakeIo()
		await withDisabledPreset(async (id) => {
			expect(await pushSessionPresetsList(io as any)).toBe(2)
			expect(sent.map((s) => s.to).sort()).toEqual(["admin-1", "guest-2"])
			expect(sent.every((s) => s.event === "sessionPresets:list")).toBe(true)
			const ids = (to: string) =>
				sent.find((s) => s.to === to)!.payload.presets.map((p: any) => p.id)
			expect(ids("admin-1")).toContain(id)
			expect(ids("guest-2")).not.toContain(id)
		})
	}, 60_000)

	test("no socket declared it: nothing is sent", async () => {
		const { pushSessionPresetsList } = await import("./sessionAdmin")
		const { io, sent } = fakeIo()
		for (const s of io.sockets.sockets.values()) s.interest = new Set()
		expect(await pushSessionPresetsList(io as any)).toBe(0)
		expect(sent).toEqual([])
	}, 60_000)

	test("plugins:setEnabled re-sends it — to another user's open picker too", async () => {
		const { pluginsSetEnabled } = await import("./plugins")
		const { io, sent } = fakeIo()
		const caller = { user: { id: 1, isAdmin: true }, io }
		await pluginsSetEnabled.handler(
			caller as any,
			{ pluginId: "no-such-plugin", enabled: false } as any,
			(async () => {}) as any
		)
		const pushed = sent.filter((s) => s.event === "sessionPresets:list")
		expect(pushed.map((s) => s.to).sort()).toEqual(["admin-1", "guest-2"])
	}, 60_000)
})
