/**
 * Start a session › story time for the session's own new notes: the switch
 * (or the genre's sentence), its date line and Change, and what Start sends.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans and strings.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, requests, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	const requests: Array<{ key: string; params: any }> = []
	return {
		listeners,
		requests,
		socket: { emit: () => {}, on: () => {}, off: () => {} }
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () =>
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (
			key: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success() {}, error() {}, info() {}, warning() {} }
}))
import StartSessionForm from "./StartSessionForm.svelte"
import { formatDate } from "$lib/shared/lorebooks/storyDate"
import { STORY_CALENDAR_PRESETS } from "@serene-pub/sdk"

const GENRE = "test:genre/troupe@1"
const VIS = "core:ruleset/vis-itineris@1"
const OFFER = {
	choices: [{ id: VIS, name: "Vis Itineris", subtitle: "", recommended: true }],
	only: false,
	defaultId: VIS,
	rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
}
const SHAPE = {
	characters: { min: 0, max: 3 },
	personas: { min: 0, max: 1 },
	lorebook: "optional"
}
const BOOKS = [
	{ id: 1, name: "Book 1", kind: "book", primaryRuleset: VIS, bookAccess: "owner", timelineEnabled: false }
]
const KITS = [
	{
		id: "primer:x",
		source: "core",
		name: "Kit X",
		description: "",
		rulesId: VIS,
		rulesName: "Vis Itineris",
		counts: { entries: 1, places: 0, cast: 0 }
	}
]

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(new Date("2026-11-16T12:00:00Z"))
})
afterEach(() => {
	vi.useRealTimers()
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
function feed(key: string, msg: unknown) {
	for (const h of listeners.get(key) ?? []) h(msg)
}

interface Opts {
	rules?: unknown
	advanced?: boolean
	books?: readonly unknown[]
	preset?: Record<string, unknown>
}
async function render(o: Opts = {}) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		context: new Map([
			["userSettingsCtx", { settings: { showAdvancedControls: o.advanced ?? true } }]
		]),
		props: { onCreated: () => {}, onCancel: () => {} }
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				name: "Troupe",
				description: "",
				...(o.rules === undefined ? { rules: OFFER } : o.rules ? { rules: o.rules } : {}),
				shape: SHAPE
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [
			{ id: 1, genreId: GENRE, name: "Plain", enabled: true, isDefault: true, ...(o.preset ?? {}) },
			{
				id: 2,
				genreId: GENRE,
				name: "Timed",
				enabled: true,
				isDefault: false,
				timelineDefault: true,
				defaults: { timeline: true }
			}
		]
	})
	feed("characters:list", {
		characterList: [{ id: 5, name: "You", isPersona: true, isDefaultPersona: true }]
	})
	feed("lorebooks:list", { lorebookList: o.books ?? BOOKS })
	await settle()
	feed("starterKits:list", { kits: KITS })
	await settle()
}

const block = () => host.querySelector("[data-notes-timeline]")
const shown = () => block() !== null
const switchInput = () =>
	host.querySelector<HTMLInputElement>('[data-field="start-notes-timeline"] input')
const switchOn = () => switchInput()?.checked === true
const toggle = async () => {
	switchInput()!.click()
	await settle()
}
const required = () => host.querySelector('[data-testid="start-notes-timeline-required"]')
const dateLine = () => host.querySelector('[data-testid="start-notes-date"]')
const dateText = () => dateLine()?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const changeButton = () => host.querySelector<HTMLButtonElement>("[data-notes-date-change]")
const startButton = () =>
	[...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
const pickBook = async (id: number) => {
	host.querySelector<HTMLButtonElement>(`[data-book-row="${id}"]`)!.click()
	await settle()
}
const pickKit = async () => {
	host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:x"]')!.click()
	await settle()
}
const pickPreset = async (id: number) => {
	host.querySelector<HTMLButtonElement>('[aria-label="Change preset"]')?.click()
	await settle()
	host.querySelector<HTMLButtonElement>(`[data-preset-card="${id}"] [role="radio"]`)!.click()
	await settle()
}
const typeIn = async (label: string, value: string) => {
	const l = [...host.querySelectorAll("[data-notes-date] label")].find(
		(x) => x.querySelector("span")?.textContent?.trim() === label
	)!
	const input = l.querySelector<HTMLInputElement>("input")!
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
const created = (): any[] => requests.filter((r) => r.key === "sessions:create").map((r) => r.params)
const startAndRead = () => {
	startButton()!.click()
	flushSync()
	return created()[0]
}
const today = () => {
	const p = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(
		new Date()
	)
	const n = (t: string) => Number(p.find((x) => x.type === t)?.value)
	return { year: n("year"), month: n("month"), day: n("day") }
}
const realCal = STORY_CALENDAR_PRESETS.find((p) => p.id === "real-calendar")!.calendar

describe.each([
	["the book pick, advanced on", { advanced: true }],
	["the book pick, advanced off", { advanced: false }],
	["the plain Lorebook card, advanced on", { advanced: true, rules: null }],
	["the plain Lorebook card, advanced off", { advanced: false, rules: null }],
	["no lorebooks at all", { books: [] }]
] as Array<[string, Opts]>)("Start a session › notes timeline switch in %s", (_n, opts) => {
	test("shown with nothing chosen, off for a plain preset", async () => {
		await render(opts)
		expect(shown()).toBe(true)
		expect(block()!.textContent).toContain("Keep a timeline")
		expect(switchOn()).toBe(false)
		expect(dateLine() === null).toBe(true)
	})
})

describe("Start a session › notes timeline: where it is hidden", () => {
	test("an existing lorebook chosen", async () => {
		await render()
		expect(shown()).toBe(true)
		await pickBook(1)
		expect(shown()).toBe(false)
	})
	test("a starter kit chosen", async () => {
		await render()
		await pickKit()
		expect(shown()).toBe(false)
	})
	test("mode new-world", async () => {
		await render()
		host.querySelector<HTMLButtonElement>('[data-creation-mode="new-world"]')!.click()
		await settle()
		expect(shown()).toBe(false)
	})
})

describe("Start a session › notes timeline: initial value", () => {
	test("off for timelineDefault false or absent", async () => {
		await render({ preset: { timelineDefault: false } })
		expect(switchOn()).toBe(false)
	})
	test("on when the preset's default is a pinned timeline, and it follows a preset change", async () => {
		await render({ advanced: true })
		expect(switchOn()).toBe(false)
		await pickPreset(2)
		expect(switchOn()).toBe(true)
		expect(dateLine() !== null).toBe(true)
		await pickPreset(1)
		expect(switchOn()).toBe(false)
	})
})

describe("Start a session › notes timeline: the genre requires one", () => {
	const opts = { preset: { timelineDefault: true, timelineRequired: true } }
	test("no switch, the sentence, the date line", async () => {
		await render(opts)
		expect(switchInput() === null).toBe(true)
		expect(required()?.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Troupe always keeps story time, so this session's notes keep a timeline."
		)
		expect(dateLine() !== null).toBe(true)
	})
	test("Start sends no notesTimeline", async () => {
		await render(opts)
		expect("notesTimeline" in startAndRead()).toBe(false)
	})
})

describe("Start a session › notes timeline: the date line", () => {
	test("appears and disappears with the switch, in words of today on the real calendar", async () => {
		await render()
		expect(dateLine() === null).toBe(true)
		await toggle()
		expect(dateText()).toBe(`The story begins today, ${formatDate(today(), realCal)}. Change`)
		await toggle()
		expect(dateLine() === null).toBe(true)
	})
})

describe("Start a session › notes timeline: the sentence, help and errors", () => {
	test("a picked day changes the sentence", async () => {
		await render()
		await toggle()
		expect(dateText()).toContain("The story begins today,")
		changeButton()!.click()
		await settle()
		await typeIn("Year", "1999")
		await typeIn("Month", "3")
		await typeIn("Day", "7")
		expect(dateText()).toBe(`The story begins on ${formatDate({ year: 1999, month: 3, day: 7 }, realCal)}.`)
		expect(dateText()).not.toContain("today")
	})
	test("the switch is described by its help", async () => {
		await render()
		const id = switchInput()!.getAttribute("aria-describedby")
		expect(id).toBe("start-notes-timeline-help")
		expect(host.querySelector(`#${id}`)?.textContent).toContain("Dates, history and a story clock")
	})
	test("the date inputs are aria-invalid while the day does not land", async () => {
		await render()
		await toggle()
		changeButton()!.click()
		await settle()
		const inputs = () => [...host.querySelectorAll<HTMLInputElement>("[data-notes-date] input")]
		expect(inputs().map((i) => i.getAttribute("aria-invalid"))).toEqual(["false", "false", "false"])
		await typeIn("Month", "13")
		expect(inputs().map((i) => i.getAttribute("aria-invalid"))).toEqual(["true", "true", "true"])
		expect(host.querySelector('[data-notes-date-hint] [role="alert"]') !== null).toBe(true)
		await typeIn("Month", "12")
		expect(inputs().map((i) => i.getAttribute("aria-invalid"))).toEqual(["false", "false", "false"])
	})
	test("timelineRequired with the default pinned shows the sentence, not the switch", async () => {
		await render({ preset: { timelineDefault: true, timelineRequired: true, defaults: { timeline: true } } })
		expect(switchInput() === null).toBe(true)
		expect(required() !== null).toBe(true)
	})
})

describe("Start a session › notes timeline: what Start sends", () => {
	test("notesTimeline false, then true", async () => {
		await render()
		expect(startAndRead().notesTimeline).toBe(false)
	})
	test("true with the switch on and no clock", async () => {
		await render()
		await toggle()
		const p = startAndRead()
		expect(p.notesTimeline).toBe(true)
		const t = today()
		expect([
			p.session.storyClockYear,
			p.session.storyClockMonth,
			p.session.storyClockDay,
			p.session.storyClockHour,
			p.session.storyClockMinute
		]).toEqual([t.year, t.month, t.day, null, null])
	})
	test("a required genre sends today's date too", async () => {
		await render({ preset: { timelineDefault: true, timelineRequired: true } })
		const p = startAndRead()
		const t = today()
		expect([p.session.storyClockYear, p.session.storyClockMonth, p.session.storyClockDay]).toEqual([
			t.year,
			t.month,
			t.day
		])
	})
	test("a day that rolled over between mount and Start is the day sent", async () => {
		await render()
		await toggle()
		vi.setSystemTime(new Date("2026-11-18T12:00:00Z"))
		const p = startAndRead()
		expect([p.session.storyClockYear, p.session.storyClockMonth, p.session.storyClockDay]).toEqual([
			2026, 11, 18
		])
	})
	test("none with an existing lorebook chosen", async () => {
		await render()
		await pickBook(1)
		expect("notesTimeline" in startAndRead()).toBe(false)
	})
	test("Change and a valid date send the storyClock parts", async () => {
		await render()
		await toggle()
		changeButton()!.click()
		await settle()
		await typeIn("Year", "1999")
		await typeIn("Month", "3")
		await typeIn("Day", "7")
		const p = startAndRead()
		expect(p.notesTimeline).toBe(true)
		expect([
			p.session.storyClockYear,
			p.session.storyClockMonth,
			p.session.storyClockDay,
			p.session.storyClockHour,
			p.session.storyClockMinute
		]).toEqual([1999, 3, 7, null, null])
	})
	test("switch turned off after picking a date sends no storyClock", async () => {
		await render()
		await toggle()
		changeButton()!.click()
		await settle()
		await typeIn("Year", "1999")
		await toggle()
		const p = startAndRead()
		expect(p.notesTimeline).toBe(false)
		expect("storyClockYear" in p.session).toBe(false)
	})
	test("an invalid date keeps Start grey and says why", async () => {
		await render()
		await toggle()
		changeButton()!.click()
		await settle()
		await typeIn("Month", "13")
		expect(startButton()?.disabled).toBe(true)
		expect(host.querySelector("#start-session-reason")?.textContent?.trim()).toBe(
			"Choose the date the story begins on."
		)
		expect((host.querySelector("[data-notes-date-hint]")?.textContent ?? "").trim().length > 0).toBe(true)
		await typeIn("Month", "12")
		expect(startButton()?.disabled).toBe(false)
	})
	test("an invalid date leaves the summary line without a date", async () => {
		await render()
		await toggle()
		expect(host.querySelector("[data-testid=start-notes-date]")?.textContent).toContain("begins today")
		changeButton()!.click()
		await settle()
		await typeIn("Month", "2")
		await typeIn("Day", "30")
		expect(host.querySelector("[data-testid=start-notes-date]")).toBeNull()
		expect((host.querySelector("[data-notes-date-hint]")?.textContent ?? "").trim().length > 0).toBe(true)
		await typeIn("Day", "12")
		expect(host.querySelector("[data-testid=start-notes-date]")?.textContent).toContain("begins on")
	})
})
