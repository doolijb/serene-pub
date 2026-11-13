/**
 * 🚧 M2d: the applet loading screen ends on `ready` and on nothing else; the
 * 20 s timer only changes the words; a fatal frame leaves the host's sentence
 * and Leave.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import AppletLoading from "./AppletLoading.svelte"
import { FRAME_FATAL_SENTENCE } from "./frames/frameFatal"

type Props = {
	title: string
	poster?: string
	logo?: string
	ready: boolean
	fatal: boolean
	onLeave?: () => void
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	vi.useRealTimers()
})

/** Props are a `$state` object, so a test can flip `ready` after mount. */
function draw(initial: Partial<Props> = {}) {
	const props = $state<Props>({
		title: "Moonhaven",
		ready: false,
		fatal: false,
		...initial
	})
	app = mount(AppletLoading, { target: document.body, props })
	flushSync()
	return props
}

const status = () => document.querySelector('[role="status"]')
const layer = () => document.querySelector(".absolute.inset-0")

describe("AppletLoading", () => {
	test("says Loading <title>… in a status line", () => {
		draw()
		expect(status()?.textContent?.trim()).toBe("Loading Moonhaven…")
		expect(document.querySelector('[role="progressbar"]')).toBeTruthy()
	})

	test("at 20 s the words change and the screen stays, at 60 s too", () => {
		vi.useFakeTimers()
		draw()
		vi.advanceTimersByTime(19_999)
		flushSync()
		expect(status()?.textContent?.trim()).toBe("Loading Moonhaven…")
		vi.advanceTimersByTime(1)
		flushSync()
		expect(status()?.textContent?.trim()).toBe("Still loading…")
		expect(layer()).toBeTruthy()
		vi.advanceTimersByTime(40_000)
		flushSync()
		expect(status()?.textContent?.trim()).toBe("Still loading…")
		expect(layer()).toBeTruthy()
	})

	test("ready removes the layer", async () => {
		const props = draw()
		expect(layer()).toBeTruthy()
		props.ready = true
		flushSync()
		await vi.waitFor(() => expect(layer()).toBeNull())
	})

	test("fatal shows the host's sentence and Leave calls onLeave", () => {
		const onLeave = vi.fn()
		draw({ fatal: true, onLeave })
		expect(
			document
				.querySelector("[data-applet-loading-fatal]")
				?.textContent?.trim()
		).toBe(FRAME_FATAL_SENTENCE)
		expect(status()).toBeNull()
		expect(document.querySelector('[role="progressbar"]')).toBeNull()
		const leave = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Leave"
		)
		expect(leave).toBeTruthy()
		leave!.click()
		expect(onLeave).toHaveBeenCalledOnce()
	})

	test("fatal without onLeave draws no button", () => {
		draw({ fatal: true })
		expect(document.querySelector("button")).toBeNull()
	})

	test("a poster is drawn as an image with that src", () => {
		draw({ poster: "/p.png" })
		expect(document.querySelector("img")?.getAttribute("src")).toBe(
			"/p.png"
		)
	})

	test("a logo stands in for the title text", () => {
		draw({ logo: "/l.png" })
		expect(document.querySelector("img")?.getAttribute("src")).toBe(
			"/l.png"
		)
		expect(document.querySelector("[data-applet-loading-title]")).toBeNull()
	})

	test("no logo: the title is drawn", () => {
		draw()
		expect(
			document
				.querySelector("[data-applet-loading-title]")
				?.textContent?.trim()
		).toBe("Moonhaven")
	})
})
