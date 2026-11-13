/**
 * 🚧 `castMemberCards` reading a cast version's parent card version (plan §31
 * §8): the card of a member's version parent is theirs, ahead of a dated card.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { cardTakenBy, castMemberCards, memberOfCard } from "./castMemberCards"

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
		path.join(os.tmpdir(), "serene-pub-vitest-castMemberCardsVersions-")
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
let order = 0

async function world() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: uniq("cmc-user") })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: uniq("Book") })
		.returning()
	const card = async (name: string) => {
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: user!.id, name, description: "" })
			.returning()
		const [v] = await testDb
			.insert(schema.characterVersions)
			.values({ cardId: c!.id, number: 1, writeOrder: ++order, name })
			.returning()
		return { card: c!, version: v! }
	}
	const member = async (linked: number | null, name: string) => {
		const [m] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book!.id,
				characterId: linked,
				binding: uniq("{{char:x}}"),
				name
			})
			.returning()
		return m!
	}
	const castVersion = async (
		memberId: number,
		parentVersionId: number | null,
		year: number | null = null
	) =>
		(
			await testDb
				.insert(schema.characterVersions)
				.values({
					castMemberId: memberId,
					lorebookId: book!.id,
					parentVersionId,
					year,
					follows: parentVersionId ? ["name"] : [],
					nodeState: "active",
					nodeVisibility: "normal",
					writeOrder: ++order
				})
				.returning()
		)[0]!
	return { user: user!, book: book!, card, member, castVersion }
}

describe("a cast version's parent card is the member's", () => {
	test("cardsOf lists the linked card, then each version parent's card, dated ones included", async () => {
		const w = await world()
		const c1 = await w.card("C1")
		const c2 = await w.card("C2")
		const c3 = await w.card("C3")
		const m = await w.member(c1.card.id, "Verity")
		await w.castVersion(m.id, c1.version.id)
		await w.castVersion(m.id, c2.version.id, 5)
		await w.castVersion(m.id, null, 10)
		// A dated card written as a version: from year 20 she is drawn with C3.
		await w.castVersion(m.id, c3.version.id, 20)

		const { cardsOf, memberOf } = await castMemberCards(db(), w.book.id)
		expect(cardsOf.get(m.id)).toEqual([c1.card.id, c2.card.id, c3.card.id])
		expect(memberOf.get(c2.card.id)).toBe(m.id)
		expect(memberOf.get(c3.card.id)).toBe(m.id)

		expect(await memberOfCard(db(), w.book.id, c2.card.id)).toBe(m.id)
		expect(await memberOfCard(db(), w.book.id, c3.card.id)).toBe(m.id)
		expect(await memberOfCard(db(), w.book.id, 987654)).toBeNull()
	})

	test("a card-less member gets its cards from its versions alone", async () => {
		const w = await world()
		const c = await w.card("Only")
		const m = await w.member(null, "Tom")
		await w.castVersion(m.id, c.version.id)
		const { cardsOf, memberOf } = await castMemberCards(db(), w.book.id)
		expect(cardsOf.get(m.id)).toEqual([c.card.id])
		expect(memberOf.get(c.card.id)).toBe(m.id)
		expect(await memberOfCard(db(), w.book.id, c.card.id)).toBe(m.id)
	})

	test("one card, one member: the link wins over a version parent, then the lowest member id", async () => {
		const w = await world()
		const shared = await w.card("Shared")
		const first = await w.member(null, "First")
		const second = await w.member(null, "Second")
		await w.castVersion(second.id, shared.version.id)
		await w.castVersion(first.id, shared.version.id)
		expect(await memberOfCard(db(), w.book.id, shared.card.id)).toBe(
			first.id
		)
		expect(
			(await castMemberCards(db(), w.book.id)).memberOf.get(
				shared.card.id
			)
		).toBe(first.id)

		const owner = await w.member(shared.card.id, "Owner")
		expect(await memberOfCard(db(), w.book.id, shared.card.id)).toBe(
			owner.id
		)
		expect(
			(await castMemberCards(db(), w.book.id)).memberOf.get(
				shared.card.id
			)
		).toBe(owner.id)
	})

	test("cardTakenBy names the member a version parent gives the card to, and not the asker", async () => {
		const w = await world()
		const c = await w.card("Taken")
		const holder = await w.member(null, "Holder")
		const asker = await w.member(null, "Asker")
		await w.castVersion(holder.id, c.version.id)
		expect(await cardTakenBy(db(), w.book.id, c.card.id, asker.id)).toEqual(
			{
				id: holder.id,
				name: "Holder"
			}
		)
		expect(
			await cardTakenBy(db(), w.book.id, c.card.id, holder.id)
		).toBeNull()
	})

	test("another book's versions do not count", async () => {
		const w = await world()
		const other = await world()
		const c = await w.card("Elsewhere")
		const m = await other.member(null, "Stranger")
		await other.castVersion(m.id, c.version.id)
		expect(await memberOfCard(db(), w.book.id, c.card.id)).toBeNull()
		expect((await castMemberCards(db(), w.book.id)).memberOf.size).toBe(0)
	})
})
