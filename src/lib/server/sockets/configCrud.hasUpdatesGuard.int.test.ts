/**
 * Round-10 audit fix (MEDIUM): contextConfigsUpdate/samplingConfigsUpdate
 * went straight to db.update(...).set(updateData) with no check that
 * updateData was non-empty — an {id}-only payload on a mutable row hit
 * Drizzle's empty .set() and threw, unlike the already-fixed
 * promptConfigsUpdate/narratorPromptConfigsUpdate/
 * summarizePromptConfigsUpdate (round 8). Also: samplingConfigsCreate used
 * to call samplingConfigsSetUserActive after insert, silently making every
 * newly created sampling config the instance-wide default
 * (systemSettings.defaultSamplingConfigId) — unlike every sibling
 * *ConfigsCreate handler.
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
			.values({ name: "My Sampling", temperature: 0.42 })
			.returning()

		const res = await samplingConfigsUpdate.handler(
			fakeSocket(admin.id),
			{ sampling: { id: config.id } as any },
			noopEmit
		)
		expect(res.sampling.id).toBe(config.id)
		expect(res.sampling.temperature).toBe(0.42)
	})
})

describe("samplingConfigsCreate — no longer sets the instance-wide default", () => {
	test("creating a sampling config doesn't change systemSettings.defaultSamplingConfigId", async () => {
		const { samplingConfigsCreate } = await import("./samplingConfigs")
		const admin = await makeAdmin("config-crud-sampling-create-user")

		const before = await testDb.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})

		const res = await samplingConfigsCreate.handler(
			fakeSocket(admin.id),
			{ sampling: { name: "Fresh Sampling Config" } as any },
			noopEmit
		)

		const after = await testDb.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		expect(after?.defaultSamplingConfigId).toBe(
			before?.defaultSamplingConfigId
		)
		expect(after?.defaultSamplingConfigId).not.toBe(res.sampling.id)
	})
})
