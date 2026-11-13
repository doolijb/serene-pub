/**
 * 🚧 A branch carries its ancestry, the mark of the fork, the origin of every
 * copied line and — ★CV-14 — its parent's people (plan §32 §5a–§5d, §33.4).
 *
 * Claims: a branch's `branch_ancestry` is `[{ parent, mark }]` with the mark at
 * or above every write order drawn before the fork and below any drawn after;
 * a grandchild's is `[{ child, m2 }, { parent, m1 }]`; the branch rides the
 * parent's line (`line_on_first_write`) when the parent reads a book; every
 * copied line names where it was first played; a seat of the parent whose
 * member lives in the parent's own book is the branch's seat's member too;
 * `findSeatMembers` reads the parent's own book only through the cut; and a
 * branch's character seat keeps the parent seat's seater.
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
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { findSeatMembers, seatBookOf, seatCast } from "./seats"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cv-time-branch-ancestry-")
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
	return createTestUser(testDb, uniq("cv-time-ancestry"))
}

async function session(userId: number, withBook: boolean) {
	let lorebookId: number | null = null
	if (withBook) {
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId, name: uniq("Book") })
			.returning()
		lorebookId = book!.id
	}
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run"), lorebookId })
		.returning()
	return row!
}

/** The session's own book (`lorebooks.session_id`), made directly. */
async function ownBook(userId: number, sessionId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Notes"), sessionId })
		.returning()
	return book!
}

async function speak(userId: number, sessionId: number, contents: string[]) {
	return insertLegacyMany(
		testDb,
		contents.map((content) => ({
			sessionId,
			userId,
			characterId: null,
			personaId: null,
			role: "user",
			content
		}))
	)
}

const linesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

async function branchOf(sessionId: number, fromMessageId: number) {
	const { branchSession } = await import("$lib/server/sessions/branch")
	return branchSession(asDb(testDb), { sessionId, fromMessageId })
}

const writeOrdersOf = async (memberId: number) =>
	(
		await testDb
			.select({ writeOrder: schema.characterVersions.writeOrder })
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, memberId))
	).map((r) => Number(r.writeOrder))

describe("a branch carries its ancestry", () => {
	it("a branch of a session on a book: [{ parent, mark }] with the mark between the cast versions written before and after the fork; it rides the parent's line", async () => {
		const u = await user()
		const s = await session(u.id, true)
		const { card: before } = await inTx((tx) =>
			insertCard(tx, { userId: u.id, name: "Before", description: "" })
		)
		const { member: early } = await inTx((tx) =>
			insertCastMember(tx, {
				lorebookId: s.lorebookId!,
				binding: uniq("{{char:early}}"),
				characterId: before.id,
				name: "Early"
			})
		)
		const [m1, m2] = await speak(u.id, s.id, ["one", "two", "three"])

		const branch = await branchOf(s.id, m2!.id)

		const { card: after } = await inTx((tx) =>
			insertCard(tx, { userId: u.id, name: "After", description: "" })
		)
		const { member: late } = await inTx((tx) =>
			insertCastMember(tx, {
				lorebookId: s.lorebookId!,
				binding: uniq("{{char:late}}"),
				characterId: after.id,
				name: "Late"
			})
		)

		const row = await sessionRow(branch.id)
		expect(row.branchAncestry).toEqual([
			{ sessionId: s.id, mark: expect.any(Number) }
		])
		const mark = row.branchAncestry![0]!.mark
		for (const order of await writeOrdersOf(early.id))
			expect(order).toBeLessThanOrEqual(mark)
		for (const order of await writeOrdersOf(late.id))
			expect(order).toBeGreaterThan(mark)
		expect(row.lineOnFirstWrite).toBe(true)
		expect(row.lorebookBranchId).toBe(s.lorebookBranchId)

		const copies = await linesOf(branch.id)
		expect(
			copies.map((c) => [c.originSessionId, c.originMessageId])
		).toEqual([
			[s.id, m1!.id],
			[s.id, m2!.id]
		])
	})

	it("a branch of a session with no book does not wait to fork a line", async () => {
		const u = await user()
		const s = await session(u.id, false)
		const [m1] = await speak(u.id, s.id, ["only"])
		const branch = await branchOf(s.id, m1!.id)
		const row = await sessionRow(branch.id)
		expect(row.lineOnFirstWrite).toBe(false)
		expect(row.branchAncestry).toEqual([
			{ sessionId: s.id, mark: expect.any(Number) }
		])
	})

	it("a grandchild: [{ child, m2 }, { parent, m1 }]; copies keep the root play", async () => {
		const u = await user()
		const parent = await session(u.id, true)
		const [p1, p2] = await speak(u.id, parent.id, ["p1", "p2"])
		const child = await branchOf(parent.id, p2!.id)
		const [c1] = await speak(u.id, child.id, ["c1"])
		const grandchild = await branchOf(child.id, c1!.id)

		const childRow = await sessionRow(child.id)
		const grandRow = await sessionRow(grandchild.id)
		const m1 = childRow.branchAncestry![0]!.mark
		expect(grandRow.branchAncestry).toEqual([
			{ sessionId: child.id, mark: expect.any(Number) },
			{ sessionId: parent.id, mark: m1 }
		])
		expect(grandRow.branchAncestry![0]!.mark).toBeGreaterThan(m1)

		const copies = await linesOf(grandchild.id)
		expect(
			copies.map((c) => [c.content, c.originSessionId, c.originMessageId])
		).toEqual([
			["p1", parent.id, p1!.id],
			["p2", parent.id, p2!.id],
			["c1", child.id, c1!.id]
		])
	})
})

