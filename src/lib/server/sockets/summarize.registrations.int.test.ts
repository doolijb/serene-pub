/**
 * pr-6 (B §B-7): a world or character summary runs the pipeline the session's
 * registration on the summarize action names (never a spec id), keeps its save
 * node's sources on the activity, and the Save of the reviewed summary commits:
 * a `lore_sources` row and the settle line. `runSpec` is mocked; everything
 * else runs against a PGlite test DB with the core genres' registrations.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

let testDb: TestDb

const runSpecMock = vi.fn()
vi.mock("$lib/server/pipelines/runtime/runTurn", () => ({
	runSpec: (...args: any[]) => runSpecMock(...args),
	runTurn: vi.fn(),
	PipelineUnavailableError: class extends Error {}
}))

vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: vi.fn().mockResolvedValue({
		connection: { id: 1, baseUrl: "http://fake", type: "koboldcpp" },
		sampling: { id: 1 },
		connectionName: "test-connection",
		samplingName: "test-sampling"
	})
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 120_000)

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/** A receipt halted before `save`, whose save node carries the messages it was written from. */
function receiptFor(messageIds: number[]) {
	return {
		runId: "run-summarize-test",
		outcome: "halt",
		haltNodeKey: "save",
		haltReason: "preview: stopped before save, nothing sent",
		nodes: [
			{ nodeKey: "synth", definitionId: "core:oracle/summarize-synth@1", output: { content: "The forge burned." } },
			{ nodeKey: "naming", definitionId: "core:oracle/name-entry@1", output: { name: "Forge" } },
			{ nodeKey: "save", input: { sources: messageIds.map((id) => ({ id })) } }
		]
	}
}

let seq = 0
async function makeSession(over: Record<string, unknown> = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `summarize-registrations-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Test Book", userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, name: "Test Session", lorebookId: lorebook.id, isGroup: false, ...over } as any)
		.returning()
	const messages = []
	for (const content of ["one", "two", "three"])
		messages.push(
			(
				await testDb
					.insert(schema.sessionMessages)
					.values({ sessionId: session.id, role: "user", content })
					.returning()
			)[0]
		)
	return { user, lorebook, session, messages }
}

async function summarize(userId: number, sessionId: number, messageIds: number[], loreType: "world" | "character" = "world") {
	const { sessionsSummarizeHandler } = await import("./summarize")
	const emitted: Array<[string, any]> = []
	const response = await sessionsSummarizeHandler.handler(
		fakeSocket(userId),
		{ sessionId, messageIds, loreType } as any,
		(e, d) => emitted.push([e, d])
	)
	return { response, emitted }
}

describe("sessions:summarize — through the session's registration (A11)", () => {
	test("a world summary runs the registration's pipeline and says which one", async () => {
		const { user, session, messages } = await makeSession()
		const ids = messages.map((m) => m.id)
		runSpecMock.mockReset().mockResolvedValue(receiptFor(ids))

		const { response } = await summarize(user.id, session.id, ids)

		expect(response).toMatchObject({ content: "The forge burned." })
		const args = runSpecMock.mock.calls[0][0]
		expect(args.specId).toBe("core:spec/summarize-world")
		expect(args.registration).toMatchObject({ family: "action", minAge: expect.any(Number) })
		expect(args.registration.key).toEqual(expect.any(String))
		expect(args.registration.key.length).toBeGreaterThan(0)

	}, 60_000)

	test("a character summary runs the character registration", async () => {
		const { user, session, messages } = await makeSession()
		const ids = messages.map((m) => m.id)
		runSpecMock.mockReset().mockResolvedValue(receiptFor(ids))

		await summarize(user.id, session.id, ids, "character")

		const args = runSpecMock.mock.calls[0][0]
		expect(args.specId).toBe("core:spec/summarize-character")
		expect(args.registration.family).toBe("action")
	}, 60_000)

	test("a genre that registers no summary refuses with its sentence, and no run starts", async () => {
		const { user, session, messages } = await makeSession({ genreId: "test:genre/registers-nothing" })
		runSpecMock.mockReset()

		const { response, emitted } = await summarize(user.id, session.id, messages.map((m) => m.id))

		expect(response).toBeNull()
		expect(runSpecMock).not.toHaveBeenCalled()
		const err = emitted.find(([e]) => e === "sessions:summarize:error")![1]
		expect(err).toMatchObject({
			reason: "generation_failed",
			error: "This session's genre registers no world summary."
		})
		const character = await summarize(user.id, session.id, messages.map((m) => m.id), "character")
		expect(character.emitted.find(([e]) => e === "sessions:summarize:error")![1].error).toBe(
			"This session's genre registers no character summary."
		)
	}, 60_000)

	test("a session that reads no lorebook summarizes into its own book", async () => {
		const { user, session, messages } = await makeSession({ lorebookId: null })
		const ids = messages.map((m) => m.id)
		runSpecMock.mockReset().mockResolvedValue(receiptFor(ids))
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(testDb as any, session.id)

		const { response } = await summarize(user.id, session.id, ids)

		expect(response?.lorebookId).toBe(own.id)
	}, 60_000)
})

describe("the activity keeps the draft's sources, and the Save commits", () => {
	test("pendingResult holds the transcript's message ids; entries:create records lore_sources and moves the settle line", async () => {
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { createEntryHandler } = await import("./entries")
		const { user, lorebook, session, messages } = await makeSession()
		const ids = messages.map((m) => m.id)
		runSpecMock.mockReset().mockResolvedValue(receiptFor(ids))
		const { response, emitted } = await summarize(user.id, session.id, ids)

		const activity = activityStore
			.getFor(user.id, false)
			.find((a) => a.kind === "session_summarize" && a.sessionId === session.id) as any
		expect(activity.pendingResult.sourceIds).toEqual(ids)
		expect(activity.pendingResult.runId).toBe("run-summarize-test")
		const activityId = emitted.find(([e]) => e === "sessions:summarize:complete")![1].activityId

		const [before] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, session.id))
		expect(before.settledMessageId ?? null).toBeNull()

		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: response!.name,
					content: response!.content,
					keys: [],
					enabled: true,
					constant: false,
					useRegex: false,
					caseSensitive: false,
					priority: 1
				},
				sessionId: session.id,
				activityId
			} as any,
			noopEmit
		)

		const rows = await testDb.select().from(schema.loreSources).where(eq(schema.loreSources.sessionId, session.id))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			subjectKind: "entry",
			subjectId: entry.id,
			lorebookId: lorebook.id,
			runId: "run-summarize-test",
			fromMessageId: Math.min(...ids),
			throughMessageId: Math.max(...ids)
		})
		const [after] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, session.id))
		expect(after.settledMessageId).toBe(Math.max(...ids))
	}, 60_000)
})
