/**
 * The bulk edit bar: its count and buttons, each action run as the existing
 * per-entry requests one after another, and the report it leaves in place.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import axe from "axe-core"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const held = vi.hoisted(() => ({ store: undefined as unknown }))
vi.mock("./knowledge/bookKnowledge.svelte", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getBookKnowledge: () => held.store
}))
const { asks, refuse } = vi.hoisted(() => ({
	asks: [] as Array<{
		event: string
		params: any
		match?: (d: any) => boolean
		matchError?: (d: any) => boolean
	}>,
	refuse: new Map<number, string>()
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (o: {
		event: string
		params: any
		match?: (d: any) => boolean
		matchError?: (d: any) => boolean
	}) => {
		asks.push({
			event: o.event,
			params: o.params,
			match: o.match,
			matchError: o.matchError
		})
		const id =
			o.params.entry?.id ?? o.params.entryId ?? o.params.id ?? undefined
		if (refuse.has(id)) throw new Error(refuse.get(id))
		if (o.event === "entries:setMarks")
			return {
				entryId: o.params.entryId,
				request: o.params.request,
				off: o.params.off,
				pinned: o.params.pinned
			}
		return { ...o.params, entryId: id }
	}
}))

import BulkEditBar from "./BulkEditBar.svelte"
import { bookDataContext, staticBookData } from "./bookData.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import type { BulkRow } from "./bulkEdit"
import {
	CHARACTER_LORE_TYPE_ID,
	ITEM_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

const BOOK = 7
const branch = (
	id: number,
	name: string,
	from: number | null,
	forkYear: number
) => ({
	id,
	lorebookId: BOOK,
	name,
	forkedFromBranchId: from,
	forkYear,
	forkMonth: null,
	forkDay: null
})

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	asks.length = 0
	refuse.clear()
	held.store = undefined
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, [])
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	openBookTime.open(null)
})

const sel = (
	id: number,
	name: string,
	over: Partial<BulkRow> = {}
): BulkRow => ({
	id,
	typeId: "core:entry/character",
	name,
	pinned: false,
	off: false,
	archived: false,
	branchId: null,
	listed: true,
	...over
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function draw(
	selected: BulkRow[],
	over: {
		timeline?: boolean
		loadedTypes?: string[]
		rows?: Record<string, any>[]
		allSelected?: boolean
		selectableCount?: number
		line?: number | null
	} = {}
) {
	const onDone = vi.fn()
	const onSelectAll = vi.fn()
	const rows =
		over.rows ??
		selected.map((r) => ({
			id: r.id,
			name: r.name,
			typeId: r.typeId,
			branchId: r.branchId,
			anchorEntryId: null
		}))
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				rawRows: {
					entries: rows,
					...Object.fromEntries(
						(over.loadedTypes ?? []).map((t) => [t, []])
					)
				},
				timelineEnabled: over.timeline ?? true
			}) as any
	)
	app = mount(BulkEditBar, {
		target: document.body,
		props: {
			lorebookId: BOOK,
			selected,
			selectableCount: over.selectableCount ?? 3,
			allSelected: over.allSelected ?? false,
			onSelectAll,
			line: over.line ?? null,
			openEntryId: null,
			onDone
		},
		context: bookDataContext(data)
	})
	await settle()
	return { onDone, onSelectAll }
}

const button = (label: string) =>
	[...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	) as HTMLButtonElement | undefined
const count = () =>
	document.body.querySelector("[data-bulk-count]")?.textContent?.trim()
const report = () => ({
	headline: document.body.querySelector("[data-bulk-report] p")?.textContent,
	lines: [...document.body.querySelectorAll("[data-bulk-report] li")].map(
		(l) => l.textContent
	)
})
const press = async (label: string) => {
	button(label)!.click()
	await settle()
}

describe("nothing selected", () => {
	test("every action is disabled and the count reads 0 selected", async () => {
		await draw([])
		expect(count()).toBe("0 selected")
		const buttons = [...document.body.querySelectorAll("button")]
		expect(buttons.length).toBeGreaterThan(5)
		expect(buttons.every((b) => b.disabled)).toBe(true)
	})
})

describe("pin", () => {
	test("one pinned of three: Pin sends the other two, in order", async () => {
		const { onDone } = await draw([
			sel(1, "Ann"),
			sel(2, "Bo", { pinned: true }),
			sel(3, "Cy")
		])
		expect(count()).toBe("3 selected")
		await press("Pin")
		expect(
			asks.map((a) => [a.event, a.params.entryId, a.params.pinned])
		).toEqual([
			["entries:setMarks", 1, true],
			["entries:setMarks", 3, true]
		])
		expect(asks[0].params.request).toMatch(/^bulk-/)
		expect(report().headline).toBe("2 entries changed.")
		expect(onDone).toHaveBeenCalledWith([])
	})

	test("all three pinned: Unpin", async () => {
		await draw([
			sel(1, "Ann", { pinned: true }),
			sel(2, "Bo", { pinned: true }),
			sel(3, "Cy", { pinned: true })
		])
		expect(button("Unpin")).toBeTruthy()
		expect(button("Pin")).toBeUndefined()
	})
})

describe("archive with a refusal", () => {
	test("the others still go; the refused is named with the server's sentence", async () => {
		refuse.set(2, "Entry not found or access denied.")
		const { onDone } = await draw([
			sel(1, "Ann"),
			sel(2, "Bo"),
			sel(3, "Cy")
		])
		await press("Archive")
		expect(asks.map((a) => a.params.entry.id)).toEqual([1, 2, 3])
		expect(asks[0].params.entry).toMatchObject({ archived: true })
		expect(report().headline).toBe("2 entries changed.")
		expect(report().lines).toEqual([
			"Bo: Entry not found or access denied."
		])
		expect(onDone).toHaveBeenCalledWith([2])
	})
})

describe("beginning", () => {
	test("hidden with the Timeline off", async () => {
		await draw([sel(1, "Ann")], { timeline: false })
		expect(button("Beginning…")).toBeUndefined()
	})

	test("a History row is not sent and is named; the dialog's date reaches the rest", async () => {
		const { onDone } = await draw([
			sel(1, "Ann"),
			sel(2, "Year five", { typeId: "core:entry/history" })
		])
		await press("Beginning…")
		const began = [
			...document.body.querySelectorAll<HTMLInputElement>(
				'input[type="radio"]'
			)
		].find((r) => r.value === "beganAt")!
		began.click()
		await settle()
		const year = document.body.querySelector<HTMLInputElement>(
			'input[type="number"]'
		)!
		year.value = "5"
		year.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		await press("Apply to 1 entry")
		await settle()
		expect(asks).toHaveLength(1)
		expect(asks[0].params.entry).toMatchObject({ id: 1, year: 5 })
		expect(report().headline).toBe("1 entry changed.")
		expect(report().lines).toEqual([
			"Year five: A History entry takes no beginning: its date is its own."
		])
		expect(onDone).toHaveBeenCalledWith([2])
	})
})

describe("delete", () => {
	const rows = [
		{
			id: 1,
			name: "Parent",
			typeId: "core:entry/place",
			anchorEntryId: null
		},
		{ id: 2, name: "Child", typeId: "core:entry/place", anchorEntryId: 1 },
		{
			id: 3,
			name: "Other",
			typeId: "core:entry/place",
			anchorEntryId: null
		}
	]
	const picked = () => [
		sel(1, "Parent", { typeId: "core:entry/place" }),
		sel(2, "Child", { typeId: "core:entry/place" }),
		sel(3, "Other", { typeId: "core:entry/place" })
	]
	test("asks once naming the count; Cancel sends nothing", async () => {
		await draw(picked().slice(0, 1).concat(picked().slice(2)), { rows })
		await press("Delete…")
		expect(document.body.textContent).toContain("Delete 2 entries?")
		expect(document.body.textContent).toContain("edit history")
		await press("Cancel")
		expect(asks).toEqual([])
	})

	test("confirm sends one per sent entry; a child under a selected parent is not sent", async () => {
		const { onDone } = await draw(picked(), { rows })
		await press("Delete…")
		expect(document.body.textContent).toContain("Delete 3 entries?")
		await press("Delete")
		expect(asks.map((a) => [a.event, a.params.id])).toEqual([
			["entries:delete", 1],
			["entries:delete", 3]
		])
		expect(report().headline).toBe("3 entries changed.")
		expect(onDone).toHaveBeenCalledWith([])
	})
})

describe("request ids", () => {
	test("each update and delete carries its own requestId; only it matches", async () => {
		await draw([sel(1, "Ann"), sel(2, "Bo")])
		await press("Archive")
		const u = asks.filter((a) => a.event === "entries:update")
		expect(u).toHaveLength(2)
		expect(u[0].params.requestId).toBeTruthy()
		expect(u[0].params.requestId).not.toBe(u[1].params.requestId)
		for (const a of u) {
			const good = { requestId: a.params.requestId }
			const foreign = { requestId: "other" }
			expect(a.match!(good)).toBe(true)
			expect(a.match!(foreign)).toBe(false)
			expect(a.matchError!(good)).toBe(true)
			expect(a.matchError!(foreign)).toBe(false)
		}
	})
	test("delete the same", async () => {
		await draw([sel(1, "Ann"), sel(2, "Bo")])
		await press("Delete…")
		await press("Delete")
		const d = asks.filter((a) => a.event === "entries:delete")
		expect(d).toHaveLength(2)
		expect(d[0].params.requestId).not.toBe(d[1].params.requestId)
		for (const a of d) {
			expect(a.match!({ requestId: a.params.requestId })).toBe(true)
			expect(a.match!({ requestId: "other" })).toBe(false)
			expect(a.matchError!({ requestId: a.params.requestId })).toBe(true)
			expect(a.matchError!({ requestId: "other" })).toBe(false)
		}
	})
})

describe("delete, truth", () => {
	const rows = [
		{
			id: 1,
			name: "Parent",
			typeId: "core:entry/place",
			anchorEntryId: null
		},
		{ id: 2, name: "Child", typeId: "core:entry/place", anchorEntryId: 1 }
	]
	const picked = () => [
		sel(1, "Parent", { typeId: "core:entry/place" }),
		sel(2, "Child", { typeId: "core:entry/place" })
	]
	test("a child of a refused parent is listed and stays selected", async () => {
		refuse.set(1, "Nope.")
		const { onDone } = await draw(picked(), { rows })
		await press("Delete…")
		await press("Delete")
		expect(report().headline).toBe("No entry changed.")
		expect(report().lines).toEqual([
			"Parent: Nope.",
			"Child: Not deleted: Parent was not."
		])
		expect(onDone).toHaveBeenCalledWith([1, 2])
	})
	test("the confirmation gives no number while a fileable entry type is not loaded", async () => {
		await draw([sel(1, "Ann")], { rows })
		await press("Delete…")
		expect(document.body.textContent).toContain(
			"Entries filed under them go too."
		)
	})
	test("the confirmation gives the count when all are loaded", async () => {
		const filed = [
			{
				id: 1,
				name: "Ann",
				typeId: WORLD_LORE_TYPE_ID,
				anchorEntryId: null
			},
			{ id: 5, name: "Kid", typeId: WORLD_LORE_TYPE_ID, anchorEntryId: 1 }
		]
		await draw([sel(1, "Ann")], {
			rows: filed,
			loadedTypes: [
				WORLD_LORE_TYPE_ID,
				CHARACTER_LORE_TYPE_ID,
				ITEM_TYPE_ID
			]
		})
		await press("Delete…")
		expect(document.body.textContent).toContain(
			"1 entry filed under them go too."
		)
		expect(document.body.textContent).not.toContain(
			"Entries filed under them go too."
		)
	})
})

describe("move down the tree", () => {
	beforeEach(() => {
		openBookTime.setBranches(BOOK, [
			branch(1, "A", null, 3),
			branch(2, "B", 1, 5)
		])
	})
	test("rows of two lines: disabled, the reason in the title", async () => {
		await draw([
			sel(1, "Ann", { branchId: 1 }),
			sel(2, "Bo", { branchId: 2 })
		])
		const b = button("Move down the tree…")!
		expect(b.disabled).toBe(true)
		expect(b.title).toBe("Move entries from one line at a time.")
	})
	test("rows of one line open the move dialog naming the count", async () => {
		await draw(
			[sel(1, "Ann", { branchId: 2 }), sel(2, "Bo", { branchId: 2 })],
			{ line: 2 }
		)
		await press("Move down the tree…")
		expect(document.body.textContent).toContain(
			"Move 2 entries down the tree"
		)
	})
})

describe("a row of another line", () => {
	test("is not sent and is named", async () => {
		openBookTime.setBranches(BOOK, [branch(1, "A", null, 3)])
		await draw([
			sel(1, "Ann"),
			sel(2, "Far", { branchId: 1, listed: false })
		])
		await press("Pin")
		expect(asks.map((a) => a.params.entryId)).toEqual([1])
		expect(report().lines).toEqual([
			"Far: On A: only Move down the tree… reaches it from here."
		])
	})
})

describe("select all", () => {
	test("calls onSelectAll(true) and shows checked when all are selected", async () => {
		const { onSelectAll } = await draw([sel(1, "Ann")])
		const box = document.body.querySelector<HTMLInputElement>(
			'input[type="checkbox"]'
		)!
		expect(box.closest("label")?.textContent?.trim()).toBe("Select all 3")
		box.click()
		expect(onSelectAll).toHaveBeenCalledWith(true)
	})
	test("allSelected is checked", async () => {
		await draw([sel(1, "Ann")], { allSelected: true, selectableCount: 1 })
		expect(
			document.body.querySelector<HTMLInputElement>(
				'input[type="checkbox"]'
			)!.checked
		).toBe(true)
	})
})

describe("mark not common knowledge", () => {
	const marks = (marked: number[], loaded = true, refusal?: string) => {
		const calls: Array<[number[], boolean]> = []
		held.store = {
			loaded,
			isMarked: (id: number) => marked.includes(id),
			setMark: async (ids: number[], flag: boolean) => {
				calls.push([ids, flag])
				if (refusal) throw new Error(refusal)
				return { markedEntryIds: [] }
			}
		}
		return calls
	}
	const three = () => [sel(1, "Ann"), sel(2, "Bo"), sel(3, "Cy")]

	test("without a store the button is absent; with an unread store too", async () => {
		await draw(three())
		expect(button("Mark not common knowledge…")).toBeUndefined()
		expect(button("Mark common knowledge")).toBeUndefined()
		app && unmount(app)
		app = null
		document.body.innerHTML = ""
		marks([], false)
		await draw(three())
		expect(button("Mark not common knowledge…")).toBeUndefined()
	})

	test("asks with the count and sends nothing yet; Cancel sends nothing", async () => {
		const calls = marks([])
		await draw(three())
		await press("Mark not common knowledge…")
		expect(document.body.textContent).toContain(
			"Mark 3 entries not common knowledge?"
		)
		expect(calls).toEqual([])
		await press("Cancel")
		expect(calls).toEqual([])
		expect(document.body.textContent).not.toContain(
			"Mark 3 entries not common knowledge?"
		)
	})

	test("confirming makes exactly one call and the bar says 3 entries changed", async () => {
		const calls = marks([])
		const { onDone } = await draw(three())
		await press("Mark not common knowledge…")
		await press("Mark not common knowledge")
		expect(calls).toEqual([[[1, 2, 3], true]])
		expect(asks).toEqual([])
		expect(report().headline).toBe("3 entries changed.")
		expect(onDone).toHaveBeenCalledWith([])
	})

	test("every selected entry marked: Mark common knowledge, no dialog, one call", async () => {
		const calls = marks([1, 2, 3])
		await draw(three())
		expect(button("Mark not common knowledge…")).toBeUndefined()
		await press("Mark common knowledge")
		expect(calls).toEqual([[[1, 2, 3], false]])
		expect(report().headline).toBe("3 entries changed.")
	})

	test("an entry already marked is left out of the send", async () => {
		const calls = marks([2])
		await draw(three())
		await press("Mark not common knowledge…")
		expect(document.body.textContent).toContain(
			"Mark 2 entries not common knowledge?"
		)
		await press("Mark not common knowledge")
		expect(calls).toEqual([[[1, 3], true]])
	})

	test("a refusal lists each entry with the sentence", async () => {
		marks([], true, "Only the owner may do this.")
		const { onDone } = await draw(three())
		await press("Mark not common knowledge…")
		await press("Mark not common knowledge")
		expect(report().headline).toBe("No entry changed.")
		expect(report().lines).toEqual([
			"Ann: Only the owner may do this.",
			"Bo: Only the owner may do this.",
			"Cy: Only the owner may do this."
		])
		expect(onDone).toHaveBeenCalledWith([1, 2, 3])
	})

	test("axe finds no violations with the dialog open", async () => {
		marks([])
		await draw(three())
		await press("Mark not common knowledge…")
		// The dialog is portaled; axe runs on the portal's dialog. Run on the whole
		// body it also flags the bar the modal hides (`aria-hidden-focus`), which
		// the dialog's focus trap keeps unreachable.
		const dialog =
			document.body.querySelector<HTMLElement>('[role="dialog"]')!
		const result = await axe.run(dialog, {
			rules: { "color-contrast": { enabled: false } }
		})
		expect(result.violations.map((v) => v.id)).toEqual([])
	})
})
