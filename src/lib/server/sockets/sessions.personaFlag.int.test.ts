/**
 * Attaching a character as a session's voice IS the user saying they play it.
 *
 * `characters.is_persona` is a LIBRARY fact — "one of your personas", what the
 * persona picker is filtered by — while `session_personas` is the fact that
 * varies per session. They are kept in step by `markCharacterAsPersona`, called
 * from every `session_personas` insert, and this is what says so: without it a
 * character voiced in a session would be missing from the picker that offers it
 * next time, which is the shape of "the app forgot".
 *
 * ⚠ Never CLEARED automatically. Detaching is not the user saying they stopped
 * playing someone — the picker would empty itself behind them — so the removal
 * case below asserts the flag SURVIVES.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-persona-flag-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId }, io: undefined } as any
}

const noopEmit = () => {}

/** A plain character — nobody's persona yet. */
async function makeCharacter(userId: number, name: string) {
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	expect(character.isPersona).toBe(false)
	return character
}

async function makeSession(userId: number) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "A walk" })
		.returning()
	return session
}

async function isPersona(characterId: number) {
	const row = await testDb.query.characters.findFirst({
		where: (c, { eq }) => eq(c.id, characterId),
		columns: { isPersona: true }
	})
	return row?.isPersona
}

describe("sessions:addPersona — the auto-flag (PGlite integration)", () => {
	test("attaching an unflagged character as a session's voice flags it", async () => {
		const { sessionsAddPersonaHandler } = await import("./sessions")
		const user = await makeUser("addpersona-flag-user")
		const session = await makeSession(user.id)
		const character = await makeCharacter(user.id, "Warren")

		const res = await sessionsAddPersonaHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, personaId: character.id },
			noopEmit
		)
		expect(res.success).toBe(true)

		// The membership row and the library fact land together.
		const membership = await testDb.query.sessionPersonas.findFirst({
			where: and(
				eq(schema.sessionPersonas.sessionId, session.id),
				eq(schema.sessionPersonas.personaId, character.id)
			)
		})
		expect(membership).toBeTruthy()
		expect(await isPersona(character.id)).toBe(true)
	})

	test("a character somebody else owns is refused, and stays unflagged", async () => {
		const { sessionsAddPersonaHandler } = await import("./sessions")
		const owner = await makeUser("addpersona-owner")
		const outsider = await makeUser("addpersona-outsider")
		const session = await makeSession(outsider.id)
		const theirs = await makeCharacter(owner.id, "Not Yours")

		const res = await sessionsAddPersonaHandler.handler(
			fakeSocket(outsider.id),
			{ sessionId: session.id, personaId: theirs.id },
			noopEmit
		)
		expect(res.success).toBe(false)
		expect(await isPersona(theirs.id)).toBe(false)
	})

	test("the flag survives being removed from the session", async () => {
		const { sessionsAddPersonaHandler } = await import("./sessions")
		const user = await makeUser("addpersona-removal-user")
		const session = await makeSession(user.id)
		const character = await makeCharacter(user.id, "Vex")

		await sessionsAddPersonaHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, personaId: character.id },
			noopEmit
		)
		expect(await isPersona(character.id)).toBe(true)

		// The soft-delete the participant-removal path writes.
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date(), removedName: "Vex" })
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, session.id),
					eq(schema.sessionPersonas.personaId, character.id)
				)
			)

		// Un-flagging is always a decision the user made.
		expect(await isPersona(character.id)).toBe(true)
	})

	test("creating a session with personaIds flags every one of them", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser("createsession-flag-user")
		const first = await makeCharacter(user.id, "First voice")
		const second = await makeCharacter(user.id, "Second voice")

		await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "Two voices", isGroup: false } as any,
				personaIds: [first.id, second.id]
			} as any,
			noopEmit
		)

		expect(await isPersona(first.id)).toBe(true)
		expect(await isPersona(second.id)).toBe(true)
	})
})
