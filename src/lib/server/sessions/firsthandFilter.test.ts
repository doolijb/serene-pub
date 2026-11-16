import { describe, expect, test } from "vitest"
import {
	firsthandViewOf,
	wasThereFor,
	keptLineIds,
	keptSceneIds,
	leftOutEntryIds,
	historyExclusionReason,
	historyReceipt,
	linesReceipt,
	placeKeyOf,
	readsAllReceipt,
	scenesReceipt,
	valueInForce,
	type FirsthandLine,
	type FirsthandView
} from "./firsthandFilter"

const ME = 1
const OTHER = 2

/** scenes: sceneId → lines; `places`: `member:messageId` → value (a step function is built by the test). */
function viewOf(opts: {
	scenes: Record<number, FirsthandLine[]>
	open?: number[]
	/** Scenes with no live line whose stored cast holds the member. */
	stored?: number[]
	slotId?: string | null
	slotTracked?: boolean
	place?: (member: number, messageId: number) => string | null
	/** History entry → its scenes (ascending). */
	entries?: Record<number, number[]>
}): FirsthandView {
	const sceneOfLine = new Map<number, number>()
	const sceneLines = new Map<number, FirsthandLine[]>()
	const spokeInSceneIds = new Set<number>()
	for (const [id, lines] of Object.entries(opts.scenes)) {
		sceneLines.set(Number(id), lines)
		for (const l of lines) {
			sceneOfLine.set(l.id, Number(id))
			if (l.castMemberId === ME) spokeInSceneIds.add(Number(id))
		}
	}
	return {
		memberId: ME,
		name: "Verity",
		slotId: opts.slotId ?? null,
		slotTracked: opts.slotTracked ?? true,
		sceneOfLine,
		sceneLines,
		openSceneIds: new Set(opts.open ?? []),
		spokeInSceneIds,
		storedCastSceneIds: new Set(opts.stored ?? []),
		scenesOfEntry: new Map(Object.entries(opts.entries ?? {}).map(([k, v]) => [Number(k), v])),
		placeAt: opts.place ?? (() => null)
	}
}
const L = (id: number, castMemberId: number | null): FirsthandLine => ({ id, castMemberId })

describe("by scene", () => {
	const scenes = {
		10: [L(1, OTHER), L(2, ME), L(3, OTHER)],
		20: [L(4, OTHER), L(5, OTHER)]
	}
	test("the member was there for a scene it spoke in; one it never spoke in is left out", () => {
		const v = viewOf({ scenes })
		expect(keptLineIds(v, [L(1, OTHER), L(3, OTHER), L(4, OTHER), L(5, OTHER)])).toEqual({
			keptIds: [1, 3],
			leftOut: 2
		})
	})
	test("own lines are kept even in a scene judged elsewhere", () => {
		const v = viewOf({ scenes: { 20: [L(4, OTHER), L(5, ME)] } })
		expect(wasThereFor(v, L(5, ME))).toBe(true)
	})
	test("an open scene is kept for the speaker", () => {
		const v = viewOf({ scenes, open: [20] })
		expect(wasThereFor(v, L(4, OTHER))).toBe(true)
	})
	test("a line in no scene is kept", () => {
		expect(wasThereFor(viewOf({ scenes }), L(99, OTHER))).toBe(true)
	})
	test("a member who spoke only outside the judged lines was still there", () => {
		const v = viewOf({ scenes })
		// Only the other's lines of scene 10 are judged; the member's own line is not among them.
		expect(keptLineIds(v, [L(1, OTHER), L(3, OTHER)]).leftOut).toBe(0)
	})
})

describe("by place", () => {
	// The member is in the hall until message 5, then the yard; the other is in the yard from 3.
	const place = (m: number, id: number): string | null =>
		m === ME ? (id < 5 ? "hall" : "yard") : id < 3 ? null : "yard"
	const scenes = { 10: [L(1, OTHER), L(2, OTHER), L(3, OTHER), L(4, OTHER), L(6, OTHER)] }
	test("equal values keep, different values leave out, missing falls back to the scene", () => {
		const v = viewOf({ scenes, slotId: "x:slot/place@1", place })
		// 1, 2: the other has no value yet, scene never spoken in: out. 3, 4: hall vs yard: out. 6: yard = yard: kept.
		expect(keptLineIds(v, scenes[10]).keptIds).toEqual([6])
	})
	test("the member's own lines are kept", () => {
		const v = viewOf({ scenes, slotId: "x:slot/place@1", place })
		expect(wasThereFor(v, L(3, ME))).toBe(true)
	})
	test("rule 2 can leave out a line of a scene the member spoke in", () => {
		const v = viewOf({
			scenes: { 10: [L(1, ME), L(2, OTHER)] },
			slotId: "x:slot/place@1",
			place: (m) => (m === ME ? "hall" : "yard")
		})
		expect(wasThereFor(v, L(2, OTHER))).toBe(false)
	})
	test("rule 2 can keep a line of a scene the member never spoke in", () => {
		const v = viewOf({
			scenes: { 10: [L(2, OTHER)] },
			slotId: "x:slot/place@1",
			place: () => "hall"
		})
		expect(wasThereFor(v, L(2, OTHER))).toBe(true)
	})
	test("the member's missing value falls back to the scene", () => {
		const v = viewOf({
			scenes: { 10: [L(2, OTHER)] },
			slotId: "x:slot/place@1",
			place: (m) => (m === ME ? null : "yard")
		})
		expect(wasThereFor(v, L(2, OTHER))).toBe(false)
	})
	test("a speaker-less line falls back to the scene", () => {
		const v = viewOf({
			scenes: { 10: [L(2, null)] },
			slotId: "x:slot/place@1",
			place: () => "hall"
		})
		expect(wasThereFor(v, L(2, null))).toBe(false)
	})
})

