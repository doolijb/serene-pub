/**
 * 🚧 Derived numbers (PROPOSAL-layering §7; lane 5b): a preset's calls per
 * turn and write targets read from what it registers — checked against the
 * numbers core's cards print (lane 3's parity: Minimal 1, Living 2, Rule
 * Based 2, Chat Basic 1, Agentic 1, Guide 1). The measured half (a real
 * turn) is `sockets/sessions.genreParity.int.test.ts`.
 */
import { describe, expect, it } from "vitest"
import { effectiveRegistrations, genreDefaultsOf, getGenre, parseActionIdentity, type SpecDocument } from "@serene-pub/sdk"
import { CORE_SPECS, closeOutAction, coreGenres, corePresetSeeds } from "@serene-pub/core-catalog"
import { derivedNumbersOf, modelCallsOf, writeTargetsOf } from "./derived"

const docs = () => {
	coreGenres()
	return new Map<string, SpecDocument | null>(CORE_SPECS.map((s) => [s.slug, s.build() as SpecDocument]))
}

describe("a pipeline's model calls — the longest path through its branches", () => {
	it("the reply is one call; a routine's one call sits behind its on-branch", () => {
		const d = docs()
		expect(modelCallsOf(d.get("core:spec/story-respond")!)).toBe(1)
		expect(modelCallsOf(d.get("core:spec/story-reckoning")!)).toBe(1)
		expect(modelCallsOf(d.get("core:spec/story-sweep")!)).toBe(1)
		expect(modelCallsOf(d.get("core:spec/guide-respond")!)).toBe(1)
	})

	it("write targets are a pipeline's write steps, once each", () => {
		const d = docs()
		expect(writeTargetsOf(d.get("core:spec/story-reckoning")!)).toEqual(
			expect.arrayContaining(["core:outlet/create-lore-entry", "core:outlet/advance-story-clock"])
		)
	})
})

describe("core presets: what the card prints is what the registrations derive", () => {
	const want: Record<string, number> = {
		"core-story-minimal": 1,
		"core-story-living": 2,
		"core-story-rule-based": 2,
		"core-chat-basic": 1,
		"core-chat-agentic": 1,
		"core-guide-default": 1
	}
	it.each(Object.entries(want))("%s costs %i call(s) a turn", (seedKey, n) => {
		const d = docs()
		const seed = corePresetSeeds().find((s) => s.seedKey === seedKey)
		expect(seed, seedKey).toBeTruthy()
		const defaults = genreDefaultsOf(getGenre(seed!.genreId))?.registrations ?? []
		const derived = derivedNumbersOf(effectiveRegistrations(defaults, seed!.registrations), d)
		expect(derived.callsPerTurn).toBe(n)
		// ⏳ Still stated on the card; it must agree.
		if (seed!.callsPerTurn != null) expect(seed!.callsPerTurn).toBe(n)
		expect(derived.replyCalls).toBe(1)
		expect(derived.writeTargets.some((t) => t.id === "core:outlet/create-message")).toBe(true)
	})

	it("Living counts the reckoning (after each round); Minimal drops it, and with it its writes", () => {
		const d = docs()
		const of = (seedKey: string) => {
			const seed = corePresetSeeds().find((s) => s.seedKey === seedKey)!
			return derivedNumbersOf(
				effectiveRegistrations(genreDefaultsOf(getGenre(seed.genreId))?.registrations ?? [], seed.registrations),
				d
			)
		}
		expect(of("core-story-living").perTurnRoutines).toEqual([expect.stringContaining("story-reckoning")])
		expect(of("core-story-minimal").perTurnRoutines).toEqual([])
		// The sweep's lore writes go with it; what still writes lore on Minimal
		// is a summary a person asks for (R50: the summaries are registered
		// too) — a summarize action, or the scene's Close out (pr-6 B4).
		const seed = corePresetSeeds().find((s) => s.seedKey === "core-story-minimal")!
		const regs = effectiveRegistrations(genreDefaultsOf(getGenre(seed.genreId))?.registrations ?? [], seed.registrations)
		const lore = regs.filter((r) => {
			const doc = d.get(r.pipeline)
			return !!doc && writeTargetsOf(doc).includes("core:outlet/create-lore-entry")
		})
		expect(lore.length).toBeGreaterThan(0)
		const asksForSummary = (r: (typeof lore)[number]) => {
			if (r.trigger.family !== "action") return false
			const action = (r.trigger as { action: string }).action
			return /#summarize-/.test(action) || parseActionIdentity(action)?.key === closeOutAction.key
		}
		expect(lore.every(asksForSummary)).toBe(true)
	})
})
