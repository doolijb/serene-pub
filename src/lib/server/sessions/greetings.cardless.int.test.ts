import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	updateCastVersion
} from "$lib/server/characters/versions"

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
		path.join(os.tmpdir(), "serene-pub-vitest-greetcardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

describe("collectSessionGreetings — a card-less member's own greetings", () => {
	test("a group session greets with the member's group-only greetings, over an unrelated card held by the seat", async () => {
		const { eq } = await import("drizzle-orm")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, `greetcl-${++n}`)
		const { card } = await insertCard(db(), {
			userId: u.id,
			name: "Held card",
			description: "The card.",
			firstMessage: "The card's hello.",
			groupOnlyGreetings: ["The card's group hello."]
		} as any)
		const [b] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: `Book ${n}` } as any)
			.returning()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: true, name: "Group", lorebookId: b.id } as any)
			.returning()
		const { member, base } = await insertCastMember(db(), {
			lorebookId: b.id,
			characterId: null,
			binding: `{{char:${n}}}`,
			name: "Wren"
		} as any)
		await updateCastVersion(db(), base!.id, {
			changes: {
				greetings: [
					{ text: "{{char}} says the member's hello." },
					{ text: "{{char}} greets the group.", groupOnly: true }
				]
			}
		})
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: card.id, castMemberId: member.id } as any)
		const { collectSessionGreetings } = await import("$lib/server/sessions/greetings")
		expect((await collectSessionGreetings(db(), s.id)).entries).toEqual([
			{ characterId: card.id, texts: ["Wren greets the group."] }
		])
		await testDb.update(schema.sessions).set({ isGroup: false }).where(eq(schema.sessions.id, s.id))
		expect((await collectSessionGreetings(db(), s.id)).entries).toEqual([
			{ characterId: card.id, texts: ["Wren says the member's hello."] }
		])
	})

	test("a card-less seat greets as its member: character_id null, cast_member_id the member, metadata.speaker the seat's ref", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, `greetcl-${++n}`)
		const [b] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: `Book ${n}` } as any)
			.returning()
		const [s] = await testDb
			.insert(schema.sessions)
			.values({ userId: u.id, isGroup: false, name: "Solo", lorebookId: b.id } as any)
			.returning()
		const { member, base } = await insertCastMember(db(), {
			lorebookId: b.id,
			characterId: null,
			binding: `{{char:${n}}}`,
			name: "Sable"
		} as any)
		await updateCastVersion(db(), base!.id, {
			changes: { greetings: [{ text: "{{char}} tips a hat." }] }
		})
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: s.id, characterId: null, castMemberId: member.id, seatedByUserId: u.id } as any)
		const { collectSessionGreetings, writeSessionGreetings } = await import(
			"$lib/server/sessions/greetings"
		)
		const { entries } = await collectSessionGreetings(db(), s.id)
		expect(entries).toEqual([
			{ characterId: null, castMemberId: member.id, texts: ["Sable tips a hat."] }
		])
		const [id] = await writeSessionGreetings(db(), {
			sessionId: s.id,
			userId: u.id,
			entries
		})
		const row = (await testDb.query.sessionMessages.findFirst({
			where: (m, { eq }) => eq(m.id, id!)
		})) as any
		expect(row.characterId).toBeNull()
		expect(row.castMemberId).toBe(member.id)
		expect(row.metadata.speaker).toBe(`seated-member:${member.id}`)
		expect(row.content).toBe("Sable tips a hat.")
	})
})
