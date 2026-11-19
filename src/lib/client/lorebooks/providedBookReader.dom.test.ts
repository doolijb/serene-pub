/**
 * A read-only provided lorebook that is not a starter kit is read in the
 * shared-book view (Duplicate, the header line, no edit control): never a
 * primer row (Clone). A starter kit stays a primer row.
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


const PLUGIN_BOOK = {
	id: 4,
	name: "Mundi World",
	kind: "book",
	provided: { disabled: false, pluginName: "Mundi" },
	readOnly: { pluginName: "Mundi" }
}
const PLUGIN_KIT = {
	id: 5,
	name: "Mundi Primer",
	kind: "starter_kit",
	provided: { disabled: false, pluginName: "Mundi" },
	readOnly: { pluginName: "Mundi" }
}

/** The row a person sees for a provided lorebook: the administrator owns it, a member is shown it. */
const rowOf = (base: typeof PLUGIN_BOOK, admin: boolean) =>
	admin
		? { ...base, userId: 1 }
		: { ...base, userId: 9, isSharedWithMe: true, ownerName: "admin", bookAccess: "shared" }

async function mountAs(admin: boolean, list: any[]) {
	setInterestUser({ id: 1, isAdmin: admin })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LorebooksWorkspace, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			["openSessionCtx", { sessionId: null, lorebookId: null, isOwner: false }],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: admin } }]
		]),
		props: {}
	})
	await settle()
	client.dispatch("lorebooks:list", { lorebookList: list })
	await settle()
}

async function openMenu(trigger: Element | null) {
	expect(trigger).toBeTruthy()
	;(trigger as HTMLButtonElement).click()
	await settle()
	return [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].map(
		(el) => el.textContent?.trim() ?? ""
	)
}

for (const admin of [true, false]) {
	const who = admin ? "an administrator" : "a member"
	describe(`a read-only provided lorebook of kind book, for ${who}`, () => {
		test("its list row offers Duplicate, no Clone, no Book settings, no Delete", async () => {
			await mountAs(admin, [rowOf(PLUGIN_BOOK, admin)])
			const row = document.querySelector('[role="list"] [role="listitem"], [role="list"] > *')
			expect(row?.textContent).toContain("Comes with Mundi")
			const labels = await openMenu(
				document.querySelector('button[aria-label="Lorebook options"]')
			)
			expect(labels).toContain("Duplicate")
			expect(labels).not.toContain("Clone")
			expect(labels).not.toContain("Book settings")
			expect(labels).not.toContain("Delete")
		})

		test("opened, it keeps the header line, offers Duplicate, and draws no Clone or edit control", async () => {
			loreRoute.set({ lorebookId: 4, scope: "all" } as any)
			await mountAs(admin, [rowOf(PLUGIN_BOOK, admin)])
			client.dispatch("lorebooks:bindingList", {
				lorebookId: 4,
				lorebookBindingList: []
			})
			await settle()
			const line = (document.querySelector("[data-lore-shared]")?.textContent ?? "")
				.replace(/\s+/g, " ")
				.trim()
			expect(line).toBe("Comes with Mundi · read only")
			expect(document.querySelector("[data-primer-row-clone]")).toBeNull()
			expect(document.querySelector("[data-starter-kit-badge]")).toBeNull()
			const labels = await openMenu(
				document.querySelector('button[aria-label="Mundi World options"]')
			)
			expect(labels).toContain("Duplicate")
			for (const gone of ["Clone", "Book settings", "Delete", "Share"])
				expect(labels).not.toContain(gone)
		})

		test("its Book settings view shows the server's sentence, with no Clone and no field", async () => {
			loreRoute.set({ lorebookId: 4, scope: "all", settings: true } as any)
			await mountAs(admin, [rowOf(PLUGIN_BOOK, admin)])
			const text = document.body.textContent ?? ""
			expect(text).toContain(
				"This lorebook comes with Mundi: make your own copy to change it."
			)
			expect(text).not.toContain("Clone")
			expect(
				document.querySelector("input[type=text]:not(#new-lorebook-name), textarea")
			).toBeNull()
		})
	})
}

describe("a provided starter kit stays a primer row", () => {
	test("its row offers Clone and no Duplicate", async () => {
		await mountAs(true, [{ ...PLUGIN_KIT, userId: 1 }])
		const labels = await openMenu(
			document.querySelector('button[aria-label="Lorebook options"]')
		)
		expect(labels).toContain("Clone")
		expect(labels).not.toContain("Duplicate")
	})

	test("opened, its header has Clone", async () => {
		loreRoute.set({ lorebookId: 5, scope: "all" } as any)
		await mountAs(true, [{ ...PLUGIN_KIT, userId: 1 }])
		expect(document.querySelector("[data-primer-row-clone]")).toBeTruthy()
	})
})

describe("binding suggestions are asked for only by people who can edit the book", () => {
	const asked = () =>
		client.emits.filter((e) => e.event === "bindingSuggestions:list").length

	test("a read-only book asks none", async () => {
		loreRoute.set({ lorebookId: 4, scope: "all" } as any)
		await mountAs(false, [rowOf(PLUGIN_BOOK, false)])
		expect(asked()).toBe(0)
	})

	test("a book the reader owns asks once", async () => {
		loreRoute.set({ lorebookId: 6, scope: "all" } as any)
		await mountAs(false, [
			{ id: 6, name: "Mine", kind: "book", userId: 1, bookAccess: "owner" }
		])
		expect(asked()).toBe(1)
	})
})
