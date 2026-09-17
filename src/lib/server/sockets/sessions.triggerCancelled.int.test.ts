/**
 * Cancelled is a THIRD outcome, and the client can tell it from a failure
 * without reading a sentence.
 *
 * ⚠ This exists because wiring `cancelSignal` made Cancel work and made it
 * look broken: a stopped run came back as `error: "the run was cancelled (at
 * 'x')"` and the session view gave it a red toast. A deliberate act rendered
 * as a crash. The answer is not a nicer sentence — every future consumer (a
 * retry prompt, an activity card, a receipt view) has to tell the two apart,
 * and none of them should do it by string-matching.
 *
 * What is pinned here:
 *
 *  - a person's Cancel answers `cancelled: true` with no `error` at all,
 *  - the ACTOR survives to the client, and a supersede is a different actor
 *    from a person — `by` is the only thing that tells those apart,
 *  - a cancel that surfaces as an ERROR is still a cancel (the known SDK gap:
 *    a node that throws on abort ends the run as `err` before the executor
 *    next polls its cancel hook), and the failure's sentence does not ride
 *    along,
 *  - a genuine failure still fails.
 *
 * Asserted on what the handler RETURNS and on what it EMITS, because those are
 * the two things a client actually receives; the receipt is an intermediate.
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

/**
 * The one seam: what the run does. Everything else — the registry, the
 * resolution, the session access — is the real thing, because the claim is
 * about how a stop travels from the registry to the wire.
 *
 * `vi.hoisted` rather than a bare `let`, so the hoisted mock factory below has
 * something to close over. `importOriginal` is spread back in because the
 * handler reaches into this same module for `haltExplanation` on the failure
 * branch, and a test that reimplemented that would stop testing it.
 */
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

