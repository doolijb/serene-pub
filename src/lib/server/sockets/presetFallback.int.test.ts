/**
 * A preset binding that stops resolving (ruling 2026-09-10).
 *
 * The rule under test is a single sentence: an upgrade or a plugin removal
 * must never stop a session working without an admin change. So the turn runs
 * on the genre's default pipeline for that event — and every surface says so.
 * Silence is the failure this suite exists to catch, which is why "it fell
 * back" is asserted four ways: the resolution, the receipt, the boot
 * reconcile's notice, and the read handler the session settings screen calls.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { and, asc, eq } from "drizzle-orm"

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

const GENRE = "core:genre/chat"

let userId: number
let characterId: number
let personaId: number

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, "fallback-owner")
	userId = user.id
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alva",
			description: "A cartographer.",
			firstMessage: "{{char}} unrolls a map for {{user}}."
		})
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Bram",
			description: "A traveller.",
			isPersona: true
		})
		.returning()
	personaId = persona.id
}, 120_000)

const admin = () =>
	({
		user: { id: userId, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	}) as any
const noop = () => {}

/**
 * A plugin-style spec answering one of the genre's slots — published, active,
 * and structurally a real member of its bucket.
 */
async function publishSpec(slug: string, event: string): Promise<number> {
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
			inputEvent: event,
			publishedAt: new Date()
		})
		.returning()) as any[]
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
	return version.id
}

/** What a plugin removal or a republish leaves behind. */
const setStatus = async (versionId: number, status: string) =>
	await db
		.update(schema.pipelineSpecVersions)
		.set({ status })
		.where(eq(schema.pipelineSpecVersions.id, versionId))

async function presetBinding(
	name: string,
	bindings: Record<string, { spec: string }>
): Promise<number> {
	const { sessionPresetsCreate } = await import("./sessionAdmin")
	const created = await sessionPresetsCreate.handler(
		admin(),
		{ name, genreId: GENRE },
		noop
	)
	const id = created.preset!.id
	// Written past the handler on purpose: a save is still refused, and this
	// is the state a republish leaves underneath a binding that was valid.
	await db
		.update(schema.sessionPresets)
		.set({
			bindings: {
				"core:event/session-created@1": { spec: "core:spec/chat-create" },
				"core:event/message-respond@1": { spec: "core:spec/chat-respond" },
				...bindings
			}
		})
		.where(eq(schema.sessionPresets.id, id))
	return id
}

async function sessionOn(presetId: number, name: string): Promise<number> {
	const [session] = (await db
		.insert(schema.sessions)
		.values({ userId, genreId: GENRE, isGroup: false, presetId, name })
		.returning()) as any[]
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true,
		position: 0
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: session.id, personaId, position: 0 })
	return session.id
}

