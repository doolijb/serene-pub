/**
 * 🚧 The round's tick against the one undo rule (lane sense-st2, interim ★ST2-1),
 * on real Story turns with a scripted model: Back takes the tick of the reply
 * that closed the round (a swipe and a regenerate leave it, proven in
 * `sessions/oneUndoRule.int.test.ts`), so a new reply that closes the round
 * ticks once — net exactly one tick row, the clock 5 minutes on, never two.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

/** The round worth the mocked binding publishes; each case sets it. */
const worth = vi.hoisted(() => ({
	minutes: 5,
	get step() {
		return { by: this.minutes, unit: "minutes" as const }
	}
}))
vi.mock("$lib/server/pipelines/runtime/roundWorth", async (orig) => ({
	...(await orig<
		typeof import("$lib/server/pipelines/runtime/roundWorth")
	>()),
	roundWorthBindings: () => ({
		"core:query/round-worth@1": reads<typeof C.roundWorth>(
			async () =>
				ok({
					main: { minutes: worth.minutes, step: worth.step },
					minutes: worth.minutes,
					step: worth.step
				}),
			{ ports: ["scope"] }
		)
	})
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "round-tick-int-test-secret" }
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
		return {
			compiledPrompt: this.injected ?? {
				prompt: "p",
				messages: undefined,
				meta: {}
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) =>
				onContent("They walk on.")
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const ROUND_TICK = "core:spec/round-tick"
const ROUND_ENDED = "core:event/round-ended@1"

let ownerId: number
let n = 0
const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-round-tick-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "round-tick-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"round-tick-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Round tick test sampling",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 300,
				temperature: 0.2
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

/** A Story · Living session on a fresh book; with its own clock at Year 412, month 3, day 5, 09:00 unless `clock` is false. */
async function living(opts: { clock?: boolean } = {}) {
	const name = `tick-${++n}`
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `The Mill ${name}` })
		.returning()
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	const [c] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: `Maren ${name}`,
			description: "A miller.",
			isPersona: false
		})
		.returning()
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: p!.id },
			characterIds: [c!.id],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db
		.update(schema.sessions)
		.set({
			lorebookId: book!.id,
			...(opts.clock === false
				? {}
				: {
						storyClockYear: 412,
						storyClockMonth: 3,
						storyClockDay: 5,
						storyClockHour: 9,
						storyClockMinute: 0
					})
		})
		.where(eq(schema.sessions.id, sessionId))
	return { sessionId, lorebookId: book!.id }
}

async function send(sessionId: number, content = "We walk to the mill.") {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

const clockOf = async (sessionId: number) =>
	(
		await db
			.select({
				year: schema.sessions.storyClockYear,
				month: schema.sessions.storyClockMonth,
				day: schema.sessions.storyClockDay,
				hour: schema.sessions.storyClockHour,
				minute: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

const clockRows = async (sessionId: number) =>
	db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				eq(schema.stateProposals.kind, "clock")
			)
		)
		.orderBy(asc(schema.stateProposals.id))

const tickRuns = async (sessionId: number) =>
	db
		.select({
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason,
			triggerFamily: schema.pipelineRuns.triggerFamily
		})
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				eq(schema.pipelineRuns.specSlug, ROUND_TICK)
			)
		)

const replyOf = async (sessionId: number) =>
	(
		await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					eq(schema.sessionMessages.role, "assistant")
				)
			)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(1)
	)[0]!

const back = async (sessionId: number) =>
	(await import("$lib/server/sessions/rewind")).rewindTurn(db as never, {
		sessionId,
		userId: ownerId
	})
const forward = async (sessionId: number) =>
	(await import("$lib/server/sessions/rewind")).forwardTurn(db as never, {
		sessionId,
		userId: ownerId
	})

describe("the round's tick and Back", () => {
	it("Back takes the closing reply's tick; the next reply that closes the round ticks once: one tick row, the clock 5 minutes on", async () => {
		const { sessionId } = await living()
		worth.minutes = 5
		await send(sessionId)
		expect(await clockOf(sessionId)).toMatchObject({ hour: 9, minute: 5 })
		expect(await clockRows(sessionId)).toHaveLength(1)
		const first = (await replyOf(sessionId)).id

		expect(await back(sessionId)).toMatchObject({ ok: true })
		expect(await clockOf(sessionId)).toMatchObject({ hour: 9, minute: 0 })
		expect(await clockRows(sessionId)).toEqual([])

		await send(sessionId, "We turn back.")
		const rows = await clockRows(sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			status: "applied",
			messageId: (await replyOf(sessionId)).id
		})
		expect(rows[0]!.messageId).not.toBe(first)
		expect(rows[0]!.payload).toMatchObject({
			kind: "clock",
			by: 5,
			unit: "minutes",
			cause: "tick"
		})
		expect(await clockOf(sessionId)).toEqual({
			year: 412,
			month: 3,
			day: 5,
			hour: 9,
			minute: 5
		})
	})

	it("Back then Forward: the tick is put back, once", async () => {
		const { sessionId } = await living()
		worth.minutes = 5
		await send(sessionId)
		expect(await back(sessionId)).toMatchObject({ ok: true })
		expect(await clockRows(sessionId)).toEqual([])
		expect(await forward(sessionId)).toMatchObject({ ok: true })
		expect(await clockRows(sessionId)).toHaveLength(1)
		expect(await clockOf(sessionId)).toMatchObject({ hour: 9, minute: 5 })
	})
})
