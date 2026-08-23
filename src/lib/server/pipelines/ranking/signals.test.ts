/**
 * The extracted signals, checked against the behaviour they were extracted
 * from — including the parts that look like bugs.
 *
 * Those are the important ones. Substring matching and the silent regex
 * fallback are surprising, and a refactor that "fixes" them while claiming to
 * be behaviour-preserving is exactly how a migration produces a different
 * prompt and nobody can say when it started.
 */

import { describe, it, expect } from "vitest"
import {
	buildScanWindow,
	splitKeys,
	matchesKey,
	keywordSignal,
	nameMatchSignal,
	entityCooccurrenceSignal,
	tokenize,
	buildIdf,
	tfidfSignal,
	buildTermFreq,
	lastRefRecencySignal,
	positionRecencySignal,
	densitySignal,
	buildLastRefMap
} from "$lib/server/pipelines/ranking/signals"
import {
	DEFAULT_RANKING,
	DEFAULT_SIGNAL_WEIGHTS,
	DEFAULT_GROUPS,
	allocateBudgets,
	withDefaults
} from "$lib/server/pipelines/ranking/weights"
import { PRIORITY_SCORE_BONUS } from "$lib/server/pipelines/ranking/weights"

const msgs = (...contents: string[]) => contents.map((content) => ({ content }))

describe("scan window", () => {
	it("reads the last N messages, joined by a space", () => {
		const w = buildScanWindow(msgs("one", "two", "three", "four"), 2)
		expect(w.raw).toBe("three four")
		expect(w.lower).toBe("three four")
	})

	it("is independent of the guaranteed-message count", () => {
		// The whole reason for splitting the constant: a deep scan with a short
		// guarantee is a legitimate configuration, and today it is unreachable.
		const all = msgs(
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
			"g",
			"h",
			"i",
			"j",
			"k",
			"l"
		)
		expect(buildScanWindow(all, 12).raw.split(" ")).toHaveLength(12)
		expect(buildScanWindow(all, 3).raw).toBe("j k l")
	})

	it("a key spanning a message boundary matches, because the join is a space", () => {
		const w = buildScanWindow(msgs("the silver", "sword gleamed"), 10)
		expect(matchesKey("silver sword", { matchMode: "substring" }, w)).toBe(
			true
		)
	})
})

describe("key matching", () => {
	it("splits on commas, trims, and drops empties", () => {
		expect(splitKeys(" ash , , guard ,")).toEqual(["ash", "guard"])
		expect(splitKeys(null)).toEqual([])
	})

	it("matches by substring — the behaviour, not the intent", () => {
		// `art` fires on "hearth". This is current behaviour and stays the
		// default until parity; `word` mode is the opt-out.
		const w = buildScanWindow(
			msgs("she warmed her hands by the hearth"),
			10
		)
		expect(matchesKey("art", {}, w)).toBe(true)
		expect(matchesKey("art", { matchMode: "word" }, w)).toBe(false)
	})

	it("word mode handles multi-word keys, which a token set could not", () => {
		const w = buildScanWindow(msgs("the Ashguard rode north"), 10)
		expect(matchesKey("ashguard rode", { matchMode: "word" }, w)).toBe(true)
		expect(matchesKey("guard rode", { matchMode: "word" }, w)).toBe(false)
	})

	it("word mode respects unicode letters rather than ASCII word boundaries", () => {
		const w = buildScanWindow(msgs("Kaelen greeted Sørina warmly"), 10)
		expect(matchesKey("sørina", { matchMode: "word" }, w)).toBe(true)
		expect(matchesKey("rina", { matchMode: "word" }, w)).toBe(false)
	})

	it("honours caseSensitive by matching the raw window", () => {
		const w = buildScanWindow(msgs("The Rose Court convened"), 10)
		expect(matchesKey("rose", { caseSensitive: true }, w)).toBe(false)
		expect(matchesKey("Rose", { caseSensitive: true }, w)).toBe(true)
		expect(matchesKey("rose", {}, w)).toBe(true)
	})

	it("falls back to substring on an invalid regex, silently", () => {
		// Preserved deliberately. A broken regex today yields substring
		// behaviour, not a dead entry; turning it into a diagnostic is a
		// post-parity improvement.
		const w = buildScanWindow(msgs("a [unclosed bracket"), 10)
		expect(matchesKey("[unclosed", { useRegex: true }, w)).toBe(true)
	})

	it("matchMode wins over the legacy useRegex boolean", () => {
		const w = buildScanWindow(msgs("hearth"), 10)
		expect(
			matchesKey("art", { useRegex: true, matchMode: "word" }, w)
		).toBe(false)
	})

	it("scores the fraction of keys matched", () => {
		const w = buildScanWindow(msgs("the ashguard rode north"), 10)
		expect(keywordSignal({ keys: "ashguard, north" }, w)).toBe(1)
		expect(keywordSignal({ keys: "ashguard, south" }, w)).toBe(0.5)
		expect(keywordSignal({ keys: "" }, w)).toBe(0)
	})
})

