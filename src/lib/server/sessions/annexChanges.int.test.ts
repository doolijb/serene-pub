/**
 * 🚧 Annex changes, per key (ST3): a write of one owner's annex document
 * anchored to a turn's message files one `session_imprints` row per changed
 * key — Back takes them back by the one rule (later writer wins, `core`'s
 * `retake-quietly` files none and keeps its current value), Forward puts them
 * back, a branch reads the annex as it stood at the fork (`annexAt`, per key).
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-annex-changes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
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
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Annex ${++n}`,
			genreId: "core:genre/story"
		})
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { isTimelessAnnexKey } = await import(
		"$lib/server/sessions/annexChanges"
	)
	const { fileSessionImprint, annexImprintKey } = await import(
		"$lib/server/sessions/sessionImprints"
	)
	const line = async (role: "user" | "assistant", content: string) =>
		await insertLegacy(db, {
			sessionId: session.id,
			role,
			content,
			metadata: {}
		} as any)
	/** A host write: the annex document and one imprint per changed key, in one transaction. */
	const write = async (
		owner: string,
		messageId: number,
		document: Record<string, unknown>
	) =>
		await db.transaction(async (tx) => {
			const [cur] = await tx
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session.id))
			const held = (cur?.annex ?? {}) as Record<string, unknown>
			const previous = (held[owner] as Record<string, unknown>) ?? {}
			await tx
				.update(schema.sessions)
				.set({ annex: { ...held, [owner]: document } as any })
				.where(eq(schema.sessions.id, session.id))
			for (const k of new Set([
				...Object.keys(previous),
				...Object.keys(document)
			])) {
				if (isTimelessAnnexKey(owner, k)) continue
				await fileSessionImprint(
					tx as any,
					{ sessionId: session.id, messageId, runId: null },
					{ kind: "annex", key: annexImprintKey(owner, k) },
					previous[k],
					document[k],
					{ ownerVersion: null, audienceBefore: null, audienceAfter: null }
				)
			}
		})
	const annex = async () =>
		(
			await db
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session.id))
		)[0]?.annex as Record<string, any>
	const deltas = async () =>
		await db
			.select()
			.from(schema.sessionImprints)
			.where(eq(schema.sessionImprints.sessionId, session.id))
	return { session, line, write, annex, deltas }
}

describe("annex changes, per key", () => {
	it("Back then Forward: the owner's document goes back and lands again", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { v: 2 })
		await w.line("user", "three")
		const m4 = await w.line("assistant", "four")
		await w.write("acme", m4.id, { v: 4 })
		const rowId = (await w.deltas()).find((d) => d.messageId === m4.id)!.id

		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const back = await rewindTurn(db as any, {
			sessionId: w.session.id,
			userId: ownerId
		})
		expect(back.ok).toBe(true)
		expect((await w.annex()).acme).toEqual({ v: 2 })
		expect((await w.deltas()).some((d) => d.messageId === m4.id)).toBe(
			false
		)

		const fwd = await forwardTurn(db as any, {
			sessionId: w.session.id,
			userId: ownerId
		})
		expect(fwd.ok).toBe(true)
		expect((await w.annex()).acme).toEqual({ v: 4 })
		expect((await w.deltas()).find((d) => d.messageId === m4.id)?.id).toBe(
			rowId
		)
	}, 60_000)

	it("later writer wins: an older anchor's retraction leaves the newer value", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { v: 2 })
		await w.line("user", "three")
		const m4 = await w.line("assistant", "four")
		await w.write("acme", m4.id, { v: 4 })
		const { retractSessionImprints } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		const { taken } = await db.transaction(async (tx) =>
			retractSessionImprints(tx as any, {
				sessionId: w.session.id,
				messageIds: [m2.id]
			})
		)
		expect(taken.map((t) => t.act)).toEqual(["spliced"])
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
			.set({
				annex: { core: { progress: 1, "retake-quietly": true } } as any
			})
			.where(eq(schema.sessions.id, w.session.id))
		const { retractSessionImprints } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		await db.transaction(async (tx) =>
			retractSessionImprints(tx as any, {
				sessionId: w.session.id,
				messageIds: [m2.id]
			})
		)
		expect((await w.annex()).core).toEqual({ "retake-quietly": true })
		// 🚧 M2a a8 / M2b: the Back moved core's document, so it moved core's annex document version (the column).
		const [row] = await db
			.select({ versions: schema.sessions.annexVersions })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(row!.versions).toMatchObject({ core: 1 })
	}, 60_000)

	it("a timeless key files no row; every other changed key files one", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("core", m2.id, { progress: 1, "retake-quietly": true })
		expect((await w.deltas()).map((d) => d.subjectKey)).toEqual([
			"core/progress"
		])
		await w.write("acme", m2.id, { a: 1, b: 2 })
		await w.write("acme", m2.id, { a: 1, b: 3 })
		expect(
			(await w.deltas()).map((d) => d.subjectKey).sort()
		).toEqual(["acme/a", "acme/b", "acme/b", "core/progress"])
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
		expect(await annexAt(db as any, w.session.id, m2.id)).toEqual({
			acme: { v: 2 }
		})
		// A timeless key and a key written after the fork: the first stays, the second goes.
		await db
			.update(schema.sessions)
			.set({
				annex: {
					acme: { v: 4, later: true },
					other: { x: 1 },
					core: { "retake-quietly": true }
				} as any
			})
			.where(eq(schema.sessions.id, w.session.id))
		expect(await annexAt(db as any, w.session.id, m2.id)).toEqual({
			acme: { v: 2, later: true },
			core: { "retake-quietly": true }
		})
		await db
			.update(schema.sessions)
			.set({ annex: { acme: { v: 4 }, other: { x: 1 } } as any })
			.where(eq(schema.sessions.id, w.session.id))
		expect(await annexAt(db as any, w.session.id, m4.id)).toEqual({
			acme: { v: 4 },
			other: { x: 1 }
		})
	}, 60_000)

	it("insertLegacyMany stamps every row's story clock", async () => {
		const w = await world()
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: ownerId, name: `Book ${n}` })
			.returning()
		await db
			.update(schema.sessions)
			.set({
				lorebookId: book.id,
				storyClockYear: 1200,
				storyClockMonth: 3,
				storyClockDay: 4,
				storyClockHour: 5,
				storyClockMinute: 6
			})
			.where(eq(schema.sessions.id, w.session.id))
		const { insertLegacyMany } = await import("$lib/server/messages/store")
		const rows = await insertLegacyMany(
			db as any,
			["a", "b", "c"].map(
				(content) =>
					({
						sessionId: w.session.id,
						role: "assistant",
						content,
						metadata: {}
					}) as any
			)
		)
		expect(rows).toHaveLength(3)
		for (const r of rows) {
			expect(r.storyClockYear).toBe(1200)
			expect(r.storyClockMonth).toBe(3)
			expect(r.storyClockDay).toBe(4)
		}
	}, 60_000)
})
