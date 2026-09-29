/**
 * Free placement's two open owner questions (layout plan M.7), built with the
 * plan's RECOMMENDED defaults (brief 7a). If the owner rules the other way,
 * flip the constant in ./placementRules and these tests say what changed.
 *
 * QE (1): when the conversation is not in the middle, the phone and Stage
 * only show the first unclaimed Messages as the stage, wherever it sits.
 * QF (1): Done refuses an empty middle.
 */
import { describe, expect, test } from "vitest"
import {
	EMPTY_MIDDLE_REFUSAL,
	REFUSE_EMPTY_MIDDLE,
	STAGE_FOLLOWS_CONVERSATION,
	emptyMiddleRefusal,
	stageOf
} from "./placementRules"

const noClaims = new Map<string, string>()
const lairClaims = new Map([["messages#sanctum", "sanctum"]])

describe("QE — the stage follows the conversation (recommended (1))", () => {
	test("is the default in force", () => {
		expect(STAGE_FOLLOWS_CONVERSATION).toBe(true)
	})

	test("the conversation in the middle: the middle is the stage, as it always was", () => {
		expect(
			stageOf({ middle: ["world-state", "messages"], left: ["stats"], right: [], claims: noClaims, primaryId: "messages" })
		).toEqual({ id: "messages", zone: "middle" })
	})

	test("the conversation moved into the left column: the left column is the stage", () => {
		expect(
			stageOf({ middle: ["world-state"], left: ["stats", "messages"], right: [], claims: noClaims, primaryId: "messages" })
		).toEqual({ id: "messages", zone: "left" })
	})

	test("the Lair swapped — the Sanctum in the middle, the story in a side: the story is the stage", () => {
		// The first UNCLAIMED Messages, wherever it sits: the Sanctum claims
		// its channel, so it is not the session's log.
		expect(
			stageOf({
				middle: ["messages#sanctum"],
				left: ["stats"],
				right: ["world-state", "messages"],
				claims: lairClaims,
				primaryId: "messages"
			})
		).toEqual({ id: "messages", zone: "right" })
	})

	test("every copy claims a channel: the first one is the stage", () => {
		expect(
			stageOf({ middle: ["board"], left: [], right: ["messages#sanctum"], claims: lairClaims, primaryId: "messages" })
		).toEqual({ id: "messages#sanctum", zone: "right" })
	})

	test("no conversation placed at all: no stage, so nothing is hidden", () => {
		expect(
			stageOf({ middle: ["world-state"], left: [], right: [], claims: noClaims, primaryId: "messages" })
		).toBeNull()
	})

	test("an R71 genre's own primary is its stage", () => {
		expect(
			stageOf({ middle: ["map"], left: ["acme.game:board"], right: [], claims: noClaims, primaryId: "acme.game:board" })
		).toEqual({ id: "acme.game:board", zone: "left" })
	})
})

describe("QF — Done refuses an empty middle (recommended (1))", () => {
	test("is the default in force", () => {
		expect(REFUSE_EMPTY_MIDDLE).toBe(true)
	})

	test("an empty middle is refused, in the plan's words", () => {
		expect(emptyMiddleRefusal([])).toBe("Put a widget in the middle, or move one back.")
		expect(EMPTY_MIDDLE_REFUSAL).toBe("Put a widget in the middle, or move one back.")
	})

	test("any widget in the middle lets Done through — it need not be the conversation", () => {
		expect(emptyMiddleRefusal(["world-state"])).toBeNull()
		expect(emptyMiddleRefusal(["messages"])).toBeNull()
	})
})
