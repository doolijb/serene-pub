/**
 * 🚧 Back and Forward announce the seats they move (benched seats, L4): a turn
 * whose `set-seat-bench` benched a seat, then `rewindTurn` / `forwardTurn` with an
 * `io` say `cast-changed` `enabled` (true on Back, false on Forward) to the ledger.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { sessionEvents } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** The shapes the test genres declare; `getSessionGenre` answers from here. */
const GENRES: Record<string, { name: string; shape: unknown }> = {
	"test:genre/seats-on": { name: "Seats on", shape: { writes: { seats: true } } },
	"test:genre/seats-off": { name: "Seats off", shape: { writes: { lore: true } } }
}
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/pipelines/entities/sessionGenres")
		>()
	return {
		...real,
		getSessionGenre: async (_db: unknown, id: string) => {
			const g = GENRES[id]
			return g ? { genreId: id, ...g } : null
		}
	}
})

const BENCH = {
	key: "bench",
	definitionId: "core:outlet/set-seat-bench",
	definitionVersion: 1
} as never
const stubIo = { to: () => ({ emit() {} }), emit() {} } as never

let n = 0
let userId: number
let characterId: number
let personaId: number

interface World {
	sessionId: number
	seatId: number
	playerSeatId: number
	userLine: number
	reply: number
}

async function world(genreId: string): Promise<World> {
	const k = ++n
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `bench ${k}`, genreId } as never)
		.returning()
	const [seat] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session!.id, characterId, isActive: true })
		.returning()
	const [player] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, personaId, userId, isActive: true } as never)
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const userLine = await insertLegacy(db as unknown as Db, {
		sessionId: session!.id,
		userId,
		role: "user",
		content: "hello",
		channel: "main"
	} as never)
	const reply = await insertLegacy(db as unknown as Db, {
		sessionId: session!.id,
		role: "assistant",
		content: "…",
		channel: "main"
	} as never)
	return {
		sessionId: session!.id,
		seatId: seat!.id,
		playerSeatId: player!.id,
		userLine: (userLine as { id: number }).id,
		reply: (reply as { id: number }).id
	}
}

/** One run of the outlet; `turn` ties it to a message (the run's turn message). */
async function bench(
	w: World,
	seat: string,
	benched: boolean,
	opts: { turn?: boolean; io?: boolean } = {}
) {
	const runId = `bench-run-${++n}`
	if (opts.turn !== false) {
		const { noteTurnMessage } = await import(
			"$lib/server/pipelines/runtime/runTurnMessage"
		)
		noteTurnMessage(runId, w.reply)
	}
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db as never, {
		sessionId: w.sessionId,
		userId,
		runId,
		...(opts.io === false ? {} : { io: stubIo })
	} as never)
	return (await host.commit!({ seat, benched }, BENCH)) as Record<
		string,
		unknown
	>
}

const rewind = async (w: World, io = true) => {
	const { rewindTurn } = await import("$lib/server/sessions/rewind")
	return rewindTurn(db as unknown as Db, { sessionId: w.sessionId, userId, ...(io ? { io: stubIo } : {}) })
}
const forward = async (w: World, io = true) => {
	const { forwardTurn } = await import("$lib/server/sessions/rewind")
	return forwardTurn(db as unknown as Db, { sessionId: w.sessionId, userId, ...(io ? { io: stubIo } : {}) })
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-set-seat-bench-announce-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "bench-owner")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character!.id
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId, name: "Bram", description: "", isPersona: true, aliases: [] } as never)
		.returning()
	personaId = persona!.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The `cast-changed` `enabled` values in the ledger of a session, oldest first. */
const enabledValues = async (w: World) => {
	const { settleSessionEvents } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	await settleSessionEvents()
	return (
		await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, w.sessionId))
			.orderBy(asc(schema.sessionChanges.id))
	)
		.filter(
			(c) =>
				c.event === sessionEvents.castChanged &&
				(c.payload as { change?: string }).change === "enabled"
		)
		.map((c) => (c.payload as { value: boolean }).value)
}

describe("Back and Forward announce the bench", () => {
	it("Back says the seat is back in play, Forward says it is benched again", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		expect(await enabledValues(w)).toEqual([false])
		expect(await rewind(w)).toMatchObject({ ok: true })
		expect(await enabledValues(w)).toEqual([false, true])
		expect(await forward(w)).toMatchObject({ ok: true })
		expect(await enabledValues(w)).toEqual([false, true, false])
	}, 60_000)

	it("with no io the seat moves and nothing is announced", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		expect(await rewind(w, false)).toMatchObject({ ok: true })
		expect(await enabledValues(w)).toEqual([false])
	}, 60_000)

	it("regenerate's retraction hands back the seat change", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		const out = await retractStateAnchoredTo(db as never, w.reply, "replaced")
		expect(out.seatChanges).toMatchObject([
			{ kind: "character", change: "enabled", value: true, seatId: w.seatId }
		])
	}, 60_000)
})
