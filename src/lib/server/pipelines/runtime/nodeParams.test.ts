/**
 * A **binding's** parameters reaching the code that reads them.
 *
 * ⚠ This exists because they did not. `loreFor` called
 * `withDefaults(input.params)` with the flat `{scanDepth}` a node declares,
 * while `withDefaults` looks for `partial.retrieval.scanDepth` — so the number
 * was handed over and then looked for somewhere it had never been put.
 * `retrievalParamsFrom` is the seam that fixed it, and these are the
 * start-at-the-arguments, end-at-the-selection assertions that keep it honest.
 *
 * ## What this file cannot see, and what does
 *
 * Every case here calls `coreBindings()[...]` and passes `params` in by hand.
 * That starts one layer BELOW where a real run starts: whether the node's
 * parameters reach the binding at all is decided by the executor, which
 * resolves only the slots a node's config already names. This file's header
 * once claimed to cover "the node's parameters", and on that claim the three
 * lore lanes shipped for eight spec versions with no `params: slot.params()`
 * wiring — the binding was handed `undefined` on every real turn, and every
 * assertion below stayed green, because they were never asking.
 *
 * `loreScanDepth.int.test.ts` asks. It starts at a stored config row, runs the
 * shipped spec through the executor, and reads what the scan reports. Keep both:
 * this one says the binding reads what it is given, that one says a run gives
 * it anything at all, and only the pair covers the distance.
 */

import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { roughTokens } from "@serene-pub/sdk"

const messages = [
	{ id: 1, content: "the ashguard rode north" },
	{ id: 2, content: "rain, all week" },
	{ id: 3, content: "nothing much happened" }
]

const entries = [
	{
		id: 1,
		lorebookId: 1,
		name: "The Ashguard",
		keys: "ashguard",
		content: "An order of oathbound riders, led by Commander Vell.",
		enabled: true
	},
	{
		id: 2,
		lorebookId: 1,
		name: "Vell",
		keys: "vell",
		content: "A commander who never removes her helm.",
		enabled: true
	}
]

const ctx = {
	// The executor endows this on every binding context, and a lore query
	// counts each candidate with it — a stub without it is not a stand-in for
	// what a run supplies, it is a different object that happens to have `read`.
	countTokens: roughTokens,
	read: async (what: string) =>
		what === "lorebook_entries"
			? entries.map((e) => ({ ...e, source: "worldLore" }))
			: what === "session_messages"
				? messages
				: { available: false, reason: "no embedding model is loaded" }
}

const worldLore = (params: Record<string, unknown>) =>
	coreBindings()["core:query/world-lore@1"]!(
		{ scope: { sessionId: 1 }, params },
		ctx as any
	) as Promise<any>

describe("the lore binding reads the parameters it is handed", () => {
	it("scanDepth narrows the window", async () => {
		const deep = await worldLore({ scanDepth: 10 })
		const shallow = await worldLore({ scanDepth: 1 })

		expect(deep.value.diagnostics.scanDepth).toBe(10)
		expect(shallow.value.diagnostics.scanDepth).toBe(1)
		// The one that only read the last message cannot have seen "ashguard".
		expect(deep.value.hits.map((c: any) => c.id)).toEqual([1])
		expect(shallow.value.hits).toEqual([])
	})

	it("maxRecursionDepth turns recursion on", async () => {
		const off = await worldLore({ scanDepth: 10 })
		const on = await worldLore({ scanDepth: 10, maxRecursionDepth: 1 })

		expect(off.value.hits.map((c: any) => c.id)).toEqual([1])
		expect(on.value.hits.map((c: any) => c.id).sort()).toEqual([1, 2])
	})

	/**
	 * ⚠ **A test stood here and is deleted, in two halves and two migrations.**
	 *
	 * It tested `retrievalMode` — that a node set to `keyword` excluded an
	 * undecided entry from the vector mechanism, and that an entry stating its own
	 * strategy beat the node's default. Migration 0203 culled the node mode and
	 * the first half went with it as vacuous; the second half survived on the
	 * argument that the per-entry column was a real author decision.
	 *
	 * It was not. There was no editor control for `retrieval_strategy` in any
	 * build, so every row held NULL, and the exclusion it bought — a `keyword`
	 * entry kept out of the vector mechanism with a model loaded and a cosine of 1 —
	 * is the shape the plan's second governing rule forbids. Migration 0204
	 * dropped the column, and the remaining half is as vacuous as the first: a
	 * node cannot route, and now neither can a row.
	 *
	 * This file is about **params reaching the thing that reads them**, so the
	 * absence of a param is not something it can assert. The mechanism's own
	 * behaviour after the removal is asserted where it can be observed —
	 * `runtime/vector.int.test.ts` covers both what it surfaces and the one
	 * exclusion it may still make.
	 */
})

