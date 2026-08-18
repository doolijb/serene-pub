/**
 * "New" in the config sidebars builds its payload by spreading the currently
 * selected config and deleting a couple of fields (`id`, `isImmutable`). It
 * never deleted `seedKey` — which marks a BUILT-IN seeded config and carries a
 * UNIQUE index — so cloning a seeded config sent that key straight back and the
 * insert died:
 *
 *   duplicate key value violates unique constraint "sampling_configs_seed_key_unique"
 *   Key (seed_key)=(sampling-default) already exists.
 *
 *   duplicate key value violates unique constraint "prompt_configs_seed_key_unique"
 *   Key (seed_key)=(prompt-roleplay-immersive) already exists.
 *
 * Fixed server-side rather than in the sidebar, because a handler must not
 * trust its payload — the sidebar was already stripping `id` and still missed
 * this. These tests drive the handlers with a hostile payload (a seedKey AND an
 * id belonging to an existing row) and assert both are ignored.
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
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-seedkey-strip-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
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
const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any
const noopEmit = () => {}

describe("config create handlers strip client-supplied seedKey", () => {
	test("sampling: cloning the seeded default no longer collides", async () => {
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("seedkey-sampling-admin")

		// The test DB starts empty (createTestDb does not run the seeders), so
		// stand up the seeded row this test is about rather than depending on
		// seed data that may or may not be present.
		const [seeded] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Default", seedKey: "sampling-default" })
			.returning()

		// Exactly what the sidebar sends: the whole seeded row, minus id.
		const { id, isImmutable, ...clone } = seeded as any
		const res = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { ...clone, name: "My Clone" } } as any,
			noopEmit as any
		)

		expect(res.sampling.name).toBe("My Clone")
		expect(res.sampling.id).not.toBe(seeded!.id)
		expect(
			res.sampling.seedKey,
			"a user-created config must never claim a seed key"
		).toBeNull()

		// The seeded row is untouched and still the only holder of that key.
		const holders = await testDb.query.samplingConfigs.findMany({
			where: eq(schema.samplingConfigs.seedKey, "sampling-default")
		})
		expect(holders).toHaveLength(1)
		expect(holders[0].id).toBe(seeded!.id)
	}, 60_000)

	test("prompt configs: same fix, the other reported constraint", async () => {
		const { promptConfigsCreate } = await import("./promptConfigs")
		const admin = await makeAdmin("seedkey-prompt-admin")

		const [seeded] = await testDb
			.insert(schema.promptConfigs)
			.values({
				name: "Immersive",
				systemPrompt: "You are a helpful narrator.",
				seedKey: "prompt-roleplay-immersive"
			})
			.returning()

		const { id, isImmutable, ...clone } = seeded as any
		const res = await promptConfigsCreate.handler(
			fakeSocket(admin.id),
			{ promptConfig: { ...clone, name: "Prompt Clone" } } as any,
			noopEmit as any
		)
		expect(res.promptConfig.id).not.toBe(seeded!.id)
		expect(res.promptConfig.seedKey).toBeNull()
	}, 60_000)

	test("cloning the SAME seeded config twice both succeed — the stripped key must be NULL, not \"\"", async () => {
		// This is the assertion that actually protects the fix. A unique index
		// treats NULLs as distinct, so any number of user-created rows can
		// hold a null seed_key. An empty string would NOT be distinct, so
		// stripping to "" instead of dropping the field would pass the first
		// clone and then collide on the second with the very same
		// "..._seed_key_unique" error this fix exists to remove.
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("seedkey-twice-admin")

		const [seeded] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Twice Seed", seedKey: "sampling-twice" })
			.returning()
		const { id, isImmutable, ...clone } = seeded as any

		const first = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { ...clone, name: "Clone A" } } as any,
			noopEmit as any
		)
		const second = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { ...clone, name: "Clone B" } } as any,
			noopEmit as any
		)

		expect(first.sampling.seedKey).toBeNull()
		expect(second.sampling.seedKey).toBeNull()
		expect(first.sampling.seedKey).not.toBe("")
		expect(second.sampling.id).not.toBe(first.sampling.id)

		// The seeded row still uniquely owns its key.
		const holders = await testDb.query.samplingConfigs.findMany({
			where: eq(schema.samplingConfigs.seedKey, "sampling-twice")
		})
		expect(holders).toHaveLength(1)
	}, 60_000)

	test("a client-supplied id cannot overwrite or collide with an existing row", async () => {
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("seedkey-id-admin")

		const [existing] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Existing" })
			.returning()
		const before = await testDb.query.samplingConfigs.findMany()

		const res = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { id: existing!.id, name: "Hostile" } } as any,
			noopEmit as any
		)

		expect(res.sampling.id).not.toBe(existing!.id)
		const after = await testDb.query.samplingConfigs.findMany()
		expect(after.length).toBe(before.length + 1)
	}, 60_000)
})
