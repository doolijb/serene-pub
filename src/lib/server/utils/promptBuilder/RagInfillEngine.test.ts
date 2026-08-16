import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	buildChat,
	buildLorebook,
	chatCharacter,
	chatMessage,
	insertCharacterRow,
	insertChatMessageRow,
	insertChatRow,
	insertCharacterLoreEntryRow,
	insertHistoryEntryRow,
	insertLorebook,
	insertLorebookBindingRow,
	insertWorldLoreEntryRow,
	makeInfillOptions,
	makeTemplateContext,
	worldLoreEntry
} from "./infillTestUtils"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

vi.mock("$lib/server/embedding", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/embedding")>()
	return {
		...actual,
		getLoadedModelId: vi.fn(),
		embed: vi.fn(),
		batchEmbed: vi.fn()
	}
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

async function makeUser() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb)
}

const { RagInfillEngine } = await import("./RagInfillEngine")
const { InterpolationEngine } = await import("./InterpolationEngine")
const embeddingModule = await import("$lib/server/embedding")

function makeEngine(chat: any, currentCharacterId: number | null = null) {
	const interpolationEngine = new InterpolationEngine()
	const populateBindings = (entry: any) => entry
	return new RagInfillEngine(
		chat,
		interpolationEngine,
		populateBindings,
		currentCharacterId
	)
}

const MODEL_ID = "test-model"
const QUERY_VECTOR = [1, 0, 0]

