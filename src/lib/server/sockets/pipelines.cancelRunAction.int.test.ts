/**
 * A Stop reaches an action on its way — an Ask, a Rest — which has no row yet.
 *
 * The waiting row's Stop is `pipelines:cancelRun { runId }`; the session's own
 * `sessionMessages:cancel` leaves an action with no row running, on purpose.
 * What is pinned: the presser's cancel stops the run and nothing is posted,
 * the session's owner may stop a guest's run, a stranger may not, and the
 * session Stop neither stops the action nor claims it did.
 *
 * `runSpec` is the one seam: like Ask, it waits on the run's abort signal and
 * answers a cancelled receipt, never writing a message. The guest's run is
 * registered directly (`runRegistry.start`) rather than fired — the fire
 * handler's guest rules are not what is under test.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const runHooks = vi.hoisted(() => ({
	behaviour: null as null | ((req: any) => Promise<any>)
}))
vi.mock("$lib/server/pipelines/runtime/runTurn", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/runTurn")
		>()
	return {
		...actual,
		runSpec: (req: any) => runHooks.behaviour!(req)
	}
})

const PROBE_SLUG = "test:spec/cancel-run-action-probe"
const PROBE_FUNCTION = "cancel-run-action-probe"
const PROBE_ACTION = `${PROBE_SLUG}#${PROBE_FUNCTION}`
const GENRE = "core:genre/story"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cancel-run-action-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const schema = await import("$lib/server/db/schema")

	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: PROBE_SLUG, name: "Cancel Run Action Probe" } as any)
		.returning()
	const [version] = await testDb
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-cancel-run-action-probe",
			contributes: {
				actions: [
					{
						key: PROBE_FUNCTION,
						genre: GENRE,
						venue: [],
						label: { en: "Cancel Run Action Probe" }
					}
				]
			}
		} as any)
		.returning()
	await testDb
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: version.id })
		.where(eq(schema.pipelineSpecs.id, spec.id))
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(async () => {
	const { _reset } = await import("$lib/server/pipelines/runtime/runRegistry")
	_reset()
	runHooks.behaviour = null
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

async function makeSession(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const schema = await import("$lib/server/db/schema")
	const user = await createTestUser(testDb, username)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	const { actionRegistration, rowOfDecl } = await import(
		"$lib/server/pipelines/registrations/rows"
	)
	const { upsertRow } = await import(
		"$lib/server/pipelines/registrations/write"
	)
	await upsertRow(
		testDb as any,
		rowOfDecl(
			actionRegistration(PROBE_ACTION),
			{ kind: "session", sessionId: session.id },
			"admin"
		)
	)
	return { user, session }
}

async function messageCount(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const rows = await testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
	return rows.length
}

/** Like Ask: waits on the run's own signal, then answers cancelled; writes nothing. */
function waitsOnSignal() {
	let entered: () => void = () => {}
	const started = new Promise<void>((r) => (entered = r))
	runHooks.behaviour = (req: any) =>
		new Promise((resolve) => {
			const done = () =>
				resolve({
					outcome: "cancelled",
					cancelledBy: "user:test",
					haltReason: "the run was cancelled",
					haltNodeKey: "ask",
					nodes: []
				})
			entered()
			if (req.signal?.aborted) done()
			else req.signal?.addEventListener("abort", done, { once: true })
		})
	return started
}

async function fireProbe(userId: number, sessionId: number, runId: string) {
	const { sessionsFireActionHandler } = await import("./sessions")
	return sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{ sessionId, action: PROBE_ACTION, runId },
		() => {}
	)
}

async function cancelRun(userId: number, runId: string) {
	const { pipelinesCancelRun } = await import("./pipelines")
	return pipelinesCancelRun.handler(fakeSocket(userId), { runId }, () => {})
}

