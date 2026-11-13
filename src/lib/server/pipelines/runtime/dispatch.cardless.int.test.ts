/**
 * 🚧 The adapter's session read lists a card-less character seat (S4, lane
 * s4-seat-live w3): the member's card-shaped read with no `id`; an envoy seat
 * stays out.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { loadAdapterSession } from "./dispatch"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string
let sessionId: number
let memberId: number
let cardId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-dispatch-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const [owner] = await db
		.insert(schema.users)
		.values({ username: "dispatch-cl", isAdmin: false })
		.returning()
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: owner!.id, name: "Alice", description: "A knight." })
		.returning()
	cardId = card!.id
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner!.id, name: "Book" } as any)
		.returning()
	const m = await insertCastMember(db, {
		lorebookId: book!.id,
		characterId: null,
		binding: "{{char:cl}}",
		name: "Wren",
		ownName: "Wren"
	} as any)
	memberId = m.member!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner!.id,
			isGroup: false,
			lorebookId: book!.id
		} as any)
		.returning()
	sessionId = session!.id
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: cardId, position: 0 } as any)
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: null,
		castMemberId: memberId,
		position: 1
	} as any)
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: null,
		envoySlug: "castellan",
		position: 2
	} as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("loadAdapterSession and a card-less seat", () => {
	it("lists the card-less seat with its member's name and no id; the envoy is absent", async () => {
		const was = memberFormSwitch.on
		memberFormSwitch.on = true
		try {
			const session = await loadAdapterSession(db as any, sessionId)
			const rows = session.sessionCharacters as any[]
			expect(rows).toHaveLength(2)
			const carded = rows.find((r) => r.character.id === cardId)
			expect(carded.character.name).toBe("Alice")
			const cardless = rows.find((r) => r.castMemberId === memberId)
			expect(cardless.character.name).toBe("Wren")
			expect("id" in cardless.character).toBe(false)
			expect(rows.some((r) => r.envoySlug === "castellan")).toBe(false)
		} finally {
			memberFormSwitch.on = was
		}
	})
})
