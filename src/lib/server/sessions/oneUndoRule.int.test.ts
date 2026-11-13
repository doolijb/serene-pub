/**
 * 🚧 The one undo rule, end to end (lane sense-st2, PLAN-sensible-engine §2.12):
 * what a reply changed about the world goes with it, by one rule through every
 * door that undoes a reply — `retractStateAnchoredTo(db, id, "replaced" | "leaves")`.
 *
 *  · **replaced**: a swipe, a regenerate, a failed run's cleanup;
 *  · **leaves**: Back (`rewindTurn`) and delete (`core:outlet/delete-message`).
 *
 * Both take a stat value, a clock move, a scene boundary, an annex write and a
 * seat bench. Two differences on **replaced** only: the round's tick stays
 * (ruled ★ST2-1, owner 2026-11-11), and the session imprint rows of an annex key declared `keepOnRetell` stay standing.
 * Forward restores what Back took; a swipe whose run failed puts back what it
 * took; a person's press that opened no row anchors its annex write to the
 * session's newest message, except the annex field's own action.
 *
 * Every writer here is the real one: `setValue`, the host's `advance-story-clock`,
 * `set-session-annex` and `set-seat-bench` outlets, `openScene`. The only mock
 * besides the usual quiet broadcast and embedding stubs is the reply road
 * (`runReply`, as `sockets/sessions.retractAnnounce.int.test.ts` does) and the
 * session genre's *shape* for Story, so the genre opts in to `writes.seats` the
 * way the Dungeon Crawler does; its annex declarations are the real ones.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "one-undo-rule-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock(
	"$lib/server/sockets/utils/broadcastHelpers",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("$lib/server/sockets/utils/broadcastHelpers")
			>()
		return {
			...real,
			emitToUserRedacted: async () => {},
			broadcastToSessionUsers: async () => {}
		}
	}
)

/** The reply road: nothing is generated; each case sets what the run answers. */
const runReplyMock = vi.fn(
	async (..._args: any[]) =>
		({ ok: true }) as { ok: boolean; stopped?: boolean }
)
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: (...args: any[]) => runReplyMock(...args)
}))

/** Story's shape with `writes.seats` on — the genre opting in, as the Dungeon Crawler does; any other genre is real. */
const STORY = "core:genre/story"
vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("$lib/server/pipelines/entities/sessionGenres")
			>()
		return {
			...real,
			getSessionGenre: async (d: unknown, id: string) =>
				id === STORY
					? {
							genreId: id,
							name: "Story",
							shape: {
								writes: {
									lore: true,
									scenes: true,
									seats: true
								}
							}
						}
					: (real.getSessionGenre as any)(d, id)
		}
	}
)

const DUNGEON_CRAWLER = "core:genre/dungeon-crawler"
const GOALS = "story-goals"
const PROGRESS = "dungeon-crawler-progress"
const JOURNAL = "dungeon-crawler-journal"

const ADVANCE = {
	key: "advance",
	definitionId: "core:outlet/advance-story-clock",
	definitionVersion: 1
} as any
const SET_ANNEX = {
	key: "annex",
	definitionId: "core:outlet/set-session-annex",
	definitionVersion: 1
} as any
const BENCH = {
	key: "bench",
	definitionId: "core:outlet/set-seat-bench",
	definitionVersion: 1
} as any
const DELETE = {
	key: "delete",
	definitionId: "core:outlet/delete-message",
	definitionVersion: 1
} as any

let ownerId: number
let characterId: number
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-one-undo-rule-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	// The swipe is a built-in (`core:spec/builtin-swipe`): published, as boot does.
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "one-undo-rule-owner")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Mara", description: "A miller." })
		.returning()
	characterId = character!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const quietIo = () =>
	({
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} }),
		emit: () => {}
	}) as any
const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: quietIo() }) as any
const noopEmit = () => {}
const d = () => db as unknown as Db

interface World {
	sessionId: number
	seatId: number
	/** The person's line. */
	person: number
	/** The reply R: the newest message, the one the writes are anchored to. */
	reply: number
}

