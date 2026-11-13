/**
 * A cast tag inside a cast version's text follows its member (A16): a merge
 * rewrites it, a delete writes the name, an undo puts it back — and the one
 * writer of `character_versions` does the writing.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCastMember,
	insertCharacterVersions,
	writeCastVersionTagText
} from "$lib/server/characters/versions"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-ng-castversiontags-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let userSeq = 0
async function makeUser() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `cast-version-tags-user-${++userSeq}`)
}

let position = 0
async function addEntry(lorebookId: number, data: Record<string, any>) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId,
				position: ++position,
				typeId: WORLD_LORE_TYPE_ID,
				...data
			} as any)
		)
		.returning()
	return row
}

/** Save an entry the way the editor does: `entries:update` with its content. */
async function saveEntry(userId: number, entryId: number, content: string) {
	const { updateEntryHandler } = await import("./entries")
	return updateEntryHandler.handler(
		fakeSocket(userId),
		{ entry: { id: entryId, typeId: WORLD_LORE_TYPE_ID, content } } as any,
		noopEmit
	)
}

async function membersOf(lorebookId: number) {
	return testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		.orderBy(schema.lorebookBindings.id)
}

async function contentOf(entryId: number) {
	const [row] = await testDb
		.select({ content: schema.lorebookEntries.content })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, entryId))
	return row?.content
}

/**
 * A book with a carded member (`{{char:1}}`, Maren — the one a merge keeps)
 * and a background member (`{{char:2}}`, the Stranger — the one it absorbs),
 * and an entry naming both.
 */
async function bookWithTwo() {
	const user = await makeUser()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Tags", userId: user.id, nextBindingNumber: 3 })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Maren", description: "" })
		.returning()
	const maren = (
		await insertCastMember(testDb, {
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: "Maren"
		})
	).member
	const stranger = (
		await insertCastMember(testDb, {
			lorebookId: book.id,
			binding: "{{char:2}}",
			name: "The Stranger"
		})
	).member
	const entry = await addEntry(book.id, {
		name: "The forge",
		content: "{{char:1}} met {{char:2}} at the forge."
	})
	return { user, book, maren, stranger, entry }
}

async function merge(userId: number, absorbedId: number, survivorId: number) {
	const { narrativeGraphMergeNodeHandler } = await import("./narrativeGraph")
	return narrativeGraphMergeNodeHandler.handler(
		fakeSocket(userId),
		{ nodeId: absorbedId, parentNodeId: survivorId },
		noopEmit
	)
}

async function undoLastMerge(userId: number, lorebookId: number) {
	const { narrativeGraphUndoMergeHandler } = await import("./narrativeGraph")
	const [log] = await testDb
		.select({ id: schema.bindingMergeLogs.id })
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))
		.orderBy(schema.bindingMergeLogs.id)
	return narrativeGraphUndoMergeHandler.handler(
		fakeSocket(userId),
		{ mergeLogId: log.id },
		noopEmit
	)
}

async function undoMerge(userId: number, mergeLogId: number) {
	const { narrativeGraphUndoMergeHandler } = await import("./narrativeGraph")
	return narrativeGraphUndoMergeHandler.handler(
		fakeSocket(userId),
		{ mergeLogId },
		noopEmit
	)
}

async function logsOf(lorebookId: number) {
	return testDb
		.select()
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))
		.orderBy(schema.bindingMergeLogs.id)
}

async function deleteMember(userId: number, id: number) {
	const { narrativeGraphDeleteNodeHandler } = await import("./narrativeGraph")
	return narrativeGraphDeleteNodeHandler.handler(
		fakeSocket(userId),
		{ id, privateLore: "keep" },
		noopEmit
	)
}

/** `bookWithTwo`, plus a background Ferryman on `{{char:3}}`. */
async function bookWithThree(content: string) {
	const two = await bookWithTwo()
	await testDb
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 4 })
		.where(eq(schema.lorebooks.id, two.book.id))
	const ferryman = (
		await insertCastMember(testDb, {
			lorebookId: two.book.id,
			binding: "{{char:3}}",
			name: "Ferryman"
		})
	).member
	await testDb
		.update(schema.lorebookEntries)
		.set({ content })
		.where(eq(schema.lorebookEntries.id, two.entry.id))
	return { ...two, ferryman }
}

/** Every tag a book's members hold appears once. */
function expectOneMemberPerTag(members: { binding: string }[]) {
	const tags = members.map((m) => m.binding)
	expect(new Set(tags).size).toBe(tags.length)
}

let yearSeq = 0

/** A cast version row of `memberId`; the member's base is already there. */
async function addVersion(
	book: { id: number },
	memberId: number,
	values: Record<string, any>
) {
	const [row] = await insertCharacterVersions(testDb, [
		{
			castMemberId: memberId,
			lorebookId: book.id,
			nodeState: "active",
			nodeVisibility: "normal",
			year: 1000 + ++yearSeq,
			...values
		} as any
	])
	return row
}

async function versionsOf(memberId: number) {
	return testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(schema.characterVersions.id)
}

async function versionRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.id, id))
	return row
}

