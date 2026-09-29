import { describe, expect, test } from "vitest"
import { channelClaims, channelsForCopy, claimOf, primaryLogOf } from "./channelClaims"

const LAIR = ["main", "sanctum"]

describe("channel claims (lair re-plan S1)", () => {
	const settings: Record<string, Record<string, unknown>> = {
		"messages#sanctum": { channel: "sanctum", composer: "minimal" },
		messages: {},
		// Not a conversation copy: its `channel` claims nothing.
		"world-state": { channel: "main" }
	}
	const settingsOf = (id: string) => settings[id]

	test("a placed conversation copy with a channel claims it; nothing else does", () => {
		const claims = channelClaims(["messages", "messages#sanctum", "world-state"], settingsOf)
		expect([...claims]).toEqual([["messages#sanctum", "sanctum"]])
	})

	test("claimed: the copy shows its channel alone", () => {
		const claims = channelClaims(["messages", "messages#sanctum"], settingsOf)
		expect(channelsForCopy(LAIR, claims, "messages#sanctum")).toEqual(["sanctum"])
	})

	test("unclaimed: the primary log shows every channel no copy claims", () => {
		const claims = channelClaims(["messages", "messages#sanctum"], settingsOf)
		expect(channelsForCopy(LAIR, claims, "messages")).toEqual(["main"])
	})

	test("one Messages widget is the whole session, unchanged", () => {
		const claims = channelClaims(["messages"], settingsOf)
		expect(claims.size).toBe(0)
		expect(channelsForCopy(["main", "manuscript"], claims, "messages")).toEqual(["main", "manuscript"])
	})

	test("a copy that is not placed claims nothing: its setting alone moves no channel", () => {
		const claims = channelClaims(["messages"], settingsOf)
		expect(channelsForCopy(LAIR, claims, "messages")).toEqual(LAIR)
	})

	test("a primary log is never left with no channel", () => {
		const claims = channelClaims(["messages", "a#x"], () => undefined)
		const all = new Map([["messages#a", "main"], ["messages#b", "sanctum"]])
		expect(claims.size).toBe(0)
		expect(channelsForCopy(LAIR, all, "messages")).toEqual(LAIR)
	})

	test("the claim is the trimmed channel; blank or not a string is none", () => {
		expect(claimOf({ channel: " sanctum " })).toBe("sanctum")
		expect(claimOf({ channel: "  " })).toBeNull()
		expect(claimOf({ channel: 3 })).toBeNull()
		expect(claimOf(undefined)).toBeNull()
	})
})

describe("the primary log, wherever it sits (brief 7a)", () => {
	const claims = new Map([["messages#sanctum", "sanctum"]])

	test("is the first UNCLAIMED Messages in reading order, not the first Messages", () => {
		// The Lair swapped: the Sanctum in the middle, the story in a side.
		expect(primaryLogOf(["messages#sanctum", "stats", "messages"], claims)).toBe("messages")
	})

	test("is the first Messages when every copy claims a channel", () => {
		expect(primaryLogOf(["world-state", "messages#sanctum"], claims)).toBe("messages#sanctum")
	})

	test("is null when no Messages is placed", () => {
		expect(primaryLogOf(["world-state"], claims)).toBeNull()
	})

	test("the story's log removed from the Lair: the Sanctum panel also shows the story, after its own", () => {
		// Plan M.3.9 — pulled forward with the floor: removing one of two
		// Messages is allowed now, and `main` must not leave with it.
		const log = primaryLogOf(["messages#sanctum"], claims)
		expect(channelsForCopy(LAIR, claims, "messages#sanctum", log)).toEqual(["sanctum", "main"])
	})

	test("with an unclaimed log placed, a claiming copy still shows its channel alone", () => {
		const log = primaryLogOf(["messages", "messages#sanctum"], claims)
		expect(channelsForCopy(LAIR, claims, "messages#sanctum", log)).toEqual(["sanctum"])
		expect(channelsForCopy(LAIR, claims, "messages", log)).toEqual(["main"])
	})
})
