/**
 * The keyword mechanism.
 *
 * The assertions to read are the ones about `skipped`. A retrieval stage that
 * returns only its hits cannot distinguish "nothing matched" from "your entry
 * is disabled" from "its condition said not here" — different user problems
 * with different fixes, and without a receipt all of them present identically
 * as missing lore.
 */

import { afterEach, describe, it, expect } from "vitest"
import {
	MAX_RECURSION_DEPTH,
	keywordQuery,
	normaliseTfidf,
	type LoreRow
} from "$lib/server/pipelines/ranking/keywordQuery"
import { DEFAULT_RETRIEVAL } from "$lib/server/pipelines/ranking/weights"
import {
	PATTERN_SCAN_BUDGET_MS,
	PATTERN_TIME_BOUND_MS,
	forgetPatternCosts
} from "$lib/server/pipelines/ranking/boundedPattern"

const entry = (over: Partial<LoreRow> = {}): LoreRow => ({
	id: 1,
	source: "worldLore",
	name: "The Ashguard",
	content: "An order of oathbound riders.",
	keys: "ashguard",
	...over
})

const run = (
	entries: LoreRow[],
	contents: string[],
	over: Partial<Parameters<typeof keywordQuery>[0]> = {}
) =>
	keywordQuery({
		entries,
		messages: contents.map((content, i) => ({ id: i + 1, content })),
		retrieval: DEFAULT_RETRIEVAL,
		countTokens: (text) => Math.ceil(text.length / 4),
		...over
	})

describe("keyword query", () => {
	it("returns entries whose keys matched", () => {
		const r = run([entry()], ["the ashguard rode north"])
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.candidates[0]!.signals.keyword).toBe(1)
	})

	it("an entry whose name matched counts, even with no key hit", () => {
		const r = run(
			[entry({ keys: "nothing" })],
			["I saw the Ashguard today"]
		)
		expect(r.candidates).toHaveLength(1)
		expect(r.candidates[0]!.signals.nameMatch).toBe(1)
	})

	it("counts tokens once, up front", () => {
		const r = run([entry()], ["ashguard"])
		expect(r.candidates[0]!.tokens).toBe(
			Math.ceil(entry().content.length / 4)
		)
	})

	it("respects the configured scan depth", () => {
		const messages = [
			"ashguard was here",
			...Array.from({ length: 20 }, () => "quiet")
		]
		const shallow = run([entry()], messages)
		expect(shallow.candidates).toHaveLength(0)

		const deep = run([entry()], messages, {
			retrieval: { ...DEFAULT_RETRIEVAL, scanDepth: 50 }
		})
		expect(deep.candidates).toHaveLength(1)
	})

	it("honours per-entry match mode", () => {
		const hearth = ["she warmed her hands by the hearth"]
		expect(run([entry({ keys: "art" })], hearth).candidates).toHaveLength(1)
		expect(
			run([entry({ keys: "art", matchMode: "word" })], hearth).candidates
		).toHaveLength(0)
	})
})

describe("what it declines, and why", () => {
	it("a disabled entry is reported, not silently absent", () => {
		const r = run([entry({ enabled: false })], ["ashguard"])
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped[0]!.reason).toMatch(/disabled/)
	})

	it("a no-match says how far it looked", () => {
		const r = run([entry()], ["nothing relevant here"])
		expect(r.skipped[0]!.reason).toMatch(
			/no key matched in the last 10 messages/
		)
	})

	/**
	 * ⚠ **Two governing-rule tests stood here and are deleted, with a reason.**
	 *
	 * > *An unavailable mechanism subtracts a signal. It never reroutes,
	 * > disables a path, or excludes a candidate. Adding a model may only add
	 * > matches; removing one may only lose them.*
	 *
	 * They ran the same fixture twice over an `availability` input — once with
	 * an embedding model, once without — and asserted the two answers matched.
	 * That input no longer exists. Migration 0204 dropped
	 * `lorebook_entries.retrieval_strategy` and the eligibility check that read
	 * it, and `availability` went with the check because it had no other reader,
	 * so this mechanism is not *told* whether a model is loaded and has nothing left
	 * to branch on.
	 *
	 * Rewriting them was the alternative and there was nothing to rewrite them
	 * to: with one behaviour for every entry, both loops assert that a pure
	 * function returns the same answer twice for the same arguments. The
	 * property is now held by the type — a call site that starts passing
	 * availability fails `npm run check` — and by the header of
	 * `ranking/strategy.ts`, which says what the field was and why it must not
	 * come back.
	 *
	 * Where the rule is still observable it is still asserted end to end:
	 * `runtime/semanticArm.int.test.ts` runs the shipped spec through all three
	 * availability states, and `runtime/retrieval.int.test.ts` turns a model on
	 * between two executions of the same fixture and compares what came back.
	 */
})

