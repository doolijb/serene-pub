/**
 * sessionsSummarizeHandler (sessions:summarize) — world and character lore.
 * The pipeline run itself (runSpec) is mocked — everything else runs for
 * real against a PGlite test DB. The full pipeline path has its own coverage
 * in pipelines/summarizeRun.int.test.ts.
 *
 * Scene summaries are not this handler's: the modal creates the scene and
 * hands it to `scenes:process`, and the scene/history branches that once
 * lived here were unreachable (Phase D) — their tests went with them.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

const runSpecMock = vi.fn()
vi.mock("$lib/server/pipelines/runtime/runTurn", () => ({
	runSpec: (...args: any[]) => runSpecMock(...args),
	runTurn: vi.fn(),
	PipelineUnavailableError: class extends Error {}
}))

/** A receipt the socket can read its result off — halted before `save`. */
function receiptWith(
	over: {
		content?: string
		name?: string
		participants?: any[]
		mentioned?: any[]
	} = {}
) {
	return {
		outcome: "halt",
		haltNodeKey: "save",
		haltReason: "preview: stopped before save, nothing sent",
		nodes: [
			{
				nodeKey: "drafting.item.draft",
				definitionId: "core:oracle/summarize-batch@1",
				output: {}
			},
			{
				nodeKey: "synth",
				definitionId: "core:oracle/summarize-synth@1",
				output: { content: over.content ?? "A scene happened." }
			},
			{
				nodeKey: "naming",
				definitionId: "core:oracle/name-entry@1",
				output: { name: over.name ?? "A Scene" }
			},
			{
				nodeKey: "cast",
				definitionId: "core:oracle/extract-cast@1",
				output: {
					cast: {
						participants: over.participants ?? [],
						mentioned: over.mentioned ?? []
					}
				}
			}
		]
	}
}

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
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

/** Sets up a session with an attached lorebook, an existing bound character,
 * and two messages: one from that bound character, one from the user's
 * persona — the minimal shape needed to exercise sender auto-detection. */
async function makeSceneSession(userId: number) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Test Book", userId })
		.returning()
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId, name: "Bram", description: "" })
		.returning()
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: character.id,
			binding: "{{char:1}}",
			name: "Bram"
		})
		.returning()
	const [persona] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: "Player",
			description: "",
			aliases: [],
			isPersona: true,
			isDefaultPersona: true
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			name: "Test Session",
			lorebookId: lorebook.id,
			isGroup: false
		})
		.returning()
	const [msg1] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			characterId: character.id,
			content: "Bram raises his hammer."
		})
		.returning()
	const [msg2] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "user",
			personaId: persona.id,
			content: "You nod in agreement."
		})
		.returning()
	return { lorebook, character, binding, persona, session, msg1, msg2 }
}

describe("sessions:summarize — world and character only (Phase D)", () => {
	test("a scene request is refused before any run starts", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-scene-refused-user")
		const { session, msg1, msg2 } = await makeSceneSession(user.id)
		runSpecMock.mockReset()

		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				{
					sessionId: session.id,
					messageIds: [msg1.id, msg2.id],
					loreType: "scene"
				} as any,
				noopEmit
			)
		).rejects.toThrow(/world or character/i)
		expect(runSpecMock).not.toHaveBeenCalled()
	}, 60_000)
})

describe("sessions:summarize — frames carry their session (Phase D wire hygiene)", () => {
	test("every progress frame and the result name the run's session, the scope key", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const { scopeOfPayload } = await import("$lib/shared/sockets/interest")
		const user = await makeUser("summarize-frames-scoped-user")
		const { session, msg1, msg2 } = await makeSceneSession(user.id)
		runSpecMock.mockReset().mockImplementation(async (args: any) => {
			args.onNode?.({
				phase: "start",
				definitionId: "core:oracle/summarize-batch@1"
			})
			args.onNode?.({
				phase: "start",
				definitionId: "core:oracle/summarize-synth@1"
			})
			return receiptWith({ content: "The forge burned.", name: "Forge" })
		})
		const emitted: Array<[string, any]> = []

		const response = await sessionsSummarizeHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: session.id,
				messageIds: [msg1.id, msg2.id],
				loreType: "world"
			},
			(event, data) => emitted.push([event, data])
		)

		const frames = emitted.filter(([e]) => e === "sessions:summarize:progress")
		expect(frames.map(([, d]) => d.phase)).toEqual(["drafting", "synthesizing"])
		for (const [event, data] of frames) {
			expect(scopeOfPayload(event, data)).toBe(String(session.id))
			// The always-empty draft preview is gone from the wire.
			expect(data).not.toHaveProperty("partial")
		}
		const complete = emitted.filter(([e]) => e === "sessions:summarize:complete")
		expect(complete).toHaveLength(1)
		expect(scopeOfPayload("sessions:summarize:complete", complete[0][1])).toBe(
			String(session.id)
		)
		expect(response).toMatchObject({
			sessionId: session.id,
			content: "The forge burned.",
			name: "Forge"
		})
		// Scene-only fields are no longer on the reply.
		expect(response).not.toHaveProperty("participantCharacters")
	}, 60_000)
})

describe("sessions:summarize — topic length cap (round-6 audit fix)", () => {
	test("rejects an oversized topic before doing anything else", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-topic-cap-user")

		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				{
					// No real session needed — the length check runs before the
					// session lookup, so an oversized topic must be rejected
					// even against a sessionId that doesn't exist.
					sessionId: 999_999_999,
					messageIds: [],
					loreType: "world",
					topic: "x".repeat(301)
				} as any,
				noopEmit
			)
		).rejects.toThrow(/300 characters/i)
	})

	test("accepts a topic at exactly the limit", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-topic-ok-user")
		const { session, msg1, msg2 } = await makeSceneSession(user.id)
		runSpecMock
			.mockReset()
			.mockResolvedValue(receiptWith({ content: "Fine.", name: "Fine" }))

		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(user.id),
				{
					sessionId: session.id,
					messageIds: [msg1.id, msg2.id],
					loreType: "world",
					topic: "x".repeat(300)
				} as any,
				noopEmit
			)
		).resolves.toBeTruthy()
	})
})

describe("sessions:summarize — character lore binds its character only when saved (plan A12)", () => {
	test("a run names the character to bind and mints no cast member; a discarded review leaves the book as it was", async () => {
		const { sessionsSummarizeHandler } = await import("./summarize")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const user = await makeUser("summarize-bind-on-save-user")
		const { session, lorebook, msg1, msg2 } = await makeSceneSession(user.id)
		const [wren] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Wren", description: "" })
			.returning()
		runSpecMock
			.mockReset()
			.mockResolvedValue(receiptWith({ content: "Wren keeps the forge.", name: "Wren" }))
		const emitted: Array<[string, any]> = []

		const response = await sessionsSummarizeHandler.handler(
			fakeSocket(user.id),
			{
				sessionId: session.id,
				messageIds: [msg1.id, msg2.id],
				loreType: "character",
				topic: "the forge",
				lorebookBindingCharacterId: wren.id
			} as any,
			(event, data) => emitted.push([event, data])
		)

		const bound = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.characterId, wren.id))
		expect(bound).toEqual([])
		expect(response.lorebookBindingCharacterId).toBe(wren.id)

		const activity = activityStore
			.getFor(user.id, false)
			.find((a) => a.kind === "session_summarize" && a.sessionId === session.id) as any
		expect(activity.pendingResult.lorebookBindingCharacterId).toBe(wren.id)
		// Discarding the review writes nothing: there is nothing to undo.
		activityStore.remove(activity.id, "dismissed")
		expect(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		).toHaveLength(1)
	})
})
