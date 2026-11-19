/**
 * 🚧 Edit history is asked for only by people who can edit the book: a
 * reader of a shared book or a starter is never sent `entries:redlines` or
 * `scenes:redlines`.
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

const entryRow = {
	id: 21,
	lorebookId: BOOK,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	name: "Harbor",
	content: "A grey harbor.",
	keys: [],
	enabled: true
}

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function open(route: Record<string, unknown>, bookAccess: string) {
	const scenes = [
		{
			id: 8,
			lorebookId: BOOK,
			branchId: null,
			name: "At the quay",
			summary: "Rain.",
			sceneLock: false,
			position: 1,
			participantCharacters: [],
			mentionedCharacters: []
		}
	]
	const rawRows: Record<string, unknown[]> = {}
	for (const door of SECTION_DESCRIPTORS)
		if (door.kind && door.store === "entries") rawRows[door.kind] = []
	rawRows[WORLD_LORE_TYPE_ID] = [entryRow]
	const descriptor = SECTION_DESCRIPTORS.find((d) => d.id === "all")!
	loreRoute.set({ lorebookId: BOOK, scope: "all", ...route } as any)
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				bookAccess,
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


const asked = (event: string) =>
	client.emits.filter((e) => e.event === event).length

describe("Edit history requests", () => {
	test("an entry in a book the reader can write asks for its history", async () => {
		await open({ entryId: 21 }, "owner")
		expect(asked("entries:redlines")).toBe(1)
	})

	test("an entry in a read-only book asks for none", async () => {
		await open({ entryId: 21 }, "shared")
		expect(asked("entries:redlines")).toBe(0)
	})

	test("a scene in a book the reader can write asks for its history", async () => {
		await open({ sceneId: 8 }, "owner")
		expect(asked("scenes:redlines")).toBe(1)
	})

	test("a scene in a read-only book asks for none", async () => {
		await open({ sceneId: 8 }, "shared")
		expect(asked("scenes:redlines")).toBe(0)
	})
})