describe("constant entries", () => {
	it("are candidates with no match at all, and marked pinned", () => {
		const r = run([entry({ constant: true, keys: "" })], ["unrelated"])
		expect(r.candidates[0]!.pinned).toBe(true)
	})

	it("still pass through this mechanism, so the receipt shows where they came from", () => {
		// Rather than being injected downstream from nowhere, which is what makes
		// a pinned entry look like a bug to whoever is reading the run.
		const r = run([entry({ constant: true, keys: "" })], ["unrelated"])
		expect(r.diagnostics.considered).toBe(1)
	})

	it("a disabled constant entry is still disabled", () => {
		const r = run([entry({ constant: true, enabled: false })], ["x"])
		expect(r.candidates).toHaveLength(0)
	})

	it("are not also reported as skipped, which would say two things at once", () => {
		// `considered` is candidates plus skips at the binding, so an entry in
		// both is counted twice as well as read as declined.
		const r = run([entry({ constant: true, keys: "" })], ["unrelated"])
		expect(r.skipped).toEqual([])
	})

	it("a non-constant entry still needs a match", () => {
		// The admission gate itself still stands; `constant` is the only thing
		// above it.
		//
		// ⚠ Three tests here used to state this over `retrievalStrategy` values
		// — that a constant entry was pinned "whichever mechanism its strategy names",
		// and that a `keyword` one was unaffected by availability. The column is
		// gone (migration 0204), and with one behaviour for every entry those
		// were the same case written three ways.
		const r = run([entry({ keys: "banner" })], ["ashguard"])
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped[0]!.reason).toMatch(/no key matched/)
	})
})

describe("tf-idf normalisation", () => {
	it("is deferred to the pool, because two mechanisms share it", () => {
		// Normalising inside one mechanism would normalise against that mechanism alone and
		// make the two incomparable — the engine scores twice for this reason.
		const r = run(
			[
				entry({ id: 1, keys: "ashguard" }),
				entry({ id: 2, keys: "banner" })
			],
			["ashguard banner"]
		)
		const normalised = normaliseTfidf(r.candidates)
		const max = Math.max(...normalised.map((c) => c.signals.tfidf ?? 0))
		expect(max).toBeLessThanOrEqual(1)
	})

	it("an all-zero pool does not divide by zero", () => {
		const normalised = normaliseTfidf([
			{ id: 1, source: "worldLore", tokens: 1, signals: { tfidf: 0 } }
		])
		expect(normalised[0]!.signals.tfidf).toBe(0)
	})
})

/**
 * Recursion: an entry's content is the next pass's scan window.
 *
 * The case this exists for is a lorebook that describes a place, and separately
 * the person who runs it. One pass can only bring in whichever of the two was
 * named out loud; the other is exactly the context the model needed.
 */
