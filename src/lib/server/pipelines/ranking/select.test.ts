/**
 * Selection: scoring, caps, budgets and drop reasons.
 *
 * The tests worth reading are the ones about *why* something was dropped. A
 * selector that picks a defensible set but cannot explain itself is the thing
 * this refactor exists to replace — "why is my lore not showing up" is the
 * single most common question about a system like this, and today it has no
 * answer short of reading the code.
 */

import { describe, it, expect } from "vitest"
import { score, select, renderSelection, type Candidate } from "./select"
import {
	DEFAULT_RANKING,
	DEFAULT_SIGNAL_WEIGHTS,
	withDefaults
} from "./weights"

const lore = (over: Partial<Candidate> = {}): Candidate => ({
	id: over.id ?? Math.random(),
	source: "worldLore",
	tokens: 100,
	signals: { keyword: 1 },
	...over
})

describe("score", () => {
	it("is the weighted sum of the signals", () => {
		const s = score(
			{ keyword: 1, nameMatch: 1 },
			DEFAULT_SIGNAL_WEIGHTS.worldLore
		)
		expect(s).toBeCloseTo(0.35 + 0.25, 10)
	})

	it("adds priority as a flat bonus, not a multiplier", () => {
		// So priority lifts a weak-but-important entry rather than amplifying an
		// entry that already scored well.
		const weak = score(
			{ keyword: 0.1 },
			DEFAULT_SIGNAL_WEIGHTS.worldLore,
			3
		)
		const strong = score(
			{ keyword: 1 },
			DEFAULT_SIGNAL_WEIGHTS.worldLore,
			1
		)
		expect(weak).toBeCloseTo(0.35 * 0.1 + 0.3, 10)
		expect(strong).toBeCloseTo(0.35, 10)
	})

	it("ignores signals whose weight is zero", () => {
		expect(score({ density: 1 }, DEFAULT_SIGNAL_WEIGHTS.worldLore)).toBe(0)
	})

	it("treats priority below 1 as no bonus rather than a penalty", () => {
		expect(
			score({ keyword: 1 }, DEFAULT_SIGNAL_WEIGHTS.worldLore, 0)
		).toBeCloseTo(0.35, 10)
	})
})

