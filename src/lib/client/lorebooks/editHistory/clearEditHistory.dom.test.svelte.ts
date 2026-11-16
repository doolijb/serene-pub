/**
 * 🚧 Book settings › Clear edit history: drawn only for the owner with a count
 * above 0, asks before it clears, says a refusal in the dialog.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { socket, replies, emits } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} },
	replies: {} as Record<string, () => Promise<unknown>>,
	emits: [] as { event: string; params: unknown }[]
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
	toaster: { error() {}, warning() {}, info() {}, success() {} }
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: (o: { event: string; params: unknown }) => {
		emits.push({ event: o.event, params: o.params })
		return (replies[o.event] ?? (() => Promise.reject(new Error("no"))))()
	}
}))

import BookSettings from "../BookSettings.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	emits.length = 0
	for (const k of Object.keys(replies)) delete replies[k]
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

async function render(over = {}) {
	app = mount(BookSettings, {
		target: document.body,
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings: { showAdvancedControls: false } }]
		]),
		props: props(over) as any
	})
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const action = () =>
	document.querySelector(
		"[data-book-settings-clear-history]"
	) as HTMLElement | null
const count = (n: number) => () =>
	Promise.resolve({ lorebookId: 1, entryId: null, count: n })
const tick = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const confirmButton = () =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Clear edit history"
	) as HTMLButtonElement | undefined

describe("Book settings: Clear edit history", () => {
	test("a count above 0 draws the action; the dialog names it; confirming clears the book", async () => {
		replies["entries:redlineCount"] = count(12)
		replies["entries:clearRedlines"] = () =>
			Promise.resolve({ lorebookId: 1, entryId: null, cleared: 12 })
		await render()
		expect(action()?.textContent).toContain("Clear edit history…")
		action()!.click()
		await tick()
		expect(document.body.textContent).toContain("Removes 12 edits")
		confirmButton()!.click()
		await tick()
		expect(
			emits.find((e) => e.event === "entries:clearRedlines")?.params
		).toEqual({
			lorebookId: 1
		})
		expect(action()).toBeNull()
	})

	test("a refusal shows in the dialog", async () => {
		replies["entries:redlineCount"] = count(3)
		replies["entries:clearRedlines"] = () =>
			Promise.reject(new Error("Only the owner may."))
		await render()
		action()!.click()
		await tick()
		confirmButton()!.click()
		await tick()
		expect(document.body.textContent).toContain("Only the owner may.")
	})

	test("a count of 0, a refused count, or read-only draws nothing", async () => {
		replies["entries:redlineCount"] = count(0)
		await render()
		expect(action()).toBeNull()
		unmount(app!)
		replies["entries:redlineCount"] = () => Promise.reject(new Error("no"))
		await render()
		expect(action()).toBeNull()
		unmount(app!)
		replies["entries:redlineCount"] = count(5)
		await render({ readOnly: true })
		expect(action()).toBeNull()
	})
})