describe("recursive triggering", () => {
	const place = entry({
		id: 1,
		name: "The Ashguard",
		keys: "ashguard",
		content: "An order of oathbound riders, led by Commander Vell."
	})
	const person = entry({
		id: 2,
		name: "Vell",
		keys: "vell",
		content: "A commander who never removes her helm."
	})

	const deep = (n: number) => ({ ...DEFAULT_RETRIEVAL, maxRecursionDepth: n })

	it("does not recurse at all by default, which is every release before this", () => {
		const r = run([place, person], ["the ashguard rode north"])
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.diagnostics.recursionDepth).toBe(0)
	})

	it("pulls in an entry named only by another entry's content", () => {
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(1)
		})
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])
		expect(r.diagnostics.recursionDepth).toBe(1)
	})

	it("stops at the ceiling", () => {
		// A three-link chain against a ceiling of one reaches the second and
		// not the third.
		const third = entry({
			id: 3,
			name: "The Helm",
			keys: "helm",
			content: "Iron."
		})
		const r = run([place, person, third], ["the ashguard rode north"], {
			retrieval: deep(1)
		})
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])

		const deeper = run(
			[place, person, third],
			["the ashguard rode north"],
			{
				retrieval: deep(2)
			}
		)
		expect(deeper.candidates.map((c) => c.id).sort()).toEqual([1, 2, 3])
		expect(deeper.diagnostics.recursionDepth).toBe(2)
	})

	it("stops early when a pass finds nothing, rather than walking to the ceiling", () => {
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(9)
		})
		expect(r.diagnostics.recursionDepth).toBe(1)
	})

	it("honours an entry that asked to be reachable from the conversation only", () => {
		const r = run(
			[place, { ...person, recursionDepth: 0 }],
			["the ashguard rode north"],
			{ retrieval: deep(3) }
		)
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		// And it is reported as unmatched rather than quietly absent.
		expect(r.skipped.find((s) => s.id === 2)).toBeTruthy()
	})

	it("terminates on a cycle instead of scanning forever", () => {
		// Two entries naming each other. Nothing may be matched twice, which is
		// what makes this terminate — not a visited-pair check bolted on top.
		const a = entry({
			id: 1,
			name: "A",
			keys: "alpha",
			content: "See beta."
		})
		const b = entry({
			id: 2,
			name: "B",
			keys: "beta",
			content: "See alpha."
		})
		const r = run([a, b], ["alpha"], { retrieval: deep(50) })
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])
		expect(r.diagnostics.matched).toBe(2)
	})

	it("does not report an entry as unmatched that a later pass went on to find", () => {
		// The receipt contradicting the prompt is the failure this orders
		// against: `skipped` is written after the last pass, not during each.
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(1)
		})
		expect(r.skipped.map((s) => s.id)).not.toContain(2)
	})

	it("still reports a disabled entry once, not once per pass", () => {
		const off = entry({ id: 2, enabled: false, keys: "vell" })
		const r = run([place, off], ["the ashguard rode north"], {
			retrieval: deep(3)
		})
		expect(r.skipped.filter((s) => s.id === 2)).toHaveLength(1)
	})

	it("reads a negative ceiling as none, not as unlimited", () => {
		const r = run([place, person], ["the ashguard rode north"], {
			retrieval: deep(-1)
		})
		expect(r.candidates.map((c) => c.id)).toEqual([1])
	})
})

/**
 * The three lore tables have independent identity sequences.
 *
 * ⚠ A world-lore entry and a history entry both being row 1 is the *normal*
 * case on a young lorebook, and for one commit the recursion pass keyed its
 * "already handled" set on `entry.id` alone — so the first one settled the
 * second, which then disappeared without turning up in `skipped` either.
 * Silent, and indistinguishable from "no key matched".
 */