describe("RagInfillEngine — pinned entries (no embedding model loaded)", () => {
	beforeEach(() => {
		// Mirrors the real embed()/batchEmbed() behavior when no backend is
		// active: both throw "No embedding model loaded". RagInfillEngine
		// catches this internally and falls back to pinned-only / no-RAG mode.
		vi.mocked(embeddingModule.getLoadedModelId).mockReturnValue(null)
		vi.mocked(embeddingModule.batchEmbed).mockRejectedValue(
			new Error("No embedding model loaded")
		)
		vi.mocked(embeddingModule.embed).mockRejectedValue(
			new Error("No embedding model loaded")
		)
	})

	test("pinned world lore is included even with RAG fully unavailable", async () => {
		const wle = {
			id: 1,
			lorebookId: 1,
			name: "Pinned Fact",
			content: "The sky is violet here.",
			constant: true,
			enabled: true
		} as any
		const chat = buildChat({
			chatMessages: [chatMessage({ id: 1, content: "hello" })],
			lorebook: buildLorebook({ worldLoreEntries: [wle] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).toContain("The sky is violet here.")
		expect((result.rag as any).lore.worldLore.pinned).toBe(1)
		expect((result.rag as any).used).toBe(true)
	})

	test("pinned character lore respects the privacy rule", async () => {
		const alice = { id: 1, name: "Alice", nickname: null, description: "" } as any
		const binding = { id: 10, lorebookId: 1, characterId: 1, personaId: null } as any
		const lore = {
			id: 1,
			lorebookId: 1,
			lorebookBindingId: 10,
			name: "Alice Secret",
			content: "Alice hides a key under the rug.",
			constant: true,
			enabled: true
		} as any
		const chat = buildChat({
			lorebookId: 1,
			chatMessages: [chatMessage({ id: 1, content: "hello" })],
			chatCharacters: [chatCharacter(alice)],
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [binding],
				characterLoreEntries: [lore]
			})
		})

		const asOwner = makeEngine(chat, 1)
		const ownerResult = await asOwner.infillContent(makeInfillOptions())
		expect(ownerResult.renderedPrompt).toContain("Alice hides a key under the rug.")

		const asOther = makeEngine(chat, 2)
		const otherResult = await asOther.infillContent(makeInfillOptions())
		expect(otherResult.renderedPrompt).not.toContain(
			"Alice hides a key under the rug."
		)
	})

	test("pinned history entry is included", async () => {
		const he = {
			id: 1,
			lorebookId: 1,
			year: 900,
			month: null,
			day: null,
			content: "The great flood occurred.",
			constant: true,
			enabled: true
		} as any
		const chat = buildChat({
			chatMessages: [chatMessage({ id: 1, content: "hello" })],
			lorebook: buildLorebook({ historyEntries: [he] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).toContain("The great flood occurred.")
	})

	test("older messages still fill in via recency fallback when RAG fails silently", async () => {
		const messages = Array.from({ length: 12 }, (_, i) =>
			chatMessage({ id: i + 1, content: `message body ${i + 1}`, role: "user" })
		)
		const chat = buildChat({ chatMessages: messages })
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		// No lore at all → the "no lore" branch promotes/fills older messages by
		// recency even though the RAG query itself produced nothing.
		expect(result.chatMessages.includedIds.length).toBeGreaterThan(10)
	})
})

describe("RagInfillEngine — post-history block", () => {
	beforeEach(() => {
		vi.mocked(embeddingModule.getLoadedModelId).mockReturnValue(null)
		vi.mocked(embeddingModule.batchEmbed).mockRejectedValue(
			new Error("No embedding model loaded")
		)
		vi.mocked(embeddingModule.embed).mockRejectedValue(
			new Error("No embedding model loaded")
		)
	})

	function makeFiveMessageChat() {
		const messages = Array.from({ length: 5 }, (_, i) =>
			chatMessage({ id: i + 1, content: `message ${i + 1}`, role: "user" })
		)
		return buildChat({ chatMessages: messages })
	}

	test("depth 0 positions the block right before the seed (after the last real message)", async () => {
		const chat = makeFiveMessageChat()
		const engine = makeEngine(chat)
		const result = await engine.infillContent(
			makeInfillOptions({
				postHistoryDepth: 0,
				templateContext: makeTemplateContext({
					postHistory: { instructions: "Stay in character." }
				})
			})
		)
		const prompt = result.renderedPrompt!
		expect(prompt.indexOf("POSTHISTORY")).toBeGreaterThan(
			prompt.indexOf("message 5")
		)
	})

	test("depth 2 positions the block 2 real messages back from the last", async () => {
		const chat = makeFiveMessageChat()
		const engine = makeEngine(chat)
		const result = await engine.infillContent(
			makeInfillOptions({
				postHistoryDepth: 2,
				templateContext: makeTemplateContext({
					postHistory: { instructions: "Stay in character." }
				})
			})
		)
		const prompt = result.renderedPrompt!
		const postHistoryIndex = prompt.indexOf("POSTHISTORY")
		expect(postHistoryIndex).toBeGreaterThan(prompt.indexOf("message 3"))
		expect(postHistoryIndex).toBeLessThan(prompt.indexOf("message 4"))
	})

	test("instructions is omitted below the token trigger", async () => {
		const chat = makeFiveMessageChat()
		const engine = makeEngine(chat)
		const result = await engine.infillContent(
			makeInfillOptions({
				postHistoryTokenTrigger: 100_000,
				templateContext: makeTemplateContext({
					postHistory: { instructions: "Stay in character." }
				})
			})
		)
		expect(result.renderedPrompt).not.toContain("Stay in character.")
		expect((result.rag as any).postHistory).toEqual({
			included: false,
			reason: "below_token_trigger"
		})
	})

	test("instructions is included once history reaches the token trigger", async () => {
		const chat = makeFiveMessageChat()
		const engine = makeEngine(chat)
		const result = await engine.infillContent(
			makeInfillOptions({
				postHistoryTokenTrigger: 1,
				templateContext: makeTemplateContext({
					postHistory: { instructions: "Stay in character." }
				})
			})
		)
		expect(result.renderedPrompt).toContain("Stay in character.")
		expect((result.rag as any).postHistory).toEqual({
			included: true,
			reason: "included"
		})
	})

	test("charInstructions and exampleDialogue render regardless of the token trigger", async () => {
		const chat = makeFiveMessageChat()
		const engine = makeEngine(chat)
		const result = await engine.infillContent(
			makeInfillOptions({
				postHistoryTokenTrigger: 100_000,
				templateContext: makeTemplateContext({
					postHistory: {
						instructions: "Gated reminder.",
						charInstructions: "Character reminder text.",
						exampleDialogue: "Example dialogue text."
					}
				})
			})
		)
		expect(result.renderedPrompt).not.toContain("Gated reminder.")
		expect(result.renderedPrompt).toContain("Character reminder text.")
		expect(result.renderedPrompt).toContain("Example dialogue text.")
	})
})

describe("RagInfillEngine — RAG retrieval (embeddings)", () => {
	beforeEach(() => {
		vi.mocked(embeddingModule.getLoadedModelId).mockReturnValue(MODEL_ID)
		vi.mocked(embeddingModule.batchEmbed).mockImplementation(
			async (texts: string[]) => texts.map(() => QUERY_VECTOR)
		)
		vi.mocked(embeddingModule.embed).mockResolvedValue(QUERY_VECTOR)
	})

	test("only scores content from the chat's own lorebook, never a decoy lorebook", async () => {
		const user = await makeUser()
		const ownLorebook = await insertLorebook(testDb, user.id, { name: "Own" })
		const decoyLorebook = await insertLorebook(testDb, user.id, { name: "Decoy" })

		const ownEntry = await insertWorldLoreEntryRow(testDb, ownLorebook.id, {
			name: "In-Scope Fact",
			content: "Only visible from the chat's own lorebook.",
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})
		await insertWorldLoreEntryRow(testDb, decoyLorebook.id, {
			name: "Out-of-Scope Fact",
			content: "Should never appear — wrong lorebook.",
			embedding: QUERY_VECTOR, // identical embedding — would rank just as well if scope leaked
			embeddingModel: MODEL_ID
		})

		const chatRow = await insertChatRow(testDb, user.id, {
			lorebookId: ownLorebook.id
		})

		const chat = buildChat({
			id: chatRow.id,
			lorebookId: ownLorebook.id,
			chatMessages: [chatMessage({ id: 1, content: "tell me something" })],
			// Runtime shape only ever carries the chat's OWN lorebook content —
			// mirrors production (PromptBuilder never attaches a decoy lorebook).
			lorebook: buildLorebook({ id: ownLorebook.id, worldLoreEntries: [ownEntry] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())

		expect(result.renderedPrompt).toContain(
			"Only visible from the chat's own lorebook."
		)
		expect(result.renderedPrompt).not.toContain("Should never appear")
	})

	test("never retrieves messages from a different chat", async () => {
		const user = await makeUser()
		const otherChat = await insertChatRow(testDb, user.id)
		await insertChatMessageRow(testDb, otherChat.id, {
			content: "SECRET_FROM_OTHER_CHAT",
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})

		const thisChat = await insertChatRow(testDb, user.id)
		const chat = buildChat({
			id: thisChat.id,
			chatMessages: [
				chatMessage({ id: 1, content: "hi there" }),
				chatMessage({ id: 2, content: "how are you" })
			]
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("SECRET_FROM_OTHER_CHAT")
	})

	test("character-lore privacy still applies to RAG-retrieved (non-pinned) entries", async () => {
		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)
		const charA = await insertCharacterRow(testDb, user.id, { name: "Alice" })
		const binding = await insertLorebookBindingRow(testDb, lorebook.id, {
			characterId: charA.id,
			binding: `{{char:${charA.id}}}`
		})
		const loreEntry = await insertCharacterLoreEntryRow(testDb, lorebook.id, {
			name: "Alice's RAG Secret",
			content: "Retrieved by similarity, not pinned.",
			lorebookBindingId: binding.id,
			constant: false, // must be RAG-retrieved, not pinned, to reach this entry at all
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})

		const chatRow = await insertChatRow(testDb, user.id, { lorebookId: lorebook.id })
		const chat = buildChat({
			id: chatRow.id,
			lorebookId: lorebook.id,
			chatMessages: [chatMessage({ id: 1, content: "what secrets do you keep" })],
			chatCharacters: [chatCharacter(charA as any)],
			lorebook: buildLorebook({
				id: lorebook.id,
				lorebookBindings: [binding],
				characterLoreEntries: [loreEntry]
			})
		})

		const asOwner = makeEngine(chat, charA.id)
		const ownerResult = await asOwner.infillContent(makeInfillOptions())
		expect(ownerResult.renderedPrompt).toContain(
			"Retrieved by similarity, not pinned."
		)

		const asOther = makeEngine(chat, 999)
		const otherResult = await asOther.infillContent(makeInfillOptions())
		expect(otherResult.renderedPrompt).not.toContain(
			"Retrieved by similarity, not pinned."
		)
	})

	test("an invisible characterLore candidate never occupies a budget slot that a visible one could use", async () => {
		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)
		const charA = await insertCharacterRow(testDb, user.id, { name: "Alice" })
		const charB = await insertCharacterRow(testDb, user.id, { name: "Bob" })
		const bindingA = await insertLorebookBindingRow(testDb, lorebook.id, {
			characterId: charA.id,
			binding: `{{char:${charA.id}}}`
		})
		const bindingB = await insertLorebookBindingRow(testDb, lorebook.id, {
			characterId: charB.id,
			binding: `{{char:${charB.id}}}`
		})

		// 6 entries visible to Alice — exactly RAG_SOURCE_BUDGET.characterLore (6).
		const visibleEntries = []
		for (let i = 0; i < 6; i++) {
			visibleEntries.push(
				await insertCharacterLoreEntryRow(testDb, lorebook.id, {
					name: `Visible Secret ${i}`,
					content: `Visible content number ${i}.`,
					lorebookBindingId: bindingA.id,
					constant: false,
					embedding: QUERY_VECTOR,
					embeddingModel: MODEL_ID
				})
			)
		}
		// Invisible to Alice (bound to Bob, who isn't even in the chat).
		// Inserted LAST so it has the highest id — fetchScopedCandidates
		// orders by desc(id), so with identical embeddings/scores this entry
		// ranks first and would occupy budget slot #1 ahead of all 6 visible
		// entries if the visibility filter didn't run before budgeting.
		const invisibleEntry = await insertCharacterLoreEntryRow(
			testDb,
			lorebook.id,
			{
				name: "Invisible Secret",
				content: "Should never occupy a budget slot.",
				lorebookBindingId: bindingB.id,
				constant: false,
				embedding: QUERY_VECTOR,
				embeddingModel: MODEL_ID
			}
		)

		const chatRow = await insertChatRow(testDb, user.id, {
			lorebookId: lorebook.id
		})
		const chat = buildChat({
			id: chatRow.id,
			lorebookId: lorebook.id,
			chatMessages: [chatMessage({ id: 1, content: "what secrets do you keep" })],
			chatCharacters: [chatCharacter(charA as any)],
			lorebook: buildLorebook({
				id: lorebook.id,
				lorebookBindings: [bindingA, bindingB],
				characterLoreEntries: [...visibleEntries, invisibleEntry]
			})
		})

		const engine = makeEngine(chat, charA.id)
		const result = await engine.infillContent(makeInfillOptions())

		expect((result.rag as any).lore.characterLore.rag).toBe(6)
		for (let i = 0; i < 6; i++) {
			expect(result.renderedPrompt).toContain(`Visible content number ${i}.`)
		}
		expect(result.renderedPrompt).not.toContain(
			"Should never occupy a budget slot."
		)
	})

	test("lore priority (Normal/VeryHigh) measurably boosts a RAG-retrieved entry's score", async () => {
		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)

		// Identical embeddings — RRF-normalized scores would otherwise differ
		// only by tiny (~0.016) rank-order noise. A VeryHigh-priority entry
		// should be boosted by 2 * PRIORITY_SCORE_BONUS (0.3) over Normal,
		// dwarfing that noise regardless of which one happens to rank first.
		const normalEntry = await insertWorldLoreEntryRow(testDb, lorebook.id, {
			name: "Normal Fact",
			content: "An ordinary fact.",
			priority: 1,
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})
		const veryHighEntry = await insertWorldLoreEntryRow(testDb, lorebook.id, {
			name: "Very High Priority Fact",
			content: "An author-flagged important fact.",
			priority: 3,
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})

		const chatRow = await insertChatRow(testDb, user.id, {
			lorebookId: lorebook.id
		})
		const chat = buildChat({
			id: chatRow.id,
			lorebookId: lorebook.id,
			chatMessages: [chatMessage({ id: 1, content: "tell me something" })],
			// The priority-boost lookup reads .priority off the in-memory
			// lorebook entries (same shape PromptBuilder attaches at runtime),
			// not off the DB rows used for the embedding similarity search.
			lorebook: buildLorebook({
				id: lorebook.id,
				worldLoreEntries: [normalEntry, veryHighEntry]
			})
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())

		const loreScores = (result.rag as any).scores.loreScores as number[]
		expect(loreScores.length).toBe(2)
		const gap = Math.max(...loreScores) - Math.min(...loreScores)
		expect(gap).toBeGreaterThan(0.2)
	})

	test("history entries are sorted globally by date, not by pinned-then-RAG concatenation order", async () => {
		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)

		// Pinned (constant) entry is OLDER than the RAG-retrieved one — a naive
		// [...pinned, ...rag] concatenation would list the older pinned entry
		// first even though it should render newest-first.
		const oldPinned = await insertHistoryEntryRow(testDb, lorebook.id, {
			year: 2000,
			month: 1,
			day: 1,
			content: "Old pinned event.",
			constant: true,
			enabled: true
		})
		const newRag = await insertHistoryEntryRow(testDb, lorebook.id, {
			year: 2020,
			month: 6,
			day: 15,
			content: "Newer RAG-retrieved event.",
			constant: false,
			enabled: true,
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})

		const chatRow = await insertChatRow(testDb, user.id, {
			lorebookId: lorebook.id
		})
		const chat = buildChat({
			id: chatRow.id,
			lorebookId: lorebook.id,
			chatMessages: [chatMessage({ id: 1, content: "what happened" })],
			lorebook: buildLorebook({
				id: lorebook.id,
				historyEntries: [oldPinned, newRag]
			})
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())

		const historyMatch = result.renderedPrompt!.match(
			/HISTORY:([\s\S]*?)\nCURRENTDATE:/
		)
		expect(historyMatch).toBeTruthy()
		const history = JSON.parse(historyMatch![1].trim())
		const keys = Object.keys(history)
		expect(keys).toEqual(["2020-06-15", "2000-01-01"])
	})

	test("fetches the RAG candidate set exactly once per generation turn, even though it's scored against multiple query-message embeddings (current + recent windows)", async () => {
		const ragContextModule = await import("$lib/server/embedding/ragContext")
		const fetchSpy = vi.spyOn(ragContextModule, "fetchScopedCandidates")

		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)
		await insertWorldLoreEntryRow(testDb, lorebook.id, {
			name: "Some Fact",
			content: "Retrievable by similarity.",
			embedding: QUERY_VECTOR,
			embeddingModel: MODEL_ID
		})

		const chatRow = await insertChatRow(testDb, user.id, {
			lorebookId: lorebook.id
		})
		// RAG_CURRENT_WINDOW (2) + RAG_RECENT_WINDOW (3) = 5 — enough
		// guaranteed messages that runQuery() actually runs for BOTH the
		// current and recent windows, each embedding its own set of
		// messages and scoring against the shared candidate set. Before
		// this fix, each of those two runQuery() calls independently
		// re-ran the whole unbounded DB fetch per embedded message.
		const chat = buildChat({
			id: chatRow.id,
			lorebookId: lorebook.id,
			chatMessages: [1, 2, 3, 4, 5, 6].map((n) =>
				chatMessage({ id: n, content: `message number ${n}` })
			),
			lorebook: buildLorebook({ id: lorebook.id })
		})

		const engine = makeEngine(chat)
		await engine.infillContent(makeInfillOptions())

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		fetchSpy.mockRestore()
	})
})

describe("RagInfillEngine — hard token-limit safety net", () => {
	describe("reachable case: guaranteed + RAG-promoted messages alone exceed tokenLimit", () => {
		beforeEach(() => {
			vi.mocked(embeddingModule.getLoadedModelId).mockReturnValue(MODEL_ID)
			vi.mocked(embeddingModule.batchEmbed).mockImplementation(
				async (texts: string[]) => texts.map(() => QUERY_VECTOR)
			)
			vi.mocked(embeddingModule.embed).mockResolvedValue(QUERY_VECTOR)
		})

		test("tokenLimit is enforced even when baseTokens (no lore matched, RAG promotes many older messages) alone already exceeds it", async () => {
			const user = await makeUser()
			const chatRow = await insertChatRow(testDb, user.id)

			// Inserted first (lower ids) — RAG-matched "older" messages, each
			// with an embedding identical to the mocked query vector so every
			// one of them gets promoted into the pre-budget-check message set.
			const olderRows = []
			for (let i = 0; i < 6; i++) {
				olderRows.push(
					await insertChatMessageRow(testDb, chatRow.id, {
						content: "x".repeat(80),
						embedding: QUERY_VECTOR,
						embeddingModel: MODEL_ID
					})
				)
			}
			// Inserted after (higher ids) — the guaranteed window. No
			// embedding needed: fetchScopedCandidates excludes the most
			// recent `excludeRecentMessages` rows by id order regardless.
			const guaranteedRows = []
			for (let i = 0; i < 10; i++) {
				guaranteedRows.push(
					await insertChatMessageRow(testDb, chatRow.id, {
						content: "x".repeat(80)
					})
				)
			}

			const fullChat = buildChat({
				id: chatRow.id,
				chatMessages: [...olderRows, ...guaranteedRows].map((r) =>
					chatMessage({ id: r.id, content: r.content })
				)
			})

			// Sanity check: RAG actually promoted all 6 older messages — the
			// precondition for the bug to be reachable at all.
			const full = await makeEngine(fullChat).infillContent(
				makeInfillOptions({ tokenLimit: 100_000 })
			)
			expect((full.rag as any).messages.ragOlder).toBe(6)

			// Floor baseline: same chat id (so RAG still sees the DB rows),
			// but only the 10 guaranteed messages in the in-memory chat — the
			// filter that turns RAG matches into `initialOlderMessages` reads
			// `this.chat.chatMessages`, not the DB, so this chat's `olderMessages`
			// is empty regardless of what RAG finds server-side.
			const floorChat = buildChat({
				id: chatRow.id,
				chatMessages: guaranteedRows.map((r) =>
					chatMessage({ id: r.id, content: r.content })
				)
			})
			const floorResult = await makeEngine(floorChat).infillContent(
				makeInfillOptions({ tokenLimit: 100_000 })
			)

			// tokenLimit set to exactly the floor cost — below what the full
			// (16-message) render needs, but exactly enough for the
			// trimmed-to-floor render to fit. Before the fix, this returned
			// totalTokens ~= baseTokens (all 16 messages), silently over budget.
			const constrained = await makeEngine(fullChat).infillContent(
				makeInfillOptions({ tokenLimit: floorResult.totalTokens })
			)

			expect(constrained.totalTokens).toBeLessThanOrEqual(
				floorResult.totalTokens
			)
			expect(constrained.chatMessages.includedIds.length).toBeLessThan(16)
			const guaranteedIds = new Set(guaranteedRows.map((r) => r.id))
			for (const id of constrained.chatMessages.includedIds) {
				expect(guaranteedIds.has(id)).toBe(true)
			}
		})
	})

	describe("terminal case: guaranteed messages + pinned lore alone exceed tokenLimit", () => {
		beforeEach(() => {
			// Deliberately the "model active" mocks, not the "no model"
			// rejecting ones — those trip RagInfillEngine's own unrelated
			// catch-block warning ("RAG retrieval failed, continuing without
			// RAG results") once embed/batchEmbed reject, which would pollute
			// the warnSpy call count this test asserts on. With the model
			// "active" but no matching DB rows for this chat, the RAG
			// candidate fetch just resolves to an empty set — no throw, no
			// unrelated warning — leaving only the pinned lore under test.
			vi.mocked(embeddingModule.getLoadedModelId).mockReturnValue(MODEL_ID)
			vi.mocked(embeddingModule.batchEmbed).mockImplementation(
				async (texts: string[]) => texts.map(() => QUERY_VECTOR)
			)
			vi.mocked(embeddingModule.embed).mockResolvedValue(QUERY_VECTOR)
		})

		test("returns best-effort totalTokens and warns once when even the guaranteed floor plus pinned lore can't fit", async () => {
			const bigContent = "y".repeat(2000)
			const pinnedEntries = Array.from({ length: 3 }, (_, i) =>
				worldLoreEntry({
					id: i + 1,
					name: `Pinned ${i}`,
					content: bigContent,
					constant: true,
					enabled: true
				})
			)
			const messages = Array.from({ length: 10 }, (_, i) =>
				chatMessage({ id: i + 1, content: `message ${i + 1}` })
			)
			const chat = buildChat({
				chatMessages: messages,
				lorebook: buildLorebook({ worldLoreEntries: pinnedEntries })
			})

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			const result = await makeEngine(chat).infillContent(
				makeInfillOptions({ tokenLimit: 50 })
			)

			// Documents the known, shared (Keyword has it too) floor
			// limitation rather than asserting it away — pinned lore is
			// never trimmed, so there's nothing left to cut once messages
			// hit MIN_GUARANTEED_MESSAGES + 1.
			expect(result.totalTokens).toBeGreaterThan(50)
			expect(warnSpy).toHaveBeenCalledTimes(1)
			expect(warnSpy.mock.calls[0][0]).toContain("tokenLimit (50)")
			warnSpy.mockRestore()
		})
	})
})
