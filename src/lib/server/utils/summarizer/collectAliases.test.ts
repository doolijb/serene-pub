/**
 * lorebookBindings.absorbedAliases carries an invariant in its own schema
 * comment: "Every consumer that reads `aliases` for name-matching or display
 * must union it with this column — see availableSceneCast.ts's
 * collectAliases()."
 *
 * That function did not exist. The union was open-coded at three call sites and
 * simply absent at a fourth — the graph build's seed list — which is the worst
 * possible place to omit it: an identity absorbed by a merge was invisible to
 * the build, so the build re-proposed the duplicate the merge had just
 * resolved. Every merge, forever.
 *
 * These pin the helper's contract. The fourth site is covered by
 * narrativeGraph's own tests plus `npm run check`, since it now calls this.
 */
import { describe, expect, test } from "vitest"
import { collectAliases, entryMatches } from "./availableSceneCast"

describe("collectAliases", () => {
	test("unions aliases with absorbedAliases", () => {
		expect(
			collectAliases({
				aliases: ["Ari"],
				absorbedAliases: ["The Scout"]
			})
		).toEqual(["Ari", "The Scout"])
	})

	test("an absorbed identity is included — the case the graph build was missing", () => {
		// A binding whose own aliases were replaced wholesale by an entity sync
		// still has to answer to the name it absorbed.
		const binding = { aliases: [], absorbedAliases: ["Commander Thorne"] }
		expect(
			entryMatches(
				{ name: "Maren", aliases: collectAliases(binding), id: 1 },
				"Commander Thorne"
			)
		).toBe(true)
	})

	test("tolerates null/undefined columns", () => {
		expect(collectAliases({})).toEqual([])
		expect(
			collectAliases({ aliases: null, absorbedAliases: null })
		).toEqual([])
	})

	test("dedupes case-insensitively and drops blanks", () => {
		expect(
			collectAliases({
				aliases: ["Ari", "  ", "ari"],
				absorbedAliases: ["ARI", "Scout"]
			})
		).toEqual(["Ari", "Scout"])
	})

	test("returns a fresh mutable array — callers push their own extras onto it", () => {
		// buildSceneCastList appends parent-binding names; the graph build
		// appends child names. Returning a shared or frozen array would break
		// both.
		const binding = { aliases: ["Ari"], absorbedAliases: [] }
		const first = collectAliases(binding)
		first.push("Child Name")
		expect(collectAliases(binding)).toEqual(["Ari"])
	})

	test("scope is the mandated pair only — no caller-specific extras", () => {
		// The canonical name is duplicateBindingDetection's addition and child
		// names are the graph build's; neither belongs to the invariant, so
		// neither may leak in here.
		expect(
			collectAliases({ aliases: ["Ari"], absorbedAliases: [] })
		).not.toContain("Maren")
	})
})
