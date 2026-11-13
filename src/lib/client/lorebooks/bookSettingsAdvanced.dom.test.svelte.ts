/**
 * 🚧 Advanced controls (2026-11-10): Book settings hides the Rules card and
 * the calendar editor while the person's switch is off, and says so once at
 * the foot. Hidden never means removed: the rest of the page stays.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { socket } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} }
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = () => () => {}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: declareInterest,
		getInterestContext: () => ({
			useInterest: declareInterest,
			declareInterest,
			requestWithInterest: declareInterest
		})
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		warning: () => {},
		info: () => {},
		success: () => {}
	}
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async () => ({ choices: [], defaultId: null })
}))

import BookSettings from "./BookSettings.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const props = (over: Record<string, unknown> = {}) => ({
	lorebookId: 1,
	bookName: "Harbour",
	branchId: null,
	branchName: null,
	branches: [],
	present: null,
	onSetClock: () => {},
	counts: { entries: 0, places: 0, cast: 0 },
	rowsByType: {},
	scenes: [],
	relationships: 0,
	readingInto: null,
	primaryRuleset: "core:ruleset/freeform@1",
	loreWriteMode: null,
	hasUnsavedChanges: false,
	onClose: () => {},
	onImport: () => {},
	onDuplicate: () => {},
	onDelete: () => {},
	...over
})

function render(
	ctx: { settings: { showAdvancedControls: boolean } },
	over = {}
) {
	app = mount(BookSettings, {
		target: document.body,
		context: new Map<string, unknown>([["userSettingsCtx", ctx]]),
		props: props(over) as any
	})
	flushSync()
}

const has = (sel: string) => document.querySelector(sel) !== null
/** Drawn and not inside a `hidden` wrapper (the calendar stays mounted off, so its draft survives a flip). */
const shown = (sel: string) => {
	const el = document.querySelector(sel)
	return el !== null && el.closest("[hidden]") === null
}
const hiddenLines = () =>
	(document.body.textContent ?? "").split("Some controls are hidden.")
		.length - 1

describe("Book settings under advanced controls", () => {
	test("off: no Rules card, no calendar; the rest stays; one line at the foot", () => {
		render({ settings: { showAdvancedControls: false } })
		expect(has("[data-lore-book-rules]")).toBe(false)
		expect(shown("[data-lore-calendar]")).toBe(false)
		expect(has("[data-lore-clock]")).toBe(true)
		expect(document.body.textContent).toContain("What this book holds")
		expect(document.body.textContent).toContain("Reading into a session")
		expect(hiddenLines()).toBe(1)
		const root = document.querySelector("[data-lore-book-settings]")!
		expect(root.lastElementChild?.textContent).toContain(
			"Some controls are hidden."
		)
	})

	test("on: the Rules card and the calendar are drawn, and no line", () => {
		render({ settings: { showAdvancedControls: true } })
		expect(has("[data-lore-book-rules]")).toBe(true)
		expect(shown("[data-lore-calendar]")).toBe(true)
		expect(hiddenLines()).toBe(0)
	})

	test("read-only: no line", () => {
		render(
			{ settings: { showAdvancedControls: false } },
			{ readOnly: true, isStarterKit: true, isProvided: true }
		)
		expect(hiddenLines()).toBe(0)
	})

	test("flipping the switch redraws without a remount", () => {
		const ctx = $state({ settings: { showAdvancedControls: false } })
		render(ctx)
		expect(shown("[data-lore-calendar]")).toBe(false)
		expect(hiddenLines()).toBe(1)
		ctx.settings.showAdvancedControls = true
		flushSync()
		expect(shown("[data-lore-calendar]")).toBe(true)
		expect(has("[data-lore-book-rules]")).toBe(true)
		expect(hiddenLines()).toBe(0)
		ctx.settings.showAdvancedControls = false
		flushSync()
		expect(shown("[data-lore-calendar]")).toBe(false)
		expect(hiddenLines()).toBe(1)
		// Still mounted while hidden, so an unsaved calendar draft is kept.
		expect(has("[data-lore-calendar]")).toBe(true)
	})
})
