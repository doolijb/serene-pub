/**
 * pr-6 A3: the settle line — it moves only through `settleThrough`, guards the
 * three retraction entry points, compacts what lies below it (the anchor swap),
 * and a person's edit marks the field's standing imprints `kept`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "settle-test-secret" }
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
const SLOT = "test:slot/settle-mood@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-settle-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "settle-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
/** A session with `n` lines, person and reply alternating; ids oldest first. */
async function story(n: number, extra: Record<string, unknown> = {}) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, name: `Settle ${++seq}`, ...extra } as any)
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const ids: number[] = []
	for (let i = 0; i < n; i++) {
		const m = await insertLegacy(db as any, {
			sessionId: session!.id,
			role: i % 2 === 0 ? "user" : "assistant",
			userId: ownerId,
			content: `Line ${i + 1}`
		} as any)
		ids.push(m.id)
	}
	return { s: session!.id, m: ids }
}

const settleTo = async (s: number, through: number) => {
	const { settleThrough } = await import("$lib/server/sessions/settle")
	return db.transaction((tx) => settleThrough(tx as any, s, through, {}))
}
const columnOf = async (s: number) =>
	(await db.select({ v: schema.sessions.settledMessageId }).from(schema.sessions).where(eq(schema.sessions.id, s)))[0]!.v

