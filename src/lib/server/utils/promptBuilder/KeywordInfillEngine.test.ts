import { beforeAll, describe, expect, test, vi } from "vitest"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	buildChat,
	buildLorebook,
	character,
	characterLoreEntry,
	chatCharacter,
	chatMessage,
	chatPersona,
	historyEntry,
	insertCharacterRow,
	insertLorebook,
	insertLorebookBindingRow,
	insertNarrativeNodeRow,
	insertNarrativeRelationshipRow,
	lorebookBinding,
	makeInfillOptions,
	makeTemplateContext,
	persona,
	worldLoreEntry
} from "./infillTestUtils"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

async function makeUser() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb)
}

// Imported after the mock is registered, matching the vi.mock hoisting
// contract other *.int.test.ts files in this repo already rely on.
const { KeywordInfillEngine } = await import("./KeywordInfillEngine")
const { InterpolationEngine } = await import("./InterpolationEngine")

function makeEngine(chat: any, currentCharacterId: number | null = 1) {
	const interpolationEngine = new InterpolationEngine()
	const populateBindings = (entry: any) => entry
	return new KeywordInfillEngine(
		chat,
		interpolationEngine,
		populateBindings,
		currentCharacterId
	)
}

function entryScore(rag: any, name: string) {
	return rag.entries.find((e: any) => e.name === name)?.score
}

describe("KeywordInfillEngine — reserve phase (pinned/constant entries)", () => {
	test("constant world lore is always included regardless of score", async () => {
		const wle = worldLoreEntry({
			name: "Pinned World Fact",
			constant: true,
			keys: "" // no keyword match possible — score would be 0 if not pinned
		})
		const chat = buildChat({
			lorebook: buildLorebook({ worldLoreEntries: [wle] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())

		expect(result.rag!.used).toBe(false)
		expect((result.rag as any).lore.worldLore.pinned).toBe(1)
		expect(result.renderedPrompt).toContain("Pinned World Fact")
		const scored = entryScore(result.rag, "Pinned World Fact")
		expect(scored?.includedReason).toBe("reserved_constant")
	})

	test("constant history entry is always included", async () => {
		const he = historyEntry({
			content: "The founding of the city.",
			year: 500
		})
		const chat = buildChat({
			lorebook: buildLorebook({
				historyEntries: [{ ...he, constant: true }]
			})
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).toContain("The founding of the city.")
		expect((result.rag as any).lore.history.pinned).toBe(1)
	})

	test("constant character lore still respects the privacy rule", async () => {
		const binding = lorebookBinding({ id: 10, characterId: 1 })
		const privateLore = characterLoreEntry({
			name: "Alice's Pinned Secret",
			constant: true,
			lorebookBindingId: 10,
			lorebookId: 1
		})
		const chat = buildChat({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [binding],
				characterLoreEntries: [privateLore]
			})
		})

		// Generating as character 1 (bound owner) — visible.
		const asOwner = makeEngine(chat, 1)
		const ownerResult = await asOwner.infillContent(makeInfillOptions())
		expect(ownerResult.renderedPrompt).toContain("Alice's Pinned Secret")

		// Generating as a different character — private, excluded even though pinned.
		const asOther = makeEngine(chat, 2)
		const otherResult = await asOther.infillContent(makeInfillOptions())
		expect(otherResult.renderedPrompt).not.toContain(
			"Alice's Pinned Secret"
		)
		expect((otherResult.rag as any).lore.characterLore.pinned).toBe(0)
	})

	// A pinned-but-invisible entry is skipped by the reserved-entry loop's
	// `continue` (never pushed to reservedCharacterLore, so its id never
	// enters reservedCharLoreIds), then falls through into the general
	// (non-reserved) candidate filtering, fails visibility there, and lands
	// in visibilityFilteredCharLore — which does get a diagnostic row. This
	// is coincidental (that fallthrough path was written for non-reserved
	// candidates, not pinned ones) rather than deliberately designed, so
	// lock it in: a future refactor that guards candidateCharLore /
	// visibilityFilteredCharLore with `!e.constant` (a very plausible-looking
	// "these are the non-reserved ones" cleanup) would silently reintroduce
	// a silent gap for this case.
	test("a pinned-but-invisible character lore entry still gets an excluded_visibility diagnostic row, not silence", async () => {
		const binding = lorebookBinding({ id: 20, characterId: 1 })
		const privateLore = characterLoreEntry({
			name: "Alice's Pinned Secret 2",
			constant: true,
			lorebookBindingId: 20,
			lorebookId: 1
		})
		const chat = buildChat({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [binding],
				characterLoreEntries: [privateLore]
			})
		})

		// Generating as a different character — private, excluded even though pinned.
		const asOther = makeEngine(chat, 2)
		const otherResult = await asOther.infillContent(makeInfillOptions())

		expect((otherResult.rag as any).lore.characterLore.pinned).toBe(0)
		const scored = entryScore(otherResult.rag, "Alice's Pinned Secret 2")
		expect(scored).toBeDefined()
		expect(scored?.includedReason).toBe("excluded_visibility")
	})
})