/**
 * The signal-weight matrix reaching the scorer (migration 0146).
 *
 * The descriptor declares it transposed — nine `perMember` fields, one control
 * row per signal — while `withDefaults` demands one complete set per source,
 * with no deep merge. `signalsFrom` in `bindings.ts` is the seam that
 * transposes back and constructs the completeness, and this is the
 * start-at-the-params, end-at-the-selection assertion that catches it dying
 * the way `scanDepth` once did.
 */
describe("the ranker's signal weights reach the scorer", () => {
	const rank = (params: Record<string, unknown>) =>
		coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					// A scores 0.35 under the defaults (keyword, worldLore);
					// B scores 0 — density does not apply to lore today.
					{
						id: "A",
						source: "worldLore",
						tokens: 100,
						signals: { keyword: 1 }
					},
					{
						id: "B",
						source: "worldLore",
						tokens: 100,
						signals: { density: 1 }
					}
				],
				// Room for exactly one, so the order is observable as survival.
				budget: { remaining: 100 },
				params
			},
			{} as any
		) as Promise<any>

	it("a raised weight changes who survives the budget", async () => {
		const byDefault = await rank({})
		expect(byDefault.value.candidates.map((c: any) => c.id)).toEqual(["A"])

		const densityHeavy = await rank({
			signalDensity: {
				messages: 0.1,
				worldLore: 2,
				characterLore: 0,
				history: 0,
				relationships: 0
			}
		})
		expect(densityHeavy.value.candidates.map((c: any) => c.id)).toEqual([
			"B"
		])
	})

	it("an untouched signal keeps its default rather than zeroing", async () => {
		// Only `signalDensity` is named. If the transposition replaced the
		// whole per-source set, `keyword` would silently become 0 and B (0.2)
		// would beat A — the exact "I set one weight and everything else
		// stopped working" failure the per-field fallback exists to prevent.
		const partial = await rank({
			signalDensity: {
				messages: 0.1,
				worldLore: 0.2,
				characterLore: 0,
				history: 0,
				relationships: 0
			}
		})
		expect(partial.value.candidates.map((c: any) => c.id)).toEqual(["A"])
	})

	it("the declared defaults are the shipped constants", async () => {
		// The descriptor's transposed defaults, exactly as `contracts`
		// declares them. Handing them over must select identically to handing
		// nothing — which is what makes declaring the matrix
		// behaviour-preserving for every untouched spec.
		const declaredDefaults = {
			signalKeyword: {
				messages: 0,
				worldLore: 0.35,
				characterLore: 0.35,
				history: 0.35,
				relationships: 0
			},
			signalNameMatch: {
				messages: 0,
				worldLore: 0.25,
				characterLore: 0.25,
				history: 0,
				relationships: 0
			},
			signalEntityCooccurrence: {
				messages: 0,
				// 0.35, not 0.2 — world lore's entity signal is the graded
				// overlap now and the weight was sized for it in the same
				// change (design §13.10). Character lore's question did not
				// move, so neither did its weight.
				worldLore: 0.35,
				characterLore: 0.2,
				history: 0,
				relationships: 0
			},
			signalSemantic: {
				messages: 0,
				worldLore: 0.3,
				characterLore: 0.3,
				history: 0.3,
				relationships: 0
			},
			signalTfidf: {
				messages: 0.1,
				worldLore: 0.1,
				characterLore: 0.1,
				history: 0.1,
				relationships: 0
			},
			signalLastRefRecency: {
				messages: 0,
				worldLore: 0.1,
				characterLore: 0.1,
				history: 0.1,
				relationships: 0
			},
			// ⚠ `signalRecency` and `signalSceneAffinity` were declared here
			// with non-zero defaults on two bands and are gone: no mechanism
			// has ever written either signal, so both weights multiplied a
			// permanent zero. Their producers are a design decision rather than
			// a wiring job — see the contracts file.
			signalDensity: {
				messages: 0.1,
				worldLore: 0,
				characterLore: 0,
				history: 0,
				relationships: 0
			},
			signalPriorityBonus: {
				messages: 0,
				worldLore: 0.15,
				characterLore: 0.15,
				history: 0,
				relationships: 0
			}
		}
		const declared = await rank(declaredDefaults)
		const untouched = await rank({})
		expect(
			declared.value.decisions.map((d: any) => [d.candidate.id, d.score])
		).toEqual(
			untouched.value.decisions.map((d: any) => [d.candidate.id, d.score])
		)
	})

	/**
	 * The eleventh weight, and the one that is deliberately **not** zero.
	 *
	 * `signalProximity` ships at 0 because its number is computed on every scan
	 * and only the weight decides whether it counts. `signalSemantic` is the
	 * other case: nothing produces the number until the semantic mechanism is turned
	 * on, so the mechanism's own cap is the switch and zeroing the weight as well
	 * would make raising that cap appear to do nothing.
	 */
	it("signalSemantic scores the cosine the semantic mechanism attaches", async () => {
		const withSignal = coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					{
						id: "keyed",
						source: "worldLore",
						tokens: 100,
						signals: { keyword: 1 }
					},
					{
						id: "meaning",
						source: "worldLore",
						tokens: 100,
						signals: { semantic: 1 }
					}
				],
				budget: { remaining: 100 },
				params: {}
			},
			{} as any
		) as Promise<any>
		// 0.35 keyword against 0.3 semantic: the keyed entry wins on the
		// shipped weights, which is "keys still guarantee, meaning only adds".
		expect(
			(await withSignal).value.candidates.map((c: any) => c.id)
		).toEqual(["keyed"])

		const semanticHeavy = coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					{
						id: "keyed",
						source: "worldLore",
						tokens: 100,
						signals: { keyword: 1 }
					},
					{
						id: "meaning",
						source: "worldLore",
						tokens: 100,
						signals: { semantic: 1 }
					}
				],
				budget: { remaining: 100 },
				params: {
					signalSemantic: {
						messages: 0,
						worldLore: 0.9,
						characterLore: 0.3,
						history: 0.3,
						relationships: 0
					}
				}
			},
			{} as any
		) as Promise<any>
		expect(
			(await semanticHeavy).value.candidates.map((c: any) => c.id)
		).toEqual(["meaning"])
	})
})

