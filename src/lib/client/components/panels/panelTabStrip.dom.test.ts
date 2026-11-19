/** The tab strip never cuts a label: it scrolls sideways in its own box. */
import { afterEach, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import PanelTabStrip from "./PanelTabStrip.svelte"

let comp: Record<string, any> | null = null
afterEach(() => {
	if (comp) unmount(comp)
	comp = null
	document.body.innerHTML = ""
})

test("the strip scrolls and no label truncates", () => {
	const icon = (() => {}) as never
	comp = mount(PanelTabStrip, {
		target: document.body,
		props: {
			tabs: [
				{ value: "a", label: "Member", icon },
				{ value: "b", label: "Timeline", icon }
			],
			value: "a",
			ariaLabel: "Tabs"
		}
	})
	flushSync()
	const strip = document.body.querySelector("[role=tablist]")!
	expect(strip.classList.contains("overflow-x-auto")).toBe(true)
	expect(document.body.querySelector(".truncate")).toBeNull()
	const tab = document.body.querySelector("[role=tab]")!
	expect(tab.classList.contains("min-w-fit")).toBe(true)
	expect(tab.classList.contains("whitespace-nowrap")).toBe(true)
})

test("selecting a tab, by click or key, scrolls it into view within the strip", () => {
	const icon = (() => {}) as never
	const calls: { id: string; arg: unknown }[] = []
	const original = Element.prototype.scrollIntoView
	Element.prototype.scrollIntoView = function (arg?: unknown) {
		calls.push({ id: (this as Element).id, arg })
	}
	try {
		comp = mount(PanelTabStrip, {
			target: document.body,
			props: {
				tabs: [
					{ value: "a", label: "Member", icon },
					{ value: "b", label: "Timeline", icon },
					{ value: "c", label: "Notes", icon }
				],
				value: "a",
				ariaLabel: "Tabs",
				panelIdPrefix: "p"
			}
		})
		flushSync()
		const tabs = document.body.querySelectorAll<HTMLElement>("[role=tab]")
		tabs[1].click()
		tabs[1].dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
		)
		flushSync()
		const near = { block: "nearest", inline: "nearest" }
		expect(calls).toEqual([
			{ id: "p-b-tab", arg: near },
			{ id: "p-c-tab", arg: near }
		])
	} finally {
		Element.prototype.scrollIntoView = original
	}
})