describe("select", () => {
	it("takes the highest scoring candidates first", () => {
		const sel = select(
			[
				lore({ id: "low", signals: { keyword: 0.1 } }),
				lore({ id: "high", signals: { keyword: 1 } })
			],
			{ availableTokens: 100, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["high"])
	})

	it("breaks ties by authored position", () => {
		const sel = select(
			[
				lore({ id: "second", position: 2 }),
				lore({ id: "first", position: 1 })
			],
			{ availableTokens: 100, params: DEFAULT_RANKING }
		)
		expect(sel.included[0]!.candidate.id).toBe("first")
	})

	it("does not stop at the first candidate that will not fit", () => {
		// No early break, preserved from the engine. Stopping here would drop
		// small high-value entries because one large one sorted above them.
		const sel = select(
			[
				lore({ id: "huge", tokens: 10_000, signals: { keyword: 1 } }),
				lore({ id: "small", tokens: 50, signals: { keyword: 0.9 } })
			],
			{ availableTokens: 1000, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["small"])
		expect(sel.excluded[0]!.reason).toBe("excluded_token_limit")
	})

	it("says how many tokens were left when it dropped something", () => {
		const sel = select([lore({ id: "big", tokens: 10_000 })], {
			availableTokens: 1000,
			params: DEFAULT_RANKING
		})
		expect(sel.excluded[0]!.why).toMatch(
			/needs 10000 tokens, \d+ left of \d+/
		)
	})

	it("enforces the per-group entry cap and says which cap", () => {
		const many = Array.from({ length: 25 }, (_, i) =>
			lore({ id: i, tokens: 1, signals: { keyword: 1 - i / 100 } })
		)
		const sel = select(many, {
			availableTokens: 100_000,
			params: DEFAULT_RANKING
		})
		expect(sel.included).toHaveLength(20)
		expect(sel.excluded[0]!.reason).toBe("excluded_budget")
		expect(sel.excluded[0]!.why).toMatch(/maximum of 20 entries/)
	})
})

describe("pinned entries", () => {
	it("are always included, whatever they score", () => {
		const sel = select([lore({ id: "pin", pinned: true, signals: {} })], {
			availableTokens: 10,
			params: DEFAULT_RANKING
		})
		expect(sel.included[0]!.reason).toBe("reserved")
	})

	it("do not count against the entry cap", () => {
		// A lorebook of pinned entries should not exhaust the cap and then
		// exclude everything that actually scored.
		const pins = Array.from({ length: 20 }, (_, i) =>
			lore({ id: `p${i}`, pinned: true, tokens: 1 })
		)
		const sel = select([...pins, lore({ id: "scored", tokens: 1 })], {
			availableTokens: 10_000,
			params: DEFAULT_RANKING
		})
		expect(sel.included.map((d) => d.candidate.id)).toContain("scored")
	})

	it("spend budget, so a lorebook of pins starves the scored pool rather than overflowing", () => {
		const sel = select(
			[
				lore({ id: "pin", pinned: true, tokens: 900 }),
				lore({ id: "scored", tokens: 900 })
			],
			{ availableTokens: 1000, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["pin"])
		expect(sel.totalTokens).toBe(900)
	})
})

describe("group budgets", () => {
	const mixed = () => [
		...Array.from({ length: 5 }, (_, i) =>
			lore({ id: `w${i}`, source: "worldLore", tokens: 200 })
		),
		...Array.from({ length: 5 }, (_, i) =>
			lore({
				id: `m${i}`,
				source: "messages",
				tokens: 200,
				signals: { recency: 1 }
			})
		)
	]

	it("gives each group its own pot, so one cannot starve another", () => {
		const sel = select(mixed(), {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		expect(sel.groups.messages.used).toBeGreaterThan(0)
		expect(sel.groups.worldLore.used).toBeGreaterThan(0)
	})

	it("turning a group up takes tokens from the others and nowhere else", () => {
		const base = select(mixed(), {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		const heavy = select(mixed(), {
			availableTokens: 2000,
			params: withDefaults({
				groups: {
					share: { ...DEFAULT_RANKING.groups.share, worldLore: 2 }
				}
			} as any)
		})
		expect(heavy.groups.worldLore.used).toBeGreaterThan(
			base.groups.worldLore.used
		)
		expect(heavy.groups.messages.used).toBeLessThanOrEqual(
			base.groups.messages.used
		)
	})

	it("a zero-weighted group is excluded, and says so", () => {
		const sel = select(mixed(), {
			availableTokens: 2000,
			params: withDefaults({
				groups: {
					share: { ...DEFAULT_RANKING.groups.share, worldLore: 0 }
				}
			} as any)
		})
		expect(sel.groups.worldLore.used).toBe(0)
		const dropped = sel.excluded.find(
			(d) => d.candidate.source === "worldLore"
		)!
		expect(dropped.reason).toBe("excluded_group_disabled")
		expect(dropped.why).toMatch(/no budget share/)
	})

	it("reports the arithmetic, so a run inspector can state it", () => {
		const sel = select(mixed(), {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		const rendered = renderSelection(sel)
		expect(rendered).toMatch(
			/worldLore: \d+ of \d+ tokens, \d+ of 20 entries/
		)
	})

	it("a zero-score candidate is still included when its group has room", () => {
		// Matching `filled_zero_score`: no signal matched, but nothing else
		// wanted the space either.
		const sel = select([lore({ id: "quiet", signals: {}, tokens: 10 })], {
			availableTokens: 5000,
			params: DEFAULT_RANKING
		})
		expect(sel.included[0]!.reason).toBe("filled_zero_score")
		expect(sel.included[0]!.why).toMatch(/no signal matched/)
	})

	it("no budget at all means nothing is selected rather than everything", () => {
		const sel = select(mixed(), {
			availableTokens: 0,
			params: DEFAULT_RANKING
		})
		expect(sel.included).toHaveLength(0)
		expect(sel.totalTokens).toBe(0)
	})
})

describe("spillover", () => {
	it("budget no group could use is offered to whoever can", () => {
		// A share is a priority, not a cap. Without this, weighting world lore at
		// 20% in a chat with no character lore would throw the rest away.
		const sel = select(
			[
				lore({ id: "w", source: "worldLore", tokens: 900 }),
				lore({ id: "h", source: "history", tokens: 900 })
			],
			{ availableTokens: 2000, params: DEFAULT_RANKING }
		)
		// Neither fits its own ~333-token share, but the messages share is unused
		// because there are no message candidates.
		expect(sel.included.length).toBeGreaterThan(0)
		expect(sel.included[0]!.why).toMatch(/no group could use/)
	})

	it("the weighted-up group still gets first claim", () => {
		const params = withDefaults({
			groups: { share: { ...DEFAULT_RANKING.groups.share, worldLore: 3 } }
		} as any)
		const sel = select(
			[
				lore({
					id: "w",
					source: "worldLore",
					tokens: 600,
					signals: { keyword: 0.5 }
				}),
				lore({
					id: "h",
					source: "history",
					tokens: 600,
					signals: { keyword: 1 }
				})
			],
			{ availableTokens: 1200, params }
		)
		// History scores higher, but world lore was weighted up and claims its
		// share first; spillover only moves what is left.
		expect(sel.included.map((d) => d.candidate.id)).toContain("w")
	})

	it("never lets spillover exceed a group's entry cap", () => {
		const many = Array.from({ length: 30 }, (_, i) =>
			lore({ id: i, source: "worldLore", tokens: 10 })
		)
		const sel = select(many, {
			availableTokens: 100_000,
			params: DEFAULT_RANKING
		})
		expect(sel.groups.worldLore.entries).toBeLessThanOrEqual(20)
	})

	it("a disabled group stays disabled through spillover", () => {
		const sel = select(
			[lore({ id: "w", source: "worldLore", tokens: 10 })],
			{
				availableTokens: 5000,
				params: withDefaults({
					groups: {
						share: { ...DEFAULT_RANKING.groups.share, worldLore: 0 }
					}
				} as any)
			}
		)
		// Off means off: spillover redistributes unused budget, it does not
		// resurrect a group the user switched off.
		expect(sel.included).toHaveLength(0)
		expect(sel.excluded[0]!.reason).toBe("excluded_group_disabled")
	})
})
