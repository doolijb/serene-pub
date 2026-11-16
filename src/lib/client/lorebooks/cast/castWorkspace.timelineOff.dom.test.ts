/**
 * 🚧 The member page with the book's Timeline switch off: the Timeline tab
 * stays with its scenes, in the order played and without dates; the
 * presences and the version rail are not drawn. On, each is as it was.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

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
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import CastWorkspaceFixture from "../CastWorkspaceFixture.svelte"
import { staticBookData } from "../bookData.svelte"

const BOOK = 5
const VERITY = 10

const client = {
	connected: true,
	id: "tab-a",
	on() {},
	off() {},
	emit() {}
}
const HISTORY = [
	{ id: 101, lorebookId: BOOK, typeId: HISTORY_TYPE_ID, branchId: null, year: 3 },
	{ id: 102, lorebookId: BOOK, typeId: HISTORY_TYPE_ID, branchId: null, year: 1 }
]
// Dated order is 302 then 301; played order (first message) is 301 then 302.
const SCENES = [
	{
		id: 301,
		historyEntryId: 101,
		name: "Smoke",
		summary: "s",
		selectedMessageIds: [10, 11],
		participantCharacters: [VERITY]
	},
	{
		id: 302,
		historyEntryId: 102,
		name: "Docks",
		summary: "s",
		selectedMessageIds: [50],
		participantCharacters: [VERITY]
	}
]
const AMENDMENT = {
	id: 1,
	castId: VERITY,
	lorebookId: BOOK,
	branchId: null,
	year: 2,
	month: null,
	day: null,
	fields: { name: "Verity of the Docks" },
	historyEntryId: null,
	personalPosition: null,
	columns: {},
	createdAt: "",
	updatedAt: ""
}

let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
	store.load()
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	close()
	loreRoute.set(emptyRoute())
	openBookTime.open(null)
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function mountMember(timelineEnabled: boolean) {
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: VERITY })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings: { showAdvancedControls: false } }]
		]),
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				timelineEnabled,
				cast: [
					{
						id: VERITY,
						name: "Verity",
						binding: "{{char:1}}",
						characterId: null,
						character: null
					}
				] as any,
				rawRows: { [HISTORY_TYPE_ID]: HISTORY as any },
				scenes: SCENES as any
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line: lineOf(null, []),
			castAmendmentsFor: () => [AMENDMENT]
		}
	})
	await settle()
}

const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const tabLabels = () =>
	[
		...document.querySelectorAll(
			'[data-cast-member-page] [role="tablist"][aria-label$="\'s page"] [role="tab"]'
		)
	].map(text)
const timeline = () => document.getElementById("cast-member-timeline")!
const sceneIds = () =>
	[...timeline().querySelectorAll<HTMLElement>("[data-cast-scene]")].map(
		(r) => Number(r.dataset.castScene)
	)

describe("the member page and the Timeline switch", () => {
	test("on: presences, the version rail, and the Timeline in dated order with dates", async () => {
		await mountMember(true)
		expect(!!document.querySelector("[data-lore-presences]")).toBe(true)
		expect(!!document.querySelector("[data-version-rail]")).toBe(true)
		expect(!!document.querySelector("[data-lore-amendments]")).toBe(false)
		expect(tabLabels()).toContain("Timeline")
		expect(sceneIds()).toEqual([302, 301])
		expect(text(timeline())).toContain("Year 1")
	})

	test("off: no presences and no version rail; the Timeline stays, in the order played, undated", async () => {
		await mountMember(false)
		expect(!!document.querySelector("[data-lore-presences]")).toBe(false)
		expect(!!document.querySelector("[data-version-rail]")).toBe(false)
		expect(!!document.querySelector("[data-lore-amendments]")).toBe(false)
		expect(tabLabels()).toContain("Timeline")
		expect(sceneIds()).toEqual([301, 302])
		expect(text(timeline())).toContain("Smoke")
		expect(text(timeline())).not.toContain("Year 1")
		expect(text(timeline())).not.toContain("Undated")
	})
})
