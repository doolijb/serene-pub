/**
 * Edit Session › advanced controls (2026-11-10): with the switch off the
 * Settings tab hides the controls that tune how a session works and says so
 * once; a hidden control keeps its stored value, and Save sends it unchanged.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, socket } = vi.hoisted(() => {
	// Several components listen on one key (the pickers share `characters:list`).
	const listeners = new Map<string, Array<(msg: any) => void>>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			},
			on: () => {},
			off: () => {}
		}
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
		return () => {
			const rest = (listeners.get(key) ?? []).filter((h) => h !== handler)
			if (rest.length) listeners.set(key, rest)
			else listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) =>
			declareInterest(key, handler),
		requestWithInterest: (
			event: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"
import { interestKey } from "$lib/shared/sockets/interest"

const GENRE = "test:genre/crawl@1"
const LINE = "Some controls are hidden."

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

/** `maybe`: a child the switch leaves unmounted listens on nothing. */
function deliver(key: string, msg: unknown, maybe = false) {
	const handlers = listeners.get(key)
	if (!handlers && maybe) return
	if (!handlers)
		throw new Error(
			`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`
		)
	for (const handler of handlers!) handler(msg)
	flushSync()
}

const sessionMsg = (userId: number, extra: Record<string, unknown> = {}) => ({
	session: {
		id: 7,
		userId,
		name: "The crawl",
		scenario: "",
		genreId: GENRE,
		genreFields: {},
		lorebookId: 5,
		onRevision: "branch",
		sessionCharacters: [],
		sessionPersonas: [],
		sessionGuests: [],
		tags: [],
		...extra
	}
})

const preset = (id: number) => ({
	id,
	name: `Preset ${id}`,
	description: null,
	genreId: GENRE,
	enabled: true,
	bindings: {},
	primarySlug: null,
	configSelections: {},
	includedActions: null,
	settings: {}
})

type Opts = {
	advanced: boolean
	viewerId?: number
	isAdmin?: boolean
	pipelines?: boolean
}

/** One reactive settings object, so a test can flip the switch in place. */
function openForm(opts: Opts) {
	const settingsCtx = $state({
		settings: { showAdvancedControls: opts.advanced }
	})
	app = mount(EditSessionForm, {
		target: document.body,
		props: {
			editSessionId: 7,
			showEditSessionForm: true,
			initialTab: "settings"
		},
		context: new Map<string, unknown>([
			[
				"userCtx",
				{ user: { id: opts.viewerId ?? 1, isAdmin: !!opts.isAdmin } }
			],
			["userSettingsCtx", settingsCtx]
		])
	})
	flushSync()
	return settingsCtx
}

async function feed(opts: Opts, sessionExtra: Record<string, unknown> = {}) {
	deliver("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				shape: {
					characters: { min: 0 },
					personas: { min: 0 },
					lorebook: "optional",
					fields: {},
					turnControls: { retake: {} }
				}
			}
		]
	})
	deliver("sessionPresets:list", { presets: [preset(1), preset(2)] })
	deliver("sessions:get#7", sessionMsg(1, sessionExtra))
	await tick()
	flushSync()
	deliver("sessions:functions", {
		sessionId: 7,
		genreId: GENRE,
		functions: [
			{
				key: "narrate",
				venues: [],
				quick: false,
				slash: "",
				name: "Narrate",
				specSlug: "s",
				origin: "companion",
				enabledByDefault: true,
				enabled: true,
				explicit: false,
				included: true,
				source: "preset"
			}
		]
	})
	deliver("sessions:pipelines", {
		sessionId: 7,
		pipelines:
			opts.pipelines === false
				? []
				: [{ slug: "respond", label: "Reply" }]
	})
	deliver(
		"sessions:pipelineCards",
		{
			sessionId: 7,
			cards: [
				{
					spec: "s",
					specName: "Reply",
					nodeKey: "turn.order",
					options: [{ definitionId: "a", name: "A" }],
					selected: null,
					default: null
				}
			]
		},
		true
	)
	deliver(
		"sessions:setRulesetSettings",
		{
			sessionId: 7,
			canEdit: true,
			rulesOptions: {
				rulesetId: "r",
				rulesetName: "Rules",
				installed: true,
				options: [
					{
						id: "o",
						label: "Option",
						value: "x",
						default: "x",
						choices: [{ id: "x", label: "X" }]
					}
				],
				presets: [],
				stored: {}
			}
		},
		true
	)
	deliver(
		"sessions:settingsForm",
		{
			sessionId: 7,
			viewer: "owner",
			groups: [
				{
					kind: "genre",
					id: "genre",
					heading: "Notes",
					fields: [
						{
							id: JSON.stringify(["genre", "mood"]),
							address: { kind: "genre", key: "mood" },
							label: "Mood",
							control: "text",
							value: "calm",
							inherited: "",
							source: "session",
							reach: "owner",
							editable: true
						}
					]
				}
			]
		},
		true
	)
	await tick()
	flushSync()
}

