/**
 * chatsSummarizeHandler (chats:summarize) — end-to-end coverage for the
 * scene-type participant/mentioned pipeline: knownCast actually reaching
 * the summarize pipeline's request, a hallucinated castId no longer
 * silently vanishing once it does, and the auto-add-message-senders
 * guarantee. The pipeline run itself (runSpec) is mocked — everything else
 * (lorebook/binding resolution, the reconcile step) runs for real against
 * a PGlite test DB. The full pipeline path has its own coverage in
 * pipelines/summarizeRun.int.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

const runSpecMock = vi.fn()
vi.mock("$lib/server/pipelines/runTurn", () => ({
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
				typeId: "core:provider/summarize-batch@1",
				output: {}
			},
			{
				nodeKey: "synth",
				typeId: "core:provider/summarize-synth@1",
				output: { content: over.content ?? "A scene happened." }
			},
			{
				nodeKey: "naming",
				typeId: "core:provider/name-entry@1",
				output: { name: over.name ?? "A Scene" }
			},
			{
				nodeKey: "cast",
				typeId: "core:provider/extract-cast@1",
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

// getUserConfigurations requires seeded sampling/context/prompt configs
// (irrelevant to this test's scene-participant focus, and generateSummary
// itself is mocked below anyway) — bypass it with harmless fakes.
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: vi.fn().mockResolvedValue({
		connection: null,
		sampling: { id: 1 },
		contextConfig: { id: 1 },
		promptConfig: { id: 1 },
		narratorPromptConfig: null
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

/** Sets up a chat with an attached lorebook, an existing bound character,
 * and two messages: one from that bound character, one from the user's
 * persona — the minimal shape needed to exercise sender auto-detection. */
async function makeSceneChat(userId: number) {
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
		.insert(schema.personas)
		.values({
			userId,
			name: "Player",
			description: "",
			aliases: [],
			isDefault: true
		})
		.returning()
	const [chat] = await testDb
		.insert(schema.chats)
		.values({
			userId,
			name: "Test Chat",
			lorebookId: lorebook.id,
			isGroup: false
		})
		.returning()
	const [msg1] = await testDb
		.insert(schema.chatMessages)
		.values({
			chatId: chat.id,
			role: "assistant",
			characterId: character.id,
			content: "Bram raises his hammer."
		})
		.returning()
	const [msg2] = await testDb
		.insert(schema.chatMessages)
		.values({
			chatId: chat.id,
			role: "user",
			personaId: persona.id,
			content: "You nod in agreement."
		})
		.returning()
	return { lorebook, character, binding, persona, chat, msg1, msg2 }
}

describe("chatsSummarizeHandler — scene participant pipeline (PGlite integration)", () => {
	test("knownCast reaches generateSummary for a scene-type request", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-knowncast-user")
		const { chat, binding, msg1, msg2 } = await makeSceneChat(user.id)
		runSpecMock.mockReset().mockResolvedValue(receiptWith())

		await chatsSummarizeHandler.handler(
			fakeSocket(user.id),
			{
				chatId: chat.id,
				messageIds: [msg1.id, msg2.id],
				loreType: "scene"
			} as any,
			noopEmit
		)

		expect(runSpecMock).toHaveBeenCalledTimes(1)
		const runPassed = runSpecMock.mock.calls[0][0]
		expect(runPassed.specId).toBe("core:spec/summarize-scene")
		// Stopped before the write — the modal's review is the save.
		expect(runPassed.preview).toEqual({ atNode: "save" })
		const request = runPassed.input?.request
		expect(request?.knownCast).toBeDefined()
		expect(request.knownCast.some((c: any) => c.id === binding.id)).toBe(
			true
		)
		// The pinned selection travels too — the pipeline reads exactly the
		// chosen messages, hidden or not.
		expect(request.messageIds).toEqual([msg1.id, msg2.id])
	})

	test("a hallucinated castId with no matching cast entry is dropped, not fabricated — but real senders still end up as participants", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-hallucinated-user")
		const { chat, msg1, msg2 } = await makeSceneChat(user.id)
		runSpecMock
			.mockReset()
			.mockResolvedValue(
				receiptWith({ participants: [{ castId: 999999 }] })
			)

		const response = await chatsSummarizeHandler.handler(
			fakeSocket(user.id),
			{
				chatId: chat.id,
				messageIds: [msg1.id, msg2.id],
				loreType: "scene"
			} as any,
			noopEmit
		)

		// The hallucinated id contributes nothing, but both actual message
		// senders (the bound character + the persona) are still guaranteed
		// participants.
		expect(response.participantCharacters).toHaveLength(2)
	})

	test("message senders are always participants even when the LLM extracts nothing at all", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-empty-llm-user")
		const { chat, binding, persona, msg1, msg2 } = await makeSceneChat(
			user.id
		)
		runSpecMock.mockReset().mockResolvedValue(receiptWith())

		const response = await chatsSummarizeHandler.handler(
			fakeSocket(user.id),
			{
				chatId: chat.id,
				messageIds: [msg1.id, msg2.id],
				loreType: "scene"
			} as any,
			noopEmit
		)

		expect(response.participantCharacters).toContain(binding.id)
		const personaBinding = await testDb.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.personaId, persona.id)
		})
		expect(response.participantCharacters).toContain(personaBinding!.id)
	})

	test("a sender the LLM also placed in mentioned ends up participant-only, not both", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-double-listed-user")
		const { chat, binding, msg1, msg2 } = await makeSceneChat(user.id)
		runSpecMock
			.mockReset()
			.mockResolvedValue(
				receiptWith({ mentioned: [{ castId: binding.id }] })
			)

		const response = await chatsSummarizeHandler.handler(
			fakeSocket(user.id),
			{
				chatId: chat.id,
				messageIds: [msg1.id, msg2.id],
				loreType: "scene"
			} as any,
			noopEmit
		)

		expect(response.participantCharacters).toContain(binding.id)
		expect(response.mentionedCharacters).not.toContain(binding.id)
	})
})

describe("chats:summarize — topic length cap (round-6 audit fix)", () => {
	test("rejects an oversized topic before doing anything else", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-topic-cap-user")

		await expect(
			chatsSummarizeHandler.handler(
				fakeSocket(user.id),
				{
					// No real chat needed — the length check runs before the
					// chat lookup, so an oversized topic must be rejected
					// even against a chatId that doesn't exist.
					chatId: 999_999_999,
					messageIds: [],
					loreType: "world",
					topic: "x".repeat(301)
				} as any,
				noopEmit
			)
		).rejects.toThrow(/300 characters/i)
	})

	test("accepts a topic at exactly the limit", async () => {
		const { chatsSummarizeHandler } = await import("./summarize")
		const user = await makeUser("summarize-topic-ok-user")
		const { chat, msg1, msg2 } = await makeSceneChat(user.id)
		runSpecMock
			.mockReset()
			.mockResolvedValue(receiptWith({ content: "Fine.", name: "Fine" }))

		await expect(
			chatsSummarizeHandler.handler(
				fakeSocket(user.id),
				{
					chatId: chat.id,
					messageIds: [msg1.id, msg2.id],
					loreType: "world",
					topic: "x".repeat(300)
				} as any,
				noopEmit
			)
		).resolves.toBeTruthy()
	})
})
