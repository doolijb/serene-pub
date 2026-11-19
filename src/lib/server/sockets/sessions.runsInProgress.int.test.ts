/**
 * Runs in progress (programme 0.9, lane ss-7): what a run's frame tells the
 * page, what the session's first page carries, who may stop what, and which
 * presses wait while a run is going.
 *
 * Owner 2026-11-16: "have the user manually stop what ever is running first".
 * Swipe (both ways), regenerate, Regenerate the last turn, Back and delete wait
 * while an action, a routine or a reply runs; Edit, Forward, sending a line and
 * Continue never wait; a run parked at review or bound to one line holds
 * nothing. Runs are registered directly (`runRegistry.start`): the real
 * routine path is covered by `sessions.editedLineRerun.int.test.ts`.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	RUN_WORKING_WORDS,
	waitForRunSentence
} from "$lib/shared/sessions/runsInProgress"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

/** Every `sessions:runStatus` frame, in order. */
const frames = vi.hoisted(() => [] as any[])
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (
		_io: unknown,
		_sessionId: number,
		event: string,
		data: any
	) => {
		if (event === "sessions:runStatus") frames.push(data)
	}
}))

const io = { to: () => ({ emit: () => {} }) } as any
const socketOf = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin }, io }) as any
const emit = () => {}
const WAIT = /to finish, or stop it first\.$/
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-runs-in-progress-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await (
		await import("$lib/server/pipelines/boot/bootstrap")
	).bootstrapPipelines(db)
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

beforeEach(async () => {
	frames.length = 0
	;(await import("$lib/server/pipelines/runtime/runRegistry"))._reset()
	;(await import("$lib/server/pipelines/routines/runs"))._resetRoutineRuns()
})

async function room() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const k = ++n
	const owner = await createTestUser(db, `rip-owner-${k}`)
	const guest = await createTestUser(db, `rip-guest-${k}`)
	const stranger = await createTestUser(db, `rip-stranger-${k}`)
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false })
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	const [line] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			role: "user",
			content: "Hello.",
			channel: "main"
		} as any)
		.returning()
	const [reply] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			content: "Hi.",
			channel: "main",
			isGenerating: false
		} as any)
		.returning()
	return {
		owner,
		guest,
		stranger,
		session: session!,
		line: line!,
		reply: reply!
	}
}

type Kind = "reply" | "action" | "routine" | "maintenance"
async function register(
	sessionId: number,
	userId: number,
	kind: Kind,
	extra: Partial<{
		name: string
		lineBound: true
		readsMessageId: number
		status: boolean
	}> = {}
) {
	const reg = await import("$lib/server/pipelines/runtime/runRegistry")
	const runId = `rip-${kind}-${++n}`
	const handle = reg.start({
		runId,
		userId,
		sessionId,
		kind,
		...(extra.name ? { name: extra.name } : {}),
		...(extra.lineBound ? { lineBound: true as const } : {}),
		...(extra.readsMessageId !== undefined
			? { readsMessageId: extra.readsMessageId }
			: {})
	})
	if (extra.status !== false && kind !== "routine")
		reg.setStatus(runId, {
			i18n: { en: kind === "reply" ? "Wren is typing" : "Working" }
		})
	if (kind === "routine") {
		const { noteRoutineRun } = await import(
			"$lib/server/pipelines/routines/runs"
		)
		noteRoutineRun(runId, {
			sessionId,
			registrationKey: "reg:sweep",
			depth: 0,
			shownAs: { name: extra.name ?? "Sweep" }
		})
	}
	return { runId, handle, finish: () => reg.finish(runId) }
}

