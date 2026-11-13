/**
 * 🚧 The table registry and `character_versions` (plan §32 §1, §8): a book's
 * cast versions copy with it — naming the copy's members, line and history
 * entry, keeping their card parent and their write order, tied to no turn of
 * the source — and purge with it (book delete and the overwrite purge).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import {
	insertCard,
	insertCastMember,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { readingOf } from "$lib/server/state/reading"
import { copyLorebookTables, purgeLorebook } from "./tableRegistry"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-registry-versions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

const versionsOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(
			and(
				eq(schema.characterVersions.lorebookId, lorebookId),
				isNotNull(schema.characterVersions.castMemberId)
			)
		)
		.orderBy(schema.characterVersions.id)

/**
 * A book with a carded member (a base, a version dated on a line by a history
 * entry) and a card-less member (a base, a version a session wrote in play,
 * tied to one of its turns).
 */
async function world() {
	const suffix = `${++n}`
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `rv-${suffix}` })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Source ${suffix}` })
		.returning()
	const [line] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `North ${suffix}`, forkYear: 3 })
		.returning()
	const [chapter] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: book!.id,
					content: "The crowning.",
					year: 5,
					branchId: line!.id
				}
			])
		)
		.returning()
	const { card, version: cardV1 } = await insertCard(db(), {
		userId: user!.id,
		name: `Ada card ${suffix}`,
		description: "The card's description."
	})
	const carded = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:a${suffix}}}`,
		characterId: card.id,
		name: `Ada ${suffix}`
	})
	const cardless = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:b${suffix}}}`,
		characterId: null,
		name: `Brin ${suffix}`,
		description: "Brin's own description."
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user!.id,
			isGroup: false,
			name: `Run ${suffix}`
		} as any)
		.returning()
	const [turn] = await testDb
		.insert(schema.messages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			content: "…"
		} as any)
		.returning()
	const [dated, story] = await insertCharacterVersions(db(), [
		{
			castMemberId: carded.member.id,
			lorebookId: book!.id,
			parentVersionId: cardV1.id,
			follows: ["description"],
			branchId: line!.id,
			year: 5,
			month: 2,
			day: 1,
			historyEntryId: chapter!.id,
			personalPosition: 2,
			name: `Ada the Crowned ${suffix}`,
			aliases: ["the Crowned"],
			nodeState: "deceased",
			nodeVisibility: "normal",
			writtenBy: `user:${user!.id}`
		},
		{
			castMemberId: cardless.member.id,
			lorebookId: book!.id,
			name: `Brin Redcloak ${suffix}`,
			description: "Brin, retold in play.",
			nodeState: "active",
			nodeVisibility: "normal",
			sourceSessionId: session!.id,
			sourceMessageId: turn!.id,
			validFromMessageId: turn!.id,
			writtenBy: `run:${session!.id}`
		}
	])
	return {
		user: user!,
		book: book!,
		line: line!,
		chapter: chapter!,
		cardV1,
		carded,
		cardless,
		dated: dated!,
		story: story!,
		turn: turn!
	}
}

async function duplicate(fromId: number) {
	const [copy] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: await bookUser(fromId), name: `Copy of ${fromId}` })
		.returning()
	const maps = await testDb.transaction((tx) =>
		copyLorebookTables(tx as unknown as Db, fromId, copy!.id)
	)
	return { copy: copy!, maps }
}

async function bookUser(bookId: number) {
	const [row] = await testDb
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, bookId))
	return row!.userId
}

describe("character_versions in the table registry", () => {
	test("a copy's versions name the copy's members, line and history entry, keep the card parent and the write order, and are tied to no turn", async () => {
		const w = await world()
		const before = await versionsOf(w.book.id)
		const { copy, maps } = await duplicate(w.book.id)
		const after = await versionsOf(copy.id)

		expect(before).toHaveLength(4)
		expect(after).toHaveLength(4)

		const memberOf = (id: number) => maps.bindings.get(id)!
		const copyDated = after.find((v) => v.year === 5)!
		expect(copyDated.castMemberId).toBe(memberOf(w.carded.member.id))
		expect(copyDated.branchId).toBe(maps.branches.get(w.line.id))
		expect(copyDated.historyEntryId).toBe(
			maps.historyEntries.get(w.chapter.id)
		)
		expect(copyDated.branchId).not.toBe(w.line.id)
		expect(copyDated.historyEntryId).not.toBe(w.chapter.id)
		// The card version is the card's: shared, not copied.
		expect(copyDated.parentVersionId).toBe(w.cardV1.id)
		expect(copyDated.follows).toEqual(["description"])
		expect(copyDated.name).toBe(w.dated.name)
		expect(copyDated.aliases).toEqual(["the Crowned"])
		expect(copyDated.nodeState).toBe("deceased")
		expect(copyDated.writeOrder).toBe(w.dated.writeOrder)
		expect(copyDated.id).not.toBe(w.dated.id)

		// A version a session wrote keeps its provenance but no turn tie.
		const copyStory = after.find((v) => v.sourceSessionId != null)!
		expect(copyStory.castMemberId).toBe(memberOf(w.cardless.member.id))
		expect(copyStory.sourceSessionId).toBe(w.story.sourceSessionId)
		expect(copyStory.sourceMessageId).toBe(w.story.sourceMessageId)
		expect(copyStory.validFromMessageId).toBeNull()
		expect(copyStory.writeOrder).toBe(w.story.writeOrder)

		// Each base copied as a base, once per member.
		const bases = after.filter(
			(v) =>
				v.branchId == null &&
				v.year == null &&
				v.sourceSessionId == null
		)
		expect(bases.map((b) => b.castMemberId).sort()).toEqual(
			[
				memberOf(w.carded.member.id),
				memberOf(w.cardless.member.id)
			].sort()
		)
		// Same order in the copy as in the source.
		expect(after.map((v) => v.writeOrder)).toEqual(
			before.map((v) => v.writeOrder)
		)

		// The source is untouched.
		expect(await versionsOf(w.book.id)).toEqual(before)
		// And the card's own versions are not the book's: still one v1.
		const cardVersions = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, w.cardV1.cardId!))
		expect(cardVersions).toHaveLength(1)
	})

	test("the copy's members read what the source's read", async () => {
		const w = await world()
		const { copy, maps } = await duplicate(w.book.id)
		const sameLine = async (bookId: number, branchId: number | null) =>
			readingOf(db(), bookId, {
				branch: branchId == null ? "main" : branchId,
				moment: { year: 6, month: 1, day: 1 }
			})

		for (const [onLine, copyLine] of [
			[null, null],
			[w.line.id, maps.branches.get(w.line.id)!]
		] as const) {
			const source = await membersAsRead(
				db(),
				[w.carded.member.id, w.cardless.member.id],
				{ reading: await sameLine(w.book.id, onLine) }
			)
			const copied = await membersAsRead(
				db(),
				[
					maps.bindings.get(w.carded.member.id)!,
					maps.bindings.get(w.cardless.member.id)!
				],
				{ reading: await sameLine(copy.id, copyLine) }
			)
			for (const id of [w.carded.member.id, w.cardless.member.id]) {
				const a = source.get(id)!
				const b = copied.get(maps.bindings.get(id)!)!
				expect({
					name: b.name,
					aliases: b.aliases,
					description: b.description,
					nodeState: b.nodeState,
					follows: b.follows
				}).toEqual({
					name: a.name,
					aliases: a.aliases,
					description: a.description,
					nodeState: a.nodeState,
					follows: a.follows
				})
			}
		}
		// The dated version reads on the line, the base on main.
		const onLine = await membersAsRead(
			db(),
			[maps.bindings.get(w.carded.member.id)!],
			{ reading: await sameLine(copy.id, maps.branches.get(w.line.id)!) }
		)
		expect(onLine.get(maps.bindings.get(w.carded.member.id)!)!.name).toBe(
			w.dated.name
		)
	})

	test("the overwrite purge takes the copy's versions and leaves the source's", async () => {
		const w = await world()
		const before = await versionsOf(w.book.id)
		const { copy } = await duplicate(w.book.id)
		expect(await versionsOf(copy.id)).toHaveLength(4)

		await testDb.transaction((tx) =>
			purgeLorebook(tx as unknown as Db, copy.id)
		)
		expect(await versionsOf(copy.id)).toHaveLength(0)
		expect(await versionsOf(w.book.id)).toEqual(before)
	})

	test("a book delete leaves none of the copy's versions, and the cards' own stay", async () => {
		const w = await world()
		const { copy } = await duplicate(w.book.id)
		await testDb.transaction(async (tx) => {
			await purgeLorebook(tx as unknown as Db, copy.id)
			await tx
				.delete(schema.lorebooks)
				.where(eq(schema.lorebooks.id, copy.id))
		})
		const left = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.lorebookId, copy.id))
		expect(left).toHaveLength(0)
		expect(await versionsOf(w.book.id)).toHaveLength(4)
		const [card] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, w.cardV1.id))
		expect(card).toBeDefined()
	})

	test("a member that did not copy takes no versions with it", async () => {
		const w = await world()
		const [copy] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Partial" })
			.returning()
		const { LOREBOOK_TABLES } = await import("./tableRegistry")
		const spec = LOREBOOK_TABLES.find(
			(s) => s.table === schema.characterVersions
		)!
		await testDb.transaction((tx) =>
			spec.copy(tx as unknown as Db, w.book.id, copy!.id, {
				branches: new Map(),
				bindings: new Map(),
				entries: new Map(),
				historyEntries: new Map(),
				scenes: new Map(),
				spriteSets: new Map(),
				tags: new Map()
			})
		)
		expect(await versionsOf(copy!.id)).toHaveLength(0)
	})
})
