/**
 * The extracted signals, run against the real engine.
 *
 * `signals.test.ts` proves the functions do what I think they do.
 * This proves they do what the **engine** does, which is a different claim and
 * the only one parity depends on.
 *
 * Method: run `KeywordInfillEngine` on a fixture, take the per-entry score
 * breakdown it already publishes in its diagnostics, and recompute the same
 * numbers from the extracted functions plus `DEFAULT_SIGNAL_WEIGHTS`. If both
 * the individual signals and the weighted total agree, then the extraction and
 * the defaults are jointly correct — one test covering the two ways this
 * refactor could silently go wrong.
 */

import { beforeAll, describe, expect, test, vi } from "vitest"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	buildChat,
	buildLorebook,
	chatMessage,
	makeInfillOptions,
	worldLoreEntry
} from "$lib/server/utils/promptBuilder/infillTestUtils"
import {
	buildScanWindow,
	keywordSignal,
	nameMatchSignal,
	entityCooccurrenceSignal
} from "./signals"
import { DEFAULT_RETRIEVAL, DEFAULT_SIGNAL_WEIGHTS } from "./weights"

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

const { KeywordInfillEngine } = await import(
	"$lib/server/utils/promptBuilder/KeywordInfillEngine"
)
const { InterpolationEngine } = await import(
	"$lib/server/utils/promptBuilder/InterpolationEngine"
)

function makeEngine(chat: any, currentCharacterId: number | null = 1) {
	return new KeywordInfillEngine(
		chat,
		new InterpolationEngine(),
		(entry: any) => entry,
		currentCharacterId
	)
}

/** A chat whose entries exercise every lore signal at once. */
function fixture() {
	const entries = [
		worldLoreEntry({
			id: 101,
			name: "The Ashguard",
			keys: "ashguard, banner",
			content: "An order of oathbound riders."
		}),
		worldLoreEntry({
			id: 102,
			name: "Vell",
			keys: "vell, siege",
			content: "A city under siege."
		}),
		worldLoreEntry({
			id: 103,
			name: "Silverwood",
			keys: "silverwood",
			content: "A forest nobody has mentioned."
		}),
		worldLoreEntry({
			id: 104,
			name: "Kaelen's Blade",
			keys: "blade",
			content: "A sword with a name.",
			priority: 3
		})
	]

	return buildChat({
		lorebook: buildLorebook({ worldLoreEntries: entries }),
		chatMessages: [
			chatMessage({
				id: 1,
				content: "The ashguard rode under a torn banner."
			}),
			chatMessage({
				id: 2,
				content: "Vell will not hold through the siege."
			}),
			chatMessage({
				id: 3,
				content: "He drew the blade and said nothing."
			})
		]
	})
}

describe("extracted signals reproduce the engine", () => {
	test("keyword, nameMatch and co-occurrence match entry for entry", async () => {
		const chat = fixture()
		const result = await makeEngine(chat).infillContent(makeInfillOptions())
		const scored = (result.rag as any).entries as any[]

		const messages = chat.chatMessages.map((m: any) => ({
			content: m.content
		}))
		const window = buildScanWindow(messages, DEFAULT_RETRIEVAL.scanDepth)
		const entityNames = [
			...(chat.chatCharacters ?? []).map((c: any) => c.character?.name),
			...(chat.chatPersonas ?? []).map((p: any) => p.persona?.name)
		]

		const lore = chat.lorebook.worldLoreEntries as any[]
		expect(scored.length).toBeGreaterThan(0)

		for (const entry of lore) {
			const engineScore = scored.find((e) => e.name === entry.name)?.score
			expect(engineScore, `no score for ${entry.name}`).toBeDefined()

			expect(keywordSignal(entry, window)).toBeCloseTo(
				engineScore.keyword,
				10
			)
			expect(nameMatchSignal(entry.name, window)).toBeCloseTo(
				engineScore.nameMatch,
				10
			)
			expect(
				entityCooccurrenceSignal(entry.name, entry.keys, entityNames)
			).toBeCloseTo(engineScore.entityCooccurrence, 10)
		}
	})

	test("the weighted total matches, so the defaults are right as well as the signals", async () => {
		const chat = fixture()
		const result = await makeEngine(chat).infillContent(makeInfillOptions())
		const scored = (result.rag as any).entries as any[]
		const w = DEFAULT_SIGNAL_WEIGHTS.worldLore

		for (const entry of chat.lorebook.worldLoreEntries as any[]) {
			const s = scored.find((e) => e.name === entry.name)?.score
			// Reserved and disabled entries are given a synthetic total of 1 so
			// they sort to the top of the diagnostics list; they are not scored
			// candidates and there is nothing to compare.
			if (s.includedReason?.startsWith("reserved")) continue

			// Recomputed from the engine's own signal values, so this isolates
			// the weights: if the arithmetic agrees, DEFAULT_SIGNAL_WEIGHTS is
			// the formula the engine is actually using.
			const expected =
				w.keyword * s.keyword +
				w.nameMatch * s.nameMatch +
				w.entityCooccurrence * s.entityCooccurrence +
				w.tfidf * s.tfidf +
				w.lastRefRecency * s.lastRefRecency +
				((entry.priority ?? 1) - 1) * w.priorityBonus

			expect(s.total).toBeCloseTo(expected, 10)
		}
	})

	test("an entry nobody mentioned scores zero on every keyword signal", async () => {
		// The negative case, because a scorer that returns something for
		// everything would pass the tests above and still be wrong.
		const chat = fixture()
		const result = await makeEngine(chat).infillContent(makeInfillOptions())
		const silverwood = ((result.rag as any).entries as any[]).find(
			(e) => e.name === "Silverwood"
		)
		expect(silverwood.score.keyword).toBe(0)
		expect(silverwood.score.nameMatch).toBe(0)
	})

	test("the scan window is the last N messages the engine actually read", async () => {
		// Eleven messages, so the window excludes the first: if the extraction
		// used all messages instead, the excluded key would match and this fails.
		const entries = [
			worldLoreEntry({ id: 201, name: "Old News", keys: "beforetime" }),
			worldLoreEntry({ id: 202, name: "Fresh", keys: "recentword" })
		]
		const chat = buildChat({
			lorebook: buildLorebook({ worldLoreEntries: entries }),
			chatMessages: [
				chatMessage({ id: 1, content: "beforetime was long ago" }),
				...Array.from({ length: 10 }, (_, i) =>
					chatMessage({
						id: i + 2,
						content: `filler ${i} recentword`
					})
				)
			]
		})

		const result = await makeEngine(chat).infillContent(makeInfillOptions())
		const scored = (result.rag as any).entries as any[]
		const old = scored.find((e) => e.name === "Old News")
		const fresh = scored.find((e) => e.name === "Fresh")

		expect(old.score.keyword).toBe(0)
		expect(fresh.score.keyword).toBe(1)

		const window = buildScanWindow(
			chat.chatMessages.map((m: any) => ({ content: m.content })),
			DEFAULT_RETRIEVAL.scanDepth
		)
		expect(keywordSignal(entries[0]!, window)).toBe(0)
		expect(keywordSignal(entries[1]!, window)).toBe(1)
	})
})
