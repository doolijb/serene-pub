/**
 * The session header's two entries into the layout editor are drawn for
 * everyone (owner 2026-11-12), whatever the viewer's advanced controls say.
 * The full-screen corner's entry still follows advanced controls (2026-11-10).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

function memoryStorage() {
	const m = new Map<string, string>()
	return {
		getItem: vi.fn((k: string) => m.get(k) ?? null),
		setItem: vi.fn((k: string, v: string) => void m.set(k, String(v))),
		removeItem: vi.fn((k: string) => void m.delete(k)),
		clear: vi.fn(() => m.clear())
	}
}

let svelte: typeof import("svelte")
let app: ReturnType<typeof import("svelte").mount> | null = null

beforeEach(async () => {
	vi.stubGlobal("localStorage", memoryStorage())
	vi.resetModules()
	svelte = await import("svelte")
})

afterEach(() => {
	if (app) svelte.unmount(app)
	app = null
	vi.unstubAllGlobals()
	document.body.innerHTML = ""
})

async function mountHeader(userSettingsCtx?: unknown) {
	const { default: Header } = await import("./Header.svelte")
	const context = new Map<string, unknown>([
		[
			"openSessionCtx",
			{
				sessionId: 1,
				sessionName: "The Lantern Inn",
				genreName: "Chat",
				cast: []
			}
		]
	])
	if (userSettingsCtx !== undefined)
		context.set("userSettingsCtx", userSettingsCtx)
	app = svelte.mount(Header, { target: document.body, props: {}, context })
	svelte.flushSync()
}

const layoutButton = () =>
	document.querySelector('button[aria-label="Customize layout"]')
const fullScreenButton = () =>
	document.querySelector('button[aria-label="Full screen (Ctrl+Shift+F)"]')

describe("the header's Layout entry is drawn for everyone (owner 2026-11-12)", () => {
	test("no settings context: Layout and Full screen drawn", async () => {
		await mountHeader()
		expect(layoutButton() === null).toBe(false)
		expect(fullScreenButton() === null).toBe(false)
	}, 60_000)

	test("advanced controls off: Layout and Full screen drawn", async () => {
		await mountHeader({ settings: { showAdvancedControls: false } })
		expect(layoutButton() === null).toBe(false)
		expect(fullScreenButton() === null).toBe(false)
	}, 60_000)

	test("advanced controls on: Layout and Full screen drawn", async () => {
		await mountHeader({ settings: { showAdvancedControls: true } })
		expect(layoutButton() === null).toBe(false)
		expect(fullScreenButton() === null).toBe(false)
	}, 60_000)

	test("the phone menu's Customize layout entry has no guard at source", async () => {
		const { readFileSync } = await import("node:fs")
		const src = readFileSync(
			"src/lib/client/components/Header.svelte",
			"utf8"
		)
		expect(/label: "Customize layout"/.test(src)).toBe(true)
		expect(/advancedControls/.test(src)).toBe(false)
	}, 60_000)

	test("Layout and Full screen are the quiet buttons (muted until hovered or focused)", async () => {
		await mountHeader()
		for (const b of [layoutButton(), fullScreenButton()])
			expect(b!.classList.contains("sp-head-quiet")).toBe(true)
	}, 60_000)
})
