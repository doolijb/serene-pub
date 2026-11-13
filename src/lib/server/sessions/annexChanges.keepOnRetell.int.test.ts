/**
 * 🚧 Annex session imprints on a replacement (ST3): `keepOnRetell` is "skip that
 * key's rows" — the `keep` option of `retractSessionImprints` leaves a kept
 * key's rows standing and takes the rest — and a later full retraction takes the
 * kept keys too. A failed re-tell keeps none of its own annex values, a kept key
 * included (`restoreRetractedState`, the mark): the swipe's state comes back exactly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "annex-keep-test-secret" }
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
		path.join(os.tmpdir(), "serene-pub-vitest-annex-keep-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "annex-keep-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(genreId = "core:genre/story") {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Annex ${++n}`,
			genreId
		})
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { fileSessionImprint } = await import(
		"$lib/server/sessions/sessionImprints"
	)
	const line = async (role: "user" | "assistant", content: string) =>
		await insertLegacy(db, {
			sessionId: session.id,
			role,
			content,
			metadata: {}
		} as any)
	/** A host write: each changed key of the owner's document and its imprint row, in one transaction. */
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
			const held = (cur?.annex ?? {}) as Record<string, any>
			const before = (held[owner] ?? {}) as Record<string, unknown>
			await tx
				.update(schema.sessions)
				.set({ annex: { ...held, [owner]: { ...before, ...document } } as any })
				.where(eq(schema.sessions.id, session.id))
			for (const key of Object.keys(document).sort())
				await fileSessionImprint(
					tx as any,
					{ sessionId: session.id, messageId, runId: null },
					{ kind: "annex", key: `${owner}/${key}` },
					before[key],
					document[key],
					{ ownerVersion: null, audienceBefore: null, audienceAfter: null }
				)
		})
	const annex = async () =>
		(
			await db
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session.id))
		)[0]?.annex as Record<string, any>
	const rows = async () =>
		await db
			.select()
			.from(schema.sessionImprints)
			.where(
				and(
					eq(schema.sessionImprints.sessionId, session.id),
					eq(schema.sessionImprints.status, "standing")
				)
			)
			.orderBy(schema.sessionImprints.id)
	return { session, line, write, annex, rows }
}

describe("annex session imprints, keepOnRetell", () => {
	const keep = (row: { subjectKey: string }) => row.subjectKey === "acme/plan"
	const retract = async (
		sessionId: number,
		messageId: number,
		withKeep: boolean
	) => {
		const { retractSessionImprints } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		return await db.transaction(async (tx) =>
			retractSessionImprints(
				tx as any,
				{ sessionId, messageIds: [messageId] },
				withKeep ? { keep } : {}
			)
		)
	}

	it("leaves the row standing when every changed key is kept", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { plan: "x" })
		const done = await retract(w.session.id, m2.id, true)
		expect(done.taken).toEqual([])
		expect(done.changed).toBe(false)
		expect((await w.annex()).acme).toEqual({ plan: "x" })
		expect((await w.rows()).length).toBe(1)
	}, 60_000)

	it("takes a mixed write's other key, leaves the kept one; a later full retraction takes the kept key too", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { plan: "x", mood: "calm" })
		const done = await retract(w.session.id, m2.id, true)
		expect(
			done.taken.map((t) => [t.act, t.imprint.subjectKey])
		).toEqual([["reverted", "acme/mood"]])
		expect((await w.annex()).acme).toEqual({ plan: "x" })
		expect((await w.rows()).map((r) => r.subjectKey)).toEqual(["acme/plan"])

		await retract(w.session.id, m2.id, false)
		expect((await w.annex()).acme).toBeUndefined()
		expect((await w.rows()).length).toBe(0)
	}, 60_000)

	it("restoreSessionImprints puts the taken key back and files its row again", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { plan: "x", mood: "calm" })
		const done = await retract(w.session.id, m2.id, true)
		const { restoreSessionImprints } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		await db.transaction(async (tx) =>
			restoreSessionImprints(tx as any, done.taken)
		)
		expect((await w.annex()).acme).toEqual({ plan: "x", mood: "calm" })
		expect((await w.rows()).map((r) => r.subjectKey).sort()).toEqual([
			"acme/mood",
			"acme/plan"
		])
	}, 60_000)

	it("two mixed writes of one message: a replacement keeps the turn's final plan, a full retraction takes it too", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { plan: "p0", note: "n0" })
		const m3 = await w.line("assistant", "three")
		await w.write("acme", m3.id, { plan: "p1", note: "n1" })
		await w.write("acme", m3.id, { plan: "p2", note: "n2" })
		const done = await retract(w.session.id, m3.id, true)
		expect(done.taken.map((t) => t.act)).toEqual(["reverted", "reverted"])
		expect((await w.annex()).acme).toEqual({ plan: "p2", note: "n0" })
		await retract(w.session.id, m3.id, false)
		expect((await w.annex()).acme).toEqual({ plan: "p0", note: "n0" })
	}, 60_000)

	it("a newer kept row and an older taken row: note goes back, plan stays, restore lands the note again", async () => {
		const w = await world()
		await w.line("user", "one")
		const m2 = await w.line("assistant", "two")
		await w.write("acme", m2.id, { plan: "p0", note: "n0" })
		const m3 = await w.line("assistant", "three")
		await w.write("acme", m3.id, { plan: "p0", note: "n1" })
		await w.write("acme", m3.id, { plan: "p2", note: "n1" })
		const done = await retract(w.session.id, m3.id, true)
		expect(done.taken.map((t) => [t.act, t.imprint.subjectKey])).toEqual([
			["reverted", "acme/note"]
		])
		expect((await w.annex()).acme).toEqual({ plan: "p2", note: "n0" })
		const { restoreSessionImprints } = await import(
			"$lib/server/sessions/sessionImprints"
		)
		await db.transaction(async (tx) =>
			restoreSessionImprints(tx as any, done.taken)
		)
		expect((await w.annex()).acme).toEqual({ plan: "p2", note: "n1" })
	}, 60_000)

	it("an interleaved row of another message still wins", async () => {
		const w = await world()
		await w.line("user", "one")
		const a = await w.line("assistant", "a")
		const b = await w.line("assistant", "b")
		await w.write("acme", a.id, { plan: "p1", note: "a1" })
		await w.write("acme", b.id, { plan: "p1", note: "b1" })
		await w.write("acme", a.id, { plan: "p2", note: "b1" })
		const done = await retract(w.session.id, a.id, true)
		// a's note row is spliced into b's (a later row of the key stands); its plan rows are skipped.
		expect(done.taken.map((t) => [t.act, t.imprint.subjectKey])).toEqual([
			["spliced", "acme/note"]
		])
		expect((await w.annex()).acme).toEqual({ plan: "p2", note: "b1" })
		expect(
			(await w.rows()).filter((r) => r.messageId === b.id).length
		).toBe(1)
	}, 60_000)
})