describe("entries from different tables can share an id", () => {
	const rows: LoreRow[] = [
		{
			id: 1,
			source: "worldLore",
			name: "The Ashguard",
			content: "An order of oathbound riders.",
			keys: "ashguard"
		},
		{
			id: 1,
			source: "history",
			name: "The Siege",
			content: "The siege broke in the spring.",
			keys: "ashguard"
		},
		{
			id: 1,
			source: "characterLore",
			name: "Vell's oath",
			content: "She swore it twice.",
			keys: "ashguard"
		}
	]

	it("matches all three rather than only the first", () => {
		const r = run(rows, ["the ashguard rode north"])
		expect(r.candidates.map((c) => c.source).sort()).toEqual([
			"characterLore",
			"history",
			"worldLore"
		])
	})

	it("accounts for all three when none of them match", () => {
		// The other half: a settled-set collision would also hide an entry from
		// `skipped`, so "nothing matched" and "we never looked" read alike.
		const r = run(rows, ["nothing relevant here"])
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped.map((s) => s.source).sort()).toEqual([
			"characterLore",
			"history",
			"worldLore"
		])
	})

	it("settles them separately across a recursion pass", () => {
		const r = run(rows, ["the ashguard rode north"], {
			retrieval: { ...DEFAULT_RETRIEVAL, maxRecursionDepth: 2 }
		})
		expect(r.candidates).toHaveLength(3)
		// Each exactly once — a set keyed only by source would collide the
		// other way and re-add an entry on every level.
		expect(
			new Set(r.candidates.map((c) => `${c.source}:${c.id}`)).size
		).toBe(3)
	})
})

/**
 * Two co-occurrence definitions, one per source.
 *
 * 0.5 asked world lore whether the *entry* named a cast member
 * (the 0.5 keyword path), and character lore whether the entry's own
 * character **spoke in the guaranteed window** (`:1161-1175`). One function
 * answered both for a while, so character lore got the world-lore answer —
 * which a character-lore entry satisfies by construction, since it names its
 * own character.
 *
 * ⚠ **The world-lore half is a different measurement now** (plan phase 3): the
 * graded, rarity-weighted, word-boundary, two-sided overlap `evidence` computes,
 * in place of a binary substring test against a list of cast names. The split
 * itself is what these assertions hold — the two sources still answer two
 * questions, and `signalEntityCooccurrence` is weighted per source because of
 * it.
 */
describe("co-occurrence is source-specific", () => {
	const spoke = (characterId: number | null) => ({ characterId })

	const alice = [
		{ name: "Alice", ref: { kind: "character" as const, id: 7 } }
	]

	const scan = (
		entries: LoreRow[],
		messages: Array<{
			id: number
			content: string
			characterId: number | null
		}>,
		entityRefs = alice
	) =>
		keywordQuery({
			entries,
			messages,
			entityRefs,
			retrieval: DEFAULT_RETRIEVAL,
			countTokens: (text) => Math.ceil(text.length / 4)
		})

	const messages = [
		{ id: 1, content: "who guards the gate?", ...spoke(null) },
		{ id: 2, content: "the ashguard do", ...spoke(7) }
	]

	it("world lore asks what the conversation and the entry both name", () => {
		const r = scan(
			[
				entry({ id: 1, name: "The Ashguard" }),
				// Named after a cast member the conversation never mentions.
				// **0.5 scored this 1** — the old signal only looked at the
				// entry's side — and that one-sidedness is design §13.6's third
				// named defect.
				entry({
					id: 2,
					name: "Alice at the Vigil",
					keys: "ashguard",
					content: "Alice keeps a watch of her own."
				})
			],
			messages
		)
		const scored = Object.fromEntries(
			r.candidates.map((c) => [c.id, c.signals.entityCooccurrence!])
		)
		// Both name what the scene names, so both score.
		expect(scored[1]).toBeGreaterThan(0)
		// And the entry that *also* names Alice gains nothing for it, because
		// the conversation never said her name.
		expect(scored[2]).toBeCloseTo(scored[1]!, 10)
	})

	it("is graded, not binary: a rarer shared name is worth more", () => {
		// `gate` is named by one entry, `ashguard` by three, and the window
		// names both. The rarity weight is what makes the first worth more —
		// the old signal returned 1 on the first hit whatever it hit.
		const rows = [
			entry({
				id: 1,
				name: "The Gate",
				keys: "gate",
				content: "A gate."
			}),
			entry({ id: 2, name: "The Ashguard", content: "Riders." }),
			entry({ id: 3, name: "Ashguard Oaths", content: "Ashguard vows." }),
			entry({ id: 4, name: "Ashguard Roads", content: "Ashguard paths." })
		]
		const r = scan(rows, [
			{ id: 1, content: "the ashguard rode to the gate", ...spoke(null) }
		])
		const scored = Object.fromEntries(
			r.candidates.map((c) => [c.id, c.signals.entityCooccurrence!])
		)
		expect(scored[1]).toBeGreaterThan(scored[2]!)
	})

	it("respects word boundaries: `Al` does not fire on `Alchemy`", () => {
		// The second of design §13.6's three defects. The old signal matched by
		// substring, so a short cast name scored against nearly every entry.
		const r = scan(
			[
				entry({
					id: 1,
					name: "Alchemy",
					keys: "flask",
					content: "Vials."
				})
			],
			[{ id: 1, content: "Al went north", ...spoke(null) }],
			[{ name: "Al", ref: { kind: "character" as const, id: 7 } }]
		)
		expect(r.candidates).toEqual([])
	})

	it("character lore asks whether its own character spoke", () => {
		const r = scan(
			[
				// Bound to the character who just spoke.
				entry({
					id: 1,
					source: "characterLore",
					name: "Alice's oath",
					bindingCharacterId: 7
				}),
				// Bound to one who did not, and named after a cast member — the
				// world-lore question would score this above zero.
				entry({
					id: 2,
					source: "characterLore",
					name: "Alice remembers",
					bindingCharacterId: 9
				})
			],
			messages
		)
		expect(
			r.candidates.map((c) => [c.id, c.signals.entityCooccurrence])
		).toEqual([
			[1, 1],
			[2, 0]
		])
	})

	it("a character-lore entry bound to a persona or to nobody scores zero", () => {
		const r = scan(
			[
				entry({
					id: 1,
					source: "characterLore",
					name: "Alice's oath",
					bindingCharacterId: null
				})
			],
			messages
		)
		expect(r.candidates[0]!.signals.entityCooccurrence).toBe(0)
	})

	it("the speaker window is the guaranteed one, not the whole session", () => {
		const older = Array.from({ length: 12 }, (_, i) => ({
			id: 100 + i,
			content: "the ashguard rode on",
			...spoke(i === 0 ? 7 : 9)
		}))
		const r = scan(
			[
				entry({
					id: 1,
					source: "characterLore",
					name: "Alice's oath",
					bindingCharacterId: 7
				})
			],
			older
		)
		// Character 7 spoke twelve messages ago; the guaranteed window is ten.
		expect(r.candidates[0]!.signals.entityCooccurrence).toBe(0)
	})
})