describe("★CV-14: a branch's seats point at the parent's own-book people", () => {
	it("the seat's member in the parent's own book is the branch seat's member; the seater comes across", async () => {
		const u = await user()
		const seater = await user()
		const s = await session(u.id, false)
		const own = await ownBook(u.id, s.id)
		const { card } = await inTx((tx) =>
			insertCard(tx, { userId: u.id, name: "Maren", description: "" })
		)
		const { member } = await inTx((tx) =>
			insertCastMember(tx, {
				lorebookId: own.id,
				binding: uniq("{{char:maren}}"),
				characterId: card.id,
				name: "Maren"
			})
		)
		const seated = await inTx((tx) =>
			seatCast(tx, {
				sessionId: s.id,
				cardId: card.id,
				seatedBy: seater.id
			})
		)
		expect(seated).toMatchObject({ ok: true, castMemberId: member.id })
		const [m1] = await speak(u.id, s.id, ["hello"])

		const branch = await branchOf(s.id, m1!.id)
		const [seat] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, branch.id))
		expect(seat!.characterId).toBe(card.id)
		expect(seat!.castMemberId).toBe(member.id)
		expect(seat!.seatedByUserId).toBe(seater.id)
	})

	it("findSeatMembers reads the parent's own book through the cut: made before the fork found, made after it not", async () => {
		const u = await user()
		const s = await session(u.id, false)
		const own = await ownBook(u.id, s.id)
		const { card: c1 } = await inTx((tx) =>
			insertCard(tx, { userId: u.id, name: "Early", description: "" })
		)
		const { member: early } = await inTx((tx) =>
			insertCastMember(tx, {
				lorebookId: own.id,
				binding: uniq("{{char:early}}"),
				characterId: c1.id,
				name: "Early"
			})
		)
		const [m1] = await speak(u.id, s.id, ["go"])
		const branch = await branchOf(s.id, m1!.id)
		const { card: c2 } = await inTx((tx) =>
			insertCard(tx, { userId: u.id, name: "Late", description: "" })
		)
		await inTx((tx) =>
			insertCastMember(tx, {
				lorebookId: own.id,
				binding: uniq("{{char:late}}"),
				characterId: c2.id,
				name: "Late"
			})
		)

		const found = await inTx(async (tx) => {
			const book = await seatBookOf(tx, branch.id)
			expect(book!.ancestorBooks).toEqual([
				{ lorebookId: own.id, mark: expect.any(Number) }
			])
			return findSeatMembers(tx, book!, [c1.id, c2.id])
		})
		expect(found.get(c1.id)).toEqual({
			memberId: early.id,
			lorebookId: own.id
		})
		expect(found.has(c2.id)).toBe(false)
	})
})
