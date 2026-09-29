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
import { spineProviders, stepStatuses, streamingSteps } from "./specShape"

/** The declared streaming steps, sorted — a set compares badly. */
const streamingKeys = (d: SpecDocument) => [...streamingSteps(d)].sort()

const doc = (slug: string) =>
	CORE_SPECS.find((s) => s.slug === slug)!.build() as unknown as SpecDocument

describe("the steps on the spine", () => {
	it("counts the spine only — respond's two embed providers sit in blocks", () => {
		expect(
			spineProviders(doc("core:spec/respond")).map((n) => n.key)
		).toEqual(["generate"])
	})

	it("sees all three of an Adventure turn's steps", () => {
		expect(
			spineProviders(doc("core:spec/adventure-respond")).map((n) => n.key)
		).toEqual(["planWrite", "scene", "keeperWrite"])
	})
})

describe("which step streams — declared (lair pass B3, D6)", () => {
	it("is the declared generate on every single-step reply spec", () => {
		for (const slug of [
			"core:spec/respond",
			"core:spec/narrate",
			"core:spec/narrate-character",
			"core:spec/guide-respond"
		])
			expect(streamingKeys(doc(slug)), slug).toEqual(["generate"])
	})

	it("is Adventure's and Whodunit's narrator, not the planner that fed it", () => {
		expect(streamingKeys(doc("core:spec/adventure-respond"))).toEqual(["scene"])
		expect(streamingKeys(doc("core:spec/whodunit-respond"))).toEqual(["scene"])
	})

	// Changed 2026-09-27 (lair pass B15, owner D2a): a pick is the picked
	// delver's own turn and streams their line — the other branch of `pick`.
	// And 2026-09-28 (lair re-plan R6): the Castellan's Sanctum reply, on the
	// `channel` junction's other arm.
	it("is the Lair's narrator, a picked delver or the Castellan — never the planner (F3)", () => {
		expect(streamingKeys(doc("core:spec/lair-respond"))).toEqual([
			"via.narrate.say",
			"via.turn.channel.sanctum.say",
			"via.turn.channel.story.pick.picked.say",
			"via.turn.channel.story.pick.planned.door.play.lead.speaks.say"
		])
	})

	it("is nothing when the document declares nothing", () => {
		expect(
			streamingKeys(doc("core:spec/adventure-advance-time"))
		).toEqual([])
		// Ask's oracle answers in JSON: it streamed its document into the row
		// under the inferred rule, and a JSON step never streams now.
		expect(streamingKeys(doc("core:spec/adventure-ask"))).toEqual([])
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

	it("is both of the Writing Room's branch steps — only one branch ever runs (W2)", () => {
		expect(streamingKeys(doc("core:spec/writing-room-respond"))).toEqual([
			"turn.manuscript.write",
			"turn.talk.say"
		])
	})
})

describe("what a step says while it runs — declared (lair pass B18, D5)", () => {
	it("maps each declared node to its status, and leaves the rest out", () => {
		const statuses = stepStatuses(doc("core:spec/lair-respond"))
		expect(statuses.get("via.turn.channel.story.pick.planned.planWrite")).toEqual({
			i18n: { en: "The Castellan is planning the turn" }
		})
		expect(statuses.get("keep.played.keeperWrite")).toEqual({
			i18n: { en: "Keeping the books" }
		})
		expect(statuses.has("via.turn.channel.story.pick.planned.planPrompt")).toBe(false)
	})
})
