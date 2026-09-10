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
	speakerCooccurrenceSignal,
	speakersIn,
	tokenize,
	buildIdf,
	buildBm25Idf,
	tfidfSignal,
	buildTermFreq,
	lastRefRecencySignal,
	densitySignal,
	buildLastRefMap,
	keywordMatch,
	trigramsOf,
	trigramCoverage,
	selectiveLogicHolds,
	lexicalDocument,
	lexicalSignal,
	isDefaultLexical,
	LEXICAL_OVERLAP,
	BM25_K1,
	BM25_B,
	SELECTIVE_LOGIC,
	SELECTIVE_LOGIC_BY_ST_CODE
} from "$lib/server/pipelines/ranking/signals"
import {
	DEFAULT_RANKING,
	DEFAULT_SIGNAL_WEIGHTS,
	DEFAULT_GROUPS,
	allocateBudgets,
	withDefaults
} from "$lib/server/pipelines/ranking/weights"
import { PRIORITY_SCORE_BONUS } from "$lib/server/pipelines/ranking/weights"
import type {
	SignalWeights,
	RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import * as C from "@serene-pub/contracts"

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

	/**
	 * The inverse character classes, which a lowercased *pattern* inverts.
	 *
	 * `\B`, `\W`, `\S` and `\D` are each the negation of the lowercase
	 * escape beside them, so lowercasing the pattern text turned every one of
	 * them into its own opposite — silently, with the entry still firing on
	 * something. Case-insensitivity comes from the `i` flag, which leaves the
	 * pattern alone.
	 *
	 * ST exports `case_sensitive: null`, which lands in the column as `false`,
	 * so this is the configuration real imported books arrive in.
	 */
	it("does not lowercase the regex pattern, which would invert \\B", () => {
		// `\Bing`: "ing" NOT at a word boundary — inside a word. `\bing`, the
		// lowercased corruption, is the opposite: "ing" starting a word.
		const inside = buildScanWindow(msgs("she was singing softly"), 10)
		const starting = buildScanWindow(msgs("ingots of silver"), 10)
		expect(matchesKey("\\Bing", { useRegex: true }, inside)).toBe(true)
		expect(matchesKey("\\Bing", { useRegex: true }, starting)).toBe(false)
	})

	it("does not lowercase the regex pattern, which would invert \\W", () => {
		// `\Wking`: a NON-word character before "king". `\wking` wants a word
		// character there instead.
		const spaced = buildScanWindow(msgs("the young king rode"), 10)
		const joined = buildScanWindow(msgs("the highking rode"), 10)
		expect(matchesKey("\\Wking", { useRegex: true }, spaced)).toBe(true)
		expect(matchesKey("\\Wking", { useRegex: true }, joined)).toBe(false)
	})

	it("does not lowercase the regex pattern, which would invert \\S", () => {
		// `\Sfoo`: a NON-space before "foo". `\sfoo` wants a space there.
		const attached = buildScanWindow(msgs("the barfoo sign"), 10)
		const spaced = buildScanWindow(msgs("the bar foo sign"), 10)
		expect(matchesKey("\\Sfoo", { useRegex: true }, attached)).toBe(true)
		expect(matchesKey("\\Sfoo", { useRegex: true }, spaced)).toBe(false)
	})

	it("does not lowercase the regex pattern, which would invert \\D", () => {
		// `\Dx`: a NON-digit before "x". `\dx` wants a digit there.
		const letter = buildScanWindow(msgs("the ax fell"), 10)
		const digit = buildScanWindow(msgs("the 4x scope"), 10)
		expect(matchesKey("\\Dx", { useRegex: true }, letter)).toBe(true)
		expect(matchesKey("\\Dx", { useRegex: true }, digit)).toBe(false)
	})

	it("matches a regex case-insensitively through the flag, not the pattern", () => {
		const w = buildScanWindow(msgs("The Rose Court convened"), 10)
		// A pattern carrying capitals still matches a lowercased window.
		expect(matchesKey("Rose\\s+Court", { useRegex: true }, w)).toBe(true)
		// And `caseSensitive` still means what it says.
		expect(
			matchesKey(
				"rose\\s+court",
				{ useRegex: true, caseSensitive: true },
				w
			)
		).toBe(false)
		expect(
			matchesKey(
				"Rose\\s+Court",
				{ useRegex: true, caseSensitive: true },
				w
			)
		).toBe(true)
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

	/**
	 * The other co-occurrence, and it is a different question.
	 *
	 * World lore asks whether the entry names a cast member; character lore
	 * asks whether the entry's own character **spoke in the guaranteed
	 * window** (`KeywordInfillEngine:1161-1175`). The two were computed by one
	 * function for a while, which made character lore's answer a fact about the
	 * entry's wording — and since a character-lore entry names its own
	 * character by construction, that scored every present character's private
	 * lore alike.
	 */
	it("character lore co-occurrence asks whether the CHARACTER spoke", () => {
		expect(speakerCooccurrenceSignal(7, new Set([7, 9]))).toBe(1)
		expect(speakerCooccurrenceSignal(7, new Set([9]))).toBe(0)
		// A binding naming a persona, or nobody, has no character to look for.
		expect(speakerCooccurrenceSignal(null, new Set([7]))).toBe(0)
		expect(speakerCooccurrenceSignal(undefined, new Set([7]))).toBe(0)
	})

	it("the speaker set is the guaranteed window, and characters only", () => {
		const said = (characterId: number | null) => ({ characterId })
		const all = [said(1), said(null), said(2), said(3)]
		// The whole list when the window is at least as long as it.
		expect([...speakersIn(all, 10)]).toEqual([1, 2, 3])
		// The last two only, and the user turn contributes nothing.
		expect([...speakersIn(all, 2)]).toEqual([2, 3])
		expect([...speakersIn([said(null)], 10)]).toEqual([])
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

	/**
	 * A term in *every* message is worth nothing, never less than nothing.
	 *
	 * `df = N` makes the ratio `N / (N + 1)`, so the unfloored log is negative —
	 * and on a short session that is the ordinary case rather than an edge one:
	 * "the" is in every message. Summed by `tfidfSignal` it means an entry
	 * sharing only common words ranks **below** one sharing nothing at all, and
	 * `normaliseTfidf` cannot undo it (it divides by `Math.max(1, max)`, so a
	 * negative pool passes through unscaled). Seen live as a candidate reported
	 * `filled_zero_score · scored -0.028`.
	 *
	 * Only `df = N` moves. Asserted term by term against the unfloored formula
	 * so this stays a floor rather than becoming a different idf.
	 */
	it("floors a term that appears in every message at zero", () => {
		const idf = buildIdf(msgs("the sword", "the shield", "the horse"))
		expect(Math.log(3 / (1 + 3))).toBeLessThan(0)
		expect(idf.get("the")).toBe(0)
		// Everything below `df = N` keeps exactly the number it always had.
		expect(idf.get("sword")).toBeCloseTo(Math.log(3 / 2), 10)
		expect(idf.get("shield")).toBeCloseTo(Math.log(3 / 2), 10)
	})

	it("no term ever scores an entry downward", () => {
		// The property the floor exists for, stated over the whole map rather
		// than over one term: a shared word is evidence or it is nothing.
		const idf = buildIdf(
			msgs("the guard was here", "the guard again", "the guard once more")
		)
		for (const weight of idf.values())
			expect(weight).toBeGreaterThanOrEqual(0)

		// And an entry made entirely of universal words scores 0, not negative.
		const window = buildTermFreq("the guard was here")
		expect(tfidfSignal("the guard", idf, window, 3)).toBe(0)
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
			// No division by zero when the session has no messages yet.
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

	// ⚠ `position recency is 0 for oldest and 1 for newest` was here and is
	// gone with `positionRecencySignal`. It was the only caller that helper ever
	// had — a green assertion about a function no mechanism ran, weighing a
	// signal `core:task/rank-hybrid@1` declared and nothing produced. A unit
	// test on a helper cannot see that nobody calls it, which is the whole
	// reason `runtime/signalWiring.test.ts` exists.

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
			tfidf: 0.1,
			lastRefRecency: 0.1,
			priorityBonus: PRIORITY_SCORE_BONUS
		})
		expect(DEFAULT_SIGNAL_WEIGHTS.characterLore).toMatchObject({
			keyword: 0.35,
			nameMatch: 0.25,
			tfidf: 0.1,
			lastRefRecency: 0.1,
			priorityBonus: PRIORITY_SCORE_BONUS
		})
	})

	/**
	 * ⚠ **The one lore weight that is deliberately no longer 0.5's** — plan
	 * phase 3, design §13.10.
	 *
	 * The two lore sources shared one set until world lore's co-occurrence
	 * changed measurement: it is the graded, rarity-weighted, two-sided overlap
	 * now, which saturates near 0.63 for one rare shared entity and 0.86 for
	 * two. At 0.5's 0.2 its live range would be ~[0.13, 0.17] — *narrower* than
	 * the {0, 0.2} of the binary signal it replaces, so the improvement would
	 * be more correct and less influential at once.
	 *
	 * Character lore's stays at 0.2 because its measurement did not move: it
	 * still asks whether the entry's own character spoke in the guaranteed
	 * window, which is a 0 or a 1 exactly as it was.
	 *
	 * Stated as its own assertion rather than folded into the literals above,
	 * so a future reader finds the reason next to the number instead of a
	 * silently edited constant.
	 */
	it("world lore's entity weight is sized for the graded measure", () => {
		expect(DEFAULT_SIGNAL_WEIGHTS.worldLore.entityCooccurrence).toBe(0.35)
		expect(DEFAULT_SIGNAL_WEIGHTS.characterLore.entityCooccurrence).toBe(
			0.2
		)
	})

	/**
	 * ⚠ `recency: 0.2` and `sceneAffinity: 0.1` were asserted here on history,
	 * and `recency: 0.3` / `sceneAffinity: 0.15` on messages. All four are gone
	 * with the two weights: nothing produced either signal, so the numbers this
	 * test pinned were pinning arithmetic that could not run.
	 */
	it("history and message weights match, including history having no priority bonus", () => {
		expect(DEFAULT_SIGNAL_WEIGHTS.history).toMatchObject({
			keyword: 0.35,
			tfidf: 0.1,
			lastRefRecency: 0.1,
			priorityBonus: 0
		})
		expect(DEFAULT_SIGNAL_WEIGHTS.messages).toMatchObject({
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
	// and the messages floor carries `core:query/session-history@1`'s old
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

	/**
	 * The same default, stated twice, pinned to agree.
	 *
	 * `core:task/rank-hybrid@1` declares the signal matrix transposed — one
	 * `perMember` field per signal, `signalKeyword` → `signals[*].keyword` — and
	 * **that declaration is the live one**: it seeds the config a run reads, and
	 * `signalsFrom` consults `DEFAULT_SIGNAL_WEIGHTS` only for keys the stored
	 * config did not carry. So the two agree today by convention alone, and a
	 * drift would be invisible from either side: the app would score one way
	 * through a seeded config and another way through any direct caller of
	 * `withDefaults`, with both numbers looking deliberate.
	 *
	 * A test rather than a derivation, deliberately. Making one of them the
	 * source of the other belongs with the later move of mechanism defaults to
	 * live beside their mechanism; until then this is what makes the drift a
	 * CI failure instead of a bug report.
	 *
	 * Collected rather than asserted one at a time so the failure names every
	 * drifted key with both values, in one read.
	 */
	it("every default matches its declared default on rank-hybrid", () => {
		const schema = (C.rankHybrid.descriptor.slots?.params?.schema ??
			{}) as Record<
			string,
			{ default?: Record<string, number> } | undefined
		>
		// Asserted separately so "the declaration moved" fails as itself rather
		// than as every key drifting to `undefined` at once.
		expect(Object.keys(schema).length).toBeGreaterThan(0)
		// Derived from the shipped map rather than from the interface, so a
		// signal added to `SignalWeights` and never declared shows up here as a
		// declared default of `undefined` rather than being quietly skipped.
		const signals = Object.keys(
			DEFAULT_SIGNAL_WEIGHTS.worldLore
		) as (keyof SignalWeights)[]
		const sources = Object.keys(DEFAULT_SIGNAL_WEIGHTS) as RetrievalBand[]
		const fieldOf = (signal: string) =>
			`signal${signal[0]!.toUpperCase()}${signal.slice(1)}`

		const drift: string[] = []
		for (const source of sources)
			for (const signal of signals) {
				const field = fieldOf(signal)
				const declared = schema[field]?.default?.[source]
				const local = DEFAULT_SIGNAL_WEIGHTS[source][signal]
				if (declared !== local)
					drift.push(
						`${source}.${signal}: weights.ts has ${local}, ${field}.default has ${declared}`
					)
			}

		// The other direction: a signal the declaration carries and the app has
		// no weight for is a control a user can move that nothing reads.
		for (const field of Object.keys(schema))
			if (
				field.startsWith("signal") &&
				!signals.some((s) => fieldOf(s) === field)
			)
				drift.push(
					`${field} is declared on rank-hybrid with no matching key in SignalWeights`
				)

		expect(drift).toEqual([])
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

// ── Retrieval plan phase 1 — lexical quality ────────────────────────────────

describe("BM25 replaces the raw per-occurrence sum", () => {
	const idf = new Map([
		["ashguard", 2],
		["riders", 2]
	])
	const window = new Map([
		["ashguard", 1],
		["riders", 1]
	])

	it("reproduces tfidfSignal exactly under the shipped options", () => {
		// The property the whole switch rests on. If this ever fails, the
		// default stopped being the shipped behaviour and the parity corpus is
		// about to move for a reason nobody will look for here.
		for (const text of [
			"ashguard, riders",
			"ashguard ashguard riders",
			"nothing at all",
			""
		]) {
			const doc = lexicalDocument({ title: "", keys: text }, 1)
			expect(
				lexicalSignal(doc, idf, window, 4, LEXICAL_OVERLAP),
				text
			).toBeCloseTo(tfidfSignal(text, idf, window, 4), 12)
		}
	})

	it("saturates a repeated term instead of counting it linearly", () => {
		const once = lexicalDocument({ title: "", keys: "ashguard" }, 1)
		const thrice = lexicalDocument(
			{ title: "", keys: "ashguard ashguard ashguard" },
			1
		)
		const opts = {
			titleWeight: 1,
			saturation: BM25_K1,
			lengthNorm: 0,
			averageLength: 1
		}
		const a = lexicalSignal(once, idf, window, 4, opts)
		const b = lexicalSignal(thrice, idf, window, 4, opts)
		// Still more, but nowhere near three times more — which is what the
		// unsaturated sum gives and what makes a repetitive entry win.
		expect(b).toBeGreaterThan(a)
		expect(b).toBeLessThan(a * 2)
		expect(
			lexicalSignal(thrice, idf, window, 4, LEXICAL_OVERLAP)
		).toBeCloseTo(
			lexicalSignal(once, idf, window, 4, LEXICAL_OVERLAP) * 3,
			12
		)
	})

	/**
	 * The other half of the same curve, and the half that arrived later.
	 *
	 * `measure/rankingCorpus.test.ts` asserts what this *does* — `LITANY` is
	 * the world where a word said eighteen times stops carrying an entry that
	 * says nothing else. This asserts the arithmetic it does it with, because
	 * an ordering assertion passes for a whole family of curves and the claim
	 * here is about one of them: Okapi's `k3` term at `BM25_K1`, which is the
	 * document half's curve with the length normalisation left out.
	 */
	it("saturates the conversation's repetition on the document half's curve", () => {
		const doc = lexicalDocument({ title: "", keys: "ashguard" }, 1)
		const opts = {
			titleWeight: 1,
			saturation: BM25_K1,
			lengthNorm: 0,
			averageLength: 1
		}
		const said = (times: number) =>
			lexicalSignal(doc, idf, new Map([["ashguard", times]]), 1, opts)

		// ⚠ `f = 1` is a fixed point of the curve at every `k1`, so a term the
		// conversation says once is worth exactly what it was worth before the
		// query half saturated at all. Only repetition is compressed.
		expect(said(1)).toBeCloseTo(
			lexicalSignal(doc, idf, new Map([["ashguard", 1]]), 1, {
				...opts,
				saturation: null
			}),
			12
		)

		// The curve itself: `qtf · (k1 + 1) / (qtf + k1)`, which is 2.0625 at
		// 18 rather than 18, and never reaches `k1 + 1` = 2.2.
		expect(said(18) / said(1)).toBeCloseTo(
			(18 * (BM25_K1 + 1)) / (18 + BM25_K1),
			12
		)
		expect(said(1000) / said(1)).toBeLessThan(BM25_K1 + 1)

		// And the reading it replaces multiplies by the raw count, which is the
		// non-standard extension that let a stopword run away with the score.
		const raw = (times: number) =>
			lexicalSignal(doc, idf, new Map([["ashguard", times]]), 1, {
				...opts,
				saturation: null
			})
		expect(raw(18) / raw(1)).toBeCloseTo(18, 12)
	})

	it("stops a long entry outscoring a precise one on length alone", () => {
		// Both say the conversation's term exactly once; the long one buries it
		// in vocabulary the conversation never mentions.
		const precise = lexicalDocument({ title: "", keys: "ashguard" }, 1)
		const padded = lexicalDocument(
			{ title: "", keys: "ashguard lantern feast winter plinth mural" },
			1
		)
		const opts = {
			titleWeight: 1,
			saturation: BM25_K1,
			lengthNorm: BM25_B,
			averageLength: 4
		}
		expect(lexicalSignal(padded, idf, window, 4, opts)).toBeLessThan(
			lexicalSignal(precise, idf, window, 4, opts)
		)
		// And the reading it replaces cannot tell them apart at all — the
		// padding contributes nothing and nothing subtracts for it, so the two
		// tie and their order falls through to whatever the sort does next.
		expect(lexicalSignal(padded, idf, window, 4, LEXICAL_OVERLAP)).toBe(
			lexicalSignal(precise, idf, window, 4, LEXICAL_OVERLAP)
		)
	})

	it("a longer entry can still win by actually saying more of it", () => {
		// The other half of the claim, and the reason this is a *balance*
		// rather than a penalty on length: an entry that names two of the
		// conversation's terms beats one that names a single term once,
		// whatever their lengths.
		const one = lexicalDocument({ title: "", keys: "ashguard" }, 1)
		const two = lexicalDocument(
			{ title: "", keys: "ashguard riders lantern feast" },
			1
		)
		const opts = {
			titleWeight: 1,
			saturation: BM25_K1,
			lengthNorm: BM25_B,
			averageLength: 3
		}
		expect(lexicalSignal(two, idf, window, 4, opts)).toBeGreaterThan(
			lexicalSignal(one, idf, window, 4, opts)
		)
	})

	it("weights a title term above the same term among the keys", () => {
		const titled = lexicalDocument({ title: "ashguard", keys: "riders" }, 3)
		const keyed = lexicalDocument({ title: "riders", keys: "ashguard" }, 3)
		const opts = { ...LEXICAL_OVERLAP, titleWeight: 3 }
		// Same two terms, opposite fields, and only the weighting separates
		// them — so with a rarer idf on `ashguard` the titled one wins.
		const rarer = new Map([
			["ashguard", 3],
			["riders", 1]
		])
		expect(lexicalSignal(titled, rarer, window, 4, opts)).toBeGreaterThan(
			lexicalSignal(keyed, rarer, window, 4, opts)
		)
	})

	it("a neutral title weight is the concatenation it replaces", () => {
		// Splitting `keys + " " + title` at a space cannot merge or split a
		// token, so the two halves summed at weight 1 are the whole summed —
		// which is why 1 is neutral rather than off.
		const split = lexicalDocument({ title: "riders", keys: "ashguard" }, 1)
		expect(
			lexicalSignal(split, idf, window, 4, LEXICAL_OVERLAP)
		).toBeCloseTo(tfidfSignal("ashguard riders", idf, window, 4), 12)
	})

	it("isDefaultLexical names exactly the shipped reading", () => {
		expect(isDefaultLexical(LEXICAL_OVERLAP)).toBe(true)
		expect(isDefaultLexical({ ...LEXICAL_OVERLAP, titleWeight: 2 })).toBe(
			false
		)
		expect(
			isDefaultLexical({ ...LEXICAL_OVERLAP, saturation: BM25_K1 })
		).toBe(false)
	})
})

describe("BM25 scores with BM25's idf, over the pool being searched", () => {
	/**
	 * The collection, one string per entry.
	 *
	 * Named rather than inlined because it is the claim: `msgs` above is a
	 * *conversation*, this is the **lorebook**, and every number below is a
	 * count of entries.
	 */
	const pool = (...documents: string[]) => documents

	/**
	 * The formula, asserted directly rather than through an ordering.
	 *
	 * Directly, because the whole point of the change is that this *is* the
	 * literature's form — an ordering assertion would pass for a family of
	 * curves and this is a claim about one of them.
	 */
	it("is log((N - df + 0.5) / (df + 0.5) + 1) per term", () => {
		// Three entries; `sword` is in two of them and `shield` in one.
		const idf = buildBm25Idf(pool("sword sword", "sword", "shield"))
		expect(idf.get("sword")).toBeCloseTo(Math.log(1.5 / 2.5 + 1), 10)
		expect(idf.get("shield")).toBeCloseTo(Math.log(2.5 / 1.5 + 1), 10)
	})

	/**
	 * ⚠ **The collection is the entries, and it is not the same number.**
	 *
	 * A word can be in every message and in one entry — "sword" in a fight is
	 * the ordinary case, not a contrived one. Over messages that makes it the
	 * commonest thing in the room and worth almost nothing; over the collection
	 * being searched it is what tells one entry from every other, which is the
	 * question the ranker is actually asking.
	 *
	 * This is the assertion that fails if the collection is quietly moved back
	 * to messages, and it is the only kind that can: every ordering the two
	 * readings produce is reachable from both, because the idf of a term shared
	 * by two entries scales both their scores and cancels.
	 */
	it("counts entries, not messages", () => {
		const said = ["the sword", "the sword", "the sword"]
		const overMessages = buildBm25Idf(said)
		const overPool = buildBm25Idf(pool("sword", "shield", "lantern", "hedge"))

		expect(overMessages.get("sword")).toBeCloseTo(Math.log(0.5 / 3.5 + 1), 10)
		expect(overPool.get("sword")).toBeCloseTo(Math.log(3.5 / 1.5 + 1), 10)
		expect(overPool.get("sword")!).toBeGreaterThan(
			8 * overMessages.get("sword")!
		)
	})

	/**
	 * ⚠ The divergence between the two *forms*, at the place they are furthest
	 * apart, with the collection held still so only the form moves.
	 *
	 * `df = N` is where `buildIdf` needs its floor and where the floor then
	 * pins it to exactly zero — a term in every document of a small collection
	 * is the ordinary case and not an edge one: "the" is in every message of a
	 * short session, and here `company` is in every entry of a pool of guilds.
	 * BM25's form crosses no zero to be floored at: a word everybody uses is
	 * worth *little*, which is not the same claim as worth *nothing*, and the
	 * difference is the only thing separating two entries whose shared
	 * vocabulary is all common.
	 */
	it("keeps a term in every document worth a little, where tf-idf floors it flat", () => {
		const documents = pool(
			"company sword",
			"company shield",
			"company horse"
		)
		const bm25 = buildBm25Idf(documents)
		// The same three documents, read by the other form. `buildIdf` takes
		// message rows because messages are its collection; here it is being
		// asked the same question about the same texts, which is what makes
		// this a comparison of forms rather than of collections.
		const plain = buildIdf(documents.map((content) => ({ content })))

		expect(plain.get("company")).toBe(0)
		expect(bm25.get("company")).toBeCloseTo(Math.log(0.5 / 3.5 + 1), 10)
		expect(bm25.get("company")!).toBeGreaterThan(0)

		// And it is still worth a small fraction of a term in one document —
		// the ordering the two forms agree on, which is why the old wiring
		// worked at all and why this was debt rather than a live defect.
		expect(bm25.get("company")!).toBeLessThan(bm25.get("sword")! / 5)
	})

	/**
	 * ⚠ **Non-negative by construction, so no floor is wanted here.** The `+ 1`
	 * inside the log puts the argument at or above 1 for every `df <= N`, and
	 * strictly above it for every `df` a term can actually have. A
	 * `Math.max(0, ...)` added later would be dead code that reads live.
	 */
	it("is strictly positive at every document frequency, with no floor", () => {
		for (const n of [1, 2, 3, 5, 12]) {
			const documents = Array.from({ length: n }, (_, i) =>
				["ubiquitous", ...(i === 0 ? ["singular"] : [])].join(" ")
			)
			for (const weight of buildBm25Idf(documents).values())
				expect(weight).toBeGreaterThan(0)
		}
	})

	/**
	 * The pairing `lexicalSignal` documents, checked at the arithmetic rather
	 * than at the wiring: hand the saturated reading a map and the map is what
	 * decides the number, so handing it the wrong one is silent.
	 *
	 * Both halves of the pairing are here. The window says "the" three times,
	 * so tf-idf's map — messages, floored — makes the entry keyed on it worth
	 * exactly nothing; BM25's map over the **pool** makes it worth a great deal,
	 * because one entry in three is keyed that way and that is what the ranker
	 * is being asked.
	 */
	it("changes what the saturated reading scores", () => {
		const conversation = msgs("the sword", "the shield", "the horse")
		const doc = lexicalDocument({ title: "", keys: "the" }, 1)
		const window = buildTermFreq("the sword the shield the horse")
		const opts = {
			titleWeight: 1,
			saturation: BM25_K1,
			lengthNorm: BM25_B,
			averageLength: 1
		}

		// Under tf-idf's idf the entry is worth exactly nothing, so it ties
		// with every entry that matched nothing at all.
		expect(
			lexicalSignal(doc, buildIdf(conversation), window, 3, opts)
		).toBe(0)
		expect(
			lexicalSignal(
				doc,
				buildBm25Idf(["the", "sword", "shield"]),
				window,
				3,
				opts
			)
		).toBeGreaterThan(0)
	})
})

describe("trigram folding", () => {
	const win = (text: string) => ({ raw: text, lower: text.toLowerCase() })
	const folding = (text: string, strength = 1) => ({
		windowTrigrams: trigramsOf(text.toLowerCase()),
		strength
	})

	it("catches the inflection substring cannot", () => {
		// Substring gets `rider` inside `riders` for free and the reverse not
		// at all, which is the asymmetry folding removes.
		const w = win("the rider rode north")
		expect(keywordSignal({ keys: "riders" }, w)).toBe(0)
		expect(
			keywordSignal(
				{ keys: "riders" },
				w,
				folding("the rider rode north")
			)
		).toBeGreaterThan(0)
	})

	it("catches an error near a word's edge, and refuses a rhyme", () => {
		const clipped = win("the Ashguar rode north")
		expect(keywordSignal({ keys: "ashguard" }, clipped)).toBe(0)
		expect(
			keywordSignal(
				{ keys: "ashguard" },
				clipped,
				folding("the Ashguar rode north")
			)
		).toBeGreaterThan(0)

		// ⚠ The calibration, asserted rather than described: `wagon` shares
		// half of `dragon`'s trigrams, and half is what a mid-word typo also
		// leaves — so the threshold that catches the typo admits the rhyme.
		// Precision wins; see `TRIGRAM_MIN_COVERAGE`.
		const rhyme = win("she loaded the wagon")
		expect(
			keywordSignal(
				{ keys: "dragon" },
				rhyme,
				folding("she loaded the wagon")
			)
		).toBe(0)
		const transposed = win("the Ashgaurd rode north")
		expect(
			keywordSignal(
				{ keys: "ashguard" },
				transposed,
				folding("the Ashgaurd rode north")
			)
		).toBe(0)
	})

	it("says nothing about a key too short to have a partial answer", () => {
		// `elf` is one trigram, so coverage is 0 or 1 and a threshold has no
		// resolution — it would fuzzy-match `self` at full strength.
		const w = win("she kept it to herself")
		expect(
			keywordSignal(
				{ keys: "elf", matchMode: "word" },
				w,
				folding("she kept it to herself")
			)
		).toBe(0)
	})

	it("works where word boundaries do not exist at all", () => {
		// No spaces, so `tokenize` yields nothing and `word` mode has no
		// boundary to assert against — the case design phase 1 says trigrams
		// are the only thing that works for.
		const w = win("私は灰の衛兵を見た")
		expect(tokenize(w.lower)).toEqual([])
		expect(keywordSignal({ keys: "灰の衛兵", matchMode: "word" }, w)).toBe(
			0
		)
		expect(
			keywordSignal(
				{ keys: "灰の衛兵", matchMode: "word" },
				w,
				folding("私は灰の衛兵を見た")
			)
		).toBeGreaterThan(0)
	})

	it("only ever adds — an exact hit is 1 whatever the strength", () => {
		const w = win("the ashguard rode north")
		for (const strength of [0.1, 0.5, 1])
			expect(
				keywordSignal(
					{ keys: "ashguard" },
					w,
					folding("the ashguard rode north", strength)
				)
			).toBe(1)
	})

	it("a fuzzy hit is worth less than an exact one", () => {
		const w = win("the rider rode north")
		const half = keywordSignal(
			{ keys: "riders" },
			w,
			folding("the rider rode north", 0.5)
		)
		const full = keywordSignal(
			{ keys: "riders" },
			w,
			folding("the rider rode north", 1)
		)
		expect(half).toBeCloseTo(full / 2, 10)
		expect(full).toBeLessThan(1)
	})

	it("ignores an unrelated word rather than half-matching everything", () => {
		const w = win("the feast of lanterns is midwinter")
		expect(
			keywordSignal(
				{ keys: "ashguard" },
				w,
				folding("the feast of lanterns is midwinter")
			)
		).toBe(0)
	})

	it("leaves a regex key alone, because a pattern is not text", () => {
		const w = win("the ashgaurd rode")
		expect(
			keywordSignal(
				{ keys: "\\b(ash|em)ber\\b", matchMode: "regex" },
				w,
				folding("the ashgaurd rode")
			)
		).toBe(0)
	})

	it("coverage is one-sided, so a long window does not dilute a key", () => {
		const long = "x".repeat(5000) + " ashguard " + "y".repeat(5000)
		expect(trigramCoverage("ashguard", trigramsOf(long))).toBe(1)
	})

	it("normalises whitespace, so a key survives a line break", () => {
		expect(
			trigramCoverage(
				"the ashguard",
				trigramsOf("saw the\n  ashguard go")
			)
		).toBe(1)
	})
})

describe("proximity", () => {
	const win = (text: string) => ({ raw: text, lower: text.toLowerCase() })

	it("is higher for keys that matched close together", () => {
		const near = keywordMatch(
			{ keys: "ashguard, riders" },
			win("the ashguard riders rode north")
		)
		const far = keywordMatch(
			{ keys: "ashguard, riders" },
			win(`the ashguard rode north. ${"filler words ".repeat(20)} riders`)
		)
		expect(near.proximity).toBeGreaterThan(far.proximity)
		expect(near.proximity).toBeLessThanOrEqual(1)
		expect(far.proximity).toBeGreaterThanOrEqual(0)
	})

	it("is zero when only one key matched, because distance needs two", () => {
		const one = keywordMatch(
			{ keys: "ashguard, riders" },
			win("the ashguard rode north")
		)
		expect(one.signal).toBe(0.5)
		expect(one.proximity).toBe(0)
	})

	it("does not change the keyword fraction it rides along with", () => {
		for (const text of [
			"the ashguard riders rode",
			"ashguard alone",
			"nothing here"
		]) {
			const m = keywordMatch({ keys: "ashguard, riders" }, win(text))
			expect(m.signal).toBe(
				keywordSignal({ keys: "ashguard, riders" }, win(text))
			)
		}
	})

	it("measures exact hits only — a fuzzy match has no offset", () => {
		const w = win("the ashguard rode. the rider followed")
		const m = keywordMatch({ keys: "ashguard, riders" }, w, {
			windowTrigrams: trigramsOf(w.lower),
			strength: 1
		})
		expect(m.signal).toBeGreaterThan(0.5)
		expect(m.proximity).toBe(0)
	})
})

describe("selective logic", () => {
	const win = (text: string) => ({ raw: text, lower: text.toLowerCase() })

	it("is inert without both a mode and condition keys", () => {
		const w = win("a statue of a dragon")
		expect(selectiveLogicHolds({ keys: "dragon" }, w)).toBe(true)
		expect(
			selectiveLogicHolds({ keys: "dragon", selectiveLogic: "notAny" }, w)
		).toBe(true)
		expect(
			selectiveLogicHolds({ keys: "dragon", secondaryKeys: "statue" }, w)
		).toBe(true)
		// An unrecognised mode from a build that declared a fifth one is the
		// same as no mode — it must not silently mean one of the four.
		expect(
			selectiveLogicHolds(
				{ secondaryKeys: "statue", selectiveLogic: "xorSome" },
				w
			)
		).toBe(true)
	})

	it("reads all four modes the way SillyTavern's do", () => {
		const both = win("a statue beside a mural")
		const one = win("a statue alone")
		const neither = win("an empty plinth")
		const of = (mode: string, w: ReturnType<typeof win>) =>
			selectiveLogicHolds(
				{ secondaryKeys: "statue, mural", selectiveLogic: mode },
				w
			)

		expect([
			of("andAny", both),
			of("andAny", one),
			of("andAny", neither)
		]).toEqual([true, true, false])
		expect([
			of("andAll", both),
			of("andAll", one),
			of("andAll", neither)
		]).toEqual([true, false, false])
		expect([
			of("notAny", both),
			of("notAny", one),
			of("notAny", neither)
		]).toEqual([false, false, true])
		expect([
			of("notAll", both),
			of("notAll", one),
			of("notAll", neither)
		]).toEqual([false, true, true])
	})

	it("honours the entry's own match mode for its condition keys", () => {
		// One rule for what a key is, not two: `word` on the entry applies to
		// both lists, so `elf` does not fire on `self` in either.
		expect(
			selectiveLogicHolds(
				{
					secondaryKeys: "elf",
					selectiveLogic: "notAny",
					matchMode: "word"
				},
				win("she kept it to herself")
			)
		).toBe(true)
		expect(
			selectiveLogicHolds(
				{ secondaryKeys: "elf", selectiveLogic: "notAny" },
				win("she kept it to herself")
			)
		).toBe(false)
	})

	it("maps SillyTavern's integers, including the pair nobody guesses", () => {
		// ST's enum is AND_ANY=0, NOT_ALL=1, NOT_ANY=2, AND_ALL=3. An importer
		// indexing a four-element array in the obvious order inverts every book
		// that used 1 or 3.
		expect(SELECTIVE_LOGIC_BY_ST_CODE[0]).toBe("andAny")
		expect(SELECTIVE_LOGIC_BY_ST_CODE[1]).toBe("notAll")
		expect(SELECTIVE_LOGIC_BY_ST_CODE[2]).toBe("notAny")
		expect(SELECTIVE_LOGIC_BY_ST_CODE[3]).toBe("andAll")
		expect(Object.values(SELECTIVE_LOGIC_BY_ST_CODE).sort()).toEqual(
			[...SELECTIVE_LOGIC].sort()
		)
	})
})
