/**
 * 🚧 The Locked toggle in the editor: an entry's or a scene's, written at
 * once, never part of the draft. A reader who cannot edit the row sees a line
 * when it is locked and no button.
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

const entryRow = (entryLock: boolean) => ({
	id: 21,
	lorebookId: BOOK,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	name: "Harbor",
	content: "A grey harbor.",
	keys: [],
	enabled: true,
	entryLock
})
const sceneRow = (sceneLock: boolean) => ({
	id: 8,
	lorebookId: BOOK,
	branchId: null,
	name: "At the quay",
	summary: "Rain.",
	sceneLock,
	position: 1,
	participantCharacters: [],
	mentionedCharacters: []
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function open(
	routeExtra: Record<string, unknown>,
	over: { entryLock?: boolean; sceneLock?: boolean; bookAccess?: string } = {}
) {
	const rawRows: Record<string, unknown[]> = {}
	for (const door of SECTION_DESCRIPTORS)
		if (door.kind && door.store === "entries") rawRows[door.kind] = []
	rawRows[WORLD_LORE_TYPE_ID] = [entryRow(over.entryLock ?? false)]
	const scenes = [sceneRow(over.sceneLock ?? false)]
	const descriptor = SECTION_DESCRIPTORS.find((d) => d.id === "all")!
	loreRoute.set({ lorebookId: BOOK, scope: "all", ...routeExtra } as any)
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				bookAccess: over.bookAccess ?? "owner",
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
const lock = () =>
	document.body.querySelector<HTMLButtonElement>('[data-lore-lock]')
const note = () => document.body.querySelector("[data-lore-lock-note]")
const norm = (s: string | null | undefined) =>
	s?.replace(/\s+/g, " ").trim() ?? ""

describe("the Locked toggle on an entry", () => {
	test("is unpressed on an unlocked entry, with its one sentence named by the button", async () => {
		await open({ entryId: 21 })
		const b = lock()!
		expect(!!b).toBe(true)
		expect(b.getAttribute("aria-pressed")).toBe("false")
		expect(norm(b.textContent)).toBe("Locked")
		expect(
			norm(
				document.getElementById(b.getAttribute("aria-describedby")!)
					?.textContent
			)
		).toBe(
			"Sessions and their routines leave this entry as it is; you can still edit it."
		)
	})

	test("is pressed on a locked entry", async () => {
		await open({ entryId: 21 }, { entryLock: true })
		expect(lock()!.getAttribute("aria-pressed")).toBe("true")
	})

	test("pressing asks entries:setMarks { locked: true } at once, busy until the answer", async () => {
		await open({ entryId: 21 })
		lock()!.click()
		await settle()
		const asks = sent("entries:setMarks")
		expect(asks).toHaveLength(1)
		expect(asks[0].payload).toMatchObject({ entryId: 21, locked: true })
		expect(typeof asks[0].payload.request).toBe("string")
		expect(lock()!.disabled).toBe(true)
		client.dispatch("entries:setMarks", {
			entryId: 21,
			locked: true,
			request: asks[0].payload.request
		})
		await settle()
		expect(lock()!.disabled).toBe(false)
		expect(sent("entries:update")).toHaveLength(0)
	})

	test("unlocking asks locked: false", async () => {
		await open({ entryId: 21 }, { entryLock: true })
		lock()!.click()
		await settle()
		expect(sent("entries:setMarks")[0].payload).toMatchObject({
			entryId: 21,
			locked: false
		})
	})

	test("a refusal is said in place", async () => {
		await open({ entryId: 21 })
		lock()!.click()
		await settle()
		client.dispatch("entries:setMarks:error", {
			entryId: 21,
			error: "Entry not found or access denied.",
			request: sent("entries:setMarks")[0].payload.request
		})
		await settle()
		expect(
			norm(document.body.querySelector('[role="alert"]')?.textContent)
		).toContain("Entry not found or access denied.")
	})

	test("a reader who cannot edit sees the line when it is locked, and no button", async () => {
		await open({ entryId: 21 }, { entryLock: true, bookAccess: "shared" })
		expect(lock()).toBeNull()
		expect(norm(note()?.textContent)).toBe(
			"Locked: sessions and their routines leave it as it is."
		)
	})

	test("a reader who cannot edit sees nothing when it is not locked", async () => {
		await open({ entryId: 21 }, { bookAccess: "shared" })
		expect(lock()).toBeNull()
		expect(note()).toBeNull()
	})
})

describe("the Locked toggle on a scene", () => {
	test("asks scenes:update { scene: { id, sceneLock: true } } with the scene's own sentence", async () => {
		await open({ sceneId: 8 })
		const b = lock()!
		expect(b.getAttribute("aria-pressed")).toBe("false")
		expect(
			norm(
				document.getElementById(b.getAttribute("aria-describedby")!)
					?.textContent
			)
		).toBe(
			"Sessions and their routines leave this scene's summary, notes and cast as they are; you can still edit it."
		)
		b.click()
		await settle()
		const asks = sent("scenes:update")
		expect(asks).toHaveLength(1)
		expect(asks[0].payload.scene).toEqual({ id: 8, sceneLock: true })
	})

	test("is pressed on a locked scene", async () => {
		await open({ sceneId: 8 }, { sceneLock: true })
		expect(lock()!.getAttribute("aria-pressed")).toBe("true")
	})
})