describe("other signals", () => {
	it("name match is a lowercase substring of the window", () => {
		const w = buildScanWindow(msgs("Kaelen drew his blade"), 10)
		expect(nameMatchSignal("kaelen", w)).toBe(1)
		expect(nameMatchSignal("Rowan", w)).toBe(0)
		expect(nameMatchSignal(null, w)).toBe(0)
	})

	it("entity co-occurrence asks whether the ENTRY mentions the entity", () => {
		// Direction matters: an entry about Kaelen's sword co-occurs with Kaelen
		// in a scene where nobody says his name.
		expect(
			entityCooccurrenceSignal("Kaelen's sword", "blade", ["Kaelen"])
		).toBe(1)
		expect(entityCooccurrenceSignal("A sword", "blade", ["Kaelen"])).toBe(0)
	})

	it("tokenize drops single characters and lowercases", () => {
		expect(tokenize("A Silver Sword, and I")).toEqual([
			"silver",
			"sword",
			"and"
		])
	})

	it("idf is log(N / (1 + df)) per term", () => {
		const idf = buildIdf(msgs("sword sword", "sword", "shield"))
		expect(idf.get("sword")).toBeCloseTo(Math.log(3 / 3), 10)
		expect(idf.get("shield")).toBeCloseTo(Math.log(3 / 2), 10)
	})

	describe("tfidf", () => {
		// The corrected signal: `tf` comes from the **recent window**, not from
		// the entry. The first version divided the term's count by the entry's
		// own length, which measures how distinctive the entry's wording is —
		// a property of the entry alone, that says nothing about whether it
		// belongs in this turn. The parity corpus found it as a lore-ordering
		// difference; these tests are what would have found it first.
		const idf = buildIdf(msgs("sword", "shield", "shield"))

		it("weighs the entry's terms by how often the window uses them", () => {
			const window = buildTermFreq("sword sword shield")
			// tf("sword") = 2/2 messages, times its idf.
			expect(tfidfSignal("sword", idf, window, 2)).toBeCloseTo(
				(2 / 2) * Math.log(3 / 2),
				10
			)
		})

		it("scores an entry the conversation never mentions at zero", () => {
			// The property the entry-relative version could not have: a term
			// that appears only inside the entry contributes nothing, because
			// nobody is talking about it.
			const window = buildTermFreq("shield")
			expect(tfidfSignal("sword", idf, window, 1)).toBe(0)
		})

		it("counts a term written twice in an entry twice", () => {
			const window = buildTermFreq("sword")
			const once = tfidfSignal("sword", idf, window, 1)
			expect(tfidfSignal("sword sword", idf, window, 1)).toBeCloseTo(
				once * 2,
				10
			)
		})

		it("is zero for empty text, and survives an empty window", () => {
			expect(tfidfSignal("", idf, buildTermFreq("sword"), 1)).toBe(0)
			// No division by zero when the chat has no messages yet.
			expect(tfidfSignal("sword", idf, new Map(), 0)).toBe(0)
		})
	})

	it("lastRef recency decays slowly, on purpose", () => {
		// ~0.6 at fifty messages ago: a lorebook entry does not stop being
		// relevant because the topic moved on for a page.
		expect(lastRefRecencySignal(50, 100)).toBeCloseTo(Math.exp(-0.5), 10)
		expect(lastRefRecencySignal(undefined, 100)).toBe(0)
		expect(lastRefRecencySignal(100, 100)).toBe(1)
	})

	it("position recency is 0 for oldest and 1 for newest", () => {
		expect(positionRecencySignal(0, 5)).toBe(0)
		expect(positionRecencySignal(4, 5)).toBe(1)
		expect(positionRecencySignal(0, 1)).toBe(1)
	})

	it("density is length against the average, capped", () => {
		expect(densitySignal(50, 100)).toBe(0.5)
		expect(densitySignal(500, 100)).toBe(1)
		expect(densitySignal(50, 0)).toBe(1)
	})

	it("lastRefMap scans every message and keeps the latest hit", () => {
		const map = buildLastRefMap(
			msgs("ashguard", "nothing", "ashguard again", "quiet"),
			[{ id: 7, keys: "ashguard" }]
		)
		expect(map.get(7)).toBe(2)
	})

	it("lastRefMap ignores entries with no keys", () => {
		expect(
			buildLastRefMap(msgs("anything"), [{ id: 1, keys: "" }]).size
		).toBe(0)
	})
})

