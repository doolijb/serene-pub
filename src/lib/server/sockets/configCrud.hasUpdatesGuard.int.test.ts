/**
 * Round-10 audit fix (MEDIUM): contextConfigsUpdate/samplingConfigsUpdate
 * went straight to db.update(...).set(updateData) with no check that
 * updateData was non-empty — an {id}-only payload on a mutable row hit
 * Drizzle's empty .set() and threw, unlike the already-fixed
 * promptConfigsUpdate/narratorPromptConfigsUpdate/
 * summarizePromptConfigsUpdate (round 8). Also: samplingConfigsCreate used
 * to call samplingConfigsSetUserActive after insert, silently making every
 * newly created sampling config the instance-wide default — unlike every
 * sibling *ConfigsCreate handler.
 *
 * That default used to be `systemSettings.defaultSamplingConfigId`. The column
 * is gone (0181) and `connection_defaults` is the only store, so the assertions
 * below read the table. Same subject, same bug guarded; the assertion had to
 * move or it would have compiled to a comparison of two `undefined`s.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// samplingConfigs.ts/contextConfigs.ts transitively import $lib/server/auth
// (via ./users), which needs getCryptoSecretKey() at import time — stubbed
// directly here rather than via importOriginal(), which would otherwise
// trigger $lib/server/db/index.ts's own module-level meta.json read/write
// against the real on-disk dev data dir as an import side effect.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-config-crud-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
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

describe("contextConfigsUpdate — empty .set() guard", () => {
	test("an {id}-only payload on a mutable row doesn't throw and returns the row unchanged", async () => {
		const { contextConfigsUpdate } = await import("./contextConfigs")
		const admin = await makeAdmin("config-crud-context-user")
		const [config] = await testDb
			.insert(schema.contextConfigs)
			.values({ name: "My Context", template: "original" })
			.returning()

		const res = await contextConfigsUpdate.handler(
			fakeSocket(admin.id),
			{ contextConfig: { id: config.id } as any },
			noopEmit
		)
		expect(res.contextConfig.id).toBe(config.id)
		expect(res.contextConfig.template).toBe("original")
	})
})

describe("samplingConfigsUpdate — empty .set() guard", () => {
	test("an {id}-only payload on a mutable row doesn't throw and returns the row unchanged", async () => {
		const { samplingConfigsUpdate } = await import("./samplingConfigs")
		const admin = await makeAdmin("config-crud-sampling-user")
		const [config] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "My Sampling",
				values: { temperature: 0.42 },
				enabled: ["temperature"]
			})
			.returning()

		const res = await samplingConfigsUpdate.handler(
			fakeSocket(admin.id),
			{ sampling: { id: config.id } as any },
			noopEmit
		)
		expect(res.sampling.id).toBe(config.id)
		expect(res.sampling.values.temperature).toBe(0.42)
	})

	test("a payload that does carry a change is still written", async () => {
		// The other half of the guard: it must skip the empty .set(), not
		// swallow a real edit alongside it.
		const { samplingConfigsUpdate } = await import("./samplingConfigs")
		const admin = await makeAdmin("config-crud-sampling-update-user")
		const [config] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "My Other Sampling",
				values: { temperature: 0.42 },
				enabled: ["temperature"]
			})
			.returning()

		const res = await samplingConfigsUpdate.handler(
			fakeSocket(admin.id),
			{
				sampling: {
					id: config.id,
					values: { temperature: 0.9 },
					enabled: ["temperature"]
				} as any
			},
			noopEmit
		)
		expect(res.sampling.id).toBe(config.id)
		expect(res.sampling.values.temperature).toBe(0.9)
	})
})

describe("samplingConfigsCreate — no longer sets the instance-wide default", () => {
	/**
	 * REPOINTED, not rewritten. The subject is unchanged — creating a config
	 * must not make it the instance default — but the place a default LIVES
	 * moved: `system_settings.default_sampling_id` is gone (0181) and
	 * `connection_defaults` is the only store. Asserting against the dropped
	 * column would have compiled to nothing and passed forever.
	 *
	 * It is asserted against the TABLE rather than deleted because it is the
	 * only coverage that create does not reach the defaults path at all, and
	 * that path is now a fan-out over every capability sharing the config's
	 * shape — strictly more to go wrong than the single column it replaced.
	 */
	test("creating a sampling config registers no capability default", async () => {
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("config-crud-sampling-create-user")

		const before = await testDb.select().from(schema.connectionDefaults)

		const res = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { name: "Fresh Sampling Config" } as any },
			noopEmit
		)

		const after = await testDb.select().from(schema.connectionDefaults)
		expect(after).toEqual(before)
		expect(
			after.some((r) => r.samplingConfigId === res.sampling.id),
			"the created config was registered as a default — samplingConfigsCreate is calling the star path again"
		).toBe(false)
	})

	test("starring one DOES register it, against every capability sharing its shape", async () => {
		// The other half, and the reason the assertion above is not vacuous: if
		// setUserActive had stopped writing anything, "create writes nothing"
		// would pass for the wrong reason. Text-gen is the shape a row with no
		// `shape` column takes, and `text->text` is the capability it speaks.
		const { samplingConfigsCreate, samplingConfigsSetUserActive } =
			await import("./samplingConfigs")
		const admin = await makeAdmin("config-crud-sampling-star-user")

		// The star path finishes by pushing `systemSettings:get`, which is how
		// every client's copy of `capabilityDefaults` refreshes — and that
		// handler throws on an instance with no settings row. A test DB is
		// migrated but not seeded, so the row has to exist here for the same
		// reason it exists on a real install.
		await testDb
			.insert(schema.systemSettings)
			.values({ id: 1 })
			.onConflictDoNothing()

		const res = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { name: "Starred Sampling Config" } as any },
			noopEmit
		)
		await samplingConfigsSetUserActive.handler(
			fakeSocket(admin.id),
			{ id: res.sampling.id },
			noopEmit
		)

		const rows = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->text"))
		expect(rows[0]?.samplingConfigId).toBe(res.sampling.id)
	})
})
