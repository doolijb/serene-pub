/**
 * (m3b-F) A provided book sits under **Ready-made**, not **Shared with you**,
 * and its open header says whose it comes with.
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
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import LorebooksWorkspace from "./LorebooksWorkspace.svelte"

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
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const LIST = [
	{ id: 1, name: "Own Book", userId: 1 },
	{
		id: 2,
		name: "Ada Book",
		userId: 2,
		isSharedWithMe: true,
		ownerName: "Ada",
		bookAccess: "shared"
	},
	{
		id: 3,
		name: "Mundi Book",
		userId: 9,
		isSharedWithMe: true,
		ownerName: "admin",
		bookAccess: "shared",
		provided: { disabled: false, pluginName: "Mundi" }
	}
]

async function mountList() {
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
	client.dispatch("lorebooks:list", { lorebookList: LIST })
	await settle()
}

/** The text of the list a group label names ("" when there is none). */
const groupText = (label: string) => {
	const id = [...document.querySelectorAll("[id]")].find(
		(el) => el.textContent?.trim() === label
	)?.id
	const list = id
		? document.querySelector(`[role="list"][aria-labelledby="${id}"]`)
		: null
	return (list?.textContent ?? "").replace(/\s+/g, " ")
}

describe("a provided book in the Lorebooks list (m3b-F)", () => {
	test("sits under Ready-made, not Shared with you", async () => {
		await mountList()
		const ready = groupText("Ready-made")
		const shared = groupText("Shared with you")
		expect(ready.includes("Mundi Book")).toBe(true)
		// The row's own line (LorebookListItem) says who the book comes with, not who enabled it.
		expect(ready.includes("Comes with Mundi")).toBe(true)
		expect(ready.includes("From admin")).toBe(false)
		expect(ready.includes("Ada Book")).toBe(false)
		expect(shared.includes("Ada Book")).toBe(true)
		expect(shared.includes("Mundi Book")).toBe(false)
	})

	test("opened, it reads Comes with the plugin, not Shared by the admin", async () => {
		loreRoute.set({ lorebookId: 3, scope: "all" } as any)
		await mountList()
		client.dispatch("lorebooks:bindingList", {
			lorebookId: 3,
			lorebookBindingList: []
		})
		await settle()
		const line = (
			document.querySelector("[data-lore-shared]")?.textContent ?? ""
		)
			.replace(/\s+/g, " ")
			.trim()
		expect(line).toBe("Comes with Mundi · read only")
		expect(line.includes("Shared by")).toBe(false)
	})
})
