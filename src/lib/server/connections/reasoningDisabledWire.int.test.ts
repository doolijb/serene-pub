/**
 * A sampling config that never switched reasoning on sends today's bytes.
 *
 * ## Why this needs a database
 *
 * `core:shape/text-gen@1` gained `reasoning` and `reasoningBudget` on
 * 2026-09-12, and the whole safety of that addition rests on ONE property: a
 * key the config did not enable never reaches an adapter, so every request this
 * product already sends is byte-identical to what it was. The adapters' own
 * unit tests assert their half of it against a hand-written `sampling` object —
 * which is exactly the object this test refuses to write by hand.
 *
 * What is under test is the seam those fakes stand in for: a real
 * `sampling_configs` row, seeded by `defaults.sync()`, through the real
 * `resolveSampling`, into a real adapter. A declared `default` on a new field
 * is precisely the kind of thing that leaks through a resolver — and the leak
 * would be invisible, because a reasoning field on a request that did not ask
 * for one changes nothing visible except the reply.
 *
 * The stored-but-switched-off row is the second half. `values` is the memory
 * and `enabled` is the switchboard (SDK `resolveSamplingValues`), so a row that
 * REMEMBERS a reasoning level it is not sending is the case a naive filter
 * breaks.
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
	return { db }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))

const chatMock = vi.fn()
const generateMock = vi.fn()
vi.mock("ollama", () => ({
	Ollama: class {
		list = vi.fn()
		chat = (...args: any[]) => chatMock(...args)
		generate = (...args: any[]) => generateMock(...args)
		abort = vi.fn()
	}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-reasoning-wire-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("reasoning is absent unless a config switched it on", () => {
	test("the shipped Default config resolves without either reasoning key", async () => {
		const { resolveSampling } = await import(
			"$lib/server/utils/resolveSampling"
		)
		const [row] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))

		const resolved = resolveSampling(row)
		// The declared default is `off`, which is the value a leak would carry
		// — and `off` is a real instruction to several of these services, not a
		// no-op. Absence is the only thing that means "do not ask".
		expect(resolved).not.toHaveProperty("reasoning")
		expect(resolved).not.toHaveProperty("reasoningBudget")
		// The rest of the config is untouched, so this is not passing because
		// resolution returned nothing at all.
		expect(resolved.contextTokens).toBe(8192)
	}, 60_000)

	test("a row that REMEMBERS a level it is not sending still sends nothing", async () => {
		const { resolveSampling } = await import(
			"$lib/server/utils/resolveSampling"
		)
		const [mine] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "Remembers A Level",
				isImmutable: false,
				// Switched off and back on must not lose what it was set to, so
				// the value stays in the row — and must not reach the wire.
				values: {
					temperature: 0.8,
					reasoning: "high",
					reasoningBudget: 9000
				},
				enabled: ["temperature"]
			})
			.returning()

		const resolved = resolveSampling(mine)
		expect(resolved).toEqual({ temperature: 0.8 })
	}, 60_000)

	test("the adapter sends the request it always sent", async () => {
		const { resolveSampling } = await import(
			"$lib/server/utils/resolveSampling"
		)
		const [row] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))

		const exportsDefault = (
			await import("$lib/server/connectionAdapters/OllamaAdapter")
		).default
		chatMock.mockClear()
		chatMock.mockResolvedValueOnce({ message: { content: "ok" } })
		const adapter = new exportsDefault.Adapter({
			connection: {
				id: 1,
				type: "ollama",
				baseUrl: "http://localhost:11434",
				model: "llama3",
				promptFormat: "vicuna",
				wireMode: "chat",
				// A stale `think` key, left behind by the per-connection toggle
				// this adapter read until 2026-09-12. Nothing reads it now, and
				// the request below is what proves it: reasoning has one home,
				// and a row that remembers the old one changes no byte.
				extraJson: { stream: false, think: true }
			} as any,
			sampling: resolveSampling(row),
			systemPrompt: "Test system prompt.",
			session: {
				id: 1,
				userId: 1,
				sessionType: "session",
				metadata: { ragIgnored: true },
				sessionMessages: [],
				sessionCharacters: [],
				sessionPersonas: [],
				lorebook: {
					id: 1,
					lorebookBindings: [],
					worldLoreEntries: [],
					characterLoreEntries: [],
					historyEntries: []
				}
			} as any,
			currentCharacterId: null,
			tokenCounter: { countTokens: async () => 1 } as any,
			tokenLimit: 4096,
			contextThresholdPercent: 0.9
		}) as any
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)

		await adapter.generateText()

		const req = chatMock.mock.calls[0][0]
		// No key at all, which is a different request from `think: false`: a
		// thinking model reads `false` as an instruction, so the only honest
		// wire for "the config did not ask" is silence.
		expect(req).not.toHaveProperty("think")
		expect(req.options).not.toHaveProperty("think")
		expect(req.options).not.toHaveProperty("reasoning")
		expect(req).not.toHaveProperty("reasoning_effort")
		expect(req).not.toHaveProperty("reasoning_budget")
		expect(req).not.toHaveProperty("chat_template_kwargs")
		// And nothing was recorded as unsendable, because nothing was asked for.
		expect(adapter.ignoredSamplers).toEqual([])
	}, 60_000)
})
