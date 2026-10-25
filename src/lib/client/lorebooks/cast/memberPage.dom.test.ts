/**
 * The Cast member page's tabs (DESIGN-ux-simplification A.6): Member, Lore,
 * Relationships and Timeline in one `PanelTabStrip`, the chosen tab kept
 * while moving between members, lore opening in the Lore tab, and the
 * Timeline drawn from the workspace's own scenes.
 *
 * ⚠ The chosen tab is module state of `CastWorkspace` and so outlives each
 * mount: every test picks the tab it starts from rather than assuming one.
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
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID
} from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import CastWorkspaceFixture from "../CastWorkspaceFixture.svelte"
import { staticBookData } from "../bookData.svelte"

const BOOK = 5
const VERITY = 10
const OREN = 11

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

const MEMBERS = [
	{
		id: VERITY,
		name: "Verity",
		binding: "{{char:1}}",
		characterId: null,
		character: null
	},
	{
		id: OREN,
		name: "Oren",
		binding: "{{char:2}}",
		characterId: null,
		character: null
	}
]
const HISTORY = [
	{
		id: 101,
		lorebookId: BOOK,
		typeId: HISTORY_TYPE_ID,
		branchId: null,
		name: "The fire",
		year: 3
	},
	{
		id: 102,
		lorebookId: BOOK,
		typeId: HISTORY_TYPE_ID,
		branchId: null,
		name: "The arrival",
		year: 1
	}
]
const LORE = [
	{
		id: 201,
		lorebookId: BOOK,
		typeId: CHARACTER_LORE_TYPE_ID,
		branchId: null,
		lorebookBindingId: VERITY,
		name: "Her debt",
		content: "She owes the guild.",
		keys: [],
		enabled: true
	}
]
const SCENES = [
	{
		id: 301,
		historyEntryId: 101,
		name: "Smoke",
		participantCharacters: [VERITY]
	},
	{
		id: 302,
		historyEntryId: 102,
		name: "Docks",
		participantCharacters: [VERITY, OREN]
	},
	{
		id: 303,
		historyEntryId: 101,
		name: "Not hers",
		participantCharacters: [OREN]
	}
]

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
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

async function mountMember(castId: number, entryId?: number) {
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId, entryId })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				cast: MEMBERS as any,
				rawRows: {
					[HISTORY_TYPE_ID]: HISTORY as any,
					[CHARACTER_LORE_TYPE_ID]: LORE as any
				},
				scenes: SCENES as any
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line: lineOf(null, [])
		}
	})
	await settle()
}

const tabs = () => [
	...document.querySelectorAll<HTMLButtonElement>(
		'[data-cast-member-page] [role="tab"]'
	)
]
const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const selectedTab = () =>
	tabs().find((t) => t.getAttribute("aria-selected") === "true")
const tab = (label: RegExp) => {
	const found = tabs().find((t) => label.test(text(t)))
	if (!found)
		throw new Error(
			`no tab ${label}; tabs: ${JSON.stringify(tabs().map(text))}; page: ${text(document.body).slice(0, 300)}`
		)
	return found
}
const panel = (value: string) =>
	document.getElementById(`cast-member-${value}`) as HTMLElement

async function pick(label: RegExp) {
	tab(label).click()
	await settle()
}

describe("the Cast member page's tabs", () => {
	test("four tabs, with the lore and relationship counts, and one panel on show", async () => {
		await mountMember(VERITY)
		await pick(/^Member/)
		expect(tabs().map(text)).toEqual([
			"Member",
			"Lore 1",
			"Relationships 0",
			"Timeline"
		])
		expect(panel("member").hidden).toBe(false)
		for (const other of ["lore", "relationships", "timeline"])
			expect(panel(other).hidden, other).toBe(true)
	})

	test("the chosen tab is kept when another member is opened", async () => {
		await mountMember(VERITY)
		await pick(/^Relationships/)
		loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: OREN })
		await settle()
		expect(text(document.querySelector("[data-cast-member-page] h3"))).toBe(
			"Oren"
		)
		expect(text(selectedTab())).toMatch(/^Relationships/)
		expect(panel("relationships").hidden).toBe(false)
	})

	test("the Timeline lists the scenes they are in, oldest first, and opens one under Scenes", async () => {
		await mountMember(VERITY)
		await pick(/^Timeline/)
		const rows = [
			...panel("timeline").querySelectorAll<HTMLButtonElement>(
				"[data-cast-scene]"
			)
		]
		expect(rows.map((r) => Number(r.dataset.castScene))).toEqual([302, 301])
		rows[0].click()
		await settle()
		expect(loreRoute.route).toMatchObject({
			scope: "scenes",
			entryId: 102,
			sceneId: 302
		})
		expect(loreRoute.route.castId).toBeUndefined()
	})

	test("lore opened from the member lands on the Lore tab, the editor in place of the list", async () => {
		await mountMember(VERITY)
		await pick(/^Member/)
		;(
			panel("lore").querySelector(
				"[data-cast-lore-row]"
			) as HTMLButtonElement
		).click()
		await settle()
		expect(loreRoute.route.entryId).toBe(201)
		expect(text(selectedTab())).toMatch(/^Lore/)
		const back = panel("lore").querySelector(
			'button[aria-label="Back to Verity\'s lore"]'
		)
		expect(back).not.toBeNull()
		expect(panel("lore").querySelector("[data-cast-lore-row]")).toBeNull()
	})

	test("Pinned and Off are the lore editor's ⋯ toggles, not the Advanced fold's", async () => {
		await mountMember(VERITY, 201)
		const lore = panel("lore")
		// The fold is there (its regex switch), and the marks are not in it.
		expect(lore.querySelector('[name="cleRegex"]')).not.toBeNull()
		expect(lore.querySelector('[name="clePinned"]')).toBeNull()
		expect(lore.querySelector('[name="cleOff"]')).toBeNull()
		;(
			lore.querySelector(
				'button[aria-label="More actions for this lore"]'
			) as HTMLButtonElement
		).click()
		await settle()
		const pinned = document.querySelector(
			'[data-lore-mark="pinned"]'
		) as HTMLButtonElement
		const off = document.querySelector(
			'[data-lore-mark="off"]'
		) as HTMLButtonElement
		expect(pinned.getAttribute("aria-pressed")).toBe("false")
		expect(off.getAttribute("aria-pressed")).toBe("false")
		pinned.click()
		off.click()
		await settle()
		expect(pinned.getAttribute("aria-pressed")).toBe("true")
		expect(off.getAttribute("aria-pressed")).toBe("true")
	})
})
