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
	await bootstrapPipelines(db)
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
		expect(preset.bindings["core:event/session-created@1"]?.spec).toBe(
			"core:spec/chat-create"
		)
		expect(preset.bindings["core:event/message-respond@1"]?.spec).toBe(
			"core:spec/chat-respond"
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
		expect(created.preset!.bindings["core:event/message-respond@1"]?.spec).toBe(
			"core:spec/chat-respond"
		)

		const wrong = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				bindings: {
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					// narrate answers session-action, not message-respond.
					"core:event/message-respond@1": { spec: "core:spec/chat-narrate" }
				}
			},
			noop
		)
		expect(wrong.error).toMatch(/cannot bind to 'core:event\/message-respond@1'/)

		const missing = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				enabled: true,
				bindings: {
					"core:event/session-created@1": { spec: "core:spec/chat-create" }
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
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": {
						spec: "core:spec/chat-respond",
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
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": { spec: "core:spec/chat-respond" }
				}
			},
			noop
		)
		expect(ok.error).toBeUndefined()
	}, 60_000)

	test("an update with no fields answers with the row, not an exception", async () => {
		// Every field on this handler is optional, so "no fields" is a shape a
		// client can send by construction — a form saved with nothing changed,
		// a retry that dropped its body. It reaches drizzle as an empty SET and
		// comes back as a raw driver exception, which is a 500 for a request
		// that asked for nothing.
		const { sessionPresetsCreate, sessionPresetsUpdate } = await import(
			"./sessionAdmin"
		)
		const created = await sessionPresetsCreate.handler(
			admin(),
			{ name: "Empty patch", genreId: "core:genre/chat" },
			noop
		)
		const id = created.preset!.id

		const res = await sessionPresetsUpdate.handler(admin(), { id }, noop)
		expect(res.error).toBeUndefined()
		expect(res.preset?.id).toBe(id)
		expect(res.preset?.name).toBe("Empty patch")

		// And nothing moved.
		const [row] = (await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, id))
			.limit(1)) as any[]
		expect(row.name).toBe("Empty patch")
		expect(row.bindings).toEqual(created.preset!.bindings)
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
		expect(res.genre?.createSpecSlug).toBe("core:spec/chat-create")
		const respond = res.slots.find((s) => s.event === "core:event/message-respond@1")
		expect(respond?.required).toBe(true)
		expect(respond?.candidates.map((c) => c.slug)).toContain(
			"core:spec/chat-respond"
		)
		const action = res.slots.find((s) => s.event === "core:event/session-action@1")
		expect(action?.open).toBe(true)
		expect(action?.candidates.map((c) => c.slug)).toContain(
			"core:spec/chat-narrate"
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
				eq(schema.pipelineSpecs.slug, "core:spec/chat-respond")
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
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": {
						spec: "core:spec/chat-respond",
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

/**
 * The other half of the contract (defect 2026-09-10): a preset that was only
 * ever validated at write is a preset nothing reads. These pin the *run* —
 * which pipeline a preset-born session's turn resolves to, and which
 * configuration it carries — plus the refusal when a binding stops resolving.
 */
describe("the preset decides the run", () => {
	const GENRE = "core:genre/chat"

	/** A second pipeline answering the same lock, so "the preset chose" is visible. */
	async function cloneRespondSpec(slug: string): Promise<string> {
		const [respond] = (await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-respond"))
			.limit(1)) as any[]
		const [spec] = (await db
			.insert(schema.pipelineSpecs)
			.values({ slug, name: slug })
			.returning()) as any[]
		const [version] = (await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				status: "published",
				canonicalHash: `hash-${slug}`,
				inputGenre: GENRE,
				inputEvent: "core:event/message-respond@1",
				publishedAt: new Date()
			})
			.returning()) as any[]
		// The bucket is structural at both ends (19 §0): a respond candidate
		// must write a session message.
		await db.insert(schema.pipelineNodes).values({
			specVersionId: version.id,
			nodeKey: "write",
			kind: "outlet",
			definitionId: "core:outlet/create-message",
			position: 0
		})
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		expect(respond).toBeTruthy()
		return slug
	}

	async function sessionOnPreset(
		presetId: number,
		username: string
	): Promise<number> {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, username)
		const [session] = (await db
			.insert(schema.sessions)
			.values({ userId: user.id, genreId: GENRE, isGroup: false, presetId })
			.returning()) as any[]
		return session.id
	}

	async function presetFor(name: string): Promise<number> {
		const { sessionPresetsCreate } = await import("./sessionAdmin")
		const created = await sessionPresetsCreate.handler(
			admin(),
			{ name, genreId: GENRE },
			noop
		)
		return created.preset!.id
	}

	test("a binding on message-respond is the pipeline that runs", async () => {
		const { sessionPresetsUpdate } = await import("./sessionAdmin")
		const clone = await cloneRespondSpec("test:spec/respond-preset")
		const presetId = await presetFor("Binds another respond")
		const res = await sessionPresetsUpdate.handler(
			admin(),
			{
				id: presetId,
				bindings: {
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": { spec: clone }
				}
			},
			noop
		)
		expect(res.error).toBeUndefined()
		const sessionId = await sessionOnPreset(presetId, "preset-respond-owner")

		// The dispatch seam…
		const { resolveSessionEventSpec } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		expect(
			await resolveSessionEventSpec(db as any, GENRE, "core:event/message-respond@1", {
				sessionId
			})
		).toBe(clone)

		// …and the reply seam, which must not disagree with it.
		const { resolveSubjectSpec } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			await resolveSubjectSpec(db as any, GENRE, "core:event/message-respond@1", { sessionId })
		).toBe(clone)

		// A session on no preset still gets the lock's own answer.
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const plainUser = await createTestUser(db, "preset-less-owner")
		const [plain] = (await db
			.insert(schema.sessions)
			.values({ userId: plainUser.id, genreId: GENRE, isGroup: false })
			.returning()) as any[]
		expect(
			await resolveSubjectSpec(db as any, GENRE, "core:event/message-respond@1", {
				sessionId: plain.id
			})
		).toBe("core:spec/chat-respond")
	}, 60_000)

	test("a preset naming a configuration gets that configuration", async () => {
		const { sessionPresetsUpdate } = await import("./sessionAdmin")
		const { duplicateConfig, resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = (await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-respond"))
			.limit(1)) as any[]
		const shipped = await resolveSelectedConfig(
			db as any,
			spec.id,
			"core:spec/chat-respond",
			{}
		)
		const copy = await duplicateConfig(
			db as any,
			shipped!.configId,
			"Preset's own values"
		)

		const presetId = await presetFor("Names a config")
		await sessionPresetsUpdate.handler(
			admin(),
			{
				id: presetId,
				bindings: {
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": {
						spec: "core:spec/chat-respond",
						config: copy.id
					}
				}
			},
			noop
		)
		const sessionId = await sessionOnPreset(presetId, "preset-config-owner")

		const selected = await resolveSelectedConfig(
			db as any,
			spec.id,
			"core:spec/chat-respond",
			{ sessionId }
		)
		expect(selected?.configId).toBe(copy.id)
		expect(selected?.source).toBe("preset")

		// And through the seam the session settings screen reads.
		const { sessionPipeline } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			(await sessionPipeline(db as any, sessionId, GENRE))?.configId
		).toBe(copy.id)
	}, 60_000)

	test("configSelections answers for a spec no event binding names", async () => {
		const { sessionPresetsUpdate } = await import("./sessionAdmin")
		const { duplicateConfig, resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [narrate] = (await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-narrate"))
			.limit(1)) as any[]
		const shipped = await resolveSelectedConfig(
			db as any,
			narrate.id,
			"core:spec/chat-narrate",
			{}
		)
		const copy = await duplicateConfig(
			db as any,
			shipped!.configId,
			"Narrate, preset's own"
		)
		const presetId = await presetFor("Selects an action's config")
		await sessionPresetsUpdate.handler(
			admin(),
			{
				id: presetId,
				configSelections: { "core:spec/chat-narrate": copy.id }
			},
			noop
		)
		const sessionId = await sessionOnPreset(presetId, "preset-action-owner")
		const selected = await resolveSelectedConfig(
			db as any,
			narrate.id,
			"core:spec/chat-narrate",
			{ sessionId }
		)
		expect(selected?.configId).toBe(copy.id)
		expect(selected?.source).toBe("preset")
	}, 60_000)

	test("a preset naming no configuration still gets the default", async () => {
		const { resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const presetId = await presetFor("Names no config")
		const sessionId = await sessionOnPreset(presetId, "preset-default-owner")
		const [spec] = (await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-respond"))
			.limit(1)) as any[]
		const shipped = await resolveSelectedConfig(
			db as any,
			spec.id,
			"core:spec/chat-respond",
			{}
		)

		// The regression: a preset-born session used to be told it had no
		// configuration at all, where a preset-less one got the shipped default.
		const { presetActionsFor } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const actions = await presetActionsFor(db as any, sessionId, GENRE)
		expect(actions.configId).toBe(shipped!.configId)
	}, 60_000)

	/**
	 * Never silent, and — since the ruling of 2026-09-10 — never a refusal
	 * either. The turn runs the genre's default and the verdict carries what
	 * was substituted, which is what every surface says it from. The end-to-end
	 * proof (receipt, notice, handlers) is `presetFallback.int.test.ts`; this
	 * pins the resolver's own answer beside the rest of the reader's contract.
	 */
	test("a binding that stopped resolving falls back, and says what it did", async () => {
		const presetId = await presetFor("Went stale")
		// Written past the handler on purpose: this is the state a republish
		// produces underneath a binding that was valid when it was saved.
		await db
			.update(schema.sessionPresets)
			.set({
				bindings: {
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": { spec: "core:spec/chat-narrate" }
				}
			})
			.where(eq(schema.sessionPresets.id, presetId))
		const sessionId = await sessionOnPreset(presetId, "preset-stale-owner")

		const { resolveSessionEventVerdict } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const verdict = await resolveSessionEventVerdict(
			db as any,
			GENRE,
			"core:event/message-respond@1",
			{ sessionId }
		)
		// The genre's own answer runs — the session keeps working.
		expect(verdict.spec).toBe("core:spec/chat-respond")
		// And the substitution is stated, by preset and by slug.
		expect(verdict.fallback?.preset).toBe("Went stale")
		expect(verdict.fallback?.bound).toBe("core:spec/chat-narrate")
		expect(verdict.fallback?.event).toBe("core:event/message-respond@1")
		expect(verdict.fallback?.reason).toMatch(/core:spec\/chat-narrate/)

		// The reply seam agrees with the dispatch seam, as it must.
		const { resolveSubjectVerdict } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const reply = await resolveSubjectVerdict(
			db as any,
			GENRE,
			"core:event/message-respond@1",
			{ sessionId }
		)
		expect(reply.spec).toBe("core:spec/chat-respond")
		expect(reply.fallback?.bound).toBe("core:spec/chat-narrate")
	}, 60_000)
})

