/**
 * The preset bindings contract (24 §4, admin IA 2026-08-28), proven at the
 * handler seam: bindings validate against the input locks with the same
 * sentences the authoring kit uses, an enabled preset must bind its required
 * slots, the genre dashboard reports the surface with candidates, and the
 * configurations index counts its dependents.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
}, 120_000)

const admin = () =>
	({ user: { id: 1, isAdmin: true }, io: { to: () => ({ emit: () => {} }) } }) as any
const noop = () => {}

describe("preset bindings validation", () => {
	test("the seeded default carries composed bindings", async () => {
		const [preset] = (await db
			.select()
			.from(schema.sessionPresets)
			.where(
				eq(schema.sessionPresets.seedKey, "core-chat-default")
			)) as any[]
		expect(preset.bindings["session-created"]?.spec).toBe(
			"core:spec/create-chat"
		)
		expect(preset.bindings["message-respond"]?.spec).toBe(
			"core:spec/respond"
		)
	}, 60_000)

	test("a binding whose lock disagrees refuses by sentence", async () => {
		const { sessionPresetsCreate, sessionPresetsUpdate } = await import(
			"./sessionAdmin"
		)
		const created = await sessionPresetsCreate.handler(
			admin(),
			{ name: "Lock test", genreId: "core:genre/chat" },
			noop
		)
		const id = created.preset!.id
		// The create defaulted the bindings from the locks.
		expect(created.preset!.bindings["message-respond"]?.spec).toBe(
			"core:spec/respond"
		)

		const wrong = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				bindings: {
					"session-created": { spec: "core:spec/create-chat" },
					// narrate answers session-action, not message-respond.
					"message-respond": { spec: "core:spec/narrate" }
				}
			},
			noop
		)
		expect(wrong.error).toMatch(/cannot bind to 'message-respond'/)

		const missing = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				enabled: true,
				bindings: {
					"session-created": { spec: "core:spec/create-chat" }
				}
			},
			noop
		)
		expect(missing.error).toMatch(/required slots.*message-respond/)

		const foreignConfig = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				bindings: {
					"session-created": { spec: "core:spec/create-chat" },
					"message-respond": {
						spec: "core:spec/respond",
						config: 999999
					}
				}
			},
			noop
		)
		expect(foreignConfig.error).toMatch(/does not belong/)

		const ok = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				bindings: {
					"session-created": { spec: "core:spec/create-chat" },
					"message-respond": { spec: "core:spec/respond" }
				}
			},
			noop
		)
		expect(ok.error).toBeUndefined()
	}, 60_000)
})

describe("the genre dashboard", () => {
	test("reports the surface with candidates off the input locks", async () => {
		const { sessionGenresDetail } = await import("./sessionAdmin")
		const res = await sessionGenresDetail.handler(
			admin(),
			{ genreId: "core:genre/chat" },
			noop
		)
		expect(res.genre?.createSpecSlug).toBe("core:spec/create-chat")
		const respond = res.slots.find((s) => s.event === "message-respond")
		expect(respond?.required).toBe(true)
		expect(respond?.candidates.map((c) => c.slug)).toContain(
			"core:spec/respond"
		)
		const action = res.slots.find((s) => s.event === "session-action")
		expect(action?.open).toBe(true)
		expect(action?.candidates.map((c) => c.slug)).toContain(
			"core:spec/narrate"
		)
		expect(res.presets.length).toBeGreaterThan(0)
	}, 60_000)
})

describe("the configurations index", () => {
	test("counts preset dependents off the bindings", async () => {
		const { sessionPresetsCreate, sessionPresetsUpdate } = await import(
			"./sessionAdmin"
		)
		const { pipelinesConfigsIndex } = await import("./pipelines")
		const [config] = (await db
			.select()
			.from(schema.pipelineConfigs)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
			)) as any[]
		const respondConfig = (await db
			.select({
				id: schema.pipelineConfigs.id,
				specId: schema.pipelineConfigs.specId
			})
			.from(schema.pipelineConfigs)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
			)
			.where(
				eq(schema.pipelineSpecs.slug, "core:spec/respond")
			)) as any[]
		const cfgId = respondConfig[0].id

		const created = await sessionPresetsCreate.handler(
			admin(),
			{ name: "Counts test", genreId: "core:genre/chat" },
			noop
		)
		await sessionPresetsUpdate.handler(
			admin(),
			{
				id: created.preset!.id,
				bindings: {
					"session-created": { spec: "core:spec/create-chat" },
					"message-respond": {
						spec: "core:spec/respond",
						config: cfgId
					}
				}
			},
			noop
		)
		const index = await pipelinesConfigsIndex.handler(admin(), {}, noop)
		const row = index.configs.find((c) => c.id === cfgId)
		expect(row?.usedByPresets).toBeGreaterThan(0)
		expect(config).toBeTruthy()
	}, 60_000)
})
