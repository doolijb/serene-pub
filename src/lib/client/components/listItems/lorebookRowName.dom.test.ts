/**
 * The book row's button is announced with the book's name, not its id.
 */
import { afterEach, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$app/navigation", () => ({
	replaceState: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn()
}))
vi.mock("$app/state", () => ({
	page: { url: new URL("http://localhost/"), state: {}, params: {} }
}))

import LorebookListItem from "./LorebookListItem.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

test("the row button's accessible name is the lorebook's name", () => {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(LorebookListItem, {
		target: host,
		props: {
			lorebook: { id: 4, name: "Saltmarsh" },
			showControls: false
		}
	})
	flushSync()
	const label = host.querySelector("button")?.getAttribute("aria-label")
	expect(label).toContain("Saltmarsh")
	expect(label).not.toBe("Go to lorebook - ID 4")
})
