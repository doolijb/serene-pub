/**
 * Round-11 audit fix (MEDIUM): connections.extraJson.apiKey was stored
 * plaintext in the DB despite the app already owning an AES-256-GCM
 * encryption-at-rest utility (tokenCrypto.ts, previously used only for the
 * CharaVault app password). connectionsCreate/connectionsUpdate now
 * encrypt a plain-string apiKey before writing; connectionsGet decrypts it
 * back before returning to the client (the edit form loads the real key
 * into its input on edit, same as before this fix — what changed is the
 * DB storage, not what the admin client sees). A legacy plaintext row
 * (never re-saved through this path) still round-trips correctly.
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
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-connections-apikey-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// connectionsCreate auto-sets the first-ever connection as the instance
	// default (connectionsSetUserActive -> systemSettingsGet), which needs a
	// seeded row at id=1 specifically (systemSettingsGet queries
	// eq(id, 1)) — the real app's migrations seed this, a fresh test DB
	// doesn't, and the identity column's own default wouldn't reliably
	// generate id=1 here (createTestDb()'s post-migration sequence resync
	// leaves the next generated id at 2, not 1, for a table with no
	// pre-existing rows).
	await testDb.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

describe("connections:create/get — apiKey encryption at rest", () => {
	test("a plain-string apiKey is encrypted in the DB row and decrypted back through connections:get", async () => {
		const { connectionsCreate, connectionsGet } = await import(
			"./connections"
		)
		const admin = await makeAdmin("connections-apikey-create-user")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "Anthropic",
					type: "anthropic",
					extraJson: { apiKey: "sk-ant-super-secret-12345" }
				} as any
			},
			noopEmit
		)

		const rawRow = await testDb.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, created.connection.id)
		})
		expect(rawRow?.extraJson.apiKey).not.toBe("sk-ant-super-secret-12345")
		expect(typeof rawRow?.extraJson.apiKey).toBe("object")
		expect(rawRow?.extraJson.apiKey.__enc).toBe(true)

		const fetched = await connectionsGet.handler(
			fakeSocket(admin.id),
			{ id: created.connection.id },
			noopEmit
		)
		expect(fetched.connection!.extraJson.apiKey).toBe(
			"sk-ant-super-secret-12345"
		)
	})

	test("connections:update re-encrypts a new plain-string apiKey", async () => {
		const { connectionsCreate, connectionsUpdate, connectionsGet } =
			await import("./connections")
		const admin = await makeAdmin("connections-apikey-update-user")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "OpenAI",
					type: "openai",
					extraJson: { apiKey: "sk-old-key" }
				} as any
			},
			noopEmit
		)
		const beforeRow = await testDb.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, created.connection.id)
		})
		const ciphertextBefore = beforeRow?.extraJson.apiKey.ciphertext

		await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: created.connection.id,
					extraJson: { apiKey: "sk-new-key" }
				} as any
			},
			noopEmit
		)

		const rawRow = await testDb.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, created.connection.id)
		})
		expect(rawRow?.extraJson.apiKey.__enc).toBe(true)
		expect(rawRow?.extraJson.apiKey.ciphertext).not.toBe(ciphertextBefore)

		const fetched = await connectionsGet.handler(
			fakeSocket(admin.id),
			{ id: created.connection.id },
			noopEmit
		)
		expect(fetched.connection!.extraJson.apiKey).toBe("sk-new-key")
	})

	test("a legacy plaintext apiKey row (never re-saved through this path) still round-trips via connections:get", async () => {
		const { connectionsGet } = await import("./connections")
		const admin = await makeAdmin("connections-apikey-legacy-user")

		const [legacyConn] = await testDb
			.insert(schema.connections)
			.values({
				name: "Legacy Conn",
				type: "openai",
				extraJson: { apiKey: "sk-legacy-plaintext-key" }
			})
			.returning()

		const fetched = await connectionsGet.handler(
			fakeSocket(admin.id),
			{ id: legacyConn.id },
			noopEmit
		)
		expect(fetched.connection!.extraJson.apiKey).toBe(
			"sk-legacy-plaintext-key"
		)
	})
})
