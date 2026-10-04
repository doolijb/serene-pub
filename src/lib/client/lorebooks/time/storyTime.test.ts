/**
 * Story time, as arithmetic — what sits on the line, whose lane it is on, and
 * what carries no date at all.
 */
import { describe, expect, it } from "vitest"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import {
	buildLanes,
	castArrivals,
	dropOffer,
	readInLine,
	storyItems,
	timeHeaderLine,
	timeListGroups,
	undatedEntries,
	undatedLine
} from "./storyTime"

const entries = [
	{
		id: 1,
		typeId: HISTORY_TYPE_ID,
		year: 1,
		month: 1,
		day: null,
		content: "The Archive is founded.\nNobody signs for it."
	},
	{
		id: 2,
		typeId: HISTORY_TYPE_ID,
		year: 3,
		month: 2,
		day: 2,
		content: "First visit."
	},
	{ id: 7, typeId: WORLD_LORE_TYPE_ID, name: "Night Ferry", content: "…" }
]

const scenes = [
	{
		id: 4,
		historyEntryId: 2,
		name: "Arrival at the door",
		summary: "Wren knocks.",
		selectedMessageIds: [11, 12, 13],
		participantCharacters: [20, 21]
	},
	{
		id: 5,
		historyEntryId: 2,
		name: "Marrow goes missing",
		summary: null,
		selectedMessageIds: [14],
		participantCharacters: [21]
	}
]

const cast = [
	{ id: 20, name: "Verity" },
	{ id: 21, name: "Wren" },
	{ id: 22, name: "Hollis" }
]

describe("storyItems — what sits on the line", () => {
	it("puts every dated entry on the line, oldest first", () => {
		const items = storyItems({ entries, scenes: [] })
		expect(items.map((i) => i.key)).toEqual(["entry#1", "entry#2"])
	})

	it("leaves an entry with no date off the line", () => {
		const items = storyItems({ entries, scenes: [] })
		expect(items.some((i) => i.key === "entry#7")).toBe(false)
	})

	it("reads a dated entry by what happened, not by its date", () => {
		const items = storyItems({ entries, scenes: [] })
		expect(items[0].label).toBe("The Archive is founded.")
	})

	it("falls back to the date for an entry with nothing written in it", () => {
		const items = storyItems({
			entries: [{ id: 9, typeId: HISTORY_TYPE_ID, year: 4, content: "" }],
			scenes: []
		})
		expect(items[0].label).toBe("Year 4")
	})

	it("sits a scene at the date of the entry it was compiled into", () => {
		const items = storyItems({ entries, scenes })
		const scene = items.find((i) => i.key === "scene#4")
		expect(scene?.value).toBe(30202)
		expect(scene?.date).toEqual({ year: 3, month: 2, day: 2 })
	})

	it("says how much of a session a scene holds", () => {
		const items = storyItems({ entries, scenes })
		expect(items.find((i) => i.key === "scene#4")?.note).toBe("3 messages")
	})

	it("says when a scene has not been compiled", () => {
		const items = storyItems({ entries, scenes })
		expect(items.find((i) => i.key === "scene#5")?.note).toBe(
			"not yet compiled"
		)
	})

	it("drops a scene whose entry carries no date", () => {
		const items = storyItems({
			entries: [],
			scenes: [{ id: 4, historyEntryId: 2 }]
		})
		expect(items).toEqual([])
	})

	it("puts the session that is reading the book at now", () => {
		const items = storyItems({
			entries,
			scenes,
			session: { id: 8, name: "The Open Door" }
		})
		const last = items[items.length - 1]
		expect(last.kind).toBe("session")
		expect(last.label).toBe("The Open Door")
		expect(last.value).toBeNull()
	})

	it("carries a dated entry's cast up from the scenes it was compiled from", () => {
		const items = storyItems({ entries, scenes })
		expect(items.find((i) => i.key === "entry#2")?.present).toEqual([
			20, 21
		])
	})
})

describe("buildLanes — one line per person, and the story's own", () => {
	const items = storyItems({
		entries,
		scenes,
		session: { id: 8, name: "The Open Door" }
	})

	it("opens with the story's own lane", () => {
		expect(buildLanes(items, cast)[0].id).toBe("story")
	})

	it("gives a lane to each cast member the line names", () => {
		expect(
			buildLanes(items, cast)
				.filter((l) => l.kind === "cast")
				.map((l) => l.label)
		).toEqual(["Verity", "Wren"])
	})

	it("gives no lane to a member nothing dated names", () => {
		expect(buildLanes(items, cast).some((l) => l.label === "Hollis")).toBe(
			false
		)
	})

	it("puts on a member's lane only what they are present in", () => {
		const wren = buildLanes(items, cast).find((l) => l.label === "Wren")
		expect(wren?.items.map((i) => i.key)).toEqual([
			"entry#2",
			"scene#4",
			"scene#5"
		])
	})

	it("closes with the World lane, which stands even while it is empty", () => {
		const lanes = buildLanes(items, cast)
		const world = lanes[lanes.length - 1]
		expect(world.kind).toBe("world")
		expect(world.items).toEqual([])
	})
})