const panel = () => document.getElementById("session-panel-settings")!
const text = () => panel().textContent ?? ""
const lines = () => text().split(LINE).length - 1
const byId = (id: string) => document.getElementById(id)
const testId = (id: string) => panel().querySelector(`[data-testid="${id}"]`)

/** Each hidden control's marker, present or not. */
function markers() {
	return {
		actions: [...panel().querySelectorAll("h3")].some(
			(h) => h.textContent?.trim() === "Actions"
		),
		onRevision: byId("session-on-revision") != null,
		pipelines: byId("session-pipelines") != null,
		howReplies: text().includes("How replies are made"),
		rules: text().includes("Rules options"),
		retake: text().includes("Ask before regenerating a turn"),
		annex: text().includes("Session data")
	}
}
const ALL_ON = {
	actions: true,
	onRevision: true,
	pipelines: true,
	howReplies: true,
	rules: true,
	retake: true,
	annex: true
}
const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false]))

describe("Edit Session — advanced controls on the Settings tab", () => {
	test("owner, off: the how-it-works controls are gone, the reading is read-only, one line says so", async () => {
		const o = { advanced: false }
		openForm(o)
		await feed(o)
		expect(markers()).toEqual(ALL_OFF)
		expect(testId("session-story-clock-readonly")).not.toBeNull()
		expect(testId("session-preset-control")).not.toBeNull()
		expect(testId("session-settings-form")).not.toBeNull()
		expect(lines()).toBe(1)
	})

	test("owner, on: every one renders, the reading is editable, no line", async () => {
		const o = { advanced: true }
		openForm(o)
		await feed(o)
		expect(markers()).toEqual(ALL_ON)
		expect(testId("session-lorebook-reading")).not.toBeNull()
		expect(testId("session-story-clock-readonly")).toBeNull()
		expect(testId("session-preset-control")).not.toBeNull()
		expect(testId("session-settings-form")).not.toBeNull()
		expect(lines()).toBe(0)
	})

	test("guest, off, not admin, no session pipelines: no line", async () => {
		const o = { advanced: false, viewerId: 2, pipelines: false }
		openForm(o)
		await feed(o)
		expect(lines()).toBe(0)
		expect(markers()).toEqual(ALL_OFF)
	})

	test("guest, off, with session pipelines: one line", async () => {
		const o = { advanced: false, viewerId: 2 }
		openForm(o)
		await feed(o)
		expect(lines()).toBe(1)
		expect(markers().pipelines).toBe(false)
	})

	test("flipping the switch redraws in place: controls appear, the line goes", async () => {
		const o = { advanced: false }
		const ctx = openForm(o)
		await feed(o)
		expect(lines()).toBe(1)
		expect(markers().onRevision).toBe(false)
		ctx.settings.showAdvancedControls = true
		flushSync()
		await tick()
		flushSync()
		expect(lines()).toBe(0)
		expect(markers().onRevision).toBe(true)
		expect(markers().pipelines).toBe(true)
		expect(testId("session-story-clock-readonly")).toBeNull()
	})

	test("Save sends the same stored On revision and reading with the switch off as on", async () => {
		const sentWith = async (advanced: boolean) => {
			const o = { advanced }
			openForm(o)
			await feed(o)
			const name = byId("sessionName") as HTMLInputElement
			name.value = "Renamed"
			name.dispatchEvent(new Event("input", { bubbles: true }))
			flushSync()
			;(
				[...document.querySelectorAll("button")].find(
					(b) => b.textContent?.trim() === "Save"
				) as HTMLButtonElement
			).click()
			flushSync()
			const sent = emitted
				.filter(([e]) => e === "sessions:update")
				.at(-1)?.[1]
			unmount(app!)
			app = null
			listeners.clear()
			emitted.length = 0
			document.body.innerHTML = ""
			return sent
		}
		const off = await sentWith(false)
		const on = await sentWith(true)
		expect(off.session.name).toBe("Renamed")
		expect(off.session.onRevision).toBe("branch")
		expect(off.session).toEqual(on.session)
	})
})

