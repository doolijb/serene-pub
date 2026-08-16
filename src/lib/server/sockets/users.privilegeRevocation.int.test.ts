/**
 * Round-4 audit fixes, auth/session lane:
 *  - 2c: socket.user is only set at connect time and never re-validated —
 *      usersUpdate demoting an admin, or usersDelete deleting a user, used
 *      to have no effect on that user's already-open socket. Now both
 *      force-disconnect the affected user's room, strictly AFTER emitting
 *      the caller's own response (self-demotion shares a room with the
 *      socket about to be killed).
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

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-users-privrevoke-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string, isAdmin = false) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin })
		.returning()
	return user
}

function makeOrderedSpies() {
	const calls: string[] = []
	const emitToUser = (event: string) => {
		calls.push(`emit:${event}`)
	}
	const io = {
		to: (room: string) => ({
			emit: () => {},
			disconnectSockets: () => {
				calls.push(`disconnect:${room}`)
			}
		})
	}
	return { calls, emitToUser, io }
}

describe("users:update — privilege revocation (PGlite integration)", () => {
	test("demoting another admin disconnects their room, after emitting the caller's own response", async () => {
		const { usersUpdate } = await import("./users")
		const admin = await makeUser("privrevoke-admin", true)
		const target = await makeUser("privrevoke-target-admin", true)

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersUpdate.handler(
			{ user: { id: admin.id }, io },
			{ id: target.id, isAdmin: false } as any,
			emitToUser
		)

		expect(calls).toEqual(["emit:users:update", `disconnect:user_${target.id}`])

		const reloaded = await testDb.query.users.findFirst({
			where: eq(schema.users.id, target.id)
		})
		expect(reloaded!.isAdmin).toBe(false)
	})

	test("self-demotion still emits the response before disconnecting the caller's own room", async () => {
		const { usersUpdate } = await import("./users")
		const admin = await makeUser("privrevoke-self-admin", true)

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersUpdate.handler(
			{ user: { id: admin.id }, io },
			{ id: admin.id, isAdmin: false } as any,
			emitToUser
		)

		expect(calls).toEqual(["emit:users:update", `disconnect:user_${admin.id}`])
	})

	test("an update that doesn't touch isAdmin doesn't force a disconnect", async () => {
		const { usersUpdate } = await import("./users")
		const admin = await makeUser("privrevoke-noop-admin", true)
		const target = await makeUser("privrevoke-noop-target")

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersUpdate.handler(
			{ user: { id: admin.id }, io },
			{ id: target.id, displayName: "New Name" } as any,
			emitToUser
		)

		expect(calls).toEqual(["emit:users:update"])
	})
})

describe("users:update — admin-initiated passphrase reset (Round-8 audit fix)", () => {
	test("revokes the target's existing tokens and disconnects their sockets, strictly after emitting", async () => {
		const { usersUpdate } = await import("./users")
		const admin = await makeUser("passreset-admin", true)
		const target = await makeUser("passreset-target")
		const userTokens = await import("$lib/server/providers/users/tokens")
		await userTokens.create({ userId: target.id.toString() })

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersUpdate.handler(
			{ user: { id: admin.id }, io },
			{
				id: target.id,
				// usersUpdate's .set() throws on an empty update object —
				// echo the unchanged username, same as the admin UI always
				// does, so this isn't a passphrase-only no-op update.
				username: target.username,
				passphrase: "New-Correct-Horse-9"
			} as any,
			emitToUser
		)

		expect(calls).toEqual([
			"emit:users:update",
			`disconnect:user_${target.id}`
		])

		const tokens = await testDb.query.userTokens.findMany({
			where: eq(schema.userTokens.userId, target.id)
		})
		expect(tokens.length).toBeGreaterThan(0)
		expect(tokens.every((t) => t.expiresAt <= new Date())).toBe(true)
	})

	test("an update with no passphrase doesn't touch tokens or force a disconnect", async () => {
		const { usersUpdate } = await import("./users")
		const admin = await makeUser("passreset-noop-admin", true)
		const target = await makeUser("passreset-noop-target")
		const userTokens = await import("$lib/server/providers/users/tokens")
		await userTokens.create({ userId: target.id.toString() })

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersUpdate.handler(
			{ user: { id: admin.id }, io },
			{ id: target.id, displayName: "New Name" } as any,
			emitToUser
		)

		expect(calls).toEqual(["emit:users:update"])

		const tokens = await testDb.query.userTokens.findMany({
			where: eq(schema.userTokens.userId, target.id)
		})
		expect(tokens.every((t) => t.expiresAt > new Date())).toBe(true)
	})
})

describe("users:delete — privilege revocation (PGlite integration)", () => {
	test("disconnects the deleted user's room, after emitting the caller's own response", async () => {
		const { usersDelete } = await import("./users")
		const admin = await makeUser("privrevoke-delete-admin", true)
		const target = await makeUser("privrevoke-delete-target")

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersDelete.handler(
			{ user: { id: admin.id }, io },
			{ id: target.id } as any,
			emitToUser
		)

		expect(calls).toEqual(["emit:users:delete", `disconnect:user_${target.id}`])
	})
})