describe("🚧 the settle line", () => {
	it("moves, compacts below the line (anchor swap), and never moves back", async () => {
		const { s, m } = await story(6)
		const [book] = await db.insert(schema.lorebooks).values({ name: "Settle Book", userId: ownerId }).returning()
		const A = schema.attributeValues
		const row = (validFromMessageId: number, v: number) => ({
			ownerKind: "session",
			ownerId: s,
			slotId: SLOT,
			value: { v },
			sessionId: s,
			validFromMessageId,
			updatedBy: "rules"
		})
		await db.insert(A).values([row(m[1]!, 2), row(m[3]!, 4), row(m[5]!, 6)])
		await db.insert(schema.stateProposals).values([
			{ sessionId: s, messageId: m[1]!, kind: "value", payload: {}, status: "accepted" },
			{ sessionId: s, messageId: m[2]!, kind: "value", payload: {}, status: "pending" }
		] as any)
		const zone = (validFromMessageId: number) => ({
			sessionId: s,
			ownerKind: "session",
			ownerId: s,
			rulesetId: "test:ruleset/z@1",
			zoneType: "hand",
			entries: [{ at: validFromMessageId }],
			validFromMessageId
		})
		await db.insert(schema.zoneContents).values([zone(m[1]!), zone(m[3]!)] as any)
		await db.insert(schema.loreImprints).values({
			sessionId: s,
			messageId: m[2]!,
			lorebookId: book!.id,
			subjectKind: "entry",
			subjectId: 1,
			field: "title",
			before: { v: "a" },
			after: { v: "b" },
			status: "standing"
		} as any)
		await db.insert(schema.annexDeltas).values({
			sessionId: s,
			messageId: m[2]!,
			owner: "session",
			before: { document: null, audiences: null },
			after: { document: { a: 1 }, audiences: null }
		} as any)
		await db.insert(schema.sessionChanges).values({
			sessionId: s,
			event: "x",
			messageId: m[1]!,
			payload: {},
			consumedByRunId: "run-1"
		} as any)

		const moved = await settleTo(s, m[3]!)
		expect(moved).toEqual({ moved: true, settledMessageId: m[3]!, previousSettledMessageId: null })
		expect(await columnOf(s)).toBe(m[3]!)

		const rows = await db.select().from(A).where(eq(A.slotId, SLOT)).orderBy(asc(A.id))
		expect(rows).toHaveLength(2)
		expect(rows[0]).toMatchObject({ validFromMessageId: null, sessionId: s, sourceSessionId: s, sourceMessageId: m[3]!, value: { v: 4 } })
		expect(rows[1]).toMatchObject({ validFromMessageId: m[5]!, value: { v: 6 } })
		const proposals = await db.select().from(schema.stateProposals).where(eq(schema.stateProposals.sessionId, s))
		expect(proposals.map((p) => p.status)).toEqual(["pending"])
		const zones = await db.select().from(schema.zoneContents).where(eq(schema.zoneContents.sessionId, s))
		expect(zones.map((z) => z.validFromMessageId)).toEqual([m[3]!])
		const [imprint] = await db.select().from(schema.loreImprints).where(eq(schema.loreImprints.sessionId, s))
		expect(imprint).toMatchObject({ status: "settled", before: null })
		expect(await db.select().from(schema.annexDeltas).where(eq(schema.annexDeltas.sessionId, s))).toHaveLength(0)
		expect(await db.select().from(schema.sessionChanges).where(eq(schema.sessionChanges.sessionId, s))).toHaveLength(0)

		expect(await settleTo(s, m[1]!)).toMatchObject({ moved: false, settledMessageId: m[3]! })
		expect(await columnOf(s)).toBe(m[3]!)
	}, 60_000)

	it("refuses Back, retractStateAnchoredTo and retractImprints at or below the line", async () => {
		const { s, m } = await story(6)
		await settleTo(s, m[3]!)
		const { SettledRefusal, SETTLED_SENTENCE } = await import("$lib/server/sessions/settle")
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		const { retractImprints } = await import("$lib/server/lorebooks/imprints")
		const a = await retractStateAnchoredTo(db as any, m[2]!).catch((e) => e)
		expect(a).toBeInstanceOf(SettledRefusal)
		expect(a.message).toBe(SETTLED_SENTENCE)
		const b = await retractImprints(db as any, { messageIds: [m[2]!] }).catch((e) => e)
		expect(b).toBeInstanceOf(SettledRefusal)
		expect(b.message).toBe(SETTLED_SENTENCE)
		const { rewindTurn, REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		// The newest turn (m5, m6) is wholly above the line.
		expect(await rewindTurn(db as any, { sessionId: s, userId: ownerId })).toMatchObject({ ok: true })
		// The next one (m3, m4) reaches the line.
		expect(await rewindTurn(db as any, { sessionId: s, userId: ownerId })).toEqual({ ok: false, error: REWIND_REFUSALS.settled })
	}, 60_000)

	it("never passes the forward stack", async () => {
		const { s, m } = await story(4)
		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		expect(await rewindTurn(db as any, { sessionId: s, userId: ownerId })).toMatchObject({ ok: true })
		const result = await settleTo(s, m[3]!)
		expect(result.settledMessageId).toBe(m[2]! - 1)
		expect(await columnOf(s)).toBe(m[2]! - 1)
	}, 60_000)

	it("an applied scene summary holds the line", async () => {
		const { s, m } = await story(6)
		const [book] = await db.insert(schema.lorebooks).values({ name: "Settle Scene Book", userId: ownerId }).returning()
		const [entry] = await db
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: book!.id, year: 5, month: 1, day: 2 }]))
			.returning()
		const { settledLineOf } = await import("$lib/server/sessions/settle")
		expect(await settledLineOf(db as any, s)).toBeNull()
		await db.insert(schema.scenes).values({
			sessionId: s,
			lorebookId: book!.id,
			historyEntryId: entry!.id,
			selectedMessageIds: [m[0]!, m[1]!],
			openedAtMessageId: m[0]!,
			closedAtMessageId: m[3]!,
			summaryStatus: "done"
		} as any)
		expect(await settledLineOf(db as any, s)).toBe(m[3]!)
	}, 60_000)

	it("on-write: Back is refused with the genre's sentence and each line settles as it lands", async () => {
		const { genre } = await import("@serene-pub/sdk")
		genre("test.settle:genre/every-turn", { name: "Every turn", history: { settle: "on-write" } } as any)
		const { s, m } = await story(4, { genreId: "test.settle:genre/every-turn" })
		const { sessionHistorySettle, settleOnWrite } = await import("$lib/server/sessions/settle")
		expect(await sessionHistorySettle(db as any, s)).toBe("on-write")
		await settleOnWrite(db as any, { sessionId: s, messageId: m[3]!, userId: ownerId })
		expect(await columnOf(s)).toBe(m[3]!)
		const { rewindTurn, REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		expect(await rewindTurn(db as any, { sessionId: s, userId: ownerId })).toEqual({ ok: false, error: REWIND_REFUSALS.everyTurnKept })
	}, 60_000)

	it("a person's edit marks the field's standing imprints kept", async () => {
		const { s, m } = await story(2)
		const [book] = await db.insert(schema.lorebooks).values({ name: "Settle Edit Book", userId: ownerId }).returning()
		const imprint = (field: string | null) => ({
			sessionId: s,
			messageId: m[1]!,
			lorebookId: book!.id,
			subjectKind: "entry",
			subjectId: 77,
			field,
			status: "standing"
		})
		await db.insert(schema.loreImprints).values([imprint("title"), imprint("fields.mood"), imprint(null)] as any)
		const { markImprintsKept } = await import("$lib/server/lorebooks/imprints")
		expect(await markImprintsKept(db as any, { subjectKind: "entry", subjectId: 77, fields: [] })).toBe(0)
		expect(await markImprintsKept(db as any, { subjectKind: "entry", subjectId: 77, fields: ["title"] })).toBe(2)
		const rows = await db.select().from(schema.loreImprints).where(eq(schema.loreImprints.sessionId, s)).orderBy(asc(schema.loreImprints.id))
		expect(rows.map((r) => [r.field, r.status])).toEqual([["title", "kept"], ["fields.mood", "standing"], [null, "kept"]])
	}, 60_000)
})
