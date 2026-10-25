/**
 * 🚧 The **sweep** and the **goal-reached** event (PLAN-genre-restructure §4,
 * lane 2, 2026-10-19), on a real Story turn with a scripted model and the
 * sweep due every turn: *Track relationships* files how the characters stand
 * on the lorebook's Graph review screen (a graph proposal the person
 * applies, between members the graph already holds); *File the places* and
 * *Track goals* write their entry and their note end to end; and *Mark goals
 * reached* says a newly ticked goal once on the story and tells every member.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "task-sweep-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const script = vi.hoisted(() => ({ sweep: "" as string }))
class FakeAdapter {
	injected: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the books of a story")
			? script.sweep
			: asked.includes("You keep the record of a story")
				? JSON.stringify({ deltas: [], clock: [], place: [] })
				: "They reach the mill at dusk."
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
let bookId: number
const bindings: Record<string, number> = {}
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-task-sweep-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "task-sweep-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "sweep-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Task sweep test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })

	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "Millbrook" }).returning()
	bookId = book!.id
	for (const name of ["Ash", "Bram"]) {
		const rows = (await db.execute(sql`
			insert into lorebook_bindings (lorebook_id, binding, name)
			values (${bookId}, ${`{{${name.toLowerCase()}}}`}, ${name}) returning id`)) as any
		bindings[name] = Number((rows.rows ?? rows)[0].id)
	}
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

async function sweptSession(name: string, tasks: Record<string, "full" | "review" | "off">) {
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name: "Ash", description: "A miller's daughter.", isPersona: false }).returning()
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: await presetId("core-story-living") }, characterIds: [c!.id], personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db.update(schema.sessions).set({ lorebookId: bookId }).where(eq(schema.sessions.id, sessionId))
	// The retired task choices, where they live now: the sweep's duties and its mode.
	const { applyLegacyTasks, setRoutineCadenceOptions } = await import("$lib/server/utils/testDb")
	await applyLegacyTasks(db, sessionId, { v: 1, tasks: Object.fromEntries(Object.entries(tasks).map(([k, mode]) => [k, { mode }])) })
	// The sweep every turn, so one exchange shows it — an administrator's
	// change of its cadence's options (R36), the registration unchanged (A8).
	const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const sweep = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === STORY_SWEEP_SPEC_ID)!
	await setRoutineCadenceOptions(db, sessionId, sweep.key, { n: 1 })
	return sessionId
}

async function turn(sessionId: number, sweep: unknown) {
	script.sweep = JSON.stringify(sweep)
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content: "We walk to the mill.", channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

const answer = (over: Record<string, unknown> = {}) => ({
	summary: { name: "", content: "" },
	lore: [],
	cast: [],
	worldState: [],
	relationships: [],
	scenes: [],
	goals: "",
	...over
})

/**
 * 🚧 Since PLAN-layering (lanes 3, 5a, 6, 2026-10-20) the sweep is a
 * **routine** — `core:spec/story-sweep`, every N turns — run by the routine
 * queue once the reply has settled; the session's tasks are its duties and
 * its mode (`applyLegacyTasks`), and *Mark goals reached* is its duty.
 */
describe("the sweep (lane 2; a routine since lane 6)", () => {
	it("Track relationships files the ties it found on the Graph's review screen; a stranger is left out", async () => {
		const sessionId = await sweptSession("sweep-ties", { relationships: "full", summary: "off", lore: "off", cast: "off", "world-state": "off" })
		await turn(sessionId, answer({ relationships: [{ from: "Ash", to: "Bram", how: "wary allies" }, { from: "Ash", to: "Nobody Known", how: "rivals" }] }))
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const review = activityStore.getFor(ownerId, false).find((a) => a.kind === "graph_build" && a.lorebookId === bookId)
		expect(review, "a graph review is waiting").toBeTruthy()
		expect(review!.kind === "graph_build" && review!.status).toBe("review")
		const rels = review!.kind === "graph_build" ? (review!.proposal?.relationships ?? []) : []
		expect(rels).toEqual([
			expect.objectContaining({
				fromTempId: `existing_${bindings.Ash}`,
				toTempId: `existing_${bindings.Bram}`,
				relationshipType: "wary allies"
			})
		])
	}, 180_000)

	it("File the places and Track goals write end to end; Mark goals reached says a ticked goal once and tells the owner", async () => {
		const sessionId = await sweptSession("sweep-goals", {
			scenes: "full",
			goals: "full",
			"goal-reached": "full",
			summary: "off",
			lore: "off",
			cast: "off",
			"world-state": "off",
			relationships: "off"
		})
		await turn(sessionId, answer({ scenes: [{ name: "The Old Mill", content: "A ruin by the weir." }], goals: "- [ ] Reach the mill\n- [ ] Find the key" }))
		const place = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(and(eq(schema.lorebookEntries.title, "The Old Mill"), sql`split_part(${schema.lorebookEntries.typeId}, '@', 1) = 'core:entry/location'`))
		expect(place, "the place was filed").toHaveLength(1)
		const [row] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect((row!.annex as any)?.core?.["story-goals"]).toContain("Find the key")
		const said = async () =>
			(await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId))).filter((m) =>
				(m.content ?? "").startsWith("Goal")
			)
		expect(await said(), "nothing ticked yet").toEqual([])

		await turn(sessionId, answer({ goals: "- [x] Reach the mill\n- [ ] Find the key" }))
		const lines = await said()
		expect(lines.map((m) => m.content)).toEqual(["Goal reached: Reach the mill."])
		expect(lines[0]!.isNarratorResponse).toBe(true)
		const told = await db
			.select({ userId: schema.notifications.userId, vars: schema.notifications.vars })
			.from(schema.notifications)
			.where(eq(schema.notifications.kind, "core:notification/goal-reached@1"))
		expect(told).toEqual([expect.objectContaining({ userId: ownerId, vars: expect.objectContaining({ goal: "Reach the mill" }) })])

		// The same tick again says nothing new.
		await turn(sessionId, answer({ goals: "- [x] Reach the mill\n- [ ] Find the key" }))
		expect(await said()).toHaveLength(1)
	}, 240_000)
})
