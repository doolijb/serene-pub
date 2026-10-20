/**
 * 🚧 The Planner tab's dot, drawn (PLAN-dc-after-walk3 R1-1, the walk's
 * NEW-3): a guest's lane line dots the guest's Planner tab, and the owner's
 * goal question and a death's *Make a new character* dot the owner's — the
 * Planner's rows carry the id of the person whose run wrote them, which
 * never made them that person's own lines.
 */
import { afterEach, describe, expect, test } from "vitest"
import { createRawSnippet, flushSync, mount, unmount } from "svelte"
import type { DrawnLayout, DrawnPanel } from "@serene-pub/sdk"
import PanelTabs from "./PanelTabs.svelte"
import { createTabAttention } from "./tabAttention.svelte"

const OWNER = 7
const GUEST = 8
const claims: Record<string, unknown> = {
	messages: { channel: "main" },
	"messages#parley": { channel: "parley", channelLane: "mine" }
}
const panel = (open: string): DrawnPanel =>
	({ key: "p1", open, pinned: true, tabs: [{ instanceId: "messages#parley" }, { instanceId: "messages" }] }) as unknown as DrawnPanel
const drawnWith = (p: DrawnPanel): DrawnLayout =>
	({ left: { panels: [] }, middle: { panels: [p] }, right: { panels: [] } }) as unknown as DrawnLayout
const LABELS: Record<string, string> = { "messages#parley": "Planner", messages: "Story" }
const pane = createRawSnippet(() => ({ render: () => "<div></div>" }))

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

/** The strip as one viewer sees it, the Story shown: the Planner tab's dot, read off the DOM. */
function plannerDotted(viewer: number, lane: string, rows: any[], later: any[]): boolean {
	const attention = createTabAttention(
		(id) => claims[id],
		(id) => (id === "messages#parley" ? lane : undefined)
	)
	const p = panel("messages")
	attention.observe(drawnWith(p), rows, viewer)
	const box = document.createElement("div")
	document.body.append(box)
	apps.push(
		mount(PanelTabs, {
			target: box,
			props: { panel: p, label: (id: string) => LABELS[id] ?? id, onSelect: () => {}, pane, dots: attention.dots(p, later, viewer) }
		})
	)
	flushSync()
	const tab = [...box.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes("Planner"))
	expect(tab, "the Planner tab is drawn").toBeTruthy()
	return !!tab!.querySelector(".wtab-dot")
}

describe("the Planner tab's dot", () => {
	const history = [
		{ id: 1, channel: "parley", role: "assistant", userId: OWNER },
		{ id: 2, channel: "parley:2", role: "assistant", userId: GUEST },
		{ id: 3, channel: "main", role: "assistant", userId: OWNER }
	]

	test("a guest's lane line — written by the guest's own run — dots the guest's Planner tab", () => {
		const secret = { id: 4, channel: "parley:2", role: "assistant", userId: GUEST, content: "For you alone: …" }
		expect(plannerDotted(GUEST, "parley:2", history, [...history, secret])).toBe(true)
	})

	test("the owner's goal question and a death's Make a new character dot the owner's Planner tab", () => {
		const goal = { id: 5, channel: "parley", role: "assistant", userId: OWNER, content: "You did it: the goal is reached. What now?" }
		expect(plannerDotted(OWNER, "parley:1", history, [...history, goal])).toBe(true)
		const death = { id: 6, channel: "parley", role: "assistant", userId: GUEST, content: "Maren Holt has fallen. Make a new character?" }
		expect(plannerDotted(OWNER, "parley:1", history, [...history, death])).toBe(true)
	})

	test("the viewer's own line is never news, and another person's lane never dots this one", () => {
		const said = { id: 7, channel: "parley:2", role: "user", userId: GUEST }
		expect(plannerDotted(GUEST, "parley:2", history, [...history, said])).toBe(false)
		const theirs = { id: 8, channel: "parley", role: "assistant", userId: OWNER }
		expect(plannerDotted(GUEST, "parley:2", history, [...history, theirs])).toBe(false)
	})
})
