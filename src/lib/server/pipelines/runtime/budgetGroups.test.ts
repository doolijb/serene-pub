/**
 * The vector index's vocabulary reaching a budget group.
 *
 * ⚠ This exists because it did not. `select` keys its groups by the five
 * bands and drops anything else as `excluded_unknown_source`;
 * the vector mechanism publishes the index's own spelling, and only `worldLore` and
 * `characterLore` are spelled the same on both sides. So a spec using the
 * documented semantic chain — `vector-search → rank-semantic → rank-hybrid`,
 * which is the shape `ragParityPipeline` and the SDK use-cases both build —
 * lost every message, history entry and relationship on the way into the
 * budget, and lost them silently: no shipped spec wires the vector mechanism, so
 * nothing in the corpus could go red.
 *
 * The assertions start at the ranker's in-port and end at the selection,
 * because a rename in the middle is invisible from either end alone.
 */

import { describe, it, expect } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

const rank = (candidates: any[], params: Record<string, unknown> = {}) =>
	coreBindings()["core:task/rank-hybrid@1"]!(
		{ candidates, budget: { remaining: 2000 }, params },
		{} as any
	) as Promise<any>

const candidate = (id: string, source: string) => ({
	id,
	source,
	tokens: 10,
	signals: { keyword: 1 },
	presetScore: 1
})

const reasonFor = (r: any, id: string) =>
	r.value.decisions.find((d: any) => d.candidate.id === id)?.reason

describe("index sources that are a budget group under another name", () => {
	it("selects a message, a history entry and a relationship", async () => {
		const r = await rank([
			// Relationships ship with a share of zero — off by default, not
			// absent — so the band is opened here the way its source opens it
			// (R-7 P5): a band intent at the head of the list, as
			// `relationship-search` publishes. Without it the mapping would be
			// provable only for two of the three, and the receipt reason
			// (`excluded_group_disabled`) is asserted below as the other half
			// of the same claim.
			{ band: "relationships", intent: { share: 0.2, maxEntries: 5 } },
			candidate("m", "message"),
			candidate("h", "historyEntry"),
			candidate("rel", "narrativeRelationship")
		])
		expect(r.value.candidates.map((c: any) => c.id).sort()).toEqual([
			"h",
			"m",
			"rel"
		])
		// Renamed, not merely admitted: Assemble keys its sections off the same
		// five names, so a survivor still spelled `historyEntry` would have
		// rendered nowhere.
		expect(r.value.candidates.map((c: any) => c.source).sort()).toEqual([
			"history",
			"messages",
			"relationships"
		])
		expect(r.value.groups.messages.entries).toBe(1)
		expect(r.value.groups.history.entries).toBe(1)
		expect(r.value.groups.relationships.entries).toBe(1)
	})

	it("puts a relationship in its own group even when that group is off", async () => {
		// The distinction the receipt exists to draw: `relationships` is a
		// group the user turned down to zero, and saying so is a different
		// answer from "nothing here knows what that is".
		const r = await rank([candidate("rel", "narrativeRelationship")])
		expect(reasonFor(r, "rel")).toBe("excluded_group_disabled")
	})
})

describe("index sources with no budget group at all", () => {
	it("still excludes graph nodes, characters and personas, with a reason", async () => {
		// Deliberately unmapped: which share a narrative node or a cast row
		// should draw against is a budgeting decision nobody has taken, and
		// guessing one here would spend context on it on every turn.
		const r = await rank([
			candidate("n", "narrativeNode"),
			candidate("c", "character"),
			candidate("p", "persona")
		])
		expect(r.value.candidates).toEqual([])
		for (const id of ["n", "c", "p"])
			expect(reasonFor(r, id)).toBe("excluded_unknown_source")
	})
})

describe("the keyword mechanism", () => {
	it("passes through untouched", async () => {
		// Its candidates already carry budget vocabulary, and none of the three
		// mapped keys is a band spelling — so a pool merged from both
		// mechanisms is renamed on exactly the half that needs it.
		const r = await rank([
			candidate("w", "worldLore"),
			candidate("cl", "characterLore"),
			candidate("hist", "history"),
			candidate("msg", "messages")
		])
		// Sorted, because inclusion order is the ranker's business — the
		// message floor is filled before the shares are split — and this
		// assertion is about the spelling, not the ordering.
		expect(
			r.value.candidates.map((c: any) => `${c.id}:${c.source}`).sort()
		).toEqual([
			"cl:characterLore",
			"hist:history",
			"msg:messages",
			"w:worldLore"
		])
	})
})
