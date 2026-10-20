/**
 * 🚧 A dot on a tab with news (PLAN-dc-after-walk2 Q3-3): Planner's tab says
 * so when a secret, a death or a question lands there while the Story is up.
 */
import { describe, expect, test } from "vitest"
import type { DrawnLayout, DrawnPanel } from "@serene-pub/sdk"
import { createTabAttention } from "./tabAttention.svelte"

const claims: Record<string, unknown> = {
	story: { channel: "main" },
	planner: { channel: "planner" }
}
const panel = (open: string): DrawnPanel =>
	({ key: "p1", open, pinned: true, tabs: [{ instanceId: "story" }, { instanceId: "planner" }] }) as unknown as DrawnPanel
const drawnWith = (p: DrawnPanel): DrawnLayout =>
	({ left: { panels: [p] }, middle: { panels: [] }, right: { panels: [] } }) as unknown as DrawnLayout

describe("tab attention", () => {
	test("history is never news; a line somebody else writes on a hidden tab's channel is a dot until it is shown", () => {
		const a = createTabAttention((id) => claims[id])
		const rows = [
			{ id: 1, channel: "main", userId: 7 },
			{ id: 2, channel: "planner", userId: null }
		]
		const p = panel("story")
		a.observe(drawnWith(p), rows, 7)
		expect([...a.dots(p, rows, 7)]).toEqual([])

		const later = [...rows, { id: 3, channel: "planner:2", userId: null }]
		expect([...a.dots(p, later, 7)]).toEqual(["planner"])

		// The viewer's own line is never news; the shown tab never carries a dot.
		const mine = [...rows, { id: 4, channel: "planner", userId: 7 }, { id: 5, channel: "main", userId: null }]
		expect([...a.dots(p, mine, 7)]).toEqual([])

		const shown = panel("planner")
		a.observe(drawnWith(shown), later, 7)
		a.observe(drawnWith(p), later, 7)
		expect([...a.dots(p, later, 7)]).toEqual([])
	})

	test("a tab that shows one lane counts that lane alone: another player's lane an owner receives is never its news", () => {
		const a = createTabAttention(
			(id) => claims[id],
			(id) => (id === "planner" ? "planner:1" : undefined)
		)
		const rows = [{ id: 1, channel: "planner", userId: null }]
		const p = panel("story")
		a.observe(drawnWith(p), rows, 7)
		const theirs = [...rows, { id: 2, channel: "planner:2", userId: null }]
		expect([...a.dots(p, theirs, 7)]).toEqual([])
		const mine = [...theirs, { id: 3, channel: "planner", userId: null }]
		expect([...a.dots(p, mine, 7)]).toEqual(["planner"])
	})
})
