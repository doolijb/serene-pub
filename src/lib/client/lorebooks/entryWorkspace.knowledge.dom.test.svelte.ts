/**
 * 🚧 The Not common knowledge toggle in the entry form: the owner's only,
 * written at once through the knowledge door, never part of the draft.
 *
 * ⚠ No DOM node is ever handed to `expect`.
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
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { staticBookData } from "./bookData.svelte"
import { emptyFilters } from "./poolFilter"
import { SECTION_DESCRIPTORS, bookPoolItems } from "./sections"
import { openBookTime } from "./time/bookTime.svelte"
import EntryWorkspaceFixture from "./EntryWorkspaceFixture.svelte"

type Row = Sockets.Amendments.EntryRow
type Listener = (payload: any) => void

const BOOK = 5
const BRANCHES = [
	{
		id: 7,
		lorebookId: BOOK,
		name: "fork",
		forkedFromBranchId: null,
		forkYear: 5,
		forkMonth: null,
		forkDay: null
	}
]

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
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, BRANCHES)
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	loreRoute.set(emptyRoute())
	_resetInterestForTests()
	setSocket(null)
	openBookTime.open(null)
	document.body.innerHTML = ""
})

const entry = {
	id: 21,
	lorebookId: BOOK,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	name: "Harbor",
	year: 1,
	month: null,
	day: null,
	content: "A grey harbor.",
	keys: [],
	enabled: true
}
const historyRow = {
	id: 1,
	lorebookId: BOOK,
	typeId: HISTORY_TYPE_ID,
	branchId: null,
	year: 1,
	month: null,
	day: null,
	content: "Something happened.",
	keys: [],
	enabled: true
}

function amendment(
	id: number,
	year: number,
	fields: Record<string, unknown>,
	extra: Partial<Row> = {}
): Row {
	return {
		id,
		entryId: 21,
		branchId: null,
		year,
		month: null,
		day: null,
		fields,
		historyEntryId: null,
		createdAt: "",
		updatedAt: "",
		...extra
	}
}

// main: version at Year 3 (name) and Year 6 (content)
const ROWS = [
	amendment(1, 3, { name: "Early" }),
	amendment(2, 6, { content: "Later" })
]

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function open(
	routeExtra: Record<string, unknown> = {},
	over: {
		timelineEnabled?: boolean
		bookAccess?: string
		line?: number | null
		rows?: Row[]
		focus?: { entryId: number; field: string; n: number }
	} = {}
) {
	const rawRows: Record<string, unknown[]> = {}
	for (const door of SECTION_DESCRIPTORS)
		if (door.kind && door.store === "entries") rawRows[door.kind] = []
	rawRows[WORLD_LORE_TYPE_ID] = [entry]
	rawRows[HISTORY_TYPE_ID] = [historyRow]
	const rows = over.rows ?? ROWS
	const descriptor = SECTION_DESCRIPTORS.find((d) => d.id === "all")!
	loreRoute.set({ lorebookId: BOOK, scope: "all", ...routeExtra } as any)
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				timelineEnabled: over.timelineEnabled ?? true,
				bookAccess: over.bookAccess ?? "owner",
				rawRows: rawRows as any,
				rows: rawRows as any,
				scenes: [] as any,
				allScenes: [] as any
			}) as any
	)
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
			["userSettingsCtx", { settings: { showAdvancedControls: true } }],
			[INTEREST_CONTEXT, interestContextValue()]
		]),
		props: {
			data,
			lorebookId: BOOK,
			descriptor,
			doors: SECTION_DESCRIPTORS,
			bookPool: bookPoolItems(rawRows as any, [] as any),
			bookLinks: [],
			amendmentsFor: (id: number) =>
				id === 21
					? rows
					: id === 1
						? [
								amendment(
									9,
									2,
									{ content: "Changed." },
									{ entryId: 1 }
								)
							]
						: [],
			line: lineOf(over.line ?? null, BRANCHES),
			mode: "desk",
			hasUnsavedChanges: false,
			lens: "list",
			filters: emptyFilters(),
			readInKeys: null,
			decisions: null,
			focusField: over.focus ?? null,
			onFilters: () => {}
		}
	})
	await settle()
}

const norm = (s: string | null | undefined) =>
	s?.replace(/\s+/g, " ").trim() ?? ""
const sent = (event: string) => client.emits.filter((e) => e.event === event)
const rail = () => document.body.querySelector("[data-version-rail]")
const current = () =>
	rail()?.querySelector("[aria-current]")?.getAttribute("data-version-key") ??
	null
// The form's own buttons: the rail's date dialogs stay in the DOM, closed.
const button = (name: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			norm(b.textContent) === name &&
			!b.closest('[data-testid="version-date-dialog"]')
	)
const bodyText = () => norm(document.body.textContent)

// The entry row opens on demand; the toggle is the row's first button.
const rowToggle = () =>
	document.body.querySelector<HTMLButtonElement>(
		"[data-lore-entry-zone] [data-lore-beginning-decay] > div > button"
	)!
async function openRow() {
	if (rowToggle().getAttribute("aria-expanded") !== "true") {
		rowToggle().click()
		await settle()
	}
}
const toggle = () =>
	document.body.querySelector<HTMLButtonElement>(
		'[data-lore-mark="not-common"]'
	)

async function answerMarks(marked: number[]) {
	await settle()
	for (const ask of sent("entryKnowledge:list"))
		if (!ask.payload.entryId && !(ask as any).done) {
			;(ask as any).done = true
			client.dispatch("entryKnowledge:list", {
				lorebookId: BOOK,
				branchId: null,
				moment: null,
				markedEntryIds: marked,
				rows: [],
				requestId: ask.payload.requestId
			})
		}
	await settle()
}

describe("the Not common knowledge toggle", () => {
	test("the owner sees it, unpressed, with its help named by the button", async () => {
		await open({ entryId: 21 }, { rows: [] })
		await openRow()
		expect(toggle()).toBeNull()
		await answerMarks([])
		const b = toggle()!
		expect(!!b).toBe(true)
		expect(b.getAttribute("aria-pressed")).toBe("false")
		const help = document.getElementById(
			b.getAttribute("aria-describedby")!
		)
		expect(norm(help?.textContent)).toBe(
			"Only the cast members you name under Known by read this entry when they speak."
		)
	})

	test("a notes member the server refuses sees no toggle, no tab and no alert", async () => {
		await open({ entryId: 21 }, { rows: [] })
		await settle()
		const ask = sent("entryKnowledge:list")[0]
		client.dispatch("entryKnowledge:list:error", {
			error: "Only the owner may read this.",
			requestId: ask.payload.requestId
		})
		await settle()
		await openRow()
		expect(toggle()).toBeNull()
		expect(
			document.body.querySelector('[data-lore-mark="not-common"]')
		).toBeNull()
		expect(bodyText()).not.toContain("Known by")
		expect(document.body.querySelectorAll('[role="alert"]')).toHaveLength(0)
		expect(
			sent("entryKnowledge:list").filter((e) => e.payload.entryId)
		).toHaveLength(0)
	})

	test.each(["shared", "admin"])(
		"a %s reader does not see it",
		async (access) => {
			await open({ entryId: 21 }, { rows: [], bookAccess: access })
			await openRow()
			expect(toggle()).toBeNull()
			expect(sent("entryKnowledge:list")).toHaveLength(0)
		}
	)

	test("it is pressed when the entry is marked", async () => {
		await open({ entryId: 21 }, { rows: [] })
		await answerMarks([21])
		await openRow()
		expect(toggle()!.getAttribute("aria-pressed")).toBe("true")
	})

	test("pressing sends one request, writes at once, and leaves the form clean", async () => {
		await open({ entryId: 21 }, { rows: [] })
		await answerMarks([])
		await openRow()
		toggle()!.click()
		await settle()
		const asks = sent("entryKnowledge:setCommonKnowledge")
		expect(asks).toHaveLength(1)
		expect(asks[0].payload).toMatchObject({
			lorebookId: BOOK,
			entryIds: [21],
			notCommonKnowledge: true
		})
		expect(toggle()!.disabled).toBe(true)
		client.dispatch("entryKnowledge:setCommonKnowledge", {
			lorebookId: BOOK,
			entryIds: [21],
			notCommonKnowledge: true,
			markedEntryIds: [21],
			requestId: asks[0].payload.requestId
		})
		await settle()
		expect(toggle()!.getAttribute("aria-pressed")).toBe("true")
		expect(toggle()!.disabled).toBe(false)
		expect(sent("entries:update")).toHaveLength(0)
		expect(sent("entries:setMarks")).toHaveLength(0)
		// Nothing the form writes went out: the mark is not a field of the draft.
		expect(
			client.emits.filter((e) =>
				[
					"entries:update",
					"entries:create",
					"amendments:save"
				].includes(e.event)
			)
		).toHaveLength(0)
	})

	test("a refusal is said in place", async () => {
		await open({ entryId: 21 }, { rows: [] })
		await answerMarks([])
		await openRow()
		toggle()!.click()
		await settle()
		const ask = sent("entryKnowledge:setCommonKnowledge")[0]
		client.dispatch("entryKnowledge:setCommonKnowledge:error", {
			error: "Only the owner may mark entries.",
			requestId: ask.payload.requestId
		})
		await settle()
		const alert = toggle()!.parentElement!.querySelector('[role="alert"]')
		expect(norm(alert?.textContent)).toBe(
			"Only the owner may mark entries."
		)
		expect(toggle()!.getAttribute("aria-pressed")).toBe("false")
	})
})
