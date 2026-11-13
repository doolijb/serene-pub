/**
 * A zone's column of panels (./ZoneColumn; PLAN 2026-11-05 D10): one grid row
 * per panel, the first-frame tracks before anything is measured, and the gap.
 * Only strings and counts are asserted.
 */
import { afterEach, describe, expect, test } from "vitest"
import { createRawSnippet, flushSync, mount, unmount } from "svelte"
import type { DrawnPanel } from "@serene-pub/sdk"
import ZoneColumn from "./ZoneColumn.svelte"
import { cssTrackOf } from "./zoneHeights"

class StubObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
;(globalThis as any).ResizeObserver ??= StubObserver
// MutationObserver is happy-dom's own: the column re-measures when the DOM changes.

/** happy-dom has no layout: a root's height is whatever its data-h says. */
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
	configurable: true,
	get() {
		return Number(this.getAttribute?.("data-h") ?? 0)
	}
})

Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
	configurable: true,
	value() {
		const h = Number(this.getAttribute?.("data-h") ?? 0)
		return {
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 0,
			bottom: h,
			width: 0,
			height: h
		}
	}
})

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

const panelOf = (
	key: string,
	height: DrawnPanel["height"],
	open = "stats"
): DrawnPanel =>
	({
		key,
		tabs: [{ instanceId: open }],
		open,
		pinned: true,
		height,
		priority: "normal"
	}) as unknown as DrawnPanel

const panel = createRawSnippet((p: () => DrawnPanel) => ({
	render: () => `<div class="body">${p().key}</div>`
}))

const boxPanel = createRawSnippet((p: () => DrawnPanel) => ({
	render: () =>
		`<div class="ptabs"><div class="wtab-pane"><div data-sp-widget-box><div class="root" data-h="${p().open === "full" ? 40 : 0}"></div></div></div></div>`
}))

const padPanel = createRawSnippet((p: () => DrawnPanel) => ({
	render: () =>
		`<div class="ptabs"><div class="wtab-pane"><div data-sp-widget-box><div class="root" style="padding:8px" data-h="16"></div></div></div></div>`
}))

const imgPanel = createRawSnippet((p: () => DrawnPanel) => ({
	render: () =>
		`<div class="ptabs"><div class="wtab-pane"><div data-sp-widget-box><div class="root" data-h="11"><img alt=""></div></div></div></div>`
}))

function render(panels: DrawnPanel[], gapPx = 8, snippet: any = panel) {
	apps.push(
		mount(ZoneColumn, {
			target: document.body,
			props: {
				zone: "right",
				panels,
				gapPx,
				isMessages: (id: string) => id === "messages",
				panel: snippet
			} as any
		})
	)
	flushSync()
	return document.querySelector<HTMLElement>(".zone-column")!
}

describe("ZoneColumn", () => {
	test("unmeasured: one row per panel, the first-frame tracks in order", () => {
		const col = render([
			panelOf("a", "fit"),
			panelOf("b", "fill", "messages"),
			panelOf("c", { share: 3 })
		])
		const want = [
			cssTrackOf({ height: "fit", isMessages: false }),
			cssTrackOf({ height: "fill", isMessages: true }),
			cssTrackOf({ height: { share: 3 }, isMessages: false })
		].join(" ")
		expect(col.style.gridTemplateRows).toBe(want)
		expect(document.querySelectorAll(".zone-cell").length).toBe(3)
	})

	test("cells are keyed by panel", () => {
		render([panelOf("a", "fill"), panelOf("b", "fill")])
		expect(
			[...document.querySelectorAll(".zone-cell")].map((c) =>
				c.getAttribute("data-panel-key")
			)
		).toEqual(["a", "b"])
	})

	test("the gap is the row gap", () => {
		const col = render([panelOf("a", "fill"), panelOf("b", "fill")], 12)
		expect(col.style.rowGap).toBe("12px")
	})

	test("an empty fit panel is out of the grid, unseen, and draws once content arrives", async () => {
		const col = render(
			[panelOf("a", "fill", "messages"), panelOf("b", "fit", "empty")],
			12,
			boxPanel
		)
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		const cell = col.querySelector('[data-panel-key="b"]')!
		expect(cell.classList.contains("empty")).toBe(true)
		// One drawn row, so no gap track either; the empty cell stays mounted.
		expect(col.style.gridTemplateRows).toBe("minmax(160px, 1fr)")
		expect(document.querySelectorAll(".zone-cell").length).toBe(2)
		// Content arrives: the root gains height and a DOM change re-measures.
		const root = cell.querySelector(".root")!
		root.setAttribute("data-h", "40")
		root.appendChild(document.createElement("span"))
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(cell.classList.contains("empty")).toBe(false)
	})

	test("a non-empty fit panel is drawn", async () => {
		const col = render([panelOf("b", "fit", "full")], 12, boxPanel)
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(
			col
				.querySelector('[data-panel-key="b"]')!
				.classList.contains("empty")
		).toBe(false)
	})

	test("the measure leaves the box's inline height as it was", async () => {
		const col = render([panelOf("b", "fit", "full")], 12, boxPanel)
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		const box = col.querySelector<HTMLElement>("[data-sp-widget-box]")!
		expect(box.style.getPropertyValue("height")).toBe("")
		expect(box.style.getPropertyPriority("height")).toBe("")
	})

	test("a root with only padding draws nothing", async () => {
		const col = render([panelOf("b", "fit")], 12, padPanel)
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(
			col
				.querySelector('[data-panel-key="b"]')!
				.classList.contains("empty")
		).toBe(true)
	})

	test("a picture that loads later re-measures", async () => {
		const col = render(
			[panelOf("a", "fill", "messages"), panelOf("b", "fit")],
			12,
			imgPanel
		)
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		const before = col.style.gridTemplateRows
		const root = col.querySelector('[data-panel-key="b"] .root')!
		root.setAttribute("data-h", "0")
		root.querySelector("img")!.dispatchEvent(new Event("load"))
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(col.style.gridTemplateRows === before).toBe(false)
	})
})
