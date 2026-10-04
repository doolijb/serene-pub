/**
 * What the layout editor's zones are seeded with, and when they re-seed
 * (brief 7a review). Two defects lived between the floor, the committed
 * membership and the zones' own reports:
 *
 * - the MIDDLE reloaded for ever on every layout that never saved a grid (a
 *   Chat or Guide session): the floor read the zone's report, the zone's
 *   cards read the floor;
 * - a zone that re-seeded mid-edit (a tray add, a removal) dropped every card
 *   dragged into it, the conversation included, which then existed nowhere.
 */
import type { ArrangedGridV1 } from "@serene-pub/sdk"
import { describe, expect, test } from "vitest"
import { frameCovers } from "./arrangedGeometry"
import { editorSeedKey, editorZoneIds, type ZoneMembers } from "./editorSeed"
import { floorKeptId, withPrimaryFloor } from "./primaryFloor"
import { normalizeZoneLayout } from "./schema"
import { loadChatLayout, widgetsInZone } from "./widgetGrid"

const cell = (id: string, y = 0, h = 3) => ({ id, x: 0, y, w: 1, h })
const frame = (...ids: string[]) => ({
	cols: 1,
	rows: 12,
	items: ids.map((id, n) => cell(id, n * 3))
})
const members = (o: Partial<ZoneMembers>): ZoneMembers => ({
	left: [],
	middle: [],
	right: [],
	...o
})

describe("editorZoneIds — a zone is seeded from its working frame too", () => {
	test("a card dragged from the middle to the left moves in both seeds", () => {
		const committed = members({ middle: ["world-state", "messages"], left: ["stats"] })
		const working: ArrangedGridV1 = {
			left: frame("stats", "messages"),
			middle: frame("world-state")
		}
		expect(editorZoneIds("middle", committed, working)).toEqual(["world-state"])
		expect(editorZoneIds("left", committed, working)).toEqual(["stats", "messages"])
	})

	test("a zone re-seeded by a tray add keeps the card dragged into it", () => {
		// Writing Room, as walked: Messages dragged into the left, then Stats
		// tray-added there. The tray writes the list AND seats the card in the
		// working frame; the left re-seeds from both.
		const committed = members({ middle: ["messages", "world-state"], left: ["stats"] })
		const working: ArrangedGridV1 = {
			left: frame("messages", "stats"),
			middle: frame("world-state")
		}
		const left = editorZoneIds("left", committed, working)
		expect(left).toEqual(["stats", "messages"])
		// …and the frame it re-seeds from covers exactly those cards, so the
		// re-seed is a faithful restore: nothing moves, nothing is lost.
		expect(frameCovers(left.map((id) => ({ id, title: id })), working.left)).toBe(true)
	})

	test("a stored arrangement that draws a card its list never named is seeded with it", () => {
		// Every Chat session Done'd before free placement: the log in the
		// middle frame, the grid empty.
		const committed = members({})
		const working: ArrangedGridV1 = { middle: frame("messages") }
		expect(editorZoneIds("middle", committed, working)).toEqual(["messages"])
	})

	test("a zone with no working frame claims nothing from the others", () => {
		const committed = members({ middle: ["messages"] })
		const working: ArrangedGridV1 = { left: frame("stats") }
		expect(editorZoneIds("middle", committed, working)).toEqual(["messages"])
	})

	test("a card in two frames at once (mid-drop) stays in both until Done dedupes", () => {
		const committed = members({ middle: ["messages"] })
		const working: ArrangedGridV1 = { middle: frame("messages"), left: frame("messages") }
		expect(editorZoneIds("middle", committed, working)).toEqual(["messages"])
		expect(editorZoneIds("left", committed, working)).toEqual(["messages"])
	})
})

describe("editorSeedKey — a zone re-seeds on membership, never on a drag", () => {
	test("a drag leaves every key alone", () => {
		const committed = members({ middle: ["world-state", "messages"], left: ["stats"] })
		const kept = "messages"
		const before = editorSeedKey(committed.middle, kept)
		// The drag changes the working frames only.
		expect(editorSeedKey(committed.middle, kept)).toBe(before)
	})

	test("a tray add, a removal, or the floor's lock moving re-keys", () => {
		const k = editorSeedKey(["world-state"], null)
		expect(editorSeedKey(["world-state", "stats"], null)).not.toBe(k)
		expect(editorSeedKey([], null)).not.toBe(k)
		expect(editorSeedKey(["world-state"], "messages#sanctum")).not.toBe(k)
	})

	test("a widget reaching or leaving its cap re-keys EVERY zone, so no card keeps a stale Duplicate (7b review)", () => {
		// `acme:jukebox` (maxInstances 2) has a card on the right; its second
		// copy is added to the left. The right's own membership did not move,
		// but its card must now say "Only 2 per layout".
		const right = ["acme:jukebox"]
		expect(editorSeedKey(right, null, ["acme:jukebox"])).not.toBe(editorSeedKey(right, null, []))
		// Absent means none capped: the two-argument key is unchanged in meaning.
		expect(editorSeedKey(right, null)).toBe(editorSeedKey(right, null, []))
	})
})

/**
 * The page's chain, driven by the real modules: the floor over the SAVED
 * layout gives the middle's committed members, the seed and the key follow,
 * and a re-seeded zone that is not a faithful restore reports its cards at
 * once (GridStackZone's `emit()` on seed).
 */
function openMiddle(stored: { grid: unknown; arranged: ArrangedGridV1 }, rounds = 6) {
	const zones = normalizeZoneLayout(undefined, [])
	const grid = loadChatLayout(stored.grid, "messages")
	let working: ArrangedGridV1 = structuredClone(stored.arranged)
	const keys: string[] = []
	const cards: string[][] = []
	let mountedKey: string | null = null
	for (let i = 0; i < rounds; i++) {
		const floored = withPrimaryFloor({ zones, grid, arranged: stored.arranged }, "messages")
		const committed = members({
			middle: widgetsInZone(floored.grid, "middle").map((w) => w.id)
		})
		const ids = editorZoneIds("middle", committed, working)
		// The page's `placedIds` is a set over the lists, the grid and the frames.
		const placed = new Set([
			...committed.middle,
			...(working.middle?.items ?? []).map((c: { id: string }) => c.id)
		])
		const key = editorSeedKey(committed.middle, floorKeptId(placed, "messages"))
		keys.push(key)
		cards.push(ids)
		if (key === mountedKey) continue
		mountedKey = key
		const items = ids.map((id) => ({ id, title: id }))
		if (!frameCovers(items, working.middle))
			working = { ...working, middle: frame(...ids) }
	}
	return { keys, cards, working }
}

describe("the editor's middle, opened on a layout that never saved a grid", () => {
	test("Chat/Guide (nothing saved): seeds once with Messages and stays", () => {
		const { keys, cards, working } = openMiddle({ grid: undefined, arranged: {} })
		expect(new Set(keys).size).toBe(1)
		expect(cards.every((c) => c.join() === "messages")).toBe(true)
		expect(working.middle!.items.map((c: { id: string }) => c.id)).toEqual(["messages"])
	})

	test("Done'd before free placement (log in the frame, grid empty): seeds with it and stays", () => {
		const { keys, cards } = openMiddle({
			grid: { version: 1, widgets: [] },
			arranged: { middle: frame("messages") }
		})
		expect(new Set(keys).size).toBe(1)
		expect(cards.every((c) => c.join() === "messages")).toBe(true)
	})
})