/**
 * The three grouped mechanism strengths reaching the scorer (migration 0201).
 *
 * They multiply the signals of the mechanism that produced them and leave the
 * five structural signals alone, so a reader can say "stop guessing" or "keys
 * only" without knowing which four of the eleven weights that means. **1 is
 * neutral**, so an untouched install scores exactly what it scored before, which
 * is what makes the declaration behaviour-preserving.
 */
describe("the mechanism weights reach the scorer", () => {
	const rank = (params: Record<string, unknown>) =>
		coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					// Found by keys alone: 0.35 under the shipped weights.
					{
						id: "byKeyword",
						source: "worldLore",
						tokens: 100,
						signals: { keyword: 1 }
					},
					// Found by name alone: 0.25 nameMatch — lower, so keyword
					// wins until somebody says the mechanisms count differently.
					{
						id: "byName",
						source: "worldLore",
						tokens: 100,
						signals: { nameMatch: 1 }
					}
				],
				budget: { remaining: 100 },
				params
			},
			{} as any
		) as Promise<any>

	it("all three at 1 is the run that happens with nothing set", async () => {
		const untouched = await rank({})
		const neutral = await rank({
			mechanismWeights: { keyword: 1, semantic: 1, name: 1 }
		})
		expect(
			neutral.value.decisions.map((d: any) => [d.candidate.id, d.score])
		).toEqual(
			untouched.value.decisions.map((d: any) => [d.candidate.id, d.score])
		)
		expect(untouched.value.candidates.map((c: any) => c.id)).toEqual([
			"byKeyword"
		])
	})

	it("turning keyword down hands the turn to the other mechanism", async () => {
		const quieter = await rank({
			mechanismWeights: { keyword: 0.5, semantic: 1, name: 1 }
		})
		// 0.35 x 0.5 = 0.175 against nameMatch's untouched 0.25.
		expect(quieter.value.candidates.map((c: any) => c.id)).toEqual([
			"byName"
		])
	})

	it("zero switches a whole mechanism off, which is what `keys only` means", async () => {
		const keysOnly = await rank({
			mechanismWeights: { keyword: 1, semantic: 0, name: 0 }
		})
		const decisions = new Map<string, number>(
			keysOnly.value.decisions.map((d: any) => [d.candidate.id, d.score])
		)
		expect(decisions.get("byName")).toBe(0)
		expect(decisions.get("byKeyword")).toBeGreaterThan(0)
	})

	it("does not scale the structural signals", async () => {
		// Length is not a way of *finding* an entry, so an entry does not get
		// shorter because a reader turned keyword matching down.
		//
		// ⚠ This used `signals: { recency: 1 }` on the messages band, which
		// asserted the rule against a signal no mechanism produced — the
		// arithmetic was real and the candidate could not be. `density` is the
		// structural signal that is produced now (`keywordQuery` writes it on
		// every candidate), so the same rule is asserted against something a
		// run can actually carry.
		const rankStructural = (mechanismWeights: Record<string, number>) =>
			coreBindings()["core:task/rank-hybrid@1"]!(
				{
					candidates: [
						{
							id: "m",
							source: "messages",
							tokens: 100,
							signals: { density: 1 }
						}
					],
					budget: { remaining: 1000 },
					params: { mechanismWeights }
				},
				{} as any
			) as Promise<any>

		const full = await rankStructural({ keyword: 1, semantic: 1, name: 1 })
		const off = await rankStructural({ keyword: 0, semantic: 0, name: 0 })
		expect(off.value.decisions[0].score).toBe(full.value.decisions[0].score)
		expect(off.value.decisions[0].score).toBeGreaterThan(0)
	})

	it("a missing member is neutral rather than zero", async () => {
		// The value is JSON off a row. Reading an absent member as `undefined`
		// would multiply the score into `NaN` and silently zero every
		// candidate; reading it as 0 would switch a mechanism off nobody
		// touched. `mechanismsFrom` merges over the defaults, so it is neither.
		const partial = await rank({ mechanismWeights: { semantic: 0 } })
		const untouched = await rank({})
		expect(
			partial.value.decisions.map((d: any) => [d.candidate.id, d.score])
		).toEqual(
			untouched.value.decisions.map((d: any) => [d.candidate.id, d.score])
		)
	})

	it("clamps a negative strength, so a mechanism can never subtract", async () => {
		// The plan's second governing rule, in arithmetic: adding a mechanism
		// may only add matches.
		const negative = await rank({
			mechanismWeights: { keyword: -2, semantic: 1, name: 1 }
		})
		for (const d of negative.value.decisions)
			expect(d.score).toBeGreaterThanOrEqual(0)
	})
})

