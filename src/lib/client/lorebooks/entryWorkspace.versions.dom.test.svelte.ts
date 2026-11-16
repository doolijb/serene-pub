/**
 * 🚧 The entry form with the version rail: the rail's selection is the version
 * in force at the route's moment, Save writes the entry's own fields to the
 * entry and the rest to the version, Save as a new version files a dated
 * version, and a history entry keeps its Save as of. Timeline off: no rail.
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

async function typeInto(input: HTMLInputElement, value: string) {
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
const nameInput = () =>
	document.body.querySelector<HTMLInputElement>(
		'input[type="text"][id$="Name"]'
	)!
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
// Off is the entry's own field until a dated change carries it: the entry row draws it.
async function switchOff() {
	await openRow()
	document.body
		.querySelector<HTMLButtonElement>(
			'[data-lore-entry-zone] [data-lore-mark="off"]'
		)!
		.click()
	await settle()
}

describe("the rail on a stored entry", () => {
	test("draws the versions; at now the latest is current", async () => {
		await open({ entryId: 21 })
		expect(rail() != null).toBe(true)
		expect(
			[...rail()!.querySelectorAll("button[data-version-key]")].map((b) =>
				b.getAttribute("data-version-key")
			)
		).toEqual(["beginning", "row:1", "row:2"])
		expect(current()).toBe("row:2")
	})

	test("the version in force at the route's moment is current", async () => {
		await open({ entryId: 21, moment: "Y4" })
		expect(current()).toBe("row:1")
		loreRoute.set({ ...loreRoute.route, moment: "Y1" })
		await settle()
		expect(current()).toBe("beginning")
	})

	test("clicking a version sets the route's moment to its key", async () => {
		await open({ entryId: 21 })
		rail()!
			.querySelector<HTMLButtonElement>(
				'button[data-version-key="row:1"]'
			)!
			.click()
		await settle()
		expect(loreRoute.route.moment).toBe("Y3")
		expect(current()).toBe("row:1")
	})
})

describe("Save on a railed entry", () => {
	test("From the beginning: entries:update with only the changed fields", async () => {
		await open({ entryId: 21, moment: "Y1" })
		expect(current()).toBe("beginning")
		await switchOff()
		button("Save")!.click()
		await settle()
		const updates = sent("entries:update")
		expect(updates.length).toBe(1)
		const patch = updates[0].payload.entry
		expect(Object.keys(patch).sort()).toEqual(
			["enabled", "id", "typeId"].sort()
		)
		expect(patch.enabled).toBe(false)
		expect(sent("amendments:update").length).toBe(0)
	})

	test("an own dated version: amendments:update with its fields and the change", async () => {
		await open({ entryId: 21, moment: "Y3" })
		expect(current()).toBe("row:1")
		await typeInto(nameInput(), "Port")
		button("Save")!.click()
		await settle()
		const updates = sent("amendments:update")
		expect(updates.length).toBe(1)
		expect(updates[0].payload).toEqual({
			lorebookId: BOOK,
			id: 1,
			subject: "entry",
			fields: { name: "Port" }
		})
		expect(sent("entries:update").length).toBe(0)
	})

	test("a dated version shown: the Beginning's field goes to the entry, the name to the version", async () => {
		await open({ entryId: 21, moment: "Y3" })
		await switchOff()
		await typeInto(nameInput(), "Port")
		button("Save")!.click()
		await settle()
		const updates = sent("amendments:update")
		expect(updates.length).toBe(1)
		expect(updates[0].payload.fields).toEqual({ name: "Port" })
		// The entry's write follows the version's, once the list has it.
		client.dispatch("amendments:list", {
			lorebookId: BOOK,
			entries: [amendment(1, 3, { name: "Port" }), ROWS[1]],
			branches: []
		})
		await settle()
		const entryWrites = sent("entries:update")
		expect(entryWrites.length).toBe(1)
		expect(Object.keys(entryWrites[0].payload.entry).sort()).toEqual(
			["enabled", "id", "typeId"].sort()
		)
	})

	test("an inherited version: Save is disabled, with its sentence", async () => {
		await open({ entryId: 21, moment: "Y3", branch: 7 }, { line: 7 })
		await typeInto(nameInput(), "Port")
		const save = button("Save")!
		expect(save.disabled).toBe(true)
		expect(save.getAttribute("title")).toBe(
			"This is main's version: open it there to change it, or save it as a new version."
		)
		expect(button("Save as a new version…")!.disabled).toBe(false)
	})
})

describe("Save as a new version", () => {
	test("opens the dialog and files the changed fields at the chosen date", async () => {
		await open({ entryId: 21 })
		await typeInto(nameInput(), "Port")
		button("Save as a new version…")!.click()
		await settle()
		// The rail's own add dialog stays in the DOM, closed and empty.
		const dialog = [
			...document.body.querySelectorAll(
				'[data-testid="version-date-dialog"]'
			)
		].find((d) =>
			[...d.querySelectorAll("button")].some(
				(b) => norm(b.textContent) === "Save"
			)
		)!
		expect(bodyText()).toContain(
			"What you changed starts at this date; the version shown stays as it is."
		)
		const year = dialog.querySelector<HTMLInputElement>(
			'input[type="number"]'
		)!
		await typeInto(year, "8")
		;[...dialog.querySelectorAll("button")]
			.find((b) => norm(b.textContent) === "Save")!
			.click()
		await settle()
		const creates = sent("amendments:create")
		expect(creates.length).toBe(1)
		expect(creates[0].payload).toMatchObject({
			lorebookId: BOOK,
			entryId: 21,
			branchId: null,
			year: 8,
			fields: { name: "Port" }
		})
	})
})

describe("elsewhere", () => {
	test("a history entry keeps Save as of and its amendments list, with no rail", async () => {
		await open({ entryId: 1, moment: "Y2" })
		expect(rail()).toBeNull()
		expect(bodyText()).toContain("Save as of")
		expect(
			document.body.querySelector("[data-lore-amendments]") != null
		).toBe(true)
		expect(button("Save as a new version…")).toBeUndefined()
	})

	test("Timeline off: no rail and no Save as a new version…", async () => {
		await open({ entryId: 21 }, { timelineEnabled: false })
		expect(rail()).toBeNull()
		expect(button("Save as a new version…")).toBeUndefined()
		expect(button("Save") != null).toBe(true)
	})

	test("a read-only book draws the rail and no Save", async () => {
		await open({ entryId: 21 }, { bookAccess: "reader" })
		expect(rail() != null).toBe(true)
		expect(button("Save")).toBeUndefined()
		expect(button("Save as a new version…")).toBeUndefined()
	})
})

const zone = () => document.body.querySelector("[data-lore-entry-zone]")!
const railRoot = () => document.body.querySelector("[data-version-rail-root]")
const inRail = (sel: string) => railRoot()?.querySelector(sel) ?? null
const byLabel = (label: string) =>
	document.body.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`
	)
const sameBtn = (field: string) =>
	[
		...document.body.querySelectorAll<HTMLButtonElement>(
			`[data-lore-differs="${field}"] button`
		)
	].find((b) => norm(b.textContent) === "Make it the same everywhere")!
const saveState = () =>
	norm(document.body.querySelector("[data-lore-save-state]")?.textContent)

describe("the entry area", () => {
	test("draws the row closed, in words, and opens to Keywords, Part of, Pinned and Off; the version's fields do not", async () => {
		await open({ entryId: 21, moment: "Y3" })
		expect(rowToggle().getAttribute("aria-expanded")).toBe("false")
		expect(norm(zone().textContent)).toMatch(
			/On main · .* · Fact · no keywords · top level/
		)
		expect(zone().querySelector("[data-lore-field=keywords]")).toBeNull()
		await openRow()
		expect(
			zone().querySelector("[data-lore-field=keywords]")
		).not.toBeNull()
		expect(norm(zone().textContent)).toContain("Part of")
		expect(zone().querySelector('[data-lore-mark="pinned"]')).not.toBeNull()
		expect(zone().querySelector('[data-lore-mark="off"]')).not.toBeNull()
		expect(inRail("[data-lore-field=keywords]")).toBeNull()
		expect(norm(railRoot()!.textContent)).not.toContain("Part of")
		expect(inRail('[data-lore-mark="off"]')).toBeNull()
	})

	test("Change Keywords from this version moves them into the version and saves with the amendment", async () => {
		await open({ entryId: 21, moment: "Y3" })
		await openRow()
		button("Change from this version…")!.click()
		await settle()
		byLabel("Change Keywords from this version")!.click()
		await settle()
		expect(zone().querySelector("[data-lore-field=keywords]")).toBeNull()
		expect(inRail("[data-lore-field=keywords]")).not.toBeNull()
		expect(
			norm(inRail('[data-lore-differs="keys"]')!.textContent)
		).toContain("differs by version")
		expect(saveState()).toBe("Unsaved changes")
		button("Save")!.click()
		await settle()
		const updates = sent("amendments:update")
		expect(updates.length).toBe(1)
		expect(updates[0].payload.fields).toHaveProperty("keys")
	})

	test("a carried field shows in the version zone as differs by version", async () => {
		await open(
			{ entryId: 21, moment: "Y3" },
			{ rows: [amendment(1, 3, { enabled: false }), ROWS[1]] }
		)
		expect(zone().querySelector('[data-lore-mark="off"]')).toBeNull()
		expect(inRail('[data-lore-mark="off"]')).not.toBeNull()
		expect(
			norm(inRail('[data-lore-differs="enabled"]')!.textContent)
		).toContain("differs by version")
	})

	test("Make it the same everywhere asks with the count, then rewrites each own row and the entry", async () => {
		const rows = [
			amendment(1, 3, { enabled: false }),
			amendment(2, 6, { enabled: true, content: "Later" })
		]
		await open({ entryId: 21, moment: "Y3" }, { rows })
		sameBtn("enabled").click()
		await settle()
		expect(bodyText()).toContain("2 versions on this line")
		button("Make it the same")!.click()
		await settle()
		expect(sent("amendments:update")[0].payload).toMatchObject({
			id: 1,
			fields: {}
		})
		client.dispatch("amendments:list", {
			lorebookId: BOOK,
			entries: [amendment(1, 3, {}), rows[1]],
			branches: []
		})
		await settle()
		expect(sent("amendments:update")[1].payload).toMatchObject({
			id: 2,
			fields: { content: "Later" }
		})
		client.dispatch("amendments:list", {
			lorebookId: BOOK,
			entries: [
				amendment(1, 3, {}),
				amendment(2, 6, { content: "Later" })
			],
			branches: []
		})
		await settle()
		const entryWrites = sent("entries:update")
		expect(entryWrites.length).toBe(1)
		expect(entryWrites[0].payload.entry).toMatchObject({
			id: 21,
			// The value of the version shown (the fixture does not overlay rows).
			enabled: true
		})
	})

	test("an inherited carrier blocks Make it the same everywhere with its sentence", async () => {
		// main's Year 3 change carries Off; the fork reads it.
		await open(
			{ entryId: 21, moment: "Y3", branch: 7 },
			{ line: 7, rows: [amendment(1, 3, { enabled: false }), ROWS[1]] }
		)
		expect(sameBtn("enabled").disabled).toBe(true)
		expect(
			norm(inRail('[data-lore-differs="enabled"]')!.textContent)
		).toContain("main's version of")
	})

	test("on a fork reading main's entry the area is disabled and says whose it is", async () => {
		await open({ entryId: 21, moment: "Y3", branch: 7 }, { line: 7 })
		expect(rowToggle().getAttribute("aria-expanded")).toBe("true")
		expect(zone().querySelector("fieldset")!.hasAttribute("disabled")).toBe(
			true
		)
		expect(norm(zone().textContent)).toContain(
			"The entry belongs to main; open it there to change it."
		)
		expect(button("Open on main") != null).toBe(true)
	})

	test("on a fork's own version of main's entry, Change from this version stays live outside the disabled area", async () => {
		await open(
			{ entryId: 21, moment: "Y4", branch: 7 },
			{
				line: 7,
				rows: [
					...ROWS,
					amendment(3, 4, { name: "Fork" }, { branchId: 7 })
				]
			}
		)
		button("Change from this version…")!.click()
		await settle()
		const changes = document.body.querySelectorAll<HTMLButtonElement>(
			'[data-lore-change-from-version="keys"]'
		)
		expect(changes.length).toBe(1)
		expect(changes[0].disabled).toBe(false)
		expect(changes[0].closest("fieldset")).toBeNull()
		changes[0].click()
		await settle()
		expect(
			document.body.querySelector('[data-lore-differs="keys"]') != null
		).toBe(true)
	})

	test("a read-only book draws it disabled with no Change from this version", async () => {
		await open({ entryId: 21, moment: "Y3" }, { bookAccess: "reader" })
		expect(rowToggle().getAttribute("aria-expanded")).toBe("true")
		expect(rowToggle().disabled).toBe(false)
		expect(zone().querySelector("fieldset")!.hasAttribute("disabled")).toBe(
			true
		)
		expect(button("Change from this version…")).toBeUndefined()
	})
})

describe("the entry row's place and use", () => {
	const after = (a: Element, b: Element) =>
		!!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
	const contentField = () =>
		document.body.querySelector("[data-lore-field=content]")!
	const reopen = () => {
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
	}

	test("railed: Name and Content come before the entry row", async () => {
		await open({ entryId: 21, moment: "Y3" })
		expect(after(nameInput(), zone())).toBe(true)
		expect(after(contentField(), zone())).toBe(true)
	})

	test("Timeline off: Name and Content come first; the row holds the fields and Decay, no Beginning, no line words", async () => {
		await open({ entryId: 21 }, { timelineEnabled: false })
		expect(rail()).toBeNull()
		expect(after(nameInput(), zone())).toBe(true)
		expect(after(contentField(), zone())).toBe(true)
		expect(rowToggle().getAttribute("aria-expanded")).toBe("false")
		expect(norm(zone().textContent)).toContain(
			"Decay: Fact · no keywords · top level"
		)
		expect(norm(zone().textContent)).not.toContain("On main")
		await openRow()
		expect(zone().querySelector("[data-lore-field=keywords]")).not.toBeNull()
		expect(norm(zone().textContent)).toContain("Part of")
		expect(zone().querySelector('[data-lore-mark="pinned"]')).not.toBeNull()
		expect(zone().querySelector('[data-lore-mark="off"]')).not.toBeNull()
		expect(zone().querySelector("[data-lore-decay]")).not.toBeNull()
		expect(zone().querySelector("[data-lore-beginning]")).toBeNull()
	})

	test("Change from this version… is offered only with a dated own version; it lists fields not already differing", async () => {
		await open({ entryId: 21, moment: "Y1" })
		await openRow()
		expect(button("Change from this version…")).toBeUndefined()
		reopen()
		await open(
			{ entryId: 21, moment: "Y3" },
			{ rows: [amendment(1, 3, { enabled: false }), ROWS[1]] }
		)
		await openRow()
		button("Change from this version…")!.click()
		await settle()
		expect(
			[
				...document.body.querySelectorAll("[data-lore-change-from-version]")
			].map((b) => b.getAttribute("data-lore-change-from-version"))
		).toEqual(["keys", "anchorEntryId", "constant"])
		byLabel("Change Keywords from this version")!.click()
		await settle()
		expect(zone().querySelector("[data-lore-field=keywords]")).toBeNull()
		expect(inRail('[data-lore-differs="keys"]') != null).toBe(true)
		button("Change from this version…")!.click()
		await settle()
		expect(byLabel("Change Keywords from this version")).toBeNull()
	})

	test("a loose end on keywords opens the row and draws the keywords field", async () => {
		await open({ entryId: 21, moment: "Y3" })
		expect(rowToggle().getAttribute("aria-expanded")).toBe("false")
		reopen()
		await open(
			{ entryId: 21, moment: "Y3" },
			{ focus: { entryId: 21, field: "keywords", n: 1 } }
		)
		expect(rowToggle().getAttribute("aria-expanded")).toBe("true")
		expect(zone().querySelector("[data-lore-field=keywords]")).not.toBeNull()
	})

	test("a reader's form draws the row open with its controls disabled and the toggle live", async () => {
		await open(
			{ entryId: 21 },
			{ bookAccess: "reader", timelineEnabled: false }
		)
		expect(rowToggle().getAttribute("aria-expanded")).toBe("true")
		expect(rowToggle().disabled).toBe(false)
		expect(zone().querySelector("fieldset")!.hasAttribute("disabled")).toBe(
			true
		)
	})
})

describe("the whole warning", () => {
	const warning = () =>
		document.body.querySelector("[data-lore-whole-warning]")

	test("shows when a fork reads the entry and the save would write it", async () => {
		await open({ entryId: 21, moment: "Y1" })
		expect(warning()).toBeNull()
		await switchOff()
		expect(norm(warning()!.textContent)).toContain(
			"Saving changes the entry itself: it reads this way everywhere, on every line and at every moment, until a later version changes it."
		)
	})

	test("not when the save writes only the version", async () => {
		await open({ entryId: 21, moment: "Y3" })
		await typeInto(nameInput(), "Port")
		expect(warning()).toBeNull()
	})
})

describe("the more-actions menu", () => {
	async function openMenu() {
		document.body
			.querySelector<HTMLButtonElement>(
				'button[aria-label^="More actions"]'
			)!
			.click()
		await settle()
	}

	test("a railed entry's menu has no Pinned or Off", async () => {
		await open({ entryId: 21, moment: "Y3" })
		await openMenu()
		expect(bodyText()).toContain("Archive")
		expect(
			[...document.body.querySelectorAll("[data-lore-mark]")].filter(
				(m) => !m.closest("[data-lore-entry-zone]")
			).length
		).toBe(0)
	})

	test("a history entry's menu still has them", async () => {
		await open({ entryId: 1, moment: "Y2" })
		await openMenu()
		expect(bodyText()).toContain("Out of every prompt")
	})
})

describe("edit history under the versions", () => {
	const redline = (id: number, amendmentId: number | null) => ({
		id,
		amendmentId,
		version: null,
		cause: "save",
		who: "You",
		mine: true,
		at: new Date(Date.now() - id * 60_000).toISOString(),
		changes: [
			{
				key: "name",
				label: "Name",
				before: "a",
				after: "b",
				wasAbsent: false,
				nowAbsent: false
			}
		]
	})
	const reply = () => ({
		entryId: 21,
		lorebookId: BOOK,
		canRestore: true,
		canClear: true,
		redlines: [redline(50, null), redline(51, 1), redline(52, 2)]
	})
	const under = (key: string) =>
		[
			...document.body.querySelectorAll(
				`[data-version-edits="${key}"] [data-redline-id]`
			)
		].map((e) => e.getAttribute("data-redline-id"))
	const scopedFold = () =>
		norm(
			document.body.querySelector('[data-testid="edit-history"] > button')
				?.textContent
		)

	test("a row with no change sits under From the beginning, the others under their version", async () => {
		await open({ entryId: 21 })
		client.dispatch("entries:redlines", reply())
		await settle()
		expect(under("beginning")).toEqual(["50"])
		expect(under("row:1")).toEqual(["51"])
		expect(under("row:2")).toEqual(["52"])
	})

	test("railed, the fold under the fields is scoped to the shown version", async () => {
		await open({ entryId: 21 })
		client.dispatch("entries:redlines", reply())
		await settle()
		expect(scopedFold()).toBe("Edits to this version · 1")
	})

	test("Timeline off: the whole-entry fold, as before", async () => {
		await open({ entryId: 21 }, { timelineEnabled: false })
		client.dispatch("entries:redlines", reply())
		await settle()
		expect(scopedFold()).toBe("Edit history · 3 edits")
		expect(document.body.querySelector("[data-version-edits]")).toBeNull()
	})
})