describe("pipelines:cancelRun on an action with no row", () => {
	test("the presser's cancel stops it and nothing is posted", async () => {
		const { user, session } = await makeSession("car-presser")
		const runId = "run-car-presser"
		const started = waitsOnSignal()

		const fired = fireProbe(user.id, session.id, runId)
		await started

		expect(await cancelRun(user.id, runId)).toEqual({
			ok: true,
			found: true
		})
		const returned: any = await fired
		expect(returned.cancelled).toBe(true)
		expect(await messageCount(session.id)).toBe(0)
	}, 60_000)

	test("the session's owner stops a guest's run", async () => {
		// Registered directly: the guest's run is the registry's fact; the fire
		// handler's guest rules are not under test here.
		const { user: owner, session } = await makeSession("car-owner")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const schema = await import("$lib/server/db/schema")
		const guest = await createTestUser(testDb, "car-guest")
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guest.id })
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const handle = runRegistry.start({
			runId: "run-car-guest",
			userId: guest.id,
			sessionId: session.id,
			kind: "action"
		})

		expect(await cancelRun(owner.id, "run-car-guest")).toEqual({
			ok: true,
			found: true
		})
		expect(handle.controller.signal.aborted).toBe(true)
		expect(runRegistry.cancellation(handle)?.by).toBe(`user:${owner.id}`)
		runRegistry.finish("run-car-guest")
	}, 60_000)

	test("a third user with no access is refused and the run goes on", async () => {
		const { user: owner, session } = await makeSession("car-owner-3")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, "car-stranger")
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const handle = runRegistry.start({
			runId: "run-car-stranger",
			userId: owner.id,
			sessionId: session.id,
			kind: "action"
		})

		expect(await cancelRun(stranger.id, "run-car-stranger")).toEqual({
			ok: false,
			found: true,
			error: "Not your run."
		})
		expect(handle.controller.signal.aborted).toBe(false)
		runRegistry.finish("run-car-stranger")
	}, 60_000)
})

describe("pipelines:cancelRun: any member stops a waiting reply, nothing else", () => {
	async function room(tag: string) {
		const { user: owner, session } = await makeSession(`car-${tag}-owner`)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const schema = await import("$lib/server/db/schema")
		const guest = await createTestUser(testDb, `car-${tag}-guest`)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: guest.id })
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		return { owner, guest, session, runRegistry }
	}

	test("a guest stops the owner's waiting reply", async () => {
		const { owner, guest, session, runRegistry } = await room("reply")
		const handle = runRegistry.start({
			runId: "run-car-reply",
			userId: owner.id,
			sessionId: session.id,
			kind: "reply"
		})
		expect(await cancelRun(guest.id, "run-car-reply")).toEqual({
			ok: true,
			found: true
		})
		expect(handle.controller.signal.aborted).toBe(true)
		expect(runRegistry.cancellation(handle)?.by).toBe(`user:${guest.id}`)
		runRegistry.finish("run-car-reply")
	}, 60_000)

	test("a guest cannot stop a routine, a maintenance run or an action", async () => {
		const { owner, guest, session, runRegistry } = await room("other")
		for (const kind of ["routine", "maintenance", "action"] as const) {
			const runId = `run-car-other-${kind}`
			const handle = runRegistry.start({
				runId,
				userId: owner.id,
				sessionId: session.id,
				kind
			})
			expect(await cancelRun(guest.id, runId)).toEqual({
				ok: false,
				found: true,
				error: "Not your run."
			})
			expect(handle.controller.signal.aborted).toBe(false)
			runRegistry.finish(runId)
		}
	}, 60_000)

	test("the owner stops another person's routine run", async () => {
		const { owner, guest, session, runRegistry } = await room("ownroutine")
		const handle = runRegistry.start({
			runId: "run-car-ownroutine",
			userId: guest.id,
			sessionId: session.id,
			kind: "routine"
		})
		expect(await cancelRun(owner.id, "run-car-ownroutine")).toEqual({
			ok: true,
			found: true
		})
		expect(handle.controller.signal.aborted).toBe(true)
		runRegistry.finish("run-car-ownroutine")
	}, 60_000)

	test("a guest cannot stop a line-bound reply-kind run", async () => {
		const { owner, guest, session, runRegistry } = await room("line")
		const handle = runRegistry.start({
			runId: "run-car-line",
			userId: owner.id,
			sessionId: session.id,
			kind: "reply",
			lineBound: true
		})
		expect(await cancelRun(guest.id, "run-car-line")).toEqual({
			ok: false,
			found: true,
			error: "Not your run."
		})
		expect(handle.controller.signal.aborted).toBe(false)
		runRegistry.finish("run-car-line")
	}, 60_000)
})

describe("sessionMessages:cancel with only an action on its way", () => {
	test("answers no success, and leaves the action running", async () => {
		const { user, session } = await makeSession("car-session-stop")
		const runId = "run-car-session-stop"
		const started = waitsOnSignal()

		const fired = fireProbe(user.id, session.id, runId)
		await started

		const { sessionMessagesCancelHandler } = await import("./sessions")
		const res: any = await sessionMessagesCancelHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, id: -1 } as any,
			() => {}
		)
		expect(res.success).toBeUndefined()
		expect(res.error).toBeUndefined()

		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const live = runRegistry.active().find((h) => h.runId === runId)
		expect(live?.controller.signal.aborted).toBe(false)

		// Clean up: end the run through its own cancel.
		expect(await cancelRun(user.id, runId)).toEqual({
			ok: true,
			found: true
		})
		await fired
	}, 60_000)
})
