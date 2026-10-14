/**
 * less-confusing B3 (2026-10-11): before the shell knows the user it draws
 * the rail's outline at once and, only after a short wait, "Loading your
 * pub…", so a warm reload never flashes the words and a slow one is never an
 * empty page. The gate itself (`shouldShowApp` in Layout.svelte) is not this
 * component's: it only draws the wait.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import ShellLoading from "./ShellLoading.svelte"

let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	vi.useRealTimers()
	document.body.innerHTML = ""
})

function draw(props: { railWide?: boolean } = {}) {
	app = mount(ShellLoading, { target: document.body, props })
	flushSync()
}

const status = () => document.querySelector<HTMLElement>('[role="status"]')
const rail = () =>
	document.querySelector<HTMLElement>("[data-shell-loading-rail]")

describe("B3 · the shell before it knows you", () => {
	test("the outline at once, the words only after the wait", () => {
		draw()
		expect(rail()).not.toBeNull()
		expect(status()).toBeNull()

		vi.advanceTimersByTime(399)
		flushSync()
		expect(status()).toBeNull()

		vi.advanceTimersByTime(1)
		flushSync()
		expect(status()?.textContent?.trim()).toBe("Loading your pub…")
	})

	test("gone before the wait is over: no words, no stray timer", () => {
		draw()
		unmount(app!)
		app = null
		vi.advanceTimersByTime(1000)
		expect(status()).toBeNull()
		expect(vi.getTimerCount()).toBe(0)
	})

	test("the outline is the rail's remembered width, and names nothing", () => {
		draw()
		expect(rail()!.className).toContain("w-16")
		expect(rail()!.getAttribute("aria-hidden")).toBe("true")
		unmount(app!)
		app = null

		draw({ railWide: true })
		expect(rail()!.className).toContain("w-52")
		expect(rail()!.textContent).toContain("Play")
		expect(rail()!.textContent).toContain("Tune")
	})
})