describe("a binding that stopped resolving", () => {
	test("the turn runs the genre's default and the receipt says so", async () => {
		const versionId = await publishSpec(
			"test:spec/create-plugin",
			"core:event/session-created@1"
		)
		const presetId = await presetBinding("Plugin creation", {
			"core:event/session-created@1": { spec: "test:spec/create-plugin" }
		})
		const sessionId = await sessionOn(presetId, "fallback-create")
		await setStatus(versionId, "retired")

		// (a) resolution answers rather than throwing.
		const { resolveSessionEventSpec, dispatchSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		expect(
			await resolveSessionEventSpec(db as any, GENRE, "core:event/session-created@1", {
				sessionId
			})
		).toBe("core:spec/chat-create")

		// (b) the run happens, on the default, and records the fact.
		const dispatched = await dispatchSessionEvent(db as any, {
			sessionId,
			userId,
			genreId: GENRE,
			event: "core:event/session-created@1",
			input: {
				main: {},
				sessionScope: { sessionId, userId },
				sessionId,
				request: {},
				fields: {}
			}
		})
		expect(dispatched?.specSlug).toBe("core:spec/chat-create")
		// The fire's own recompute opens a turn-order run ahead of the one the
		// binding answered, so the receipt that carries the fact is the second
		// — never a guess picked by `limit`.
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
		const allRuns = (await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, sessionId))
			.orderBy(asc(schema.pipelineRuns.id))) as any[]
		// The recompute runs on the session's queue after the writer (PLAN
		// §8 (27)), so its row may land either side of the create's.
		expect(allRuns.map((r) => r.specSlug).sort()).toEqual([
			"core:spec/chat-create",
			"core:spec/chat-turn-order"
		])
		const run = allRuns.find((r) => r.specSlug === "core:spec/chat-create")!
		expect(run?.receipt?.meta?.preset).toMatchObject({
			via: "fallback",
			preset: "Plugin creation",
			event: "core:event/session-created@1",
			bound: "test:spec/create-plugin"
		})
		expect(String(run?.receipt?.meta?.preset?.reason)).toMatch(
			/not published/
		)
	}, 120_000)

	test("the boot reconcile records one notice, and republishing clears it", async () => {
		const versionId = await publishSpec(
			"test:spec/respond-plugin",
			"core:event/message-respond@1"
		)
		const presetId = await presetBinding("Plugin respond", {
			"core:event/message-respond@1": { spec: "test:spec/respond-plugin" }
		})
		await db
			.update(schema.sessionPresets)
			.set({ enabled: true })
			.where(eq(schema.sessionPresets.id, presetId))
		await setStatus(versionId, "retired")

		const { reconcilePresetBindings } = await import(
			"$lib/server/pipelines/boot/presetReconcile"
		)
		// (c) one notice, naming the slot and what it bound.
		await reconcilePresetBindings(db as any)
		const stale = (await db
			.select()
			.from(schema.sessionPresetNotices)
			.where(eq(schema.sessionPresetNotices.presetId, presetId))) as any[]
		expect(stale.length).toBe(1)
		expect(stale[0]).toMatchObject({
			event: "core:event/message-respond@1",
			boundSpec: "test:spec/respond-plugin"
		})

		// Idempotent: a second boot is the same notice, not a second one.
		await reconcilePresetBindings(db as any)
		expect(
			(
				(await db
					.select()
					.from(schema.sessionPresetNotices)
					.where(
						eq(schema.sessionPresetNotices.presetId, presetId)
					)) as any[]
			).length
		).toBe(1)

		// (d) the plugin comes back, the notice goes.
		await setStatus(versionId, "published")
		await reconcilePresetBindings(db as any)
		expect(
			(
				(await db
					.select()
					.from(schema.sessionPresetNotices)
					.where(
						eq(schema.sessionPresetNotices.presetId, presetId)
					)) as any[]
			).length
		).toBe(0)
	}, 120_000)

	test("the read handlers answer with the flag, never an error", async () => {
		const versionId = await publishSpec(
			"test:spec/respond-plugin-2",
			"core:event/message-respond@1"
		)
		const presetId = await presetBinding("Plugin respond two", {
			"core:event/message-respond@1": { spec: "test:spec/respond-plugin-2" }
		})
		const sessionId = await sessionOn(presetId, "fallback-read")
		await setStatus(versionId, "retired")

		// (e) the list comes back, with the fallback stated rather than thrown.
		const { sessionsPipelinesHandler } = await import("./sessions")
		const listed = await sessionsPipelinesHandler.handler(
			admin(),
			{ sessionId },
			noop
		)
		expect(listed.pipelines.map((p) => p.slug)).toContain(
			"core:spec/chat-respond"
		)
		// The reply's card is titled by its pipeline, never a fixed "Respond".
		const [replySpec] = await db
			.select({ name: schema.pipelineSpecs.name })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/chat-respond"))
		expect(
			listed.pipelines.find((p) => p.slug === "core:spec/chat-respond")?.label
		).toBe(replySpec!.name)
		expect(listed.presetFallbacks?.[0]).toMatchObject({
			event: "core:event/message-respond@1",
			bound: "test:spec/respond-plugin-2"
		})

		// And the session view's own read, which the banner is sourced from.
		const { sessionsPresetStatusHandler } = await import("./sessions")
		const status = await sessionsPresetStatusHandler.handler(
			admin(),
			{ sessionId },
			noop
		)
		expect(status.presetName).toBe("Plugin respond two")
		expect(status.stale?.[0]).toMatchObject({
			event: "core:event/message-respond@1",
			bound: "test:spec/respond-plugin-2",
			fallbackSpec: "core:spec/chat-respond"
		})
	}, 120_000)

	test("the admin preset list carries the stale binding", async () => {
		const versionId = await publishSpec(
			"test:spec/respond-plugin-3",
			"core:event/message-respond@1"
		)
		const presetId = await presetBinding("Plugin respond three", {
			"core:event/message-respond@1": { spec: "test:spec/respond-plugin-3" }
		})
		await setStatus(versionId, "retired")
		const { reconcilePresetBindings } = await import(
			"$lib/server/pipelines/boot/presetReconcile"
		)
		await reconcilePresetBindings(db as any)

		const { sessionPresetsList } = await import("./sessionAdmin")
		const listed = await sessionPresetsList.handler(admin(), {}, noop)
		const row = listed.presets.find((p) => p.id === presetId)
		expect(row?.staleBindings?.[0]).toMatchObject({
			event: "core:event/message-respond@1",
			bound: "test:spec/respond-plugin-3"
		})
	}, 120_000)

	test("a save still refuses a binding that does not resolve", async () => {
		// The read path degrades; the write path does not. An admin typing a
		// pipeline that cannot answer is a mistake to catch, not a state to
		// tolerate.
		const { sessionPresetsCreate, sessionPresetsUpdate } = await import(
			"./sessionAdmin"
		)
		const created = await sessionPresetsCreate.handler(
			admin(),
			{ name: "Strict on save", genreId: GENRE },
			noop
		)
		const res = await sessionPresetsUpdate.handler(
			admin(),
			{
				id: created.preset!.id,
				bindings: {
					"core:event/session-created@1": { spec: "core:spec/chat-create" },
					"core:event/message-respond@1": { spec: "core:spec/chat-narrate" }
				}
			},
			noop
		)
		expect(res.error).toMatch(/cannot bind to 'core:event\/message-respond@1'/)
	}, 120_000)
})

