/**
 * The routing rule, read off the shipped documents.
 *
 * Both halves matter and they fail in opposite directions. A chat spec that
 * grew a second Provider onto its spine would silently move every ordinary
 * reply onto the full-run road; an Adventure spec that lost one would move the
 * genre back onto the preview shortcut and start shipping its planner's JSON to
 * the screen again. Neither shows up as a type error.
 */

import { describe, expect, it } from "vitest"
import { CORE_SPECS } from "@serene-pub/core-catalog"
import {
	narratingProvider,
	runsToCompletion,
	spineProviders
} from "./specShape"

const doc = (slug: string) => CORE_SPECS.find((s) => s.slug === slug)!.build()

describe("which road a reply takes", () => {
	it("keeps chat on the adapter path", () => {
		const respond = doc("core:spec/respond")
		// Three Providers, two of them inside retrieval blocks — which is why
		// the count is of the SPINE and not of the document.
		expect(spineProviders(respond).map((n) => n.key)).toEqual(["generate"])
		expect(runsToCompletion(respond)).toBe(false)
	})

	it("keeps both narrator specs on the adapter path", () => {
		for (const slug of ["core:spec/narrate", "core:spec/narrate-character"])
			expect(runsToCompletion(doc(slug)), slug).toBe(false)
	})

	it("runs an Adventure turn to completion", () => {
		const adventure = doc("core:spec/adventure-respond")
		expect(spineProviders(adventure).map((n) => n.key)).toEqual([
			"planWrite",
			"scene",
			"keeperWrite"
		])
		expect(runsToCompletion(adventure)).toBe(true)
	})
})

describe("which stage streams", () => {
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
