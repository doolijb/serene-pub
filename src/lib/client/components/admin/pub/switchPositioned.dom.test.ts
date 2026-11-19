/**
 * A switch's visually hidden <input> is position:absolute, so its control
 * root must be a containing block (`app.css`): otherwise focusing the input
 * scrolls the fixed panel dialog instead of the inner scroller. jsdom does
 * not load `app.css`, so the test pins both halves: the root's zag
 * attributes and the rule that selects them.
 */
import { readFileSync } from "node:fs"
import { afterEach, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import SettingSwitch from "./SettingSwitch.svelte"

let comp: Record<string, any> | null = null
afterEach(() => {
	if (comp) unmount(comp)
	comp = null
	document.body.innerHTML = ""
})

test("the hidden input sits inside a switch root that app.css positions", () => {
	comp = mount(SettingSwitch, {
		target: document.body,
		props: { name: "x", label: "Keep a timeline", checked: false, onCheckedChange: () => {} }
	})
	flushSync()
	const input = document.body.querySelector("input[type=checkbox]")!
	const root = input.closest("[data-scope=switch][data-part=root]")
	expect(root !== null).toBe(true)
	const css = readFileSync("src/app.css", "utf8")
	expect(css).toMatch(
		/\[data-scope="switch"\]\[data-part="root"\][^{]*\{\s*position:\s*relative;/
	)
})
