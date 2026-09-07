import { describe, it, expect } from "vitest"
import {
	linkNote,
	rankEntityLinks,
	type EntityLinkHit
} from "$lib/server/pipelines/ranking/entityLink"

const hit = (over: Partial<EntityLinkHit> = {}): EntityLinkHit => ({
	entryId: 1,
	mention: "the order",
	name: "The Ashguard Riders",
	nameKind: "title",
	score: 0.8,
	position: 1,
	...over
})

describe("ranking links", () => {
	it("keeps one link per entry — the best one", () => {
		// The question is "is this entry the thing the scene is describing",
		// which is a maximum over the descriptions used, not a sum over them:
		// summing lets an entry win by being vaguely near five unrelated
		// phrases.
		const ranked = rankEntityLinks(
			[
				hit({ mention: "the order", score: 0.4 }),
				hit({ mention: "the riders", score: 0.9 }),
				hit({ mention: "the gate", score: 0.2 })
			],
			5
		)
		expect(ranked).toHaveLength(1)
		expect(ranked[0]!.mention).toBe("the riders")
	})

	it("ranks on match quality, with proximity as the tie-break", () => {
		// Ruling R4's "proximity and match quality" — proximity orders and does
		// not scale, because a decay constant is the per-corpus calibration the
		// ruling exists to remove.
		const ranked = rankEntityLinks(
			[
				hit({ entryId: 1, score: 0.5, position: 1 }),
				hit({ entryId: 2, score: 0.9, position: 0 }),
				hit({ entryId: 3, score: 0.5, position: 0.5 })
			],
			5
		)
		expect(ranked.map((l) => l.entryId)).toEqual([2, 1, 3])
	})

	it("bounds by a count and never by a similarity", () => {
		// ⚠ There is no threshold in this file, deliberately: "is 0.62 a match"
		// has no answer that survives changing the encoder. A weak link is kept
		// when there is room and dropped when better ones fill the cap.
		const weak = [1, 2, 3, 4].map((entryId) =>
			hit({ entryId, score: 0.05 * entryId })
		)
		expect(rankEntityLinks(weak, 2).map((l) => l.entryId)).toEqual([4, 3])
		expect(rankEntityLinks(weak, 10)).toHaveLength(4)
	})

	it("is deterministic at the cap", () => {
		const tied = [3, 1, 2].map((entryId) => hit({ entryId, score: 0.5 }))
		expect(rankEntityLinks(tied, 2).map((l) => l.entryId)).toEqual([1, 2])
	})

	it("treats a cap of zero as off", () => {
		expect(rankEntityLinks([hit()], 0)).toEqual([])
	})

	it("ignores a comparison that is not evidence", () => {
		// A zero or negative similarity is "no more alike than unrelated". It
		// must not rank and it must not subtract — adding a mechanism may only
		// add matches.
		expect(
			rankEntityLinks([hit({ score: 0 }), hit({ score: -0.4 })], 5)
		).toEqual([])
	})
})

describe("the receipt line", () => {
	it("says which description reached which name", () => {
		// A keyword hit explains itself; a vector link does not, so a wrong one
		// has to be visible rather than mysterious.
		expect(linkNote(hit())).toBe(
			"matched “the order” → The Ashguard Riders"
		)
	})
})