describe("parameters reproduce today's constants", () => {
	it("lore weights match the engine's literals", () => {
		// If this fails, the defaults have drifted from the code they were
		// lifted from, and the parity corpus is about to fail for a reason
		// nobody will look for here.
		expect(DEFAULT_SIGNAL_WEIGHTS.worldLore).toMatchObject({
			keyword: 0.35,
			nameMatch: 0.25,
			entityCooccurrence: 0.2,
			tfidf: 0.1,
			lastRefRecency: 0.1,
			priorityBonus: PRIORITY_SCORE_BONUS
		})
		expect(DEFAULT_SIGNAL_WEIGHTS.characterLore).toEqual(
			DEFAULT_SIGNAL_WEIGHTS.worldLore
		)
	})

	it("history and message weights match, including history having no priority bonus", () => {
		expect(DEFAULT_SIGNAL_WEIGHTS.history).toMatchObject({
			keyword: 0.35,
			recency: 0.2,
			tfidf: 0.1,
			sceneAffinity: 0.1,
			lastRefRecency: 0.1,
			priorityBonus: 0
		})
		expect(DEFAULT_SIGNAL_WEIGHTS.messages).toMatchObject({
			recency: 0.3,
			sceneAffinity: 0.15,
			tfidf: 0.1,
			density: 0.1,
			keyword: 0
		})
	})

	it("entry caps match FILL_BUDGET", () => {
		expect(DEFAULT_GROUPS.maxEntries).toMatchObject({
			worldLore: 20,
			characterLore: 15,
			history: 10,
			messages: 50
		})
	})

	// `minMessageTokens: 512` used to be asserted here against
	// MIN_MESSAGE_FILL_TOKENS. It is `minEntries` now — a count, per source —
	// and the messages floor carries `core:query/chat-history@1`'s old
	// `minInclude` rather than the token constant.
	it("floors default to six messages and nothing else", () => {
		expect(DEFAULT_GROUPS.minEntries).toEqual({
			messages: 6,
			worldLore: 0,
			characterLore: 0,
			history: 0,
			relationships: 0
		})
	})

	it("the default shares reproduce MESSAGE_FILL_FRACTION", () => {
		const budgets = allocateBudgets(DEFAULT_GROUPS, 4000)
		expect(budgets.messages).toBe(2000)
		expect(
			budgets.worldLore + budgets.characterLore + budgets.history
		).toBeGreaterThanOrEqual(1998)
	})

	it("scan depth and the guaranteed count both default to 10", () => {
		expect(DEFAULT_RANKING.retrieval.scanDepth).toBe(10)
		expect(DEFAULT_RANKING.retrieval.guaranteedMessages).toBe(10)
	})
})

describe("group importance is a budget share", () => {
	it("turning a group up takes tokens from the others and nowhere else", () => {
		const heavy = allocateBudgets(
			{
				...DEFAULT_GROUPS,
				share: {
					...DEFAULT_GROUPS.share,
					worldLore: 1.5,
					messages: 0.5
				}
			},
			4000
		)
		expect(heavy.worldLore).toBeGreaterThan(
			allocateBudgets(DEFAULT_GROUPS, 4000).worldLore
		)
		expect(
			heavy.messages +
				heavy.worldLore +
				heavy.characterLore +
				heavy.history
		).toBeLessThanOrEqual(4000)
	})

	it("a zero weight excludes a group — a toggle for free", () => {
		const b = allocateBudgets(
			{
				...DEFAULT_GROUPS,
				share: { ...DEFAULT_GROUPS.share, history: 0 }
			},
			4000
		)
		expect(b.history).toBe(0)
		// And the freed budget goes to the remaining groups rather than being
		// left on the floor.
		expect(b.worldLore).toBeGreaterThan(
			allocateBudgets(DEFAULT_GROUPS, 4000).worldLore
		)
	})

	// Was "messages keep their floor even when weighted almost to nothing",
	// asserting `b.messages >= 512`. The floor is `minEntries` now and lives in
	// `select`, which is the only place that knows what a message costs — so
	// what this function must promise is the opposite one: that it never hands
	// out more than there is. It used to, precisely because of the floor it
	// applied here after the split.
	it("never allocates more than the window, however lopsided the shares", () => {
		for (const share of [
			{ ...DEFAULT_GROUPS.share, messages: 0.01, worldLore: 10 },
			{ ...DEFAULT_GROUPS.share, messages: 1000 },
			DEFAULT_GROUPS.share
		]) {
			for (const available of [64, 500, 4000]) {
				const b = allocateBudgets(
					{ ...DEFAULT_GROUPS, share },
					available
				)
				const total = Object.values(b).reduce((a, n) => a + n, 0)
				expect(total).toBeLessThanOrEqual(available)
			}
		}
	})

	it("no budget means no allocation rather than a negative one", () => {
		expect(allocateBudgets(DEFAULT_GROUPS, 0).messages).toBe(0)
	})

	it("a partial override keeps the untouched sections at their defaults", () => {
		const p = withDefaults({ retrieval: { scanDepth: 40 } as any })
		expect(p.retrieval.scanDepth).toBe(40)
		expect(p.retrieval.guaranteedMessages).toBe(10)
		expect(p.signals.worldLore.keyword).toBe(0.35)
	})
})