describe("summaries", () => {
	const seen = (id: number): FirsthandLine[] => [L(id, ME)]
	test("the last line the member was there for keeps the summary", () => {
		// Place: the member was there for only the last line (speaker's value equals at 4 only).
		const v = viewOf({
			scenes: { 10: [L(1, OTHER), L(2, OTHER), L(3, OTHER), L(4, OTHER)] },
			slotId: "s",
			place: (m, id) => (m === ME ? "a" : id === 4 ? "a" : "b")
		})
		expect(keptSceneIds(v, [10])).toEqual({ keptIds: [10], leftOut: 0 })
	})
	test("more than half was there for keeps it; exactly half and not the last leaves it out", () => {
		const place = (kept: number[]) => (m: number, id: number) =>
			m === ME ? "a" : kept.includes(id) ? "a" : "b"
		const lines = [L(1, OTHER), L(2, OTHER), L(3, OTHER), L(4, OTHER)]
		const more = viewOf({ scenes: { 10: lines }, slotId: "s", place: place([1, 2, 3]) })
		expect(keptSceneIds(more, [10]).keptIds).toEqual([10])
		const half = viewOf({ scenes: { 10: lines }, slotId: "s", place: place([1, 2]) })
		expect(keptSceneIds(half, [10])).toEqual({ keptIds: [], leftOut: 1 })
	})
	test("a scene never spoken in is left out; a closed scene with no live line is kept only by its stored cast", () => {
		const v = viewOf({ scenes: { 10: [L(1, OTHER)], 20: [], 30: seen(5) }, stored: [20] })
		expect(keptSceneIds(v, [10, 20, 30])).toEqual({ keptIds: [20, 30], leftOut: 1 })
		const notStored = viewOf({ scenes: { 10: [L(1, OTHER)], 20: [], 30: seen(5) } })
		expect(keptSceneIds(notStored, [10, 20, 30])).toEqual({ keptIds: [30], leftOut: 2 })
	})
	test("an open scene with no live line is kept without a stored cast", () => {
		const v = viewOf({ scenes: { 20: [] }, open: [20] })
		expect(keptSceneIds(v, [20])).toEqual({ keptIds: [20], leftOut: 0 })
	})
	test("a scene with live lines is judged by them, not by the stored cast", () => {
		const v = viewOf({ scenes: { 10: [L(1, OTHER), L(2, OTHER)] }, stored: [10] })
		expect(keptSceneIds(v, [10])).toEqual({ keptIds: [], leftOut: 1 })
	})
})

