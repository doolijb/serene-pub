/**
 * The entry list with the book's Timeline switch off (🚧): history entries
 * stay in the book but are not listed or offered as new, the Scenes list
 * reads in the order played with no History divider; on, every one is as it
 * was and the Scenes list ends in a History divider with its count.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

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
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	INTEREST_CONTEXT,
	_resetInterestForTests,
	interestContextValue,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import {
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { staticBookData } from "./bookData.svelte"
import { emptyFilters } from "./poolFilter"
import { SECTION_DESCRIPTORS, bookPoolItems } from "./sections"
import EntryWorkspaceFixture from "./EntryWorkspaceFixture.svelte"

const BOOK = 5

let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	setSocket({
		connected: true,
		id: "tab-a",
		on() {},
		off() {},
		emit() {}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	loreRoute.set(emptyRoute())
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

const world = {
	id: 21,
	lorebookId: BOOK,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	name: "Harbor",
	content: "A grey harbor.",
	keys: [],
	enabled: true
}
const history = (id: number, year: number) => ({
	id,
	lorebookId: BOOK,
	typeId: HISTORY_TYPE_ID,
	branchId: null,
	year,
	month: null,
	day: null,
	content: "Something happened.",
	keys: [],
	enabled: true
})
// Captured in the order 11, 12, 13; played in the order 12, 13, 11.
const scene = (id: number, name: string, messages: number[]) => ({
	id,
	lorebookId: BOOK,
	branchId: null,
	name,
	summary: `${name} happened.`,
	historyEntryId: 1,
	selectedMessageIds: messages,
	participantCharacters: [],
	mentionedCharacters: []
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function open(
	scope: "all" | "scenes",
	timelineEnabled: boolean,
	routeExtra: Record<string, unknown> = {}
) {
	const scenes = [
		scene(11, "Third", [90]),
		scene(12, "First", [10]),
		scene(13, "Second", [40])
	]
	// Every kind has arrived, or the list says it is still loading.
	const rawRows: Record<string, unknown[]> = {}
	for (const door of SECTION_DESCRIPTORS)
		if (door.kind && door.store === "entries") rawRows[door.kind] = []
	rawRows[WORLD_LORE_TYPE_ID] = [world]
	rawRows[HISTORY_TYPE_ID] = [history(1, 1), history(2, 2)]
	const descriptor = SECTION_DESCRIPTORS.find((d) => d.id === scope)!
	loreRoute.set({ lorebookId: BOOK, scope, ...routeExtra } as any)
	const data = staticBookData(() => ({
		lorebookId: BOOK,
		timelineEnabled,
		rawRows: rawRows as any,
		rows: rawRows as any,
		scenes: scenes as any,
		allScenes: scenes as any
	}) as any)
	// `loaded` is the shell's probe; the fixture's lists have all arrived.
	;(data as any).loaded = () => true
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(EntryWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			[
				"openSessionCtx",
				{ sessionId: null, lorebookId: null, isOwner: false }
			],
			["systemSettingsCtx", { settings: {}, capabilityDefaults: [] }],
			["userCtx", { user: { id: 1, isAdmin: false } }],
			["userSettingsCtx", { settings: { showAdvancedControls: false } }],
			[INTEREST_CONTEXT, interestContextValue()]
		]),
		props: {
			data,
			lorebookId: BOOK,
			descriptor,
			doors: SECTION_DESCRIPTORS,
			bookPool: bookPoolItems(rawRows as any, scenes as any),
			bookLinks: [],
			line: lineOf(null, []),
			mode: "desk",
			hasUnsavedChanges: false,
			lens: "list",
			filters: emptyFilters(),
			readInKeys: null,
			decisions: null,
			onFilters: () => {}
		}
	})
	await settle()
}

const text = () => document.body.textContent ?? ""
const divider = () =>
	document.querySelector<HTMLElement>("[data-history-divider]")

describe("the Scenes list", () => {
	test("on: ends in a History divider with the count, which opens History", async () => {
		await open("scenes", true)
		expect(divider() != null).toBe(true)
		expect(divider()!.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"History 2"
		)
		expect(divider()!.getAttribute("title")).toBe("Open History")
		divider()!.click()
		await settle()
		expect(loreRoute.route.scope).toBe("history")
	})

	test("off: the scenes read in the order played, with no divider", async () => {
		await open("scenes", false)
		expect(divider()).toBeNull()
		const at = (name: string) => text().indexOf(name)
		expect(at("First")).toBeGreaterThan(-1)
		expect(at("First")).toBeLessThan(at("Second"))
		expect(at("Second")).toBeLessThan(at("Third"))
	})
})

describe("history entries in the pool", () => {
	test("on: the History door is offered as a new entry and the entries are listed", async () => {
		await open("all", true)
		expect(text()).toContain("Year 1")
		const trigger = document.querySelector<HTMLElement>('[title="New"]')
		expect(trigger != null).toBe(true)
		trigger!.click()
		await settle()
		expect(text()).toContain("New history entry")
	})

	test("off: not listed, not offered as new", async () => {
		await open("all", false)
		expect(text()).not.toContain("Year 1")
		expect(text()).toContain("Harbor")
		const trigger = document.querySelector<HTMLElement>('[title="New"]')
		trigger?.click()
		await settle()
		expect(text()).not.toContain("New history entry")
	})
})

// An open editor carries the "Keywords" field heading (the list has only "Needs keywords").
// Keywords sit in the closed entry row; Content is always drawn with the editor.
const editorOpen = () =>
	document.body.querySelector("[data-lore-field=content]") != null

describe("the route in the pool", () => {
	test("on: a route to a history entry opens its editor", async () => {
		await open("all", true, { entryId: 1 })
		expect(editorOpen()).toBe(true)
	})

	test("off: a route to a history entry selects nothing, and the route is left alone", async () => {
		await open("all", false, { entryId: 1 })
		expect(editorOpen()).toBe(false)
		expect(loreRoute.route.entryId).toBe(1)
	})

	test("off: a route to another entry still opens it, and a route moment is not read", async () => {
		await open("all", false, { entryId: 21, moment: "Y3" })
		expect(editorOpen()).toBe(true)
		expect(loreRoute.route.moment).toBe("Y3")
		expect(text()).not.toContain("Year 3")
	})
})