/** A spec nothing in core contributes, so the fire routes to it unambiguously. */
const PROBE_SLUG = "test:spec/cancel-probe"
const PROBE_FUNCTION = "cancel-probe"
const GENRE = "core:genre/chat"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-trigger-cancelled-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const schema = await import("$lib/server/db/schema")

	// A contributed function needs no nodes — eligibility is the declaration
	// (19 §4), and the run itself is the seam above.
	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: PROBE_SLUG, name: "Cancel Probe" } as any)
		.returning()
	const [version] = await testDb
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-cancel-probe",
			contributes: {
				triggers: [
					{
						genre: GENRE,
						function: PROBE_FUNCTION,
						kind: "button",
						i18n: { en: "Cancel Probe" }
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

/**
 * A session whose owner may fire the probe. The function is switched on
 * explicitly: `enabledByDefault` is the companion rule (same namespace as the
 * mode), and this spec is deliberately foreign so nothing about the fixture
 * depends on squatting the `core:` namespace.
 */
async function makeSession(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const schema = await import("$lib/server/db/schema")
	const user = await createTestUser(testDb, username)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	await testDb.insert(schema.sessionFunctions).values({
		sessionId: session.id,
		genreId: GENRE,
		functionKey: PROBE_FUNCTION,
		enabled: true
	})
	return { user, session }
}

/** Fire the probe and collect both the ack and what the client was pushed. */
async function fire(userId: number, sessionId: number, runId: string) {
	const { sessionsTriggerFunctionHandler } = await import("./sessions")
	const pushed: any[] = []
	const returned = await sessionsTriggerFunctionHandler.handler(
		fakeSocket(userId),
		{ sessionId, function: PROBE_FUNCTION, runId },
		(event: string, data: any) => {
			if (event === "sessions:triggerFunction") pushed.push(data)
		}
	)
	return { returned, pushed }
}

/** The receipt the executor hands back when it noticed the stop itself. */
const cancelledReceipt = (by: string) =>
	({
		outcome: "cancelled",
		cancelledBy: by,
		haltReason: "the run was cancelled",
		haltNodeKey: "generate",
		nodes: []
	}) as any

/** The receipt a run hands back when a node failed. */
const erroredReceipt = (why: string) =>
	({
		outcome: "err",
		haltReason: why,
		haltNodeKey: "generate",
		nodes: []
	}) as any

describe("a stopped run is not a failed one", () => {
	test("a person's Cancel answers cancelled, with the actor and no error", async () => {
		const { user, session } = await makeSession("cancel-person")
		const runId = "run-cancel-person"

		runHooks.behaviour = async () => {
			// Mid-run, exactly as the socket does: the person pressed Cancel
			// while the spec was in flight.
			const { cancel } = await import(
				"$lib/server/pipelines/runtime/runRegistry"
			)
			expect(cancel(runId, user.id)).toEqual({
				found: true,
				allowed: true
			})
			return cancelledReceipt(`user:${user.id}`)
		}

		const { returned, pushed } = await fire(user.id, session.id, runId)

		// The three-way discrimination, on fields rather than on prose.
		expect(returned.cancelled).toBe(true)
		expect(returned.error).toBeUndefined()
		expect(returned.success).toBeUndefined()
		// The actor survived the trip.
		expect(returned.cancelledBy).toBe(`user:${user.id}`)
		// And the client is pushed the same answer it would ack.
		expect(pushed).toEqual([returned])
	})

	test("a supersede is a different actor from a person", async () => {
		// The client re-sent the same run id, so the older run is stale and
		// nobody pressed anything. A response that flattened `by` would make
		// this indistinguishable from someone's deliberate cancel — which is
		// the whole reason the actor is on the wire.
		const { user, session } = await makeSession("cancel-supersede")
		const runId = "run-cancel-supersede"

		runHooks.behaviour = async () => {
			const { start } = await import(
				"$lib/server/pipelines/runtime/runRegistry"
			)
			start({
				runId,
				userId: user.id,
				sessionId: session.id,
				kind: "action"
			})
			return cancelledReceipt("system:superseded")
		}

		const { returned } = await fire(user.id, session.id, runId)

		expect(returned.cancelled).toBe(true)
		expect(returned.cancelledBy).toBe("system:superseded")
		expect(returned.error).toBeUndefined()
	})

	test("a cancel that arrives as an error is still a cancel", async () => {
		// The known SDK gap: a node that THROWS on abort ends the run as `err`
		// before the executor next polls its cancel hook, so the receipt never
		// learns it was cancelled. The registry did, before it aborted — which
		// is why the answer is read off the handle and not off the receipt.
		const { user, session } = await makeSession("cancel-throws")
		const runId = "run-cancel-throws"

		runHooks.behaviour = async () => {
			const { cancel } = await import(
				"$lib/server/pipelines/runtime/runRegistry"
			)
			cancel(runId, user.id)
			return erroredReceipt("aborted: socket hang up at 127.0.0.1:5001")
		}

		const { returned } = await fire(user.id, session.id, runId)

		expect(returned.cancelled).toBe(true)
		expect(returned.cancelledBy).toBe(`user:${user.id}`)
		expect(returned.error).toBeUndefined()
		// The failure's own sentence does not ride along. It describes
		// whatever the abort broke on the way out, and anything that reads
		// `error` first would render the cancel as a failure all over again.
		expect(JSON.stringify(returned)).not.toContain("socket hang up")
	})

	test("a cancel that surfaces as a THROW is still a cancel", async () => {
		const { user, session } = await makeSession("cancel-rejects")
		const runId = "run-cancel-rejects"

		runHooks.behaviour = async () => {
			const { cancel } = await import(
				"$lib/server/pipelines/runtime/runRegistry"
			)
			cancel(runId, user.id)
			throw new Error("aborted: socket hang up at 127.0.0.1:5001")
		}

		const { returned } = await fire(user.id, session.id, runId)

		expect(returned.cancelled).toBe(true)
		expect(returned.cancelledBy).toBe(`user:${user.id}`)
		expect(returned.error).toBeUndefined()
	})

	test("a genuine failure still fails, and says nothing about a cancel", async () => {
		const { user, session } = await makeSession("cancel-genuine-failure")
		const runId = "run-genuine-failure"

		runHooks.behaviour = async () =>
			erroredReceipt("the model returned nothing")

		const { returned, pushed } = await fire(user.id, session.id, runId)

		expect(returned.cancelled).toBeUndefined()
		expect(returned.cancelledBy).toBeUndefined()
		expect(returned.error).toContain("the model returned nothing")
		expect(pushed).toEqual([returned])
	})
})
