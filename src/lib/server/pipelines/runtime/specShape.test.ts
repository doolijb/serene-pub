/**
 * Which oracle streams, read off the shipped documents.
 *
 * Every reply runs end to end (09-B B4): the spec creates its row, its oracles
 * run, its last outlet fills the row. Which oracle's tokens are the reply's
 * prose is DECLARED on the node (`expose.stream`, lair pass B3, owner D6
 * 2026-09-27) — a run has one live row, and a multi-step spec has several
 * oracles that must not all write into it. The inferred rule it replaced
 * streamed the Lair's planner JSON to the screen (F3).
 */

import { describe, expect, it } from "vitest"
import { CORE_SPECS } from "@serene-pub/core-catalog"
import type { SpecDocument } from "@serene-pub/sdk"
import {
	budgetedProviderOf,
	previewProviders,
	providerSteps,
	replyCallOf,
	replyLoadoutSteps,
	stepStatuses,
	streamingSteps
} from "./specShape"

/** The declared streaming steps, sorted — a set compares badly. */
const streamingKeys = (d: SpecDocument) => [...streamingSteps(d)].sort()

const doc = (slug: string) =>
	CORE_SPECS.find((s) => s.slug === slug)!.build() as unknown as SpecDocument

// The sprite picker (`core:oracle/pick-sprite@1`, 2026-10-05) is an oracle
// written into every reply spec after `save` — so it is counted here, and
// always after the reply's own step: the preview halts at that one first,
// and `budgetConnectionOf` reads the budget's own node.
describe("the steps a preview can stop before", () => {
	it("reads a junction's branches — never a gather's embed providers", () => {
		// 🚧 2026-10-23 (D7): Story's reply writes inside its `reply` junction, beside
		// *Replies carry changes*; each branch's call is a preview stop. RF fix 3: the
		// sprite pick runs once after the junction — three stops, and one run calls two.
		const d = doc("core:spec/story-respond")
		const keys = previewProviders(d).map((n) => n.key)
		const [streams] = [...streamingSteps(d)]
		expect(keys).toContain(streams)
		expect(keys).toContain(budgetedProviderOf(d)!.key)
		for (const n of previewProviders(d)) {
			expect(n.definitionId).not.toBe("core:oracle/embed-text")
			const clause = d.clauses.find((c) => c.id === n.clauseId)
			expect(clause?.kind ?? "junction", n.key).toBe("junction")
		}
		expect(keys.length).toBe(3)
		expect(previewProviders(d).filter((n) => !n.clauseId).map((n) => n.definitionId)).toEqual(["core:oracle/pick-sprite"])
		expect(providerSteps(d)).toBe(2)
	})

	it("is the spine where there is no junction", () => {
		const d = doc("core:spec/guide-respond")
		expect(previewProviders(d).every((n) => !n.clauseId)).toBe(true)
		expect(providerSteps(d)).toBe(previewProviders(d).length)
	})

	// The transcribe step (`heard`, O9) is an oracle on the spine's line,
	// before the reply, and the preview runs through it
	// (`previewRunsThrough`): it prepares the prompt, it is not the call that
	// sends it — so the providers skip it as the executor's preview halt does.
	it("skips an oracle the preview runs through — the transcribe step", () => {
		const d = doc("core:spec/story-respond")
		const heard = d.nodes.find((n) => n.definitionId === "core:oracle/transcribe-audio")
		expect(heard, "story-respond carries a transcribe step").toBeTruthy()
		expect(heard!.clauseId ?? null).toBeNull()
		expect(previewProviders(d).map((n) => n.key)).not.toContain(heard!.key)
	})
})

