/**
 * The full screen corner control (SHAPES L1): the way out, asleep after 2 s
 * idle (`data-asleep`), awake on focus.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

import FullscreenExit from "./FullscreenExit.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	vi.useRealTimers()
})

function draw(notice: string | null = null) {
	const onExit = vi.fn()
	app = mount(FullscreenExit, {
		target: document.body,
		props: {
			rewind: null,
			sessionName: "The lighthouse",
			notice,
			onExit,
			onLayout: () => {},
			onDisplay: () => {},
			onNoticeShown: () => {}
		}
	})
	flushSync()
	return { onExit }
}

const root = () => document.querySelector(".fullscreen-exit") as HTMLElement
function exitButton() {
	return [...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Exit full screen")
	)
}

describe("FullscreenExit", () => {
	test("renders Exit full screen and calls onExit on click", () => {
		const { onExit } = draw()
		const b = exitButton()
		expect(b).toBeTruthy()
		expect(b!.textContent).toContain("Esc")
		b!.click()
		expect(onExit).toHaveBeenCalledOnce()
	})

	test("shows the notice", () => {
		draw("Press Esc to leave full screen.")
		expect(document.body.textContent).toContain("Press Esc to leave full screen.")
	})

	test("asleep after 2 s idle; focusin wakes it", async () => {
		vi.useFakeTimers()
		draw()
		expect(root().hasAttribute("data-asleep")).toBe(false)
		vi.advanceTimersByTime(2100)
		await tick()
		flushSync()
		expect(root().getAttribute("data-asleep")).toBe("")
		root().dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
		flushSync()
		expect(root().hasAttribute("data-asleep")).toBe(false)
	})
})
