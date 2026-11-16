/**
 * 🚧 Timeline off (owner 2026-11-13, 2026-11-14): the workspace's shell hides
 * its time controls — the moment bar (the line chip stays with a second
 * line), the Time and Lives lenses, the History scope and its figure in All,
 * and the moment the route names. The route itself is left alone, so the
 * switch brings it back. With the switch on, every screen is as ever.
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
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import LorebooksWorkspace from "./LorebooksWorkspace.svelte"

const BOOK = 5

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	loreRoute.set(emptyRoute())
	openBookTime.open(null)
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
	vi.useRealTimers()
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
/** Past the workspace's counts window, which is a real timer here. */
const pastWindow = () => new Promise((r) => setTimeout(r, 300))

const row = (id: number, typeId: string) => ({
	id,
	lorebookId: BOOK,
	typeId,
	branchId: null,
	name: `Row ${id}`,
	content: "",
	keys: [],
	enabled: true
})

async function open(
	route: Record<string, unknown>,
	opts: {
		timelineEnabled?: boolean
		branches?: boolean
		session?: Record<string, unknown>
	} = {}
) {
	loreRoute.set({ lorebookId: BOOK, scope: "all", ...route } as any)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LorebooksWorkspace, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			[
				"openSessionCtx",
				opts.session ?? {
					sessionId: null,
					lorebookId: null,
					isOwner: false
				}
			],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }],
			["userSettingsCtx", { settings: { showAdvancedControls: true } }]
		]),
		props: {}
	})
	await settle()
	client.dispatch("lorebooks:list", {
		lorebookList: [
			{
				id: BOOK,
				name: "Book",
				userId: 1,
				...(opts.timelineEnabled === undefined
					? {}
					: { timelineEnabled: opts.timelineEnabled })
			}
		]
	})
	client.dispatch("scenes:listByLorebook", {
		lorebookId: BOOK,
		sceneList: []
	})
	client.dispatch("lorebooks:bindingList", {
		lorebookId: BOOK,
		lorebookBindingList: []
	})
	client.dispatch("entries:list", {
		lorebookId: BOOK,
		typeId: WORLD_LORE_TYPE_ID,
		entryList: [row(1, WORLD_LORE_TYPE_ID)]
	})
	client.dispatch("entries:list", {
		lorebookId: BOOK,
		typeId: HISTORY_TYPE_ID,
		entryList: [row(2, HISTORY_TYPE_ID)]
	})
	client.dispatch("entries:counts", {
		lorebookId: BOOK,
		branchId: null,
		counts: { [WORLD_LORE_TYPE_ID]: 1, [HISTORY_TYPE_ID]: 1 }
	})
	if (opts.branches)
		client.dispatch("amendments:list", {
			lorebookId: BOOK,
			entries: [],
			cast: [],
			presences: [],
			branches: [
				{
					id: 3,
					lorebookId: BOOK,
					name: "What if",
					forkedFromBranchId: null,
					forkYear: null,
					forkMonth: null,
					forkDay: null
				}
			]
		})
	await settle()
	await pastWindow()
	await settle()
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
const has = (sel: string) => !!document.querySelector(sel)
const lensRows = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'[role="radio"][data-lore-lens]'
		)
	].map((b) => b.dataset.loreLens)
const lensPressed = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'[role="radio"][data-lore-lens]'
		)
	]
		.filter((b) => b.getAttribute("aria-checked") === "true")
		.map((b) => b.dataset.loreLens)
const scopeRows = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'[role="radio"][data-lore-scope]'
		)
	].map((b) => b.dataset.loreScope)
const scopePressed = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'[role="radio"][data-lore-scope]'
		)
	]
		.filter((b) => b.getAttribute("aria-checked") === "true")
		.map((b) => b.dataset.loreScope)
const scopeFigure = (scope: string) =>
	document
		.querySelector(`[role="radio"][data-lore-scope="${scope}"]`)
		?.textContent?.replace(/\s+/g, " ")
		.match(/(\d+)\s*$/)?.[1] ?? null

