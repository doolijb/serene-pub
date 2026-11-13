/**
 * 🚧 The round tick, proven in the app (PLAN-sensible-engine §2.11, lanes
 * sense-clk and sense-clk2): *Each round moves the clock* is an event pipeline
 * on `round-ended`, registered by **Story only** (owner, 2026-11-11: "Story
 * should be round"; the Lair's keeper and the Dungeon Crawler's turn own their
 * clocks — see `clockOwners.int.test.ts`), and runs with routines switched off
 * (they are not involved). It reads the round worth (`core:query/round-worth@1`,
 * the genre field `roundWorth`); the genre field is not yet placed, so this
 * file controls the worth by mocking the binding. The real chain is proven in
 * `roundWorth.genres.int.test.ts`. Real Story turns with a scripted model:
 *
 *  · a session with a story clock moves 5 minutes once, with a line under the
 *    reply that closed the round, cause `tick`;
 *  · a round worth of 0 moves nothing and writes no line;
 *  · a session with no story clock moves nothing, starts none, writes no line;
 *  · deleting the closing message takes the move back;
 *  · only Story registers it (the Lair, the Guide, Chat and the Dungeon
 *    Crawler do not);
 *  · a second boot changes nothing.
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

async function ledgerTexts(sessionId: number, lorebookId: number) {
	const { clockLedgerRows } = await import("$lib/server/state/clockMoves")
	const { ledgerLines } = await import("$lib/shared/state/ledgerLines")
	return ledgerLines(
		(await clockLedgerRows(db as never, sessionId, lorebookId)).map(
			(m) => ({
				id: m.id,
				kind: "clock" as const,
				messageId: m.messageId,
				ownerKey: "world",
				ownerLabel: "World",
				updatedBy: m.updatedBy,
				clock: m
			})
		)
	).map((l) => l.text)
}

describe("each round moves the clock", () => {
	it("a Story session with a story clock moves 5 minutes once when a round ends, with a line under the closing message", async () => {
		const { sessionId, lorebookId } = await living()
		worth.minutes = 5
		await send(sessionId)
		expect(await clockOf(sessionId)).toEqual({
			year: 412,
			month: 3,
			day: 5,
			hour: 9,
			minute: 5
		})
		const rows = await clockRows(sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			status: "applied",
			messageId: (await replyOf(sessionId)).id
		})
		expect(rows[0]!.payload).toMatchObject({
			kind: "clock",
			by: 5,
			unit: "minutes",
			cause: "tick"
		})
		const runs = await tickRuns(sessionId)
		expect(runs).toHaveLength(1)
		expect(runs[0]).toMatchObject({ triggerFamily: "event", outcome: "ok" })
		const texts = await ledgerTexts(sessionId, lorebookId)
		expect(texts).toHaveLength(1)
		expect(texts[0]).toMatch(/^Time passes: 5 minutes \(/)
	})

	it("a round worth of 0 does not move the clock and writes no line", async () => {
		const { sessionId, lorebookId } = await living()
		worth.minutes = 0
		try {
			await send(sessionId)
		} finally {
			worth.minutes = 5
		}
		expect(await clockOf(sessionId)).toEqual({
			year: 412,
			month: 3,
			day: 5,
			hour: 9,
			minute: 0
		})
		expect(await clockRows(sessionId)).toEqual([])
		expect(await ledgerTexts(sessionId, lorebookId)).toEqual([])
		expect(await tickRuns(sessionId)).toHaveLength(1)
	})

	it("a Story session with no story clock does not move, starts none and writes no line", async () => {
		const { sessionId } = await living({ clock: false })
		await send(sessionId)
		expect(await clockOf(sessionId)).toEqual({
			year: null,
			month: null,
			day: null,
			hour: null,
			minute: null
		})
		expect(await clockRows(sessionId)).toEqual([])
		expect(await tickRuns(sessionId)).toHaveLength(1)
	})

	it("deleting the closing message takes the move back", async () => {
		const { sessionId } = await living()
		await send(sessionId)
		expect(await clockOf(sessionId)).toMatchObject({ hour: 9, minute: 5 })
		const replyId = (await replyOf(sessionId)).id
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = await createHost(
			db as never,
			{
				sessionId,
				userId: ownerId,
				specId: "core:spec/builtin-delete",
				runId: "run-round-tick-delete"
			} as any
		)
		await host.commit!({ target: replyId }, {
			key: "delete",
			definitionId: "core:outlet/delete-message",
			definitionVersion: 1
		} as any)
		expect(await clockOf(sessionId)).toMatchObject({ hour: 9, minute: 0 })
		expect(await clockRows(sessionId)).toEqual([])
	})

	it("Story and the Lair register it", async () => {
		const { genreRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		for (const genre of ["core:genre/story", "core:genre/lair"]) {
			const regs = await genreRegistrations(db as never, genre)
			const ticks = regs.filter((r) => r.pipeline === ROUND_TICK)
			expect(ticks, genre).toHaveLength(1)
			expect(ticks[0]!.trigger).toMatchObject({
				family: "event",
				event: ROUND_ENDED
			})
		}
		for (const genre of [
			"core:genre/guide",
			"core:genre/chat",
			"core:genre/dungeon-crawler"
		]) {
			const others = await genreRegistrations(db as never, genre)
			expect(
				others.filter((r) => r.pipeline === ROUND_TICK),
				genre
			).toEqual([])
		}
	})

	it("a second boot changes nothing", async () => {
		const snapshot = async () =>
			await db
				.select({
					id: schema.registrations.id,
					key: schema.registrations.key,
					scopeKind: schema.registrations.scopeKind,
					scopeRef: schema.registrations.scopeRef,
					values: schema.registrations.values,
					// A row the boot re-wrote with the same values still moves this.
					updatedAt: schema.registrations.updatedAt
				})
				.from(schema.registrations)
				.where(eq(schema.registrations.specSlug, ROUND_TICK))
				.orderBy(asc(schema.registrations.id))
		const before = await snapshot()
		expect(before.length).toBeGreaterThanOrEqual(1)
		const { bootstrapPipelines } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		await bootstrapPipelines(db)
		expect(await snapshot()).toEqual(before)
	})
})