// ── Retrieval plan phase 1 — lexical quality ────────────────────────────────

describe("selective logic — found, and then excluded", () => {
	const conditioned = (over: Partial<LoreRow> = {}) =>
		entry({
			keys: "dragon",
			secondaryKeys: "statue",
			selectiveLogic: "notAny",
			...over
		})

	it("fires when the condition is satisfied", () => {
		const r = run([conditioned()], ["a dragon crossed the bridge"])
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.skipped).toEqual([])
	})

	it("is excluded, not scored down, when the condition fails", () => {
		const r = run([conditioned()], ["a dragon carved into the statue"])
		expect(
			r.candidates,
			"a rule the author wrote must exclude, not merely rank low — a " +
				"zero-scored candidate is still a candidate"
		).toEqual([])
		expect(r.diagnostics.matched).toBe(0)
		expect(r.skipped).toHaveLength(1)
		expect(r.skipped[0]!.kind).toBe("excluded")
		// Names the *secondary* keys, because the primary ones worked — a
		// receipt that only said "condition failed" sends somebody to look at
		// the wrong half of their own entry.
		expect(r.skipped[0]!.reason).toContain("its keywords matched")
		expect(r.skipped[0]!.reason).toContain("statue")
	})

	it("says nothing at all when the entry never matched anyway", () => {
		const r = run([conditioned()], ["a statue of a horse"])
		expect(r.candidates).toEqual([])
		expect(r.skipped[0]!.kind).toBe("missed")
		expect(r.skipped[0]!.reason).toContain("no key matched")
	})

	it("a pinned entry keeps bypassing retrieval entirely", () => {
		// `constant` means bypass retrieval (design §11), and a condition
		// evaluated against a window is retrieval.
		const r = run(
			[conditioned({ constant: true })],
			["a dragon carved into the statue"]
		)
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.candidates[0]!.pinned).toBe(true)
	})

	it("an entry with no condition is untouched by any of it", () => {
		const r = run([entry()], ["the ashguard rode north"])
		expect(r.candidates).toHaveLength(1)
		expect(r.skipped).toEqual([])
	})

	/**
	 * Finding #152. On a recursion pass the KEY window is the triggering
	 * entries' text, but the condition is about the scene: "not when statue
	 * is present" must see the statue standing in the conversation. 0.5.x had
	 * no recursion and no selective logic, so SillyTavern's reading (the whole
	 * scan buffer) is the one kept.
	 */
	it("on a recursion pass, reads the condition against the conversation too", () => {
		const lair = entry({
			id: 1,
			name: "The Lair",
			keys: "lair",
			content: "Something vast sleeps here: a dragon."
		})
		const wyrm = conditioned({ id: 2, name: "The Wyrm", content: "Scales like coins." })
		const r = run([lair, wyrm], ["we reached the lair, past the old statue"], {
			retrieval: { ...DEFAULT_RETRIEVAL, maxRecursionDepth: 1 }
		})
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		const skipped = r.skipped.find((s) => s.id === 2)
		expect(skipped?.kind).toBe("excluded")
		expect(skipped?.reason).toContain("statue")
	})

	it("…and a condition the recursion text satisfies still holds", () => {
		const lair = entry({
			id: 1,
			name: "The Lair",
			keys: "lair",
			content: "A dragon sleeps beside a broken statue."
		})
		const wyrm = conditioned({
			id: 2,
			name: "The Wyrm",
			selectiveLogic: "andAny",
			content: "Scales like coins."
		})
		const r = run([lair, wyrm], ["we reached the lair"], {
			retrieval: { ...DEFAULT_RETRIEVAL, maxRecursionDepth: 1 }
		})
		expect(r.candidates.map((c) => c.id).sort()).toEqual([1, 2])
	})
})