/** A session on its own book with a story clock at Year 412, month 3, day 5, 09:00: a person's line, then reply R. */
async function world(genreId: string = STORY): Promise<World> {
	const k = ++n
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Undo book ${k}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Undo ${k}`,
			genreId,
			lorebookId: lorebook!.id,
			storyClockYear: 412,
			storyClockMonth: 3,
			storyClockDay: 5,
			storyClockHour: 9,
			storyClockMinute: 0
		})
		.returning()
	const [seat] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session!.id, characterId, isActive: true })
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const person = await insertLegacy(d(), {
		sessionId: session!.id,
		userId: ownerId,
		role: "user",
		content: "We walk to the mill.",
		channel: "main"
	} as any)
	const reply = await insertLegacy(d(), {
		sessionId: session!.id,
		role: "assistant",
		isNarratorResponse: true,
		content: "The mill looms.",
		channel: "main"
	} as any)
	return {
		sessionId: session!.id,
		seatId: seat!.id,
		person: person.id,
		reply: reply.id
	}
}

/** A line after the world's reply (the DC cases write earlier turns first). */
async function line(
	w: World,
	role: "user" | "assistant",
	content: string
): Promise<number> {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const row = await insertLegacy(d(), {
		sessionId: w.sessionId,
		role,
		content,
		channel: "main",
		...(role === "user"
			? { userId: ownerId }
			: { isNarratorResponse: true })
	} as any)
	return row.id
}

/** A host for one run of `specId`; `turn` ties the run to a message as a reply's run is. */
async function host(
	w: World,
	opts: { specId?: string; turn?: number | null } = {}
) {
	const runId = `undo-run-${++n}`
	if (opts.turn !== null) {
		const { noteTurnMessage } = await import(
			"$lib/server/pipelines/runtime/runTurnMessage"
		)
		noteTurnMessage(runId, opts.turn ?? w.reply)
	}
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(d(), {
		sessionId: w.sessionId,
		userId: ownerId,
		specId: opts.specId ?? "core:spec/one-undo-rule",
		runId
	} as any)
}

/** What reply R wrote: one of each of the five. `cause` is the clock move's. */
async function replyWrites(w: World, cause: "keeper" | "action" = "keeper") {
	const { setValue } = await import("$lib/server/state/write")
	// A stat value on the session, anchored to R (the weather slot, as the live-scenes retraction test uses).
	await setValue(
		d(),
		{
			sessionId: w.sessionId,
			updatedBy: "run:one-undo-rule",
			messageId: w.reply,
			userId: ownerId
		},
		{
			owner: { kind: "session", id: w.sessionId },
			slotId: "core:slot/weather@1",
			value: "storm"
		} as any
	)
	const h = await host(w)
	await h.commit!({ by: 5, unit: "minutes", cause }, ADVANCE)
	const { openScene } = await import("$lib/server/scenes/liveScenes")
	await openScene(d(), {
		sessionId: w.sessionId,
		userId: ownerId,
		atMessageId: w.reply
	})
	await h.commit!({ value: { [GOALS]: "Reach the mill." } }, SET_ANNEX)
	await h.commit!({ seat: `character:${characterId}`, benched: true }, BENCH)
	await settle()
}

async function annexOf(sessionId: number): Promise<Record<string, any>> {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return (row?.annex ?? {}) as Record<string, any>
}
/** The session's seat bench imprints still standing (`session_imprints`, kind `seat-bench`), oldest first. */
const benchRows = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.sessionImprints)
			.where(
				and(
					eq(schema.sessionImprints.sessionId, sessionId),
					eq(schema.sessionImprints.subjectKind, "seat-bench")
				)
			)
			.orderBy(schema.sessionImprints.id)
	).map((r) => ({
		messageId: r.messageId,
		key: r.subjectKey,
		before: (r.before as { v: unknown } | null)?.v,
		after: (r.after as { v: unknown } | null)?.v
	}))
const clockRows = (sessionId: number) =>
	db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				eq(schema.stateProposals.kind, "clock")
			)
		)

/** The events a write emits run in the background and make the session busy until they settle; swipe and regenerate refuse while one does. */
const settle = async () =>
	(
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()

/** Wait until no run of the session is registered (a turn-order run an added line starts), so the verb gate reads the session as idle. */
async function idle(w: World) {
	const registry = await import("$lib/server/pipelines/runtime/runRegistry")
	for (let i = 0; i < 200; i++) {
		await settle()
		if (!registry.active().some((h) => h.sessionId === w.sessionId)) return
		await new Promise((r) => setTimeout(r, 100))
	}
}

/** The five, as they stand. */
async function five(w: World) {
	const [clock] = await db
		.select({
			hour: schema.sessions.storyClockHour,
			minute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, w.sessionId))
	const [seat] = await db
		.select({ active: schema.sessionCharacters.isActive })
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.id, w.seatId))
	return {
		values: (
			await db
				.select()
				.from(schema.attributeValues)
				.where(eq(schema.attributeValues.sessionId, w.sessionId))
		).length,
		clock: `${clock!.hour}:${String(clock!.minute).padStart(2, "0")}`,
		scenes: (
			await db
				.select()
				.from(schema.scenes)
				.where(eq(schema.scenes.sessionId, w.sessionId))
		).length,
		goals: (await annexOf(w.sessionId)).core?.[GOALS],
		seatActive: seat!.active
	}
}
const WROTE = {
	values: 1,
	clock: "9:05",
	scenes: 1,
	goals: "Reach the mill.",
	seatActive: false
}
const TAKEN = {
	values: 0,
	clock: "9:00",
	scenes: 0,
	goals: undefined,
	seatActive: true
}

const swipe = async (w: World) =>
	await idle(w)
		.then(() => import("$lib/server/sockets/sessions"))
		.then((m) =>
			m.sessionMessagesSwipeRightHandler.handler(
				fakeSocket(ownerId),
				{ id: w.reply } as any,
				noopEmit
			)
		)
const regenerate = async (w: World) =>
	await idle(w)
		.then(() => import("$lib/server/sockets/sessions"))
		.then((m) =>
			m.sessionMessagesRegenerateHandler.handler(
				fakeSocket(ownerId),
				{ id: w.reply } as any,
				noopEmit
			)
		)
const back = async (w: World) =>
	await idle(w)
		.then(() => import("$lib/server/sessions/rewind"))
		.then((m) =>
			m.rewindTurn(d(), { sessionId: w.sessionId, userId: ownerId })
		)
const forward = (w: World) =>
	import("$lib/server/sessions/rewind").then((m) =>
		m.forwardTurn(d(), { sessionId: w.sessionId, userId: ownerId })
	)
/** The swipe and regenerate handlers leave the row generating (the reply road is mocked): settle it before Back. */
const settleRow = (w: World) =>
	db
		.update(schema.sessionMessages)
		.set({ isGenerating: false })
		.where(eq(schema.sessionMessages.id, w.reply))

describe("one undo rule: a reply that wrote a value, a clock move, a scene, an annex write and a seat bench", () => {
	it("the writers really wrote all five (the baseline every case starts from)", async () => {
		const w = await world()
		expect(await five(w)).toEqual({
			values: 0,
			clock: "9:00",
			scenes: 0,
			goals: undefined,
			seatActive: true
		})
		await replyWrites(w)
		expect(await five(w)).toEqual(WROTE)
		expect(await benchRows(w.sessionId)).toEqual([
			{
				messageId: w.reply,
				key: `character:${w.seatId}`,
				before: false,
				after: true
			}
		])
	})

	it("regenerate takes the value, the clock move, the scene, the annex write and the seat bench", async () => {
		const w = await world()
		await replyWrites(w)
		const res: any = await regenerate(w)
		expect(res.error).toBeUndefined()
		expect(await five(w)).toEqual(TAKEN)
		expect(await clockRows(w.sessionId)).toEqual([])
		expect(await benchRows(w.sessionId)).toEqual([])
	})

	it("swipe takes the value, the clock move, the scene, the annex write and the seat bench", async () => {
		const w = await world()
		await replyWrites(w)
		const res: any = await swipe(w)
		expect(res.error).toBeUndefined()
		expect(await five(w)).toEqual(TAKEN)
		expect(await clockRows(w.sessionId)).toEqual([])
		expect(await benchRows(w.sessionId)).toEqual([])
	})

	it("Back takes all five and Forward restores all five", async () => {
		const w = await world()
		await replyWrites(w)
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await five(w)).toEqual(TAKEN)
		expect(await clockRows(w.sessionId)).toEqual([])
		expect(await forward(w)).toMatchObject({ ok: true })
		expect(await five(w)).toEqual(WROTE)
		expect(await clockRows(w.sessionId)).toHaveLength(1)
		expect(await benchRows(w.sessionId)).toEqual([
			{
				messageId: w.reply,
				key: `character:${w.seatId}`,
				before: false,
				after: true
			}
		])
	})

	it("delete (the delete outlet) takes all five, the scene boundary too", async () => {
		const w = await world()
		await replyWrites(w)
		const h = await host(w, {
			specId: "core:spec/builtin-delete",
			turn: null
		})
		await h.commit!({ target: w.reply }, DELETE)
		expect(await five(w)).toEqual(TAKEN)
		expect(await clockRows(w.sessionId)).toEqual([])
		expect(await benchRows(w.sessionId)).toEqual([])
		const left = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, w.reply))
		expect(left).toEqual([])
	})

	it("a failed swipe (the run answers { ok: false }) puts all five back", async () => {
		const w = await world()
		await replyWrites(w)
		runReplyMock.mockResolvedValueOnce({ ok: false })
		const res: any = await swipe(w)
		expect(res.error).toBeUndefined()
		expect(runReplyMock).toHaveBeenCalled()
		expect(await five(w)).toEqual(WROTE)
		expect(await clockRows(w.sessionId)).toHaveLength(1)
		expect(await benchRows(w.sessionId)).toEqual([
			{
				messageId: w.reply,
				key: `character:${w.seatId}`,
				before: false,
				after: true
			}
		])
	})

	it("a stopped swipe (the person's stop) keeps the retraction: the five stay taken", async () => {
		const w = await world()
		await replyWrites(w)
		runReplyMock.mockResolvedValueOnce({ ok: false, stopped: true })
		const res: any = await swipe(w)
		expect(res.error).toBeUndefined()
		expect(await five(w)).toEqual(TAKEN)
	})
})

describe("one undo rule: the round's tick", () => {
	/** R's clock move is the round's tick (cause `tick`): applied, anchored to R, and the clock really moved. */
	async function tickWorld() {
		const w = await world()
		await (
			await host(w)
		).commit!({ by: 5, unit: "minutes", cause: "tick" }, ADVANCE)
		return w
	}
	const clockAt = async (w: World) => (await five(w)).clock

	it("a tick the world holds is applied, anchored to R, and moved the clock", async () => {
		const w = await tickWorld()
		const rows = await clockRows(w.sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ status: "applied", messageId: w.reply })
		expect(rows[0]!.payload).toMatchObject({ cause: "tick" })
		expect(await clockAt(w)).toBe("9:05")
	})

	it("swipe leaves the tick standing: one tick row, the clock not stepped back", async () => {
		const w = await tickWorld()
		const res: any = await swipe(w)
		expect(res.error).toBeUndefined()
		expect(await clockRows(w.sessionId)).toHaveLength(1)
		expect(await clockAt(w)).toBe("9:05")
	})

	it("regenerate leaves the tick standing: one tick row, the clock not stepped back", async () => {
		const w = await tickWorld()
		const res: any = await regenerate(w)
		expect(res.error).toBeUndefined()
		expect(await clockRows(w.sessionId)).toHaveLength(1)
		expect(await clockAt(w)).toBe("9:05")
	})

	it("swipe takes a keeper move and leaves the tick when R carries both", async () => {
		const w = await tickWorld()
		await (
			await host(w)
		).commit!({ by: 7, unit: "minutes", cause: "keeper" }, ADVANCE)
		expect(await clockAt(w)).toBe("9:12")
		await swipe(w)
		const rows = await clockRows(w.sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.payload).toMatchObject({ cause: "tick" })
		expect(await clockAt(w)).toBe("9:05")
	})

	it("Back takes the tick (the clock steps back) and Forward puts it back", async () => {
		const w = await tickWorld()
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await clockRows(w.sessionId)).toEqual([])
		expect(await clockAt(w)).toBe("9:00")
		expect(await forward(w)).toMatchObject({ ok: true })
		const rows = await clockRows(w.sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.payload).toMatchObject({ cause: "tick" })
		expect(await clockAt(w)).toBe("9:05")
	})

	it("delete takes the tick too", async () => {
		const w = await tickWorld()
		const h = await host(w, {
			specId: "core:spec/builtin-delete",
			turn: null
		})
		await h.commit!({ target: w.reply }, DELETE)
		expect(await clockRows(w.sessionId)).toEqual([])
		expect(await clockAt(w)).toBe("9:00")
	})
})

describe("one undo rule: a person's press anchors its annex write to the newest message", () => {
	const deltasOf = (sessionId: number) =>
		db
			.select()
			.from(schema.sessionImprints)
			.where(
				and(
					eq(schema.sessionImprints.sessionId, sessionId),
					eq(schema.sessionImprints.subjectKind, "annex")
				)
			)

	it("a press (run family action, no live row) files an annex imprint anchored to the newest message, and Back puts the annex back", async () => {
		const w = await world()
		const { withRunFamily } = await import("$lib/server/utils/llmQueue")
		const h = await host(w, { turn: null })
		await withRunFamily("action", () =>
			h.commit!({ value: { [GOALS]: "Pressed goal." } }, SET_ANNEX)
		)
		const deltas = await deltasOf(w.sessionId)
		expect(deltas).toHaveLength(1)
		expect(deltas[0]).toMatchObject({ messageId: w.reply, subjectKey: `core/${GOALS}` })
		expect((await annexOf(w.sessionId)).core?.[GOALS]).toBe("Pressed goal.")
		expect(await back(w)).toMatchObject({ ok: true })
		expect((await annexOf(w.sessionId)).core?.[GOALS]).toBeUndefined()
		expect(await deltasOf(w.sessionId)).toEqual([])
	})

	it("the annex field's own action (core:spec/set-annex-field) files no imprint, and Back leaves the value", async () => {
		const w = await world()
		const { withRunFamily } = await import("$lib/server/utils/llmQueue")
		const { ANNEX_FIELD_SPEC_ID } = await import("@serene-pub/sdk")
		expect(ANNEX_FIELD_SPEC_ID).toBe("core:spec/set-annex-field")
		const h = await host(w, { specId: ANNEX_FIELD_SPEC_ID, turn: null })
		await withRunFamily("action", () =>
			h.commit!({ value: { [GOALS]: "My own goal." } }, SET_ANNEX)
		)
		expect(await deltasOf(w.sessionId)).toEqual([])
		expect((await annexOf(w.sessionId)).core?.[GOALS]).toBe("My own goal.")
		expect(await back(w)).toMatchObject({ ok: true })
		expect((await annexOf(w.sessionId)).core?.[GOALS]).toBe("My own goal.")
	})
})

describe("one undo rule: the Dungeon Crawler's keepOnRetell fields", () => {
	const BEFORE = {
		progress: { goal: "Find the lamp.", settled: true },
		journal: { goal: "secret", leads: ["The cellar"] }
	}
	const TURN = {
		progress: {
			goal: "Find the lamp.",
			settled: true,
			built: true,
			lastTelling: { row: 0, brief: "The stair.", outcomes: "None." }
		},
		journal: { goal: "Find the lamp.", leads: ["The cellar", "The well"] }
	}

	/** Before-values filed at an earlier turn; reply R then writes the turn's values and benches the companion. */
	async function crawl() {
		const w = await world(DUNGEON_CRAWLER)
		// The world's own reply is the earlier turn, where the before-values were filed; the lines after it are the turn under test.
		const earlier = { id: w.reply }
		const person = await line(w, "user", "We go down.")
		const reply = await line(w, "assistant", "The stair is dark.")
		const dc: World = { ...w, person, reply }
		const first = await host(dc, { turn: earlier.id })
		await first.commit!(
			{
				value: {
					[PROGRESS]: BEFORE.progress,
					[JOURNAL]: BEFORE.journal
				}
			},
			SET_ANNEX
		)
		const second = await host(dc)
		await second.commit!(
			{ value: { [PROGRESS]: TURN.progress, [JOURNAL]: TURN.journal } },
			SET_ANNEX
		)
		await second.commit!(
			{ seat: `character:${characterId}`, benched: true },
			BENCH
		)
		return dc
	}
	const fields = async (w: World) => {
		const core = (await annexOf(w.sessionId)).core ?? {}
		return { progress: core[PROGRESS], journal: core[JOURNAL] }
	}
	const seatActive = async (w: World) =>
		(
			await db
				.select({ a: schema.sessionCharacters.isActive })
				.from(schema.sessionCharacters)
				.where(eq(schema.sessionCharacters.id, w.seatId))
		)[0]!.a

	it("the real declarations take both writes, and the turn's seat bench holds", async () => {
		const w = await crawl()
		expect(await fields(w)).toEqual(TURN)
		expect(await seatActive(w)).toBe(false)
	})

	it("swipe keeps progress and journal at the turn's values and takes the seat bench; Back after that takes both fields back", async () => {
		const w = await crawl()
		const res: any = await swipe(w)
		expect(res.error).toBeUndefined()
		expect(await fields(w)).toEqual(TURN)
		expect(await seatActive(w)).toBe(true)
		expect(await benchRows(w.sessionId)).toEqual([])
		await settleRow(w)
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await fields(w)).toEqual(BEFORE)
	})

	it("a failed re-tell keeps none of its own annex values, a keepOnRetell key included: the swipe's state comes back exactly", async () => {
		const w = await crawl()
		const failed = { goal: "The failed run's goal.", settled: false }
		const failedJournal = { goal: "Failed.", leads: ["The roof"] }
		runReplyMock.mockImplementationOnce(async () => {
			const run = await host(w)
			await run.commit!(
				{ value: { [PROGRESS]: failed, [JOURNAL]: failedJournal } },
				SET_ANNEX
			)
			return { ok: false }
		})
		const res: any = await swipe(w)
		expect(res.error).toBeUndefined()
		expect(await fields(w)).toEqual(TURN)
		expect(await seatActive(w)).toBe(false)
		expect(await benchRows(w.sessionId)).toEqual([
			{
				messageId: w.reply,
				key: `character:${w.seatId}`,
				before: false,
				after: true
			}
		])
		await settleRow(w)
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await fields(w)).toEqual(BEFORE)
	})

	it("Back without a swipe takes both fields back to their before-values and unbenches the seat", async () => {
		const w = await crawl()
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await fields(w)).toEqual(BEFORE)
		expect(await seatActive(w)).toBe(true)
	})
})

describe("one undo rule: a scene boundary goes with a line only when nothing sits after it", () => {
	const scenesOf = (w: World) =>
		db
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.sessionId, w.sessionId))
			.orderBy(schema.scenes.id)

	/** Lines P, R, L3, L4; scene A opened at P (closed at R), scene B opened at L3 (open). */
	async function arena() {
		const w = await world()
		const l3 = await line(w, "user", "She opens the door.")
		const l4 = await line(w, "assistant", "It creaks.")
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(d(), { sessionId: w.sessionId, userId: ownerId, atMessageId: w.person })
		await openScene(d(), { sessionId: w.sessionId, userId: ownerId, atMessageId: l3 })
		return { w, l3, l4 }
	}
	const retract = async (id: number, turnCase: "replaced" | "leaves") =>
		(await import("$lib/server/state/write")).retractStateAnchoredTo(d(), id, turnCase)
	const deleteRow = async (w: World, target: number) => {
		const h = await host(w, { specId: "core:spec/builtin-delete", turn: null })
		await h.commit!({ target }, DELETE)
	}
	const rowExists = async (id: number) =>
		(
			await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, id))
		).length === 1

	it("a regenerate of an older row keeps the scene opened at it, and the scene before stays closed", async () => {
		const { w, l3 } = await arena()
		const before = await scenesOf(w)
		expect(before).toHaveLength(2)
		const out = await retract(l3, "replaced")
		expect(out.taken.scenes).toEqual([])
		expect(await scenesOf(w)).toEqual(before)
	})

	it("a delete of an older row keeps the scene opened at it", async () => {
		const { w, l3 } = await arena()
		const before = await scenesOf(w)
		await deleteRow(w, l3)
		expect(await rowExists(l3)).toBe(false)
		expect(await scenesOf(w)).toEqual(before)
	})

	it("a regenerate of the newest row takes the scene opened at it and reopens the one before", async () => {
		const { w, l3, l4 } = await arena()
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(d(), { sessionId: w.sessionId, userId: ownerId, atMessageId: l4 })
		expect(await scenesOf(w)).toHaveLength(3)
		await retract(l4, "replaced")
		const after = await scenesOf(w)
		expect(after).toHaveLength(2)
		expect(after.find((s) => s.openedAtMessageId === l3)?.closedAtMessageId).toBeNull()
	})

	it("a delete of the newest row takes the scene opened at it and reopens the one before", async () => {
		const { w, l3, l4 } = await arena()
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(d(), { sessionId: w.sessionId, userId: ownerId, atMessageId: l4 })
		await deleteRow(w, l4)
		const after = await scenesOf(w)
		expect(after).toHaveLength(2)
		expect(after.find((s) => s.openedAtMessageId === l3)?.closedAtMessageId).toBeNull()
	})

	it("Back of a whole turn takes a scene opened at the person's line, and Forward puts it back", async () => {
		const w = await world()
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		await openScene(d(), { sessionId: w.sessionId, userId: ownerId, atMessageId: w.person })
		const before = await scenesOf(w)
		expect(before).toHaveLength(1)
		expect(await back(w)).toMatchObject({ ok: true })
		expect(await scenesOf(w)).toEqual([])
		expect(await forward(w)).toMatchObject({ ok: true })
		expect(await scenesOf(w)).toEqual(before)
	})

	it("deleting a turn's yield takes a scene opened at a yield row", async () => {
		const { w, l3, l4 } = await arena()
		const { deleteTurnYield } = await import("$lib/server/sessions/retakeTurn")
		const turn = {
			runId: 0,
			runUuid: "x",
			specSlug: "x",
			rows: [l3, l4].map((messageId) => ({ messageId, channel: "main", role: "assistant", characterId: null, name: "x" })),
			runs: []
		} as never
		const out = await deleteTurnYield(d(), { sessionId: w.sessionId, userId: ownerId, turn, io: quietIo() })
		expect(out).toMatchObject({ ok: true })
		const after = await scenesOf(w)
		expect(after).toHaveLength(1)
		expect(after[0]!.openedAtMessageId).toBe(w.person)
		expect(after[0]!.closedAtMessageId).toBeNull()
	})

	it("deleting a turn's yield keeps a scene when a later line outside the yield sits after it", async () => {
		const { w, l3 } = await arena()
		const { deleteTurnYield } = await import("$lib/server/sessions/retakeTurn")
		const turn = {
			runId: 0,
			runUuid: "x",
			specSlug: "x",
			rows: [{ messageId: l3, channel: "main", role: "user", characterId: null, name: "x" }],
			runs: []
		} as never
		const before = await scenesOf(w)
		const out = await deleteTurnYield(d(), { sessionId: w.sessionId, userId: ownerId, turn, io: quietIo() })
		expect(out).toMatchObject({ ok: true })
		expect(await scenesOf(w)).toEqual(before)
	})
})