describe("KeywordInfillEngine — character-lore privacy", () => {
	function chatWithBoundLore(opts: {
		bindingCharacterId?: number | null
		bindingPersonaId?: number | null
		chatPersonaIds?: number[]
		lorebookId?: number
		entryLorebookId?: number
	}) {
		const {
			bindingCharacterId = null,
			bindingPersonaId = null,
			chatPersonaIds = [],
			lorebookId = 1,
			entryLorebookId = 1
		} = opts
		const binding = lorebookBinding({
			id: 50,
			characterId: bindingCharacterId,
			personaId: bindingPersonaId
		})
		const lore = characterLoreEntry({
			name: "Bound Lore",
			lorebookBindingId: 50,
			lorebookId: entryLorebookId,
			keys: "" // rely on pinned/constant to force inclusion when visible
		})
		return buildChat({
			lorebookId,
			lorebook: buildLorebook({
				id: lorebookId,
				lorebookBindings: [binding],
				characterLoreEntries: [{ ...lore, constant: true }]
			}),
			chatPersonas: chatPersonaIds.map((id) =>
				chatPersona(persona({ id }))
			)
		})
	}

	test("entry bound to the currently-generating character is visible", async () => {
		const chat = chatWithBoundLore({ bindingCharacterId: 7 })
		const engine = makeEngine(chat, 7)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).toContain("Bound Lore")
	})

	test("entry bound to a different character is never visible, even to a chat member", async () => {
		const chat = chatWithBoundLore({ bindingCharacterId: 7 })
		const engine = makeEngine(chat, 8) // a different character generating
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("Bound Lore")
	})

	test("entry bound to a character is invisible during Narrator (no-perspective) generation", async () => {
		const chat = chatWithBoundLore({ bindingCharacterId: 7 })
		const engine = makeEngine(chat, null)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("Bound Lore")
	})

	test("persona-bound entry is visible when that persona is in the chat", async () => {
		const chat = chatWithBoundLore({
			bindingPersonaId: 99,
			chatPersonaIds: [99]
		})
		const engine = makeEngine(chat, 1)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).toContain("Bound Lore")
	})

	test("persona-bound entry is invisible when that persona is not in the chat", async () => {
		const chat = chatWithBoundLore({
			bindingPersonaId: 99,
			chatPersonaIds: []
		})
		const engine = makeEngine(chat, 1)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("Bound Lore")
	})

	test("entry from a lorebook other than the chat's own is never visible", async () => {
		const chat = chatWithBoundLore({
			bindingCharacterId: 7,
			lorebookId: 1,
			entryLorebookId: 2 // mismatched
		})
		const engine = makeEngine(chat, 7)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("Bound Lore")
	})

	test("unbound character-lore entry (no lorebookBindingId) is never visible", async () => {
		const orphan = characterLoreEntry({
			name: "Orphan Lore",
			lorebookBindingId: null,
			constant: true,
			lorebookId: 1
		})
		const chat = buildChat({
			lorebookId: 1,
			lorebook: buildLorebook({ id: 1, characterLoreEntries: [orphan] })
		})
		const engine = makeEngine(chat, 1)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("Orphan Lore")
	})

	test("world lore is never gated by character-lore privacy", async () => {
		const wle = worldLoreEntry({ name: "Public Fact", constant: true })
		const chat = buildChat({
			lorebook: buildLorebook({ worldLoreEntries: [wle] })
		})
		// Even with no current character (Narrator) and no chat roster at all,
		// world lore is unconditionally public.
		const engine = makeEngine(chat, null)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).toContain("Public Fact")
	})
})

