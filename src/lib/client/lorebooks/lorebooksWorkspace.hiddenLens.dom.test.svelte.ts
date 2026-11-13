/**
 * 🚧 Advanced controls (2026-11-10): a route naming Graph or Lives draws List
 * while the switch is off — the route itself is left alone, so the switch
 * brings the lens back. No navigation, no toast.
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

const row = (id: number, typeId: string) => ({
	id,
	lorebookId: BOOK,
	typeId,
	branchId: null,
	name: `Row ${id}`,
	content: "",
	keys: [],
	enabled: true
})

async function open(
	lens: string,
	ctx: { settings: { showAdvancedControls: boolean } }
) {
	loreRoute.set({ lorebookId: BOOK, scope: "all", lens } as any)
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
			["userCtx", { user: { id: 1, isAdmin: false } }],
			["userSettingsCtx", ctx]
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
	client.dispatch("entries:list", {
		lorebookId: BOOK,
		typeId: WORLD_LORE_TYPE_ID,
		entryList: [row(1, WORLD_LORE_TYPE_ID)]
	})
	await settle()
	await pastWindow()
	await settle()
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
const entriesShown = () => /\d+ entr(?:y|ies)/.exec(text())?.[0] ?? null
// jsdom has no width, so the workspace draws the compact lens popout: its radio rows.
const track = () => [
	...document.querySelectorAll<HTMLElement>('[role="radio"][data-lore-lens]')
]
const pressed = () =>
	track()
		.filter((b) => b.getAttribute("aria-checked") === "true")
		.map((b) => b.dataset.loreLens)

describe("a route naming a hidden lens, with advanced controls off", () => {
	for (const lens of ["graph", "lives"]) {
		test(`${lens} draws List and leaves the route alone`, async () => {
			await open(lens, { settings: { showAdvancedControls: false } })
			expect(entriesShown()).toBe("1 entry")
			expect(track().map((b) => b.dataset.loreLens)).not.toContain(lens)
			expect(pressed()).toEqual(["list"])
			expect(loreRoute.route.lens).toBe(lens)
		})
	}

	test("with the switch on the named lens is the pressed one", async () => {
		await open("graph", { settings: { showAdvancedControls: true } })
		expect(pressed()).toEqual(["graph"])
		expect(loreRoute.route.lens).toBe("graph")
	})

	test("turning the switch on brings the named lens back, no remount", async () => {
		const ctx = $state({ settings: { showAdvancedControls: false } })
		await open("lives", ctx)
		expect(pressed()).toEqual(["list"])
		ctx.settings.showAdvancedControls = true
		await settle()
		expect(pressed()).toEqual(["lives"])
	})
})
