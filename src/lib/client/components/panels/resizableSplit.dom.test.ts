/**
 * Owner 2026-10-02 (lorebooks round 3): the lorebook's list-beside-editor is
 * a resizable divider — dragged, stepped with the arrow keys on a focusable
 * `role="separator"` that reports `aria-valuenow`, reset by a double click,
 * and remembered per device (every storage touch guarded).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	clampShare,
	loadShare,
	saveShare,
	shareAfterKey,
	shareFromPointer,
	SPLIT_SHARE_MAX,
	SPLIT_SHARE_MIN
} from "./splitShare"

const KEY = "test:split"

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

let svelte: typeof import("svelte")
let app: ReturnType<typeof import("svelte").mount> | null = null

beforeEach(async () => {
	storage = memoryStorage()
	vi.stubGlobal("localStorage", storage)
	vi.resetModules()
	svelte = await import("svelte")
})

afterEach(() => {
	if (app) svelte.unmount(app)
	app = null
	vi.unstubAllGlobals()
	document.body.innerHTML = ""
})

async function mountSplit() {
	const { default: ResizableSplit } = await import("./ResizableSplit.svelte")
	const pane = (text: string) =>
		svelte.createRawSnippet(() => ({ render: () => `<p>${text}</p>` }))
	app = svelte.mount(ResizableSplit, {
		target: document.body,
		props: {
			storageKey: KEY,
			defaultShare: 0.4,
			firstId: "splitList",
			first: pane("list"),
			second: pane("editor")
		}
	})
	svelte.flushSync()
	return document.querySelector<HTMLElement>('[role="separator"]')!
}

const key = (el: HTMLElement, k: string, shiftKey = false) => {
	el.dispatchEvent(
		new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true })
	)
	svelte.flushSync()
}

describe("splitShare arithmetic", () => {
	test("a share is clamped to the room both panes need", () => {
		expect(clampShare(0)).toBe(SPLIT_SHARE_MIN)
		expect(clampShare(1)).toBe(SPLIT_SHARE_MAX)
		expect(clampShare(Number.NaN)).toBe(0.5)
		expect(clampShare(0.5)).toBe(0.5)
	})

	test("arrow keys step, Shift steps further, Home/End go to the ends", () => {
		expect(shareAfterKey(0.5, "ArrowRight")).toBeCloseTo(0.52)
		expect(shareAfterKey(0.5, "ArrowLeft")).toBeCloseTo(0.48)
		expect(shareAfterKey(0.5, "ArrowLeft", true)).toBeCloseTo(0.4)
		expect(shareAfterKey(0.5, "Home")).toBe(SPLIT_SHARE_MIN)
		expect(shareAfterKey(0.5, "End")).toBe(SPLIT_SHARE_MAX)
		expect(shareAfterKey(0.5, "a")).toBeNull()
	})

	test("a pointer's share leaves the gutter out", () => {
		// 1016px box, 16px gutter: x at 508 is the middle of the room.
		expect(shareFromPointer(508, 0, 1016, 16)).toBeCloseTo(0.5)
		expect(shareFromPointer(-50, 0, 1016, 16)).toBe(SPLIT_SHARE_MIN)
	})

	test("storage that refuses is no storage, never a throw", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			},
			removeItem: () => {
				throw new Error("blocked")
			}
		})
		expect(loadShare(KEY, 0.42)).toBe(0.42)
		expect(() => saveShare(KEY, 0.6)).not.toThrow()
		expect(() => saveShare(KEY, null)).not.toThrow()
	})

	test("a junk stored value falls back", () => {
		storage.setItem(KEY, "wide")
		expect(loadShare(KEY, 0.42)).toBe(0.42)
		storage.setItem(KEY, "0.95")
		expect(loadShare(KEY, 0.42)).toBe(SPLIT_SHARE_MAX)
	})
})

// The first mount compiles the component on import, and under a full
// parallel run that transform alone can take most of a 30s budget.
describe("ResizableSplit", { timeout: 60_000 }, () => {
	test("the divider is a focusable separator reporting its value", async () => {
		const divider = await mountSplit()
		expect(divider.getAttribute("tabindex")).toBe("0")
		expect(divider.getAttribute("aria-orientation")).toBe("vertical")
		expect(divider.getAttribute("aria-controls")).toBe("splitList")
		expect(divider.getAttribute("aria-valuenow")).toBe("40")
	})

	test("arrow keys move it and the share is remembered", async () => {
		const divider = await mountSplit()
		key(divider, "ArrowRight")
		expect(divider.getAttribute("aria-valuenow")).toBe("42")
		key(divider, "ArrowLeft", true)
		expect(divider.getAttribute("aria-valuenow")).toBe("32")
		expect(Number(storage.getItem(KEY))).toBeCloseTo(0.32)
	})

	test("a remembered share is where it opens", async () => {
		storage.setItem(KEY, "0.6")
		const divider = await mountSplit()
		expect(divider.getAttribute("aria-valuenow")).toBe("60")
	})

	test("a double click resets it and forgets the share", async () => {
		storage.setItem(KEY, "0.7")
		const divider = await mountSplit()
		divider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
		svelte.flushSync()
		expect(divider.getAttribute("aria-valuenow")).toBe("40")
		expect(storage.getItem(KEY)).toBeNull()
	})
})
