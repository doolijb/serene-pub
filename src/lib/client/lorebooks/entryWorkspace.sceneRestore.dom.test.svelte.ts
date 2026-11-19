/**
 * 🚧 A scene's Save, then a Restore, then a Save: the form is clean after each
 * answer, Restore shows the restored cast, and the last Save never writes the
 * list that Restore replaced.
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
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { staticBookData } from "./bookData.svelte"
import { emptyFilters } from "./poolFilter"
import { SECTION_DESCRIPTORS, bookPoolItems } from "./sections"
import { openBookTime } from "./time/bookTime.svelte"
import EntryWorkspaceFixture from "./EntryWorkspaceFixture.svelte"

type Listener = (payload: any) => void

const BOOK = 5

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
	openBookTime.setBranches(BOOK, [])
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

const sceneRow = () => ({
	id: 8,
	lorebookId: BOOK,
	branchId: null,
	name: "At the quay",
	summary: "Rain.",
	sceneLock: false,
	position: 1,
	participantCharacters: [1, 2],
	mentionedCharacters: [3],
	updatedAt: "2026-11-17T00:00:00.000Z"
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

// The workspace patches a saved scene into the rows every lens reads.
let scenes: any[] = $state([])
function heard(scene: Record<string, unknown>) {
	scenes = scenes.map((s) => (s.id === scene.id ? { ...s, ...scene } : s))
	client.dispatch("scenes:update", { scene })
}

async function open() {
	scenes = [sceneRow()]
	const rawRows: Record<string, unknown[]> = {}
	for (const door of SECTION_DESCRIPTORS)
		if (door.kind && door.store === "entries") rawRows[door.kind] = []
	const descriptor = SECTION_DESCRIPTORS.find((d) => d.id === "all")!
	loreRoute.set({ lorebookId: BOOK, scope: "all", sceneId: 8 } as any)
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				bookAccess: "owner",
				rawRows: rawRows as any,
				rows: rawRows as any,
				scenes: scenes as any,
				allScenes: scenes as any
			}) as any
	)
	;(data as any).loaded = () => true
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(EntryWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			["openSessionCtx", { sessionId: null, lorebookId: null, isOwner: false }],
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
			bookPool: bookPoolItems(rawRows as any, scenes as any),
			bookLinks: [],
			amendmentsFor: () => [],
			line: lineOf(null, []),
			mode: "desk",
			hasUnsavedChanges: false,
			lens: "list",
			filters: emptyFilters(),
			readInKeys: null,
			decisions: null,
			focusField: null,
			onFilters: () => {}
		}
	})
	await settle()
}

const sent = (event: string) => client.emits.filter((e) => e.event === event)
const norm = (s: string | null | undefined) =>
	s?.replace(/\s+/g, " ").trim() ?? ""
const saveState = () =>
	norm(document.body.querySelector("[data-lore-save-state]")?.textContent)
const removers = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].filter(
		(b) => b.getAttribute("aria-label")?.startsWith("Remove ")
	)
const saveButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => norm(b.textContent) === "Save"
	)!
const restoreButton = () =>
	document.body.querySelector<HTMLButtonElement>(
		"[data-redline-id='40'] button[title]"
	)!

async function showHistory() {
	client.dispatch("scenes:redlines", {
		sceneId: 8,
		lorebookId: BOOK,
		canRestore: true,
		redlines: [
			{
				id: 40,
				amendmentId: null,
				version: null,
				cause: "save",
				who: "You",
				mine: true,
				at: new Date().toISOString(),
				changes: [
					{
						key: "participantCharacters",
						label: "Present",
						before: [1, 2],
						after: [1],
						wasAbsent: false,
						nowAbsent: false
					}
				]
			}
		]
	})
	await settle()
	const fold = document.querySelector<HTMLButtonElement>(
		'[data-testid="edit-history"] > button'
	)!
	if (fold.getAttribute("aria-expanded") !== "true") fold.click()
	await settle()
}

describe("a scene's Save, Restore, Save", () => {
	test("the restored cast is what the form holds and what the next Save sends", async () => {
		await open()
		expect(removers()).toHaveLength(3)
		removers()[1].click()
		await settle()
		expect(saveState()).toBe("Unsaved changes")

		saveButton().click()
		await settle()
		expect(sent("scenes:update")[0].payload.scene.participantCharacters).toEqual([1])
		heard({ ...sceneRow(), participantCharacters: [1], updatedAt: "t1" })
		await settle()
		expect(saveState()).toBe("Saved")
		expect(removers()).toHaveLength(2)

		await showHistory()
		expect(restoreButton().disabled).toBe(false)
		restoreButton().click()
		await settle()
		expect(sent("scenes:restoreRedline")).toHaveLength(1)
		heard({ ...sceneRow(), participantCharacters: [1, 2], updatedAt: "t2" })
		client.dispatch("scenes:restoreRedline", {
			redlineId: 40,
			sceneId: 8,
			lorebookId: BOOK
		})
		await settle()
		expect(removers()).toHaveLength(3)
		expect(saveState()).toBe("Saved")

		const textarea = document.body.querySelector("textarea")!
		textarea.value = "Rain, later."
		textarea.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		saveButton().click()
		await settle()
		const saves = sent("scenes:update")
		expect(saves).toHaveLength(2)
		expect(saves[1].payload.scene.participantCharacters).toEqual([1, 2])
	})
})
