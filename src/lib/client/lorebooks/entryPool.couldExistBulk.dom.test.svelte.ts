/**
 * The entries list's two toggles: *Could exist here* and bulk edit.
 *
 * Lines: main <- A (forked at Year 3) <- B (forked at Year 5); C forked from main (a sibling of A). Reading A.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { asks } = vi.hoisted(() => ({
	asks: [] as Array<{ event: string; params: any }>
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (o: { event: string; params: any }) => {
		asks.push({ event: o.event, params: o.params })
		if (o.event === "entries:setMarks")
			return {
				entryId: o.params.entryId,
				request: o.params.request,
				off: o.params.off,
				pinned: o.params.pinned
			}
		return { ...o.params, entryId: o.params.entryId }
	}
}))

import EntryPool from "./EntryPool.svelte"
import { bookDataContext, staticBookData } from "./bookData.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import { loreRoute } from "./loreRoute.svelte"
import { descriptorForKind } from "./sections"
import { emptyFilters, CAST_KIND } from "./poolFilter"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { emptyRoute, momentKey } from "$lib/shared/lorebooks/loreRoute"

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

const descriptor = descriptorForKind(WORLD_LORE_TYPE_ID)!
const scenesDescriptor = descriptorForKind("scene")!
const wire = (id: number, name: string, over: Record<string, any> = {}) => ({
	id,
	lorebookId: BOOK,
	name,
	content: `${name} content`,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	anchorEntryId: null,
	keys: [],
	...over
})

const FACETS = {
	readIn: 0,
	pinned: 0,
	off: 0,
	archived: 0,
	machineWritten: 0,
	needsKeywords: 0,
	library: 0,
	total: 2
}

let app: ReturnType<typeof mount> | null = null
const savedRoute = loreRoute.route
let store: Record<string, string>
beforeEach(() => {
	asks.length = 0
	store = {}
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => void (store[k] = v),
		removeItem: (k: string) => void delete store[k]
	})
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, [
		branch(1, "A", null, 3),
		branch(2, "B", 1, 5),
		branch(3, "C", null, 4)
	])
	loreRoute.set({ ...emptyRoute(), lorebookId: BOOK, branch: 1 })
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	openBookTime.open(null)
	loreRoute.set(savedRoute)
	vi.unstubAllGlobals()
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const MAIN = wire(1, "Main entry")
const OWN = wire(2, "Own entry", { branchId: 1 })
const FORKED = wire(3, "Forked entry", { branchId: 2 })
const SIBLING = wire(4, "Sibling entry", { branchId: 3 })

async function draw(
	over: {
		readOnly?: boolean
		scenes?: boolean
		listed?: Record<string, any>[]
		extra?: any[]
		dimmed?: string[]
	} = {}
) {
	const listed = over.listed ?? [MAIN, OWN]
	const sources = new Map<string, any>()
	const items = listed.map((s) => {
		const i = descriptor.toPoolItem(s)
		sources.set(i.key, s)
		return i
	})
	for (const extra of over.extra ?? []) {
		sources.set(extra.item.key, extra.source)
		items.push(extra.item)
	}
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				rawRows: {
					[WORLD_LORE_TYPE_ID]: [MAIN, OWN, FORKED, SIBLING]
				},
				bookAccess: over.readOnly ? "shared" : "owner",
				timelineEnabled: true
			}) as any
	)
	app = mount(EntryPool, {
		target: document.body,
		props: {
			items,
			sourceOf: (i: any) => sources.get(i.key),
			descriptorOf: () => descriptor,
			descriptor: over.scenes ? scenesDescriptor : descriptor,
			bindings: [],
			vectorizationEnabled: false,
			selectedKey: null,
			lens: "list",
			filters: emptyFilters(),
			facets: FACETS,
			summary: "2 entries",
			orderBy: "name",
			mode: "desk",
			dimmedKeys: new Set(over.dimmed ?? []),
			onSelect: vi.fn(),
			onDelete: vi.fn(),
			onFilters: vi.fn(),
			onOrderBy: vi.fn(),
			onReorder: vi.fn()
		} as any,
		context: bookDataContext(data)
	})
	await settle()
}

const q = <T extends Element>(s: string) => [
	...document.body.querySelectorAll<T>(s)
]
const one = <T extends Element>(s: string) => q<T>(s)[0]
const couldBtn = () => one<HTMLButtonElement>("[data-toggle-could-exist]")
const bulkBtn = () => one<HTMLButtonElement>("[data-toggle-bulk]")
const click = async (el: Element | undefined) => {
	;(el as HTMLElement).click()
	await settle()
}
const groupNames = () =>
	q("[data-could-exist-row]").map((r) => r.textContent ?? "")
const checks = () => q<HTMLInputElement>("[data-bulk-check]")
const button = (label: string) =>
	q<HTMLButtonElement>("button").find((b) => b.textContent?.trim() === label)

describe("the toggles", () => {
	test("drawn for the owner, neither pressed", async () => {
		await draw()
		expect(couldBtn().getAttribute("aria-label")).toBe("Could exist here")
		expect(bulkBtn().getAttribute("aria-label")).toBe("Bulk edit")
		expect(couldBtn().getAttribute("aria-pressed")).toBe("false")
		expect(bulkBtn().getAttribute("aria-pressed")).toBe("false")
	})

	test("not drawn on a read-only book", async () => {
		await draw({ readOnly: true })
		expect(couldBtn()).toBeUndefined()
		expect(bulkBtn()).toBeUndefined()
	})

	test("not drawn in a scenes scope", async () => {
		await draw({ scenes: true })
		expect(couldBtn()).toBeUndefined()
		expect(bulkBtn()).toBeUndefined()
	})
})

describe("could exist here", () => {
	test("reading A: the group lists B's entry only, and the summary is unchanged", async () => {
		await draw()
		await click(couldBtn())
		expect(couldBtn().getAttribute("aria-pressed")).toBe("true")
		const rows = groupNames()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toContain("Forked entry")
		expect(document.body.textContent).not.toContain("Sibling entry")
		expect(one("[data-lore-pool-summary]").textContent?.trim()).toBe(
			"2 entries"
		)
		expect(store["serene.lore.couldExistHere"]).toBe("on")
		await click(couldBtn())
		expect(groupNames()).toHaveLength(0)
		expect("serene.lore.couldExistHere" in store).toBe(false)
	})

	test("a fresh mount with on stored starts on", async () => {
		store["serene.lore.couldExistHere"] = "on"
		await draw()
		expect(couldBtn().getAttribute("aria-pressed")).toBe("true")
		expect(groupNames()).toHaveLength(1)
	})

	test("a throwing localStorage still mounts, toggle off", async () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("denied")
			},
			setItem: () => {
				throw new Error("denied")
			},
			removeItem: () => {
				throw new Error("denied")
			}
		})
		await draw()
		expect(couldBtn().getAttribute("aria-pressed")).toBe("false")
		await click(couldBtn())
		expect(couldBtn().getAttribute("aria-pressed")).toBe("true")
	})

	test("a dimmed row stays in the list body; its cause and Read from show only with the toggle on", async () => {
		const later = wire(5, "Later entry", { year: 8 })
		const item = descriptor.toPoolItem(later)
		await draw({ extra: [{ item, source: later }], dimmed: [item.key] })
		const inBody = () =>
			q("[data-entry-row]").filter(
				(r) =>
					!r.closest("[data-could-exist-here]") &&
					r.textContent?.includes("Later entry")
			)
		const readFromBtn = () =>
			q<HTMLButtonElement>("[data-could-exist-read-from]")
		expect(inBody()).toHaveLength(1)
		expect(inBody()[0].classList.contains("opacity-50")).toBe(true)
		expect(inBody()[0].querySelector("[data-could-exist-why]")).toBeNull()
		expect(readFromBtn()).toHaveLength(0)
		await click(couldBtn())
		expect(inBody()).toHaveLength(1)
		expect(
			inBody()[0].querySelector("[data-could-exist-why]")?.textContent
		).toContain("Begins in")
		expect(readFromBtn()).toHaveLength(1)
		expect(readFromBtn()[0].textContent).toContain("Read from")
		expect(
			groupNames().filter((t) => t.includes("Later entry"))
		).toHaveLength(0)
		expect(
			one("[data-could-exist-here]").querySelector("h3")?.textContent
		).toMatch(/1\s*$/)
		await click(readFromBtn()[0])
		expect(loreRoute.route.moment).toBe(
			momentKey({ year: 8, month: null, day: null })
		)
	})

	test("a dimmed row keeps its checkbox in bulk edit, toggle off or on", async () => {
		const later = wire(5, "Later entry", { year: 8 })
		const item = descriptor.toPoolItem(later)
		await draw({ extra: [{ item, source: later }], dimmed: [item.key] })
		await click(bulkBtn())
		expect(checks()).toHaveLength(3)
		await click(couldBtn())
		const bodyChecks = checks().filter(
			(c) => !c.closest("[data-could-exist-here]")
		)
		expect(bodyChecks).toHaveLength(3)
	})

	test("a dimmed History row never shows the line", async () => {
		const hist = wire(6, "History entry", { year: 9 })
		const item = {
			...descriptor.toPoolItem(hist),
			kind: HISTORY_TYPE_ID
		}
		await draw({ extra: [{ item, source: hist }], dimmed: [item.key] })
		await click(couldBtn())
		const row = q("[data-entry-row]").find((r) =>
			r.textContent?.includes("History entry")
		)!
		expect(row).toBeTruthy()
		expect(row.querySelector("[data-could-exist-why]")).toBeNull()
		expect(row.querySelector("[data-could-exist-read-from]")).toBeNull()
	})
})

describe("bulk edit", () => {
	test("a checkbox on each entry row, none on a cast row or a library piece; select-all; off clears", async () => {
		const cast = {
			...descriptor.toPoolItem(wire(8, "Cast member")),
			kind: CAST_KIND,
			key: "cast#8"
		}
		const lib = {
			...descriptor.toPoolItem(wire(9, "Library piece")),
			fromLibrary: true,
			key: "lib#9"
		}
		await draw({
			extra: [
				{ item: cast, source: wire(8, "Cast member") },
				{ item: lib, source: wire(9, "Library piece") }
			]
		})
		expect(checks()).toHaveLength(0)
		expect(one("[data-bulk-bar]")).toBeUndefined()
		await click(bulkBtn())
		expect(bulkBtn().getAttribute("aria-pressed")).toBe("true")
		expect(checks().map((c) => c.getAttribute("aria-label"))).toEqual([
			"Select Main entry",
			"Select Own entry"
		])
		const scroller = one("[data-lore-pool] > div:nth-of-type(2)")
		const bar = one("[data-bulk-bar]")
		expect(bar).toBeDefined()
		expect(
			scroller.compareDocumentPosition(bar) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy()
		expect(scroller.contains(bar)).toBe(false)
		await click(
			q<HTMLInputElement>("input[type=checkbox]").find(
				(c) => !c.hasAttribute("data-bulk-check")
			)
		)
		expect(checks().every((c) => c.checked)).toBe(true)
		await click(bulkBtn())
		expect(checks()).toHaveLength(0)
		expect(one("[data-bulk-bar]")).toBeUndefined()
		await click(bulkBtn())
		expect(checks().every((c) => !c.checked)).toBe(true)
	})

	test("two rows checked, Pin sends setMarks for each and focus returns to the list", async () => {
		await draw()
		await click(bulkBtn())
		for (const c of checks()) await click(c)
		await click(button("Pin"))
		await settle()
		expect(
			asks.map((a) => [a.event, a.params.entryId, a.params.pinned])
		).toEqual([
			["entries:setMarks", 1, true],
			["entries:setMarks", 2, true]
		])
		const scroller = one("[data-lore-pool] > div:nth-of-type(2)")
		expect(document.activeElement).toBe(scroller)
	})
})
