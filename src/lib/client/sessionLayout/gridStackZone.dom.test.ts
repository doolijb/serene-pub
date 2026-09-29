/**
 * The editor's zones take the Messages card (brief 7a): "I also can't move the
 * messages widget to a different column" (owner, 2026-09-29).
 *
 * A side zone used to refuse the conversation in mid-air — the middle stamped
 * its card `data-required`, and a side zone's gridstack `acceptWidgets` turned
 * any stamped card away — so the drag snapped back. Placement is free now:
 * every zone accepts every card, and the one rule left, the primary floor,
 * shows on the LAST Messages card as a note where its × would be.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import GridStackZone from "./GridStackZone.svelte"

type GridEl = HTMLElement & {
	gridstack?: { opts: { acceptWidgets?: boolean | ((el: Element) => boolean) } }
}

const NOTE = "A session needs one Messages widget"

/**
 * What the layout editor hands each zone (LayoutEditCanvas / SessionLayout):
 * the middle's Messages card carries the floor's note, and a side zone gets
 * its pin toggle.
 */
const MIDDLE = { items: [{ id: "messages", title: "Messages", floorNote: NOTE }] }
const SIDE = {
	items: [{ id: "stats", title: "Stats" }],
	pinned: true,
	onTogglePin: () => {}
}

describe("GridStackZone — a side accepts a Messages drop", () => {
	const apps: ReturnType<typeof mount>[] = []
	const hosts: HTMLElement[] = []

	afterEach(() => {
		for (const app of apps.splice(0)) unmount(app)
		for (const host of hosts.splice(0)) host.remove()
	})

	/** Mount one zone and wait for gridstack, which the zone imports lazily. */
	async function mountZone(props: Record<string, unknown>) {
		const host = document.createElement("div")
		host.style.cssText = "width:480px;height:600px"
		document.body.appendChild(host)
		hosts.push(host)
		apps.push(mount(GridStackZone, { target: host, props: props as never }))
		flushSync()
		const grid = await vi.waitFor(() => {
			const el = host.querySelector(".grid-stack") as GridEl | null
			if (!el?.gridstack || !host.querySelector(".gsc")) throw new Error("not seeded yet")
			return el
		})
		return { host, grid }
	}

	function accepts(grid: GridEl, card: Element): boolean {
		const accept = grid.gridstack?.opts.acceptWidgets
		return typeof accept === "function" ? !!accept(card) : accept === true
	}

	test("the Messages card dragged out of the middle is taken by a side zone", async () => {
		const middle = await mountZone(MIDDLE)
		const card = middle.host.querySelector(".grid-stack-item")!
		const side = await mountZone(SIDE)
		expect(accepts(side.grid, card)).toBe(true)
	})

	test("the last Messages card carries no refusal stamp and no ×, but says why", async () => {
		const { host } = await mountZone(MIDDLE)
		expect(host.querySelector("[data-required]")).toBeNull()
		expect(host.querySelector('[data-remove="messages"]')).toBeNull()
		expect(host.querySelector(".gsc-floor")?.getAttribute("aria-label")).toBe(NOTE)
	})

	test("a Messages card that is not the last offers its ×", async () => {
		const { host } = await mountZone({ items: [{ id: "messages#sanctum", title: "Sanctum" }] })
		expect(host.querySelector('[data-remove="messages#sanctum"]')).not.toBeNull()
	})
})
