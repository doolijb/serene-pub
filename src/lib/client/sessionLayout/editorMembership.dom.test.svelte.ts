/**
 * The layout editor's membership over panels (PLAN-session-panels-2026-10-14,
 * lane 3; §10 R-B no lock; panels v2): membership is `placedIds(panels)`, and every add, duplicate and
 * removal is an ./arrangeOps op on the working panels.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync } from "svelte"
import type { PanelLayoutV2 } from "@serene-pub/sdk"
import { MIDDLE_EMPTY, type ArrangeOutcome } from "./arrangeOps"
import { createEditorMembership } from "./editorMembership.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"

const LAYOUT: PanelLayoutV2 = {
	version: 2,
	left: [],
	middle: [{ key: "p1", tabs: ["messages"] }],
	right: [{ key: "p2", tabs: ["stats"] }]
}

const stops: (() => void)[] = []
afterEach(() => {
	for (const stop of stops.splice(0)) stop()
})

function membershipOf(start: PanelLayoutV2 = LAYOUT) {
	const manager = new SurfaceManager()
	manager.init(1, coreDefaultWidgets(true), { panels: start } as never, () => {})
	const state = $state<{ panels: PanelLayoutV2; refused: string[] }>({
		panels: start,
		refused: []
	})
	let m!: ReturnType<typeof createEditorMembership>
	stops.push(
		$effect.root(() => {
			m = createEditorMembership({
				model: { primaryId: "messages" } as never,
				manager,
				sessionId: 1,
				get panels() {
					return state.panels
				},
				edit: (o: ArrangeOutcome) => {
					if (!o.layout) {
						state.refused.push(o.refused)
						return false
					}
					state.panels = o.layout
					return true
				}
			})
		})
	)
	flushSync()
	return { m, state }
}

describe("editor membership over panels", () => {
	test("membership is every tab the working panels place", () => {
		const { m } = membershipOf()
		expect([...m.placed]).toEqual(["messages", "stats"])
		expect(m.trayWidgets.find((t) => t.id === "stats")?.placed).toBe(1)
	})

	test("adding a placed kind mints a copy and lands it where asked", () => {
		const { m, state } = membershipOf()
		expect(m.addWidget("stats", { tab: { panelKey: "p2" } })).toBe(
			"stats#2"
		)
		expect(state.panels.right[0].tabs).toEqual(["stats", "stats#2"])
		expect(
			m.addWidget("chronicle", { panel: { place: "left", index: 0 } })
		).toBe("chronicle")
		expect(state.panels.left.map((p) => p.tabs)).toEqual([["chronicle"]])
	})

	test("Duplicate puts the copy beside its source, in the same panel", () => {
		const { m, state } = membershipOf()
		expect(m.duplicateWidget("stats")).toBe("stats#2")
		expect(state.panels.right[0].tabs).toEqual(["stats", "stats#2"])
	})

	test("there is no lock: the last Messages is removed like any tab once something else is in the middle", () => {
		const { m, state } = membershipOf({
			...LAYOUT,
			middle: [...LAYOUT.middle, { key: "p3", tabs: ["lore-entries"] }]
		})
		expect("lockOf" in m).toBe(false)
		expect(m.removeWidget("messages")).toBe(true)
		expect(state.panels.middle).toEqual([
			{ key: "p3", tabs: ["lore-entries"] }
		])
		expect([...m.placed]).not.toContain("messages")
	})

	test("the middle is never empty: the middle's only tab is refused through edit", () => {
		const { m, state } = membershipOf()
		expect(m.removeWidget("messages")).toBe(false)
		expect(state.refused).toEqual([MIDDLE_EMPTY])
		expect(state.panels.middle.map((p) => p.tabs)).toEqual([["messages"]])
		expect(m.removeWidget("stats")).toBe(true)
		expect(state.panels.right).toEqual([])
	})
})
