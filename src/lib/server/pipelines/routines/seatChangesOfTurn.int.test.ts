/**
 * 🚧 The seats that changed since the previous turn, a read genres opt into
 * (owner 2026-11-09): `seatChangesOfTurn` over the session's ledger, netted
 * per seat, with seats made by the real writer and the ledger written the real
 * way; and `noteLineLanded` putting the list on `turn-ended` only when the
 * session's genre declares `shape.turnSeatChanges: true`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { sessionEvents } from "@serene-pub/sdk"
import { desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertLegacy } from "$lib/server/messages/store"
import { recordSessionChange } from "$lib/server/messages/sessionChanges"
import {
	announceSeatChanges,
	seatCast,
	seatPlayer,
	setSeatBench,
	unseat,
	type SeatChange
} from "$lib/server/sessions/seats"
import { seatChangesOfTurn, noteLineLanded } from "./moments"
import { STORY_LANE } from "./turnTally"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string
let n = 0

const turnEnded = vi.hoisted(() => [] as Array<Record<string, any>>)
const genre = vi.hoisted(() => ({ turnSeatChanges: false }))

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "seat-changes-turn-secret"
	}
})
// The ledger rows are the real emitter's; only `turn-ended` is captured, not dispatched.
vi.mock(
	"$lib/server/pipelines/runtime/sessionEvents",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("$lib/server/pipelines/runtime/sessionEvents")
			>()
		return {
			...actual,
			emitSessionEvent: async (d: any, opts: any) => {
				if (opts.event === "core:event/turn-ended@1") {
					turnEnded.push(opts.payload)
					return
				}
				return actual.emitSessionEvent(d, opts)
			}
		}
	}
)
vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		getSessionGenre: async () => ({
			shape: genre.turnSeatChanges ? { turnSeatChanges: true } : {}
		})
	})
)
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatturn-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const asDb = (d: unknown) => d as Db
const io = { to: () => ({ emit: () => {} }) } as never

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `seat-turn-${++n}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${n}` } as any)
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${n}`,
			lorebookId: book!.id
		})
		.returning()
	return { userId: user.id, bookId: book!.id, sessionId: session!.id }
}

type World = Awaited<ReturnType<typeof world>>

async function card(w: World, name: string) {
	const [row] = await db
		.insert(schema.characters)
		.values({ userId: w.userId, name, description: "" })
		.returning()
	return row!
}

async function bareMember(w: World, name: string) {
	const { member } = await insertCastMember(db, {
		lorebookId: w.bookId,
		binding: `{{char:${name}-${++n}}}`,
		characterId: null,
		name,
		ownName: name
	})
	return member
}

/** A line lands the real way: the row, then its `message-completed` on the ledger. */
async function land(w: World, channel = "main") {
	const row = await insertLegacy(asDb(db), {
		sessionId: w.sessionId,
		role: "assistant",
		userId: w.userId,
		content: `Line ${++n}`,
		channel
	} as any)
	await recordSessionChange(asDb(db), {
		event: sessionEvents.messageCompleted,
		sessionId: w.sessionId,
		messageId: row.id
	} as any)
	return row.id
}

const announce = (w: World, changes: readonly SeatChange[]) =>
	announceSeatChanges(
		asDb(db),
		io,
		{ sessionId: w.sessionId, userId: w.userId },
		changes
	)

async function castCard(w: World, cardId: number) {
	const r = await db.transaction(async (tx) =>
		seatCast(tx as any, {
			sessionId: w.sessionId,
			cardId,
			seatedBy: w.userId
		})
	)
	if (!r.ok) throw new Error("seat refused")
	await announce(w, r.changes)
	return r
}
async function castMember(w: World, castMemberId: number) {
	const r = await db.transaction(async (tx) =>
		seatCast(tx as any, {
			sessionId: w.sessionId,
			castMemberId,
			seatedBy: w.userId
		})
	)
	if (!r.ok) throw new Error("seat refused")
	await announce(w, r.changes)
	return r
}
async function playPersona(
	w: World,
	personaId: number | null,
	seatName?: string
) {
	const r = await db.transaction(async (tx) =>
		seatPlayer(tx as any, {
			sessionId: w.sessionId,
			personaId,
			userId: w.userId,
			...(seatName ? { seatName } : {})
		})
	)
	await announce(w, r.changes)
	return r
}
async function leave(w: World, kind: "character" | "player", seatId: number) {
	// Removing benches first; a benched seat with no lines is then removed.
	const remove = () =>
		db.transaction(async (tx) =>
			unseat(tx as any, {
				sessionId: w.sessionId,
				kind,
				seatId,
				removedName: "Gone"
			})
		)
	await remove()
	await announce(w, await remove())
}

const turnOf = (w: World, messageId: number, lane = STORY_LANE) =>
	seatChangesOfTurn(asDb(db), { sessionId: w.sessionId, messageId, lane })

