/**
 * **A dated card reads its member's private lore** (plan lorebooks
 * consolidation A25).
 *
 * A card a cast amendment draws a member with from a date is that member's
 * (`castMemberCards`): a seat holding it is her, on any line and at any date.
 * The host's `lorebook_entries` read gates character lore by who is speaking,
 * so the gate must know every card of a member, not only the linked one —
 * otherwise a speaker seated with the keeper's card is Verity for her sprites,
 * stats and relationships, and a stranger to her own secrets.
 *
 * Pinned against the host read, on `speakerLore.int.test.ts`'s terms:
 *
 * 1. A speaker holding the dated card reads the member's private lore; another
 *    member's stays closed to them, and the linked card still reads it.
 * 2. A background member (no linked card) whose dated change draws them with
 *    a card: that card's speaker reads their lore, and the narrator still does.
 * 3. Character lore's co-occurrence signal names the member's card the session
 *    seats, so the keeper speaking lifts Verity's lore.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { characterLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { createHost } from "$lib/server/pipelines/runtime/host"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "dated-card-lore-secret" }
})

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number
let young: number
let keeper: number
let brask: number
let ashCard: number

const node = {
	key: "lore",
	definitionId: "core:query/character-lore@1",
	definitionVersion: 1,
	kind: "query"
}

let host: ReturnType<typeof createHost>

const read = async (query: Record<string, unknown>): Promise<any[]> => {
	if (!host.read) throw new Error("this host answers no reads")
	return (await host.read(
		"lorebook_entries",
		{ sessionId, ...query },
		node as any
	)) as any[]
}

const loreFor = async (query: Record<string, unknown>) =>
	(await read(query))
		.filter((r) => r.source === "characterLore")
		.map((r) => r.name)
		.sort()

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-dated-card-lore-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "dated-card-lore", isAdmin: false })
		.returning()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "Ashfall", userId: user.id })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	sessionId = session.id

	const card = async (name: string) =>
		(
			await db
				.insert(schema.characters)
				.values({ userId: user.id, name, description: `${name}.` })
				.returning()
		)[0].id
	young = await card("Verity")
	keeper = await card("The Lamp Keeper")
	brask = await card("Brask")
	ashCard = await card("The Ashguard's face")

	const [verityMember, braskMember, ashguard] = await db
		.insert(schema.lorebookBindings)
		.values([
			{ lorebookId: book.id, binding: "{{char:1}}", name: "Verity", characterId: young },
			{ lorebookId: book.id, binding: "{{char:2}}", name: "Brask", characterId: brask },
			{ lorebookId: book.id, binding: "{{char:3}}", name: "The Ashguard" }
		])
		.returning()
	await db.insert(schema.castAmendments).values([
		{
			lorebookId: book.id,
			lorebookBindingId: verityMember.id,
			year: 20,
			fields: { characterId: keeper }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: ashguard.id,
			year: 30,
			fields: { characterId: ashCard }
		}
	])
	// The session seats the keeper's card, not the linked one.
	await db
		.insert(schema.sessionCharacters)
		.values([
			{ sessionId, characterId: keeper, position: 0 },
			{ sessionId, characterId: brask, position: 1 }
		])

	await db.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				lorebookId: book.id,
				name: "Verity's secret",
				keys: "",
				content: "She has the key already.",
				lorebookBindingId: verityMember.id
			},
			{
				lorebookId: book.id,
				name: "Brask's secret",
				keys: "",
				content: "He cannot swim.",
				lorebookBindingId: braskMember.id
			},
			{
				lorebookId: book.id,
				name: "The Ashguard's orders",
				keys: "",
				content: "Nobody in the party knows this.",
				lorebookBindingId: ashguard.id
			}
		])
	)

	host = createHost(db as any, { sessionId, currentCharacterId: null })
}, 60_000)

describe("a speaker holding a dated card", () => {
	it("reads the member's private lore, and nobody else's", async () => {
		expect(await loreFor({ speaker: `character:${keeper}` })).toEqual([
			"Verity's secret"
		])
		expect(await loreFor({ speaker: `character:${young}` })).toEqual([
			"Verity's secret"
		])
		expect(await loreFor({ speaker: `character:${brask}` })).toEqual([
			"Brask's secret"
		])
		expect(await loreFor({ currentCharacterId: keeper })).toEqual([
			"Verity's secret"
		])
	})

	it("reads a background member's lore when a dated change draws them with the card", async () => {
		expect(await loreFor({ speaker: `character:${ashCard}` })).toEqual([
			"The Ashguard's orders"
		])
		// The narrator still reads a background member's lore.
		expect(await loreFor({ currentCharacterId: null })).toEqual([
			"The Ashguard's orders"
		])
	})

	it("is the card co-occurrence looks for: the one the session seats", async () => {
		const named = async (speaker: number, name: string) =>
			(await read({ speaker: `character:${speaker}` })).find(
				(r) => r.name === name
			)
		expect(
			(await named(keeper, "Verity's secret"))?.bindingCharacterId
		).toBe(keeper)
		expect((await named(brask, "Brask's secret"))?.bindingCharacterId).toBe(
			brask
		)
	})
})
