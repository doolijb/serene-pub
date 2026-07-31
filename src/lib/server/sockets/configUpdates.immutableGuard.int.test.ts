/**
 * Round-8 audit fix: samplingConfigsUpdate was the only one of 6 sibling
 * config-update handlers that rejected updates to an isImmutable (built-in,
 * seeded) row. The other 5 updated unconditionally, letting an admin
 * silently corrupt built-in defaults. The fix isn't a flat block for all of
 * them, though — promptConfigs/narratorPromptConfigs/the three
 * summarizePromptConfigs variants each carry an "AI Override"
 * (connectionId/samplingConfigId, or the batch/synth/name-prefixed
 * variants) that PromptsSidebar.svelte's own UI leaves editable even when
 * immutable, so those fields must still be applied — everything else must
 * be silently dropped. contextConfigs has no such field and gets a full
 * block, matching samplingConfigs' existing behavior.
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
		path.join(os.tmpdir(), "serene-pub-config-immutable-guard-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const [admin] = await testDb
		.insert(schema.users)
		.values({ username: "config-immutable-guard-admin", isAdmin: true })
		.returning()
	adminId = admin.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let adminId: number

function fakeAdminSocket() {
	return {
		user: { id: adminId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

async function makeConnection(name: string) {
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name, type: "ollama" })
		.returning()
	return connection
}

describe("promptConfigsUpdate — isImmutable override allowlist (PGlite integration)", () => {
	test("on an immutable row, applies the AI Override but drops the definition edit", async () => {
		const { promptConfigsUpdate } = await import("./promptConfigs")
		const connection = await makeConnection("override-target")
		const [config] = await testDb
			.insert(schema.promptConfigs)
			.values({
				isImmutable: true,
				name: "Built-in",
				systemPrompt: "original prompt"
			})
			.returning()

		await promptConfigsUpdate.handler(
			fakeAdminSocket(),
			{
				promptConfig: {
					id: config.id,
					name: "Renamed",
					systemPrompt: "hacked prompt",
					connectionId: connection.id
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.promptConfigs.findFirst({
			where: eq(schema.promptConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Built-in")
		expect(reloaded!.systemPrompt).toBe("original prompt")
		expect(reloaded!.connectionId).toBe(connection.id)
	})

	test("on a non-immutable row, a full update still applies (no regression)", async () => {
		const { promptConfigsUpdate } = await import("./promptConfigs")
		const [config] = await testDb
			.insert(schema.promptConfigs)
			.values({
				isImmutable: false,
				name: "Custom",
				systemPrompt: "original prompt"
			})
			.returning()

		await promptConfigsUpdate.handler(
			fakeAdminSocket(),
			{
				promptConfig: {
					id: config.id,
					name: "Renamed",
					systemPrompt: "edited prompt"
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.promptConfigs.findFirst({
			where: eq(schema.promptConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Renamed")
		expect(reloaded!.systemPrompt).toBe("edited prompt")
	})
})

describe("narratorPromptConfigsUpdate — isImmutable override allowlist (PGlite integration)", () => {
	test("on an immutable row, applies the AI Override but drops the definition edit", async () => {
		const { narratorPromptConfigsUpdate } = await import(
			"./narratorPromptConfigs"
		)
		const connection = await makeConnection("narrator-override-target")
		const [config] = await testDb
			.insert(schema.narratorPromptConfigs)
			.values({
				isImmutable: true,
				name: "Built-in",
				systemPrompt: "original prompt"
			})
			.returning()

		await narratorPromptConfigsUpdate.handler(
			fakeAdminSocket(),
			{
				narratorPromptConfig: {
					id: config.id,
					name: "Renamed",
					systemPrompt: "hacked prompt",
					connectionId: connection.id
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.narratorPromptConfigs.findFirst({
			where: eq(schema.narratorPromptConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Built-in")
		expect(reloaded!.systemPrompt).toBe("original prompt")
		expect(reloaded!.connectionId).toBe(connection.id)
	})
})

describe("contextConfigsUpdate — isImmutable full block (PGlite integration)", () => {
	test("rejects any update to an immutable row outright — no override field exists", async () => {
		const { contextConfigsUpdate } = await import("./contextConfigs")
		const [config] = await testDb
			.insert(schema.contextConfigs)
			.values({
				isImmutable: true,
				name: "Built-in",
				template: "original template"
			})
			.returning()

		await expect(
			contextConfigsUpdate.handler(
				fakeAdminSocket(),
				{
					contextConfig: {
						id: config.id,
						name: "Renamed",
						template: "hacked template"
					}
				} as any,
				noopEmit
			)
		).rejects.toThrow(/built-in/i)

		const reloaded = await testDb.query.contextConfigs.findFirst({
			where: eq(schema.contextConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Built-in")
		expect(reloaded!.template).toBe("original template")
	})

	test("a non-immutable row still updates normally", async () => {
		const { contextConfigsUpdate } = await import("./contextConfigs")
		const [config] = await testDb
			.insert(schema.contextConfigs)
			.values({
				isImmutable: false,
				name: "Custom",
				template: "original template"
			})
			.returning()

		await contextConfigsUpdate.handler(
			fakeAdminSocket(),
			{
				contextConfig: { id: config.id, name: "Custom", template: "edited" }
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.contextConfigs.findFirst({
			where: eq(schema.contextConfigs.id, config.id)
		})
		expect(reloaded!.template).toBe("edited")
	})
})

describe("summarizePromptConfigs update handlers — isImmutable override allowlist (PGlite integration)", () => {
	test("worldSummarizeConfigsUpdateHandler applies all 6 override fields but drops definition edits", async () => {
		const { worldSummarizeConfigsUpdateHandler } = await import(
			"./summarizePromptConfigs"
		)
		const batchConn = await makeConnection("world-batch")
		const synthConn = await makeConnection("world-synth")
		const nameConn = await makeConnection("world-name")
		const [config] = await testDb
			.insert(schema.worldSummarizeConfigs)
			.values({
				isImmutable: true,
				name: "Built-in",
				batchSystemPrompt: "orig batch",
				synthSystemPrompt: "orig synth",
				nameSystemPrompt: "orig name"
			})
			.returning()

		await worldSummarizeConfigsUpdateHandler.handler(
			fakeAdminSocket(),
			{
				worldSummarizeConfig: {
					id: config.id,
					name: "Renamed",
					batchSystemPrompt: "hacked batch",
					synthSystemPrompt: "hacked synth",
					nameSystemPrompt: "hacked name",
					batchConnectionId: batchConn.id,
					synthConnectionId: synthConn.id,
					nameConnectionId: nameConn.id
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.worldSummarizeConfigs.findFirst({
			where: eq(schema.worldSummarizeConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Built-in")
		expect(reloaded!.batchSystemPrompt).toBe("orig batch")
		expect(reloaded!.synthSystemPrompt).toBe("orig synth")
		expect(reloaded!.nameSystemPrompt).toBe("orig name")
		expect(reloaded!.batchConnectionId).toBe(batchConn.id)
		expect(reloaded!.synthConnectionId).toBe(synthConn.id)
		expect(reloaded!.nameConnectionId).toBe(nameConn.id)
	})

	test("characterSummarizeConfigsUpdateHandler applies overrides but drops definition edits on an immutable row", async () => {
		const { characterSummarizeConfigsUpdateHandler } = await import(
			"./summarizePromptConfigs"
		)
		const batchConn = await makeConnection("char-batch")
		const [config] = await testDb
			.insert(schema.characterSummarizeConfigs)
			.values({
				isImmutable: true,
				name: "Built-in",
				batchSystemPrompt: "orig batch",
				synthSystemPrompt: "orig synth",
				nameSystemPrompt: "orig name"
			})
			.returning()

		await characterSummarizeConfigsUpdateHandler.handler(
			fakeAdminSocket(),
			{
				characterSummarizeConfig: {
					id: config.id,
					name: "Renamed",
					batchSystemPrompt: "hacked batch",
					batchConnectionId: batchConn.id
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.characterSummarizeConfigs.findFirst({
			where: eq(schema.characterSummarizeConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Built-in")
		expect(reloaded!.batchSystemPrompt).toBe("orig batch")
		expect(reloaded!.batchConnectionId).toBe(batchConn.id)
	})

	test("sceneSummarizeConfigsUpdateHandler drops the characterExtractionSystemPrompt text edit, but applies its connection/sampling override", async () => {
		const { sceneSummarizeConfigsUpdateHandler } = await import(
			"./summarizePromptConfigs"
		)
		const extractionConn = await makeConnection("scene-character-extraction")
		const [config] = await testDb
			.insert(schema.sceneSummarizeConfigs)
			.values({
				isImmutable: true,
				name: "Built-in",
				batchSystemPrompt: "orig batch",
				synthSystemPrompt: "orig synth",
				nameSystemPrompt: "orig name",
				characterExtractionSystemPrompt: "orig extraction"
			})
			.returning()

		await sceneSummarizeConfigsUpdateHandler.handler(
			fakeAdminSocket(),
			{
				sceneSummarizeConfig: {
					id: config.id,
					characterExtractionSystemPrompt: "hacked extraction",
					characterExtractionConnectionId: extractionConn.id
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.sceneSummarizeConfigs.findFirst({
			where: eq(schema.sceneSummarizeConfigs.id, config.id)
		})
		// The prompt text is a definition field, dropped on an immutable row —
		// same as batch/synth/nameSystemPrompt.
		expect(reloaded!.characterExtractionSystemPrompt).toBe(
			"orig extraction"
		)
		// The connection/sampling override IS an AI Override lane, same as
		// batch/synth/name's — must still apply on an immutable row.
		expect(reloaded!.characterExtractionConnectionId).toBe(
			extractionConn.id
		)
	})

	test("a non-immutable summarize config still updates fully (no regression)", async () => {
		const { worldSummarizeConfigsUpdateHandler } = await import(
			"./summarizePromptConfigs"
		)
		const [config] = await testDb
			.insert(schema.worldSummarizeConfigs)
			.values({
				isImmutable: false,
				name: "Custom",
				batchSystemPrompt: "orig batch",
				synthSystemPrompt: "orig synth",
				nameSystemPrompt: "orig name"
			})
			.returning()

		await worldSummarizeConfigsUpdateHandler.handler(
			fakeAdminSocket(),
			{
				worldSummarizeConfig: {
					id: config.id,
					name: "Edited",
					batchSystemPrompt: "edited batch"
				}
			} as any,
			noopEmit
		)

		const reloaded = await testDb.query.worldSummarizeConfigs.findFirst({
			where: eq(schema.worldSummarizeConfigs.id, config.id)
		})
		expect(reloaded!.name).toBe("Edited")
		expect(reloaded!.batchSystemPrompt).toBe("edited batch")
	})
})
