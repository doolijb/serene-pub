/**
 * Where the log is, and the zone a phone or full screen opens on (PLAN
 * 2026-11-05 ★3).
 */
import { describe, expect, test } from "vitest"
import { fullscreenActive, openingZone, primaryLogPick } from "./placementRules"

const noClaims = new Map<string, string>()
const lairClaims = new Map([["messages#sanctum", "sanctum"]])
const isMessages = (id: string) => id === "messages" || id.startsWith("messages#")

describe("primaryLogPick — where the log IS", () => {
	test("in a side, it names that side", () => {
		expect(
			primaryLogPick({ middle: ["world-state"], left: [], right: ["stats", "messages"], claims: noClaims, primaryId: "messages" })
		).toEqual({ id: "messages", zone: "right" })
	})

	test("a claiming copy is passed over for the unclaimed log", () => {
		expect(
			primaryLogPick({ middle: ["messages#sanctum"], left: ["messages"], right: [], claims: lairClaims, primaryId: "messages" })
		).toEqual({ id: "messages", zone: "left" })
	})

	test("every copy claims a channel: the first one is the log", () => {
		expect(
			primaryLogPick({ middle: ["board"], left: [], right: ["messages#sanctum"], claims: lairClaims, primaryId: "messages" })
		).toEqual({ id: "messages#sanctum", zone: "right" })
	})

	test("no conversation placed: none", () => {
		expect(
			primaryLogPick({ middle: ["world-state"], left: ["stats"], right: [], claims: noClaims, primaryId: "messages" })
		).toBeNull()
	})
})

describe("openingZone — the zone a phone or full screen opens on (★3)", () => {
	const open = (
		o: { middle?: string[]; left?: string[]; right?: string[]; claims?: Map<string, string>; primaryId?: string }
	) =>
		openingZone({
			middle: o.middle ?? [],
			left: o.left ?? [],
			right: o.right ?? [],
			claims: o.claims ?? noClaims,
			primaryId: o.primaryId ?? "messages",
			isMessages
		})

	test("the conversation in the middle: the middle", () => {
		expect(open({ middle: ["world-state", "messages"], left: ["stats"] })).toBe("middle")
	})

	test("the conversation moved into a side: that side", () => {
		expect(open({ middle: ["world-state"], left: ["stats", "messages"] })).toBe("left")
		expect(open({ middle: ["world-state"], right: ["messages"] })).toBe("right")
	})

	test("the Lair swapped — the Sanctum in the middle, the story in a side: the story's side", () => {
		expect(
			open({
				middle: ["messages#sanctum"],
				left: ["stats"],
				right: ["world-state", "messages"],
				claims: lairClaims
			})
		).toBe("right")
	})

	test("every copy claims a channel: the first one's zone", () => {
		expect(open({ middle: ["board"], right: ["messages#sanctum"], claims: lairClaims })).toBe("right")
	})

	test("an R71 genre's primary that is placed leads, even beside a Messages copy", () => {
		expect(
			open({ middle: ["messages"], left: ["acme.game:board"], primaryId: "acme.game:board" })
		).toBe("left")
	})

	test("an R71 primary not placed: the first zone holding a Messages copy, middle first", () => {
		expect(
			open({ left: ["messages#a"], right: ["messages#b"], primaryId: "acme.game:board" })
		).toBe("left")
		expect(
			open({ middle: ["map"], right: ["messages#b"], primaryId: "acme.game:board" })
		).toBe("right")
	})

	test("no Messages anywhere, or nothing placed: the middle", () => {
		expect(open({ middle: ["world-state"], left: ["stats"] })).toBe("middle")
		expect(open({ right: ["map"] })).toBe("middle")
		expect(open({})).toBe("middle")
	})
})

describe("fullscreenActive", () => {
	test("follows the session control", () => {
		expect(fullscreenActive({ fullscreen: true })).toBe(true)
		expect(fullscreenActive({ fullscreen: false })).toBe(false)
		expect(fullscreenActive(undefined)).toBe(false)
	})
})
