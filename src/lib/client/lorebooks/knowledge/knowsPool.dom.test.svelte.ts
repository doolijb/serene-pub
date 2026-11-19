/**
 * 🚧 The Knows pool: the Tied and Other zones, the switch and the buttons, the
 * drag paths, a refusal in place. ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import axe from "axe-core"
import KnowsPool from "./KnowsPool.svelte"

type Row = Sockets.EntryKnowledge.Row

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const row = (entryId: number, over: Partial<Row> = {}): Row => ({
	castMemberId: 1,
	name: "Mara",
	entryId,
	known: true,
	winner: null,
	hand: null,
	overruled: null,
	placeEntry: false,
	...over
})
const tie = (over = {}) => ({
	tieId: 1,
	kind: "knows" as const,
	relationshipType: "knows",
	hand: true,
	date: null,
	...over
})

const ENTRIES = [
	{ id: 1, name: "Mill", typeId: "place" },
	{ id: 2, name: "Bell", typeId: "item" },
	{ id: 3, name: "Cask", typeId: "item" },
	{ id: 4, name: "Dune", typeId: "place" }
]

async function view(
	rows: Row[],
	over: {
		loaded?: boolean
		error?: string | null
		marked?: number[]
		entries?: typeof ENTRIES
		onSet?: (id: number, hand: any) => Promise<unknown>
	} = {}
) {
	const target = document.createElement("div")
	document.body.append(target)
	const onSet = vi.fn(over.onSet ?? (async () => {}))
	app = mount(KnowsPool, {
		target,
		props: {
			memberName: "Mara",
			rows,
			loaded: over.loaded ?? true,
			error: over.error ?? null,
			entries: over.entries ?? ENTRIES,
			isMarked: (id: number) => (over.marked ?? []).includes(id),
			formatDate: (m: any) => `Year ${m.year}`,
			onSet
		}
	})
	flushSync()
	await tick()
	return { target, onSet }
}

const norm = (s: string | null | undefined) =>
	s?.replace(/\s+/g, " ").trim() ?? ""
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)!
const rowEl = (id: number) => q(`[data-knows-row="${id}"]`)
const zone = (z: string) => q(`[data-knows-zone="${z}"]`)
const hint = (z: string) =>
	document.body.querySelector(`[data-knows-hint="${z}"]`)

function dragEvent(type: string, data: Record<string, string> = {}) {
	const e = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(e, "dataTransfer", {
		value: {
			getData: (t: string) => data[t] ?? "",
			setData: (t: string, v: string) => {
				data[t] = v
			},
			dropEffect: "move",
			effectAllowed: "move"
		}
	})
	return e
}
async function startDrag(el: Element) {
	const data: Record<string, string> = {}
	el.dispatchEvent(dragEvent("dragstart", data))
	flushSync()
	await tick()
	return data
}
async function dropOn(el: Element, data: Record<string, string>) {
	el.dispatchEvent(dragEvent("dragover", data))
	el.dispatchEvent(dragEvent("drop", data))
	flushSync()
	await tick()
}
const settle = async () => {
	flushSync()
	await tick()
	await tick()
}

describe("the zones", () => {
	test("tied rows by name with their type; the rest under Other, marked first", async () => {
		await view(
			[
				row(3, { winner: tie(), hand: "knows" }),
				row(2, { winner: tie({ kind: "was_told", hand: false }) })
			],
			{ marked: [4] }
		)
		const tied = [
			...document.body.querySelectorAll(
				"[data-knows-zone=tied] [data-knows-row]"
			)
		]
		expect(tied.map((e) => e.getAttribute("data-knows-row"))).toEqual([
			"2",
			"3"
		])
		expect(norm(rowEl(2).textContent)).toContain("Bell")
		expect(norm(rowEl(2).textContent)).toContain("Item")
		const heads = [...zone("other").querySelectorAll("h5")].map((h) =>
			norm(h.textContent)
		)
		expect(heads).toEqual(["Not common knowledge", "Common knowledge"])
		const other = [...zone("other").querySelectorAll("[data-knows-row]")]
		expect(other.map((e) => e.getAttribute("data-knows-row"))).toEqual([
			"4",
			"1"
		])
	})

	test("a zone group with nothing in it draws no heading", async () => {
		await view([], { marked: [] })
		const heads = [...zone("other").querySelectorAll("h5")].map((h) =>
			norm(h.textContent)
		)
		expect(heads).toEqual(["Common knowledge"])
	})

	test("an empty Tied zone is an empty state", async () => {
		await view([])
		expect(norm(zone("tied").textContent)).toContain(
			"Nothing is tied to Mara yet. Drag an entry here, or press Knows beside it."
		)
	})

	test("the filter narrows only Other", async () => {
		await view([row(2, { winner: tie(), hand: "knows" })])
		const input = q("[data-knows-zone=other] input") as HTMLInputElement
		input.value = "du"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		const other = [...zone("other").querySelectorAll("[data-knows-row]")]
		expect(other.map((e) => e.getAttribute("data-knows-row"))).toEqual([
			"4"
		])
		expect(zone("tied").querySelectorAll("[data-knows-row]")).toHaveLength(
			1
		)
	})

	test("the lorebook sentence, and the loading and error lines", async () => {
		await view([], { loaded: false })
		expect(norm(document.body.textContent)).toContain(
			"These are this lorebook's ties; a session's notes can hold newer ones, which win in that session unless a tie is set here by hand and the session's notes hold no hand tie of their own."
		)
		expect(norm(document.body.textContent)).toContain(
			"Reading what Mara knows…"
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await view([], { error: "Nope." })
		expect(norm(q('[role="alert"]').textContent)).toBe("Nope.")
	})

	test("an entry the book does not hold is Untitled", async () => {
		await view([
			row(99, { winner: tie({ kind: "was_told", hand: false }) })
		])
		expect(norm(rowEl(99).textContent)).toContain("Untitled")
	})
})

describe("the buttons", () => {
	test("the Tied switch sets each hand", async () => {
		const { onSet } = await view([row(2, { winner: tie(), hand: "knows" })])
		const opt = (v: string) =>
			rowEl(2).querySelector<HTMLButtonElement>(
				`[data-known-by-option="${v}"]`
			)!
		expect(opt("knows").getAttribute("aria-pressed")).toBe("true")
		opt("kept_from").click()
		await settle()
		opt("default").click()
		await settle()
		opt("knows").click()
		await settle()
		expect(onSet.mock.calls).toEqual([
			[2, "kept_from"],
			[2, null],
			[2, "knows"]
		])
	})

	test("Other's Knows and Kept from", async () => {
		const { onSet } = await view([])
		rowEl(1)
			.querySelector<HTMLButtonElement>('[data-knows-add="knows"]')!
			.click()
		await settle()
		rowEl(3)
			.querySelector<HTMLButtonElement>('[data-knows-add="kept_from"]')!
			.click()
		await settle()
		expect(onSet.mock.calls).toEqual([
			[1, "knows"],
			[3, "kept_from"]
		])
	})

	test("a refusal is said in the row, never as a toast", async () => {
		await view([], {
			onSet: async () => {
				throw new Error("Only the owner may say who knows.")
			}
		})
		rowEl(1)
			.querySelector<HTMLButtonElement>('[data-knows-add="knows"]')!
			.click()
		await settle()
		expect(
			norm(rowEl(1).querySelector('[role="alert"]')?.textContent)
		).toBe("Only the owner may say who knows.")
	})

	test("a common-knowledge entry's Knows tie says it changes nothing yet", async () => {
		await view([row(2, { winner: tie(), hand: "knows" })], { marked: [] })
		const live = norm(rowEl(2).querySelector("[aria-live]")?.textContent)
		expect(live).toContain("Knows it")
		expect(live).toContain(
			"Changes nothing until the entry is marked not common knowledge."
		)
	})
})

describe("the drag", () => {
	test("a row dropped on Tied sets Knows", async () => {
		const { onSet } = await view([row(2, { winner: tie(), hand: "knows" })])
		const data = await startDrag(rowEl(3))
		await dropOn(zone("tied"), data)
		expect(onSet.mock.calls).toEqual([[3, "knows"]])
	})

	test("a hand row dropped on Other returns Default", async () => {
		const { onSet } = await view([row(2, { winner: tie(), hand: "knows" })])
		const data = await startDrag(rowEl(2))
		await dropOn(zone("other"), data)
		expect(onSet.mock.calls).toEqual([[2, null]])
	})

	test("a zone refuses its own rows", async () => {
		const { onSet } = await view([row(2, { winner: tie(), hand: "knows" })])
		const data = await startDrag(rowEl(3))
		await dropOn(zone("other"), data)
		expect(onSet).not.toHaveBeenCalled()
	})

	test("a row tied only by play is not draggable; a hand row and an Other row are", async () => {
		await view([
			row(2, { winner: tie({ kind: "was_told", hand: false }) }),
			row(3, { winner: tie(), hand: "knows" })
		])
		expect(rowEl(2).getAttribute("draggable")).toBeNull()
		expect(rowEl(3).getAttribute("draggable")).toBe("true")
		expect(rowEl(1).getAttribute("draggable")).toBe("true")
	})

	test("the hint shows on the other zone only while dragging", async () => {
		await view([row(2, { winner: tie(), hand: "knows" })])
		expect(hint("tied")).toBeNull()
		expect(hint("other")).toBeNull()
		await startDrag(rowEl(3))
		expect(norm(hint("tied")?.textContent)).toBe("Drop to set Knows")
		expect(hint("other")).toBeNull()
		rowEl(3).dispatchEvent(dragEvent("dragend"))
		await settle()
		expect(hint("tied")).toBeNull()
		await startDrag(rowEl(2))
		expect(norm(hint("other")?.textContent)).toBe("Drop to set Default")
		expect(hint("tied")).toBeNull()
	})
})

describe("axe", () => {
	test("finds no violations", async () => {
		const { target } = await view(
			[
				row(2, { winner: tie(), hand: "knows" }),
				row(3, { winner: tie({ kind: "was_told", hand: false }) })
			],
			{ marked: [4] }
		)
		const result = await axe.run(target, {
			rules: { "color-contrast": { enabled: false } }
		})
		expect(result.violations.map((v) => v.id)).toEqual([])
	})

	test("an empty Tied zone finds none either", async () => {
		const { target } = await view([])
		const result = await axe.run(target, {
			rules: { "color-contrast": { enabled: false } }
		})
		expect(result.violations.map((v) => v.id)).toEqual([])
	})
})