describe("a run's frames carry its facts", () => {
	it("a status frame carries sessionId, kind, name, since and mayStop; the end frame too", async () => {
		const { session, owner } = await room()
		const { createStatusRelay } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const run = await register(session.id, owner.id, "action", {
			name: "Draw a map",
			status: false
		})
		const relay = createStatusRelay({
			db: db as unknown as Db,
			io,
			sessionId: session.id,
			runId: run.runId,
			live: { status: async () => {} } as any,
			kind: "action"
		})
		relay.set("draw", { i18n: { en: "Drawing" } })
		await relay.end()
		expect(frames).toHaveLength(3)
		expect(frames[1]).toMatchObject({
			sessionId: session.id,
			runId: run.runId,
			kind: "action",
			name: "Draw a map",
			since: run.handle.startedAt,
			mayStop: true
		})
		expect(frames[1].status).toEqual({ i18n: { en: "Drawing" } })
		expect(frames[2]).toMatchObject({
			status: null,
			name: "Draw a map",
			since: run.handle.startedAt
		})
		run.finish()
	})

	it("a reply is named 'the reply'; a line-bound run's frame may not be stopped by a member", async () => {
		const { session, owner } = await room()
		const { createStatusRelay } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const reply = await register(session.id, owner.id, "reply", {
			status: false
		})
		const relay = createStatusRelay({
			db: db as unknown as Db,
			io,
			sessionId: session.id,
			runId: reply.runId,
			live: { status: async () => {} } as any,
			kind: "reply"
		})
		relay.set("speak", { i18n: { en: "Typing" } })
		await relay.end()
		expect(frames[0]).toMatchObject({ name: "the reply", mayStop: true })
		frames.length = 0
		const speak = await register(session.id, owner.id, "maintenance", {
			lineBound: true,
			status: false
		})
		const relay2 = createStatusRelay({
			db: db as unknown as Db,
			io,
			sessionId: session.id,
			runId: speak.runId,
			live: { status: async () => {} } as any,
			kind: "maintenance",
			lineBound: true
		})
		relay2.set("speak", { i18n: { en: "Speaking" } })
		await relay2.end()
		expect(frames[0]).toMatchObject({ lineBound: true, mayStop: false })
		reply.finish()
		speak.finish()
	})

	it("an unregistered run's frame carries no facts", async () => {
		const { session } = await room()
		const { createStatusRelay } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const relay = createStatusRelay({
			db: db as unknown as Db,
			io,
			sessionId: session.id,
			runId: "rip-preview",
			live: { status: async () => {} } as any,
			kind: "action"
		})
		relay.set("n", { i18n: { en: "Previewing" } })
		await relay.end()
		expect(frames[0].since).toBeUndefined()
		expect(frames[0].name).toBeUndefined()
		expect(frames[0].mayStop).toBeUndefined()
	})

	it("a routine's frames carry readsMessageId when its cause named a line", async () => {
		const { session, owner, line } = await room()
		const { showRoutineRun } = await import(
			"$lib/server/pipelines/routines/run"
		)
		const run = await register(session.id, owner.id, "routine", {
			name: "Sweep",
			readsMessageId: line.id
		})
		const shown = showRoutineRun({
			io,
			db: db as unknown as Db,
			sessionId: session.id,
			runId: run.runId,
			name: "Sweep",
			fact: (
				await import("$lib/server/pipelines/routines/runs")
			).routineRunOf(run.runId)!
		})
		await new Promise((r) => setTimeout(r, 600))
		expect(frames[0]).toMatchObject({
			kind: "routine",
			name: "Sweep",
			readsMessageId: line.id,
			since: run.handle.startedAt,
			mayStop: true,
			routine: { name: "Sweep" }
		})
		shown.clear()
		await new Promise((r) => setTimeout(r, 50))
		expect(frames.at(-1)).toMatchObject({
			status: null,
			readsMessageId: line.id
		})
		run.finish()
	})

	it("a run parked at review says so, and its end frame clears it", async () => {
		const { session, owner } = await room()
		const { createReviewer, pendingReviewsFor, resolveReview } =
			await import("$lib/server/pipelines/runtime/reviewGate")
		const { createStatusRelay } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const run = await register(session.id, owner.id, "action", {
			name: "Rest",
			status: false
		})
		const relay = createStatusRelay({
			db: db as unknown as Db,
			io,
			sessionId: session.id,
			runId: run.runId,
			live: { status: async () => {} } as any,
			kind: "action"
		})
		const reviewer = createReviewer({
			userId: owner.id,
			sessionId: session.id,
			specId: "core:spec/parked",
			signal: run.handle.controller.signal
		})
		const decided = reviewer({
			nodeKey: "write",
			definitionId: "core:outlet/update-lore-entry",
			payload: { content: "x" },
			position: "on"
		} as any)
		await new Promise((r) => setTimeout(r, 50))
		expect(run.handle.parked).toBe(true)
		expect(frames.at(-1)).toMatchObject({
			runId: run.runId,
			name: "Rest",
			parked: true,
			since: run.handle.startedAt
		})
		resolveReview(pendingReviewsFor(owner.id)[0]!.id, owner.id, "approve")
		await decided
		await new Promise((r) => setTimeout(r, 50))
		expect(run.handle.parked).toBeUndefined()
		expect(frames.at(-1).parked).toBeUndefined()
		// The park's frame stands until an end frame clears it, status or none.
		await relay.end()
		expect(frames.at(-1)).toMatchObject({ status: null, runId: run.runId })
		expect(frames.at(-1).parked).toBeUndefined()
		run.finish()
	})

	it("a run at two review gates stays parked until both are decided", async () => {
		const { session, owner } = await room()
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const run = await register(session.id, owner.id, "action")
		reg.setParked(run.runId, true)
		reg.setParked(run.runId, true)
		reg.setParked(run.runId, false)
		expect(run.handle.parked).toBe(true)
		reg.setParked(run.runId, false)
		expect(run.handle.parked).toBeUndefined()
		run.finish()
	})
})