/**
 * Ruling R6 — lore has no floor, and it cannot be given one.
 *
 * `minEntries` was a number per band over the same five sources as `share` and
 * `maxEntries`. It is `messages` only now: a floor is a promise to spend budget
 * on a source *whether or not it scored*, which is the opposite of what a ranker
 * is for, and it is the one mechanism that could quietly re-admit a candidate an
 * exclusion had removed.
 *
 * `select` still honours the whole map — that is what keeps the guard in
 * `select.test.ts` constructible, and the guard is the point — so the removal
 * lives at this seam, where a stored value meets the ranker.
 */
describe("lore floors cannot be set through the node (R6)", () => {
	const rank = (minEntries: Record<string, number>) =>
		coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					// Scores nothing at all, so only a floor could keep it.
					{
						id: "w_unscored",
						source: "worldLore",
						tokens: 100,
						signals: {}
					},
					// `density`, not `recency`: the messages band's structural
					// signal that something actually produces. See the
					// mechanism-strength suite above.
					{
						id: "m_scored",
						source: "messages",
						tokens: 100,
						signals: { density: 1 }
					}
				],
				// Room for one, so "kept" is observable as survival.
				budget: { remaining: 100 },
				params: { minEntries }
			},
			{} as any
		) as Promise<any>

	it("ignores a lore floor a stored value still carries", async () => {
		// The shape an upgraded install holds until 0201's UPDATE runs — and
		// after it, the shape a hand-edited row could still contain. The
		// removal must not depend on a migration having happened.
		const stale = await rank({
			messages: 0,
			worldLore: 5,
			characterLore: 5,
			history: 5,
			relationships: 5
		})
		expect(
			stale.value.candidates.map((c: any) => c.id),
			"a lore floor survived and reserved an entry the ranker did not want"
		).toEqual(["m_scored"])
		expect(
			stale.value.decisions.find(
				(d: any) => d.candidate.id === "w_unscored"
			).reason
		).not.toBe("reserved_minimum")
	})

	it("still honours the conversation's floor, which R6 keeps", async () => {
		const withFloor = await rank({ messages: 1 })
		const kept = withFloor.value.decisions.find(
			(d: any) => d.candidate.id === "m_scored"
		)
		expect(kept.reason).toBe("reserved_minimum")
	})
})

