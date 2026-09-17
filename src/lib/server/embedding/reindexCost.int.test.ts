/**
 * What a switch costs, broken down by what the rows ARE.
 *
 * ⚠ The whole point of the breakdown is that it DECOMPOSES `rows` — the number
 * the confirmation quotes before a destructive, unrecoverable clear. So the
 * assertion that matters most here is the arithmetic one: the kinds sum to
 * `rows` exactly. A breakdown naming a store the clear never touches (scenes,
 * the legacy entry tables) would overstate the cost on the one screen whose
 * entire job is to state it accurately.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { embeddingReindexCost } from "./reindex"
import { countEmbeddedRows } from "./vectors"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 120_000)

beforeEach(async () => {
	await db.delete(schema.lorebookEntryVectors)
	await db.delete(schema.sessionMessages)
	await db.delete(schema.lorebookBindings)
	await db.delete(schema.lorebookEntries)
	await db.delete(schema.characters)
})

const VECTOR = [0.1, 0.2, 0.3]

async function world(suffix: string) {
	const user = await createTestUser(db, `reindex-cost-${suffix}`)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}` })
		.returning()
	return { user, lorebook, session }
}

async function embeddedEntry(
	lorebookId: number,
	title: string,
	position: number
) {
	const [entry] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position,
			title,
			content: "…"
		})
		.returning()
	await db.insert(schema.lorebookEntryVectors).values({
		entryId: entry.id,
		vectorName: "core:vec/default@1",
		chunkIndex: 0,
		dims: VECTOR.length,
		vector: VECTOR,
		model: "Xenova/all-MiniLM-L6-v2"
	} as any)
	return entry
}

async function embeddedMessage(sessionId: number) {
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "assistant",
		content: "…",
		embedding: VECTOR,
		embeddingModel: "Xenova/all-MiniLM-L6-v2",
		vectorizedAt: new Date()
	} as any)
}

describe("the re-index cost", () => {
	it("is zero with nothing embedded, and names no kinds at all", async () => {
		const cost = await embeddingReindexCost(db as any)
		expect(cost.rows).toBe(0)
		// "Omit zero kinds": a fresh instance answers {}, not seven zeroes.
		expect(cost.byKind).toEqual({})
		expect(cost.lorebooks).toBe(0)
		expect(cost.sessions).toBe(0)
	}, 60_000)

	it("breaks the same rows down by kind, and the kinds sum to rows", async () => {
		const a = await world("a")
		const b = await world("b")

		await db.insert(schema.characters).values({
			userId: a.user.id,
			name: "Verity",
			description: "…",
			embedding: VECTOR,
			embeddingModel: "m",
			vectorizedAt: new Date()
		} as any)
		await db.insert(schema.characters).values({
			userId: a.user.id,
			name: "Reader",
			description: "…",
			isPersona: true,
			embedding: VECTOR,
			embeddingModel: "m",
			vectorizedAt: new Date()
		} as any)
		// A character with NO vector must not be counted — the cost is about
		// what IS embedded, never about what could be.
		await db.insert(schema.characters).values({
			userId: a.user.id,
			name: "Unembedded",
			description: "…"
		} as any)

		await embeddedEntry(a.lorebook.id, "A rusty key", 0)
		await embeddedEntry(a.lorebook.id, "A second door", 1)
		await embeddedEntry(b.lorebook.id, "Another world", 0)
		await db.insert(schema.lorebookBindings).values({
			lorebookId: a.lorebook.id,
			binding: "{{char:1}}",
			name: "Verity",
			embedding: VECTOR,
			embeddingModel: "m",
			vectorizedAt: new Date()
		} as any)

		await embeddedMessage(a.session.id)
		await embeddedMessage(a.session.id)
		await embeddedMessage(b.session.id)

		const cost = await embeddingReindexCost(db as any)

		expect(cost.byKind).toEqual({
			messages: 3,
			// Verity (a character) and Reader (a persona) are both `characters`
			// rows since the 0133 merge — one word covers both.
			characters: 2,
			// Three entry vectors plus the one binding: both are re-embedded by
			// the same pass, under one word.
			lorebookEntries: 4
		})
		// ⚠ The arithmetic that makes the breakdown honest.
		const summed = Object.values(cost.byKind!).reduce((s, n) => s + n, 0)
		expect(summed).toBe(cost.rows)
		expect(cost.rows).toBe(await countEmbeddedRows(db as any))

		// Two lorebooks own embedded rows; two sessions own embedded messages.
		expect(cost.lorebooks).toBe(2)
		expect(cost.sessions).toBe(2)
	}, 60_000)
})
