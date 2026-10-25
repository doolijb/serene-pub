/**
 * 🚧 The mirror carries the forward stack (pr-6 lane A5): `messages.rewind_ordinal`
 * is written on every mirror of a legacy row, so the mirror readers test a
 * column (`liveMessageWhere(schema.messages.rewindOrdinal)`) rather than
 * sub-selecting the legacy row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "rewind-mirror-test-secret" }
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-rewind-mirror-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "rewind-mirror-owner")).id
}, 240_000)

afterAll(async () => {
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

async function seat() {
	const [a, b] = await db
		.insert(schema.characters)
		.values(["Ash", "Birch"].map((n) => ({ userId: ownerId, name: `${n} mirror`, description: n, isPersona: false })))
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: true,
			name: "mirror",
			annex: {
				core: {
					turnOrder: {
						v: 1,
						order: [],
						candidates: [a!, b!].map((c, position) => ({ ref: `character:${c.id}`, kind: "character", name: c.name, position })),
						basedOnAt: 1,
						computedAt: 1,
						runId: null,
						event: null,
						strategy: null
					}
				}
			}
		} as any)
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const line = (content: string, who: "me" | typeof a) =>
		insertLegacy(db as any, {
			sessionId: session!.id,
			role: who === "me" ? "user" : "assistant",
			userId: ownerId,
			characterId: who === "me" ? null : who!.id,
			content
		} as any)
	const m1 = await line("Hello.", "me")
	const m2 = await line("Ash nods.", a!)
	const m3 = await line("Shall we go?", "me")
	const m4 = await line("Ash stands.", a!)
	return { session: session!, ids: [m1.id, m2.id, m3.id, m4.id] as const }
}

const ordinals = async (table: "messages" | "sessionMessages", ids: readonly number[]) => {
	const t = schema[table]
	const rows = await db
		.select({ id: t.id, o: t.rewindOrdinal })
		.from(t)
		.where(inArray(t.id, [...ids]))
	return Object.fromEntries(rows.map((r) => [r.id, r.o]))
}

describe("🚧 the mirror's rewind column", () => {
	it("is written with the legacy row on Back and cleared on Forward", async () => {
		const { session, ids } = await seat()
		const [m1, m2, m3, m4] = ids
		const { rewindTurn, forwardTurn } = await import("$lib/server/sessions/rewind")
		expect(await rewindTurn(db as any, { sessionId: session.id, userId: ownerId })).toMatchObject({ ok: true })
		const legacy = await ordinals("sessionMessages", ids)
		const mirror = await ordinals("messages", ids)
		expect(legacy[m3]).not.toBeNull()
		expect(legacy[m4]).not.toBeNull()
		expect(mirror[m3]).toBe(legacy[m3])
		expect(mirror[m4]).toBe(legacy[m4])
		expect(mirror[m1]).toBeNull()
		expect(mirror[m2]).toBeNull()
		expect(await forwardTurn(db as any, { sessionId: session.id, userId: ownerId })).toMatchObject({ ok: true })
		for (const table of ["sessionMessages", "messages"] as const) {
			expect(Object.values(await ordinals(table, ids)).every((o) => o === null)).toBe(true)
		}
	}, 60_000)

	it("is what the mirror readers test: newest message and round skip a rewound turn", async () => {
		const { session, ids } = await seat()
		const m2 = ids[1]
		const { rewindTurn } = await import("$lib/server/sessions/rewind")
		expect(await rewindTurn(db as any, { sessionId: session.id, userId: ownerId })).toMatchObject({ ok: true })
		const { newestMessageId } = await import("$lib/server/state/write")
		const { roundOf } = await import("$lib/server/rulesets/rounds")
		expect(await newestMessageId(db as any, session.id)).toBe(m2)
		expect(await roundOf(db as any, session.id)).toBe(1)
	}, 60_000)
})
