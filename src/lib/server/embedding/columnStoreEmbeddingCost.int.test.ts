/**
 * What a write costs in embed calls, for the four stores that keep their vector
 * on the row itself — session messages, characters (personas are characters),
 * cast members (`lorebook_bindings`) and relationships. Counted, not inferred:
 * every case drains the queue's own picker and counts the `embed()` calls.
 *
 * Paid embedding services are meant to be used; paying twice for the same text
 * is waste. So staleness is the embedded TEXT, hashed — the rule entries follow
 * (plan A9, `embeddingCost.int.test.ts`) — and never `updated_at`:
 *
 *  · a folder move, an avatar, the persona flag and a soft delete move a
 *    character's `updated_at` and not a word it embeds: no call;
 *  · the character sync's rewrite of an unchanged name, an alias edit, a
 *    relationship's status or visibility: no call;
 *  · an edit to the embedded text costs exactly one, of the new text;
 *  · a relationship embeds both members' names, so renaming a member re-embeds
 *    the member and every relationship that names it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/** Every text handed to the embedding model, in order. */
const embedded: string[] = []
vi.mock("$lib/server/embedding/index", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		embed: async (text: string) => {
			embedded.push(text)
			return [1, 0, 0]
		},
		getLoadedModelId: () => "test-model",
		isModelReady: () => true
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-column-store-cost-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noop = () => {}
const userSocket = (id: number) => ({ user: { id } }) as any

/**
 * Run the queue's picker to exhaustion and return what it embedded, as
 * `source:id`. Bounded, so a write guard that never lands fails the test
 * instead of hanging it.
 */
async function drain(): Promise<string[]> {
	const { pickNextItem } = await import("./vectorizationQueue")
	const done: string[] = []
	for (let i = 0; i < 100; i++) {
		const item = await pickNextItem("test-model")
		if (!item) return done
		await item.process()
		done.push(`${item.ref.source}:${item.ref.id}`)
	}
	throw new Error(`the queue never ran dry: ${done.join(", ")}`)
}

/** Drain, and hand back the texts it paid for. */
async function paidFor(): Promise<{ items: string[]; texts: string[] }> {
	embedded.length = 0
	const items = await drain()
	return { items, texts: [...embedded] }
}

let userId: number
let bookId: number
let folderId: number
let alder: number
let persona: number
let alderMember: number
let birchMember: number
let tie: number
let sessionId: number
let message: number

beforeAll(async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "column-store-cost")).id
	;[{ id: bookId }] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Column Store Book", userId })
		.returning()
	;[{ id: folderId }] = await testDb
		.insert(schema.characterFolders)
		.values({ userId, name: "Shelf" })
		.returning()
	;[{ id: alder }, { id: persona }] = await testDb
		.insert(schema.characters)
		.values([
			{ userId, name: "Alder", description: "A tree spirit." },
			{
				userId,
				name: "Wren",
				description: "The one you play.",
				isPersona: true
			}
		] as any)
		.returning()
	;[{ id: alderMember }, { id: birchMember }] = await testDb
		.insert(schema.lorebookBindings)
		.values([
			{
				lorebookId: bookId,
				binding: "{{char:1}}",
				name: "Alder",
				characterId: alder
			},
			{
				lorebookId: bookId,
				binding: "{{char:2}}",
				name: "Birch",
				summary: "A quiet woodcutter."
			}
		] as any)
		.returning()
	;[{ id: tie }] = await testDb
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId: bookId,
			fromNodeId: alderMember,
			toNodeId: birchMember,
			relationshipType: "ally",
			description: "Old friends."
		} as any)
		.returning()
	;[{ id: sessionId }] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false } as any)
		.returning()
	;[{ id: message }] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "Hello, traveller." })
		.returning()

	// Everything embedded once, as a starting point.
	expect((await drain()).length).toBe(6)
}, 60_000)

describe("session messages", () => {
	it("hiding, unhiding and a generation-status write cost nothing", async () => {
		for (const set of [
			{ isHidden: true },
			{ isHidden: false },
			{ isGenerating: false, generationStatus: null, metadata: { a: 1 } }
		])
			await testDb
				.update(schema.sessionMessages)
				.set(set as any)
				.where(eq(schema.sessionMessages.id, message))
		expect(await paidFor()).toEqual({ items: [], texts: [] })
	}, 60_000)

	it("a content edit costs exactly one embed, of the new text", async () => {
		await testDb
			.update(schema.sessionMessages)
			.set({ content: "Hello again, traveller." })
			.where(eq(schema.sessionMessages.id, message))
		expect(await paidFor()).toEqual({
			items: [`message:${message}`],
			texts: ["Hello again, traveller."]
		})
	}, 60_000)

	it("a content change that pins updated_at is still caught", async () => {
		await testDb
			.update(schema.sessionMessages)
			.set({
				content: "Rewritten without a timestamp.",
				updatedAt: sql`${schema.sessionMessages.updatedAt}`
			})
			.where(eq(schema.sessionMessages.id, message))
		expect((await paidFor()).items).toEqual([`message:${message}`])
	}, 60_000)

	it("a message with no text costs nothing, and is not counted as waiting", async () => {
		const { countUnembedded } = await import("./vectorizationQueue")
		const waiting = await countUnembedded("test-model")
		// A reply cut off before its first word (a crash, a failed run, a
		// Regenerate that cleared the text), and one that is only whitespace.
		const blank = await testDb
			.insert(schema.sessionMessages)
			.values([
				{ sessionId, role: "assistant", content: "" },
				{ sessionId, role: "assistant", content: " \n\t " }
			])
			.returning()
		try {
			expect(await paidFor()).toEqual({ items: [], texts: [] })
			expect(await countUnembedded("test-model")).toBe(waiting)
		} finally {
			for (const row of blank)
				await testDb
					.delete(schema.sessionMessages)
					.where(eq(schema.sessionMessages.id, row.id))
		}
	}, 60_000)

	it("the inline embed after a reply follows the same rule", async () => {
		const { ensureSessionMessageEmbedded } = await import(
			"./vectorizationQueue"
		)
		await testDb
			.update(schema.sessionMessages)
			.set({ isHidden: true })
			.where(eq(schema.sessionMessages.id, message))
		embedded.length = 0
		await ensureSessionMessageEmbedded(message)
		expect(embedded).toEqual([])
	}, 60_000)
})