describe("a merge rewrites cast tags in a third member's versions", () => {
	test("description, a jsonb greetings column and an array column, retired rows too; a card version is untouched", async () => {
		const { user, book, maren, stranger, ferryman } = await bookWithThree(
			"{{char:1}} met {{char:2}}."
		)
		const live = await addVersion(book, ferryman.id, {
			description: "Ferried {{char:2}} once.",
			greetings: [{ text: "Hello {{char:2}}" }],
			aliases: ["friend of {{char:2}}"]
		})
		const retired = await addVersion(book, ferryman.id, {
			description: "Old: {{char:2}}.",
			retiredOrder: 999_999_999
		})
		const [cardVersion] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(
				and(
					isNotNull(schema.characterVersions.cardId),
					eq(schema.characterVersions.cardId, maren.characterId!)
				)
			)
		expect(cardVersion).toBeTruthy()
		await testDb
			.update(schema.characterVersions)
			.set({ description: "Card: {{char:2}}." })
			.where(eq(schema.characterVersions.id, cardVersion.id))

		await merge(user.id, stranger.id, maren.id)

		const a = await versionRow(live.id)
		expect(a.description).toBe("Ferried {{char:1}} once.")
		expect(a.greetings).toEqual([{ text: "Hello {{char:1}}" }])
		expect(a.aliases).toEqual(["friend of {{char:1}}"])
		expect((await versionRow(retired.id)).description).toBe(
			"Old: {{char:1}}."
		)
		expect((await versionRow(cardVersion.id)).description).toBe(
			"Card: {{char:2}}."
		)
	}, 60_000)

	test("an undo puts the tag back by position", async () => {
		const { user, book, maren, stranger, ferryman } = await bookWithThree(
			"{{char:1}} met {{char:2}}."
		)
		const live = await addVersion(book, ferryman.id, {
			description: "Ferried {{char:2}} once.",
			greetings: [{ text: "Hello {{char:2}} and {{char:1}}" }]
		})
		await merge(user.id, stranger.id, maren.id)
		expect((await versionRow(live.id)).description).toBe(
			"Ferried {{char:1}} once."
		)

		await undoLastMerge(user.id, book.id)

		const a = await versionRow(live.id)
		expect(a.description).toBe("Ferried {{char:2}} once.")
		expect(a.greetings).toEqual([
			{ text: "Hello {{char:2}} and {{char:1}}" }
		])
	}, 60_000)

	test("an undo resolves the restored member's own version against the book as it stands", async () => {
		const { user, book, maren, stranger, ferryman } = await bookWithThree(
			"{{char:1}} met {{char:2}}."
		)
		await addVersion(book, stranger.id, {
			description: "Knows {{char:3}} well."
		})
		await merge(user.id, stranger.id, maren.id)
		await merge(user.id, ferryman.id, maren.id)
		const [first] = await logsOf(book.id)

		const res = await undoMerge(user.id, first.id)

		const restoredId = res.restoredNode.id
		const texts = (await versionsOf(restoredId)).map((v) => v.description)
		expect(texts).toContain("Knows {{char:1}} well.")
		expect(texts.some((t) => t?.includes("{{char:3}}"))).toBe(false)
	}, 60_000)
})

describe("a delete writes the member's name into cast versions", () => {
	test("a live version and a merge log's saved copy both read the name", async () => {
		const { user, book, maren, stranger, ferryman } = await bookWithThree(
			"{{char:1}} met {{char:2}}."
		)
		const third = await addVersion(book, maren.id, {
			description: "Saw {{char:3}} at the dock."
		})
		await addVersion(book, stranger.id, {
			description: "Owes {{char:3}} a coin."
		})
		await merge(user.id, stranger.id, maren.id)

		await deleteMember(user.id, ferryman.id)

		expect((await versionRow(third.id)).description).toBe(
			"Saw Ferryman at the dock."
		)
		const [log] = await logsOf(book.id)
		const story = (log.absorbedSnapshot as any).$memberStory
		const texts = story.castVersions.map((r: any) => r.description)
		expect(texts).toContain("Owes Ferryman a coin.")
		expect(JSON.stringify(story.castVersions)).not.toContain("{{char:3}}")
	}, 60_000)
})

describe("writeCastVersionTagText", () => {
	test("refuses a card version, an unknown id and a column no tag sits in", async () => {
		const { book, maren, ferryman } = await bookWithThree("x")
		const [cardVersion] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.cardId, maren.characterId!))
		const mine = await addVersion(book, ferryman.id, { description: "a" })

		await expect(
			writeCastVersionTagText(testDb, cardVersion.id, {
				description: "b"
			})
		).rejects.toThrow(/card version/)
		await expect(
			writeCastVersionTagText(testDb, 987_654_321, { description: "b" })
		).rejects.toThrow(/does not exist/)
		await expect(
			writeCastVersionTagText(testDb, mine.id, { writeOrder: 1 })
		).rejects.toThrow(/not a cast version column/)

		await writeCastVersionTagText(testDb, mine.id, {
			description: "b\u0000c"
		})
		const row = await versionRow(mine.id)
		expect(row.description).toBe("bc")
		expect(row.writeOrder).toBe(mine.writeOrder)
	}, 60_000)
})
