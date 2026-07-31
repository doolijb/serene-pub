/**
 * Round-13 audit fix (MEDIUM): systemSettingsUpdateAccountsEnabled only
 * special-cased params.enabled === true (re-checking a passphrase exists).
 * Two gaps:
 *  - It could be silently flipped back to false even though the client's
 *    own UI text says "This setting cannot be reversed" — that claim was
 *    purely cosmetic (a disabled Switch), not server-enforced.
 *  - On a false -> true transition, every socket that connected while
 *    accounts were disabled had been auto-attached to the fallback admin
 *    with no token (authMiddleware, which only runs once at handshake) —
 *    nothing evicted those sessions, so they kept full unauthenticated
 *    admin access indefinitely even after the instance was "locked down".
 * Fixed by throwing before any change when enabled === false and accounts
 * are currently enabled, and by disconnecting the fallback admin's whole
 * room (socket.io.to("user_"+fallbackAdminId).disconnectSockets(true)) after
 * a successful false -> true transition, mirroring the existing
 * setPassphrase/changePassphrase "emit success, then evict" ordering. A
 * single disconnectSockets(true) call on that room evicts every socket
 * joined to it (not just one) — that's Socket.IO's own room semantics, not
 * something re-tested here.
 *
 * The real migrations seed a default user (id: 1, username "admin") and a
 * later migration always promotes it to isAdmin: true — so id 1 is always
 * the fallback admin authMiddleware auto-attaches every disabled-mode
 * connection to (lowest-id admin). Tests below act as that seeded user
 * rather than creating a separate admin, matching what's actually possible
 * in disabled-accounts mode: every caller's socket.user.id is already the
 * fallback admin's id, since that's the only identity auth.ts ever hands
 * out while accounts are disabled.
 *
 * systemSettings is a singleton row (id: 1), so each test below gets its
 * own fresh in-memory PGlite instance (rather than sharing one testDb
 * across the file, the usual convention) to keep transition-order
 * assertions independent of each other.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let dataDir: string

beforeAll(async () => {
	// The mocked "$lib/server/db" module still spreads the *real* module's
	// other exports (importOriginal) — importing it at all runs its
	// module-level side effects (opening a real PGlite client, syncing
	// defaults) against whatever SERENE_PUB_DATA_DIR points at. Must be set
	// to an isolated temp dir before that first import, same as every other
	// *.int.test.ts file in this codebase — otherwise it touches the real
	// dev data directory.
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-accounts-enabled-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const { getDb, setDb } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		}
	}
})

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	return {
		...actual,
		get db() {
			return getDb()
		}
	}
})

async function freshTestDb(): Promise<TestDb> {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	setDb(db)
	return db
}

/** The migrations always seed user id 1 ("admin") and promote it to isAdmin: true. */
async function seededAdminId(testDb: TestDb): Promise<number> {
	const admin = await testDb.query.users.findFirst({
		where: eq(schema.users.username, "admin")
	})
	if (!admin) throw new Error("seeded admin user not found")
	return admin.id
}

function fakeSocket(userId: number, io: any) {
	return { user: { id: userId, isAdmin: true }, io } as any
}

function makeIoSpy() {
	const disconnected: string[] = []
	const io = {
		to: (room: string) => ({
			emit: () => {},
			disconnectSockets: () => {
				disconnected.push(room)
			}
		})
	}
	return { io, disconnected }
}

const noopEmit = () => {}

describe("systemSettings:updateAccountsEnabled — one-way transition + fallback-admin eviction (Round-13 audit fix, PGlite integration)", () => {
	test("enabling accounts disconnects the fallback admin's room, including the caller's own socket", async () => {
		const testDb = await freshTestDb()
		await testDb.insert(schema.systemSettings).values({ id: 1 })
		const adminId = await seededAdminId(testDb)
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: adminId.toString(),
			passphrase: "Correct-Horse-Battery-9"
		})

		const { systemSettingsUpdateAccountsEnabled } = await import(
			"./systemSettings"
		)
		const { io, disconnected } = makeIoSpy()
		const res = await systemSettingsUpdateAccountsEnabled.handler(
			fakeSocket(adminId, io),
			{ enabled: true } as any,
			noopEmit
		)

		expect(res.success).toBe(true)
		// The fallback admin is the lowest-id admin — the same user this
		// test's caller is impersonating, so their own socket room is among
		// those evicted.
		expect(disconnected).toEqual([`user_${adminId}`])

		const row = await testDb.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1)
		})
		expect(row?.isAccountsEnabled).toBe(true)
	}, 30_000)

	test("attempting to re-disable accounts after enabling throws, and the setting stays true", async () => {
		const testDb = await freshTestDb()
		await testDb.insert(schema.systemSettings).values({ id: 1 })
		const adminId = await seededAdminId(testDb)
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: adminId.toString(),
			passphrase: "Correct-Horse-Battery-9"
		})

		const { systemSettingsUpdateAccountsEnabled } = await import(
			"./systemSettings"
		)
		const { io } = makeIoSpy()
		await systemSettingsUpdateAccountsEnabled.handler(
			fakeSocket(adminId, io),
			{ enabled: true } as any,
			noopEmit
		)

		await expect(
			systemSettingsUpdateAccountsEnabled.handler(
				fakeSocket(adminId, io),
				{ enabled: false } as any,
				noopEmit
			)
		).rejects.toThrow(/cannot be disabled/i)

		const row = await testDb.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1)
		})
		expect(row?.isAccountsEnabled).toBe(true)
	}, 30_000)

	test("disabling accounts when they were never enabled is a no-op, not an error, and evicts no one", async () => {
		const testDb = await freshTestDb()
		await testDb.insert(schema.systemSettings).values({ id: 1 })
		const adminId = await seededAdminId(testDb)

		const { systemSettingsUpdateAccountsEnabled } = await import(
			"./systemSettings"
		)
		const { io, disconnected } = makeIoSpy()
		const res = await systemSettingsUpdateAccountsEnabled.handler(
			fakeSocket(adminId, io),
			{ enabled: false } as any,
			noopEmit
		)
		expect(res.success).toBe(true)
		expect(disconnected).toEqual([])

		const row = await testDb.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1)
		})
		expect(row?.isAccountsEnabled).toBe(false)
	}, 30_000)
})
