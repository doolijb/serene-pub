/**
 * Next-pass note 29 (2026-10-02): the session header can be furled. A quiet
 * button at the bar's top right rolls it up; a faint one in the same band
 * brings it back. Remembered per device (`serene-pub:sessionHeaderFurled`,
 * every storage touch guarded), and focus follows the press so a keyboard
 * never lands on nothing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const KEY = "serene-pub:sessionHeaderFurled"

/** A Map-backed Storage: this environment's own is not one. */
function memoryStorage() {
	const m = new Map<string, string>()
	return {
		getItem: vi.fn((k: string) => m.get(k) ?? null),
		setItem: vi.fn((k: string, v: string) => void m.set(k, String(v))),
		removeItem: vi.fn((k: string) => void m.delete(k)),
		clear: vi.fn(() => m.clear())
	}
}
let storage = memoryStorage()

// Svelte's runtime, loaded beside the component after each module reset —
// one runtime, or a mount from the old copy cannot draw the new component.
let svelte: typeof import("svelte")
let app: ReturnType<typeof import("svelte").mount> | null = null

beforeEach(async () => {
	storage = memoryStorage()
	vi.stubGlobal("localStorage", storage)
	// The preference is read once, when the shell's prefs are made: a fresh
	// module per test is a fresh page load.
	vi.resetModules()
	svelte = await import("svelte")
})

afterEach(() => {
	if (app) svelte.unmount(app)
	app = null
	vi.unstubAllGlobals()
	document.body.innerHTML = ""
})

const flushSync = () => svelte.flushSync()
/** The press's own `tick()` and focus, then ours. */
const tick = async () => {
	await svelte.tick()
	await new Promise((r) => setTimeout(r, 0))
}

async function mountHeader() {
	const { default: Header } = await import("./Header.svelte")
	const { shellPrefs } = await import("$lib/client/shell/shellPrefs.svelte")
	app = svelte.mount(Header, {
		target: document.body,
		props: {},
		context: new Map<string, unknown>([
			[
				"openSessionCtx",
				{ sessionId: 1, sessionName: "The Lantern Inn", genreName: "Chat", cast: [] }
			]
		])
	})
	flushSync()
	return shellPrefs
}

const byLabel = (label: string) =>
	document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

describe("note 29 · furling the session header", () => {
	test("Hide rolls the bar up, remembers it, and hands focus to the way back", async () => {
		const prefs = await mountHeader()
		expect(document.querySelector("h1")?.textContent?.trim()).toBe("The Lantern Inn")
		const hide = byLabel("Hide the session header")!
		expect(hide.getAttribute("aria-expanded")).toBe("true")

		hide.click()
		flushSync()
		await tick()
		expect(prefs.headerFurled).toBe(true)
		expect(localStorage.getItem(KEY)).toBe("true")
		expect(document.querySelector("header")).toBeNull()
		const show = byLabel("Show the session header")!
		expect(show.getAttribute("aria-expanded")).toBe("false")
		expect(document.activeElement).toBe(show)

		show.click()
		flushSync()
		await tick()
		expect(prefs.headerFurled).toBe(false)
		expect(localStorage.getItem(KEY)).toBe("false")
		expect(document.querySelector("h1")?.textContent?.trim()).toBe("The Lantern Inn")
		expect(document.activeElement).toBe(byLabel("Hide the session header"))
	}, 60_000)

	test("a furled header stays furled on the next visit", async () => {
		localStorage.setItem(KEY, "true")
		await mountHeader()
		expect(document.querySelector("header")).toBeNull()
		expect(byLabel("Show the session header")).not.toBeNull()
	}, 60_000)

	test("storage that throws never breaks the toggle", async () => {
		storage.getItem.mockImplementation(() => {
			throw new Error("blocked")
		})
		storage.setItem.mockImplementation(() => {
			throw new Error("blocked")
		})
		const prefs = await mountHeader()
		expect(prefs.headerFurled).toBe(false)
		byLabel("Hide the session header")!.click()
		flushSync()
		expect(prefs.headerFurled).toBe(true)
		expect(byLabel("Show the session header")).not.toBeNull()
	}, 60_000)
})
