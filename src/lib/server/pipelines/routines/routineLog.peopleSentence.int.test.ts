/**
 * The routine log reads a line's reason per reader (DG1d: "Regular users see
 * the error and a basic generic user friendly description of the problem and
 * a suggestion to notify admin"): an administrator reads what is stored; a
 * line marked for people reads as written for everyone; anything else reads
 * the routine surface's plain sentence and the suggestion.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { ADMINISTRATOR_SUGGESTION } from "$lib/server/utils/administratorSuggestion"

let db: TestDb
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db }
})

let sessionId: number
let ownerId: number
let guestId: number
let adminId: number

const PLAIN = `A background routine could not run. ${ADMINISTRATOR_SUGGESTION}`
const firing = (key: string) => ({ sessionId, registrationKey: key, pipeline: "test:spec/routine@1" })

/** The reasons of the log's lines, by registration key, as `reader` reads them. */
async function reasonsFor(reader: { isAdmin: boolean }) {
	const { routineLog } = await import("./log")
	const entries = await routineLog(db as never, sessionId, { reader })
	return Object.fromEntries(entries.map((e) => [e.registrationKey, e.reason]))
}

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	ownerId = (await createTestUser(db, "log-owner")).id
	guestId = (await createTestUser(db, "log-guest")).id
	adminId = (await createTestUser(db, "log-admin")).id
	const [s] = await db.insert(schema.sessions).values({ userId: ownerId, isGroup: true, name: "Log" }).returning()
	sessionId = s.id
	await db.insert(schema.sessionGuests).values([
		{ sessionId, userId: guestId },
		{ sessionId, userId: adminId }
	])
	const { routineLine } = await import("./run")
	// Rows 22–26 and 28 mark their sentence; 27 and 29 do not; an old line has no stamp.
	await routineLine(db as never, { firing: firing("p-wait"), reason: "Skipped: already waiting", kind: "skipped", forPeople: true })
	await routineLine(db as never, { firing: firing("p-idle"), reason: "Paused: no one has played for 2 hours", kind: "paused", forPeople: true })
	await routineLine(db as never, { firing: firing("p-jump"), reason: "Skipped: the clock jumped more than 12 hours", kind: "skipped", forPeople: true })
	await routineLine(db as never, { firing: firing("w-when"), reason: "Skipped: its `when` condition does not hold now", kind: "skipped" })
	await routineLine(db as never, { firing: firing("d-unpublished"), reason: "Skipped: 'x/y' is not published on this pub", kind: "skipped" })
	await routineLine(db as never, { firing: firing("old-line"), reason: "Skipped: already waiting", kind: "skipped" })
})

const MARKED = {
	"p-wait": "Skipped: already waiting",
	"p-idle": "Paused: no one has played for 2 hours",
	"p-jump": "Skipped: the clock jumped more than 12 hours"
}
const UNMARKED = {
	"w-when": "Skipped: its `when` condition does not hold now",
	"d-unpublished": "Skipped: 'x/y' is not published on this pub",
	"old-line": "Skipped: already waiting"
}

describe("routineLog reasons per reader", () => {
	it("stamps the sentence only on a marked line", async () => {
		const rows = await db.select().from(schema.pipelineRuns)
		const stamp = (key: string) => (rows.find((r) => r.registrationKey === key)?.receipt as any)?.meta?.peopleSentence
		for (const [key, said] of Object.entries(MARKED)) expect(stamp(key)).toBe(said)
		for (const key of Object.keys(UNMARKED)) expect(stamp(key)).toBeUndefined()
	})

	it("an administrator reads every reason as stored", async () => {
		expect(await reasonsFor({ isAdmin: true })).toEqual({ ...MARKED, ...UNMARKED })
	})

	it.each([
		["a non-administrator owner", () => ({ isAdmin: false })],
		["a guest", () => ({ isAdmin: false })]
	])("%s reads marked lines as written and the rest as the plain sentence", async (_who, reader) => {
		const got = await reasonsFor(reader())
		expect(got).toEqual({
			...MARKED,
			...Object.fromEntries(Object.keys(UNMARKED).map((k) => [k, PLAIN]))
		})
	})

	it("an ordinary routine run that halted reads plain for a non-administrator and as stored for an administrator", async () => {
		const { saveReceipt } = await import("$lib/server/pipelines/runtime/receipts")
		const now = Date.now()
		await saveReceipt(
			db as never,
			{
				runId: "halted-run-1",
				specId: "test:spec/routine@1",
				specVersion: "0.0.0",
				schemaVersion: 1,
				seed: "",
				triggerSource: "schedule",
				triggerFamily: "routine",
				registrationKey: "ran-halted",
				depth: 0,
				startedAt: now,
				endedAt: now,
				outcome: "halt",
				haltReason: "step_3: the lorebook 'secret-book' is not there",
				meta: {},
				nodes: [],
				emitted: [],
				consumption: { tokens: 0, nodeExecutions: 0 }
			} as never,
			{ sessionId, userId: ownerId, artifacts: [] }
		)
		expect((await reasonsFor({ isAdmin: false }))["ran-halted"]).toBe(PLAIN)
		expect((await reasonsFor({ isAdmin: true }))["ran-halted"]).toBe("step_3: the lorebook 'secret-book' is not there")
	})

	it("the socket shapes the reason by the asking user", async () => {
		const { sessionsRoutineLogHandler } = await import("$lib/server/sockets/routines")
		const ask = async (id: number, isAdmin: boolean) => {
			const res: any = await sessionsRoutineLogHandler.handler({ user: { id, isAdmin } } as never, { sessionId } as never, () => {})
			return Object.fromEntries(res.entries.map((e: any) => [e.registrationKey, e.reason]))
		}
		expect((await ask(adminId, true))["w-when"]).toBe(UNMARKED["w-when"])
		expect((await ask(ownerId, false))["w-when"]).toBe(PLAIN)
		expect((await ask(guestId, false))["w-when"]).toBe(PLAIN)
		expect((await ask(guestId, false))["p-wait"]).toBe(MARKED["p-wait"])
	})
})