describe("sessions:get carries every run in progress", () => {
	it("lists a reply, an action and a routine, with mayStop for each asker", async () => {
		const { session, owner, guest, line } = await room()
		const reply = await register(session.id, owner.id, "reply")
		const action = await register(session.id, owner.id, "action", {
			name: "Draw a map"
		})
		const routine = await register(session.id, owner.id, "routine", {
			name: "Sweep",
			readsMessageId: line.id
		})
		const speak = await register(session.id, owner.id, "maintenance", {
			lineBound: true
		})
		const { sessionsGetHandler } = await import("./sessions")

		const asOwner: any = await sessionsGetHandler.handler(
			socketOf(owner.id),
			{ id: session.id } as any,
			emit
		)
		const byId = (res: any) =>
			new Map((res.runsInProgress as any[]).map((f) => [f.runId, f]))
		const o = byId(asOwner)
		expect([...o.keys()].sort()).toEqual(
			[reply.runId, action.runId, routine.runId, speak.runId].sort()
		)
		expect(o.get(reply.runId)).toMatchObject({
			kind: "reply",
			name: "the reply",
			mayStop: true,
			since: reply.handle.startedAt
		})
		expect(o.get(action.runId)).toMatchObject({
			kind: "action",
			name: "Draw a map",
			mayStop: true
		})
		expect(o.get(routine.runId)).toMatchObject({
			kind: "routine",
			name: "Sweep",
			readsMessageId: line.id,
			mayStop: true
		})
		expect(o.get(speak.runId)).toMatchObject({
			lineBound: true,
			mayStop: true
		})
		expect(asOwner.routineRuns).toBeUndefined()

		const asGuest: any = await sessionsGetHandler.handler(
			socketOf(guest.id),
			{ id: session.id } as any,
			emit
		)
		const g = byId(asGuest)
		expect(g.get(routine.runId).mayStop).toBe(true)
		expect(g.get(action.runId).mayStop).toBe(true)
		expect(g.get(reply.runId).mayStop).toBe(true)
		expect(g.get(speak.runId).mayStop).toBe(false)
		for (const r of [reply, action, routine, speak]) r.finish()
	})

	it("is absent when nothing runs, and a parked run is listed as parked", async () => {
		const { session, owner } = await room()
		const { sessionsGetHandler } = await import("./sessions")
		const none: any = await sessionsGetHandler.handler(
			socketOf(owner.id),
			{ id: session.id } as any,
			emit
		)
		expect(none.runsInProgress).toBeUndefined()
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const action = await register(session.id, owner.id, "action", {
			status: false
		})
		reg.setParked(action.runId, true)
		const res: any = await sessionsGetHandler.handler(
			socketOf(owner.id),
			{ id: session.id } as any,
			emit
		)
		expect(res.runsInProgress).toHaveLength(1)
		expect(res.runsInProgress[0]).toMatchObject({
			runId: action.runId,
			parked: true
		})
		action.finish()
	})
})