describe("the reply's model call", () => {
	it("is the node the budget is sized for — the streaming reply, on a junction too", () => {
		for (const slug of ["core:spec/story-respond", "core:spec/guide-respond", "core:spec/story-narrate"]) {
			const d = doc(slug)
			expect(budgetedProviderOf(d)?.key, slug).toBe([...streamingSteps(d)][0])
		}
	})

	it("is the budgeted call a spec runs on the Reply loadout — never Look's `write`", () => {
		const d = doc("core:spec/story-respond")
		expect(replyCallOf(d)?.key).toBe(budgetedProviderOf(d)!.key)
		expect(replyCallOf(doc("core:spec/guide-respond"))?.key).toBe(budgetedProviderOf(doc("core:spec/guide-respond"))!.key)
		expect(budgetedProviderOf(doc("core:spec/story-look"))).toBeTruthy()
		expect(replyCallOf(doc("core:spec/story-look"))).toBeUndefined()
		// A spec that budgets nothing makes no reply call by this rule.
		expect(replyCallOf(doc("core:spec/story-generate-image"))).toBeUndefined()
	})

	it("runs on the Reply loadout, every branch of it", () => {
		const d = doc("core:spec/story-respond")
		const steps = replyLoadoutSteps(d)
		expect(steps).toContain(budgetedProviderOf(d)!.key)
		// Both of the reply's alternatives — the prose and *Replies carry changes*.
		expect(steps.length).toBe(2)
		for (const key of steps) expect(d.nodes.find((n) => n.key === key)?.kind).toBe("oracle")
		expect(replyLoadoutSteps(doc("core:spec/story-look"))).toEqual([])
	})
})

describe("which step streams — declared (lair pass B3, D6)", () => {
	it("is the declared generate on every single-step reply spec", () => {
		// 🚧 Story's reply streams the generate of its `reply` junction's prose branch (D7, 2026-10-23).
		expect(streamingKeys(doc("core:spec/story-respond"))).toEqual(["reply.prose.generate"])
		for (const slug of [
			"core:spec/story-narrate",
			"core:spec/story-side-character",
			"core:spec/guide-respond"
		])
			expect(streamingKeys(doc(slug)), slug).toEqual(["generate"])
	})


	// Changed 2026-09-27 (lair pass B15, owner D2a): a pick is the picked
	// delver's own turn and streams their line — the other branch of `pick`.
	// And 2026-09-28 (lair re-plan R6): the Castellan's Sanctum reply, on the
	// `channel` junction's other arm. And 2026-09-30 (party speech, owner
	// ruling: "they are character turns"): a character turn's line, or the
	// Castellan's lines for the party — the two arms of the play's `speech`
	// junction. Rewritten 2026-10-21 (Lair rewrite L3, R13): no Castellan
	// speaks for the party — a character turn is `pick.picked`.
	it("is the Lair's narration, its Sanctum talk or a character turn — never the planner (F3)", () => {
		expect(streamingKeys(doc("core:spec/lair-reply"))).toEqual([
			"via.narrate.say",
			"via.turn.channel.sanctum.say",
			"via.turn.channel.story.pick.picked.say"
		])
	})

	it("is nothing when the document declares nothing", () => {
		expect(
			streamingKeys(doc("core:spec/story-advance-time"))
		).toEqual([])
		// Ask's oracle answers in JSON: it streamed its document into the row
		// under the inferred rule, and a JSON step never streams now.
		expect(streamingKeys(doc("core:spec/story-ask"))).toEqual([])
	})

	it("is never a JSON step, on any core spec", () => {
		for (const s of CORE_SPECS) {
			const d = s.build() as unknown as SpecDocument
			for (const key of streamingKeys(d)) {
				const node = d.nodes.find((n) => n.key === key)!
				expect(node.definitionId, s.slug).not.toBe("core:oracle/generate-json")
			}
		}
	})
})

describe("what a step says while it runs — declared (lair pass B18, D5)", () => {
	it("maps each declared node to its status, and leaves the rest out", () => {
		const statuses = stepStatuses(doc("core:spec/lair-reply"))
		expect(statuses.get("via.turn.channel.story.pick.planned.planWrite")).toEqual({
			i18n: { en: "The Castellan is planning the turn" }
		})
		// The books are the keeper routine's now (Lair rewrite D7), declared on its own document.
		expect(stepStatuses(doc("core:spec/lair-keeper")).size).toBeGreaterThan(0)
		expect(statuses.has("via.turn.channel.story.pick.planned.planPrompt")).toBe(false)
	})
})
