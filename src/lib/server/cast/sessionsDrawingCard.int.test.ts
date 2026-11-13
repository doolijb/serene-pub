/**
 * 🚧 `sessionsDrawingCard` over a real database (plan §27 S2b): the sessions
 * where a seat seats a member the session's reading draws with a card through
 * a cast amendment.
 *
 * Owner ruling 2026-11-05: "Everything in session is cast -> active card."
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"
import {
	ensureCardVersion,
	insertCastMember,
	insertCharacterVersions,
	isBaseVersion,
	nextWriteOrder
} from "$lib/server/characters/versions"
import { sessionsDrawingCard } from "./seatedCast"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-sessionsDrawingCard-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function setup() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: uniq("sdc-user") })
		.returning()
	const mk = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user!.id, name: uniq(name), description: "" })
				.returning()
		)[0]!
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: uniq("Book") } as any)
		.returning()
	return { user: user!, mk, book: book! }
}

type World = Awaited<ReturnType<typeof setup>>

async function member(w: World, linked: number | null) {
	const { member: row } = await insertCastMember(db(), {
		lorebookId: w.book.id,
		characterId: linked,
		binding: `{{char:${++n}}}`,
		name: uniq("member")
	})
	return row
}

/**
 * From `year` the member is drawn with `cardId`: a dated copy of its base on
 * that card's current version (what the reading folds and the candidate query
 * joins).
 */
async function dateCard(_w: World, memberId: number, cardId: number, year = 20) {
	const [base] = (
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, memberId))
	).filter(isBaseVersion)
	const { id: _id, ...rest } = base!
	await insertCharacterVersions(db(), [
		{
			...rest,
			parentVersionId: (await ensureCardVersion(db(), cardId))!.id,
			year,
			writeOrder: await nextWriteOrder(db())
		}
	])
}

async function session(w: World, clockYear: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: w.user.id,
			isGroup: false,
			name: uniq("Run"),
			lorebookId: w.book.id,
			storyClockYear: clockYear
		} as any)
		.returning()
	return row!
}

describe("sessionsDrawingCard", () => {
	test("a character seat's member drawn by the card at the session's clock; not before", async () => {
		const w = await setup()
		const A = await w.mk("A")
		const B = await w.mk("B")
		const m = await member(w, A.id)
		await dateCard(w, m.id, B.id)
		const late = await session(w, 30)
		const early = await session(w, 10)
		for (const s of [late, early])
			await testDb.insert(schema.sessionCharacters).values({
				sessionId: s.id,
				characterId: A.id,
				castMemberId: m.id
			} as any)
		expect(await sessionsDrawingCard(db(), B.id)).toEqual([late.id])
		// Only among the ids given.
		expect(await sessionsDrawingCard(db(), B.id, [early.id])).toEqual([])
		expect(
			await sessionsDrawingCard(db(), B.id, [early.id, late.id])
		).toEqual([late.id])
		expect(await sessionsDrawingCard(db(), B.id, [])).toEqual([])
		// The held card is the callers' own ground, not this one's.
		expect(await sessionsDrawingCard(db(), A.id)).toEqual([])
	})

	test("a player seat's member counts, and a departed seat still does", async () => {
		const w = await setup()
		const P = await w.mk("P")
		const B = await w.mk("B")
		const m = await member(w, P.id)
		await dateCard(w, m.id, B.id)
		const s = await session(w, 25)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: P.id,
			castMemberId: m.id,
			removedAt: new Date()
		} as any)
		expect(await sessionsDrawingCard(db(), B.id)).toEqual([s.id])
	})

	test("a dated card another card names, and a seat whose member has no amendment, are not drawn by it", async () => {
		const w = await setup()
		const A = await w.mk("A")
		const B = await w.mk("B")
		const C = await w.mk("C")
		const m = await member(w, A.id)
		const plain = await member(w, B.id)
		await dateCard(w, m.id, C.id)
		const s = await session(w, 30)
		await testDb.insert(schema.sessionCharacters).values([
			{ sessionId: s.id, characterId: A.id, castMemberId: m.id },
			{ sessionId: s.id, characterId: B.id, castMemberId: plain.id }
		] as any)
		expect(await sessionsDrawingCard(db(), B.id)).toEqual([])
		expect(await sessionsDrawingCard(db(), C.id)).toEqual([s.id])
	})
})
