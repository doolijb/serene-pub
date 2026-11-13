/**
 * 🚧 `core:outlet/set-seat-bench@1` (owner 2026-11-10: "seat to benched is
 * something managed by the genre/pipelines, not automatically by core"):
 * refused unless the genre declares `writes.seats: true`; benches through
 * `setSeatBench`, the one writer; tied to the turn that did it, so Back,
 * regenerate and delete put the seat back; a person's later bench or drag
 * always wins over the undo.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
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

const activeOf = async (w: World, kind: "character" | "player" = "character") =>
	(
		await db
			.select({ a: kind === "character" ? schema.sessionCharacters.isActive : schema.sessionPersonas.isActive })
			.from(kind === "character" ? schema.sessionCharacters : schema.sessionPersonas)
			.where(eq(kind === "character" ? schema.sessionCharacters.id : schema.sessionPersonas.id, kind === "character" ? w.seatId : w.playerSeatId))
	)[0]!.a

/** The seat bench imprints still standing (`session_imprints`), oldest first, as `{ messageId, key, before, after }`. */
const benchesOf = async (w: World) =>
	(
		await db
			.select()
			.from(schema.sessionImprints)
			.where(
				and(
					eq(schema.sessionImprints.sessionId, w.sessionId),
					eq(schema.sessionImprints.subjectKind, "seat-bench")
				)
			)
			.orderBy(schema.sessionImprints.id)
	).map((r) => ({
		messageId: r.messageId,
		key: r.subjectKey,
		before: (r.before as { v: unknown } | null)?.v,
		after: (r.after as { v: unknown } | null)?.v
	}))

const personBenches = async (w: World, benched: boolean) => {
	const { setSeatBench } = await import("$lib/server/sessions/seats")
	return setSeatBench(db as never, {
		sessionId: w.sessionId,
		kind: "character",
		seatId: w.seatId,
		benched
	})
}

