import { describe, expect, test } from "vitest"
import { castFaceSrc, memberFaceSrc } from "./memberFace"

describe("memberFaceSrc / castFaceSrc", () => {
	const card = { avatarMediaId: 7 }

	test("a retold face is drawn in full on the member's page, as a thumbnail in a list disc", () => {
		expect(memberFaceSrc({ faceMediaId: 41, retold: { face: true } })).toBe(
			"/media/41"
		)
		expect(
			memberFaceSrc({ faceMediaId: 41, retold: { face: true } }, { full: false })
		).toBe("/media/41?v=thumb")
		// A list disc, the same size as the card avatars beside it.
		expect(castFaceSrc({ faceMediaId: 41, retold: { face: true } }, card)).toBe(
			"/media/41?v=thumb"
		)
	})

	test("a face kept but not retold falls back to the card's avatar", () => {
		expect(memberFaceSrc({ faceMediaId: 41, retold: { face: false } })).toBe(
			undefined
		)
		expect(castFaceSrc({ faceMediaId: 41, retold: {} }, card)).toBe(
			"/media/7?v=thumb"
		)
	})

	test("retold with no picture falls back too", () => {
		expect(castFaceSrc({ faceMediaId: null, retold: { face: true } }, card)).toBe(
			"/media/7?v=thumb"
		)
		expect(castFaceSrc({ retold: { face: true } }, null)).toBeUndefined()
	})
})