/** Three months, a three-day week, one era: spells differently from free-form. */
const THAW = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	weekdays: ["Moonday", "Ashday", "Restday"],
	firstWeekday: 0,
	yearLabel: "Year",
	leap: null,
	eras: [{ name: "AR", start: 1 }]
}
const READING = {
	lorebookBranchId: 9,
	storyClockYear: 1,
	storyClockMonth: 1,
	storyClockDay: 2
}
const OWNER_SENTENCE = "Turn on advanced controls to change them."
const GUEST_SENTENCE = "The session owner chooses both."

/** The book's story time and lines, as the owner's `BookTime` hears them. */
function deliverBook() {
	deliver(interestKey("lorebooks:storyTime", 5), {
		lorebookId: 5,
		calendar: THAW,
		clocks: { main: null, branches: [] },
		presents: null
	})
	deliver(interestKey("lorebooks:lines", 5), {
		lorebookId: 5,
		lines: [
			{
				id: 9,
				name: "The dark timeline",
				forkedFromBranchId: null,
				forkYear: 1,
				forkMonth: null,
				forkDay: null
			}
		]
	})
}
const asked = (event: string) => emitted.filter(([e]) => e === event).length

describe("Edit Session — the reading, read-only", () => {
	test("owner, off: says how to change it, names the branch, spells the clock by the calendar", async () => {
		const o = { advanced: false }
		openForm(o)
		await feed(o, READING)
		expect(asked("lorebooks:storyTime")).toBe(1)
		expect(asked("lorebooks:lines")).toBe(1)
		deliverBook()
		await tick()
		flushSync()
		const reading = testId("session-lorebook-reading")?.textContent ?? ""
		expect(reading.includes(OWNER_SENTENCE)).toBe(true)
		expect(reading.includes(GUEST_SENTENCE)).toBe(false)
		expect(reading.includes("The dark timeline")).toBe(true)
		expect(reading.includes("A branch of this lorebook")).toBe(false)
		const clock = testId("session-story-clock-readonly")?.textContent ?? ""
		expect(clock.includes("Ashday, 2 Thaw, Year 1 AR")).toBe(true)
	})

	test("guest, off: the owner chooses, a generic branch, nothing asked", async () => {
		const o = { advanced: false, viewerId: 2 }
		openForm(o)
		await feed(o, READING)
		expect(asked("lorebooks:storyTime")).toBe(0)
		expect(asked("lorebooks:lines")).toBe(0)
		const reading = testId("session-lorebook-reading")?.textContent ?? ""
		expect(reading.includes(GUEST_SENTENCE)).toBe(true)
		expect(reading.includes(OWNER_SENTENCE)).toBe(false)
		expect(reading.includes("A branch of this lorebook")).toBe(true)
		const clock = testId("session-story-clock-readonly")?.textContent ?? ""
		expect(clock.includes("Year 1, Mo. 1, Day 2")).toBe(true)
	})
})
