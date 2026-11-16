/**
 * `entries:update` and `entries:delete` echo the asker's `requestId` on the
 * reply and on the refusal, so the one surface that asked claims them; with
 * none sent, the reply and the refusal carry no such key.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-entries-request-echo-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `request-echo-${++n}`)
	const stranger = await createTestUser(testDb, `request-echo-stranger-${n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Echo ${n}` })
		.returning()
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: 0,
			title: "Lamp",
			content: "…"
		})
		.returning()
	return { user, stranger, entry: entry! }
}

type Sent = { event: string; data: any }

async function ask(
	kind: "update" | "delete",
	userId: number,
	entryId: number,
	requestId?: string
) {
	const mod = await import("./entries")
	const sent: Sent[] = []
	const emit = (event: string, data: any) => sent.push({ event, data })
	const extra = requestId === undefined ? {} : { requestId }
	let reply: any
	let refused = false
	try {
		reply =
			kind === "update"
				? await mod.updateEntryHandler.handler(
						fakeSocket(userId),
						{
							entry: {
								id: entryId,
								typeId: WORLD_LORE_TYPE_ID,
								title: "Lantern"
							},
							...extra
						} as any,
						emit
					)
				: await mod.deleteEntryHandler.handler(
						fakeSocket(userId),
						{
							id: entryId,
							typeId: WORLD_LORE_TYPE_ID,
							...extra
						} as any,
						emit
					)
	} catch {
		refused = true
	}
	return {
		sent,
		reply,
		refused,
		error: sent.find((s) => s.event === `entries:${kind}:error`)?.data
	}
}

describe.each(["update", "delete"] as const)(
	"entries:%s echoes the asker",
	(kind) => {
		test("a refusal carries the requestId it was asked with", async () => {
			const w = await world()
			const r = await ask(kind, w.stranger.id, w.entry.id, "r1")
			expect(r.refused).toBe(true)
			expect(r.error.requestId).toBe("r1")
			expect(r.error.error).toBeTruthy()
		})

		test("a refusal without one has no requestId key", async () => {
			const w = await world()
			const r = await ask(kind, w.stranger.id, w.entry.id)
			expect(r.error).toBeDefined()
			expect("requestId" in r.error).toBe(false)
		})

		test("the reply carries it, and has none when none was sent", async () => {
			const w = await world()
			const a = await ask(kind, w.user.id, w.entry.id, "r2")
			expect(a.refused).toBe(false)
			expect(a.reply.requestId).toBe("r2")
			expect(
				a.sent.find((s) => s.event === `entries:${kind}`)?.data
					.requestId
			).toBe("r2")

			const w2 = await world()
			const b = await ask(kind, w2.user.id, w2.entry.id)
			expect("requestId" in b.reply).toBe(false)
			expect(
				"requestId" in
					b.sent.find((s) => s.event === `entries:${kind}`)!.data
			).toBe(false)
		})
	}
)