describe("undated entries — what is not on the line", () => {
	it("names every entry carrying no date", () => {
		expect(undatedEntries(entries).map((e) => e.id)).toEqual([7])
	})

	it("counts them out loud, with what can be done about them", () => {
		expect(undatedLine(21)).toBe(
			"21 entries carry no date, drag one onto the line, or leave it timeless"
		)
	})

	it("says it of one entry the way one entry reads", () => {
		expect(undatedLine(1)).toBe(
			"1 entry carries no date, drag it onto the line, or leave it timeless"
		)
	})
})

describe("dropOffer — what dropping a row on the line can do", () => {
	it("dates an entry whose kind carries date fields", () => {
		expect(dropOffer({ id: 1, typeId: HISTORY_TYPE_ID })).toBe("date")
	})

	it("offers a dated entry about a row whose kind carries none", () => {
		expect(dropOffer({ id: 7, typeId: WORLD_LORE_TYPE_ID })).toBe(
			"history-about"
		)
	})
})

describe("timeHeaderLine — the line said out loud", () => {
	it("counts the dated entries, the scenes and the gaps", () => {
		expect(timeHeaderLine({ dated: 9, scenes: 2, gaps: 1 })).toBe(
			"9 dated entries · 2 scenes · 1 gap"
		)
	})

	it("leaves the gaps out when there are none", () => {
		expect(timeHeaderLine({ dated: 9, scenes: 2, gaps: 0 })).toBe(
			"9 dated entries · 2 scenes"
		)
	})

	it("says one of each the way one reads", () => {
		expect(timeHeaderLine({ dated: 1, scenes: 1, gaps: 2 })).toBe(
			"1 dated entry · 1 scene · 2 gaps"
		)
	})
})

describe("readInLine — where a dated entry stands in what was read", () => {
	it("gives the rank out of the dated entries", () => {
		expect(readInLine(3, 9)).toBe("Read in · rank 3 of 9 dated entries")
	})

	it("says what rank one is the most recent of", () => {
		expect(readInLine(1, 9)).toBe(
			"Read in · rank 1 of 9 dated entries · most recent before now"
		)
	})

	it("counts one dated entry the way one reads", () => {
		expect(readInLine(1, 1)).toBe(
			"Read in · rank 1 of 1 dated entry · most recent before now"
		)
	})
})

describe("castArrivals — the first dated thing naming each member", () => {
	it("keys the earliest appearance by binding id", () => {
		const items = storyItems({ entries, scenes })
		expect([...castArrivals(items).entries()]).toEqual([
			[20, 30202],
			[21, 30202]
		])
	})

	it("orders by the calendar, not the packed value (radix-100 collision)", () => {
		const collide = [
			{ id: 30, typeId: HISTORY_TYPE_ID, year: 2, month: 1, day: 1 },
			// Day 150 of Year 1 packs past Year 2 (10000 + 15000 > 20101).
			{ id: 31, typeId: HISTORY_TYPE_ID, year: 1, month: 1, day: 150 }
		]
		const items = storyItems({
			entries: collide,
			scenes: [
				{ id: 40, historyEntryId: 30, participantCharacters: [9] },
				{ id: 41, historyEntryId: 31, participantCharacters: [9] }
			]
		})
		expect(items.filter((i) => i.kind === "history").map((i) => i.id)).toEqual(
			[31, 30]
		)
		// Member 9 arrives at Y1 day 150, not at Y2.
		expect(castArrivals(items).get(9)).toBe(items.find((i) => i.id === 31)!.value)
	})

	it("leaves out a member only something undated names", () => {
		const items = storyItems({
			entries,
			scenes,
			session: { id: 8, name: "The Open Door" }
		})
		expect(castArrivals(items).has(8)).toBe(false)
	})
})

/** Note 4: a history entry's scenes are nested under it, never interleaved. */
describe("timeListGroups", () => {
	it("files each scene under its history entry, in story order", () => {
		const groups = timeListGroups(storyItems({ entries, scenes }))
		expect(groups.map((g) => g.item.key)).toEqual(["entry#1", "entry#2"])
		expect(groups[1].children.map((c) => c.key)).toEqual([
			"scene#4",
			"scene#5"
		])
		expect(groups[0].children).toEqual([])
	})

	it("keeps a scene whose entry is not on the list as a row of its own", () => {
		const items = storyItems({ entries, scenes }).filter(
			(i) => i.key !== "entry#2"
		)
		const groups = timeListGroups(items)
		expect(groups.map((g) => g.item.key)).toEqual([
			"entry#1",
			"scene#4",
			"scene#5"
		])
	})

	it("never files a history entry under anything", () => {
		for (const item of storyItems({ entries, scenes }))
			if (item.kind === "history") expect(item.parentKey).toBeUndefined()
	})
})
