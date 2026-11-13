/**
 * 🚧 The session's relational card reads take their words from the card's
 * current card version (`cardsNow`), never from the `characters` row's
 * content columns (cv-sweep w2; owner ruling 2026-11-05: "Everything in
 * session is cast -> active card"). The stale value is written straight into
 * the row here to prove it is not read.
 *
 * Covered through the handlers that reach the reads: `sessions:list`,
 * `sessions:get` (`getSessionFromDB`), and the participant sync's departed
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	cardProfileOf,
	insertCastMember,
	newCardVersion
} from "$lib/server/characters/versions"

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
		path.join(os.tmpdir(), "serene-pub-vitest-cardsnow-reads-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db
const socketOf = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

/** A card whose current version says one thing and whose row says another. */
async function staleCard(userId: number, isPersona: boolean) {
	const k = ++n
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: `Old name ${k}`,
			description: "Old description.",
			isPersona
		} as any)
		.returning()
	const v1 = cardProfileOf(row as any)
	await newCardVersion(db(), row!.id, {
		...v1,
		name: `Fresh name ${k}`,
		description: "Fresh description.",
		greetings: [{ text: "Fresh hello." }],
		postHistoryInstructions: "Fresh post-history."
	})
	await testDb
		.update(schema.characters)
		.set({
			name: `Stale name ${k}`,
			description: "Stale description.",
			firstMessage: "Stale hello.",
			postHistoryInstructions: "Stale post-history."
		} as any)
		.where(eq(schema.characters.id, row!.id))
	return { id: row!.id, fresh: `Fresh name ${k}` }
}

async function seatedSession() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `cardsnow-reads-${++n}`)
	const char = await staleCard(owner.id, false)
	const persona = await staleCard(owner.id, true)
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, name: `Run ${++n}` } as any)
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: s!.id, characterId: char.id, position: 0 } as any)
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: s!.id, personaId: persona.id, position: 0 } as any)
	return { owner, session: s!, char, persona }
}

describe("session reads: cards as their current card version has them", () => {
	test("sessions:list names each seat from its current version", async () => {
		const { owner, session, char, persona } = await seatedSession()
		const { sessionsListHandler } = await import("./sessions")
		const res: any = await sessionsListHandler.handler(
			socketOf(owner.id),
			{},
			() => {}
		)
		const row = res.sessionList.find((r: any) => r.id === session.id)
		expect(row.sessionCharacters[0].character.name).toBe(char.fresh)
		expect(row.sessionPersonas[0].persona.name).toBe(persona.fresh)
		// The trimmed wire shape stays trimmed.
		expect(Object.keys(row.sessionCharacters[0].character).sort()).toEqual([
			"avatarMedia",
			"avatarMediaId",
			"id",
			"name"
		])
	})

	test("sessions:get carries each seat's card words from its current version", async () => {
		const { owner, session, char, persona } = await seatedSession()
		const { sessionsGetHandler } = await import("./sessions")
		const res: any = await sessionsGetHandler.handler(
			socketOf(owner.id),
			{ id: session.id } as any,
			() => {}
		)
		const c = res.session.sessionCharacters[0].character
		expect(c.name).toBe(char.fresh)
		expect(c.description).toBe("Fresh description.")
		expect(c.firstMessage).toBe("Fresh hello.")
		expect(c.postHistoryInstructions).toBe("Fresh post-history.")
		expect(c).toHaveProperty("spriteSets")
		expect(c).toHaveProperty("avatarMedia")
		const p = res.session.sessionPersonas[0].persona
		expect(p.name).toBe(persona.fresh)
		expect(p.description).toBe("Fresh description.")
	})

	test("removing a seat keeps the card's current name, not the row's copy", async () => {
		const { owner, session, char, persona } = await seatedSession()
		const { sessionsUpdateHandler } = await import("./sessions")
		// Benched first, then removed (the name is snapshotted on removal).
		for (let pass = 0; pass < 2; pass++)
			await sessionsUpdateHandler.handler(
				socketOf(owner.id),
				{
					session: { id: session.id },
					characterIds: [],
					personaIds: []
				} as any,
				() => {}
			)
		const [cc] = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, session.id))
		const [cp] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, session.id))
		expect(cc!.removedName).toBe(char.fresh)
		expect(cp!.removedName).toBe(persona.fresh)
	})
})

/** The frozen binding columns a relational read of bindings must not load. */
const FROZEN_BINDING_COLUMNS = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"faceMediaId",
	"retold",
	"ownName",
	"ownNickname",
	"timbre",
	"spriteSet",
	"nodeState",
	"nodeVisibility"
]

describe("the prompt session: cards as their current card version has them", () => {
	test("live seats, a removed seat and the book's bindings read the new version", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		const owner = await createTestUser(testDb, `prompt-session-${++n}`)
		const live = await staleCard(owner.id, false)
		const gone = await staleCard(owner.id, false)
		const persona = await staleCard(owner.id, true)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: `Run ${++n}`
			} as any)
			.returning()
		const book = await insertOwnBook(db(), {
			sessionId: s!.id,
			userId: owner.id,
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: book.id })
			.where(eq(schema.sessions.id, s!.id))
		await insertCastMember(db(), {
			lorebookId: book.id,
			characterId: live.id,
			binding: `{{char:${++n}}}`,
			name: "member"
		} as any)
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: s!.id,
				characterId: live.id,
				castMemberId: null,
				position: 0
			},
			{
				sessionId: s!.id,
				characterId: gone.id,
				castMemberId: null,
				position: 1,
				removedAt: new Date()
			}
		] as any)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s!.id,
			personaId: persona.id,
			position: 0
		} as any)

		const { getPromptSessionFromDb } = await import("./sessions")
		const session: any = await getPromptSessionFromDb(s!.id, owner.id)

		const c = session.sessionCharacters[0].character
		expect(c.name).toBe(live.fresh)
		expect(c.description).toBe("Fresh description.")
		expect(c.firstMessage).toBe("Fresh hello.")
		expect(c.postHistoryInstructions).toBe("Fresh post-history.")
		expect(session.sessionPersonas[0].persona.name).toBe(persona.fresh)
		expect(session.removedSessionCharacters[0].character.name).toBe(
			gone.fresh
		)
		const bindings = session.lorebook.lorebookBindings
		expect(bindings.length).toBeGreaterThan(0)
		for (const b of bindings) {
			for (const col of FROZEN_BINDING_COLUMNS)
				expect(b).not.toHaveProperty(col)
			if (b.characterId === live.id)
				expect(b.character.name).toBe(live.fresh)
		}
	})
})