describe("the moment bar and the line chip", () => {
	test("on: the bar is drawn", async () => {
		await open({}, { timelineEnabled: true })
		expect(has("[data-lore-moment-bar]")).toBe(true)
	})

	test("book row without the field reads as on: the bar is drawn", async () => {
		await open({})
		expect(has("[data-lore-moment-bar]")).toBe(true)
	})

	test("off with one line: nothing where the bar was", async () => {
		await open({}, { timelineEnabled: false })
		expect(has("[data-lore-moment-bar]")).toBe(false)
		expect(has("[data-lore-line-chip]")).toBe(false)
	})

	test("off with a second line: the line chip alone", async () => {
		await open({}, { timelineEnabled: false, branches: true })
		expect(has("[data-lore-moment-bar]")).toBe(false)
		expect(has("[data-lore-line-chip]")).toBe(true)
		expect(has("[data-lore-moment-toggle]")).toBe(false)
	})
})

describe("the Time and Lives lenses", () => {
	test("on: both are offered", async () => {
		await open({}, { timelineEnabled: true })
		expect(lensRows()).toContain("time")
		expect(lensRows()).toContain("lives")
	})

	test("off: neither is offered", async () => {
		await open({}, { timelineEnabled: false })
		expect(lensRows()).not.toContain("time")
		expect(lensRows()).not.toContain("lives")
	})

	for (const lens of ["time", "lives"]) {
		test(`off: a route naming ${lens} draws List and is left alone`, async () => {
			await open({ lens }, { timelineEnabled: false })
			expect(lensPressed()).toEqual(["list"])
			expect(loreRoute.route.lens).toBe(lens)
		})

		test(`on: a route naming ${lens} draws it`, async () => {
			await open({ lens }, { timelineEnabled: true })
			expect(lensPressed()).toEqual([lens])
		})
	}
})

describe("the History scope", () => {
	test("on: History is listed and counted in All", async () => {
		await open({}, { timelineEnabled: true })
		expect(scopeRows()).toContain("history")
		expect(scopeFigure("history")).toBe("1")
		expect(scopeFigure("all")).toBe("2")
	})

	test("off: History is not listed, All leaves it out, Scenes stands", async () => {
		await open({}, { timelineEnabled: false })
		expect(scopeRows()).not.toContain("history")
		expect(scopeRows()).toContain("scenes")
		expect(scopeFigure("all")).toBe("1")
	})

	test("on: a route naming History draws it", async () => {
		await open({ scope: "history" }, { timelineEnabled: true })
		expect(scopePressed()).toEqual(["history"])
	})

	test("off: a route naming History draws the default view and is left alone", async () => {
		await open({ scope: "history" }, { timelineEnabled: false })
		expect(scopePressed()).toEqual(["all"])
		expect(lensPressed()).toEqual(["list"])
		expect(loreRoute.route.scope).toBe("history")
	})

	test("off: a route to a history entry draws the default view and is left alone", async () => {
		await open({ entryId: 2 }, { timelineEnabled: false })
		expect(scopePressed()).toEqual(["all"])
		expect(loreRoute.route.entryId).toBe(2)
	})
})

describe("the moment in the route", () => {
	test("off: it is not read — the roster says now — and the route keeps it", async () => {
		await open({ scope: "cast", moment: "Y3" }, { timelineEnabled: false })
		expect(text()).toContain("In the world now")
		expect(loreRoute.route.moment).toBe("Y3")
	})

	test("on: it is read", async () => {
		await open({ scope: "cast", moment: "Y3" }, { timelineEnabled: true })
		expect(text()).not.toContain("In the world now")
		expect(text()).toContain("In the world")
	})
})

describe("the reading line", () => {
	const session = {
		sessionId: 7,
		sessionName: "Night watch",
		lorebookId: BOOK,
		lorebookBranchId: 3,
		storyClock: { year: 3, month: 2, day: 1 },
		isOwner: true
	}
	const reading = () =>
		(document.querySelector("[data-lore-reading]")?.textContent ?? "").replace(
			/\s+/g,
			" "
		)

	test("on: the line and the session clock are said", async () => {
		await open({}, { timelineEnabled: true, branches: true, session })
		expect(reading()).toContain("What if")
		expect(reading()).toContain(" as of ")
	})

	test("off: the line is said and the clock is not", async () => {
		await open({}, { timelineEnabled: false, branches: true, session })
		expect(reading()).toContain("What if")
		expect(reading()).not.toContain(" as of ")
	})
})
