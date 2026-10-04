/**
 * The write-side refusal of runaway patterns (plan lorebooks-consolidation S3)
 * — what `entries:create`, `entries:update` and an entry amendment all call.
 */

import { describe, it, expect } from "vitest"
import { assertNoRunawayPatterns } from "$lib/server/utils/lorebookEntries"

const refused = /The pattern “\(a\+\)\+\$” can't be saved: it repeats a group/

describe("assertNoRunawayPatterns", () => {
	it("refuses a new regex entry holding a runaway pattern", () => {
		expect(() =>
			assertNoRunawayPatterns({ keys: ["dragon", "(a+)+$"], matchMode: "regex" }, null)
		).toThrow(refused)
		expect(() =>
			assertNoRunawayPatterns({ keys: ["dragon"], useRegex: true, secondaryKeys: ["(a+)+$"] }, null)
		).toThrow(refused)
	})

	it("lets ordinary patterns, and runaway-looking literals, through", () => {
		expect(() =>
			assertNoRunawayPatterns({ keys: ["\\bdragons?\\b", "(ab){2,3}"], matchMode: "regex" }, null)
		).not.toThrow()
		// Not a regex entry: the key is text, matched by substring.
		expect(() => assertNoRunawayPatterns({ keys: ["(a+)+$"] }, null)).not.toThrow()
		expect(() =>
			assertNoRunawayPatterns({ keys: ["(a+)+$"], matchMode: "word", useRegex: true }, null)
		).not.toThrow()
	})

	it("refuses a key an update adds to a regex entry", () => {
		const stored = { keys: ["dragon"], secondaryKeys: [], matchMode: "regex", useRegex: false }
		expect(() => assertNoRunawayPatterns({ keys: ["dragon", "(a+)+$"] }, stored)).toThrow(
			refused
		)
	})

	it("refuses switching an entry to regex when its stored keys would run away", () => {
		const stored = { keys: ["(a+)+$"], secondaryKeys: [], matchMode: null, useRegex: false }
		expect(() => assertNoRunawayPatterns({ matchMode: "regex" }, stored)).toThrow(refused)
		expect(() => assertNoRunawayPatterns({ useRegex: true }, stored)).toThrow(refused)
	})

	it("does not re-judge a pattern the row already held, so its other fields stay editable", () => {
		const stored = { keys: ["(a+)+$"], secondaryKeys: [], matchMode: "regex", useRegex: false }
		expect(() =>
			assertNoRunawayPatterns({ keys: ["(a+)+$"], matchMode: "regex" }, stored)
		).not.toThrow()
		expect(() => assertNoRunawayPatterns({ content: "edited" } as any, stored)).not.toThrow()
	})

	describe("across an entry's amendments", () => {
		const plain = { keys: ["dragon"], secondaryKeys: [], matchMode: null, useRegex: false }

		it("refuses a later overlay switching to regex when an earlier one stored the keys", () => {
			// Each passes against the row alone; together they read the
			// runaway key as a pattern from the second overlay's date.
			const keysOverlay = { keys: ["(a+)+$"] }
			expect(() =>
				assertNoRunawayPatterns(keysOverlay, plain, { overlays: [], overlay: { replaces: null } })
			).not.toThrow()
			expect(() =>
				assertNoRunawayPatterns({ matchMode: "regex" }, plain, {
					overlays: [keysOverlay],
					overlay: { replaces: null }
				})
			).toThrow(refused)
		})

		it("refuses keys an overlay adds when another overlay made the entry regex", () => {
			expect(() =>
				assertNoRunawayPatterns({ keys: ["(a+)+$"] }, plain, {
					overlays: [{ matchMode: "regex" }],
					overlay: { replaces: null }
				})
			).toThrow(refused)
		})

		it("refuses switching the row to regex while an overlay holds the keys", () => {
			expect(() =>
				assertNoRunawayPatterns({ useRegex: true }, plain, { overlays: [{ keys: ["(a+)+$"] }] })
			).toThrow(refused)
		})

		it("reads a mode an overlay sets back to plain as plain", () => {
			// `matchMode: substring` outranks `useRegex`, in every pairing.
			const row = { keys: ["(a+)+$"], secondaryKeys: [], matchMode: "substring", useRegex: true }
			expect(() =>
				assertNoRunawayPatterns({ matchMode: "word" }, row, {
					overlays: [],
					overlay: { replaces: null }
				})
			).not.toThrow()
		})

		it("does not re-judge a key some reading already ran as a pattern", () => {
			const legacy = { keys: ["(a+)+$"], secondaryKeys: [], matchMode: "regex", useRegex: false }
			const was = { keys: ["(a+)+$", "ember"] }
			expect(() =>
				assertNoRunawayPatterns({ keys: ["(a+)+$", "embers"] }, legacy, {
					overlays: [],
					overlay: { replaces: was }
				})
			).not.toThrow()
		})
	})
})
