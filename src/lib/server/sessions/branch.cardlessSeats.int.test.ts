/**
 * 🚧 A branch keeps its parent's card-less seats (★s4-fold2-3): a card-less
 * character seat and a card-less player seat come across with the member the
 * parent's seat holds, the seater and the seat name; their copied lines carry
 * the member; a departed row with no card, envoy or member is not copied.
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
import { insertCastMember } from "$lib/server/characters/versions"
import { seatCast, seatPlayer } from "./seats"
import { BranchError } from "./branch"

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
		path.join(os.tmpdir(), "serene-pub-vitest-branch-cardless-seats-")
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
	return createTestUser(testDb, uniq("branch-cardless"))
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

const linesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

describe("a branch keeps card-less seats", () => {
	it("card-less character and player seats, a carded seat, and a departed row", async () => {
		const owner = await user()
		const guest = await user()
		const carded = await card(owner.id, "Maren")
		const s = await sessionOnBook(owner.id)
		const member = async (name: string) =>
			(
				await insertCastMember(testDb, {
					lorebookId: s.lorebookId!,
					binding: `{{char:${name}}}`,
					characterId: null,
					name,
					ownName: name
				} as any)
			).member
		const mira = await member("Mira")
		const nox = await member("Nox")
		await inTx(async (tx) => {
			const a = await seatCast(tx, {
				sessionId: s.id,
				castMemberId: mira.id,
				position: 0,
				seatedBy: guest.id
			})
			expect(a.ok).toBe(true)
			await seatCast(tx, {
				sessionId: s.id,
				cardId: carded.id,
				position: 1
			})
			await seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				castMemberId: nox.id,
				position: 0,
				seatName: "Nox the Ferryman",
				userId: guest.id
			})
		})
		// A departed row: no card, no envoy, no member (and a retired seat).
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			castMemberId: null,
			position: 5,
			removedAt: new Date(),
			removedName: "Gone"
		} as any)

		const [pc] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.castMemberId, mira.id))
		const [pp] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, s.id))
		expect(pc!.seatedByUserId).toBe(guest.id)
		expect(pp!.personaId).toBeNull()

		const rows = await insertLegacyMany(testDb, [
			{
				sessionId: s.id,
				userId: owner.id,
				characterId: null,
				personaId: null,
				role: "assistant",
				content: "Mira speaks.",
				metadata: { speaker: `seated-member:${mira.id}` }
			},
			{
				sessionId: s.id,
				userId: guest.id,
				characterId: null,
				personaId: null,
				role: "user",
				content: "Nox speaks.",
				metadata: { speaker: `player-seat:${pp!.id}` }
			},
			{
				sessionId: s.id,
				userId: owner.id,
				characterId: carded.id,
				personaId: null,
				role: "assistant",
				content: "Maren speaks."
			}
		])
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(asDb(testDb), {
			sessionId: s.id,
			fromMessageId: rows[rows.length - 1]!.id
		})

		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, branch.id))
			.orderBy(asc(schema.sessionCharacters.position))
		expect(seats).toHaveLength(2)
		const [cardless, withCard] = seats
		expect(cardless!.castMemberId).toBe(mira.id)
		expect(cardless!.characterId).toBeNull()
		expect(cardless!.seatedByUserId).toBe(guest.id)
		expect(cardless!.removedAt).toBeNull()
		expect(withCard!.characterId).toBe(carded.id)
		expect(withCard!.castMemberId).not.toBeNull()

		const [bp, ...more] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, branch.id))
		expect(more).toHaveLength(0)
		expect(bp!.castMemberId).toBe(nox.id)
		expect(bp!.personaId).toBeNull()
		expect(bp!.userId).toBe(guest.id)
		expect(bp!.seatName).toBe("Nox the Ferryman")

		const copies = await linesOf(branch.id)
		expect(copies.map((c) => [c.content, c.castMemberId])).toEqual([
			["Mira speaks.", mira.id],
			["Nox speaks.", nox.id],
			["Maren speaks.", withCard!.castMemberId]
		])
	})
})

describe("a branch keeps the bench of a player seat", () => {
	it("a benched player seat comes across benched, an active one active", async () => {
		const owner = await user()
		const s = await sessionOnBook(owner.id)
		const [benched, active] = await inTx(async (tx) => [
			await seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "Ann",
				userId: owner.id,
				position: 0,
				isActive: false
			}),
			await seatPlayer(tx, {
				sessionId: s.id,
				personaId: null,
				seatName: "Bea",
				userId: owner.id,
				position: 1
			})
		])
		const [line] = await insertLegacyMany(testDb, [
			{
				sessionId: s.id,
				userId: owner.id,
				role: "assistant",
				content: "Hello."
			}
		])
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(asDb(testDb), {
			sessionId: s.id,
			fromMessageId: line!.id
		})
		const copies = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, branch.id))
			.orderBy(asc(schema.sessionPersonas.position))
		expect(copies.map((c) => [c.seatName, c.isActive])).toEqual([
			["Ann", false],
			["Bea", true]
		])
		expect(benched!.seatId).not.toBe(active!.seatId)
	})
})

describe("a member that no longer checks out", () => {
	/** A parent seating a member of another user's book, set by direct insert. */
	async function parentWithStranger() {
		const owner = await user()
		const other = await user()
		const s = await sessionOnBook(owner.id)
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: other.id, name: uniq("Stranger book") })
			.returning()
		const stranger = (
			await insertCastMember(testDb, {
				lorebookId: book!.id,
				binding: `{{char:Stranger-${++n}}}`,
				characterId: null,
				name: "Stranger",
				ownName: "Stranger"
			} as any)
		).member
		const rows = await insertLegacyMany(testDb, [
			{
				sessionId: s.id,
				userId: owner.id,
				characterId: null,
				personaId: null,
				role: "assistant",
				content: "Hello."
			}
		])
		return { owner, s, stranger, forkId: rows[0]!.id }
	}
	const branchesOf = (sessionId: number) =>
		testDb
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.branchOfSessionId, sessionId))

	it("a live card-less character seat refuses the branch", async () => {
		const { s, stranger, forkId } = await parentWithStranger()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			castMemberId: stranger.id,
			position: 0
		} as any)
		const { branchSession } = await import("$lib/server/sessions/branch")
		await expect(
			branchSession(asDb(testDb), {
				sessionId: s.id,
				fromMessageId: forkId
			})
		).rejects.toBeInstanceOf(BranchError)
		expect(await branchesOf(s.id)).toHaveLength(0)
	})

	it("a live card-less player seat refuses the branch", async () => {
		const { owner, s, stranger, forkId } = await parentWithStranger()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: null,
			castMemberId: stranger.id,
			position: 0,
			seatName: "Stranger",
			userId: owner.id
		} as any)
		const { branchSession } = await import("$lib/server/sessions/branch")
		await expect(
			branchSession(asDb(testDb), {
				sessionId: s.id,
				fromMessageId: forkId
			})
		).rejects.toBeInstanceOf(BranchError)
		expect(await branchesOf(s.id)).toHaveLength(0)
	})

	it("a retired card-less player seat comes across by name only", async () => {
		const { owner, s, stranger, forkId } = await parentWithStranger()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: null,
			castMemberId: stranger.id,
			position: 0,
			seatName: "Stranger",
			userId: owner.id,
			removedAt: new Date(),
			removedName: "The Stranger"
		} as any)
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(asDb(testDb), {
			sessionId: s.id,
			fromMessageId: forkId
		})
		const [copy, ...more] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, branch.id))
		expect(more).toHaveLength(0)
		expect(copy!.castMemberId).toBeNull()
		expect(copy!.removedAt).not.toBeNull()
		expect(copy!.removedName).toBe("The Stranger")
	})
})
