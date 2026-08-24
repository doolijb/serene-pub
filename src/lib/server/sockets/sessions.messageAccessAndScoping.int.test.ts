/**
 * Round-4 audit fixes, session pipeline lane:
 *  - 1a: sessionMessageHandler ("sessionMessage" event) used to fetch a message
 *      by id with no checkSessionAccess call — unlike every sibling handler in
 *      this file — letting any authenticated user read any session message on
 *      the instance by guessing/incrementing ids.
 *  - 1b: sessionsCreateHandler/sessionsUpdateHandler used to accept an
 *      unvalidated lorebookId (and, on update, userId) straight from the
 *      client payload, letting a user attach another user's private
 *      lorebook to their own session, or reassign the session's owner.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
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
		path.join(os.tmpdir(), "serene-pub-sessions-msg-scoping-int-test-")
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
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

async function makeSession(
	userId: number,
	extra: Record<string, unknown> = {}
) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, ...extra })
		.returning()
	return session
}

async function makeLorebook(userId: number, name = "Test Book") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

describe("sessionMessage — access control (PGlite integration)", () => {
	test("rejects fetching a message from a session the caller has no access to", async () => {
		const { sessionMessageHandler } = await import("./sessions")
		const owner = await makeUser("sessionmsg-owner")
		const attacker = await makeUser("sessionmsg-attacker")
		const session = await makeSession(owner.id)
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "user",
				content: "secret content"
			})
			.returning()

		await expect(
			sessionMessageHandler.handler(
				fakeSocket(attacker.id),
				{ id: message.id },
				noopEmit
			)
		).rejects.toThrow()
	})

	test("the session owner can still fetch their own message by id", async () => {
		const { sessionMessageHandler } = await import("./sessions")
		const owner = await makeUser("sessionmsg-owner-2")
		const session = await makeSession(owner.id)
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "user", content: "hello" })
			.returning()

		const res = await sessionMessageHandler.handler(
			fakeSocket(owner.id),
			{ id: message.id },
			noopEmit
		)

		expect(res.sessionMessage?.id).toBe(message.id)
		expect(res.sessionMessage?.content).toBe("hello")
	})
})

describe("sessions:create — lorebookId scoping (PGlite integration)", () => {
	test("rejects a lorebookId the caller doesn't own", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const owner = await makeUser("sessioncreate-owner")
		const attacker = await makeUser("sessioncreate-attacker")
		const foreignLorebook = await makeLorebook(owner.id, "Owner's Book")

		await expect(
			sessionsCreateHandler.handler(
				fakeSocket(attacker.id),
				{ session: { lorebookId: foreignLorebook.id } } as any,
				noopEmit
			)
		).rejects.toThrow()
	})

	test("accepts a lorebookId the caller owns", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const owner = await makeUser("sessioncreate-owner-2")
		const ownLorebook = await makeLorebook(owner.id, "My Book")

		const res = await sessionsCreateHandler.handler(
			fakeSocket(owner.id),
			{ session: { lorebookId: ownLorebook.id } } as any,
			noopEmit
		)

		expect(
			(res as any).session?.lorebookId ?? (res as any).lorebookId
		).toBe(ownLorebook.id)
	})
})

describe("sessions:update — allowlist + lorebookId scoping (PGlite integration)", () => {
	test("ignores a foreign userId and rejects a foreign lorebookId", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("sessionupdate-owner")
		const attacker = await makeUser("sessionupdate-attacker")
		const session = await makeSession(owner.id)
		const foreignLorebook = await makeLorebook(
			attacker.id,
			"Attacker's Book"
		)

		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(owner.id),
				{
					session: {
						id: session.id,
						lorebookId: foreignLorebook.id
					} as any
				},
				noopEmit
			)
		).rejects.toThrow()

		// userId reassignment: no ownership gate exists to reject this
		// (the caller legitimately owns the session), so it must be silently
		// ignored by the allowlist instead.
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				session: {
					id: session.id,
					name: "Renamed",
					userId: attacker.id
				} as any
			},
			noopEmit
		)
		const reloaded = await testDb.query.sessions.findFirst({
			where: eq(schema.sessions.id, session.id)
		})
		expect(reloaded!.userId).toBe(owner.id)
		expect(reloaded!.name).toBe("Renamed")
	})

	test("applies allowlisted fields including an owned lorebookId", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeUser("sessionupdate-owner-2")
		const session = await makeSession(owner.id)
		const ownLorebook = await makeLorebook(owner.id, "Own Book")

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				session: {
					id: session.id,
					name: "New Name",
					scenario: "A scenario",
					lorebookId: ownLorebook.id
				} as any
			},
			noopEmit
		)

		const reloaded = await testDb.query.sessions.findFirst({
			where: eq(schema.sessions.id, session.id)
		})
		expect(reloaded!.name).toBe("New Name")
		expect(reloaded!.scenario).toBe("A scenario")
		expect(reloaded!.lorebookId).toBe(ownLorebook.id)
	})
})
