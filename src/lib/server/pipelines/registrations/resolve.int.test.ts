/**
 * The one resolver against a booted database (PLAN-layering D7, R24, R31,
 * R33): what a session runs on an event, on its reply and its actions; the
 * session's own rows; `when`; the projection of core's defaults and presets;
 * and the cache. The end-to-end fallback is `sockets/presetFallback.int.test.ts`.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const STORY = "core:genre/story"
const RESPOND = "core:event/message-respond@1"
const ADDED = "core:event/member-added@1"
let userId: number

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "registrations-owner")).id
}, 120_000)

const presetId = async (seedKey: string) =>
	(
		await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, seedKey))
			.limit(1)
	)[0]!.id

async function sessionOn(seedKey: string | null, genreId = STORY): Promise<number> {
	const [s] = await db
		.insert(schema.sessions)
		.values({
			userId,
			genreId,
			isGroup: false,
			name: "registrations",
			presetId: seedKey ? await presetId(seedKey) : null
		})
		.returning()
	return s!.id
}

describe("the boot's projection", () => {
	it("writes every core genre's defaults and each shipped preset's changes", async () => {
		const genreRows = await db
			.select()
			.from(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "genre"), eq(schema.registrations.scopeRef, STORY)))
		expect(genreRows.map((r) => r.key)).toEqual(
			expect.arrayContaining([
				"session-created→story-create",
				"message-offered→save-message",
				"message-respond→story-respond",
				"story-narrate#narrate→story-narrate",
				"after-each-round→story-reckoning",
				"every-n-turns→story-sweep"
			])
		)
		const minimal = await db
			.select()
			.from(schema.registrations)
			.where(eq(schema.registrations.presetId, await presetId("core-story-minimal")))
		expect(minimal.filter((r) => r.dropped).map((r) => r.key).sort()).toEqual([
			"after-each-round→story-reckoning",
			"every-n-turns→story-sweep",
			"on-event→story-illustrate-new-scene"
		])
		expect(minimal.find((r) => r.key === "message-respond→story-respond")?.values).toEqual({
			reading: { params: { scene: false } }
		})
		// One default per genre (R22): the Guide, the Lair and the Dungeon Crawler's seeds too.
		for (const seed of ["core-guide-default", "core-lair-default", "core-dungeon-crawler-default"]) {
			const [row] = await db
				.select({ isDefault: schema.sessionPresets.isDefault })
				.from(schema.sessionPresets)
				.where(eq(schema.sessionPresets.seedKey, seed))
			expect(row?.isDefault, seed).toBe(true)
		}
	}, 60_000)

	it("is idempotent", async () => {
		const before = await db.select().from(schema.registrations)
		const { projectRegistrations } = await import("./project")
		const report = await projectRegistrations(db as any)
		expect(report.genres.every((g) => !g.changed)).toBe(true)
		expect(report.presets.every((p) => !p.changed)).toBe(true)
		expect((await db.select().from(schema.registrations)).length).toBe(before.length)
	}, 60_000)
})

describe("what a session runs", () => {
	it("an event, the reply and the actions, from one resolution", async () => {
		const sessionId = await sessionOn("core-story-living")
		const { resolveSessionEventVerdict } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { resolveSubjectVerdict, listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const added = await resolveSessionEventVerdict(db as any, STORY, ADDED, { sessionId })
		expect(added).toMatchObject({ spec: "core:spec/story-turn-order", registrationKey: "member-added→story-turn-order" })
		const reply = await resolveSubjectVerdict(db as any, STORY, RESPOND, { sessionId })
		// pr-6 (pass 9 S3): the resolution carries the registration's summary depth — 0 on an event.
		expect(reply).toEqual({ spec: "core:spec/story-respond", registrationKey: "message-respond→story-respond", registrationMinAge: 0 })
		const narrate = await resolveSubjectVerdict(db as any, STORY, "core:spec/story-narrate#narrate", {
			sessionId,
			spec: "core:spec/story-narrate"
		})
		expect(narrate.spec).toBe("core:spec/story-narrate")
		const fns = await listSessionFunctions(db as any, sessionId, STORY)
		const offered = fns.filter((f) => f.specSlug.startsWith("core:spec/story-"))
		expect(offered.map((f) => f.key).sort()).toEqual(
			["advance-time", "answer", "ask", "generate-image", "illustrate-scene", "look", "narrate", "narrate-character", "rest"].sort()
		)
		expect(offered.every((f) => f.included && f.source === "default")).toBe(true)
		// 🚧 R56: on a pub with no model that draws, the two picture actions are
		// unavailable — off, saying what is missing; every other one is on.
		const drawing = new Set(["generate-image", "illustrate-scene"])
		for (const f of offered) {
			if (drawing.has(f.key)) {
				expect(f.enabled).toBe(false)
				expect(f.unavailable).toMatch(/^Unavailable: needs a model that can .*draw pictures/)
			} else expect(f.enabled, f.key).toBe(true)
		}
	}, 60_000)

	it("a session switches an offered action off and back on — reset is delete", async () => {
		const sessionId = await sessionOn("core-story-living")
		const { setSessionFunction, listSessionFunctions } = await import("$lib/server/pipelines/entities/sessionGenres")
		const off = await setSessionFunction(db as any, sessionId, STORY, "core:spec/story-look#look", false, { userId })
		expect(off).toEqual({ ok: true, enabled: false })
		const look = (await listSessionFunctions(db as any, sessionId, STORY)).find((f) => f.key === "look")
		expect(look).toMatchObject({ enabled: false, included: true, explicit: true, source: "session" })
		const rows = await db
			.select()
			.from(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.scopeRef, String(sessionId))))
		expect(rows).toEqual([expect.objectContaining({ key: "story-look#look→story-look", dropped: true })])
		await setSessionFunction(db as any, sessionId, STORY, "core:spec/story-look#look", true, { userId })
		expect(
			await db
				.select()
				.from(schema.registrations)
				.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.scopeRef, String(sessionId))))
		).toEqual([])
	}, 60_000)

	it("Minimal drops the routines that call a model and changes the reply's values", async () => {
		const sessionId = await sessionOn("core-story-minimal")
		const { effectiveRegistrations } = await import("./resolve")
		const resolved = (await effectiveRegistrations(db as any, sessionId))!
		// 🚧 GM 2026-10-23 (G1 ★5): only *After a rest* stays — no model call, the clock after the rules' Rest.
		expect(resolved.effective.filter((r) => r.trigger.family === "routine").map((r) => r.pipeline)).toEqual(["core:spec/story-after-rest"])
		expect(resolved.effective.find((r) => r.key === "message-respond→story-respond")?.values).toEqual({
			reading: { params: { scene: false } }
		})
		const { registrationValueLayers } = await import("./values")
		expect(
			await registrationValueLayers(db as any, { specSlug: "core:spec/story-respond", sessionId })
		).toMatchObject({ preset: { reading: { params: { scene: false } } }, genre: null, session: null })
	}, 60_000)

	it("a preset change carrying minAge reaches the effective registration and its row's min_age", async () => {
		const [p] = await db
			.insert(schema.sessionPresets)
			.values({ name: "Min age preset", genreId: STORY, bindings: {}, enabled: true, isDefault: false, isImmutable: false } as any)
			.returning()
		const key = "message-respond→story-respond"
		const { writePresetChanges } = await import("./presetRows")
		await writePresetChanges(db as any, p!.id, { change: [{ key, minAge: 7 }] })
		const [s] = await db
			.insert(schema.sessions)
			.values({ userId, genreId: STORY, isGroup: false, name: "min age", presetId: p!.id })
			.returning()
		const { effectiveRegistrations } = await import("./resolve")
		const resolved = (await effectiveRegistrations(db as any, s!.id))!
		expect(resolved.effective.find((r) => r.key === key)?.minAge).toBe(7)
		const rows = await db
			.select()
			.from(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "preset"), eq(schema.registrations.scopeRef, String(p!.id)), eq(schema.registrations.key, key)))
		expect(rows.map((r) => r.minAge)).toEqual([7])
	}, 60_000)

	it("several registrations on one event run in order, each when its condition holds (R24, R31)", async () => {
		const sessionId = await sessionOn("core-story-living")
		const { rowOfDecl } = await import("./rows")
		const { upsertRow } = await import("./write")
		const { eventRegistration } = await import("./rows")
		const scope = { kind: "session" as const, sessionId }
		// A second pipeline on member-added, first in order, whose `when` never holds…
		await upsertRow(db as any, {
			...rowOfDecl({ ...eventRegistration(ADDED, "core:spec/story-narrate"), order: -1 }, scope, "admin"),
			when: { on: "session.fields.nobodySetsThis", truthy: true }
		})
		const { resolveSessionEventVerdict } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const skipped = await resolveSessionEventVerdict(db as any, STORY, ADDED, { sessionId })
		expect(skipped.registrations?.map((r) => r.spec)).toEqual(["core:spec/story-turn-order"])
		expect(skipped.skipped?.map((r) => r.spec)).toEqual(["core:spec/story-narrate"])
		// …then one with no condition: both run, the earlier order first.
		await upsertRow(db as any, {
			...rowOfDecl({ ...eventRegistration(ADDED, "core:spec/story-narrate"), order: -1 }, scope, "admin"),
			when: null
		})
		const both = await resolveSessionEventVerdict(db as any, STORY, ADDED, { sessionId })
		expect(both.registrations?.map((r) => r.spec)).toEqual(["core:spec/story-narrate", "core:spec/story-turn-order"])
		expect(both.spec).toBe("core:spec/story-narrate")
	}, 60_000)

	it("the host doors read the session's routines: their duties at their mode, by the contract they declare (lane 6)", async () => {
		const sessionId = await sessionOn("core-story-living")
		const { sessionDutiesOf, sessionRoutineMode } = await import("$lib/server/pipelines/routines/sessionRoutines")
		const { reckoningDuties, sweepDuties } = await import("@serene-pub/contracts")
		const { ASSISTANT_MEMORY_SPEC_ID, STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID } = await import("@serene-pub/core-catalog")
		expect(await sessionDutiesOf(db as any, sessionId, reckoningDuties.id)).toMatchObject({
			attributes: "full",
			conditions: "full",
			time: "full",
			"places-on-move": "full",
			"timed-expiry": "full"
		})
		expect(await sessionDutiesOf(db as any, sessionId, sweepDuties.id)).toMatchObject({
			summary: "full",
			relationships: "off",
			"goal-reached": "off"
		})
		expect(await sessionRoutineMode(db as any, sessionId, STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID)).toBe("off")
		expect(await sessionRoutineMode(db as any, sessionId, ASSISTANT_MEMORY_SPEC_ID)).toBeNull()
	}, 60_000)

	it("caches until something it read changes", async () => {
		const sessionId = await sessionOn("core-story-living")
		const { effectiveRegistrations, setRegistrationCacheEnabled } = await import("./resolve")
		const { deleteRow, upsertRow } = await import("./write")
		const { rowOfDrop } = await import("./rows")
		setRegistrationCacheEnabled(true)
		try {
			const a = await effectiveRegistrations(db as any, sessionId)
			expect(await effectiveRegistrations(db as any, sessionId)).toBe(a)
			const scope = { kind: "session" as const, sessionId }
			await upsertRow(db as any, rowOfDrop("story-rest#rest→story-rest", scope, "owner"))
			const b = await effectiveRegistrations(db as any, sessionId)
			expect(b).not.toBe(a)
			expect(b!.effective.some((r) => r.key === "story-rest#rest→story-rest")).toBe(false)
			await deleteRow(db as any, scope, "story-rest#rest→story-rest")
			// The preset pointer is read every call.
			await db.update(schema.sessions).set({ presetId: await presetId("core-story-minimal") }).where(eq(schema.sessions.id, sessionId))
			const c = await effectiveRegistrations(db as any, sessionId)
			expect(c!.effective.filter((r) => r.trigger.family === "routine").map((r) => r.pipeline)).toEqual(["core:spec/story-after-rest"])
		} finally {
			setRegistrationCacheEnabled(false)
		}
	}, 60_000)
})

describe("a registration value holds a shared row (R38)", () => {
	it("refuses deleting a prompt the genre's defaults select, until the admin's own selection is released", async () => {
		const RESPOND_SPEC = "core:spec/story-respond"
		const { declarations } = await import("$lib/server/pipelines/config/panel")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC))
		const decl = (await declarations(db as any, spec!.activeVersionId!)).find(
			(d) => d.control === "prompts-ref" && !!d.nodeDefinitionId
		)!
		expect(decl).toBeTruthy()
		const { createPrompt, deletePrompt, PromptNotUsableError } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const prompt = await createPrompt(db as any, {
			nodeDefinitionId: decl.nodeDefinitionId!,
			slot: decl.slot,
			name: "Held by a registration",
			fields: {}
		})
		const { setPipelineGenreValue, ownGenreValueRefs, releaseGenreValueRefs, genreStoredValues } =
			await import("./genreValues")
		const address = { nodeKey: decl.nodeKey, slot: decl.slot, path: decl.path }
		expect(await setPipelineGenreValue(db as any, RESPOND_SPEC, address, prompt.id)).toBeGreaterThan(0)

		await expect(deletePrompt(db as any, prompt.id)).rejects.toThrow(PromptNotUsableError)

		const own = await ownGenreValueRefs(db as any, RESPOND_SPEC, [decl.slot], prompt.id)
		expect(own.length).toBeGreaterThan(0)
		const { refKeyOf } = await import("./values")
		await deletePrompt(db as any, prompt.id, { ignoreRegistrationRefs: new Set(own.map(refKeyOf)) })
		await releaseGenreValueRefs(db as any, RESPOND_SPEC, own)
		expect(
			(await genreStoredValues(db as any, RESPOND_SPEC)).filter(
				(v) => v.nodeKey === address.nodeKey && v.slot === address.slot && v.value === prompt.id
			)
		).toEqual([])
	}, 60_000)
})
