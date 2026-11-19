/**
 * The Lorebooks view's Session notes section (owner 2026-11-13): only notes with
 * something written are drawn, collapsed, each by its session's current name; an
 * unwritten notes book is not listed but still opens by id, named *‹session›'s notes*.
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
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(_event: string, _payload: any) {},
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

const notes = (id: number, sessionName: string | null, written: boolean) => ({
	id,
	name: `stored ${id}`,
	userId: 1,
	sessionId: id * 10,
	sessionName,
	attached: null,
	notesWritten: written
})

async function open(
	lorebookId: number | null = null,
	attached: { access: "owner" | "shared" } | null = null
) {
	loreRoute.set({ lorebookId, scope: "all", settings: false } as any)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LorebooksWorkspace, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			["openSessionCtx", {}],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }]
		]),
		props: {}
	})
	await settle()
	client.dispatch("lorebooks:list", {
		lorebookList: [
			{
				id: 1,
				name: "Real book",
				userId: 1,
				...(attached ? { bookAccess: attached.access } : {})
			}
		]
	})
	client.dispatch("lorebooks:sessionNotes", {
		books: [
			{
				...notes(2, "Rainy night", true),
				attached: attached ? { id: 1, name: "Real book" } : null
			},
			notes(3, "Quiet harbour", false)
		]
	})
	await settle()
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
const heading = () =>
	document.querySelector<HTMLButtonElement>("#loreSessionNotes button")

describe("the Session notes section", () => {
	test("written rows sit under a collapsed heading and open on click", async () => {
		await open()
		expect(heading()?.getAttribute("aria-expanded")).toBe("false")
		expect(text()).not.toContain("Rainy night")
		heading()!.click()
		await settle()
		expect(heading()?.getAttribute("aria-expanded")).toBe("true")
		expect(text()).toContain("Rainy night")
	})

	test("an unwritten row never draws, and the row title is the session's current name", async () => {
		await open()
		heading()!.click()
		await settle()
		expect(text()).not.toContain("Quiet harbour")
		expect(text()).not.toContain("stored 2")
	})

	test("a search for the session name shows the section open with the row", async () => {
		await open()
		const input = document.querySelector<HTMLInputElement>(
			"input[type=search], input[type=text]"
		)!
		input.value = "rainy"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		expect(heading()?.getAttribute("aria-expanded")).toBe("true")
		expect(text()).toContain("Rainy night")
	})

	test("a route to an unwritten notes book's id opens it, named by its session", async () => {
		await open(3)
		expect(text()).toContain("Quiet harbour's notes")
		expect(text()).not.toContain("stored 3")
	})

	test.each([
		["owner", true],
		["shared", false]
	] as const)(
		"Share to the attached book is offered only when it is the viewer's own (%s)",
		async (access, offered) => {
			await open(null, { access })
			heading()!.click()
			await settle()
			const trigger = document.querySelector<HTMLButtonElement>(
				"#loreSessionNotesList button[aria-label='Lorebook options']"
			)
			trigger!.click()
			await settle()
			expect(text().includes("Share to Real book")).toBe(offered)
			expect(text()).toContain("Merge")
		}
	)
})
