/**
 * Which oracle streams, read off the shipped documents.
 *
 * Every reply runs end to end (09-B B4): the spec creates its row, its oracles
 * run, its last outlet fills the row. What is still read off the shape is
 * which oracle's tokens are the reply's prose — a run has one live row, and a
 * multi-stage spec has several oracles that must not all write into it. An
 * Adventure spec whose narrator lost its edge to the write would start
 * streaming its planner's JSON to the screen, and nothing shows that as a
 * type error.
 */

import { describe, expect, it } from "vitest"
import { CORE_SPECS } from "@serene-pub/core-catalog"
import { narratingProvider, spineProviders } from "./specShape"

const doc = (slug: string) => CORE_SPECS.find((s) => s.slug === slug)!.build()

describe("the stages on the spine", () => {
	it("counts the spine only — respond's two embed providers sit in blocks", () => {
		expect(
			spineProviders(doc("core:spec/respond")).map((n) => n.key)
		).toEqual(["generate"])
	})

	it("sees all three of an Adventure turn's stages", () => {
		expect(
			spineProviders(doc("core:spec/adventure-respond")).map((n) => n.key)
		).toEqual(["planWrite", "scene", "keeperWrite"])
	})
})

describe("which stage streams", () => {
	it("is the one whose text fills the placeholder, on every reply spec", () => {
		for (const slug of [
			"core:spec/respond",
			"core:spec/narrate",
			"core:spec/narrate-character"
		])
			expect(narratingProvider(doc(slug)), slug).toBe("generate")
	})

	it("is the narrator, not the planner that fed it", () => {
		// The planner is an ancestor of the reply too — its plan is in the
		// narrator's context — so nearest wins over earliest.
		expect(narratingProvider(doc("core:spec/adventure-respond"))).toBe(
			"scene"
		)
	})

	it("is nothing when the document has no message to write", () => {
		expect(
			narratingProvider(doc("core:spec/adventure-advance-time"))
		).toBeUndefined()
	})
})
