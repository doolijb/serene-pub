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
/** The zone imports gridstack lazily; under a loaded full suite that import takes seconds. */
const SEED_WAIT = { timeout: 15_000 }
// A test's budget must outlast the seed wait it may spend.
vi.setConfig({ testTimeout: 30_000 })

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
		}, SEED_WAIT)
		return { host, grid }
	}

	function accepts(grid: GridEl, card: Element): boolean {
		const accept = grid.gridstack?.opts.acceptWidgets
		return typeof accept === "function" ? !!accept(card) : accept === true
	}

	// What this case can and cannot prove: before 7a the component accepted
	// everything by DEFAULT too — the refusal was wiring, the canvas passing
	// `acceptsRequired={isMiddle}` to the sides and the page stamping
	// `locked` on the conversation. That prop and that stamp no longer exist
	// (svelte-check refuses either), so what is pinned here is the component's
	// half: no per-card predicate at all, whatever the card carries.
	test("the Messages card dragged out of the middle is taken by a side zone", async () => {
		const middle = await mountZone(MIDDLE)
		const card = middle.host.querySelector(".grid-stack-item")!
		const side = await mountZone(SIDE)
		expect(side.grid.gridstack?.opts.acceptWidgets).toBe(true)
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

/**
 * Duplicate on a placed card (brief 7b; QD, the plan's recommended default):
 * the card offers it beside its other controls, and pressing it names the card
 * — the layout mints the copy and copies its settings and style. A card whose
 * widget is at its `maxInstances` says why instead.
 */
describe("GridStackZone — Duplicate on a card (brief 7b)", () => {
	const apps: ReturnType<typeof mount>[] = []
	const hosts: HTMLElement[] = []
	afterEach(() => {
		for (const app of apps.splice(0)) unmount(app)
		for (const host of hosts.splice(0)) host.remove()
	})
	async function mountZone(props: Record<string, unknown>) {
		const host = document.createElement("div")
		host.style.cssText = "width:480px;height:600px"
		document.body.appendChild(host)
		hosts.push(host)
		apps.push(mount(GridStackZone, { target: host, props: props as never }))
		flushSync()
		await vi.waitFor(() => {
			if (!host.querySelector(".gsc")) throw new Error("not seeded yet")
		}, SEED_WAIT)
		return host
	}

	test("pressing Duplicate names the card it is on", async () => {
		const onDuplicate = vi.fn()
		const onRemove = vi.fn()
		const host = await mountZone({
			items: [
				{ id: "stats", title: "Stats" },
				{ id: "world-state#2", title: "World state · 2" }
			],
			onDuplicate,
			onRemove
		})
		const btn = host.querySelector<HTMLButtonElement>('[data-duplicate="world-state#2"]')
		expect(btn?.getAttribute("aria-label")).toBe("Duplicate World state · 2")
		btn!.click()
		expect(onDuplicate).toHaveBeenCalledWith("world-state#2")
		// It is not the ×.
		expect(onRemove).not.toHaveBeenCalled()
	})

	test("a card at its widget's cap offers no Duplicate, and says why", async () => {
		const host = await mountZone({
			items: [{ id: "acme.audio:player", title: "Player", copyRefusal: "Only one per layout" }],
			onDuplicate: () => {}
		})
		expect(host.querySelector('[data-duplicate="acme.audio:player"]')).toBeNull()
		expect(host.querySelector(".gsc-nocopy")?.getAttribute("aria-label")).toBe("Only one per layout")
	})

	test("a zone told nothing about duplicating draws no Duplicate at all", async () => {
		const host = await mountZone({ items: [{ id: "stats", title: "Stats" }] })
		expect(host.querySelector("[data-duplicate]")).toBeNull()
	})
})
