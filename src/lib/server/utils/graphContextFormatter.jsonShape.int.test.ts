/**
 * The graph context is JSON, keyed by the other character.
 *
 * Three problems with the prose form it replaced: the context template already
 * wrapped this block in a ```json fence, so prose was a format lie; in
 * `yourRelationships` the source is always the speaker, so every line repeated
 * the speaker's own name; and the heading "How others in this scene see X"
 * asserted co-presence that layer 2 (scoped to chat participants) does not
 * establish.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-gcf-json-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function scenario(
	rels: Array<{
		type: string
		visibility: string
		status?: string
		description?: string
		targetState?: string
	}>
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(
		testDb,
		`gcf-${Math.abs(rels.length)}-${Date.now()}`
	)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "LB" })
		.returning()
	const [speakerChar] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Amara", description: "" })
		.returning()
	const [speaker] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			name: "Amara",
			binding: "{{char:1}}",
			characterId: speakerChar.id
		})
		.returning()
	const [other] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			name: "Kiran",
			binding: "{{char:2}}",
			nodeState: (rels[0]?.targetState ?? "active") as any
		})
		.returning()

	for (const r of rels) {
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: speaker.id,
			toNodeId: other.id,
			relationshipType: r.type,
			visibility: r.visibility as any,
			status: r.status ?? "active",
			description: r.description ?? ""
		})
	}

	const { buildGraphContext } = await import("./graphContextFormatter")
	const ctx = await buildGraphContext({
		chatId: -1,
		lorebookId: lorebook.id,
		speakerCharacterId: speakerChar.id
	})
	return JSON.parse(ctx!)
}

describe("graph context JSON shape", () => {
	test("is valid JSON keyed by the other character, not by the speaker", async () => {
		const g = await scenario([
			{ type: "admires", visibility: "secret", description: "d1" }
		])
		expect(Object.keys(g.yourRelationships)).toEqual(["Kiran"])
		// The speaker's own name must not appear as a key or be repeated per
		// entry — that repetition is the whole reason for this shape.
		expect(JSON.stringify(g)).not.toContain("Amara")
	})

	test("a pair with several dynamics names the other character once", async () => {
		const g = await scenario([
			{ type: "admires", visibility: "secret" },
			{ type: "debt", visibility: "acknowledged" },
			{ type: "rivalry", visibility: "public" }
		])
		expect(Object.keys(g.yourRelationships)).toEqual(["Kiran"])
		expect(g.yourRelationships.Kiran).toHaveLength(3)
		expect((JSON.stringify(g).match(/Kiran/g) ?? []).length).toBe(1)
	})

	test("secrecy is stated from the speaker's vantage, not as schema jargon", async () => {
		const g = await scenario([
			{ type: "a", visibility: "secret" },
			{ type: "b", visibility: "acknowledged" },
			{ type: "c", visibility: "public" }
		])
		expect(g.yourRelationships.Kiran.map((r: any) => r.secrecy)).toEqual([
			"Only I know",
			"We both know",
			"Everyone knows"
		])
		expect(JSON.stringify(g)).not.toContain("acknowledged")
	})

	test("status appears only when it is not the unremarkable default", async () => {
		const g = await scenario([
			{ type: "a", visibility: "public", status: "active" },
			{ type: "b", visibility: "public", status: "resolved" }
		])
		const [first, second] = g.yourRelationships.Kiran
		expect(first).not.toHaveProperty("status")
		expect(second.status).toBe("resolved")
	})

	test("the other character's state appears only when notable", async () => {
		const alive = await scenario([{ type: "a", visibility: "public" }])
		expect(alive.yourRelationships.Kiran[0]).not.toHaveProperty(
			"theirState"
		)

		const dead = await scenario([
			{ type: "a", visibility: "public", targetState: "deceased" }
		])
		expect(dead.yourRelationships.Kiran[0].theirState).toBe("deceased")
	})

	test("no section claims the other characters are present in the room", async () => {
		const g = await scenario([{ type: "a", visibility: "public" }])
		const keys = JSON.stringify(Object.keys(g))
		expect(keys).not.toMatch(/scene|room|present/i)
	})
})
