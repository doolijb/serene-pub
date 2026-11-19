/**
 * Owner ruling DG6 (2026-11-17): "Send regular users the mark's state only,
 * worked out on the server". A reader who is not an administrator is sent each
 * embedded row's state (`embeddingState`: current / stale) with no model id; an
 * administrator's row is unchanged. The active model is read once per push or
 * page and only when a non-administrator's payload carries an embedded row.
 *
 * Asserted on the serialised payload: the model's id is nowhere in what a
 * non-administrator is sent.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "embedding-state-test-secret" }
})

const ACTIVE = "api::http://embed.example::SENTINEL-ACTIVE-MODEL"
const OLD = "api::http://embed.example::SENTINEL-OLD-MODEL"

const targetReads = vi.hoisted(() => ({ n: 0 }))
vi.mock("$lib/server/embedding/target", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/embedding/target")>()),
	resolveEmbeddingTarget: async () => {
		targetReads.n++
		return { modelId: "api::http://embed.example::SENTINEL-ACTIVE-MODEL" }
	}
}))

let testDb: TestDb
let dataDir: string
let owner: { id: number }
let guest: { id: number }
let admin: { id: number }
let sessionId: number
let rows: Array<typeof schema.sessionMessages.$inferSelect>

const socketFor = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin }, io: { to: () => ({ emit: () => {} }) } }) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-embedding-state-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	owner = await createTestUser(testDb, "es-owner")
	guest = await createTestUser(testDb, "es-guest")
	admin = await createTestUser(testDb, "es-admin")
	await testDb.update(schema.users).set({ isAdmin: true }).where(inArray(schema.users.id, [admin.id]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true } as any)
		.returning()
	sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: guest.id },
		{ sessionId, userId: admin.id }
	] as any)
	rows = await testDb
		.insert(schema.sessionMessages)
		.values(
			[ACTIVE, OLD, null].map((embeddingModel, i) => ({
				sessionId,
				userId: owner.id,
				role: i % 2 ? "assistant" : "user",
				content: `line ${i + 1}`,
				channel: "main",
				embeddingModel
			})) as any
		)
		.returning()
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const byId = (list: any[]) => Object.fromEntries(list.map((r) => [r.id, r])) as Record<number, any>

async function messagesPage(socket: any) {
	const { sessionsMessagesPageHandler } = await import("./sessions")
	return (await sessionsMessagesPageHandler.handler(socket, { sessionId } as any, () => {})) as any
}

describe("a reader who is not an administrator is sent the state, never the model id", () => {
	for (const [who, user] of [
		["a non-administrator owner", () => owner],
		["a guest", () => guest]
	] as const)
		test(`${who}: sessions:messagesPage`, async () => {
			targetReads.n = 0
			const res = await messagesPage(socketFor(user().id))
			const text = JSON.stringify(res)
			expect(text).not.toContain("SENTINEL")
			const [current, stale, none] = rows.map((r) => byId(res.rows)[r.id])
			expect(current.embeddingState).toBe("current")
			expect(stale.embeddingState).toBe("stale")
			// A row with no embedding carries no state and no id: the client reads none.
			expect(none.embeddingState).toBeUndefined()
			expect(none.embeddingModel).toBeNull()
			expect(targetReads.n).toBe(1)
		})

	test("sessions:get and sessionMessage by id", async () => {
		const { sessionsGetHandler, sessionMessageHandler } = await import("./sessions")
		const first = (await sessionsGetHandler.handler(
			socketFor(guest.id),
			{ id: sessionId } as any,
			() => {}
		)) as any
		expect(JSON.stringify(first)).not.toContain("SENTINEL")
		expect(byId(first.messages)[rows[0]!.id].embeddingState).toBe("current")
		expect(byId(first.session.sessionMessages)[rows[1]!.id].embeddingState).toBe("stale")
		const one = (await sessionMessageHandler.handler(
			socketFor(guest.id),
			{ id: rows[1]!.id } as any,
			() => {}
		)) as any
		expect(JSON.stringify(one)).not.toContain("SENTINEL")
		expect(one.sessionMessage.embeddingState).toBe("stale")
	})
})

describe("an administrator's row is unchanged", () => {
	test("sessions:messagesPage carries the model id and no state, with no read", async () => {
		targetReads.n = 0
		const res = await messagesPage(socketFor(admin.id, true))
		expect(byId(res.rows)[rows[0]!.id].embeddingModel).toBe(ACTIVE)
		expect(byId(res.rows)[rows[1]!.id].embeddingModel).toBe(OLD)
		expect(JSON.stringify(res)).not.toContain("embeddingState")
		expect(targetReads.n).toBe(0)
	})
})

describe("a push", () => {
	const ioFor = (people: Array<{ id: number; isAdmin: boolean }>, emitted: any[]) => ({
		sockets: {
			adapter: { rooms: new Map(people.map((p) => [`user_${p.id}`, new Set([`s${p.id}`])])) },
			sockets: new Map(
				people.map((p) => [
					`s${p.id}`,
					{ id: `s${p.id}`, interest: new Set(["sessionMessage"]), user: p }
				])
			)
		},
		to: (to: string) => ({ emit: (_e: string, payload: any) => emitted.push({ to, payload }) })
	})
	const push = async (io: any, embeddingModel: string | null) => {
		const { broadcastToSessionUsers } = await import("./utils/broadcastHelpers")
		await broadcastToSessionUsers(io, sessionId, "sessionMessage", {
			sessionMessage: { id: rows[0]!.id, sessionId, embeddingModel }
		})
	}
	const countStatements = async (fn: () => Promise<unknown>) => {
		const client = (testDb as any).$client as { query: (...a: unknown[]) => unknown }
		const original = client.query.bind(client)
		let n = 0
		client.query = (...args: unknown[]) => (n++, original(...args))
		try {
			await fn()
		} finally {
			client.query = original
		}
		return n
	}

	test("to an owner and a guest who are not administrators carries the state, read once", async () => {
		targetReads.n = 0
		const emitted: any[] = []
		await push(
			ioFor(
				[
					{ id: owner.id, isAdmin: false },
					{ id: guest.id, isAdmin: false }
				],
				emitted
			),
			OLD
		)
		expect(emitted).toHaveLength(2)
		for (const e of emitted) {
			expect(JSON.stringify(e.payload)).not.toContain("SENTINEL")
			expect(e.payload.sessionMessage.embeddingState).toBe("stale")
		}
		expect(targetReads.n).toBe(1)
	})

	test("to an administrator alone costs what a row with no embedding costs", async () => {
		const emitted: any[] = []
		const io = ioFor([{ id: admin.id, isAdmin: true }], emitted)
		targetReads.n = 0
		const embedded = await countStatements(() => push(io, ACTIVE))
		const plain = await countStatements(() => push(io, null))
		expect(embedded).toBe(plain)
		expect(targetReads.n).toBe(0)
		expect(emitted[0].payload.sessionMessage.embeddingModel).toBe(ACTIVE)
		expect(emitted[0].payload.sessionMessage.embeddingState).toBeUndefined()
	})
})