describe("pipelines:cancelRun: who a run blocks stops it", () => {
	async function cancel(userId: number, runId: string, isAdmin = false) {
		const { pipelinesCancelRun } = await import("./pipelines")
		return pipelinesCancelRun.handler(
			socketOf(userId, isAdmin),
			{ runId },
			emit
		)
	}

	it("the owner stops an action and a routine", async () => {
		const { session, owner, guest } = await room()
		for (const kind of ["action", "routine"] as const) {
			const run = await register(session.id, guest.id, kind)
			expect(await cancel(owner.id, run.runId)).toEqual({
				ok: true,
				found: true
			})
			expect(run.handle.controller.signal.aborted).toBe(true)
			run.finish()
		}
	})

	it("a member stops a routine that blocks them", async () => {
		const { session, owner, guest } = await room()
		const run = await register(session.id, owner.id, "routine", {
			name: "Sweep"
		})
		expect(await cancel(guest.id, run.runId)).toEqual({
			ok: true,
			found: true
		})
		expect(run.handle.controller.signal.aborted).toBe(true)
		run.finish()
	})

	it("a member cannot stop someone else's line-bound run", async () => {
		const { session, owner, guest } = await room()
		const run = await register(session.id, owner.id, "maintenance", {
			lineBound: true
		})
		expect(await cancel(guest.id, run.runId)).toEqual({
			ok: false,
			found: true,
			error: "Not your run."
		})
		expect(run.handle.controller.signal.aborted).toBe(false)
		run.finish()
	})

	it("the owner cannot stop a member's line-bound run, an administrator can, and the first page's mayStop agrees with the door", async () => {
		const { session, owner, guest, stranger } = await room()
		const run = await register(session.id, guest.id, "maintenance", {
			lineBound: true
		})
		await db
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, stranger.id))
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: stranger.id })
		const { sessionsGetHandler } = await import("./sessions")
		const mayStopFor = async (userId: number) => {
			const res: any = await sessionsGetHandler.handler(
				socketOf(userId),
				{ id: session.id } as any,
				emit
			)
			return (res.runsInProgress as any[]).find((f) => f.runId === run.runId)
				?.mayStop
		}
		expect(await mayStopFor(owner.id)).toBe(false)
		expect(await mayStopFor(stranger.id)).toBe(true)
		expect(await cancel(owner.id, run.runId)).toEqual({
			ok: false,
			found: true,
			error: "Not your run."
		})
		expect(run.handle.controller.signal.aborted).toBe(false)
		expect(await cancel(stranger.id, run.runId, true)).toEqual({
			ok: true,
			found: true
		})
		expect(run.handle.controller.signal.aborted).toBe(true)
		run.finish()
	})

	it("a non-member cannot", async () => {
		const { session, owner, stranger } = await room()
		for (const kind of ["routine", "action", "reply"] as const) {
			const run = await register(session.id, owner.id, kind)
			expect(await cancel(stranger.id, run.runId)).toEqual({
				ok: false,
				found: true,
				error: "Not your run."
			})
			expect(run.handle.controller.signal.aborted).toBe(false)
			run.finish()
		}
	})

	it("an administrator stops anything", async () => {
		const { session, owner, stranger } = await room()
		await db
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, stranger.id))
		for (const [kind, lineBound] of [
			["routine", false],
			["action", false],
			["reply", false],
			["maintenance", true]
		] as const) {
			const run = await register(
				session.id,
				owner.id,
				kind,
				lineBound ? { lineBound: true } : {}
			)
			expect(await cancel(stranger.id, run.runId, true)).toEqual({
				ok: true,
				found: true
			})
			expect(run.handle.controller.signal.aborted).toBe(true)
			run.finish()
		}
	})
})