/**
 * `defaults` is the creation pre-fill the create form already applies
 * (`applyPresetDefaults`) and nothing could author. These pin the authoring
 * path end to end: the update handler persists it, and the list returns it.
 */
describe("creation defaults", () => {
	test("the update handler persists defaults and the list returns them", async () => {
		const { sessionPresetsCreate, sessionPresetsUpdate, sessionPresetsList } =
			await import("./sessionAdmin")
		const created = await sessionPresetsCreate.handler(
			admin(),
			{ name: "Pre-filled", genreId: "core:genre/chat" },
			noop
		)
		const id = created.preset!.id
		const res = await sessionPresetsUpdate.handler(
			admin(),
			{
				id,
				defaults: {
					name: "A fresh scene",
					scenario: "Somewhere it rains.",
					tags: ["noir"]
				}
			},
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.preset?.defaults).toEqual({
			name: "A fresh scene",
			scenario: "Somewhere it rains.",
			tags: ["noir"]
		})
		const listed = await sessionPresetsList.handler(admin(), {}, noop)
		expect(
			listed.presets.find((p) => p.id === id)?.defaults
		).toMatchObject({ scenario: "Somewhere it rains." })

		// Clearing is explicit, not "absent means keep".
		const cleared = await sessionPresetsUpdate.handler(
			admin(),
			{ id, defaults: null },
			noop
		)
		expect(cleared.preset?.defaults).toBeNull()
	}, 60_000)
})