describe("annex session imprints, a failed re-tell", () => {
	// The Dungeon Crawler declares its progress field `keepOnRetell`; the other key is plain.
	const K = "dungeon-crawler-progress"
	const X = "plain-note-for-test"

	/** A turn writes `first`; a swipe; the re-tell writes `retell`; the failed run's cleanup; then the restore. */
	async function failedRetell(first: Record<string, unknown>, retell: Record<string, unknown>) {
		const w = await world("core:genre/dungeon-crawler")
		await w.line("user", "one")
		const m = await w.line("assistant", "two")
		await w.write("core", m.id, first)
		const annexBefore = (await w.annex()).core
		const rowsBefore = (await w.rows()).filter((r) => r.messageId === m.id)
		const { retractStateAnchoredTo, restoreRetractedState } = await import("$lib/server/state/write")
		const swipe = await retractStateAnchoredTo(db as any, m.id, "replaced")
		await w.write("core", m.id, retell)
		await retractStateAnchoredTo(db as any, m.id, "replaced")
		await restoreRetractedState(db as any, swipe.taken)
		return { w, m, annexBefore, rowsBefore, swipe }
	}

	it("a swipe's mixed write: every annex value and the turn's imprint rows are as before the swipe", async () => {
		const { w, m, annexBefore, rowsBefore } = await failedRetell({ [K]: "k0", [X]: "x0" }, { [K]: "k1", [X]: "x1" })
		expect(annexBefore).toEqual({ [K]: "k0", [X]: "x0" })
		expect((await w.annex()).core).toEqual(annexBefore)
		const rows = (await w.rows()).filter((r) => r.messageId === m.id)
		expect(rows).toEqual(rowsBefore)
	}, 60_000)

	it("a swipe's kept-only write (only the kept key changed): the same holds", async () => {
		const { w, m, annexBefore, rowsBefore, swipe } = await failedRetell({ [K]: "k0" }, { [K]: "k1", [X]: "x1" })
		expect(annexBefore).toEqual({ [K]: "k0" })
		expect(swipe.taken.sessionImprints).toEqual([])
		expect((await w.annex()).core).toEqual(annexBefore)
		const rows = (await w.rows()).filter((r) => r.messageId === m.id)
		expect(rows).toEqual(rowsBefore)
	}, 60_000)
})