const rewind = async (w: World) => {
	const { rewindTurn } = await import("$lib/server/sessions/rewind")
	return rewindTurn(db as unknown as Db, { sessionId: w.sessionId, userId })
}
const forward = async (w: World) => {
	const { forwardTurn } = await import("$lib/server/sessions/rewind")
	return forwardTurn(db as unknown as Db, { sessionId: w.sessionId, userId })
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-set-seat-bench-")
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

describe("set-seat-bench@1", () => {
	it("refuses without writes.seats: the seat stays in play, nothing is recorded", async () => {
		const w = await world("test:genre/seats-off")
		const out = await bench(w, `character:${characterId}`, true)
		expect(out.halt).toBe(
			"This session's genre ('Seats off') does not bench or bring back seats."
		)
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
		const bare = await world("test:genre/unregistered")
		expect((await bench(bare, `character:${characterId}`, true)).halt).toBe(
			"This session's genre ('none') does not bench or bring back seats."
		)
		expect(await activeOf(bare)).toBe(true)
	}, 60_000)

	it("benches a character seat and a player seat, tied to the turn, and announces it", async () => {
		const w = await world("test:genre/seats-on")
		const out = await bench(w, `character:${characterId}`, true)
		expect(out).toMatchObject({ written: true, sessionId: w.sessionId })
		expect(await activeOf(w)).toBe(false)
		expect(await benchesOf(w)).toEqual([
			{ messageId: w.reply, key: `character:${w.seatId}`, before: false, after: true }
		])
		const { settleSessionEvents } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await settleSessionEvents()
		const changes = (
			await db
				.select()
				.from(schema.sessionChanges)
				.where(eq(schema.sessionChanges.sessionId, w.sessionId))
		).filter((c) => c.event === sessionEvents.castChanged)
		expect(changes).toHaveLength(1)
		expect(changes[0]!.payload).toMatchObject({
			ref: out.seat,
			change: "enabled",
			value: false
		})
		const player = await bench(w, `player-seat:${w.playerSeatId}`, true)
		expect(player).toMatchObject({ written: true })
		expect(await activeOf(w, "player")).toBe(false)
	}, 60_000)

	it("Back unbenches and Forward re-benches", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		expect(await rewind(w)).toMatchObject({ ok: true })
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
		expect(await forward(w)).toMatchObject({ ok: true })
		expect(await activeOf(w)).toBe(false)
		expect(await benchesOf(w)).toHaveLength(1)
	}, 60_000)

	it("a person's later drag survives Back, and Forward does not re-bench", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		expect(await personBenches(w, false)).toMatchObject({ ok: true })
		expect(await activeOf(w)).toBe(true)
		expect(await rewind(w)).toMatchObject({ ok: true })
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
		expect(await forward(w)).toMatchObject({ ok: true })
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
	}, 60_000)

	it("regenerate takes it: back in play, record gone", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		const out = await retractStateAnchoredTo(db as never, w.reply, "replaced")
		expect(out.changed).toBe(true)
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
	}, 60_000)

	it("with no turn message it is untied: benched, no record, a retract leaves it benched", async () => {
		const w = await world("test:genre/seats-on")
		const out = await bench(w, `character:${characterId}`, true, { turn: false })
		expect(out).toMatchObject({ written: true })
		expect(await activeOf(w)).toBe(false)
		expect(await benchesOf(w)).toEqual([])
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(db as never, w.reply, "replaced")
		expect(await activeOf(w)).toBe(false)
	}, 60_000)

	it("deleting the turn's message puts the seat back", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(db as never, w.reply)
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
	}, 60_000)
	it("deleteLegacy hands back the move", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		const { deleteLegacy } = await import("$lib/server/messages/store")
		const seatChanges: unknown[] = []
		await deleteLegacy(db as never, w.reply, { seatChanges: seatChanges as never })
		expect(seatChanges).toHaveLength(1)
		expect(seatChanges[0]).toMatchObject({
			kind: "character",
			change: "enabled",
			seatId: w.seatId,
			value: true
		})
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
	}, 60_000)

	const castChangedOf = async (w: World) =>
		(
			await db
				.select()
				.from(schema.sessionChanges)
				.where(eq(schema.sessionChanges.sessionId, w.sessionId))
		).filter((c) => c.event === sessionEvents.castChanged)

	it("deleting the turn unbenches it and announces cast-changed", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		const { settleSessionEvents } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await settleSessionEvents()
		const before = (await castChangedOf(w)).length
		const { deleteTurnYield } = await import("$lib/server/sessions/retakeTurn")
		const turn = {
			runId: 0,
			runUuid: "x",
			specSlug: "x",
			rows: [
				{ messageId: w.reply, channel: "main", role: "assistant", characterId: null, name: "x" }
			],
			runs: []
		} as never
		const out = await deleteTurnYield(db as unknown as Db, {
			sessionId: w.sessionId,
			userId,
			turn,
			io: stubIo
		})
		expect(out).toMatchObject({ ok: true })
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
		await settleSessionEvents()
		const after = await castChangedOf(w)
		expect(after).toHaveLength(before + 1)
		expect(after[after.length - 1]!.payload).toMatchObject({ change: "enabled", value: true })
	}, 60_000)

	it("the host deletion outlet announces the seat's return too", async () => {
		const w = await world("test:genre/seats-on")
		await bench(w, `character:${characterId}`, true)
		const { settleSessionEvents } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await settleSessionEvents()
		const before = (await castChangedOf(w)).length
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as never, {
			sessionId: w.sessionId,
			userId,
			runId: `bench-run-${++n}`,
			io: stubIo
		} as never)
		const DELETE_NODE = {
			key: "del",
			definitionId: "core:outlet/delete-message",
			definitionVersion: 1
		} as never
		await host.commit!({ target: w.reply }, DELETE_NODE)
		expect(await activeOf(w)).toBe(true)
		expect(await benchesOf(w)).toEqual([])
		await settleSessionEvents()
		const after = await castChangedOf(w)
		expect(after).toHaveLength(before + 1)
		expect(after[after.length - 1]!.payload).toMatchObject({ change: "enabled", value: true })
	}, 60_000)
})
