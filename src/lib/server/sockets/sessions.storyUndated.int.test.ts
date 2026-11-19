/**
 * 🚧 A first turn of each shipped Story preset with its own notes undated
 * (default since 2026-11-16): one reply, the card's calls, no failed run, no
 * error push, no refusal in ordinary play, and neither the notes' switch nor
 * the session clock moves.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "story-undated-test-secret" }
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
const pushes = vi.hoisted(() => [] as Array<{ sessionId: number; event: string; payload: any }>)
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, payload: any) => {
		pushes.push({ sessionId, event, payload })
	}
}))

const compiled: any[] = []
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
		compiled.push(p)
		return this
	}
	async generateText() {
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent("Hello there.")
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-story-undated-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "story-undated-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "undated-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Story undated test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function aCharacter(name: string) {
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name, description: "A quiet companion.", isPersona: false }).returning()
	return c!.id
}

async function createOn(name: string, seedKey: string, characterIds: number[]) {
	const [preset] = await db
		.select({ id: schema.sessionPresets.id, callsPerTurn: schema.sessionPresets.callsPerTurn })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	expect(preset, `preset ${seedKey} is seeded`).toBeTruthy()
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: preset!.id }, characterIds, personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return { sessionId: res.session.id as number, preset: preset! }
}

async function send(sessionId: number, content: string) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

const notesOn = async (sessionId: number) => {
	const [b] = await db
		.select({ on: schema.lorebooks.timelineEnabled })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
	return b!.on
}
const clockOf = async (sessionId: number) => {
	const [s] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return [s!.storyClockYear, s!.storyClockMonth, s!.storyClockDay, s!.storyClockHour, s!.storyClockMinute]
}

describe("a first Story turn with the notes undated", () => {
	it.each(["core-story-minimal", "core-story-living", "core-story-rule-based"])(
		"%s: one reply, the card's calls, no failed run, no refusal, notes and clock unmoved",
		async (seedKey) => {
			const { sessionId, preset } = await createOn(`undated-${seedKey}`, seedKey, [await aCharacter(`Wren ${seedKey}`)])
			expect(await notesOn(sessionId)).toBe(false)
			expect(await clockOf(sessionId)).toEqual([null, null, null, null, null])

			const calls0 = compiled.length
			const pushes0 = pushes.length
			await send(sessionId, "Tell me something.")

			const rows = await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId))
			expect(rows.filter((r) => r.role === "assistant").length).toBe(1)
			expect(compiled.length - calls0).toBe(preset.callsPerTurn)

			const runs = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.sessionId, sessionId))
			expect(runs.length).toBeGreaterThan(0)
			expect(runs.filter((r) => r.outcome === "err").map((r) => r.receipt)).toEqual([])
			const errPushes = pushes.slice(pushes0).filter((p) => p.sessionId === sessionId && (p.payload?.error || /error|failed/i.test(p.event)))
			expect(errPushes).toEqual([])

			// Only the Timeline-off sentences may appear in what the turn stored.
			const stored = JSON.stringify(runs.map((r) => r.receipt))
			const scenes = await db.select({ notes: schema.scenes.notes }).from(schema.scenes).where(eq(schema.scenes.sessionId, sessionId))
			const text = stored + JSON.stringify(scenes.map((s) => s.notes))
			const seen = Object.entries(TIMELINE_OFF_SENTENCES).filter(([, v]) => text.includes(v)).map(([k]) => k)
			console.log(`[story-undated] ${seedKey}: runs=${runs.length} timelineSentences=${JSON.stringify(seen)}`)
			expect(/has no timeline/.test(text.replaceAll(TIMELINE_OFF_SENTENCES.history, "").replaceAll(TIMELINE_OFF_SENTENCES.clock, "").replaceAll(TIMELINE_OFF_SENTENCES.dated, ""))).toBe(false)
			expect(seen).toEqual([])
			expect(/current date in the story/i.test(JSON.stringify(compiled.slice(calls0)))).toBe(false)

			expect(await notesOn(sessionId)).toBe(false)
			expect(await clockOf(sessionId)).toEqual([null, null, null, null, null])
		},
		120_000
	)
})

describe("a first Story turn on an attached lorebook whose timeline is switched off", () => {
	/** An attached book that had a timeline: a dated history entry and a set session clock. */
	async function staleWorld(name: string, timelineOn: boolean) {
		const seed = "core-story-minimal"
		const { sessionId } = await createOn(name, seed, [await aCharacter(`Wren ${name}`)])
		const [book] = await db
			.insert(schema.lorebooks)
			.values({ userId: ownerId, name: `Attached ${name}`, timelineEnabled: timelineOn })
			.returning()
		await db.insert(schema.lorebookEntries).values({
			lorebookId: book!.id,
			typeId: "core:entry/history",
			typeVersion: 1,
			position: 0,
			content: "The bell drowned.",
			fields: { year: 7771, month: 3, day: 4 }
		} as any)
		await db
			.update(schema.sessions)
			.set({
				lorebookId: book!.id,
				storyClockYear: 5555,
				storyClockMonth: 2,
				storyClockDay: 1,
				storyClockHour: 8,
				storyClockMinute: 0
			})
			.where(eq(schema.sessions.id, sessionId))
		// The session's notes copy the switch.
		await db.update(schema.lorebooks).set({ timelineEnabled: timelineOn }).where(eq(schema.lorebooks.sessionId, sessionId))
		return sessionId
	}

	it("carries no date and no stale year; the same world with its timeline on prints the date", async () => {
		const off = await staleWorld("stale-off", false)
		const calls0 = compiled.length
		await send(off, "Tell me something.")
		const offText = JSON.stringify(compiled.slice(calls0))
		expect(compiled.length).toBeGreaterThan(calls0)
		expect(/current date in the story/i.test(offText)).toBe(false)
		expect(offText).not.toContain("7771")
		expect(offText).not.toContain("5555")

		const on = await staleWorld("stale-on", true)
		const calls1 = compiled.length
		await send(on, "Tell me something.")
		const onText = JSON.stringify(compiled.slice(calls1))
		expect(/current date in the story/i.test(onText)).toBe(true)
		expect(onText).toContain("5555")
	}, 120_000)
})
