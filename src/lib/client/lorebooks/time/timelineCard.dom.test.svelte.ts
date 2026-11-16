/**
 * 🚧 Book settings' Timeline card: on saves at once; off asks in place only
 * when the book holds something dated; notes over a lorebook state their
 * lorebook's switch; a primer page draws no card; with the switch off the
 * clock and calendar editors are not drawn.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans, strings and plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { socket, asks, state } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} },
	asks: [] as Array<{ event: string; params: any }>,
	state: {
		counts: undefined as any,
		refuse: false,
		/** How a lorebooks:duplicate settles. */
		dup: "ok" as "ok" | "refuse" | "other" | "hang"
	}
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
	awaitReply: async (o: { event: string; params: any }) => {
		asks.push({ event: o.event, params: o.params })
		if (o.event === "lorebooks:get")
			return {
				lorebookId: o.params.id,
				lorebook: { id: o.params.id, timelineCounts: state.counts }
			}
		if (o.event === "lorebooks:update") {
			if (state.refuse) throw new Error("Only the owner can do that.")
			return { requestId: o.params.requestId }
		}
		if (o.event === "lorebooks:duplicate") {
			if (state.dup === "hang" || state.dup === "other") {
				// A reply for another request never matches: it stays pending.
				const other = { lorebook: { id: 99 }, requestId: "someone-else" }
				if ((o as any).match(other)) return other
				return new Promise(() => {})
			}
			if (state.dup === "refuse")
				throw new Error("A session's notes cannot be copied.")
			return { lorebook: { id: 42 }, requestId: o.params.requestId }
		}
		return { choices: [], defaultId: null }
	}
}))

import TimelineCard from "./TimelineCard.svelte"
import BookSettings from "../BookSettings.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	asks.length = 0
	state.counts = undefined
	state.refuse = false
	state.dup = "ok"
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const has = (sel: string) => q(sel) !== null
const updates = () => asks.filter((a) => a.event === "lorebooks:update")
const copyAsks = () => asks.filter((a) => a.event === "lorebooks:duplicate")
const button = (label: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === label
	) ?? null

function flip() {
	const input = q('[data-field="book-timeline"] input')!
	input.click()
}

async function card(over: Record<string, unknown> = {}) {
	app = mount(TimelineCard, {
		target: document.body,
		props: { lorebookId: 7, timelineEnabled: true, ...over }
	})
	await settle()
}

