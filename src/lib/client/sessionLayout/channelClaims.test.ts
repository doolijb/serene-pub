import { describe, expect, test } from "vitest"
import { NO_LANE_CHANNEL } from "@serene-pub/core-catalog/conversation"
import {
	channelClaims,
	channelsForCopy,
	claimOf,
	laneClaimOf,
	laneClaims,
	pageIdsHolders,
	primaryLogOf,
	type LaneContext
} from "./channelClaims"

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

/**
 * More than one Messages widget (brief 7b, plan §M.3.8 as amended by its
 * review): the page's message ids (`#message-<id>`, j/k, notification links)
 * go to the primary log and to every other copy whose channels no mount
 * holding them already shows — so every drawn row has exactly one page id —
 * and a second view of one channel takes its box's prefix.
 */
describe("a third Messages, pinned to a channel (brief 7b)", () => {
	const settings: Record<string, Record<string, unknown>> = {
		"messages#sanctum": { channel: "sanctum" },
		// The third: a second Sanctum panel, pinned to the same channel.
		"messages#3": { channel: "sanctum" }
	}
	const placed = ["messages", "messages#sanctum", "messages#3"]
	const claims = channelClaims(placed, (id) => settings[id])

	test("both claiming copies show their channel alone; the story's log shows the rest", () => {
		const log = primaryLogOf(placed, claims)
		expect(log).toBe("messages")
		expect(channelsForCopy(LAIR, claims, "messages#sanctum", log)).toEqual(["sanctum"])
		expect(channelsForCopy(LAIR, claims, "messages#3", log)).toEqual(["sanctum"])
		expect(channelsForCopy(LAIR, claims, "messages", log)).toEqual(["main"])
	})

	test("the story's log and the FIRST Sanctum keep their ids; the second Sanctum is prefixed", () => {
		// The Sanctum placed first in reading order: the story's log is still
		// taken first, and the first Sanctum after it.
		expect([...pageIdsHolders(["messages#sanctum", "messages#3", "messages"], claims, LAIR)]).toEqual([
			"messages",
			"messages#sanctum"
		])
	})

	test("the shipped Lair — story and Sanctum — keeps every row's page id (the review's landing defect)", () => {
		const lair = channelClaims(["messages", "messages#sanctum"], (id) => settings[id])
		const held = pageIdsHolders(["messages", "messages#sanctum"], lair, LAIR)
		expect([...held]).toEqual(["messages", "messages#sanctum"])
	})

	test("two unclaimed views of the story: the first in reading order holds the ids", () => {
		const two = channelClaims(["messages#2", "messages"], () => undefined)
		expect([...pageIdsHolders(["messages#2", "messages"], two, LAIR)]).toEqual(["messages#2"])
		// …and both show the same rows, which is why the other is prefixed.
		expect(channelsForCopy(LAIR, two, "messages", "messages#2")).toEqual(LAIR)
		expect(channelsForCopy(LAIR, two, "messages#2", "messages#2")).toEqual(LAIR)
	})

	test("every copy claiming: the first Messages (showing the rest too) holds, a different channel's copy too", () => {
		expect([...pageIdsHolders(["world-state", "messages#3", "messages#sanctum"], claims, LAIR)]).toEqual([
			"messages#3"
		])
		const split = new Map([
			["messages#a", "sanctum"],
			["messages#b", "main"]
		])
		// `#a` is the log (the first Messages) and shows `sanctum` + the rest
		// (none); `#b` shows `main`, which nothing holding ids shows.
		expect([...pageIdsHolders(["messages#a", "messages#b"], split, LAIR)]).toEqual(["messages#a", "messages#b"])
	})

	test("every channel claimed AND an unclaimed view: the view shows them all, so it alone holds", () => {
		const all = new Map([
			["messages#a", "main"],
			["messages#b", "sanctum"]
		])
		// The unclaimed `messages` shows every channel (none is left over) and
		// is the primary log: taken first, it covers both claimers' rows.
		expect([...pageIdsHolders(["messages#a", "messages#b", "messages"], all, LAIR)]).toEqual(["messages"])
	})

	test("before the session's channels arrive, the answer is the same as after (no remount as the page loads)", () => {
		const lair = channelClaims(["messages", "messages#sanctum", "messages#3"], (id) => settings[id])
		const order = ["messages", "messages#sanctum", "messages#3"]
		expect([...pageIdsHolders(order, lair, [])]).toEqual([...pageIdsHolders(order, lair, LAIR)])
		const two = channelClaims(["messages", "messages#2"], () => undefined)
		expect([...pageIdsHolders(["messages", "messages#2"], two, [])]).toEqual(["messages"])
	})

	test("none placed: nobody holds them; an R71 genre's own primary never does", () => {
		expect(pageIdsHolders(["world-state"], claims, LAIR).size).toBe(0)
		expect(pageIdsHolders(["acme.game:board"], new Map(), LAIR).size).toBe(0)
	})
})

