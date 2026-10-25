/**
 * `PanelSplit`'s list-pane shapes, rendered (PLAN-sidebar-nav-normalization
 * §2.3, rulings Q4 and Q5): the pinned toolbar over a scrolling list, the
 * unchanged shape without one, and Connections' filling desk index as a prop.
 * `kind="sections"` is pinned in `sectionList.ssr.test.ts`, with the list
 * it holds.
 *
 * ⚠ Asserts only the classes that carry the behaviour (who scrolls, what
 * is pinned, the 12px gap, the 1120px and 560px caps), never the rest of the recipe.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"
import { createRawSnippet } from "svelte"

vi.mock("$app/environment", () => ({ dev: false, building: false }))

import PanelSplit from "./PanelSplit.svelte"

const snip = (text: string) =>
	createRawSnippet(() => ({ render: () => `<p>${text}</p>` }))

function split(props: Record<string, unknown>) {
	return render(PanelSplit, {
		props: {
			list: snip("LIST"),
			detail: snip("DETAIL"),
			...props
		} as any
	}).body
}

/** The opening tag of the element enclosing `marker`'s nearest preceding `<div`. */
function parentDiv(markup: string, marker: string, depth = 1): string {
	let at = markup.indexOf(marker)
	expect(at, `missing ${marker}`).toBeGreaterThan(-1)
	for (let i = 0; i < depth; i++) at = markup.lastIndexOf("<div", at - 1)
	return markup.slice(at, markup.indexOf(">", at) + 1)
}

describe("PanelSplit toolbar", () => {
	for (const mode of ["desk", "compact"] as const) {
		test(`${mode}: the toolbar is pinned and the list is the scroller`, () => {
			const out = split({ mode, toolbar: snip("TOOLBAR") })
			const toolbarWrap = parentDiv(out, "<p>TOOLBAR")
			expect(toolbarWrap).toContain("shrink-0")
			// list -> margin wrapper -> scroller (the inset is a margin on the
			// wrapper, never padding on the scroller, 2026-10-11)
			expect(parentDiv(out, "<p>LIST")).toContain("mx-4")
			const scroller = parentDiv(out, "<p>LIST", 2)
			expect(scroller).toContain("overflow-y-auto")
			expect(scroller).not.toMatch(/\bp-4\b/)
			const pane = parentDiv(out, "<p>TOOLBAR", 2)
			expect(pane).not.toMatch(/\bp-4\b/)
			expect(pane).toContain("@container/list")
			expect(out.indexOf("TOOLBAR")).toBeLessThan(out.indexOf("LIST"))
		})
	}

	test("without a toolbar the list pane scrolls, unpadded, and the list carries the margin", () => {
		const out = split({ mode: "desk", hasDetail: true })
		const pane = parentDiv(out, "<p>LIST", 2)
		expect(pane).toContain("flex min-h-0 flex-col overflow-y-auto")
		expect(pane).not.toMatch(/\bp-4\b/)
		expect(pane).toContain("panel-edge")
		expect(pane).toContain("border-r")
		expect(pane).not.toContain("gap-3")
		expect(parentDiv(out, "<p>LIST")).toContain("m-4")
		expect(out).toContain("DETAIL")
	})

	test("desk, nothing open, no listFills: the list beside the empty message", () => {
		const out = split({ mode: "desk", emptyMessage: "Pick one" })
		expect(out).toContain("Pick one")
		expect(out).toContain(
			"grid-template-columns: max(340px, min(22%, 560px)) minmax(0, 1fr)"
		)
	})
})

describe("PanelSplit listFills", () => {
	test("desk, nothing open: the list alone fills the view at 1120px", () => {
		const out = split({
			mode: "desk",
			listFills: true,
			emptyMessage: "Pick one"
		})
		expect(out).toContain("grid-template-columns: minmax(0, 1fr);")
		expect(out).not.toContain("Pick one")
		expect(out).not.toContain("DETAIL")
		const cap = parentDiv(out, "<p>LIST")
		expect(cap).toContain("max-w-[1120px]")
		expect(cap).toContain("self-center")
		const pane = parentDiv(out, "<p>LIST", 2)
		expect(pane).toContain("data-panel-split-fills")
		expect(pane).not.toContain("border-r")
	})

	test("with a toolbar both are capped and the scroller spans the pane", () => {
		const out = split({
			mode: "desk",
			listFills: true,
			toolbar: snip("TOOLBAR")
		})
		expect(parentDiv(out, "<p>TOOLBAR")).toContain("max-w-[1120px]")
		expect(parentDiv(out, "<p>LIST")).toContain("max-w-[1120px]")
		const scroller = parentDiv(out, "<p>LIST", 2)
		expect(scroller).toContain("overflow-y-auto")
		expect(scroller).not.toContain("max-w-[1120px]")
	})

	test("something open: split as usual", () => {
		const out = split({ mode: "desk", listFills: true, hasDetail: true })
		expect(out).toContain("DETAIL")
		expect(out).not.toContain("data-panel-split-fills")
		expect(parentDiv(out, "<p>LIST", 2)).toContain("border-r")
	})

	test("compact ignores it", () => {
		const out = split({ mode: "compact", listFills: true })
		expect(out).not.toContain("data-panel-split-fills")
		expect(out).not.toContain("max-w-[1120px]")
	})

	// L7 (PLAN-0-5-polish-parity, 2026-10-24): a list of rows fills at the
	// list column's own 560px ceiling, a portrait grid uncapped.
	test("fillWidth list: rows and toolbar centred at 560px", () => {
		const out = split({
			mode: "desk",
			listFills: true,
			fillWidth: "list",
			toolbar: snip("TOOLBAR")
		})
		expect(parentDiv(out, "<p>TOOLBAR")).toContain("max-w-[560px]")
		const cap = parentDiv(out, "<p>LIST")
		expect(cap).toContain("max-w-[560px]")
		expect(cap).toContain("self-center")
		expect(out).not.toContain("max-w-[1120px] self-center")
	})

	test("fillWidth whole: no cap", () => {
		const out = split({ mode: "desk", listFills: true, fillWidth: "whole" })
		expect(parentDiv(out, "<p>LIST")).toContain("max-w-none")
	})

	test("fillWidth list, something open: the list is a column again", () => {
		const out = split({
			mode: "desk",
			listFills: true,
			fillWidth: "list",
			hasDetail: true
		})
		expect(out).not.toContain("max-w-[560px]")
		expect(out).toContain("DETAIL")
	})
})
