/**
 * Cast tags survive merge and delete, and the entry save stops resurrecting
 * members (plan A16).
 *
 * Before A16: `syncLorebookBindings` minted a member for ANY `{{word:N}}` in
 * any entry on every save — `{{roll:20}}` included, which also pushed the
 * counter to 21 — and a merge or a delete never rewrote the tags the member
 * left in the book's text. So the next save of any entry found the absorbed
 * or deleted member's tag with no row and minted a blank member under it; an
 * undoMerge then re-inserted the absorbed row beside that blank one, two
 * members on one tag.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lb-casttags-int-test-")
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
	return createTestUser(testDb, `cast-tags-user-${++userSeq}`)
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
	const [maren] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: "Maren"
		})
		.returning()
	const [stranger] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book.id,
			binding: "{{char:2}}",
			name: "The Stranger"
		})
		.returning()
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
	const [ferryman] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: two.book.id,
			binding: "{{char:3}}",
			name: "Ferryman"
		})
		.returning()
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

describe("the entry save recognises only cast tags", () => {
	test("{{roll:20}} mints nothing and moves no counter", async () => {
		const user = await makeUser()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Dice", userId: user.id })
			.returning()
		const entry = await addEntry(book.id, {
			name: "Dice",
			content: "Roll {{roll:20}} and {roll:6}."
		})
		await saveEntry(user.id, entry.id, "Roll {{roll:20}} and {roll:6}.")

		expect(await membersOf(book.id)).toEqual([])
		const [after] = await testDb
			.select({ n: schema.lorebooks.nextBindingNumber })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		expect(after.n).toBe(1)
	}, 60_000)

	test("only {{char:N}} is a tag: 0.5's {char:N} and the half-braced slips mint nothing", async () => {
		// The prompt substitutes `{{char:N}}` only and the editor draws a chip
		// for it only; a scan reading more minted members nothing else could
		// ever name. 0200 rewrote the stored 0.5 spelling; the 0.5 import is
		// the one reader left for it.
		const user = await makeUser()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Spellings", userId: user.id })
			.returning()
		const entry = await addEntry(book.id, { name: "Two", content: "x" })
		await saveEntry(
			user.id,
			entry.id,
			"{char:4} and {{char:4}}, and {char:5}, {{char:6} and {char:7}}."
		)

		expect((await membersOf(book.id)).map((m) => m.binding)).toEqual([
			"{{char:4}}"
		])
	}, 60_000)

	test("a typed tag too big to count past mints nothing and leaves the counter alone", async () => {
		const user = await makeUser()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Ledger", userId: user.id, nextBindingNumber: 4 })
			.returning()
		const entry = await addEntry(book.id, { name: "Ledger", content: "x" })
		await saveEntry(user.id, entry.id, "Ledger no. {{char:2147483646}}.")

		expect(await membersOf(book.id)).toEqual([])
		const { deriveNextBindingToken } = await import(
			"$lib/server/utils/lorebookBindingToken"
		)
		const next = await testDb.transaction((tx) =>
			deriveNextBindingToken(book.id, tx as any)
		)
		expect(next).toBe("{{char:4}}")
	}, 60_000)
})

describe("the next cast number", () => {
	test("goes past a ten-digit tag a member holds", async () => {
		const user = await makeUser()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Ten", userId: user.id, nextBindingNumber: 4 })
			.returning()
		await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "{{char:1000000005}}" })
		const { deriveNextBindingToken } = await import(
			"$lib/server/utils/lorebookBindingToken"
		)
		const next = await testDb.transaction((tx) =>
			deriveNextBindingToken(book.id, tx as any)
		)
		expect(next).toBe("{{char:1000000006}}")
	}, 60_000)

	test("a book that has given out the last number says so in words", async () => {
		const user = await makeUser()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Full", userId: user.id, nextBindingNumber: 4 })
			.returning()
		await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "{{char:2147483646}}" })
		const { deriveNextBindingToken } = await import(
			"$lib/server/utils/lorebookBindingToken"
		)
		await expect(
			testDb.transaction((tx) =>
				deriveNextBindingToken(book.id, tx as any)
			)
		).rejects.toThrow(/has used every cast number/)
	}, 60_000)
})

describe("merge rewrites the absorbed member's tags", () => {
	test("merge, then save the entry: no blank member comes back", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)

		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met {{char:1}} at the forge."
		)
		await saveEntry(user.id, entry.id, (await contentOf(entry.id))!)
		expect((await membersOf(book.id)).map((m) => m.id)).toEqual([maren.id])
	}, 60_000)

	test("a save from an editor still holding the old tag mints nothing either", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)

		// The draft the editor opened before the merge.
		await saveEntry(
			user.id,
			entry.id,
			"{{char:1}} met {{char:2}} at the forge."
		)
		expect((await membersOf(book.id)).map((m) => m.id)).toEqual([maren.id])
	}, 60_000)

	test("every lore text in the book follows: amendments, scenes, links, summaries", async () => {
		const { user, book, maren, stranger } = await bookWithTwo()
		await testDb
			.update(schema.lorebooks)
			.set({ description: "Where {{char:2}} walks." })
			.where(eq(schema.lorebooks.id, book.id))
		const keyed = await addEntry(book.id, {
			name: "About {{char:2}}",
			keys: ["{{char:2}}", "stranger"],
			content: "{{char:2}} rides; {char:2} is prose."
		})
		const [amendment] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: book.id,
				entryId: keyed.id,
				year: 1,
				fields: { content: "Later, {{char:2}} left." }
			})
			.returning()
		const [castAmendment] = await testDb
			.insert(schema.castAmendments)
			.values({
				lorebookId: book.id,
				lorebookBindingId: maren.id,
				year: 1,
				fields: { summary: "Owes {{char:2}} a blade." }
			})
			.returning()
		const [presence] = await testDb
			.insert(schema.castPresences)
			.values({
				lorebookId: book.id,
				lorebookBindingId: maren.id,
				personalPosition: 1,
				fromYear: 1,
				note: "Arrived with {{char:2}}."
			})
			.returning()
		const history = await addEntry(book.id, {
			typeId: HISTORY_TYPE_ID,
			year: 1,
			content: "{{char:2}} came down the mountain."
		})
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: book.id,
				historyEntryId: history.id,
				name: "{{char:2}} arrives",
				summary: "{{char:1}} greets {{char:2}}."
			})
			.returning()
		const [innkeeper] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				binding: "{{char:3}}",
				name: "Innkeeper",
				summary: "Distrusts {{char:2}}."
			})
			.returning()
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: book.id,
				fromNodeId: innkeeper.id,
				toNodeId: maren.id,
				relationshipType: "ally",
				description: "Met through {{char:2}}.",
				reason: "{{char:2}} vouched."
			})
			.returning()

		await merge(user.id, stranger.id, maren.id)

		const [bookAfter] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		expect(bookAfter.description).toBe("Where {{char:1}} walks.")
		const [keyedAfter] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, keyed.id))
		expect(keyedAfter.title).toBe("About {{char:1}}")
		expect(keyedAfter.keys).toEqual(["{{char:1}}", "stranger"])
		expect(keyedAfter.content).toBe("{{char:1}} rides; {char:2} is prose.")
		const [amendmentAfter] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.id, amendment.id))
		expect(amendmentAfter.fields).toEqual({
			content: "Later, {{char:1}} left."
		})
		const [castAmendmentAfter] = await testDb
			.select()
			.from(schema.castAmendments)
			.where(eq(schema.castAmendments.id, castAmendment.id))
		expect(castAmendmentAfter.fields).toEqual({
			summary: "Owes {{char:1}} a blade."
		})
		const [presenceAfter] = await testDb
			.select()
			.from(schema.castPresences)
			.where(eq(schema.castPresences.id, presence.id))
		expect(presenceAfter.note).toBe("Arrived with {{char:1}}.")
		expect(await contentOf(history.id)).toBe(
			"{{char:1}} came down the mountain."
		)
		const [sceneAfter] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(sceneAfter.name).toBe("{{char:1}} arrives")
		expect(sceneAfter.summary).toBe("{{char:1}} greets {{char:1}}.")
		const [innkeeperAfter] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, innkeeper.id))
		expect(innkeeperAfter.summary).toBe("Distrusts {{char:1}}.")
		const [linkAfter] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link.id))
		expect(linkAfter.description).toBe("Met through {{char:1}}.")
		expect(linkAfter.reason).toBe("{{char:1}} vouched.")
	}, 60_000)
})

describe("undoMerge puts the tags back", () => {
	test("unedited text gets the absorbed member's tag back; edited text is counted", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		const other = await addEntry(book.id, {
			name: "Other",
			content: "Only {{char:2}} knows."
		})
		await merge(user.id, stranger.id, maren.id)
		// Edited after the merge: whose tag each `{{char:1}}` once was cannot
		// be told any more.
		await saveEntry(
			user.id,
			other.id,
			"Only {{char:1}} knows, and says so."
		)

		const res = await undoLastMerge(user.id, book.id)

		expect(res.restoredNode.binding).toBe("{{char:2}}")
		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met {{char:2}} at the forge."
		)
		expect(await contentOf(other.id)).toBe(
			"Only {{char:1}} knows, and says so."
		)
		expect(res.unrestoredTextCount).toBe(1)
		const members = await membersOf(book.id)
		expect(members.map((m) => m.binding)).toEqual([
			"{{char:1}}",
			"{{char:2}}"
		])
	}, 60_000)

	test("undo then redo leaves one member per tag", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)
		await saveEntry(user.id, entry.id, (await contentOf(entry.id))!)
		const undone = await undoLastMerge(user.id, book.id)
		await saveEntry(user.id, entry.id, (await contentOf(entry.id))!)
		expectOneMemberPerTag(await membersOf(book.id))

		await merge(user.id, undone.restoredNode.id, maren.id)
		await saveEntry(user.id, entry.id, (await contentOf(entry.id))!)

		const members = await membersOf(book.id)
		expectOneMemberPerTag(members)
		expect(members.map((m) => m.id)).toEqual([maren.id])
		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met {{char:1}} at the forge."
		)
	}, 60_000)

	test("a blank member on the old tag that nothing links to is removed: the restored member gets their own tag back", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)
		// A blank member on the absorbed tag, as the pre-A16 save minted.
		const [blank] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "{{char:2}}" })
			.returning()

		const res = await undoLastMerge(user.id, book.id)

		expect(res.restoredNode.binding).toBe("{{char:2}}")
		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met {{char:2}} at the forge."
		)
		const members = await membersOf(book.id)
		expectOneMemberPerTag(members)
		// Not kept under a number no text uses: it was never anybody.
		expect(members.find((m) => m.id === blank.id)).toBeUndefined()
		expect(members.map((m) => m.id)).toEqual([
			maren.id,
			res.restoredNode.id
		])
	}, 60_000)

	test("a blank member on the old tag that something links to steps aside to a new number", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)
		const [blank] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "{{char:2}}" })
			.returning()
		// Somebody drew a tie to it: the tie keeps its end.
		const [tie] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: book.id,
				fromNodeId: maren.id,
				toNodeId: blank.id,
				relationshipType: "owes"
			})
			.returning()

		const res = await undoLastMerge(user.id, book.id)

		expect(res.restoredNode.binding).toBe("{{char:2}}")
		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met {{char:2}} at the forge."
		)
		const members = await membersOf(book.id)
		expectOneMemberPerTag(members)
		const blankAfter = members.find((m) => m.id === blank.id)!
		expect(blankAfter.binding).not.toBe("{{char:2}}")
		const [tieAfter] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, tie.id))
		expect(tieAfter.toNodeId).toBe(blank.id)
	}, 60_000)

	test("a blank member given a sheet, or aimed at by a pending change, steps aside too", async () => {
		for (const pointAt of ["sheet", "proposal"] as const) {
			const { user, book, maren, stranger } = await bookWithTwo()
			await merge(user.id, stranger.id, maren.id)
			const [blank] = await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: book.id, binding: "{{char:2}}" })
				.returning()
			if (pointAt === "sheet") {
				await testDb
					.insert(schema.attributeSheets)
					.values({ id: `test:sheet/cast-tags-${book.id}@1` })
				await testDb.insert(schema.ownerSheets).values({
					ownerKind: "cast_member",
					ownerId: blank.id,
					sheetId: `test:sheet/cast-tags-${book.id}@1`
				})
			} else {
				const [session] = await testDb
					.insert(schema.sessions)
					.values({ userId: user.id, isGroup: false, lorebookId: book.id })
					.returning()
				await testDb.insert(schema.stateProposals).values({
					sessionId: session.id,
					kind: "value",
					payload: {
						owner: { kind: "cast_member", id: blank.id },
						slotId: "core:stat/mood",
						value: "wary"
					},
					status: "pending"
				})
			}

			const res = await undoLastMerge(user.id, book.id)

			expect(res.restoredNode.binding).toBe("{{char:2}}")
			const members = await membersOf(book.id)
			expectOneMemberPerTag(members)
			const blankAfter = members.find((m) => m.id === blank.id)
			expect(blankAfter, pointAt).toBeDefined()
			expect(blankAfter!.binding).not.toBe("{{char:2}}")
		}
	}, 60_000)

	test("a member with only a sprite set or a state is not blank: it keeps the tag, and the member comes back under a new one", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)
		const [hooded] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				binding: "{{char:2}}",
				spriteSet: "hooded-figure",
				nodeState: "deceased"
			})
			.returning()

		const res = await undoLastMerge(user.id, book.id)

		const members = await membersOf(book.id)
		expectOneMemberPerTag(members)
		expect(members.find((m) => m.id === hooded.id)?.binding).toBe(
			"{{char:2}}"
		)
		expect(res.restoredNode.binding).not.toBe("{{char:2}}")
		// The text keeps the tag it had: it names whoever holds it now.
		expect(await contentOf(entry.id)).toContain("{{char:1}} met")
	}, 60_000)

	test("undoing a merge made before A16, over the blank member its save minted", async () => {
		// Before A16 a merge rewrote no text and kept no undo notes, and the
		// next save minted a blank member on the absorbed tag. The text still
		// names that tag, and it meant the absorbed member all along.
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		await merge(user.id, stranger.id, maren.id)
		const [log] = await testDb
			.select()
			.from(schema.bindingMergeLogs)
			.where(eq(schema.bindingMergeLogs.lorebookId, book.id))
		await testDb
			.update(schema.bindingMergeLogs)
			.set({ tagRewrites: [] })
			.where(eq(schema.bindingMergeLogs.id, log.id))
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "{{char:1}} met {{char:2}} at the forge." })
			.where(eq(schema.lorebookEntries.id, entry.id))
		const [blank] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "{{char:2}}", name: "" })
			.returning()

		const res = await undoMerge(user.id, log.id)

		expect(res.restoredNode.binding).toBe("{{char:2}}")
		expect(res.restoredNode.name).toBe("The Stranger")
		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met {{char:2}} at the forge."
		)
		const members = await membersOf(book.id)
		expectOneMemberPerTag(members)
		expect(members.find((m) => m.id === blank.id)).toBeUndefined()
	}, 60_000)

	test("two merges into one member, undone oldest first, put every tag back", async () => {
		const { user, book, maren, stranger, ferryman, entry } =
			await bookWithThree("{{char:2}} and {{char:3}} row.")
		await merge(user.id, stranger.id, maren.id)
		await merge(user.id, ferryman.id, maren.id)
		expect(await contentOf(entry.id)).toBe("{{char:1}} and {{char:1}} row.")
		const [first, second] = await logsOf(book.id)

		const u1 = await undoMerge(user.id, first.id)
		expect(u1.unrestoredTextCount).toBe(0)
		expect(await contentOf(entry.id)).toBe("{{char:2}} and {{char:1}} row.")

		const u2 = await undoMerge(user.id, second.id)
		expect(u2.unrestoredTextCount).toBe(0)
		expect(await contentOf(entry.id)).toBe("{{char:2}} and {{char:3}} row.")
	}, 60_000)

	test("a member deleted between the merge and its undo: the undo still puts the tag back", async () => {
		const { user, book, maren, stranger, ferryman, entry } =
			await bookWithThree("{{char:3}} owes {{char:2}}.")
		await merge(user.id, ferryman.id, maren.id)
		await deleteMember(user.id, stranger.id)
		expect(await contentOf(entry.id)).toBe("{{char:1}} owes The Stranger.")

		const res = await undoLastMerge(user.id, book.id)

		expect(res.unrestoredTextCount).toBe(0)
		expect(await contentOf(entry.id)).toBe("{{char:3}} owes The Stranger.")
	}, 60_000)

	test("the merge's saved copy of the member reads a deleted member's name too", async () => {
		const { user, book, maren, stranger, ferryman } =
			await bookWithThree("x")
		await testDb
			.update(schema.lorebookBindings)
			.set({ summary: "Owes {{char:2}} a debt." })
			.where(eq(schema.lorebookBindings.id, ferryman.id))
		await merge(user.id, ferryman.id, maren.id)
		await deleteMember(user.id, stranger.id)

		const res = await undoLastMerge(user.id, book.id)

		expect(res.restoredNode.summary).toBe("Owes The Stranger a debt.")
	}, 60_000)

	test("the saved copy naming a member merged away since reads their survivor, until that merge is undone", async () => {
		const { user, book, maren, stranger, ferryman } =
			await bookWithThree("x")
		await testDb
			.update(schema.lorebookBindings)
			.set({ summary: "Owes {{char:2}} a debt." })
			.where(eq(schema.lorebookBindings.id, ferryman.id))
		await merge(user.id, ferryman.id, maren.id)
		await merge(user.id, stranger.id, maren.id)
		const [ferrymanMerge, strangerMerge] = await logsOf(book.id)

		const back = await undoMerge(user.id, ferrymanMerge.id)
		expect(back.restoredNode.summary).toBe("Owes {{char:1}} a debt.")

		await undoMerge(user.id, strangerMerge.id)
		const [ferrymanAfter] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, back.restoredNode.id))
		expect(ferrymanAfter.summary).toBe("Owes {{char:2}} a debt.")
	}, 60_000)

	test("text edited since the merge is counted once per piece of lore, not per column", async () => {
		const { user, book, maren, stranger } = await bookWithTwo()
		const keyed = await addEntry(book.id, {
			name: "About {{char:2}}",
			keys: ["{{char:2}}"],
			content: "{{char:2}} knows."
		})
		await merge(user.id, stranger.id, maren.id)
		await testDb
			.update(schema.lorebookEntries)
			.set({
				title: "About {{char:1}}, again",
				content: "{{char:1}} knows more."
			})
			.where(eq(schema.lorebookEntries.id, keyed.id))

		const res = await undoLastMerge(user.id, book.id)

		expect(res.unrestoredTextCount).toBe(1)
		const [after] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, keyed.id))
		// The column nobody edited still comes back.
		expect(after.keys).toEqual(["{{char:2}}"])
	}, 60_000)
})

describe("deleting a member writes their name where their tags were", () => {
	test("keep their lore: the prose reads their name, and a save mints nothing", async () => {
		const { user, book, maren, stranger, entry } = await bookWithTwo()
		const { narrativeGraphDeleteNodeHandler } = await import(
			"./narrativeGraph"
		)
		await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(user.id),
			{ id: stranger.id, privateLore: "keep" },
			noopEmit
		)

		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met The Stranger at the forge."
		)
		await saveEntry(user.id, entry.id, (await contentOf(entry.id))!)
		expect((await membersOf(book.id)).map((m) => m.id)).toEqual([maren.id])

		// And the editor's stale draft, still holding the tag, mints nothing.
		await saveEntry(
			user.id,
			entry.id,
			"{{char:1}} met {{char:2}} at the forge."
		)
		expect((await membersOf(book.id)).map((m) => m.id)).toEqual([maren.id])
	}, 60_000)

	test("delete their lore: the rest of the book still reads their name", async () => {
		const { user, book, stranger, entry } = await bookWithTwo()
		const theirs = await addEntry(book.id, {
			typeId: CHARACTER_LORE_TYPE_ID,
			name: "Secret",
			lorebookBindingId: stranger.id,
			content: "{{char:2}} is a king in exile."
		})
		const { narrativeGraphDeleteNodeHandler } = await import(
			"./narrativeGraph"
		)
		const res = await narrativeGraphDeleteNodeHandler.handler(
			fakeSocket(user.id),
			{ id: stranger.id, privateLore: "delete" },
			noopEmit
		)

		expect(res.deletedLoreCount).toBe(1)
		expect(await contentOf(theirs.id)).toBeUndefined()
		expect(await contentOf(entry.id)).toBe(
			"{{char:1}} met The Stranger at the forge."
		)
	}, 60_000)
})

describe("one member per tag, enforced", () => {
	test("the book refuses a second member on a tag it already holds", async () => {
		const { book } = await bookWithTwo()
		const { asDriverRejection } = await import("$lib/server/utils/testDb")
		await expect(
			asDriverRejection(
				testDb
					.insert(schema.lorebookBindings)
					.values({ lorebookId: book.id, binding: "{{char:2}}" })
			)
		).rejects.toThrow(/lorebook_bindings_binding_unique/)
		// Another book may hold the same tag.
		const [other] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Other", userId: book.userId })
			.returning()
		await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: other.id, binding: "{{char:2}}" })
		const rows = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, other.id),
					eq(schema.lorebookBindings.binding, "{{char:2}}")
				)
			)
		expect(rows).toHaveLength(1)
	}, 60_000)
})
