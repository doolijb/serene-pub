/**
 * 🚧 A branch's copied lines name their speakers' members (plan §27, S2, the
 * speaker stamp): the branch seats its cast through the one seat writer
 * without members, `settleSeats` fills them, and each copy then takes the
 * member of the branch's seat its card holds.
 *
 * Claims: on a session reading a book its owner owns, every copied line a
 * seated card spoke (a character's, a persona's) carries that seat's member
 * and a narrator's line stays unstamped; a copy never keeps its original's
 * member — each reads the seat of the branch, so a source that had two live
 * seats on one member gives each line the member of its own card's seat.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacyMany } from "$lib/server/messages/store"
import { seatCast, seatOf, seatPlayer } from "./seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-branch-seat-members-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = (tx: unknown) => tx as Db
const inTx = <T>(fn: (tx: Db) => Promise<T>) =>
	testDb.transaction(async (tx) => fn(asDb(tx)))

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, uniq("branch-seat-members"))
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	return row!
}

/** A session reading a book its owner owns. */
async function sessionOnBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: book!.id
		})
		.returning()
	return row!
}

type Line = { characterId?: number; personaId?: number; content: string }

/** The lines, written as the real writer writes them; returns the last, to fork at. */
async function speak(userId: number, sessionId: number, lines: Line[]) {
	const rows = await insertLegacyMany(
		testDb,
		lines.map((l) => ({
			sessionId,
			userId,
			characterId: l.characterId ?? null,
			personaId: l.personaId ?? null,
			role: l.characterId != null ? "assistant" : "user",
			content: l.content
		}))
	)
	return rows[rows.length - 1]!
}

const linesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

const charSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.position))

async function branchOf(sessionId: number, fromMessageId: number) {
	const { branchSession } = await import("$lib/server/sessions/branch")
	return branchSession(asDb(testDb), { sessionId, fromMessageId })
}

describe("a branch's copied lines name their speakers' members", () => {
	it("two character seats and a persona seat: each copy carries its seat's member, narration none", async () => {
		const u = await user()
		const maren = await card(u.id, "Maren")
		const tess = await card(u.id, "Tess")
		const wren = await card(u.id, "Wren")
		const s = await sessionOnBook(u.id)
		await inTx(async (tx) => {
			await seatCast(tx, {
				sessionId: s.id,
				cardId: maren.id,
				position: 0
			})
			await seatCast(tx, {
				sessionId: s.id,
				cardId: tess.id,
				position: 1
			})
			await seatPlayer(tx, {
				sessionId: s.id,
				personaId: wren.id,
				position: 0,
				userId: u.id
			})
		})
		const [m1, m2] = await charSeats(s.id)
		const [player] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		expect(m1!.castMemberId).not.toBeNull()
		expect(m2!.castMemberId).not.toBeNull()
		expect(player!.castMemberId).not.toBeNull()

		const fork = await speak(u.id, s.id, [
			{ characterId: maren.id, content: "Maren speaks." },
			{ personaId: wren.id, content: "Wren speaks." },
			{ characterId: tess.id, content: "Tess speaks." },
			{ content: "The narrator speaks." },
			{ characterId: maren.id, content: "Maren again." }
		])

		const branch = await branchOf(s.id, fork.id)
		const seats = await charSeats(branch.id)
		expect(seats.map((r) => r.castMemberId)).toEqual([
			m1!.castMemberId,
			m2!.castMemberId
		])
		const [branchPlayer] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, branch.id))
		expect(branchPlayer!.castMemberId).toBe(player!.castMemberId)

		const copies = await linesOf(branch.id)
		expect(copies.map((c) => [c.content, c.castMemberId])).toEqual([
			["Maren speaks.", m1!.castMemberId],
			["Wren speaks.", player!.castMemberId],
			["Tess speaks.", m2!.castMemberId],
			["The narrator speaks.", null],
			["Maren again.", m1!.castMemberId]
		])
	})

	it("a source with two live seats on one member: each copy carries the member of its own card's seat", async () => {
		const u = await user()
		const aria = await card(u.id, "Aria")
		const bram = await card(u.id, "Bram")
		const s = await sessionOnBook(u.id)
		await inTx(async (tx) => {
			await seatCast(tx, {
				sessionId: s.id,
				cardId: aria.id,
				position: 0
			})
			await seatCast(tx, {
				sessionId: s.id,
				cardId: bram.id,
				position: 1
			})
		})
		const [ariaSeat, bramSeat] = await charSeats(s.id)
		expect(ariaSeat!.castMemberId).not.toBe(bramSeat!.castMemberId)
		// The pair a boot has not yet settled: Bram's seat sits on Aria's member.
		await testDb
			.update(schema.sessionCharacters)
			.set({ castMemberId: ariaSeat!.castMemberId })
			.where(eq(schema.sessionCharacters.id, bramSeat!.id))
		const fork = await speak(u.id, s.id, [
			{ characterId: aria.id, content: "Aria speaks." },
			{ characterId: bram.id, content: "Bram speaks." }
		])
		// The source's own stamps follow its seats: both on one member.
		expect((await linesOf(s.id)).map((l) => l.castMemberId)).toEqual([
			ariaSeat!.castMemberId,
			ariaSeat!.castMemberId
		])

		const branch = await branchOf(s.id, fork.id)
		const seats = await charSeats(branch.id)
		const memberOfCard = new Map(
			seats.map((r) => [r.characterId, r.castMemberId])
		)
		expect(memberOfCard.get(aria.id)).toBe(ariaSeat!.castMemberId)
		// ★CV-14: each branch seat takes the member its parent's seat holds, so
		// the pair the source had stays a pair (the boot pass merges it, as in
		// the source); the branch no longer re-resolves Bram's card to a member
		// of its own.
		expect(memberOfCard.get(bram.id)).toBe(ariaSeat!.castMemberId)
		const copies = await linesOf(branch.id)
		expect(copies.map((c) => c.castMemberId)).toEqual([
			(await inTx((tx) => seatOf(tx, branch.id, `character:${aria.id}`)))
				?.castMemberId,
			(await inTx((tx) => seatOf(tx, branch.id, `character:${bram.id}`)))
				?.castMemberId
		])
		expect(copies.map((c) => c.castMemberId)).toEqual([
			memberOfCard.get(aria.id),
			memberOfCard.get(bram.id)
		])
	})
})
