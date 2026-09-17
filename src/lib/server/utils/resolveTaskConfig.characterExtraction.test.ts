/**
 * Scene summarization's character-extraction sub-task previously had no AI
 * override at all — extractCharactersFromContent() (summarizer/index.ts) was
 * always called with whatever connection/sampling the "name generation"
 * sub-task resolved to, with no way to point it at a different connection.
 * resolveTaskConfig() now resolves "character_extraction" against
 * sceneSummarizeConfigs' new characterExtractionConnectionId/
 * characterExtractionSamplingConfigId columns, the same way "summarize_batch"
 * /"summarize_synth"/"summarize_name" already resolve against their own
 * columns — even though "character_extraction" doesn't carry the
 * "summarize_" prefix those three share (it's also used standalone by the
 * graph-builder, unrelated to scene summarize configs).
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
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-resolve-task-config-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeConnection(name: string) {
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name, type: "ollama" })
		.returning()
	return connection
}

async function makeSampling(name: string) {
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name })
		.returning()
	return sampling
}

describe("resolveTaskConfig — character_extraction", () => {
	test("resolves against sceneSummarizeConfigs' dedicated override columns", async () => {
		const { resolveTaskConfig } = await import("./resolveTaskConfig")
		const extractionConn = await makeConnection("extraction-conn")
		const extractionSamp = await makeSampling("extraction-samp")
		const [config] = await testDb
			.insert(schema.sceneSummarizeConfigs)
			.values({
				name: "Scene Config",
				batchSystemPrompt: "b",
				synthSystemPrompt: "s",
				nameSystemPrompt: "n",
				characterExtractionConnectionId: extractionConn.id,
				characterExtractionSamplingConfigId: extractionSamp.id
			})
			.returning()

		const result = await resolveTaskConfig({
			taskType: "character_extraction",
			summarizeConfigId: config.id,
			summarizeConfigType: "scene"
		})

		// The column is READ — that is what this test is about, and the problem
		// names the very endpoint it holds.
		expect(result.problem?.connectionId).toBe(extractionConn.id)
		// ⚠ And the sub-task cannot run on it: the override is one column and a
		// selection is a PAIR, so a scene config pointing at an endpoint no
		// lower tier has chosen a model for is an incomplete selection.
		// Connections have no default model, so nothing completes it, and the
		// refusal names the fix rather than guessing a row.
		expect(result.connection).toBeNull()
		expect(result.problem?.kind).toBe("model")
		expect(result.problem?.message).toMatch(
			/Pick a model on that connection/
		)
	})

	test("falls back to the registered capability default when the scene config sets no override", async () => {
		const { resolveTaskConfig } = await import("./resolveTaskConfig")
		const defaultConn = await makeConnection("system-default-conn")
		const defaultSamp = await makeSampling("system-default-samp")
		// The instance default is a `connection_defaults` row keyed by
		// capability since 0181, not `system_settings.default_connection_id`.
		// Registering it is what makes the fallback exist at all — the two
		// connections created above are saved and capable and would still not be
		// chosen, which is the ruling this test now also stands for.
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		// A PAIR, because that is what a registration is.
		const { ensureConnectionModel } = await import(
			"$lib/server/connections/models"
		)
		const defaultModel = await ensureConnectionModel(
			testDb as any,
			defaultConn.id,
			"default-7b"
		)
		await setCapabilityDefault(testDb as any, "text->text", {
			connectionId: defaultConn.id,
			connectionModelId: defaultModel!.id,
			samplingConfigId: defaultSamp.id
		})
		const [config] = await testDb
			.insert(schema.sceneSummarizeConfigs)
			.values({
				name: "Scene Config No Override",
				batchSystemPrompt: "b",
				synthSystemPrompt: "s",
				nameSystemPrompt: "n"
			})
			.returning()

		const result = await resolveTaskConfig({
			taskType: "character_extraction",
			summarizeConfigId: config.id,
			summarizeConfigType: "scene"
		})

		expect(result.connection?.id).toBe(defaultConn.id)
		expect(result.sampling?.id).toBe(defaultSamp.id)
	})

	test("does not crash for a non-scene summarizeConfigType (world configs have no such column)", async () => {
		const { resolveTaskConfig } = await import("./resolveTaskConfig")
		const [config] = await testDb
			.insert(schema.worldSummarizeConfigs)
			.values({
				name: "World Config",
				batchSystemPrompt: "b",
				synthSystemPrompt: "s",
				nameSystemPrompt: "n"
			})
			.returning()

		const result = await resolveTaskConfig({
			taskType: "character_extraction",
			summarizeConfigId: config.id,
			summarizeConfigType: "world"
		})

		// No dedicated column on worldSummarizeConfigs — just falls through
		// to whatever the system default resolves to (possibly null in this
		// isolated test DB), without throwing.
		expect(result).toBeDefined()
	})
})