describe("characters and personas", () => {
	async function update(character: Record<string, unknown>) {
		const { charactersUpdate } = await import(
			"$lib/server/sockets/characters"
		)
		await charactersUpdate.handler(
			userSocket(userId),
			{ character } as any,
			noop as any
		)
	}
	const vectorOf = async (id: number) =>
		(
			await testDb
				.select({ embedding: schema.characters.embedding })
				.from(schema.characters)
				.where(eq(schema.characters.id, id))
		)[0]?.embedding ?? null

	it("a folder move, an avatar, the persona flag and a soft delete cost nothing", async () => {
		await update({ id: alder, folderId })
		await testDb
			.update(schema.characters)
			.set({ avatarMediaId: null })
			.where(eq(schema.characters.id, persona))
		await update({ id: persona, isPersona: false })
		await update({ id: persona, isPersona: true })
		const { charactersDelete } = await import(
			"$lib/server/sockets/characters"
		)
		await charactersDelete.handler(
			userSocket(userId),
			{ id: persona } as any,
			noop as any
		)
		expect(await paidFor()).toEqual({ items: [], texts: [] })
		// And no vector was dropped on the way: retrieval kept reading it.
		expect(await vectorOf(alder)).not.toBeNull()
	}, 60_000)

	it("a save that re-sends the unchanged name and description costs nothing", async () => {
		await update({
			id: alder,
			name: "Alder",
			description: "A tree spirit.",
			personality: "Patient."
		})
		expect(await paidFor()).toEqual({ items: [], texts: [] })
		expect(await vectorOf(alder)).not.toBeNull()
	}, 60_000)

	it("a description edit costs exactly one embed, of the name and the new description", async () => {
		await update({ id: alder, description: "An old tree spirit." })
		expect(await paidFor()).toEqual({
			items: [`character:${alder}`],
			texts: ["Alder\nAn old tree spirit."]
		})
	}, 60_000)
})

describe("cast members and relationships", () => {
	it("the character sync's rewrite of an unchanged name costs nothing", async () => {
		const { syncLorebookBindingsForCharacter } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		await syncLorebookBindingsForCharacter(alder, testDb as any)
		expect(await paidFor()).toEqual({ items: [], texts: [] })
	}, 60_000)

	it("an alias edit costs nothing — aliases are not embedded", async () => {
		await testDb
			.update(schema.lorebookBindings)
			.set({ aliases: ["the woodcutter"] } as any)
			.where(eq(schema.lorebookBindings.id, birchMember))
		expect(await paidFor()).toEqual({ items: [], texts: [] })
	}, 60_000)

	it("a relationship's status or visibility costs nothing", async () => {
		await testDb
			.update(schema.narrativeRelationships)
			.set({ status: "resolved", visibility: "secret" } as any)
			.where(eq(schema.narrativeRelationships.id, tie))
		expect(await paidFor()).toEqual({ items: [], texts: [] })
	}, 60_000)

	it("a summary edit costs exactly one embed, of the name and the summary", async () => {
		await testDb
			.update(schema.lorebookBindings)
			.set({ summary: "A loud woodcutter." })
			.where(eq(schema.lorebookBindings.id, birchMember))
		expect(await paidFor()).toEqual({
			items: [`narrativeNode:${birchMember}`],
			texts: ["Birch\nA loud woodcutter."]
		})
	}, 60_000)

	it("a relationship's description edit costs exactly one embed, with both names", async () => {
		await testDb
			.update(schema.narrativeRelationships)
			.set({ description: "Sworn friends.", reason: "A shared oath" })
			.where(eq(schema.narrativeRelationships.id, tie))
		expect(await paidFor()).toEqual({
			items: [`narrativeRelationship:${tie}`],
			texts: ["Alder ally Birch: Sworn friends.. A shared oath"]
		})
	}, 60_000)

	it("renaming a member re-embeds the member and every relationship that names it", async () => {
		await testDb
			.update(schema.lorebookBindings)
			.set({ name: "Birch the Elder" })
			.where(eq(schema.lorebookBindings.id, birchMember))
		expect(await paidFor()).toEqual({
			items: [
				`narrativeNode:${birchMember}`,
				`narrativeRelationship:${tie}`
			],
			texts: [
				"Birch the Elder\nA loud woodcutter.",
				"Alder ally Birch the Elder: Sworn friends.. A shared oath"
			]
		})
	}, 60_000)

	it("renaming a carded character re-embeds the card, its member and the relationship", async () => {
		const { charactersUpdate } = await import(
			"$lib/server/sockets/characters"
		)
		await charactersUpdate.handler(
			userSocket(userId),
			{ character: { id: alder, name: "Alder Oak" } } as any,
			noop as any
		)
		// The handler's own sync reaches for the app database by a dynamic
		// import; run it here against this one.
		const { syncLorebookBindingsForCharacter } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		await syncLorebookBindingsForCharacter(alder, testDb as any)
		expect((await paidFor()).items.sort()).toEqual(
			[
				`character:${alder}`,
				`narrativeNode:${alderMember}`,
				`narrativeRelationship:${tie}`
			].sort()
		)
	}, 60_000)
})