describe("trigram folding reaches the scan", () => {
	const rows = [entry({ id: 1, name: "Riders", keys: "riders" })]

	it("finds nothing extra while it is off", () => {
		expect(run(rows, ["the rider rode north"]).candidates).toEqual([])
	})

	it("admits a near-miss once it is on, and says how near", () => {
		const r = run(rows, ["the rider rode north"], {
			retrieval: { ...DEFAULT_RETRIEVAL, trigramFolding: 0.5 }
		})
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		const signal = r.candidates[0]!.signals.keyword!
		expect(signal).toBeGreaterThan(0)
		expect(signal).toBeLessThan(1)
	})

	it("leaves an exact hit at exactly 1", () => {
		const r = run(rows, ["the riders rode north"], {
			retrieval: { ...DEFAULT_RETRIEVAL, trigramFolding: 1 }
		})
		expect(r.candidates[0]!.signals.keyword).toBe(1)
	})
})

describe("proximity rides along with the key walk", () => {
	const rows = [entry({ keys: "ashguard, riders" })]

	it("is higher when the keys landed together", () => {
		const near = run(rows, ["the ashguard riders rode north"])
		const far = run(rows, [
			`the ashguard rode north ${"and on ".repeat(40)} riders`
		])
		expect(near.candidates[0]!.signals.proximity!).toBeGreaterThan(
			far.candidates[0]!.signals.proximity!
		)
	})

	it("is computed whether or not anything weights it", () => {
		// The number is free — it falls out of the walk the scan was already
		// doing — so it is always present and only the weight decides whether
		// it counts. A signal nothing can read the value of is a signal nobody
		// can decide to weight.
		const r = run(rows, ["the ashguard riders rode north"])
		expect(r.candidates[0]!.signals.proximity).toBeGreaterThan(0)
	})
})

