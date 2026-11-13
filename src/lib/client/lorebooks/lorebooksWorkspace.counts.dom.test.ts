/**
 * The rail's Views figures stay live (playtest plan item 9): an update, a
 * re-list cascade, and a reply for a line the reader has left.
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
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import LorebooksWorkspace from "./LorebooksWorkspace.svelte"

const BOOK = 5

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

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	loreRoute.set(emptyRoute())
	openBookTime.open(null)
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
	vi.useRealTimers()
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
/** Past the workspace's counts window, which is a real timer here. */
const pastWindow = () => new Promise((r) => setTimeout(r, 300))

const row = (id: number, typeId: string, extra: object = {}) => ({
	id,
	lorebookId: BOOK,
	typeId,
	branchId: null,
	name: `Row ${id}`,
	content: "",
	keys: [],
	enabled: true,
	...extra
})

async function open(branch?: number) {
	loreRoute.set({ lorebookId: BOOK, scope: "all", branch } as any)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LorebooksWorkspace, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			[
				"openSessionCtx",
				{ sessionId: null, lorebookId: null, isOwner: false }
			],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }]
		]),
		props: {}
	})
	await settle()
	client.dispatch("lorebooks:list", {
		lorebookList: [{ id: BOOK, name: "Book", userId: 1 }]
	})
	client.dispatch("scenes:listByLorebook", {
		lorebookId: BOOK,
		sceneList: []
	})
	client.dispatch("lorebooks:bindingList", {
		lorebookId: BOOK,
		lorebookBindingList: []
	})
	await settle()
	await pastWindow()
	await settle()
}

const countAsks = () => client.emits.filter((e) => e.event === "entries:counts")
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
/** The count line over the open list ("1 entry", "2 entries"). */
const entriesShown = () => /\d+ entr(?:y|ies)/.exec(text())?.[0] ?? null
/** The figure beside a Views label in the rail. */
const figure = (label: string) =>
	new RegExp(`${label}\\s*(\\d+)`).exec(text())?.[1] ?? null

describe("the lorebook rail's Views figures", () => {
	test("an entry that comes back archived asks for the figures again, on the line being read", async () => {
		await open(3)
		const before = countAsks().length
		client.dispatch("entries:update", {
			lorebookId: BOOK,
			entry: row(1, WORLD_LORE_TYPE_ID, { archived: true })
		})
		await settle()
		expect(countAsks().length).toBe(before)
		await pastWindow()
		const asks = countAsks()
		expect(asks.length).toBe(before + 1)
		expect(asks.at(-1)!.payload).toEqual({ lorebookId: BOOK, branchId: 3 })
	})

	test("a change right after a direct ask still asks again; a re-list in that window does not", async () => {
		await open(3)
		const before = countAsks().length
		// Switching line asks at once (a direct ask) …
		loreRoute.set({ lorebookId: BOOK, scope: "all", branch: 5 } as any)
		await settle()
		expect(countAsks().length).toBe(before + 1)
		// … a re-list inside its window adds nothing …
		client.dispatch("entries:list", { lorebookId: BOOK, typeId: WORLD_LORE_TYPE_ID, entryList: [] })
		// … but an update inside it may have moved a figure, so it asks once the window closes.
		client.dispatch("entries:update", { lorebookId: BOOK, entry: row(1, WORLD_LORE_TYPE_ID, { archived: true }) })
		await settle()
		await pastWindow()
		expect(countAsks().length).toBe(before + 2)
	})

	test("a burst of lists, one per type, asks for the figures once", async () => {
		await open()
		const before = countAsks().length
		for (const [i, typeId] of [
			WORLD_LORE_TYPE_ID,
			HISTORY_TYPE_ID,
			"core:entry/location",
			"core:entry/item",
			"core:entry/character"
		].entries())
			client.dispatch("entries:list", {
				lorebookId: BOOK,
				typeId,
				entryList: [row(10 + i, typeId)]
			})
		await settle()
		await pastWindow()
		expect(countAsks().length).toBe(before + 1)
	})

	test("a reply for a line the reader has left is ignored", async () => {
		await open(3)
		client.dispatch("entries:counts", {
			lorebookId: BOOK,
			branchId: 3,
			counts: { [WORLD_LORE_TYPE_ID]: 7 }
		})
		await settle()
		expect(figure("World lore")).toBe("7")
		client.dispatch("entries:counts", {
			lorebookId: BOOK,
			branchId: null,
			counts: { [WORLD_LORE_TYPE_ID]: 99 }
		})
		await settle()
		expect(figure("World lore")).toBe("7")
		client.dispatch("entries:counts", {
			lorebookId: BOOK,
			branchId: 3,
			counts: { [WORLD_LORE_TYPE_ID]: 8 }
		})
		await settle()
		expect(figure("World lore")).toBe("8")
	})

	test("a row whose entry type changed leaves its old list", async () => {
		await open()
		client.dispatch("entries:list", {
			lorebookId: BOOK,
			typeId: HISTORY_TYPE_ID,
			entryList: [row(1, HISTORY_TYPE_ID, { name: "Wanderer" })]
		})
		client.dispatch("entries:list", {
			lorebookId: BOOK,
			typeId: WORLD_LORE_TYPE_ID,
			entryList: []
		})
		await settle()
		expect(entriesShown()).toBe("1 entry")
		client.dispatch("entries:update", {
			lorebookId: BOOK,
			entry: row(1, WORLD_LORE_TYPE_ID, { name: "Wanderer" })
		})
		await settle()
		expect(entriesShown()).toBe("1 entry")
	})

	test("a row re-typed into a list not loaded yet stays unlisted until it loads", async () => {
		await open()
		client.dispatch("entries:list", {
			lorebookId: BOOK,
			typeId: HISTORY_TYPE_ID,
			entryList: [row(1, HISTORY_TYPE_ID, { name: "Wanderer" })]
		})
		await settle()
		client.dispatch("entries:update", {
			lorebookId: BOOK,
			entry: row(1, WORLD_LORE_TYPE_ID, { name: "Wanderer" })
		})
		await settle()
		// The server's list decides what belongs; a one-row list would read
		// as "loaded" and would let an archived row back in the same way.
		expect(entriesShown()).toBe("0 entries")
	})
})
