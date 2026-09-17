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
import {
	score,
	select,
	renderSelection,
	type Candidate
} from "$lib/server/pipelines/ranking/select"
import {
	DEFAULT_RANKING,
	DEFAULT_SIGNAL_WEIGHTS,
	withDefaults
} from "$lib/server/pipelines/ranking/weights"

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

	/**
	 * The mechanism strengths, over the eleven weights (plan phase 3).
	 *
	 * They group the signals by *how the entry was found* — keyword, semantic,
	 * name — and leave the five structural ones alone. The default is all three
	 * at 1, which is arithmetically the function that existed before them, so
	 * these say what changes when somebody moves one and what must not.
	 */
	describe("mechanism weights", () => {
		const w = DEFAULT_SIGNAL_WEIGHTS.worldLore
		const all = (n: number) => ({ keyword: n, semantic: n, name: n })

		it("1 is neutral — the same number as omitting them", () => {
			const signals = {
				keyword: 1,
				tfidf: 0.5,
				nameMatch: 1,
				semantic: 0.8,
				lastRefRecency: 0.4
			}
			expect(score(signals, w, 2, all(1))).toBeCloseTo(
				score(signals, w, 2),
				10
			)
		})

		it("scales the signals of the mechanism it names, and only those", () => {
			// tf-idf is a *keyword* signal — vocabulary the author's index and
			// the conversation share — so it moves with the keyword bar rather
			// than standing on its own.
			expect(
				score({ tfidf: 1 }, w, 1, { ...all(1), keyword: 0 })
			).toBeCloseTo(0, 10)
			expect(
				score({ tfidf: 1 }, w, 1, { ...all(1), name: 0 })
			).toBeCloseTo(w.tfidf, 10)
		})

		it("groups nameMatch with entityCooccurrence under `name`", () => {
			const named = { nameMatch: 1, entityCooccurrence: 1 }
			expect(score(named, w, 1, { ...all(1), name: 0 })).toBe(0)
			expect(score(named, w, 1, { ...all(1), keyword: 0 })).toBeCloseTo(
				w.nameMatch + w.entityCooccurrence,
				10
			)
		})

		it("leaves the structural signals and the priority bonus alone", () => {
			// "Does this matter now" is not a way of finding something. An entry
			// does not stop being long, or stop having come up a moment ago,
			// because a reader turned keyword matching down.
			//
			// ⚠ `recency` and `sceneAffinity` were in this object and are gone
			// with the weights: nothing produced either, so the rule was being
			// asserted against two numbers no run could carry.
			const structural = {
				lastRefRecency: 1,
				density: 1
			}
			expect(score(structural, w, 3, all(0))).toBeCloseTo(
				score(structural, w, 3, all(1)),
				10
			)
			expect(score({}, w, 3, all(0))).toBeCloseTo(2 * w.priorityBonus, 10)
		})

		it("compounds across mechanisms by addition, with no fusion step", () => {
			// The property the whole shape exists for: an entry two independent
			// mechanisms found outscores one either found alone, and it does so
			// because the terms add — not because anything reconciled two
			// incomparable scales.
			const byKeyword = score({ keyword: 1 }, w)
			const byMeaning = score({ semantic: 1 }, w)
			const byBoth = score({ keyword: 1, semantic: 1 }, w)
			expect(byBoth).toBeCloseTo(byKeyword + byMeaning, 10)
			expect(byBoth).toBeGreaterThan(Math.max(byKeyword, byMeaning))
		})
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

describe("a band whose priority is `always`", () => {
	const always = () =>
		withDefaults({
			groups: {
				priority: { ...DEFAULT_RANKING.groups.priority, worldLore: "always" },
				maxEntries: { ...DEFAULT_RANKING.groups.maxEntries, worldLore: 2 }
			}
		})

	it("is reserved ahead of the scored fill, in score order, up to the band's cap — the rest leave with the cap's reason (U3b S1)", () => {
		// Four entries, a cap of 2, and a window that could hold all four:
		// `always` is a promise about the band, not a way past its ceiling,
		// whose own label says it applies "whatever its share".
		const sel = select(
			[
				lore({ id: "c", tokens: 1, signals: { keyword: 0.3 } }),
				lore({ id: "a", tokens: 1, signals: { keyword: 1 } }),
				lore({ id: "d", tokens: 1, signals: { keyword: 0.2 } }),
				lore({ id: "b", tokens: 1, signals: { keyword: 0.9 } })
			],
			{ availableTokens: 100_000, params: always() }
		)
		expect(sel.included.map((d) => [d.candidate.id, d.reason])).toEqual([
			["a", "reserved_priority"],
			["b", "reserved_priority"]
		])
		expect(sel.excluded.map((d) => [d.candidate.id, d.reason])).toEqual([
			["c", "excluded_budget"],
			["d", "excluded_budget"]
		])
		expect(sel.excluded[0]!.why).toMatch(
			/always be included, but already has its maximum of 2 entries/
		)
		expect(sel.groups.worldLore.entries).toBe(2)
	})

	it("a pin still steps over the cap — a promise about one entry, not the band", () => {
		const sel = select(
			[
				lore({ id: "a", tokens: 1, signals: { keyword: 1 } }),
				lore({ id: "b", tokens: 1, signals: { keyword: 0.9 } }),
				lore({ id: "p", tokens: 1, pinned: true, signals: {} })
			],
			{ availableTokens: 100_000, params: always() }
		)
		expect(sel.included.map((d) => [d.candidate.id, d.reason])).toEqual([
			["p", "reserved"],
			["a", "reserved_priority"],
			["b", "reserved_priority"]
		])
	})

	it("with no cap keeps every entry the window can hold", () => {
		const params = withDefaults({
			groups: {
				priority: { ...DEFAULT_RANKING.groups.priority, worldLore: "always" },
				maxEntries: { ...DEFAULT_RANKING.groups.maxEntries, worldLore: undefined }
			}
		})
		const many = Array.from({ length: 30 }, (_, i) =>
			lore({ id: i, tokens: 1, signals: { keyword: 1 - i / 100 } })
		)
		const sel = select(many, { availableTokens: 100_000, params })
		expect(sel.included).toHaveLength(30)
		expect(sel.included.every((d) => d.reason === "reserved_priority")).toBe(true)
	})
})

describe("pinned entries", () => {
	it("are always included, whatever they score", () => {
		const sel = select([lore({ id: "pin", pinned: true, signals: {} })], {
			availableTokens: 1000,
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

	it("all of them survive when they fit, and the cap is still the scored pool's", () => {
		// Twenty pins is exactly worldLore's cap. The pins not counting is the
		// point; them being silently thinned to make room would be the same bug
		// wearing the opposite hat.
		const pins = Array.from({ length: 20 }, (_, i) =>
			lore({ id: `p${i}`, pinned: true, tokens: 1, position: i })
		)
		const scored = Array.from({ length: 20 }, (_, i) =>
			lore({ id: `s${i}`, tokens: 1, position: i })
		)
		const sel = select([...pins, ...scored], {
			availableTokens: 10_000,
			params: DEFAULT_RANKING
		})
		const kept = new Set(sel.included.map((d) => d.candidate.id))
		for (const p of pins) expect(kept.has(p.id)).toBe(true)
		expect(sel.groups.worldLore.entries).toBe(20)
		expect(sel.totalTokens).toBe(40)
	})
})

describe("a pinned entry the window cannot hold", () => {
	// The person who trips this is the person who ticked "constant" on a long
	// entry. Including it anyway produced a prompt that could not be sent, and
	// the receipt said the pin was honoured.
	it("is dropped, and the receipt names the pin as the thing that did not fit", () => {
		const sel = select(
			[
				lore({ id: "huge", pinned: true, tokens: 5000 }),
				lore({ id: "scored", tokens: 100 })
			],
			{ availableTokens: 1000, params: DEFAULT_RANKING }
		)
		const dropped = sel.excluded.find((d) => d.candidate.id === "huge")!
		expect(dropped.reason).toBe("excluded_pinned_token_limit")
		expect(dropped.included).toBe(false)
		expect(dropped.why).toMatch(
			/pinned, but needs 5000 tokens and only \d+ of the 1000-token window/
		)
		expect(sel.totalTokens).toBeLessThanOrEqual(1000)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["scored"])
	})

	it("does not take the pins sorted below it with it", () => {
		// Note 3 applied to pins. A minimum is one promise about a source in an
		// order; a pin is a separate promise per ticked box, so `a` and `b` are
		// owed nothing by `big` being oversized.
		const sel = select(
			[
				lore({
					id: "big",
					pinned: true,
					tokens: 900,
					signals: { keyword: 1 }
				}),
				lore({
					id: "a",
					pinned: true,
					tokens: 100,
					signals: { keyword: 0.5 }
				}),
				lore({
					id: "b",
					pinned: true,
					tokens: 100,
					signals: { keyword: 0.4 }
				})
			],
			{ availableTokens: 500, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["a", "b"])
		expect(sel.excluded.map((d) => d.candidate.id)).toEqual(["big"])
		expect(sel.excluded[0]!.reason).toBe("excluded_pinned_token_limit")
		expect(sel.totalTokens).toBe(200)
	})

	it("loses to the ranker's order rather than to arrival order", () => {
		// Which pin survives is decided the way everything else is — score,
		// then authored position. Arrival order would make it a lottery run by
		// whichever query returned first.
		const sel = select(
			[
				lore({
					id: "weak",
					pinned: true,
					tokens: 400,
					signals: { keyword: 0.1 },
					position: 1
				}),
				lore({
					id: "strong",
					pinned: true,
					tokens: 400,
					signals: { keyword: 1 },
					position: 9
				})
			],
			{ availableTokens: 500, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["strong"])
		expect(sel.excluded.map((d) => d.candidate.id)).toEqual(["weak"])
	})

	it("falls back to authored order, which is what constant entries have", () => {
		// A constant entry that matched nothing has no signals to rank it by,
		// so the tie-break is the order its author wrote them in.
		const sel = select(
			[
				lore({
					id: "third",
					pinned: true,
					tokens: 400,
					signals: {},
					position: 3
				}),
				lore({
					id: "first",
					pinned: true,
					tokens: 400,
					signals: {},
					position: 1
				})
			],
			{ availableTokens: 500, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["first"])
		expect(sel.excluded.map((d) => d.candidate.id)).toEqual(["third"])
	})

	it("does not also cancel the minimum its source was owed", () => {
		const sel = select(
			[
				lore({
					id: "huge-pin",
					source: "messages",
					pinned: true,
					tokens: 5000,
					signals: { density: 1 }
				}),
				lore({
					id: "m1",
					source: "messages",
					tokens: 50,
					signals: { density: 1 }
				}),
				lore({
					id: "m2",
					source: "messages",
					tokens: 50,
					signals: { density: 0.9 }
				})
			],
			{
				availableTokens: 500,
				params: withDefaults({
					groups: {
						minEntries: {
							...DEFAULT_RANKING.groups.minEntries,
							messages: 2
						}
					}
				} as any)
			}
		)
		// The minimum subtracts the pins that are keeping it. A pin that was
		// dropped keeps nothing, so both minimum slots are still owed.
		const minimumEntries = sel.included.filter(
			(d) => d.reason === "reserved_minimum"
		)
		expect(minimumEntries.map((d) => d.candidate.id)).toEqual(["m1", "m2"])
	})

	it("renders a line of its own, which a group's dropped count cannot", () => {
		const sel = select(
			[
				lore({ id: "huge", pinned: true, tokens: 5000 }),
				lore({ id: "scored", tokens: 100 })
			],
			{ availableTokens: 1000, params: DEFAULT_RANKING }
		)
		expect(renderSelection(sel)).toMatch(
			/pinned: 1 too large for the window \(worldLore\)/
		)
	})

	it("renders no such line when every pin fitted", () => {
		const sel = select([lore({ id: "pin", pinned: true, tokens: 100 })], {
			availableTokens: 1000,
			params: DEFAULT_RANKING
		})
		expect(renderSelection(sel)).not.toMatch(/too large for the window/)
	})
})

describe("a pinned entry whose source has a zero share", () => {
	// The share control's rendered description is "Set a band to zero to leave
	// it out", and the shipped default relies on it — `relationships: 0` is how
	// that source is switched off. The "Pinned" switch promises nothing in
	// writing, so a pin outliving a zeroed band breaks the one contract there
	// actually is, on exactly the entries somebody zeroed the band to be rid of.
	const shareOff = (source: string) =>
		withDefaults({
			groups: {
				share: { ...DEFAULT_RANKING.groups.share, [source]: 0 }
			}
		} as any)

	it("is excluded, and the receipt names the pin and the zero share both", () => {
		const sel = select(
			[
				lore({ id: "pin", pinned: true, tokens: 100 }),
				lore({
					id: "m",
					source: "messages",
					tokens: 100,
					signals: { density: 1 }
				})
			],
			{ availableTokens: 5000, params: shareOff("worldLore") }
		)
		const dropped = sel.excluded.find((d) => d.candidate.id === "pin")!
		expect(dropped.reason).toBe("excluded_pinned_group_disabled")
		expect(dropped.included).toBe(false)
		expect(dropped.why).toMatch(/pinned, but worldLore has a zero share/)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["m"])
	})

	it("does not spend the window on its way out", () => {
		// Dropped before `reservedTokens` moves, so the tokens it would have
		// taken are still there for everybody else. A switched-off source that
		// quietly shrank the window would be the same bug with a receipt
		// stapled to it.
		const withPin = select(
			[
				lore({ id: "pin", pinned: true, tokens: 900 }),
				lore({
					id: "m",
					source: "messages",
					tokens: 400,
					signals: { density: 1 }
				})
			],
			{ availableTokens: 1000, params: shareOff("worldLore") }
		)
		const withoutPin = select(
			[
				lore({
					id: "m",
					source: "messages",
					tokens: 400,
					signals: { density: 1 }
				})
			],
			{ availableTokens: 1000, params: shareOff("worldLore") }
		)
		expect(withPin.included).toEqual(withoutPin.included)
		expect(withPin.groups).toEqual(withoutPin.groups)
		expect(withPin.totalTokens).toBe(withoutPin.totalTokens)
	})

	it("is not resurrected by spillover, however much is left over", () => {
		// Off means off, the rule the scored path already follows.
		const sel = select([lore({ id: "pin", pinned: true, tokens: 10 })], {
			availableTokens: 100_000,
			params: shareOff("worldLore")
		})
		expect(sel.included).toHaveLength(0)
		expect(sel.excluded.map((d) => d.reason)).toEqual([
			"excluded_pinned_group_disabled"
		])
	})

	it("renders a line of its own, because the group's has been skipped", () => {
		// A zero-share group is `allocated === 0 && used === 0`, so
		// `renderSelection` never reaches it. Folded into the scored path's
		// reason this drop would appear nowhere at all.
		const sel = select([lore({ id: "pin", pinned: true, tokens: 100 })], {
			availableTokens: 5000,
			params: shareOff("worldLore")
		})
		const rendered = renderSelection(sel)
		expect(rendered).not.toMatch(/^worldLore:/m)
		expect(rendered).toMatch(
			/pinned: 1 in a source set to zero share \(worldLore\)/
		)
	})

	it("leaves a pin alone when it is some other band that was zeroed", () => {
		// The guard keys on the candidate's own source. Reading "is any share
		// zero" instead would switch every pin off the moment one band was —
		// and the shipped default already has one.
		const sel = select([lore({ id: "pin", pinned: true, tokens: 100 })], {
			availableTokens: 1000,
			params: shareOff("history")
		})
		expect(sel.included[0]!.candidate.id).toBe("pin")
		expect(sel.included[0]!.reason).toBe("reserved")
		expect(sel.included[0]!.why).toMatch(/pinned: always included/)
		expect(sel.groups.worldLore.used).toBe(100)
		expect(sel.totalTokens).toBe(100)
		expect(renderSelection(sel)).not.toMatch(/zero share/)
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
				signals: { density: 1 }
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
		// `allocated`, not `used`. The spill pass hands whatever no group could
		// spend to whoever can, so on a window roomy enough for every candidate
		// both runs end up having included everything — which says nothing
		// about the shares. What the share *is* is the pot, and that is what
		// turning one up has to take from the others.
		expect(heavy.groups.worldLore.allocated).toBeGreaterThan(
			base.groups.worldLore.allocated
		)
		expect(heavy.groups.messages.allocated).toBeLessThan(
			base.groups.messages.allocated
		)
	})

	// The guarantee the minimums exist to make, and the one they must not break.
	it("never selects more than the window, however the minimums are set", () => {
		const sel = select(mixed(), {
			availableTokens: 500,
			params: withDefaults({
				groups: {
					// Every minimum set past what 500 tokens can hold: five
					// 200-token entries per source is 2000 tokens of promises
					// against a 500-token window.
					minEntries: {
						messages: 5,
						worldLore: 5,
						characterLore: 5,
						history: 5,
						relationships: 5
					}
				}
			} as any)
		})
		expect(sel.totalTokens).toBeLessThanOrEqual(500)
		expect(sel.included.length).toBeGreaterThan(0)
	})

	it("fills a minimum in score order and marks it as a minimum", () => {
		const sel = select(mixed(), {
			availableTokens: 2000,
			params: withDefaults({
				groups: {
					// worldLore weighted to nothing, so anything of it that
					// survives got there by the minimum rather than by a share.
					share: { ...DEFAULT_RANKING.groups.share, worldLore: 0 },
					minEntries: {
						...DEFAULT_RANKING.groups.minEntries,
						worldLore: 2
					}
				}
			} as any)
		})
		const minimumEntries = sel.included.filter(
			(d) =>
				d.reason === "reserved_minimum" &&
				d.candidate.source === "worldLore"
		)
		expect(minimumEntries).toHaveLength(2)
		expect(minimumEntries[0]!.why).toMatch(/minimum of 2 for worldLore/)
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
		// 20% in a session with no character lore would throw the rest away.
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

describe("a source with no budget group", () => {
	// The vector mechanism labels its hits with the index vocabulary, so `historyEntry`
	// and friends reach a ranker whose groups are the five bands. Real at
	// runtime and unrepresentable in the type, hence the cast.
	const vectorHit = (over: Partial<Candidate> = {}) =>
		lore({
			source: "historyEntry" as any,
			signals: {},
			presetScore: 0.8,
			...over
		})

	it("is excluded with a receipt rather than crashing the selection", () => {
		const known = [
			lore({ id: "w", tokens: 100 }),
			lore({
				id: "m",
				source: "messages",
				tokens: 100,
				signals: { density: 1 }
			})
		]
		const sel = select([...known, vectorHit({ id: "h", tokens: 100 })], {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})

		const dropped = sel.excluded.find((d) => d.candidate.id === "h")!
		expect(dropped.reason).toBe("excluded_unknown_source")
		expect(dropped.why).toMatch(/historyEntry has no budget group/)
		expect(dropped.score).toBe(0.8)

		// And everything that does have a group is selected exactly as it would
		// have been had the unknown one never arrived.
		const baseline = select(known, {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		expect(sel.included).toEqual(baseline.included)
		expect(sel.groups).toEqual(baseline.groups)
		expect(sel.totalTokens).toBe(baseline.totalTokens)
	})

	it("is excluded when pinned, rather than crashing the reserved loop", () => {
		const sel = select(
			[
				vectorHit({ id: "h", pinned: true, tokens: 100 }),
				lore({ id: "w", tokens: 100 })
			],
			{ availableTokens: 2000, params: DEFAULT_RANKING }
		)
		expect(sel.included.map((d) => d.candidate.id)).toEqual(["w"])
		expect(sel.excluded.map((d) => d.reason)).toEqual([
			"excluded_unknown_source"
		])
		expect(sel.totalTokens).toBe(100)
	})

	it("renders a trailing line naming the count and the sources", () => {
		const sel = select(
			[
				lore({ id: "w", tokens: 100 }),
				vectorHit({ id: "h", tokens: 100 })
			],
			{ availableTokens: 2000, params: DEFAULT_RANKING }
		)
		const rendered = renderSelection(sel)
		expect(rendered).toMatch(/unknown source: 1 excluded \(historyEntry\)/)
	})

	it("renders no unknown-source line when nothing was excluded that way", () => {
		const sel = select([lore({ id: "w", tokens: 100 })], {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		const rendered = renderSelection(sel)
		expect(rendered).not.toMatch(/unknown source/)
	})
})

/**
 * Design §7: *score allocates, minimums guarantee, shares cap.*
 *
 * Every test here runs the same input twice, once each way, because the claim
 * is comparative — "the new precedence is better" is only meaningful next to
 * what the old one did with the same candidates. The flag is off by default,
 * so the first run of each pair is also the shipped behaviour.
 */
describe("score-led allocation", () => {
	/**
	 * The minimums are switched off in most of these, and it is not to make the
	 * arithmetic tidier. `minEntries.messages` is 6 by default, so on a small
	 * window the minimum decides these fixtures before either precedence gets a
	 * turn — and a test that passes because of the mechanism it is not about
	 * is a test that keeps passing when the mechanism it *is* about breaks.
	 * The minimum gets its own test below, where it is the subject.
	 */
	const noMinimums = (over: Record<string, unknown> = {}) =>
		withDefaults({
			groups: {
				minEntries: {
					messages: 0,
					worldLore: 0,
					characterLore: 0,
					history: 0,
					relationships: 0
				},
				...over
			}
		} as any)

	/**
	 * A turn where world lore is the only relevant thing.
	 *
	 * `characterLore` and `history` contribute nothing at all — between them
	 * they hold a third of the window on a share-first split — and the two
	 * message candidates are the conversation ticking over, scoring 0.03 and
	 * 0.015 against world lore's 0.35.
	 */
	const oneRelevantSource = () => [
		lore({
			id: "w_relevant",
			source: "worldLore",
			tokens: 600,
			signals: { keyword: 1 }
		}),
		lore({
			id: "m_idle1",
			source: "messages",
			tokens: 250,
			signals: { density: 0.1 }
		}),
		lore({
			id: "m_idle2",
			source: "messages",
			tokens: 250,
			signals: { density: 0.05 }
		})
	]

	it("spends on the best candidate what share-first spent on the nearest one", () => {
		// The improvement, stated as a diff. Share-first hands messages its
		// half of the window, the two idle messages fill it because nothing in
		// their band outbids them, and the 0.35 entry is then too big for what
		// is left — so a third of the window goes unspent *and* the one
		// candidate that scored is the one that was dropped.
		const shareFirst = select(oneRelevantSource(), {
			availableTokens: 1000,
			params: noMinimums()
		})
		expect(shareFirst.included.map((d) => d.candidate.id)).toEqual([
			"m_idle1",
			"m_idle2"
		])
		expect(shareFirst.totalTokens).toBe(500)
		expect(
			shareFirst.excluded.find((d) => d.candidate.id === "w_relevant")
		).toBeTruthy()

		// Score-led spends the same window best-first: the 0.35 entry is kept
		// a place while the 0.03 one takes what is left over, and 850 of the
		// 1000 tokens carry something that scored rather than 500 carrying
		// something that did not.
		const scoreLed = select(oneRelevantSource(), {
			availableTokens: 1000,
			params: noMinimums(),
			scoreLedAllocation: true
		})
		expect(scoreLed.included.map((d) => d.candidate.id).sort()).toEqual([
			"m_idle1",
			"w_relevant"
		])
		expect(scoreLed.totalTokens).toBe(850)
	})

	it("is off unless it is asked for", () => {
		// The whole reason the flag exists: the parity corpus and the goldens
		// measure the shipped precedence, and they only keep doing that if
		// omitting the option is the same call as passing it false.
		const omitted = select(oneRelevantSource(), {
			availableTokens: 1000,
			params: noMinimums()
		})
		const explicit = select(oneRelevantSource(), {
			availableTokens: 1000,
			params: noMinimums(),
			scoreLedAllocation: false
		})
		expect(omitted.included.map((d) => d.candidate.id)).toEqual(
			explicit.included.map((d) => d.candidate.id)
		)
		expect(omitted.excluded.map((d) => [d.candidate.id, d.reason])).toEqual(
			explicit.excluded.map((d) => [d.candidate.id, d.reason])
		)
		expect(omitted.groups).toEqual(explicit.groups)
		expect(omitted.totalTokens).toBe(explicit.totalTokens)
	})

	it("says the source ran out of share, not that the window did", () => {
		// The two are different questions with different answers — enlarge the
		// context, or move that source's band — so they get different reasons.
		// Under share-first there was only one bound and one name for it.
		const sel = select(oneRelevantSource(), {
			availableTokens: 1000,
			params: noMinimums(),
			scoreLedAllocation: true
		})
		const capped = sel.excluded.find((d) => d.candidate.id === "m_idle2")!
		expect(capped.reason).toBe("excluded_token_limit")
		expect(capped.why).toMatch(/left of 1000 across every source/)

		const shareFirst = select(oneRelevantSource(), {
			availableTokens: 1000,
			params: noMinimums()
		})
		expect(
			shareFirst.excluded.find((d) => d.candidate.id === "w_relevant")!
				.reason
		).toBe("excluded_token_limit")
	})

	// ── Minimums guarantee ────────────────────────────────────────────────
	describe("minimums still guarantee", () => {
		// The property the share bands were really protecting, and the one
		// thing score-led allocation must not take with it: a minimum is a
		// promise about a *source*, so it has to survive a turn where every
		// scored candidate from somewhere else outranks it.
		const minimumMessages = () => [
			lore({
				id: "w_dominant",
				source: "worldLore",
				tokens: 900,
				signals: { keyword: 1 }
			}),
			lore({
				id: "m1",
				source: "messages",
				tokens: 100,
				signals: { density: 0.1 }
			}),
			lore({
				id: "m2",
				source: "messages",
				tokens: 100,
				signals: { density: 0.05 }
			})
		]

		it("keeps the minimum's entries even when a better candidate wanted the tokens", () => {
			const sel = select(minimumMessages(), {
				availableTokens: 1000,
				params: withDefaults({
					groups: {
						minEntries: {
							...DEFAULT_RANKING.groups.minEntries,
							messages: 2
						}
					}
				} as any),
				scoreLedAllocation: true
			})
			const minimumEntries = sel.included.filter(
				(d) => d.reason === "reserved_minimum"
			)
			expect(minimumEntries.map((d) => d.candidate.id)).toEqual(["m1", "m2"])
			expect(minimumEntries[0]!.why).toMatch(/minimum of 2 for messages/)
			// And the minimum came off the top, so the 900-token entry is
			// weighed against 800 rather than 1000 and does not fit.
			expect(sel.included.map((d) => d.candidate.id)).not.toContain(
				"w_dominant"
			)
		})

		it("fills the minimum in score order, as it always did", () => {
			const sel = select(minimumMessages(), {
				availableTokens: 1000,
				params: withDefaults({
					groups: {
						minEntries: {
							...DEFAULT_RANKING.groups.minEntries,
							messages: 1
						}
					}
				} as any),
				scoreLedAllocation: true
			})
			const minimumEntries = sel.included.filter(
				(d) => d.reason === "reserved_minimum"
			)
			expect(minimumEntries.map((d) => d.candidate.id)).toEqual(["m1"])
		})

		it("never selects more than the window, however the minimums are set", () => {
			// The guarantee the minimums exist to make, and the one they must
			// not break — restated under the new precedence because the pool
			// the scored pass draws on is what is left after them.
			const sel = select(
				[
					...Array.from({ length: 5 }, (_, i) =>
						lore({
							id: `w${i}`,
							source: "worldLore",
							tokens: 200
						})
					),
					...Array.from({ length: 5 }, (_, i) =>
						lore({
							id: `m${i}`,
							source: "messages",
							tokens: 200,
							signals: { density: 1 }
						})
					)
				],
				{
					availableTokens: 500,
					params: withDefaults({
						groups: {
							minEntries: {
								messages: 5,
								worldLore: 5,
								characterLore: 5,
								history: 5,
								relationships: 5
							}
						}
					} as any),
					scoreLedAllocation: true
				}
			)
			expect(sel.totalTokens).toBeLessThanOrEqual(500)
			expect(sel.included.length).toBeGreaterThan(0)
		})
	})

	// ── Zero share still excludes ───────────────────────────────────────
	describe("a zero share still leaves the source out", () => {
		// The share control says so in as many words — "Set a band to zero to
		// leave it out" — and it is the only promise either control makes in
		// writing. Inverting what the *non*-zero bands mean does not touch it.
		const shareOff = (source: string) =>
			withDefaults({
				groups: {
					share: { ...DEFAULT_RANKING.groups.share, [source]: 0 },
					minEntries: {
						messages: 0,
						worldLore: 0,
						characterLore: 0,
						history: 0,
						relationships: 0
					}
				}
			} as any)

		it("excludes a scored candidate and says which control did it", () => {
			const sel = select(
				[
					lore({ id: "w", source: "worldLore", tokens: 100 }),
					lore({
						id: "m",
						source: "messages",
						tokens: 100,
						signals: { density: 1 }
					})
				],
				{
					availableTokens: 5000,
					params: shareOff("worldLore"),
					scoreLedAllocation: true
				}
			)
			const dropped = sel.excluded.find((d) => d.candidate.id === "w")!
			expect(dropped.reason).toBe("excluded_group_disabled")
			expect(dropped.why).toMatch(/no budget share/)
			expect(sel.included.map((d) => d.candidate.id)).toEqual(["m"])
		})

		it("excludes a pinned candidate, with the reason that names both halves", () => {
			const sel = select(
				[lore({ id: "pin", pinned: true, tokens: 100 })],
				{
					availableTokens: 5000,
					params: shareOff("worldLore"),
					scoreLedAllocation: true
				}
			)
			expect(sel.included).toHaveLength(0)
			expect(sel.excluded.map((d) => d.reason)).toEqual([
				"excluded_pinned_group_disabled"
			])
			expect(sel.excluded[0]!.why).toMatch(
				/pinned, but worldLore has a zero share/
			)
		})

		it("is not resurrected by the sweep, however much is going spare", () => {
			// Off means off. The sweep now re-offers share-capped candidates
			// as well as window-capped ones, and a zero-share source must not
			// arrive through that door — a band set to zero is not a band that
			// ran out.
			const sel = select(
				[
					lore({ id: "w", source: "worldLore", tokens: 10 }),
					lore({ id: "pin", pinned: true, tokens: 10 })
				],
				{
					availableTokens: 100_000,
					params: shareOff("worldLore"),
					scoreLedAllocation: true
				}
			)
			expect(sel.included).toHaveLength(0)
			expect(sel.groups.worldLore.used).toBe(0)
			expect(sel.excluded.map((d) => d.reason).sort()).toEqual([
				"excluded_group_disabled",
				"excluded_pinned_group_disabled"
			])
		})
	})

	// ── Shares cap ──────────────────────────────────────────────────────
	describe("shares still cap", () => {
		/**
		 * Four sources, all with more demand than the window can hold, so the
		 * pool is genuinely contended from the first candidate to the last.
		 * World lore and messages score well; character lore and history are
		 * a long tail of weak entries with plenty of them.
		 */
		const contended = () => [
			...Array.from({ length: 6 }, (_, i) =>
				lore({
					id: `w${i}`,
					source: "worldLore",
					tokens: 100,
					position: i,
					signals: { keyword: 1 - i / 10 }
				})
			),
			...Array.from({ length: 6 }, (_, i) =>
				lore({
					id: `m${i}`,
					source: "messages",
					tokens: 100,
					position: i,
					signals: { density: 1 - i / 10 }
				})
			),
			...Array.from({ length: 4 }, (_, i) =>
				lore({
					id: `c${i}`,
					source: "characterLore",
					tokens: 100,
					position: i,
					signals: { keyword: 0.2 }
				})
			),
			...Array.from({ length: 4 }, (_, i) =>
				lore({
					id: `h${i}`,
					source: "history",
					tokens: 100,
					position: i,
					signals: { keyword: 0.2 }
				})
			)
		]

		it("holds a source to its band while another source can still use the tokens", () => {
			const sel = select(contended(), {
				availableTokens: 1000,
				params: noMinimums(),
				scoreLedAllocation: true
			})
			// Character lore and history each had four candidates and a band
			// worth one. Their band is what stopped the second, and the
			// receipt says band rather than window.
			expect(sel.groups.characterLore.used).toBeLessThanOrEqual(
				sel.groups.characterLore.allocated
			)
			expect(sel.groups.history.used).toBeLessThanOrEqual(
				sel.groups.history.allocated
			)
			const capped = sel.excluded.find((d) => d.candidate.id === "c1")!
			expect(capped.reason).toBe("excluded_share_cap")
			expect(capped.why).toMatch(/left of its \d+-token share/)
		})

		it("lets a source past its band only with tokens nothing else could use", () => {
			const sel = select(contended(), {
				availableTokens: 1000,
				params: noMinimums(),
				scoreLedAllocation: true
			})
			for (const source of ["worldLore", "messages"] as const) {
				const usage = sel.groups[source]
				if (usage.used <= usage.allocated) continue
				// Everything past the band arrived through the sweep, and each
				// one says so on its own receipt.
				const overage = sel.included.filter(
					(d) =>
						d.candidate.source === source &&
						/no group could use/.test(d.why)
				)
				expect(overage.length).toBeGreaterThan(0)
			}
			expect(sel.totalTokens).toBeLessThanOrEqual(1000)
		})

		it("still enforces the entry cap, which the sweep cannot lift either", () => {
			const many = Array.from({ length: 30 }, (_, i) =>
				lore({
					id: `w${i}`,
					source: "worldLore",
					tokens: 10,
					position: i
				})
			)
			const sel = select(many, {
				availableTokens: 100_000,
				params: noMinimums(),
				scoreLedAllocation: true
			})
			expect(sel.groups.worldLore.entries).toBe(20)
			expect(
				sel.excluded.filter((d) => d.reason === "excluded_budget")
			).toHaveLength(10)
		})
	})

	// ── Pins, unchanged ─────────────────────────────────────────────────
	describe("pins are decided before the split, either way", () => {
		it("takes them first and does not count them against the entry cap", () => {
			const pins = Array.from({ length: 20 }, (_, i) =>
				lore({ id: `p${i}`, pinned: true, tokens: 1, position: i })
			)
			const sel = select([...pins, lore({ id: "scored", tokens: 1 })], {
				availableTokens: 10_000,
				params: noMinimums(),
				scoreLedAllocation: true
			})
			expect(sel.included.map((d) => d.candidate.id)).toContain("scored")
			expect(sel.groups.worldLore.entries).toBe(1)
		})

		it("drops one the window cannot hold, with the pin's own reason", () => {
			const sel = select(
				[
					lore({ id: "huge", pinned: true, tokens: 5000 }),
					lore({ id: "scored", tokens: 100 })
				],
				{
					availableTokens: 1000,
					params: noMinimums(),
					scoreLedAllocation: true
				}
			)
			const dropped = sel.excluded.find((d) => d.candidate.id === "huge")!
			expect(dropped.reason).toBe("excluded_pinned_token_limit")
			expect(sel.totalTokens).toBeLessThanOrEqual(1000)
		})
	})

	// ── Determinism ─────────────────────────────────────────────────────
	it("is reproducible for a given input, and still ties on authored position", () => {
		// Run replay and the parity harness both read the order back, so the
		// tie-break has to be the authored one and not the sort's mood.
		const run = () =>
			select(
				[
					lore({ id: "second", tokens: 100, position: 2 }),
					lore({ id: "first", tokens: 100, position: 1 }),
					lore({ id: "third", tokens: 100, position: 3 })
				],
				{
					availableTokens: 250,
					params: noMinimums(),
					scoreLedAllocation: true
				}
			)
		const a = run()
		const b = run()
		expect(a.included.map((d) => d.candidate.id)).toEqual([
			"first",
			"second"
		])
		expect(a.included.map((d) => d.candidate.id)).toEqual(
			b.included.map((d) => d.candidate.id)
		)
		expect(a.excluded.map((d) => [d.candidate.id, d.reason])).toEqual(
			b.excluded.map((d) => [d.candidate.id, d.reason])
		)
	})
})

/**
 * Eligibility, kept apart from scoring.
 *
 * The forward-compatibility obligation the retrieval plan states for phases
 * 1–6: R1's clairvoyance filter must be able to exclude a candidate **with a
 * receipt** rather than score it zero, and the shape has to exist before the
 * producer or every mechanism gets re-plumbed to carry a verdict once one does. So
 * these assert the shape and the arithmetic around it, not a rule.
 */
describe("a candidate an eligibility rule excluded", () => {
	const ruled = (over: Partial<Candidate> = {}) =>
		lore({
			ineligible: { reason: "the speaker does not know this" },
			...over
		})

	it("leaves with the rule's own words, not a budget sentence", () => {
		const sel = select([ruled({ id: "x" })], {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		expect(sel.included).toEqual([])
		const dropped = sel.excluded.find((d) => d.candidate.id === "x")!
		expect(dropped.reason).toBe("excluded_ineligible")
		expect(dropped.why).toBe("the speaker does not know this")
	})

	it("is not merely outranked — a minimum cannot bring it back", () => {
		// The whole reason this is not a score of zero. A zero-scored candidate
		// is still a candidate: `minEntries` fills in score order and would
		// take it when nothing else was left.
		const sel = select([ruled({ id: "x" })], {
			availableTokens: 2000,
			params: {
				...DEFAULT_RANKING,
				groups: {
					...DEFAULT_RANKING.groups,
					minEntries: {
						...DEFAULT_RANKING.groups.minEntries,
						worldLore: 5
					}
				}
			}
		})
		expect(sel.included).toEqual([])
		expect(sel.groups.worldLore.entries).toBe(0)
	})

	it("does not take a pin with it either", () => {
		const sel = select([ruled({ id: "x", pinned: true })], {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		expect(sel.included).toEqual([])
		expect(sel.excluded[0]!.reason).toBe("excluded_ineligible")
	})

	it("costs the rest of the pool nothing", () => {
		const rest = [
			lore({ id: "a", tokens: 100 }),
			lore({ id: "b", tokens: 100 })
		]
		const withRule = select([ruled({ id: "x", tokens: 100 }), ...rest], {
			availableTokens: 400,
			params: DEFAULT_RANKING
		})
		const baseline = select(rest, {
			availableTokens: 400,
			params: DEFAULT_RANKING
		})
		expect(withRule.included.map((d) => d.candidate.id)).toEqual(
			baseline.included.map((d) => d.candidate.id)
		)
		expect(withRule.groups).toEqual(baseline.groups)
		expect(withRule.totalTokens).toBe(baseline.totalTokens)
	})

	it("nothing produces it today, so an ordinary pool is untouched", () => {
		const sel = select([lore({ id: "a" })], {
			availableTokens: 2000,
			params: DEFAULT_RANKING
		})
		expect(
			sel.excluded.some((d) => d.reason === "excluded_ineligible")
		).toBe(false)
	})
})

describe("proximity is a signal like the others", () => {
	it("is inert at the shipped weight, and counts once weighted", () => {
		const weights = DEFAULT_SIGNAL_WEIGHTS.worldLore
		expect(weights.proximity).toBe(0)
		expect(score({ keyword: 1, proximity: 1 }, weights)).toBe(
			score({ keyword: 1 }, weights)
		)
		expect(
			score({ keyword: 1, proximity: 1 }, { ...weights, proximity: 0.2 })
		).toBeCloseTo(score({ keyword: 1 }, weights) + 0.2, 10)
	})
})