describe("the lexical reading is a switch, not an edit", () => {
	/**
	 * Six messages, not two.
	 *
	 * `buildIdf` is `log(N / (1 + df))`, so on a two-message conversation every
	 * term the window contains has an idf of zero or below and the whole signal
	 * is 0 or negative — a fixture that cannot move, which is exactly what
	 * design §10.1 says to check for before banking a pass.
	 */
	const messages = [
		"who keeps those wastes?",
		"ashguard do",
		"a quiet night",
		"wastes are cold",
		"we rode home",
		"fine then"
	]

	const long = entry({
		id: 1,
		name: "A Long Ashguard Entry",
		keys: "ashguard, ashguard, ashguard, wardens, oathbound, patrol, commander"
	})
	const precise = entry({ id: 2, name: "Ashguard", keys: "ashguard" })

	const scoresOf = (retrieval: typeof DEFAULT_RETRIEVAL) =>
		Object.fromEntries(
			run([long, precise], messages, { retrieval }).candidates.map(
				(c) => [c.id, c.signals.tfidf!]
			)
		)

	it("ships the reading it always had", () => {
		const overlap = scoresOf(DEFAULT_RETRIEVAL)
		// The long, repetitive entry wins on the unsaturated sum, which is the
		// shape the change exists to correct — asserted so the switch has
		// something to switch away from.
		expect(overlap[1]!).toBeGreaterThan(overlap[2]!)
	})

	it("balances saturation and length once it is switched", () => {
		const balanced = scoresOf({
			...DEFAULT_RETRIEVAL,
			lexicalScoring: "balanced"
		})
		expect(balanced[2]!).toBeGreaterThan(balanced[1]!)
	})

	it("a title weight of 1 changes nothing at all", () => {
		expect(scoresOf({ ...DEFAULT_RETRIEVAL, titleWeight: 1 })).toEqual(
			scoresOf(DEFAULT_RETRIEVAL)
		)
	})

	it("a raised title weight lifts the entry whose title says it", () => {
		// Identical bags of words, opposite fields, and the two terms carry
		// different weight in the conversation — so at 1 they tie and only the
		// field weighting can separate them.
		const titled = entry({ id: 3, name: "wastes", keys: "ashguard" })
		const keyed = entry({ id: 4, name: "ashguard", keys: "wastes" })
		const of = (titleWeight: number) =>
			Object.fromEntries(
				run([titled, keyed], messages, {
					retrieval: { ...DEFAULT_RETRIEVAL, titleWeight }
				}).candidates.map((c) => [c.id, c.signals.tfidf!])
			)
		const neutral = of(1)
		expect(neutral[3]!).toBeCloseTo(neutral[4]!, 12)
		expect(neutral[3]!).toBeGreaterThan(0)
		const weighted = of(3)
		expect(weighted[3]!).toBeGreaterThan(weighted[4]!)
	})
})

describe("match facts at the source, and archived entries (L1)", () => {
	it("a candidate names the keys that matched and the message each was in", () => {
		const r = run([entry({ keys: "ashguard, riders, dragon" })], [
			"hello there",
			"the ashguard rode north",
			"and the riders followed"
		])
		const matched = r.candidates[0].matched ?? []
		expect(matched.map((m) => m.key).sort()).toEqual(["ashguard", "riders"])
		expect(matched.find((m) => m.key === "ashguard")?.messageId).toBe(2)
		expect(matched.find((m) => m.key === "riders")?.messageId).toBe(3)
	})

	it("an archived entry is excluded, and says so", () => {
		const r = run([entry({ archived: true })], ["the ashguard rode north"])
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped[0]).toMatchObject({ kind: "excluded", reason: "entry is archived" })
	})
})

