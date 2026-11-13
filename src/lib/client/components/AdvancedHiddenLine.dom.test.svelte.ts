/** The hidden line: exact copy, and its link turns the preference on. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => ({ emit, on: () => {}, off: () => {} })
}))

import AdvancedHiddenLine from "./AdvancedHiddenLine.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	vi.clearAllMocks()
})

describe("AdvancedHiddenLine", () => {
	test("renders the exact text", () => {
		app = mount(AdvancedHiddenLine, { target: document.body })
		flushSync()
		expect(document.body.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Some controls are hidden. Show advanced controls"
		)
	})

	test("clicking the link emits once", () => {
		app = mount(AdvancedHiddenLine, { target: document.body })
		flushSync()
		const button = document.body.querySelector("button")
		expect(button?.textContent?.trim()).toBe("Show advanced controls")
		button?.click()
		flushSync()
		expect(emit).toHaveBeenCalledTimes(1)
		expect(emit).toHaveBeenCalledWith(
			"userSettings:updateShowAdvancedControls",
			{
				enabled: true
			}
		)
	})
})
