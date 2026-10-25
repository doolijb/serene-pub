/**
 * 🚧 Annex deltas (pr-6 lane A4): a write of one owner's annex document
 * anchored to a turn's message — Back takes it back by the one rule (later
 * writer wins, `core`'s `retake-quietly` kept), Forward lands it again, a
 * branch reads the annex as it stood at the fork.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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
	return { db, getCryptoSecretKey: () => "annex-changes-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let ownerId: number
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-annex-changes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "annex-changes-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world() {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: `Annex ${++n}`, genreId: "core:genre/story" })
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { recordAnnexDelta } = await import("$lib/server/sessions/annexChanges")
	const line = async (role: "user" | "assistant", content: string) =>
		await insertLegacy(db, { sessionId: session.id, role, content, metadata: {} } as any)
	/** A host write: the annex key and its delta in one transaction. */
	const write = async (owner: string, messageId: number, document: Record<string, unknown>) =>
		await db.transaction(async (tx) => {
			const [cur] = await tx
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session.id))
			const held = (cur?.annex ?? {}) as Record<string, unknown>
			await tx
				.update(schema.sessions)
				.set({ annex: { ...held, [owner]: document } as any })
				.where(eq(schema.sessions.id, session.id))
			await recordAnnexDelta(tx as any, {
				sessionId: session.id,
				messageId,
				owner,
				ownerVersion: null,
				before: { document: (held[owner] as Record<string, unknown>) ?? null, audiences: null },
				after: { document, audiences: null },
				runId: null
			})
		})
	const annex = async () =>
		(
			await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, session.id))
		)[0]?.annex as Record<string, any>
	const deltas = async () =>
		await db.select().from(schema.annexDeltas).where(eq(schema.annexDeltas.sessionId, session.id))
	return { session, line, write, annex, deltas }
}

describe("annex deltas", () => {
	it("Back then Forward: the owner's document goes back and lands again", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { v: 2 })
		await w.line("user", "three")
		const m4 = await w.line("assistant", "four")
		await w.write("acme", m4.id, { v: 4 })
		const rowId = (await w.deltas()).find((d) => d.messageId === m4.id)!.id

		const { rewindTurn, forwardTurn } = await import("$lib/server/sessions/rewind")
		const back = await rewindTurn(db as any, { sessionId: w.session.id, userId: ownerId })
		expect(back.ok).toBe(true)
		expect((await w.annex()).acme).toEqual({ v: 2 })
		expect((await w.deltas()).some((d) => d.messageId === m4.id)).toBe(false)

		const fwd = await forwardTurn(db as any, { sessionId: w.session.id, userId: ownerId })
		expect(fwd.ok).toBe(true)
		expect((await w.annex()).acme).toEqual({ v: 4 })
		expect((await w.deltas()).find((d) => d.messageId === m4.id)?.id).toBe(rowId)
	}, 60_000)

	it("later writer wins: an older anchor's retraction leaves the newer value", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { v: 2 })
		await w.line("user", "three")
		const m4 = await w.line("assistant", "four")
		await w.write("acme", m4.id, { v: 4 })
		const { retractAnnexDeltasAnchoredTo } = await import("$lib/server/sessions/annexChanges")
		const taken = await db.transaction(async (tx) => retractAnnexDeltasAnchoredTo(tx as any, m2.id))
		expect(taken.map((t) => t.reverted)).toEqual([false])
		expect((await w.annex()).acme).toEqual({ v: 4 })
	}, 60_000)

	it("core's retake-quietly keeps its current value through a Back", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("core", m2.id, { progress: 1 })
		// The person's preference is set after the write.
		await db
			.update(schema.sessions)
			.set({ annex: { core: { progress: 1, "retake-quietly": true } } as any })
			.where(eq(schema.sessions.id, w.session.id))
		const { retractAnnexDeltasAnchoredTo } = await import("$lib/server/sessions/annexChanges")
		await db.transaction(async (tx) => retractAnnexDeltasAnchoredTo(tx as any, m2.id))
		expect((await w.annex()).core).toEqual({ "retake-quietly": true })
	}, 60_000)

	it("annexAt: the annex as written through the fork", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { v: 2 })
		await w.line("user", "three")
		const m4 = await w.line("assistant", "four")
		await w.write("acme", m4.id, { v: 4 })
		await w.write("other", m4.id, { x: 1 })
		const { annexAt } = await import("$lib/server/sessions/annexChanges")
		expect(await annexAt(db as any, w.session.id, m2.id)).toEqual({ acme: { v: 2 } })
		expect(await annexAt(db as any, w.session.id, m4.id)).toEqual({ acme: { v: 4 }, other: { x: 1 } })
	}, 60_000)

	it("insertLegacyMany stamps every row's story clock", async () => {
		const w = await world()
		const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: `Book ${n}` }).returning()
		await db
			.update(schema.sessions)
			.set({ lorebookId: book.id, storyClockYear: 1200, storyClockMonth: 3, storyClockDay: 4, storyClockHour: 5, storyClockMinute: 6 })
			.where(eq(schema.sessions.id, w.session.id))
		const { insertLegacyMany } = await import("$lib/server/messages/store")
		const rows = await insertLegacyMany(
			db as any,
			["a", "b", "c"].map((content) => ({ sessionId: w.session.id, role: "assistant", content, metadata: {} }) as any)
		)
		expect(rows).toHaveLength(3)
		for (const r of rows) {
			expect(r.storyClockYear).toBe(1200)
			expect(r.storyClockMonth).toBe(3)
			expect(r.storyClockDay).toBe(4)
		}
	}, 60_000)
})
