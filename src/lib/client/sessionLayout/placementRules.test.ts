/**
 * Free placement's two open owner questions (layout plan M.7), built with the
 * plan's RECOMMENDED defaults (brief 7a). If the owner rules the other way,
 * flip the constant in ./placementRules and these tests say what changed.
 *
 * QE (1): when the conversation is not in the middle, the phone and Stage
 * only show the first unclaimed Messages as the stage, wherever it sits.
 */
import { describe, expect, test } from "vitest"
import {
	STAGE_FOLLOWS_CONVERSATION,
	primaryLogPick,
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

	test("no conversation placed at all (R-B): the primary panel is the stage", () => {
		expect(
			stageOf({ middle: ["world-state"], left: ["stats"], right: [], claims: noClaims, primaryId: "messages" })
		).toEqual({ id: "world-state", zone: "middle" })
	})

	test("no conversation and nothing in the middle: the first side panel is the stage; nothing at all, none", () => {
		expect(
			stageOf({ middle: [], left: [], right: ["map"], claims: noClaims, primaryId: "messages" })
		).toEqual({ id: "map", zone: "right" })
		expect(stageOf({ middle: [], left: [], right: [], claims: noClaims, primaryId: "messages" })).toBeNull()
	})

	test("an R71 genre's own primary is its stage", () => {
		expect(
			stageOf({ middle: ["map"], left: ["acme.game:board"], right: [], claims: noClaims, primaryId: "acme.game:board" })
		).toEqual({ id: "acme.game:board", zone: "left" })
	})
})

describe("primaryLogPick — where the log IS, whatever QE draws", () => {
	test("in a side, it names that side (the desktop keeps that side docked)", () => {
		expect(
			primaryLogPick({ middle: ["world-state"], left: [], right: ["stats", "messages"], claims: noClaims, primaryId: "messages" })
		).toEqual({ id: "messages", zone: "right" })
	})

	test("a claiming copy is passed over for the unclaimed log", () => {
		expect(
			primaryLogPick({ middle: ["messages#sanctum"], left: ["messages"], right: [], claims: lairClaims, primaryId: "messages" })
		).toEqual({ id: "messages", zone: "left" })
	})
})