describe("Timeline card", () => {
	const byPass = () => document.querySelector("[data-lore-book-timeline-by-pass]")
	test("says when an update switched it off", async () => {
		await card({ timelineEnabled: false, offByPass: true })
		expect(byPass()?.textContent).toContain("An update switched this off")
	})
	test("does not say so once it is on again", async () => {
		await card({ timelineEnabled: true, offByPass: true })
		expect(byPass()).toBeNull()
	})
	test("does not say so for a lorebook a person made without a timeline", async () => {
		await card({ timelineEnabled: false })
		expect(byPass()).toBeNull()
	})

	test("switching on saves at once", async () => {
		await card({ timelineEnabled: false })
		flip()
		await settle()
		expect(updates()).toHaveLength(1)
		expect(updates()[0].params.timelineEnabled).toBe(true)
		expect(updates()[0].params.lorebook).toEqual({ id: 7 })
		expect(has("[data-lore-book-timeline-confirm]")).toBe(false)
	})

	test("off with nothing dated saves at once", async () => {
		state.counts = { datedChanges: 0, historyEntries: 0, clockSet: false }
		await card()
		flip()
		await settle()
		expect(asks.some((a) => a.event === "lorebooks:get")).toBe(true)
		expect(updates()).toHaveLength(1)
		expect(updates()[0].params.timelineEnabled).toBe(false)
		expect(has("[data-lore-book-timeline-confirm]")).toBe(false)
	})

	test("off with no counts in the reply saves nothing and says so", async () => {
		await card()
		flip()
		await settle()
		expect(updates()).toHaveLength(0)
		expect(has("[data-lore-book-timeline-confirm]")).toBe(false)
		expect(!!q('[data-lore-book-timeline] [role="alert"]')).toBe(true)
	})

	test("off with counts asks in place, names them, and saves only on Switch off here", async () => {
		state.counts = { datedChanges: 3, historyEntries: 1, clockSet: false }
		await card()
		flip()
		await settle()
		expect(updates()).toHaveLength(0)
		const text = q("[data-lore-book-timeline-confirm]")?.textContent ?? ""
		expect(text).toContain("3 dated versions and 1 history entry.")
		expect(text).toContain("hidden, not deleted")
		button("Switch off here")!.click()
		await settle()
		expect(updates()).toHaveLength(1)
		expect(updates()[0].params.timelineEnabled).toBe(false)
		expect(has("[data-lore-book-timeline-confirm]")).toBe(false)
	})

	test("the prompt names only what is held: presences, a clock, one dated version in the singular", async () => {
		state.counts = { datedChanges: 1, historyEntries: 0, presences: 2, clockSet: true }
		await card()
		flip()
		await settle()
		expect(q("[data-lore-book-timeline-confirm]")?.textContent).toContain(
			"This lorebook has 1 dated version, 2 cast presences and a story clock."
		)
	})

	const prompt = async (counts: Record<string, unknown>) => {
		state.counts = counts
		await card()
		flip()
		await settle()
		return q("[data-lore-book-timeline-confirm]")?.textContent ?? ""
	}
	test("the prompt names entries with a beginning, plural", async () => {
		expect(
			await prompt({ datedChanges: 0, historyEntries: 1, beginnings: 2, clockSet: false })
		).toContain("This lorebook has 1 history entry and 2 entries with a beginning.")
	})
	test("the prompt names one entry with a beginning in the singular", async () => {
		expect(
			await prompt({ datedChanges: 1, historyEntries: 0, beginnings: 1, clockSet: false })
		).toContain("1 dated version and 1 entry with a beginning.")
	})
	test("a count of 0 says nothing", async () => {
		expect(
			await prompt({ datedChanges: 1, historyEntries: 0, beginnings: 0, clockSet: false })
		).not.toContain("beginning")
	})

	test("Cancel changes nothing", async () => {
		state.counts = { datedChanges: 2, historyEntries: 2, clockSet: false }
		await card()
		flip()
		await settle()
		button("Cancel")!.click()
		await settle()
		expect(has("[data-lore-book-timeline-confirm]")).toBe(false)
		expect(updates()).toHaveLength(0)
	})

	test("a refusal shows in the card", async () => {
		state.refuse = true
		await card({ timelineEnabled: false })
		flip()
		await settle()
		expect(q('[role="alert"]')?.textContent).toBe(
			"Only the owner can do that."
		)
	})

	async function openPrompt(over: Record<string, unknown> = {}) {
		state.counts = { datedChanges: 3, historyEntries: 0, clockSet: false }
		await card(over)
		flip()
		await settle()
	}
	const buttonsIn = () =>
		[
			...document.body.querySelectorAll<HTMLButtonElement>(
				"[data-lore-book-timeline-confirm] button"
			)
		].map((b) => b.textContent?.trim())
	const classOf = (label: string) => button(label)?.className ?? ""

	test("the prompt's buttons: Cancel, Switch off here, Make a timeless copy, and only the copy is gold", async () => {
		await openPrompt()
		expect(buttonsIn().join("|")).toBe(
			"Cancel|Switch off here|Make a timeless copy"
		)
		expect(classOf("Make a timeless copy")).toContain(
			"preset-filled-primary-500"
		)
		expect(classOf("Switch off here")).not.toContain("preset-filled-primary-500")
		expect(classOf("Cancel")).not.toContain("preset-filled-primary-500")
		const text = q("[data-lore-book-timeline-confirm]")?.textContent ?? ""
		expect(text.replace(/\s+/g, " ")).toContain(
			"read the lorebook as it stands now. A timeless copy keeps this one as it is."
		)
	})

	test("Make a timeless copy on main sends the copy, opens it, and never touches the switch", async () => {
		const opened: number[] = []
		await openPrompt({ onDuplicated: (id: number) => opened.push(id) })
		button("Make a timeless copy")!.click()
		await settle()
		expect(copyAsks()).toHaveLength(1)
		const params = copyAsks()[0].params
		expect(params.lorebookId).toBe(7)
		expect(params.timeless).toEqual({ branchId: null })
		expect(typeof params.requestId).toBe("string")
		expect(params.requestId.length).toBeGreaterThan(0)
		expect(opened.join(",")).toBe("42")
		expect(updates()).toHaveLength(0)
		expect(has("[data-lore-book-timeline-confirm]")).toBe(false)
	})

	test("on a line the copy is made from that line", async () => {
		await openPrompt({ branchId: 5, branchName: "Wreck", lineCount: 2 })
		button("Make a timeless copy")!.click()
		await settle()
		expect(copyAsks()[0].params.timeless).toEqual({ branchId: 5 })
	})

	test("a reply for another request does not settle it", async () => {
		state.dup = "other"
		const opened: number[] = []
		await openPrompt({ onDuplicated: (id: number) => opened.push(id) })
		button("Make a timeless copy")!.click()
		await settle()
		expect(opened).toHaveLength(0)
		expect(has("[data-lore-book-timeline-confirm]")).toBe(true)
		expect(button("Copying…") !== null).toBe(true)
	})

	test("Copying… while it runs, the other buttons disabled", async () => {
		state.dup = "hang"
		await openPrompt()
		button("Make a timeless copy")!.click()
		await settle()
		expect(button("Make a timeless copy")).toBeNull()
		expect(button("Copying…")?.disabled).toBe(true)
		expect(button("Cancel")?.disabled).toBe(true)
		expect(button("Switch off here")?.disabled).toBe(true)
		expect(q('[data-field="book-timeline"] input')?.hasAttribute("disabled")).toBe(
			true
		)
	})

	test("a refusal shows in the card and the prompt stays", async () => {
		state.dup = "refuse"
		await openPrompt()
		button("Make a timeless copy")!.click()
		await settle()
		expect(q('[role="alert"]')?.textContent).toBe(
			"A session's notes cannot be copied."
		)
		expect(has("[data-lore-book-timeline-confirm]")).toBe(true)
		expect(button("Switch off here")?.disabled).toBe(false)
		expect(button("Cancel")?.disabled).toBe(false)
		expect(button("Make a timeless copy") !== null).toBe(true)
	})

	test("the line sentence only with more than one line", async () => {
		await openPrompt({ branchName: "Wreck", branchId: 5, lineCount: 2 })
		expect(q("[data-lore-book-timeline-line]")?.textContent?.trim()).toBe(
			"The copy is made from the line Wreck."
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await openPrompt({ lineCount: 2 })
		expect(q("[data-lore-book-timeline-line]")?.textContent?.trim()).toBe(
			"The copy is made from the line main."
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await openPrompt({ lineCount: 1 })
		expect(has("[data-lore-book-timeline-line]")).toBe(false)
	})

	test("a session's notes get no copy: Cancel and a gold Switch off here, today's text", async () => {
		await openPrompt({ sessionNotes: true, lineCount: 3 })
		expect(buttonsIn().join("|")).toBe("Cancel|Switch off here")
		expect(classOf("Switch off here")).toContain("preset-filled-primary-500")
		const text = q("[data-lore-book-timeline-confirm]")?.textContent ?? ""
		expect(text).not.toContain("timeless copy")
		expect(has("[data-lore-book-timeline-line]")).toBe(false)
	})

	test("notes over a lorebook show the words and no switch", async () => {
		await card({ overlaysLorebook: true, timelineEnabled: false })
		expect(has('[data-field="book-timeline"]')).toBe(false)
		expect(
			q("[data-lore-book-timeline-follows]")?.textContent?.replace(
				/\s+/g,
				" "
			)
		).toContain(
			"Off: these notes follow their lorebook's timeline."
		)
	})
})

const settingsProps = (over: Record<string, unknown> = {}) => ({
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

function settings(timelineEnabled: boolean, over = {}) {
	app = mount(BookSettings, {
		target: document.body,
		context: new Map<unknown, unknown>([
			["userSettingsCtx", { settings: { showAdvancedControls: true } }],
			...bookDataContext(staticBookData(() => ({ timelineEnabled })))
		]),
		props: settingsProps(over) as any
	})
	flushSync()
}

describe("Book settings and the Timeline switch", () => {
	test("on: the card, the clock and the calendar are drawn", () => {
		settings(true)
		expect(has("[data-lore-book-timeline]")).toBe(true)
		expect(has("[data-lore-clock]")).toBe(true)
		expect(has("[data-lore-calendar]")).toBe(true)
	})

	test("off: the card stays; no clock, no calendar", () => {
		settings(false)
		expect(has("[data-lore-book-timeline]")).toBe(true)
		expect(has("[data-lore-clock]")).toBe(false)
		expect(has("[data-lore-calendar]")).toBe(false)
	})

	test("a primer page (read-only) draws no card", () => {
		settings(true, { readOnly: true, isStarterKit: true, isProvided: true })
		expect(has("[data-lore-book-timeline]")).toBe(false)
	})
})
