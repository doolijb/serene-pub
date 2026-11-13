/**
 * 🚧 ST3: a turn owns what it wrote on its session. A turn that wrote a seat
 * bench, a ruleset conversion, a deck draw and an annex key (the four kinds of
 * `session_imprints`) has all four taken by Back and put back by Forward, and
 * taken by a delete. A `rewind_taken` record written before ST3 (`annexDeltas`,
 * `seatBenches`, `conversions`) on a rewound row is restored by Forward too.
 *
 * The rows are filed with `fileSessionImprint` and the values set as the
 * writers would; the real writers are covered in `oneUndoRule.int.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-imprints-undo-secret" }
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
let characterId: number
let n = 0
const d = () => db as unknown as Db

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-imprints-undo-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "session-imprints-undo-owner")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Mara", description: "A miller." })
		.returning()
	characterId = character!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

interface World {
	sessionId: number
	seatId: number
	person: number
	reply: number
}

/** A session, a person's line, then reply R; R's turn wrote the four: the values are set as the writers leave them. */
async function world(): Promise<World> {
	const k = ++n
	const { insertLegacy } = await import("$lib/server/messages/store")
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Undo book ${k}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Imprint undo ${k}`,
			genreId: "core:genre/story",
			lorebookId: lorebook!.id,
			rulesetVersion: "1.0.0"
		})
		.returning()
	const sessionId = session!.id
	const [seat] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, isActive: true })
		.returning()
	const person = await insertLegacy(d(), {
		sessionId,
		userId: ownerId,
		role: "user",
		content: "We walk to the mill.",
		channel: "main"
	} as any)
	const reply = await insertLegacy(d(), {
		sessionId,
		role: "assistant",
		isNarratorResponse: true,
		content: "The mill looms.",
		channel: "main"
	} as any)
	return { sessionId, seatId: seat!.id, person: person.id, reply: reply.id }
}

/** What the turn at `messageId` wrote: the values and the four rows. */
async function writeTheFour(w: World, messageId = w.reply) {
	const { fileSessionImprint, seatBenchKey } = await import(
		"$lib/server/sessions/sessionImprints"
	)
	await db
		.update(schema.sessionCharacters)
		.set({ isActive: false })
		.where(eq(schema.sessionCharacters.id, w.seatId))
	await db
		.update(schema.sessions)
		.set({
			rulesetVersion: "2.0.0",
			rulesetDecks: { "draw-pile": { cards: [3] } } as never,
			annex: { acme: { plan: "v1" } } as never
		})
		.where(eq(schema.sessions.id, w.sessionId))
	const anchor = { sessionId: w.sessionId, messageId, runId: null }
	await db.transaction(async (tx) => {
		const t = tx as any
		await fileSessionImprint(
			t,
			anchor,
			{ kind: "seat-bench", key: seatBenchKey("character", w.seatId) },
			false,
			true
		)
		await fileSessionImprint(
			t,
			anchor,
			{ kind: "ruleset-conversion", key: "core:ruleset/test" },
			"1.0.0",
			"2.0.0"
		)
		await fileSessionImprint(
			t,
			anchor,
			{ kind: "deck", key: "draw-pile" },
			undefined,
			{ cards: [3] }
		)
		await fileSessionImprint(
			t,
			anchor,
			{ kind: "annex", key: "acme/plan" },
			undefined,
			"v1",
			{ ownerVersion: null, audienceBefore: null, audienceAfter: null }
		)
	})
}

/** The four, as they stand. */
async function four(w: World) {
	const [s] = await db
		.select({
			version: schema.sessions.rulesetVersion,
			decks: schema.sessions.rulesetDecks,
			annex: schema.sessions.annex
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, w.sessionId))
	const [seat] = await db
		.select({ active: schema.sessionCharacters.isActive })
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.id, w.seatId))
	return {
		seatActive: seat!.active,
		version: s!.version,
		decks: s!.decks ?? {},
		annex: s!.annex ?? {}
	}
}
const WROTE = {
	seatActive: false,
	version: "2.0.0",
	decks: { "draw-pile": { cards: [3] } },
	annex: { acme: { plan: "v1" } }
}
const TAKEN = {
	seatActive: true,
	version: "1.0.0",
	decks: {},
	annex: {}
}
const rowKinds = async (w: World) =>
	(
		await db
			.select()
			.from(schema.sessionImprints)
			.where(eq(schema.sessionImprints.sessionId, w.sessionId))
			.orderBy(schema.sessionImprints.id)
	).map((r) => r.subjectKind)

const back = (w: World) =>
	import("$lib/server/sessions/rewind").then((m) =>
		m.rewindTurn(d(), { sessionId: w.sessionId, userId: ownerId })
	)
const forward = (w: World) =>
	import("$lib/server/sessions/rewind").then((m) =>
		m.forwardTurn(d(), { sessionId: w.sessionId, userId: ownerId })
	)

describe("session imprints: a turn owns what it wrote", () => {
	it("Back of a turn that wrote a bench, a conversion, a deck draw and an annex key takes all four; Forward restores all four", async () => {
		const w = await world()
		await writeTheFour(w)
		expect(await four(w)).toEqual(WROTE)
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await four(w)).toEqual(TAKEN)
		expect(await rowKinds(w)).toEqual([])
		expect(await forward(w)).toMatchObject({ ok: true })
		expect(await four(w)).toEqual(WROTE)
		expect((await rowKinds(w)).sort()).toEqual([
			"annex",
			"deck",
			"ruleset-conversion",
			"seat-bench"
		])
	})

	it("a delete (deleteLegacy) takes all four", async () => {
		const w = await world()
		await writeTheFour(w)
		const { deleteLegacy } = await import("$lib/server/messages/store")
		const seatChanges: any[] = []
		await deleteLegacy(d(), w.reply, { seatChanges })
		expect(await four(w)).toEqual(TAKEN)
		expect(await rowKinds(w)).toEqual([])
		expect(seatChanges).toHaveLength(1)
	})

	it("a replacement (retractStateAnchoredTo 'replaced') takes all four and a failed re-tell's restore puts them back", async () => {
		const w = await world()
		await writeTheFour(w)
		const { retractStateAnchoredTo, restoreRetractedState } = await import(
			"$lib/server/state/write"
		)
		const out = await retractStateAnchoredTo(d(), w.reply, "replaced")
		expect(out.changed).toBe(true)
		expect(out.taken.sessionImprints).toHaveLength(4)
		expect(await four(w)).toEqual(TAKEN)
		await restoreRetractedState(d(), out.taken)
		expect(await four(w)).toEqual(WROTE)
	})

	it("an old-shape rewind_taken record (annexDeltas, seatBenches, conversions) on a rewound row is restored by Forward", async () => {
		const w = await world()
		// Back with nothing filed: the row's record has no session imprints; the old record is written over it.
		expect(await back(w)).toMatchObject({ ok: true })
		const rows = await db
			.select({
				id: schema.sessionMessages.id,
				taken: schema.sessionMessages.rewindTaken
			})
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, w.sessionId),
					eq(schema.sessionMessages.id, w.reply)
				)
			)
		const record = rows[0]!.taken as any
		expect(record?.state?.messageId).toBe(w.reply)
		const { sessionImprints: _gone, imprintMark: _mark, ...state } = record.state
		const oldRecord = {
			...record,
			state: {
				...state,
				annexDeltas: [
					{
						reverted: true,
						row: {
							id: 1,
							sessionId: w.sessionId,
							messageId: w.reply,
							owner: "acme",
							ownerVersion: null,
							runId: null,
							before: { document: null, audiences: null },
							after: { document: { plan: "v1" }, audiences: null },
							createdAt: new Date().toISOString()
						}
					}
				],
				seatBenches: [
					{
						messageId: w.reply,
						kind: "character",
						seatId: w.seatId,
						from: false,
						to: true
					}
				],
				conversions: [
					{
						messageId: w.reply,
						rulesetId: "core:ruleset/test",
						from: "1.0.0",
						to: "2.0.0"
					}
				]
			}
		}
		await db
			.update(schema.sessionMessages)
			.set({ rewindTaken: oldRecord })
			.where(eq(schema.sessionMessages.id, w.reply))
		expect(await four(w)).toEqual(TAKEN)
		expect(await forward(w)).toMatchObject({ ok: true })
		const after = await four(w)
		expect(after.seatActive).toBe(false)
		expect(after.version).toBe("2.0.0")
		expect(after.annex).toEqual({ acme: { plan: "v1" } })
		expect((await rowKinds(w)).sort()).toEqual([
			"annex",
			"ruleset-conversion",
			"seat-bench"
		])
	})
})