describe("seatChangesOfTurn", () => {
	it("is exactly the seats added, removed and benched since the previous turn, card and card-less, character and player", async () => {
		const w = await world()
		const a = await castCard(w, (await card(w, "Ada")).id)
		const b = await castMember(w, (await bareMember(w, "Bram")).id)
		await land(w)
		await land(w) // the window for the turn under test starts after this line

		const c = await playPersona(w, null, "Stranger")
		const d = await playPersona(w, (await card(w, "Dee")).id)
		const e = await castMember(w, (await bareMember(w, "Eli")).id)
		await leave(w, "character", a.seatId)
		await db.transaction(async (tx) =>
			setSeatBench(tx as any, {
				sessionId: w.sessionId,
				kind: "character",
				seatId: b.seatId,
				benched: true
			})
		)
		await recordSessionChange(asDb(db), {
			event: sessionEvents.castChanged,
			sessionId: w.sessionId,
			ref: `seated-member:${b.castMemberId}`,
			change: "enabled",
			value: false
		} as any)
		const turn2 = await land(w)

		expect(await turnOf(w, turn2)).toEqual([
			{
				ref: `player-seat:${c.seatId}`,
				seatKind: "player",
				castMemberId: c.castMemberId,
				change: "added"
			},
			{
				ref: `player-seat:${d.seatId}`,
				seatKind: "player",
				castMemberId: d.castMemberId,
				change: "added"
			},
			{
				ref: `seated-member:${e.castMemberId}`,
				seatKind: "character",
				castMemberId: e.castMemberId,
				change: "added"
			},
			{
				ref: `seated-member:${a.castMemberId}`,
				seatKind: "character",
				castMemberId: a.castMemberId,
				change: "removed"
			},
			{
				ref: `seated-member:${b.castMemberId}`,
				seatKind: "character",
				castMemberId: b.castMemberId,
				change: "changed"
			}
		])
		expect(c.castMemberId).toBeNull()
		expect(d.castMemberId).not.toBeNull()

		// Turn 3, nothing in between.
		expect(await turnOf(w, await land(w))).toEqual([])
	})

	it("an add then a remove of one seat inside a turn is absent; a reorder alone is absent", async () => {
		const w = await world()
		const kept = await castMember(w, (await bareMember(w, "Kit")).id)
		await land(w)
		const f = await castMember(w, (await bareMember(w, "Fen")).id)
		await leave(w, "character", f.seatId)
		await recordSessionChange(asDb(db), {
			event: sessionEvents.castChanged,
			sessionId: w.sessionId,
			ref: `seated-member:${kept.castMemberId}`,
			change: "position",
			value: 3
		} as any)
		expect(await turnOf(w, await land(w))).toEqual([])
	})

	it("a previous line with no landing on the ledger: the window starts at the ledger as it stood when that line was written", async () => {
		const w = await world()
		await castMember(w, (await bareMember(w, "Hal")).id)
		// A line from before the ledger: no `message-completed` row of its own.
		const old = await insertLegacy(asDb(db), {
			sessionId: w.sessionId,
			role: "assistant",
			userId: w.userId,
			content: "An old line",
			channel: "main"
		} as any)
		const [last] = await db
			.select({ at: schema.sessionChanges.at })
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, w.sessionId))
			.orderBy(desc(schema.sessionChanges.id))
			.limit(1)
		await db
			.update(schema.sessionMessages)
			.set({ createdAt: last!.at })
			.where(eq(schema.sessionMessages.id, old.id))
		const i = await castMember(w, (await bareMember(w, "Ivo")).id)
		expect(await turnOf(w, await land(w))).toEqual([
			{
				ref: `seated-member:${i.castMemberId}`,
				seatKind: "character",
				castMemberId: i.castMemberId,
				change: "added"
			}
		])
	})

	it("a line on another lane does not end the story lane's window", async () => {
		const w = await world()
		await land(w)
		const g = await castMember(w, (await bareMember(w, "Gus")).id)
		await land(w, "side")
		expect(await turnOf(w, await land(w))).toEqual([
			{
				ref: `seated-member:${g.castMemberId}`,
				seatKind: "character",
				castMemberId: g.castMemberId,
				change: "added"
			}
		])
	})
})

describe("turn-ended carries turnSeatChanges only when the genre opts in", () => {
	it("not opted in: no turnSeatChanges key; opted in: the list, [] when nothing changed", async () => {
		const w = await world()
		await land(w)
		await castMember(w, (await bareMember(w, "Hal")).id)
		const at = { sessionId: w.sessionId, userId: w.userId }

		genre.turnSeatChanges = false
		turnEnded.length = 0
		await noteLineLanded(asDb(db), { ...at, messageId: await land(w) })
		expect(turnEnded).toHaveLength(1)
		expect("turnSeatChanges" in turnEnded[0]!).toBe(false)

		genre.turnSeatChanges = true
		turnEnded.length = 0
		await castMember(w, (await bareMember(w, "Ivy")).id)
		await noteLineLanded(asDb(db), { ...at, messageId: await land(w) })
		expect(turnEnded[0]!.turnSeatChanges).toEqual([
			expect.objectContaining({ seatKind: "character", change: "added" })
		])

		turnEnded.length = 0
		await noteLineLanded(asDb(db), { ...at, messageId: await land(w) })
		expect(turnEnded[0]!.turnSeatChanges).toEqual([])
		genre.turnSeatChanges = false
	})
})
