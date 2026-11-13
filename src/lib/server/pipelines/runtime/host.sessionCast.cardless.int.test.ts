/**
 * 🚧 A card-less seat in the `session_cast` read and the prompt (S4, lane
 * s4-seat-live w2): the host's cast read carries it, and
 * `build-template-context` names it as the speaker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import * as schema from "$lib/server/db/schema"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number
let seaterId: number
let memberId: number
let cardId: number
let cardlessSeatId: number
let switchWas = false

const castNode = {
	key: "read",
	definitionId: "core:query/session-cast@1"
} as any

const readCast = async () =>
	(await createHost(db as unknown as Db, { sessionId }).read!(
		"session_cast",
		{ sessionId },
		castNode
	)) as any

beforeAll(async () => {
	switchWas = memberFormSwitch.on
	memberFormSwitch.on = true
	db = await createTestDb()
	const owner = await createTestUser(db, "owner-cl")
	const seater = await createTestUser(db, "seater-cl")
	seaterId = seater.id
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Alice", description: "A knight." })
		.returning()
	cardId = card.id
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "Book" } as any)
		.returning()
	const m = await insertCastMember(db, {
		lorebookId: book.id,
		characterId: null,
		binding: "{{char:cl}}",
		name: "Wren",
		ownName: "Wren"
	} as any)
	memberId = m.member!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			lorebookId: book.id
		} as any)
		.returning()
	sessionId = session.id
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: cardId,
		position: 0
	} as any)
	const [cl] = await db
		.insert(schema.sessionCharacters)
		.values({
			sessionId,
			characterId: null,
			castMemberId: memberId,
			seatedByUserId: seaterId,
			position: 1
		} as any)
		.returning()
	cardlessSeatId = cl.id
	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: null,
		envoySlug: "castellan",
		position: 2
	} as any)
}, 60_000)

afterAll(() => {
	memberFormSwitch.on = switchWas
})

describe("session_cast: a card-less seat", () => {
	it("rides with the member's name, no id, its ref and the seater; the envoy is not a character seat", async () => {
		const read = await readCast()
		const rows = read.sessionCharacters as any[]
		expect(rows).toHaveLength(2)
		const row = rows.find((r) => r.seatId === cardlessSeatId)
		expect(row.character.name).toBe("Wren")
		expect("id" in row.character).toBe(false)
		expect(row.castMemberId).toBe(memberId)
		expect(row.ref).toBe(`seated-member:${memberId}`)
		expect(row.cardId).toBeNull()
		expect(row.seatedByUserId).toBe(seaterId)
		expect(rows.some((r) => r.character?.name === "castellan")).toBe(false)
	})

	it("the carded seat keeps its shape", async () => {
		const read = await readCast()
		const row = (read.sessionCharacters as any[]).find(
			(r) => r.character.id === cardId
		)
		expect(row.character.name).toBe("Alice")
		expect(row.castMemberId).toBeNull()
		expect(row.ref).toBe(`character:${cardId}`)
		expect(row.cardId).toBe(cardId)
		expect(row.enabled).toBe(true)
		expect(row.absorbedAliases).toEqual([])
		expect(row.seatedByUserId).toBeNull()
	})

	it("a departed card-less seat rides with removedAt set", async () => {
		const removedAt = new Date()
		await db
			.update(schema.sessionCharacters)
			.set({ removedAt })
			.where(eq(schema.sessionCharacters.id, cardlessSeatId))
		const row = ((await readCast()).sessionCharacters as any[]).find(
			(r) => r.seatId === cardlessSeatId
		)
		expect(row.removedAt).toBeTruthy()
		await db
			.update(schema.sessionCharacters)
			.set({ removedAt: null })
			.where(eq(schema.sessionCharacters.id, cardlessSeatId))
	})
})

describe("build-template-context: a card-less speaker", () => {
	it("names the member as {{char}} and on the seed line", async () => {
		const read = await readCast()
		const built: any = await coreBindings()[
			"core:task/build-template-context@1"
		]!(
			{
				cast: read,
				prompts: { systemPrompt: "Be brief." },
				speaker: `seated-member:${memberId}`,
				currentCharacterId: null
			} as any,
			{
				signal: new AbortController().signal,
				progress: () => {},
				log: () => {}
			} as any
		)
		expect(built.kind).toBe("ok")
		expect(built.value.templateContext.char).toBe("Wren")
	})
})