/** The notice is per (preset, event), so two stale slots are two notices. */
describe("the reconcile's shape", () => {
	test("counts a notice per stale slot and leaves healthy presets alone", async () => {
		const createVersion = await publishSpec(
			"test:spec/create-plugin-b",
			"core:event/session-created@1"
		)
		const respondVersion = await publishSpec(
			"test:spec/respond-plugin-b",
			"core:event/message-respond@1"
		)
		const presetId = await presetBinding("Both stale", {
			"core:event/session-created@1": { spec: "test:spec/create-plugin-b" },
			"core:event/message-respond@1": { spec: "test:spec/respond-plugin-b" }
		})
		await setStatus(createVersion, "retired")
		await setStatus(respondVersion, "retired")

		const { reconcilePresetBindings } = await import(
			"$lib/server/pipelines/boot/presetReconcile"
		)
		await reconcilePresetBindings(db as any)
		const rows = (await db
			.select()
			.from(schema.sessionPresetNotices)
			.where(eq(schema.sessionPresetNotices.presetId, presetId))) as any[]
		expect(rows.map((r) => r.event).sort()).toEqual([
			"core:event/message-respond@1",
			"core:event/session-created@1"
		])

		// The seeded floor binds nothing stale, so it collects nothing.
		const [floor] = (await db
			.select()
			.from(schema.sessionPresets)
			.where(
				eq(schema.sessionPresets.seedKey, "core-chat-default")
			)) as any[]
		expect(
			(
				(await db
					.select()
					.from(schema.sessionPresetNotices)
					.where(
						and(eq(schema.sessionPresetNotices.presetId, floor.id))
					)) as any[]
			).length
		).toBe(0)
	}, 120_000)
})