describe("history entries", () => {
	const scenes = {
		10: [L(1, OTHER), L(2, ME), L(3, OTHER)], // there
		20: [L(4, OTHER), L(5, OTHER)], // missed
		30: [] as FirsthandLine[] // no live line
	}
	test("an entry whose scenes the member was all there for is kept; one with a missed scene is left out", () => {
		const v = viewOf({ scenes, entries: { 7: [10], 8: [10, 20], 9: [20] } })
		expect(leftOutEntryIds(v)).toEqual([8, 9])
	})
	test("left-out ids come ascending", () => {
		const v = viewOf({ scenes, entries: { 9: [20], 3: [20], 5: [10] } })
		expect(leftOutEntryIds(v)).toEqual([3, 9])
	})
	test("an entry with none of this session's scenes is not in scenesOfEntry and is kept", () => {
		const v = viewOf({ scenes, entries: { 8: [20] } })
		expect(v.scenesOfEntry.has(99)).toBe(false)
		expect(leftOutEntryIds(v)).toEqual([8])
		expect(leftOutEntryIds(viewOf({ scenes }))).toEqual([])
	})
	test("a compiled scene with no live line counts as there only for a member in its stored cast", () => {
		expect(leftOutEntryIds(viewOf({ scenes, entries: { 4: [30] }, stored: [30] }))).toEqual([])
		expect(leftOutEntryIds(viewOf({ scenes, entries: { 4: [30] } }))).toEqual([4])
	})
	test("the place rule can make a compiled scene missed", () => {
		const s = { 10: [L(1, OTHER), L(2, OTHER)] }
		const entries = { 4: [10] }
		expect(leftOutEntryIds(viewOf({ scenes: s, entries }))).toEqual([4])
		const sameRoom = viewOf({ scenes: s, entries, slotId: "x:slot/place@1", place: () => "hall" })
		expect(leftOutEntryIds(sameRoom)).toEqual([])
		const apart = viewOf({
			scenes: { 10: [L(1, OTHER), L(2, ME), L(3, OTHER)] },
			entries,
			slotId: "x:slot/place@1",
			place: (m) => (m === ME ? "hall" : "yard")
		})
		// Her own line keeps the last-line test aside: the last line is the other's, in the yard; 1 of 3 there.
		expect(leftOutEntryIds(apart)).toEqual([4])
	})
	test("firsthandViewOf builds scenesOfEntry by scene id ascending, skipping scenes not compiled", () => {
		const row = (id: number, historyEntryId?: number | null) => ({
			id,
			channel: "main",
			opened: id * 10,
			closed: id * 10 + 5,
			selected: null,
			...(historyEntryId === undefined ? {} : { historyEntryId })
		})
		const view = firsthandViewOf({
			memberId: ME,
			name: "Verity",
			slotId: null,
			slotTracked: true,
			scenes: [row(5, 2), row(1, 2), row(3, null), row(4), row(2, 9)],
			lines: [],
			trails: new Map()
		})
		expect([...view.scenesOfEntry]).toEqual([
			[2, [1, 5]],
			[9, [2]]
		])
	})
})

describe("values", () => {
	test("normalisation", () => {
		expect(placeKeyOf({ entryId: 7 })).toBe("entry:7")
		expect(placeKeyOf("  Hall ")).toBe("hall")
		expect(placeKeyOf("   ")).toBeNull()
		expect(placeKeyOf(3)).toBe("3")
		expect(placeKeyOf(true)).toBe("true")
		expect(placeKeyOf(["a"])).toBeNull()
		expect(placeKeyOf(null)).toBeNull()
	})
	test("in force: newest message point at or before; timeline points never count", () => {
		const pt = (layer: "session" | "timeline", value: string, messageId?: number | null) =>
			({
				value,
				layer,
				anchor: layer === "session" ? { messageId: messageId ?? null } : { historyEntryId: null, date: null }
			}) as never
		const points = [
			pt("timeline", "Old"),
			pt("timeline", "Newer"),
			pt("session", "Begin", null),
			pt("session", "Mid", 5),
			pt("session", "Late", 9)
		]
		expect(valueInForce(points, 4)).toBe("begin")
		expect(valueInForce(points, 5)).toBe("mid")
		expect(valueInForce(points, 20)).toBe("late")
		expect(valueInForce([pt("timeline", "Old"), pt("timeline", "Newer")], 1)).toBeNull()
		expect(valueInForce([pt("timeline", "Old"), pt("session", "Mid", 5)], 4)).toBeNull()
		expect(valueInForce([pt("session", "Mid", 5), pt("timeline", "Newer")], 6)).toBe("mid")
		// Same anchor: the later point in the array wins; a null anchor is before every message.
		expect(valueInForce([pt("session", "A", 5), pt("session", "B", 5)], 5)).toBe("b")
		expect(valueInForce([pt("session", "Mid", 5), pt("session", "Start", null)], 3)).toBe("start")
		expect(valueInForce([], 1)).toBeNull()
	})
})

