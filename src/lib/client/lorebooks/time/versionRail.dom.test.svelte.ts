/**
 * The version rail: its order and words, selection, the add and change-date
 * dialogs, the delete question, Elsewhere, read-only and the strip.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
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
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { openBookTime } from "./bookTime.svelte"
import VersionRail from "./VersionRail.svelte"
import { entryVersions } from "./entryVersions"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { TAKEN_REDATE_SENTENCE, TAKEN_SAVE_SENTENCE } from "./entryVersions"
import { REPLY_TIMEOUT_MESSAGE } from "$lib/client/utils/awaitReply"

type Row = Sockets.Amendments.EntryRow
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

const BOOK = 1
const BRANCHES = [
	{
		id: 7,
		lorebookId: BOOK,
		name: "fork",
		forkedFromBranchId: null,
		forkYear: 5,
		forkMonth: null,
		forkDay: null
	},
	{
		id: 9,
		lorebookId: BOOK,
		name: "other",
		forkedFromBranchId: null,
		forkYear: 1,
		forkMonth: null,
		forkDay: null
	}
]

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
	_resetInterestForTests()
	setSocket(null)
	openBookTime.open(null)
	document.body.innerHTML = ""
})

function row(
	id: number,
	year: number,
	fields: Record<string, unknown>,
	extra: Partial<Row> = {}
): Row {
	return {
		id,
		entryId: 1,
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

const ENTRY = { branchId: null, year: 1, month: null, day: null }
const names = (b: number | null) =>
	b === null ? "main" : (BRANCHES.find((x) => x.id === b)?.name ?? "?")

let renders = 0
async function draw(
	rows: Row[],
	over: {
		line?: number | null
		readOnly?: boolean
		selectedKey?: string
		edits?: boolean
		props?: Record<string, unknown>
		mapVersions?: (v: ReturnType<typeof entryVersions>["versions"]) => any[]
		onRedate?: (...a: any[]) => Promise<unknown>
		onDelete?: (...a: any[]) => Promise<unknown>
	} = {}
) {
	const lineBranchId = over.line === undefined ? 7 : over.line
	const built = entryVersions({
		entry: ENTRY,
		amendments: rows,
		line: lineOf(lineBranchId, BRANCHES)
	})
	const { elsewhere } = built
	const versions = over.mapVersions
		? over.mapVersions(built.versions)
		: built.versions
	const calls = {
		onRedate: vi.fn(over.onRedate ?? (async () => undefined)),
		onDelete: vi.fn(over.onDelete ?? (async () => undefined)),
		onSelect: vi.fn(),
		onAdd: vi.fn(),
		onOpenOnLine: vi.fn(),
		onRedated: vi.fn(),
		onDeleted: vi.fn()
	}
	renders = 0
	app = mount(VersionRail, {
		target: document.body,
		props: {
			versions,
			elsewhere,
			selectedKey: over.selectedKey ?? versions[versions.length - 1].key,
			lineBranchId,
			readOnly: over.readOnly ?? false,
			lineName: names,
			...calls,
			...(over.props ?? {}),
			...(over.edits
				? {
						edits: createRawSnippet(
							(ids: () => readonly (number | null)[]) => ({
								render: () =>
									`<p data-edits="${ids().join(",") || "none"}">edits</p>`
							})
						)
					}
				: {}),
			children: createRawSnippet(() => {
				renders++
				return { render: () => `<p data-fields>the fields</p>` }
			})
		}
	})
	await settle()
	return { versions, elsewhere, ...calls }
}
async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const norm = (s: string | null | undefined) =>
	s?.replace(/\s+/g, " ").trim() ?? ""
const railItems = () =>
	[
		...document.body.querySelectorAll<HTMLElement>(
			"[data-version-rail] button[data-version-key]"
		)
	].map((b) => norm(b.textContent))
const buttons = (name: string | RegExp) =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].filter(
		(b) =>
			typeof name === "string"
				? norm(b.textContent) === name
				: name.test(norm(b.textContent))
	)
const byLabel = (label: string) =>
	[
		...document.body.querySelectorAll<HTMLButtonElement>(
			"[data-version-rail] button"
		)
	].find((b) => b.getAttribute("aria-label") === label)!
const dialogButton = (name: string) =>
	[
		...document.body.querySelectorAll<HTMLButtonElement>(
			'[data-testid="version-date-dialog"] button'
		)
	].find((b) => norm(b.textContent) === name)!
async function typeYear(value: string) {
	const el = document.body.querySelector<HTMLInputElement>(
		'[data-testid="version-date-dialog"] input[type="number"]'
	)!
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
const dialogText = () =>
	norm(
		document.body.querySelector('[data-testid="version-date-dialog"]')
			?.textContent
	)
const head = () =>
	norm(document.body.querySelector("[data-version-head]")?.textContent)

// main: beginning year 1; main version @3; fork's own @6
const ROWS = [
	row(1, 3, { name: "Early" }),
	row(3, 6, { content: "Later" }, { branchId: 7 })
]

describe("the rail", () => {
	test("order, words, from-line and Open on line", async () => {
		const d = await draw(ROWS)
		expect(railItems()).toEqual([
			"Began at Year 1 from main",
			"Year 3 changes name from main",
			"Year 6 changes content"
		])
		const rail = document.body.querySelector("[data-version-rail]")!
		const opens = [...rail.querySelectorAll("button")].filter((b) =>
			norm(b.textContent).startsWith("Open on")
		)
		expect(opens.map((b) => norm(b.textContent))).toEqual([
			"Open on main",
			"Open on main"
		])
		;(opens[1] as HTMLButtonElement).click()
		expect(d.onOpenOnLine).toHaveBeenCalledWith(null, {
			year: 3,
			month: null,
			day: null
		})
	})

	test("only the selected one has aria-current; a click selects", async () => {
		const d = await draw(ROWS)
		const current = [
			...document.body.querySelectorAll(
				"[data-version-rail] [aria-current]"
			)
		]
		expect(current.length).toBe(1)
		expect(current[0].getAttribute("data-version-key")).toBe("row:3")
		const early = document.body.querySelector<HTMLButtonElement>(
			'[data-version-rail] [data-version-key="row:1"]'
		)!
		early.click()
		expect(d.onSelect).toHaveBeenCalledWith(d.versions[1])
	})

	test("the fields render once; the strip holds the same versions", async () => {
		await draw(ROWS)
		expect(document.body.querySelectorAll("[data-fields]").length).toBe(1)
		expect(renders).toBe(1)
		const strip = [
			...document.body.querySelectorAll(
				"[data-version-strip] button[data-version-key]"
			)
		].map((b) => b.getAttribute("data-version-key"))
		expect(strip).toEqual(["beginning", "row:1", "row:3"])
		expect(
			document.body.querySelectorAll(
				"[data-version-strip] [aria-current]"
			).length
		).toBe(1)
	})

	test("add buttons are named for where they add", async () => {
		await draw(ROWS)
		const labels = [
			...document.body.querySelectorAll(
				"[data-version-rail] button[aria-label]"
			)
		].map((b) => b.getAttribute("aria-label"))
		expect(labels).toEqual([
			"Add a version between Began at Year 1 and Year 3",
			"Add a version between Year 3 and Year 6",
			"Add a version after Year 6"
		])
		const chips = [
			...document.body.querySelectorAll(
				"[data-version-strip] button[aria-label]"
			)
		].map((b) => b.getAttribute("aria-label"))
		expect(chips).toEqual(labels)
	})

	test("the add dialog holds the gap and calls onAdd", async () => {
		const d = await draw(ROWS)
		byLabel("Add a version between Year 3 and Year 6").click()
		await settle()
		expect(dialogText()).toContain("Add a version")
		expect(dialogText()).toContain(
			"The new version starts as the one before it; change what differs, then save."
		)
		await typeYear("8")
		expect(dialogText()).toContain("Pick a date after")
		expect(dialogButton("Add").disabled).toBe(true)
		await typeYear("4")
		expect(dialogButton("Add").disabled).toBe(false)
		dialogButton("Add").click()
		await settle()
		expect(d.onAdd).toHaveBeenCalledWith({
			year: 4,
			month: null,
			day: null
		})
	})

	test("no add before the beginning's date", async () => {
		await draw(ROWS)
		byLabel("Add a version between Began at Year 1 and Year 3").click()
		await settle()
		await typeYear("0")
		expect(dialogText()).toContain("can't be dated before it")
		expect(dialogButton("Add").disabled).toBe(true)
	})
})

describe("the head", () => {
	test("an inherited version is read-only with Open on line", async () => {
		const d = await draw(ROWS, { selectedKey: "row:1" })
		expect(head()).toContain("main's version from Year 3")
		expect(head()).not.toContain("Change its date")
		expect(head()).not.toContain("Delete this version")
		const open = buttons("Open on main").find((b) =>
			b.closest("[data-version-head]")
		)!
		open.click()
		expect(d.onOpenOnLine).toHaveBeenCalled()
	})

	test("the beginning not on the line says from main", async () => {
		await draw(ROWS, { selectedKey: "beginning" })
		expect(head()).toContain("Began at Year 1")
		expect(head()).toContain("from main")
	})

	test("Change its date writes the date and calls onRedated", async () => {
		const d = await draw(ROWS)
		expect(head()).toContain("This version begins Year 6")
		buttons("Change its date")[0].click()
		await settle()
		await typeYear("7")
		dialogButton("Move").click()
		await settle()
		expect(d.onRedate).toHaveBeenCalledWith(
			{ version: d.versions[2] },
			{ year: 7, month: null, day: null }
		)
		expect(d.onRedated).toHaveBeenCalledWith(d.versions[2], {
			year: 7,
			month: null,
			day: null
		})
	})

	test("moving onto a taken date is refused in words", async () => {
		await draw([
			row(1, 3, { name: "Early" }, { branchId: 7 }),
			row(3, 6, { content: "Later" }, { branchId: 7 })
		])
		buttons("Change its date")[0].click()
		await settle()
		await typeYear("3")
		expect(dialogText()).toContain(
			TAKEN_REDATE_SENTENCE({ year: 3, month: null, day: null })
		)
		expect(dialogButton("Move").disabled).toBe(true)
		void TAKEN_SAVE_SENTENCE
	})

	test("a two-row version cannot be moved", async () => {
		await draw([
			row(3, 6, { content: "A" }, { branchId: 7 }),
			row(4, 6, { name: "B" }, { branchId: 7 })
		])
		expect(buttons("Change its date").length).toBe(0)
		expect(head()).toContain(
			"Saved more than once at this date, so it can't be moved; delete it and add it again to move it."
		)
		expect(buttons("Delete this version").length).toBe(1)
	})

	test("Delete this version asks, then hands the version to onDelete", async () => {
		const d = await draw([
			row(3, 6, { content: "A" }, { branchId: 7 }),
			row(4, 6, { name: "B" }, { branchId: 7 })
		])
		buttons("Delete this version")[0].click()
		await settle()
		expect(head()).toContain("Delete the version dated Year 6?")
		expect(head()).toContain("edit history goes with it")
		expect(d.onDelete).not.toHaveBeenCalled()
		buttons("Delete")
			.find((b) => b.closest("[data-version-head]"))!
			.click()
		await settle()
		expect(d.onDelete).toHaveBeenCalledTimes(1)
		expect(d.onDelete).toHaveBeenCalledWith({ version: d.versions[1] })
		expect(d.onDeleted).toHaveBeenCalledWith(d.versions[1])
	})

	test("a reply that never came is said inline", async () => {
		const d = await draw(ROWS, {
			onDelete: async () => {
				throw new Error(REPLY_TIMEOUT_MESSAGE)
			}
		})
		buttons("Delete this version")[0].click()
		await settle()
		buttons("Delete")
			.find((b) => b.closest("[data-version-head]"))!
			.click()
		await settle()
		expect(head()).toContain("The server did not answer in time.")
		expect(d.onDeleted).not.toHaveBeenCalled()
	})

	test("another refusal leaves the question open and says nothing", async () => {
		const d = await draw(ROWS, {
			onDelete: async () => {
				throw new Error("refused")
			}
		})
		buttons("Delete this version")[0].click()
		await settle()
		buttons("Delete")
			.find((b) => b.closest("[data-version-head]"))!
			.click()
		await settle()
		expect(head()).toContain("Delete the version dated Year 6?")
		expect(head()).not.toContain("did not answer")
		expect(d.onDeleted).not.toHaveBeenCalled()
	})
})

describe("Elsewhere", () => {
	const rows = [
		...ROWS,
		row(5, 4, { state: "x" }, { branchId: 9 }),
		row(6, 9, { name: "Far" })
	]

	test("lists changes on lines the reading does not read", async () => {
		const d = await draw(rows)
		const group = norm(
			document.body.querySelector("[data-version-elsewhere-group]")
				?.textContent
		)
		expect(group).toContain("Elsewhere")
		expect(group).toContain("Year 4")
		expect(group).toContain("on other")
		expect(group).toContain("Year 9")
		expect(group).toContain("on main, after the fork")
		expect(group).toContain("Change its date")
		expect(group).toContain("Delete")
		expect(group).toContain("Open on other")
		expect(
			norm(
				document.body.querySelector(
					"[data-version-elsewhere-narrow] summary"
				)?.textContent
			)
		).toBe("Elsewhere · 2")
		const open = buttons("Open on other")[0]
		open.click()
		expect(d.onOpenOnLine).toHaveBeenCalledWith(9, {
			year: 4,
			month: null,
			day: null
		})
	})

	test("an Elsewhere row asks before it deletes and moves with the dialog", async () => {
		const d = await draw(rows)
		const li = document.body.querySelector<HTMLElement>(
			'[data-version-elsewhere-group] [data-version-elsewhere="5"]'
		)!
		;[...li.querySelectorAll("button")]
			.find((b) => norm(b.textContent) === "Delete")!
			.click()
		await settle()
		expect(norm(li.textContent)).toContain("on other? From then on")
		expect(d.onDelete).not.toHaveBeenCalled()
		;[...li.querySelectorAll("button")]
			.find((b) => norm(b.textContent) === "Cancel")!
			.click()
		await settle()
		;[...li.querySelectorAll("button")]
			.find((b) => norm(b.textContent) === "Change its date")!
			.click()
		await settle()
		await typeYear("3")
		dialogButton("Move").click()
		await settle()
		expect(d.onRedate).toHaveBeenCalledTimes(1)
		const [target, date] = d.onRedate.mock.calls[0]
		expect(target.row.id).toBe(5)
		expect(date).toEqual({ year: 3, month: null, day: null })
	})

	test("a locked Elsewhere row keeps Delete and Open on its line, never Change its date; its chip is drawn", async () => {
		await draw(rows, {
			props: {
				elsewhere: entryVersions({
					entry: ENTRY,
					amendments: [row(5, 4, { state: "x" }, { branchId: 9 })],
					line: lineOf(7, BRANCHES)
				}).elsewhere.map((r) => ({
					...r,
					locked: true,
					chip: "Session"
				}))
			}
		})
		const li = document.body.querySelector<HTMLElement>(
			'[data-version-elsewhere-group] [data-version-elsewhere="5"]'
		)!
		const names = [...li.querySelectorAll("button")].map((b) =>
			norm(b.textContent)
		)
		expect(names).toEqual(["Delete", "Open on other"])
		expect(norm(li.textContent)).toContain("Session")
	})

	test("drawn only when there is something", async () => {
		await draw(ROWS)
		expect(
			document.body.querySelector("[data-version-elsewhere-group]")
		).toBeNull()
	})
})

describe("versions of any subject", () => {
	const mark =
		(over: Record<string, Record<string, unknown>>) => (vs: any[]) =>
			vs.map((v) => ({ ...v, ...(over[v.key] ?? {}) }))

	test("a locked version selects like any other, offers no Change its date, and can be deleted", async () => {
		const d = await draw(ROWS, {
			mapVersions: mark({ "row:3": { locked: true } })
		})
		expect(head()).toContain("This version begins Year 6")
		expect(buttons("Change its date").length).toBe(0)
		expect(buttons("Delete this version").length).toBe(1)
		expect(head()).not.toContain("Saved more than once")
		document.body
			.querySelector<HTMLButtonElement>(
				'[data-version-rail] [data-version-key="row:1"]'
			)!
			.click()
		expect(d.onSelect).toHaveBeenCalled()
	})

	test("a chip and read at this date are drawn on the button, the head and the strip", async () => {
		await draw(ROWS, {
			mapVersions: mark({
				"row:3": { chip: "Session 4", readHere: true }
			})
		})
		const button = norm(
			document.body.querySelector(
				'[data-version-rail] [data-version-key="row:3"]'
			)!.textContent
		)
		expect(button).toContain("Session 4")
		expect(button).toContain("read at this date")
		expect(head()).toContain("Session 4")
		expect(head()).toContain("read at this date")
		expect(
			norm(
				document.body.querySelector(
					'[data-version-strip] [data-version-key="row:3"]'
				)!.textContent
			)
		).toBe("Year 6 · Session 4")
	})

	test("addBlocked turns every add button off and carries its words", async () => {
		await draw(ROWS, { props: { addBlocked: "Pick a session first." } })
		const adds = [
			...document.body.querySelectorAll<HTMLButtonElement>(
				"[data-version-rail] button[aria-label], [data-version-strip] button[aria-label]"
			)
		]
		expect(adds.length).toBe(6)
		for (const b of adds) {
			expect(b.disabled).toBe(true)
			expect(b.title).toBe("Pick a session first.")
		}
	})

	test("describe and deleteSentence are used", async () => {
		await draw([...ROWS, row(5, 4, { state: "x" }, { branchId: 9 })], {
			props: {
				describe: (keys: string[]) => `sets ${keys.join("+")}`,
				deleteSentence: (when: string, line: string | null) =>
					`Remove ${when}${line ? ` from ${line}` : ""}?`
			}
		})
		expect(railItems()[1]).toBe("Year 3 sets name from main")
		expect(head()).toContain("sets content")
		const li = document.body.querySelector<HTMLElement>(
			'[data-version-elsewhere-group] [data-version-elsewhere="5"]'
		)!
		expect(norm(li.textContent)).toContain("sets state")
		buttons("Delete this version")[0].click()
		await settle()
		expect(head()).toContain("Remove Year 6?")
		;[...li.querySelectorAll("button")]
			.find((b) => norm(b.textContent) === "Delete")!
			.click()
		await settle()
		expect(norm(li.textContent)).toContain("Remove Year 4 from other?")
	})

	test("takenAt decides what is taken", async () => {
		const takenAt = vi.fn((_d: unknown, _m: unknown) => ({}) as never)
		await draw(ROWS, { props: { takenAt } })
		buttons("Change its date")[0].click()
		await settle()
		await typeYear("9")
		expect(takenAt).toHaveBeenCalled()
		expect(dialogText()).toContain(
			TAKEN_REDATE_SENTENCE({ year: 9, month: null, day: null })
		)
		expect(dialogButton("Move").disabled).toBe(true)
	})
})

describe("read-only", () => {
	test("selects and opens, never adds, moves or deletes", async () => {
		const d = await draw(
			[...ROWS, row(5, 4, { state: "x" }, { branchId: 9 })],
			{ readOnly: true }
		)
		expect(
			document.body.querySelectorAll(
				"[data-version-rail] button[aria-label], [data-version-strip] button[aria-label]"
			).length
		).toBe(0)
		expect(buttons("Change its date").length).toBe(0)
		expect(buttons(/Delete/).length).toBe(0)
		expect(buttons("Open on other").length).toBe(2)
		document.body
			.querySelector<HTMLButtonElement>(
				'[data-version-rail] [data-version-key="row:1"]'
			)!
			.click()
		expect(d.onSelect).toHaveBeenCalled()
	})
})

describe("edits under the versions", () => {
	const KEY = "serene.lore.versionEdits"
	const editsAt = () =>
		[...document.body.querySelectorAll("[data-edits]")].map((e) =>
			e.getAttribute("data-edits")
		)
	const toggle = () =>
		document.body.querySelector<HTMLButtonElement>(
			"[data-version-edits-toggle]"
		)!

	const store = new Map<string, string>()
	beforeEach(() => {
		store.clear()
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		})
	})
	afterEach(() => vi.unstubAllGlobals())

	test("each version and each Elsewhere row gets its ids", async () => {
		await draw([...ROWS, row(5, 4, { name: "Fork" }, { branchId: 9 })], {
			edits: true
		})
		const ids = editsAt()
		expect(ids).toContain("none")
		expect(ids).toContain("1")
		expect(ids).toContain("5")
	})

	test("no edits snippet: no toggle", async () => {
		await draw(ROWS)
		expect(
			document.body.querySelector("[data-version-edits-toggle]")
		).toBeNull()
	})

	test("Edits toggles them off and on, with aria-pressed, and is remembered", async () => {
		await draw(ROWS, { edits: true })
		expect(toggle().getAttribute("aria-pressed")).toBe("true")
		expect(toggle().title).toBe("Show the edit history under each version")
		toggle().click()
		await settle()
		expect(toggle().getAttribute("aria-pressed")).toBe("false")
		expect(editsAt()).toEqual([])
		expect(store.get(KEY)).toBe("off")
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await draw(ROWS, { edits: true })
		expect(toggle().getAttribute("aria-pressed")).toBe("false")
		expect(editsAt()).toEqual([])
		toggle().click()
		await settle()
		expect(editsAt().length).toBeGreaterThan(0)
		expect(store.has(KEY)).toBe(false)
	})

	test("a throwing localStorage does not break the rail", async () => {
		const boom = () => {
			throw new Error("blocked")
		}
		vi.stubGlobal("localStorage", {
			getItem: boom,
			setItem: boom,
			removeItem: boom
		})
		await draw(ROWS, { edits: true })
		expect(editsAt().length).toBeGreaterThan(0)
		toggle().click()
		await settle()
		expect(editsAt()).toEqual([])
	})
})