describe("KeywordInfillEngine — scoring", () => {
	test("priority bonus is additive and exact: VeryHigh − Normal = 0.30", async () => {
		const guaranteedMsg = chatMessage({
			id: 1,
			content: "tell me about zzzmatch now"
		})
		const normal = worldLoreEntry({
			name: "Normal Priority Entry",
			keys: "zzzmatch",
			priority: 1
		})
		const veryHigh = worldLoreEntry({
			name: "VeryHigh Priority Entry",
			keys: "zzzmatch",
			priority: 3
		})
		const chat = buildChat({
			chatMessages: [guaranteedMsg],
			lorebook: buildLorebook({ worldLoreEntries: [normal, veryHigh] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		const rag = result.rag as any

		const normalScore = entryScore(rag, "Normal Priority Entry")
		const veryHighScore = entryScore(rag, "VeryHigh Priority Entry")
		expect(normalScore.priorityBonus).toBe(0)
		expect(veryHighScore.priorityBonus).toBeCloseTo(0.3, 10)
		expect(veryHighScore.total - normalScore.total).toBeCloseTo(0.3, 10)
	})

	test("keyword match increases score over a non-matching entry", async () => {
		const guaranteedMsg = chatMessage({
			id: 1,
			content: "the ancient relic glows"
		})
		const matching = worldLoreEntry({ name: "Relic Lore", keys: "relic" })
		const nonMatching = worldLoreEntry({
			name: "Unrelated Lore",
			keys: "spaceship"
		})
		const chat = buildChat({
			chatMessages: [guaranteedMsg],
			lorebook: buildLorebook({
				worldLoreEntries: [matching, nonMatching]
			})
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		const rag = result.rag as any
		expect(entryScore(rag, "Relic Lore").keyword).toBeGreaterThan(0)
		expect(entryScore(rag, "Unrelated Lore").keyword).toBe(0)
		expect(entryScore(rag, "Relic Lore").total).toBeGreaterThan(
			entryScore(rag, "Unrelated Lore").total
		)
	})

	test("entity co-occurrence: world lore mentioning a chat character's name scores higher", async () => {
		const alice = character({ id: 1, name: "Alice" })
		const named = worldLoreEntry({ name: "Alice's Hometown", keys: "" })
		const unnamed = worldLoreEntry({ name: "Some Other Place", keys: "" })
		const chat = buildChat({
			chatCharacters: [chatCharacter(alice)],
			lorebook: buildLorebook({ worldLoreEntries: [named, unnamed] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		const rag = result.rag as any
		expect(entryScore(rag, "Alice's Hometown").entityCooccurrence).toBe(1)
		expect(entryScore(rag, "Some Other Place").entityCooccurrence).toBe(0)
	})

	test("disabled entries are excluded and reported with excluded_disabled", async () => {
		const disabled = worldLoreEntry({
			name: "Disabled Fact",
			enabled: false
		})
		const chat = buildChat({
			lorebook: buildLorebook({ worldLoreEntries: [disabled] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		expect(result.renderedPrompt).not.toContain("Disabled Fact")
		expect(entryScore(result.rag, "Disabled Fact")?.includedReason).toBe(
			"excluded_disabled"
		)
	})

	test("position breaks ties between equally-scored entries in fill order", async () => {
		// Both entries have identical, non-matching keys → tied score.total === 0.
		const first = worldLoreEntry({
			name: "Entry Low Position",
			keys: "",
			position: 0
		})
		const second = worldLoreEntry({
			name: "Entry High Position",
			keys: "",
			position: 5
		})
		const chat = buildChat({
			// Insert in reverse so a naive "array order" pass would get it backwards.
			lorebook: buildLorebook({ worldLoreEntries: [second, first] })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		const rendered = result.renderedPrompt!
		const idxLow = rendered.indexOf("Entry Low Position")
		const idxHigh = rendered.indexOf("Entry High Position")
		expect(idxLow).toBeGreaterThanOrEqual(0)
		expect(idxHigh).toBeGreaterThanOrEqual(0)
		expect(idxLow).toBeLessThan(idxHigh)
	})
})

describe("KeywordInfillEngine — budget and messages", () => {
	test("world lore fill is capped at the per-type budget (20)", async () => {
		const entries = Array.from({ length: 25 }, (_, i) =>
			worldLoreEntry({ name: `Entry ${i}`, keys: "" })
		)
		const chat = buildChat({
			lorebook: buildLorebook({ worldLoreEntries: entries })
		})
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		expect((result.rag as any).lore.worldLore.included).toBe(20)
		expect((result.rag as any).lore.worldLore.candidates).toBe(25)
	})

	test("the last MIN_GUARANTEED_MESSAGES(10) messages are always included", async () => {
		const messages = Array.from({ length: 15 }, (_, i) =>
			chatMessage({
				id: i + 1,
				content: `message ${i + 1}`,
				role: "user"
			})
		)
		const chat = buildChat({ chatMessages: messages })
		const engine = makeEngine(chat)
		const result = await engine.infillContent(makeInfillOptions())
		// Ids 6..15 (the last 10) must always be present.
		for (let id = 6; id <= 15; id++) {
			expect(result.chatMessages.includedIds).toContain(id)
		}
		expect((result.rag as any).messages.guaranteed).toBe(10)
	})

	test("older messages beyond the guaranteed window can be excluded under a tight token budget", async () => {
		const messages = Array.from({ length: 15 }, (_, i) =>
			chatMessage({
				id: i + 1,
				content: "x".repeat(50), // long enough to matter for the token count
				role: "user"
			})
		)
		const chat = buildChat({ chatMessages: messages })
		const engine = makeEngine(chat)
		// Reserve alone (10 guaranteed msgs @ 50 chars) already consumes a good
		// chunk; a small limit leaves no room for the 5 older messages to fill in.
		const result = await engine.infillContent(
			makeInfillOptions({ tokenLimit: 600 })
		)
		expect(result.chatMessages.excludedIds.length).toBeGreaterThan(0)
		for (const id of result.chatMessages.excludedIds) {
			expect(id).toBeLessThanOrEqual(5) // only the older (1-5), never guaranteed (6-15)
		}
	})

	test("contextThresholdPercent actually shrinks how much gets filled, not just a diagnostics number", async () => {
		const entries = Array.from({ length: 20 }, (_, i) =>
			worldLoreEntry({
				name: `Entry ${i}`,
				keys: "",
				content: "x".repeat(200)
			})
		)
		const chat = buildChat({
			lorebook: buildLorebook({ worldLoreEntries: entries })
		})

		// Generous tokenLimit either way — only contextThresholdPercent differs.
		const full = await makeEngine(chat).infillContent(
			makeInfillOptions({
				tokenLimit: 100_000,
				contextThresholdPercent: 1
			})
		)
		const constrained = await makeEngine(chat).infillContent(
			makeInfillOptions({
				tokenLimit: 100_000,
				contextThresholdPercent: 0.01
			})
		)

		expect((full.rag as any).lore.worldLore.included).toBeGreaterThan(
			(constrained.rag as any).lore.worldLore.included
		)
		expect(constrained.totalTokens).toBeLessThan(full.totalTokens)
	})
})

describe("KeywordInfillEngine — post-history block", () => {
	function makeFiveMessageChat() {
		const messages = Array.from({ length: 5 }, (_, i) =>
			chatMessage({
				id: i + 1,
				content: `message ${i + 1}`,
				role: "user"
			})
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
				postHistoryTokenTrigger: 100_000, // history is far below this
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
				postHistoryTokenTrigger: 1, // trivially reached
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
				postHistoryTokenTrigger: 100_000, // would gate instructions
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

describe("KeywordInfillEngine — narrative graph tiering", () => {
	// Skipped while NARRATIVE_GRAPH_CONTEXT_ENABLED is false — the
	// {{narrativeGraph}} block is switched off, so there is nothing to tier
	// or trim. Kept rather than deleted: this is the coverage whoever flips
	// that flag back on will need, and it should be re-enabled with it.
	test.skip("chat-roster relationships fill first, then bridging, then the rest are capped at MAX_GRAPH_PAIRS", async () => {
		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)

		// Chat roster: characters A and B.
		const charA = await insertCharacterRow(testDb, user.id, { name: "A" })
		const charB = await insertCharacterRow(testDb, user.id, { name: "B" })
		// Bridging character (outside the chat roster).
		const charC = await insertCharacterRow(testDb, user.id, { name: "C" })
		// Five more "outsider" characters used to build 10 unique tier-2 pairs.
		const outsiders = []
		for (const name of ["D", "E", "F", "G", "H"]) {
			outsiders.push(await insertCharacterRow(testDb, user.id, { name }))
		}

		const allChars = [charA, charB, charC, ...outsiders]
		const bindings: Record<number, any> = {}
		for (const c of allChars) {
			bindings[c.id] = await insertLorebookBindingRow(
				testDb,
				lorebook.id,
				{
					characterId: c.id,
					binding: `{{char:${c.id}}}`
				}
			)
		}
		const nodes: Record<number, any> = {}
		for (const c of allChars) {
			nodes[c.id] = await insertNarrativeNodeRow(testDb, lorebook.id, {
				name: c.name,
				lorebookBindingId: bindings[c.id].id
			})
		}

		// Tier 0: both endpoints in chat roster (A, B).
		await insertNarrativeRelationshipRow(
			testDb,
			lorebook.id,
			nodes[charA.id].id,
			nodes[charB.id].id,
			{ relationshipType: "ally" }
		)
		// Tier 1: exactly one endpoint in chat roster (A, C).
		await insertNarrativeRelationshipRow(
			testDb,
			lorebook.id,
			nodes[charA.id].id,
			nodes[charC.id].id,
			{ relationshipType: "rival" }
		)
		// Tier 2: 10 unique pairs among the 5 outsiders (neither endpoint in roster).
		const outsiderPairs: [number, number][] = []
		for (let i = 0; i < outsiders.length; i++) {
			for (let j = i + 1; j < outsiders.length; j++) {
				outsiderPairs.push([outsiders[i].id, outsiders[j].id])
			}
		}
		expect(outsiderPairs.length).toBe(10)
		for (const [fromChar, toChar] of outsiderPairs) {
			await insertNarrativeRelationshipRow(
				testDb,
				lorebook.id,
				nodes[fromChar].id,
				nodes[toChar].id,
				{ relationshipType: "neutral" }
			)
		}

		const chat = buildChat({
			lorebookId: lorebook.id,
			lorebook: buildLorebook({ id: lorebook.id, lorebookBindings: [] }),
			chatCharacters: [
				chatCharacter({ ...charA } as any),
				chatCharacter({ ...charB } as any)
			]
		})
		const engine = makeEngine(chat, charA.id)
		const result = await engine.infillContent(makeInfillOptions())
		const graphMatch = result.renderedPrompt!.match(
			/GRAPH:([\s\S]*?)\nMESSAGES:/
		)
		expect(graphMatch).toBeTruthy()
		const graph = JSON.parse(graphMatch![1].trim())

		// Tier 0 (A↔B) and tier 1 (A↔C) must always win a slot.
		expect(graph["A_perspective"]).toBeDefined()
		const aRelations = graph["A_perspective"].map((r: any) => r.with)
		expect(aRelations).toContain("B")
		expect(aRelations).toContain("C")

		// Total pairs capped at MAX_GRAPH_PAIRS (10): tier0(1) + tier1(1) + only
		// 8 of the 10 tier-2 candidates should have made it in.
		const totalPairs = Object.values(graph)
			.filter((v): v is any[] => Array.isArray(v))
			.reduce((sum, arr) => sum + arr.length, 0)
		expect(totalPairs).toBe(10)
	})
})

describe("KeywordInfillEngine — narrative graph token budget", () => {
	// Skipped while NARRATIVE_GRAPH_CONTEXT_ENABLED is false — the
	// {{narrativeGraph}} block is switched off, so there is nothing to tier
	// or trim. Kept rather than deleted: this is the coverage whoever flips
	// that flag back on will need, and it should be re-enabled with it.
	test.skip("narrative graph is trimmed under a tight budget instead of being appended after enforcement", async () => {
		const user = await makeUser()
		const lorebook = await insertLorebook(testDb, user.id)

		const charA = await insertCharacterRow(testDb, user.id, { name: "A" })
		const charB = await insertCharacterRow(testDb, user.id, { name: "B" })
		const bindingA = await insertLorebookBindingRow(testDb, lorebook.id, {
			characterId: charA.id,
			binding: `{{char:${charA.id}}}`
		})
		const bindingB = await insertLorebookBindingRow(testDb, lorebook.id, {
			characterId: charB.id,
			binding: `{{char:${charB.id}}}`
		})
		const nodeA = await insertNarrativeNodeRow(testDb, lorebook.id, {
			name: "A",
			lorebookBindingId: bindingA.id
		})
		const nodeB = await insertNarrativeNodeRow(testDb, lorebook.id, {
			name: "B",
			lorebookBindingId: bindingB.id
		})
		await insertNarrativeRelationshipRow(
			testDb,
			lorebook.id,
			nodeA.id,
			nodeB.id,
			{
				relationshipType: "ally",
				description: "Longtime allies who trust each other completely."
			}
		)

		const chat = buildChat({
			lorebookId: lorebook.id,
			lorebook: buildLorebook({ id: lorebook.id, lorebookBindings: [] }),
			chatCharacters: [
				chatCharacter({ ...charA } as any),
				chatCharacter({ ...charB } as any)
			],
			chatMessages: [chatMessage({ content: "Hello there." })]
		})
		const engine = makeEngine(chat, charA.id)

		// Generous budget — the graph should render.
		const full = await engine.infillContent(
			makeInfillOptions({ tokenLimit: 100_000 })
		)
		expect(full.renderedPrompt).toMatch(/GRAPH:\{/)

		// One token under what the full render costs: not enough room for both
		// the guaranteed message AND the graph. Before the graph's token cost
		// was measured as part of the budget, this content was appended to the
		// render *after* enforcement — so totalTokens/renderedPrompt could
		// silently exceed tokenLimit here. It should now be sacrificed first
		// (mirroring RagInfillEngine's graphSlot), leaving the message intact.
		const constrained = await engine.infillContent(
			makeInfillOptions({ tokenLimit: full.totalTokens - 1 })
		)
		expect(constrained.renderedPrompt).not.toMatch(/GRAPH:\{/)
		expect(constrained.totalTokens).toBeLessThanOrEqual(
			full.totalTokens - 1
		)
		expect(constrained.renderedPrompt).toContain("Hello there.")
	})
})