describe("receipts", () => {
	const v = viewOf({ scenes: {} })
	test("lines", () => {
		expect(linesReceipt(v, 1)).toBe("1 message left out: Verity was not there")
		expect(linesReceipt(v, 3)).toBe("3 messages left out: Verity was not there")
		expect(linesReceipt(v, 0)).toBe("No messages left out for Verity")
	})
	test("summaries", () => {
		expect(scenesReceipt(v, 1)).toBe("1 scene summary left out: Verity was not there")
		expect(scenesReceipt(v, 2)).toBe("2 scene summaries left out: Verity was not there")
		expect(scenesReceipt(v, 0)).toBe("No scene summaries left out for Verity")
	})
	test("history entries", () => {
		expect(historyReceipt(v, 0)).toBe("No history entries left out for Verity")
		expect(historyReceipt(v, 1)).toBe(
			"1 history entry left out: Verity was not there for all of its scenes"
		)
		expect(historyReceipt(v, 4)).toBe(
			"4 history entries left out: Verity was not there for all of their scenes"
		)
		const u = viewOf({ scenes: {}, slotId: "x:slot/place@1", slotTracked: false })
		expect(historyReceipt(u, 0)).toBe(
			"No history entries left out for Verity (x:slot/place@1 is not tracked here, so by scene only)"
		)
		expect(historyReceipt(u, 2)).toContain(" (x:slot/place@1 is not tracked here, so by scene only)")
	})
	test("the exclusion reason", () => {
		expect(historyExclusionReason(v)).toBe(
			"Verity was not there for all of this history entry's scenes."
		)
	})
	test("suffix when the slot is not tracked, and reads-all", () => {
		const u = viewOf({ scenes: {}, slotId: "x:slot/place@1", slotTracked: false })
		expect(linesReceipt(u, 0)).toBe(
			"No messages left out for Verity (x:slot/place@1 is not tracked here, so by scene only)"
		)
		expect(scenesReceipt(u, 2)).toContain(" (x:slot/place@1 is not tracked here, so by scene only)")
		expect(readsAllReceipt()).toBe("Reads everything: not one cast member's turn")
	})
})

describe("firsthandViewOf at the size of a long session", () => {
	test("5,000 lines, 200 scenes and 1,000-point trails are judged in under a second", () => {
		const SCENES = 200
		const PER = 25
		const scenes = []
		const lines = []
		for (let k = 0; k < SCENES; k++) {
			const opened = k * PER + 1
			scenes.push({ id: 1000 + k, channel: "main", opened, closed: opened + PER - 1, selected: null })
			// Member 1 speaks only in the even scenes; 2 and 3 take turns in the rest.
			for (let j = 0; j < PER; j++)
				lines.push({
					id: opened + j,
					channel: "main",
					castMemberId: k % 2 === 0 && j === 0 ? 1 : 2 + (j % 2)
				})
		}
		// Tick scenes select some of the lines.
		scenes.push({ id: 5000, channel: "main", opened: null, closed: null, selected: [3, 4, 5, 2510] })
		scenes.push({ id: 5001, channel: "main", opened: null, closed: null, selected: [4, 4, 4990] })
		const pt = (value: string, messageId: number) =>
			({ value, layer: "session", anchor: { messageId } }) as never
		const trails = new Map<number, never[]>()
		for (const member of [1, 2, 3]) {
			const points: never[] = []
			// Member 1 and 2 share the hall until message 4,000; member 3 is always in the yard.
			for (let k = 0; k < 1000; k++)
				points.push(
					pt(member === 3 ? "yard" : k * 5 < 4000 ? "hall" : member === 1 ? "hall" : "yard", k * 5 + 1)
				)
			trails.set(member, points)
		}
		const t0 = performance.now()
		const view = firsthandViewOf({
			memberId: 1,
			name: "Verity",
			slotId: "x:slot/place@1",
			slotTracked: true,
			scenes,
			lines,
			trails
		})
		const kept = keptLineIds(view, lines)
		const sceneKept = keptSceneIds(
			view,
			scenes.filter((s) => s.opened !== null).map((s) => s.id)
		)
		const elapsed = performance.now() - t0
		expect(elapsed).toBeLessThan(1000)
		// Exact answers: member 3 is in the yard, member 1 in the hall: their lines are out;
		// member 2 shares the hall with member 1 up to message 4,000, then is in the yard.
		expect(view.sceneOfLine.get(2510)).toBe(1000 + 100)
		expect(view.sceneLines.get(5000)!.map((l) => l.id)).toEqual([3, 4, 5, 2510])
		expect(view.sceneLines.get(5001)!.map((l) => l.id)).toEqual([4, 4990])
		expect(view.spokeInSceneIds.has(1000)).toBe(true)
		expect(view.spokeInSceneIds.has(1001)).toBe(false)
		expect(view.placeAt(1, 1)).toBe("hall")
		expect(view.placeAt(2, 4500)).toBe("yard")
		expect(kept.keptIds.includes(1)).toBe(true) // her own line
		expect(kept.keptIds.includes(2)).toBe(false) // member 3, in the yard
		expect(kept.keptIds.includes(3)).toBe(true) // member 2 in the hall with her
		expect(kept.keptIds.includes(4400)).toBe(false) // member 2 in the yard by then
		expect(kept.leftOut).toBe(lines.length - kept.keptIds.length)
		expect(sceneKept.keptIds.includes(1000)).toBe(true) // its last line is member 2's, in the hall
		expect(sceneKept.keptIds.length + sceneKept.leftOut).toBe(SCENES)
	})
})
