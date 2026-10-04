/**
 * `applyEligibility` — the three hard gates of `core:task/eligibility@1`
 * (plan C2, R2/R4). Every candidate stays; a rule only marks.
 */
import { describe, expect, test } from "vitest"
import { bandIntent, isBandIntent } from "@serene-pub/sdk"
import { applyEligibility } from "./eligibility"

const lore = (id: number, source = "worldLore", payload: Record<string, unknown> = {}) => ({
	id,
	source,
	tokens: 10,
	signals: {},
	payload: { id, ...payload }
})
const items = (out: ReturnType<typeof applyEligibility>) =>
	out.candidates.filter((c) => !isBandIntent(c)) as any[]

describe("applyEligibility", () => {
	test("passes everything through untouched when no rule fires, intents first", () => {
		const intent = bandIntent("worldLore", { share: 0.2 })
		const out = applyEligibility({ candidates: [intent, lore(1), lore(2)] })
		expect(out.candidates[0]).toEqual(intent)
		expect(items(out).map((c) => [c.id, c.ineligible])).toEqual([
			[1, undefined],
			[2, undefined]
		])
		expect(out.diagnostics).toEqual({ excluded: 0, secret: 0, absent: 0, alreadyIneligible: 0 })
	})

	test("an excluded entry brought in again by another mechanism is ineligible with the lane's reason", () => {
		const out = applyEligibility({
			candidates: [lore(1), lore(2), lore(7, "historyEntry")],
			// A nested literal of lists, as a spec wires several lanes.
			exclusions: [
				[{ source: "worldLore", id: 2, reason: "Not while the statue is here." }],
				[{ source: "history", id: 7, reason: "Not here." }]
			]
		})
		const [a, b, c] = items(out)
		expect(a.ineligible).toBeUndefined()
		expect(b.ineligible).toEqual({ reason: "Not while the statue is here." })
		// The vector index's `historyEntry` is the lore read's `history`.
		expect(c.ineligible).toEqual({ reason: "Not here." })
		expect(out.diagnostics.excluded).toBe(2)
	})

	test("a secret is ineligible for any speaker but its holder; with no speaker nothing is re-judged", () => {
		const secret = {
			...lore(4, "relationships", { secretOf: "character:3" })
		}
		const theirs = applyEligibility({ candidates: [secret], speaker: "character:3" })
		expect(items(theirs)[0].ineligible).toBeUndefined()
		const other = applyEligibility({ candidates: [secret], speaker: "character:9" })
		expect(items(other)[0].ineligible?.reason).toMatch(/secret/i)
		expect(other.diagnostics.secret).toBe(1)
		const nobody = applyEligibility({ candidates: [secret], speaker: null })
		expect(items(nobody)[0].ineligible).toBeUndefined()
	})

	test("a member not in the world at the moment has their lore gated; a member with no presences is always present", () => {
		const out = applyEligibility({
			candidates: [
				lore(1, "characterLore", { lorebookBindingId: 10, castMember: "Ada" }),
				lore(2, "characterLore", { lorebookBindingId: 11 }),
				lore(3, "characterLore", { lorebookBindingId: 12 })
			],
			presences: [
				// Ada arrives at Y10 and leaves at Y20 (exclusive).
				{ bindingId: 10, from: { year: 10 }, until: { year: 20 } },
				// #11 is here from Y1, never leaves.
				{ bindingId: 11, from: { year: 1 }, until: null }
			],
			at: { year: 20 }
		})
		const [ada, here, undated] = items(out)
		expect(ada.ineligible).toEqual({ reason: "Ada is not in the world at Year 20." })
		expect(here.ineligible).toBeUndefined()
		expect(undated.ineligible).toBeUndefined()
		expect(out.diagnostics.absent).toBe(1)
	})

	test("the moment is spelled through the book's calendar when the read says how", () => {
		const out = applyEligibility({
			candidates: [lore(1, "characterLore", { lorebookBindingId: 10, castMember: "Ada" })],
			presences: [{ bindingId: 10, from: { year: 10 }, until: { year: 20 } }],
			// `presencesOnReading` hands on the date with its spelling.
			at: { year: 20, month: 2, label: "the 1st of Frostmoon, 20 AR" }
		})
		expect(items(out)[0].ineligible).toEqual({
			reason: "Ada is not in the world at the 1st of Frostmoon, 20 AR."
		})
	})

	test("at the head, a presence that has ended is over", () => {
		const out = applyEligibility({
			candidates: [lore(1, "characterLore", { lorebookBindingId: 10 })],
			presences: [{ bindingId: 10, from: { year: 1 }, until: { year: 5 } }],
			at: null
		})
		expect(items(out)[0].ineligible?.reason).toBe(
			"Cast member #10 is not in the world now."
		)
	})

	test("an already ineligible candidate is left as it came", () => {
		const out = applyEligibility({
			candidates: [{ ...lore(1), ineligible: { reason: "Earlier rule." } }],
			exclusions: [{ source: "worldLore", id: 1, reason: "Later." }]
		})
		expect(items(out)[0].ineligible).toEqual({ reason: "Earlier rule." })
		expect(out.diagnostics.alreadyIneligible).toBe(1)
	})
})
