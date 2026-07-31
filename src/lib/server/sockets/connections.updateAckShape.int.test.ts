/**
 * Bugfix: connections:update's ack used to return the raw `.returning()`
 * row — still-encrypted apiKey, not backfilled with any CONNECTION_DEFAULTS
 * keys added after the connection was created — unlike connections:get,
 * which runs the record through withConnectionDefaults + decryptApiKeyField
 * first. The client's dirty-tracking baseline (ConnectionsSidebar.svelte)
 * couldn't safely reset itself from that raw ack payload, and instead
 * relied on a second, incidental connections:get broadcast the update
 * handler happens to also send — a race that could show a stale
 * "unsaved changes" warning right after a successful save. Fixed by having
 * connections:update reuse connections:get's own fully-processed result for
 * its ack.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { stableStringify } from "$lib/shared/utils/connectionDefaults"
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
		path.join(os.tmpdir(), "serene-pub-connections-updateack-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// See connections.apiKeyEncryption.int.test.ts — connectionsCreate's
	// auto-default-on-first-connection path needs a seeded systemSettings
	// row at id=1.
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

describe("connections:update — ack payload shape (bugfix, PGlite integration)", () => {
	test("the update ack's apiKey is plaintext, not the encrypted envelope", async () => {
		const { connectionsCreate, connectionsUpdate } = await import(
			"./connections"
		)
		const admin = await makeAdmin("connections-updateack-apikey-user")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "Anthropic",
					type: "anthropic",
					extraJson: { apiKey: "sk-ant-original" }
				} as any
			},
			noopEmit
		)

		const updated = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: created.connection.id,
					name: "Anthropic Renamed"
				} as any
			},
			noopEmit
		)

		expect(updated.connection.name).toBe("Anthropic Renamed")
		// Plaintext, not the {__enc, ciphertext, ...} envelope stored in the DB.
		expect(updated.connection.extraJson.apiKey).toBe("sk-ant-original")
	})

	test("the update ack matches what a subsequent connections:get returns exactly", async () => {
		const { connectionsCreate, connectionsUpdate, connectionsGet } =
			await import("./connections")
		const admin = await makeAdmin("connections-updateack-parity-user")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "KCPP",
					type: "koboldcpp",
					extraJson: {}
				} as any
			},
			noopEmit
		)

		const updated = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: created.connection.id,
					model: "some-model"
				} as any
			},
			noopEmit
		)

		const fetched = await connectionsGet.handler(
			fakeSocket(admin.id),
			{ id: created.connection.id },
			noopEmit
		)

		expect(stableStringify(updated.connection)).toBe(
			stableStringify(fetched.connection)
		)
	})

	test("the update ack is already backfilled with CONNECTION_DEFAULTS keys the original row didn't have", async () => {
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("connections-updateack-backfill-user")

		// Simulate a connection created before trimStop/renderSpecial/etc
		// were added to CONNECTION_DEFAULTS[KOBOLDCPP] — a bare extraJson
		// with none of them.
		const [legacy] = await testDb
			.insert(schema.connections)
			.values({
				name: "Legacy KCPP",
				type: "koboldcpp",
				extraJson: { stream: true }
			})
			.returning()

		const updated = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{ connection: { id: legacy.id, name: "Legacy KCPP Renamed" } } as any,
			noopEmit
		)

		expect(updated.connection.extraJson).toMatchObject({
			trimStop: true,
			renderSpecial: false,
			bypassEos: false,
			grammarRetainState: false,
			logprobs: false,
			replaceInstructPlaceholders: false
		})
	})
})