describe("🚧 lane claims (channelLane, lanes by person on the server)", () => {
	const PARLEY = ["main", "parley"]
	const settings: Record<string, Record<string, unknown>> = {
		messages: {},
		"messages#parley": { channel: "parley", channelLane: "mine" }
	}
	const placed = ["messages", "messages#parley"]
	const storedOf = (id: string) => settings[id]
	/** `SessionV1.channels` as the host says it for one viewer. */
	const channelsWith = (mine?: string): LaneContext["channels"] => [
		{ slug: "main", lanes: "shared" },
		{ slug: "parley", lanes: "personal", ...(mine ? { mine } : {}) }
	]
	const ctx = (mine?: string): LaneContext => ({ viewerId: 3, annex: null, channels: channelsWith(mine) })

	test("mine: the viewer's lane from the host, always explicit", () => {
		expect(laneClaimOf(settings["messages#parley"], ctx("parley:2"))).toBe("parley:2")
		// Lane 1 is that lane alone, never the whole channel.
		expect(laneClaimOf(settings["messages#parley"], ctx("parley"))).toBe("parley:1")
	})

	test("🚧 mine with no lane yet: the whole claimed channel, server-narrowed — a guest's lane opened after the page loaded still shows (the 100-turn walk, B2)", () => {
		expect(laneClaimOf(settings["messages#parley"], ctx())).toBeUndefined()
	})

	test("mine naming another channel's lane: no lane", () => {
		expect(laneClaimOf(settings["messages#parley"], ctx("sanctum:2"))).toBe(NO_LANE_CHANNEL)
	})

	test("mine when the host said nothing, or on a shared channel: the whole claimed channel (the server already narrowed it)", () => {
		expect(laneClaimOf(settings["messages#parley"], { viewerId: 3, annex: null })).toBeUndefined()
		expect(
			laneClaimOf(settings["messages#parley"], {
				viewerId: 3,
				annex: null,
				channels: [{ slug: "parley", lanes: "shared" }]
			})
		).toBeUndefined()
	})

	test("a number is that lane; unset, blank or junk reads no lane; no claimed channel reads none", () => {
		expect(laneClaimOf({ channel: "parley", channelLane: "3" }, ctx())).toBe("parley:3")
		expect(laneClaimOf({ channel: "parley" }, ctx("parley:2"))).toBeUndefined()
		expect(laneClaimOf({ channel: "parley", channelLane: "  " }, ctx("parley:2"))).toBeUndefined()
		expect(laneClaimOf({ channel: "parley", channelLane: "theirs" }, ctx("parley:2"))).toBeUndefined()
		expect(laneClaimOf({ channelLane: "mine" }, ctx("parley:2"))).toBeUndefined()
	})

	test("⏳ a stored channelLaneFrom reads as mine", () => {
		const legacy = { channel: "parley", channelLaneFrom: "annex:core.dungeon-crawler-lanes" }
		expect(claimOf(legacy)).toBe("parley")
		expect(laneClaimOf(legacy, ctx("parley:2"))).toBe("parley:2")
		expect(laneClaimOf(legacy, ctx())).toBeUndefined()
		expect(laneClaimOf({ channel: "parley", channelLaneFrom: "  " }, ctx("parley:2"))).toBeUndefined()
	})

	test("the copy shows the viewer's lane, else its whole channel; the channel stays claimed", () => {
		const claims = channelClaims(placed, storedOf)
		expect(claims.get("messages#parley")).toBe("parley")
		const mine = laneClaims(placed, storedOf, ctx("parley:2"))
		expect(channelsForCopy(PARLEY, claims, "messages#parley", "messages", mine)).toEqual(["parley:2"])
		expect(channelsForCopy(PARLEY, claims, "messages", "messages", mine)).toEqual(["main"])
		const none = laneClaims(placed, storedOf, ctx())
		expect(channelsForCopy(PARLEY, claims, "messages#parley", "messages", none)).toEqual(["parley"])
		expect(channelsForCopy(PARLEY, claims, "messages", "messages", none)).toEqual(["main"])
		// The lane copy as the primary log keeps the unclaimed channels after its own.
		expect(channelsForCopy(PARLEY, claims, "messages#parley", "messages#parley", none)).toEqual(["parley", "main"])
		// Another channel's lane named as mine: nothing.
		const wrong = laneClaims(placed, storedOf, ctx("sanctum:2"))
		expect(channelsForCopy(PARLEY, claims, "messages#parley", "messages", wrong)).toEqual([NO_LANE_CHANNEL])
	})
})

describe("a layout holding no conversation (R-B, no lock)", () => {
	const order = ["places", "stats", "world-state"]
	const settingsOf = (id: string) => (id === "world-state" ? { channel: "main" } : {})

	test("nothing claims, there is no primary log, and no mount holds the page's ids", () => {
		const claims = channelClaims(order, settingsOf)
		expect(claims.size).toBe(0)
		expect(primaryLogOf(order, claims)).toBeNull()
		expect([...pageIdsHolders(order, claims, LAIR)]).toEqual([])
	})

	test("no lane claims either, and a copy asked about anyway gets the whole log", () => {
		expect(laneClaims(order, settingsOf, { viewerId: 1, annex: null }).size).toBe(0)
		expect(channelsForCopy(LAIR, new Map(), "places", null)).toEqual(LAIR)
	})
})