/**
 * The allocation precedence reaching `select` (migration 0196).
 *
 * ⚠ `SelectOptions.scoreLedAllocation` was built and tested with **no runtime
 * caller at all** — this node is the only runtime `select()` there is, and it
 * passed `availableTokens` and `params` alone. `scoreLedFrom` in `bindings.ts`
 * is the seam that fixed it, and this is the start-at-the-params,
 * end-at-the-selection assertion that catches it dying the way `scanDepth` once
 * did. `scoreLedAllocation.int.test.ts` covers the distance this file cannot:
 * whether the parameter reaches the binding at all on a real run.
 */
describe("the ranker's allocation precedence reaches the selection", () => {
	/**
	 * One relevant world-lore entry against two idle messages, sized so the
	 * two precedences disagree — `select.test.ts`'s own `oneRelevantSource`
	 * fixture, which is what makes the two files' claims comparable.
	 *
	 * Share-first hands messages half the window, the idle pair fills it
	 * because nothing in their band outbids them, and the entry that scored is
	 * then too big for what is left.
	 */
	const rank = (params: Record<string, unknown>) =>
		coreBindings()["core:task/rank-hybrid@1"]!(
			{
				candidates: [
					{
						id: "w_relevant",
						source: "worldLore",
						tokens: 600,
						signals: { keyword: 1 }
					},
					{
						id: "m_idle1",
						source: "messages",
						tokens: 250,
						signals: { recency: 0.1 }
					},
					{
						id: "m_idle2",
						source: "messages",
						tokens: 250,
						signals: { recency: 0.05 }
					}
				],
				budget: { remaining: 1000 },
				params: {
					// The floors are switched off, through the declared
					// address rather than around it. `minEntries.messages` is
					// 6 by default and would reserve both idle messages before
					// either precedence had anything to allocate — which is a
					// promise that holds *identically* in both modes, so
					// leaving it on would prove the flag does nothing by
					// testing the one thing it was designed not to touch.
					minEntries: {
						messages: 0,
						worldLore: 0,
						characterLore: 0,
						history: 0,
						relationships: 0
					},
					...params
				}
			},
			{} as any
		) as Promise<any>

	it("selects share-first when nothing says otherwise", async () => {
		// The shipped path, and the reason the parity corpus is untouched by
		// the declaration: omitting the parameter has to be the same run as
		// storing its declared default.
		const omitted = await rank({})
		const declaredDefault = await rank({ scoreLedAllocation: false })
		expect(omitted.value.candidates.map((c: any) => c.id)).toEqual([
			"m_idle1",
			"m_idle2"
		])
		expect(declaredDefault.value.candidates.map((c: any) => c.id)).toEqual(
			omitted.value.candidates.map((c: any) => c.id)
		)
	})

	it("inverts the precedence when the parameter says so", async () => {
		const scoreLed = await rank({ scoreLedAllocation: true })
		expect(scoreLed.value.candidates.map((c: any) => c.id).sort()).toEqual([
			"m_idle1",
			"w_relevant"
		])
		// The reason share-first cannot produce, so its presence is the proof
		// that the other branch ran rather than a coincidence of sizes.
		expect(scoreLed.value.decisions.map((d: any) => d.reason)).toContain(
			"excluded_token_limit"
		)
		expect(
			scoreLed.value.decisions.find(
				(d: any) => d.candidate.id === "m_idle2"
			).why
		).toMatch(/across every source/)
	})

	it("takes a real true and nothing else", async () => {
		// A config value is JSON off a row, and every truthy reading of
		// `"false"` or `0` turns the inversion on — the one direction a
		// misread must not go for a control that ships off.
		for (const value of ["true", 1, "false", 0, null])
			expect(
				(
					await rank({ scoreLedAllocation: value })
				).value.candidates.map((c: any) => c.id),
				`\`${JSON.stringify(value)}\` was read as an answer`
			).toEqual(["m_idle1", "m_idle2"])
	})
})