describe("the held door: five presses wait while a run is going", () => {
	type Press = {
		name: string
		go: (r: Awaited<ReturnType<typeof room>>) => Promise<any>
	}
	const presses: Press[] = [
		{
			name: "swipe right",
			go: async (r) =>
				(
					await import("./sessions")
				).sessionMessagesSwipeRightHandler.handler(
					socketOf(r.owner.id),
					{ id: r.reply.id } as any,
					emit
				)
		},
		{
			name: "swipe left",
			go: async (r) =>
				(
					await import("./sessions")
				).sessionMessagesSwipeLeftHandler.handler(
					socketOf(r.owner.id),
					{ id: r.reply.id } as any,
					emit
				)
		},
		{
			name: "regenerate",
			go: async (r) =>
				(
					await import("./sessions")
				).sessionMessagesRegenerateHandler.handler(
					socketOf(r.owner.id),
					{ id: r.reply.id } as any,
					emit
				)
		},
		{
			name: "delete",
			go: async (r) => {
				const { registerTestDeletion } = await import(
					"$lib/server/utils/testDb"
				)
				await registerTestDeletion(db, r.session.id)
				return (
					await import("./sessions")
				).sessionMessagesDeleteHandler.handler(
					socketOf(r.owner.id),
					{ id: r.reply.id } as any,
					emit
				)
			}
		},
		{
			name: "retake",
			go: async (r) =>
				(await import("./sessions")).sessionsRetakeTurnHandler.handler(
					socketOf(r.owner.id),
					{ sessionId: r.session.id } as any,
					emit
				)
		},
		{
			name: "Back",
			go: async (r) =>
				(await import("./sessions")).sessionsRewindTurnHandler.handler(
					socketOf(r.owner.id),
					{ sessionId: r.session.id } as any,
					emit
				)
		}
	]

	for (const kind of ["routine", "action"] as const) {
		for (const press of presses) {
			it(`${press.name} is refused with the sentence while ${kind === "routine" ? "a routine" : "an action"} runs, and is not once it has finished`, async () => {
				const r = await room()
				const run = await register(r.session.id, r.owner.id, kind, {
					name: "Sweep"
				})
				const refused: any = await press.go(r)
				expect(refused?.error).toBe(waitForRunSentence("Sweep"))
				// Nothing was taken back by the refusal.
				expect(run.handle.controller.signal.aborted).toBe(false)
				run.finish()
				const after: any = await press.go(r)
				expect(String(after?.error ?? "")).not.toMatch(WAIT)
			}, 120_000)
		}
	}

	it("a reply in flight holds them too, named 'the reply'", async () => {
		const r = await room()
		const run = await register(r.session.id, r.owner.id, "reply")
		const refused: any = await presses[0]!.go(r)
		expect(refused?.error).toBe(waitForRunSentence("the reply"))
		run.finish()
	})

	it("an action nobody named is still refused with the sentence", async () => {
		const r = await room()
		const run = await register(r.session.id, r.owner.id, "action")
		const refused: any = await presses[0]!.go(r)
		expect(String(refused?.error)).toMatch(WAIT)
		run.finish()
	})

	it("a run stopped but not yet finished holds nothing", async () => {
		const r = await room()
		const run = await register(r.session.id, r.owner.id, "routine", {
			name: "Sweep"
		})
		run.handle.controller.abort()
		const res: any = await presses[0]!.go(r)
		expect(String(res?.error ?? "")).not.toMatch(WAIT)
		run.finish()
	})

	it("a run parked at review, or bound to one line, holds nothing", async () => {
		const r = await room()
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const parked = await register(r.session.id, r.owner.id, "action", {
			name: "Rest"
		})
		reg.setParked(parked.runId, true)
		const bound = await register(r.session.id, r.owner.id, "action", {
			name: "Speak",
			lineBound: true
		})
		for (const press of presses) {
			const res: any = await press.go(r)
			expect(String(res?.error ?? ""), press.name).not.toMatch(WAIT)
		}
		parked.finish()
		bound.finish()
	}, 120_000)

	it("a run in another session holds nothing here", async () => {
		const r = await room()
		const other = await room()
		const run = await register(
			other.session.id,
			other.owner.id,
			"routine",
			{ name: "Sweep" }
		)
		const res: any = await presses[0]!.go(r)
		expect(String(res?.error ?? "")).not.toMatch(WAIT)
		run.finish()
	})

	it("a stranger asking is not told what runs", async () => {
		const r = await room()
		const run = await register(r.session.id, r.owner.id, "routine", {
			name: "Sweep"
		})
		const { sessionMessagesSwipeRightHandler } = await import("./sessions")
		const res: any = await sessionMessagesSwipeRightHandler.handler(
			socketOf(r.stranger.id),
			{ id: r.reply.id } as any,
			emit
		)
		expect(String(res?.error ?? "")).not.toMatch(WAIT)
		run.finish()
	})
})

