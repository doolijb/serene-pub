/**
 * 🚧 The list mark: a small lock on a locked entry's or scene's row, and on no
 * other.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import EntryPool from "./EntryPool.svelte"
import { bookDataContext, staticBookData } from "./bookData.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import { loreRoute } from "./loreRoute.svelte"
import { descriptorForKind } from "./sections"
import { emptyFilters } from "./poolFilter"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { castPoolItem } from "./castPool"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"

const BOOK = 7
const entries = descriptorForKind(WORLD_LORE_TYPE_ID)!
const scenes = descriptorForKind("scene")!

const entry = (id: number, name: string, entryLock: boolean) => ({
	id,
	lorebookId: BOOK,
	name,
	content: `${name} content`,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	anchorEntryId: null,
	keys: [],
	entryLock
})
const scene = (id: number, name: string, sceneLock: boolean) => ({
	id,
	lorebookId: BOOK,
	branchId: null,
	name,
	summary: "Rain.",
	position: id,
	sceneLock,
	participantCharacters: [],
	mentionedCharacters: []
})

let app: ReturnType<typeof mount> | null = null
const savedRoute = loreRoute.route
beforeEach(() => {
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, [])
	loreRoute.set({ ...emptyRoute(), lorebookId: BOOK })
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	openBookTime.open(null)
	loreRoute.set(savedRoute)
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

describe("the lock mark on a row", () => {
	test("sits on a locked entry and a locked scene, and on no other row", async () => {
		const rows: Array<[any, typeof entries]> = [
			[entry(1, "Open entry", false), entries],
			[entry(2, "Locked entry", true), entries],
			[scene(3, "Open scene", false), scenes],
			[scene(4, "Locked scene", true), scenes]
		]
		const sources = new Map<string, any>()
		const doors = new Map<string, typeof entries>()
		const items = rows.map(([source, door]) => {
			const item = door.toPoolItem(source)
			sources.set(item.key, source)
			doors.set(item.key, door)
			return item
		})
		const data = staticBookData(
			() => ({ lorebookId: BOOK, rawRows: {}, bookAccess: "owner" }) as any
		)
		app = mount(EntryPool, {
			target: document.body,
			props: {
				items,
				sourceOf: (i: any) => sources.get(i.key),
				descriptorOf: (i: any) => doors.get(i.key),
				descriptor: entries,
				bindings: [],
				vectorizationEnabled: false,
				selectedKey: null,
				lens: "list",
				filters: emptyFilters(),
				facets: {
					readIn: 0,
					pinned: 0,
					off: 0,
					archived: 0,
					machineWritten: 0,
					needsKeywords: 0,
					library: 0,
					total: 4
				},
				summary: "4 rows",
				orderBy: "name",
				mode: "desk",
				onSelect: vi.fn(),
				onDelete: vi.fn(),
				onFilters: vi.fn(),
				onOrderBy: vi.fn(),
				onReorder: vi.fn()
			} as any,
			context: bookDataContext(data)
		})
		await settle()
		const marked = [
			...document.body.querySelectorAll("[data-entry-row]")
		]
			.filter((row) => row.querySelector("[data-lock-mark]"))
			.map((row) => row.getAttribute("data-entry-key"))
		expect(marked).toEqual(
			items.filter((_, i) => i === 1 || i === 3).map((i) => i.key)
		)
		const mark = document.body.querySelector("[data-lock-mark]")!
		expect(mark.getAttribute("aria-label")).toBe("Locked")
		expect(mark.getAttribute("title")).toBe("Locked")
	})

	test("sits on a locked cast member's row in Everything, and on no other member", async () => {
		const members = [
			{ id: 11, name: "Open member", summary: "", castMemberLock: false },
			{ id: 12, name: "Locked member", summary: "", castMemberLock: true }
		]
		const items = members.map((m) => castPoolItem(m as any))
		const sources = new Map(items.map((i) => [i.key, { ...i }]))
		const data = staticBookData(
			() => ({ lorebookId: BOOK, rawRows: {}, bookAccess: "owner" }) as any
		)
		app = mount(EntryPool, {
			target: document.body,
			props: {
				items,
				sourceOf: (i: any) => sources.get(i.key),
				descriptorOf: () => entries,
				descriptor: entries,
				bindings: [],
				vectorizationEnabled: false,
				selectedKey: null,
				lens: "list",
				filters: emptyFilters(),
				facets: {
					readIn: 0,
					pinned: 0,
					off: 0,
					archived: 0,
					machineWritten: 0,
					needsKeywords: 0,
					library: 0,
					total: 2
				},
				summary: "2 rows",
				orderBy: "name",
				mode: "desk",
				onSelect: vi.fn(),
				onDelete: vi.fn(),
				onFilters: vi.fn(),
				onOrderBy: vi.fn(),
				onReorder: vi.fn()
			} as any,
			context: bookDataContext(data)
		})
		await settle()
		const marked = [
			...document.body.querySelectorAll("[data-entry-row]")
		]
			.filter((row) => row.querySelector("[data-lock-mark]"))
			.map((row) => row.getAttribute("data-entry-key"))
		expect(marked).toEqual(["cast#12"])
	})
})
