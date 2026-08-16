/**
 * Guards on the graph-build config handlers.
 *
 * Two of these protect properties that db/defaults.ts depends on: a built-in
 * row's prompts are re-forced on every boot, so allowing them to be edited here
 * would silently discard the edit at the next restart; and a client-supplied
 * `seedKey`/`isImmutable` on create would make a user's row look like a seed and
 * get its prompts overwritten.
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-gbc-test-"))
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any
const noop = () => {}

async function admin(username: string) {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return u
}

async function seededBuiltIn() {
	const [c] = await testDb
		.insert(schema.graphBuildConfigs)
		.values({
			name: "Default Graph Build",
			isImmutable: true,
			seedKey: "graph-build-default",
			perspectiveSystemPrompt: "SEEDED PERSPECTIVE"
		})
		.returning()
	return c
}

describe("graphBuildConfigs handlers", () => {
	test("a built-in keeps its prompts but accepts model/sampling overrides", async () => {
		const { graphBuildConfigsUpdate } = await import("./graphBuildConfigs")
		const u = await admin("gbc-immutable-user")
		const builtIn = await seededBuiltIn()
		const [samp] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Precise", isImmutable: false })
			.returning()

		const res = await graphBuildConfigsUpdate.handler(
			fakeSocket(u.id),
			{
				graphBuildConfig: {
					id: builtIn.id,
					perspectiveSystemPrompt: "HIJACKED",
					perspectiveSamplingConfigId: samp.id
				} as any
			},
			noop
		)

		// The prompt is the seed's; the override is the user's.
		expect(res.graphBuildConfig.perspectiveSystemPrompt).toBe(
			"SEEDED PERSPECTIVE"
		)
		expect(res.graphBuildConfig.perspectiveSamplingConfigId).toBe(samp.id)
	})

	test("a built-in cannot be deleted", async () => {
		const { graphBuildConfigsDelete } = await import("./graphBuildConfigs")
		const u = await admin("gbc-delete-user")
		const [builtIn] = await testDb
			.insert(schema.graphBuildConfigs)
			.values({ name: "Built-in 2", isImmutable: true })
			.returning()

		await expect(
			graphBuildConfigsDelete.handler(
				fakeSocket(u.id),
				{ id: builtIn.id },
				noop
			)
		).rejects.toThrow(/Cannot delete a built-in/)
	})

	test("create refuses a client-supplied seedKey or isImmutable", async () => {
		// Otherwise a user's row would be adopted by db/defaults.ts as a seed
		// and have its prompts overwritten on the next boot.
		const { graphBuildConfigsCreate } = await import("./graphBuildConfigs")
		const u = await admin("gbc-create-user")

		const res = await graphBuildConfigsCreate.handler(
			fakeSocket(u.id),
			{
				graphBuildConfig: {
					name: "Mine",
					isImmutable: true,
					seedKey: "graph-build-default"
				} as any
			},
			noop
		)
		expect(res.graphBuildConfig.isImmutable).toBe(false)
		expect(res.graphBuildConfig.seedKey).toBeNull()
	})

	test("deleting the selected config hands the default back to the built-in", async () => {
		// systemSettings.defaultGraphBuildConfigId is ON DELETE SET NULL, so
		// without this the instance would be left with no graph config at all.
		const { graphBuildConfigsDelete, graphBuildConfigsSetDefault } =
			await import("./graphBuildConfigs")
		const u = await admin("gbc-default-user")
		const builtIn = await testDb.query.graphBuildConfigs.findFirst({
			where: (c, { eq }) => eq(c.seedKey, "graph-build-default")
		})
		const [mine] = await testDb
			.insert(schema.graphBuildConfigs)
			.values({ name: "Custom", isImmutable: false })
			.returning()

		await graphBuildConfigsSetDefault.handler(
			fakeSocket(u.id),
			{ id: mine.id },
			noop
		)
		await graphBuildConfigsDelete.handler(
			fakeSocket(u.id),
			{ id: mine.id },
			noop
		)

		const settings = await testDb.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1)
		})
		expect(settings!.defaultGraphBuildConfigId).toBe(builtIn!.id)
	})

	test("list returns built-ins first and reports the current default", async () => {
		const { graphBuildConfigsListHandler } = await import(
			"./graphBuildConfigs"
		)
		const u = await admin("gbc-list-user")
		await testDb
			.insert(schema.graphBuildConfigs)
			.values({ name: "Aaa custom", isImmutable: false })

		const res = await graphBuildConfigsListHandler.handler(
			fakeSocket(u.id),
			{},
			noop
		)
		const flags = res.graphBuildConfigsList.map((c) => c.isImmutable)
		expect(flags.lastIndexOf(true)).toBeLessThan(flags.indexOf(false))
		expect(res.defaultGraphBuildConfigId).toBeTruthy()
	})
})