describe("what a routine never holds", () => {
	it("Edit, Forward, sending a line and Continue are not refused while a routine runs", async () => {
		const r = await room()
		const run = await register(r.session.id, r.owner.id, "routine", {
			name: "Sweep"
		})
		const h = await import("./sessions")

		const edited: any = await h.sessionMessagesUpdateHandler.handler(
			socketOf(r.owner.id),
			{ id: r.line.id, content: "Hello again." } as any,
			emit
		)
		expect(edited?.error, edited?.error).toBeUndefined()
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, r.line.id))
		expect(row!.content).toBe("Hello again.")

		const forward: any = await h.sessionsForwardTurnHandler.handler(
			socketOf(r.owner.id),
			{ sessionId: r.session.id } as any,
			emit
		)
		expect(String(forward?.error ?? "")).not.toMatch(WAIT)

		const sent: any =
			await h.sessionMessagesSendPersonaMessageHandler.handler(
				socketOf(r.owner.id),
				{
					sessionId: r.session.id,
					personaId: null,
					content: "One more line.",
					channel: "main"
				} as any,
				emit
			)
		expect(String(sent?.error ?? "")).not.toMatch(WAIT)

		const cont: any = await h.sessionsFireTurnHandler.handler(
			socketOf(r.owner.id),
			{ sessionId: r.session.id } as any,
			emit
		)
		expect(String(cont?.error ?? "")).not.toMatch(WAIT)
		run.finish()
	}, 120_000)
})

describe("a run that holds re-runs is announced from its start to its end", () => {
	const working = { i18n: { en: RUN_WORKING_WORDS } }
	async function relayFor(
		run: Awaited<ReturnType<typeof register>>,
		sessionId: number,
		kind: "action" | "reply",
		extra: { lineBound?: true } = {}
	) {
		const { createStatusRelay } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		return createStatusRelay({
			db: db as unknown as Db,
			io,
			sessionId,
			runId: run.runId,
			live: { status: async () => {} } as any,
			kind,
			...extra
		})
	}

	it("an action given no status reaches the page as working, is listed, and its end sends null", async () => {
		const { session, owner } = await room()
		const run = await register(session.id, owner.id, "action", {
			name: "Draw a map",
			status: false
		})
		const relay = await relayFor(run, session.id, "action")
		await relay.fill({ i18n: { en: "x" } })
		await new Promise((r) => setTimeout(r, 50))
		expect(frames).toHaveLength(1)
		expect(frames[0]).toMatchObject({
			sessionId: session.id,
			runId: run.runId,
			since: run.handle.startedAt,
			status: working,
			mayStop: true
		})
		const { sessionsGetHandler } = await import("./sessions")
		const res: any = await sessionsGetHandler.handler(
			socketOf(owner.id),
			{ id: session.id } as any,
			emit
		)
		expect(
			(res.runsInProgress as any[]).find((f) => f.runId === run.runId)
		).toMatchObject({ status: working, since: run.handle.startedAt })
		await relay.end()
		expect(frames.at(-1)).toMatchObject({ runId: run.runId, status: null })
		run.finish()
	})

	it("a status cleared mid-run sends working, not null; a parked run's clear sends null", async () => {
		const { session, owner } = await room()
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const bare = await register(session.id, owner.id, "action", {
			name: "Bare",
			status: false
		})
		const relay2 = await relayFor(bare, session.id, "action")
		frames.length = 0
		relay2.reasoning(true)
		relay2.reasoning(false)
		await new Promise((r) => setTimeout(r, 50))
		expect(frames.at(-1)).toMatchObject({ runId: bare.runId, status: working })
		reg.setParked(bare.runId, true)
		frames.length = 0
		relay2.reasoning(true)
		relay2.reasoning(false)
		await new Promise((r) => setTimeout(r, 50))
		expect(frames.at(-1)).toMatchObject({ runId: bare.runId, status: null })
		bare.finish()
	})

	for (const name of ["swipe right", "swipe left", "regenerate", "delete"]) {
		it(`${name} pressed as a turn's action run is about to end goes through`, async () => {
			const r = await room()
			const run = await register(r.session.id, r.owner.id, "action", {
				name: "Sweep"
			})
			setTimeout(() => run.finish(), 700)
			const h = await import("./sessions")
			let res: any
			if (name === "delete") {
				const { registerTestDeletion } = await import(
					"$lib/server/utils/testDb"
				)
				await registerTestDeletion(db, r.session.id)
				res = await h.sessionMessagesDeleteHandler.handler(
					socketOf(r.owner.id),
					{ id: r.reply.id } as any,
					emit
				)
			} else {
				const handler = {
					"swipe right": h.sessionMessagesSwipeRightHandler,
					"swipe left": h.sessionMessagesSwipeLeftHandler,
					regenerate: h.sessionMessagesRegenerateHandler
				}[name as "regenerate"]
				res = await handler.handler(
					socketOf(r.owner.id),
					{ id: r.reply.id } as any,
					emit
				)
			}
			expect(String(res?.error ?? "")).not.toMatch(WAIT)
		}, 120_000)
	}
})
