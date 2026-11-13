/** The picture behind the panels: drawn only for the backdrop choice and a backdrop. */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import LayoutBackdrop from "./LayoutBackdrop.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

type Look = { behind: "background" | "backdrop"; behindDim: number }
function render(look: Look, backdropMediaId: number | null | undefined) {
	const props = $state({ look, backdropMediaId })
	apps.push(mount(LayoutBackdrop, { target: document.body, props }))
	flushSync()
	return props
}
const drawn = () => document.querySelector<HTMLElement>(".layout-backdrop")

describe("LayoutBackdrop", () => {
	test("draws nothing for your background", () => {
		render({ behind: "background", behindDim: 40 }, 12)
		expect(drawn()).toBeNull()
	})
	test("draws nothing for the backdrop when the session has none", () => {
		render({ behind: "backdrop", behindDim: 40 }, null)
		expect(drawn()).toBeNull()
	})
	test("draws the fitted picture, hidden from assistive tech, with its dim", () => {
		render({ behind: "backdrop", behindDim: 40 }, 12)
		const el = drawn()!
		expect(el.getAttribute("aria-hidden")).toBe("true")
		expect(el.dataset.dim).toBe("40")
		const img = el.querySelector("img")!
		expect(img.getAttribute("src")).toBe("/media/12?v=fitted")
		expect(img.getAttribute("alt")).toBe("")
	})
	test("a dim change updates", () => {
		const props = render({ behind: "backdrop", behindDim: 40 }, 12)
		props.look = { behind: "backdrop", behindDim: 70 }
		flushSync()
		expect(drawn()!.dataset.dim).toBe("70")
	})
})