describe("regex keys that are not run (plan S3)", () => {
	const aaa = `${"a".repeat(25)}!`

	it("skips an existing runaway row within the bound, and the receipt says why", () => {
		const started = performance.now()
		const r = run(
			[entry({ name: "Plain", keys: ["(a+)+$"], matchMode: "regex" })],
			[aaa]
		)
		expect(performance.now() - started).toBeLessThan(500)
		expect(r.candidates).toHaveLength(0)
		expect(r.skipped[0]!.reason).toContain("the pattern “(a+)+$” was not checked")
		expect(r.diagnostics.patternsNotRun).toEqual([
			{
				id: 1,
				source: "worldLore",
				key: "(a+)+$",
				why: expect.stringContaining("repeats a group that already repeats")
			}
		])
	})

	it("still matches the entry on its other keys, and still reports the one it skipped", () => {
		const r = run(
			[entry({ name: "Plain", keys: ["(a+)+$", "ash\\w+"], matchMode: "regex" })],
			[`the ashguard ${aaa}`]
		)
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.diagnostics.patternsNotRun.map((p) => p.key)).toEqual(["(a+)+$"])
	})

	it("reports a runaway condition key, and reads it as absent", () => {
		const r = run(
			[
				entry({
					keys: ["ashguard"],
					matchMode: "regex",
					secondaryKeys: ["(\\w+\\s?)+$"],
					selectiveLogic: "notAny"
				})
			],
			[`the ashguard ${aaa}`]
		)
		expect(r.candidates.map((c) => c.id)).toEqual([1])
		expect(r.diagnostics.patternsNotRun.map((p) => p.key)).toEqual(["(\\w+\\s?)+$"])
	})

	it("says nothing when every pattern ran", () => {
		const r = run([entry({ keys: ["ash\\w+"], matchMode: "regex" })], ["the ashguard"])
		expect(r.diagnostics.patternsNotRun).toEqual([])
	})
})

describe("one scan, one budget for patterns (plan S3)", () => {
	afterEach(() => forgetPatternCosts())

	/**
	 * Polynomial keys the write side lets through, some milliseconds each
	 * over this many digits — under the bound, so no single run trips it —
	 * and a chain of plain entries, each naming the next, so recursion keeps
	 * finding one more level and hands the slow keys a new window every time.
	 */
	const DIGITS = "1".repeat(450)
	const book = (slowKeys: number): LoreRow[] => [
		...Array.from({ length: slowKeys }, (_, i) =>
			entry({ id: 1000 + i, name: `Slow ${i}`, keys: [`\\d+\\d+zq${i}`], matchMode: "regex" })
		),
		...Array.from({ length: 41 }, (_, i) =>
			entry({ id: 1 + i, name: `Link ${i}`, keys: [`link${i}`], content: `link${i + 1} ${DIGITS}` })
		)
	]
	const scan = (slowKeys: number, maxRecursionDepth: number) =>
		run(book(slowKeys), [`link0 ${DIGITS}`], {
			retrieval: { ...DEFAULT_RETRIEVAL, maxRecursionDepth }
		})

	it.each([0, 5, 40])(
		"holds a scan to one budget at recursion depth %i, however deep it goes",
		(depth) => {
			const started = performance.now()
			const r = scan(60, depth)
			const ms = performance.now() - started
			// One budget, one bound past it, and the scan's own work. Before,
			// each pass opened a budget of its own: 0.4 s at depth 0, 1.4 s at
			// 5 and 8.5 s at 40.
			expect(ms).toBeLessThan(PATTERN_SCAN_BUDGET_MS + PATTERN_TIME_BOUND_MS + 300)
			expect(r.diagnostics.recursionDepth).toBe(Math.min(depth, MAX_RECURSION_DEPTH))
			expect(
				r.diagnostics.patternsNotRun.some((p) => p.why.includes("this turn's time"))
			).toBe(true)
		}
	)

	it("skips the slow keys after a few turns, and the scan is quick again", async () => {
		let last = scan(20, 3)
		let turns = 1
		while (turns < 15 && last.diagnostics.patternsNotRun.some((p) => !p.why.includes("too long"))) {
			await new Promise<void>((resolve) => setImmediate(resolve))
			last = scan(20, 3)
			turns++
		}
		expect(last.diagnostics.patternsNotRun).toHaveLength(20)
		expect(last.diagnostics.patternsNotRun.every((p) => p.why.includes("too long"))).toBe(true)
		const started = performance.now()
		scan(20, 3)
		expect(performance.now() - started).toBeLessThan(100)
	})
})
