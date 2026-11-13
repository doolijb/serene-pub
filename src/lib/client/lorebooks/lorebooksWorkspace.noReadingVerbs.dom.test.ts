/**
 * No book is read into, or stopped reading from, a session here (owner
 * 2026-11-08 B-5): a session keeps the lorebook it started with. With an
 * owned session open on the book, nothing offers the verbs.
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
import { FOLD_CONFIRM, FOLD_LABEL } from "$lib/shared/lorebooks/sessionNotes"
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

async function open(openSession: object, settings = false) {
	loreRoute.set({ lorebookId: BOOK, scope: "all", settings } as any)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LorebooksWorkspace, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			["openSessionCtx", openSession],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }]
		]),
		props: {}
	})
	await settle()
	client.dispatch("lorebooks:list", {
		lorebookList: [
			{ id: BOOK, name: "Book", userId: 1 },
			{ id: 6, name: "Other", userId: 1 }
		]
	})
	await settle()
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
const titles = () =>
	[...document.querySelectorAll("[title]")]
		.map((el) => el.getAttribute("title") ?? "")
		.join(" | ")
const verbs =
	/Read into this session|Stop reading|Read this book into|Open a session you own/

describe("the lorebook workspace with an owned session open", () => {
	test("the book the session reads has no Stop reading", async () => {
		await open({
			sessionId: 9,
			sessionName: "Crawl",
			lorebookId: BOOK,
			isOwner: true
		})
		expect(verbs.test(text())).toBe(false)
		expect(verbs.test(titles())).toBe(false)
		expect(document.querySelector("[data-lore-book-reading]")).toBeNull()
	})

	test("another book has no Read into this session", async () => {
		await open({
			sessionId: 9,
			sessionName: "Crawl",
			lorebookId: 6,
			isOwner: true
		})
		expect(verbs.test(text())).toBe(false)
		expect(verbs.test(titles())).toBe(false)
		expect(document.querySelector("[data-lore-book-reading]")).toBeNull()
	})

	test("Book settings still says who reads the book, with no action and no invitation", async () => {
		await open(
			{
				sessionId: 9,
				sessionName: "Crawl",
				lorebookId: BOOK,
				isOwner: true
			},
			true
		)
		expect(text().includes("Reading into a session")).toBe(true)
		expect(verbs.test(text())).toBe(false)
	})
})

describe("Merge ‹book› into these notes, in the Session notes row's menu (★B-2)", () => {
	async function menuOf(opts: { attached: boolean; sharedWithMe?: boolean }) {
		loreRoute.set({
			lorebookId: BOOK,
			scope: "all",
			settings: false
		} as any)
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
			lorebookList: [{ id: 6, name: "Other", userId: 1 }]
		})
		client.dispatch("lorebooks:sessionNotes", {
			books: [
				{
					id: BOOK,
					name: "Book",
					userId: 1,
					isSharedWithMe: opts.sharedWithMe === true,
					sessionId: 9,
					sessionName: "Crawl",
					attached: opts.attached
						? { id: 20, name: "Brackenvale" }
						: null
				}
			]
		})
		await settle()
		const trigger = document.querySelector<HTMLButtonElement>(
			"button[aria-label='Book options']"
		)
		if (!trigger) return []
		trigger.click()
		await settle()
		return [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
	}
	const labels = (items: HTMLElement[]) =>
		items.map((el) => el.textContent?.trim() ?? "")

	test("the owner of a row that sits on a book sees it, is asked, and confirming emits", async () => {
		const items = await menuOf({ attached: true })
		expect(labels(items)).toContain(FOLD_LABEL("Brackenvale"))
		expect(labels(items).some((l) => /clone/i.test(l))).toBe(false)
		const item = items.find(
			(el) => el.textContent?.trim() === FOLD_LABEL("Brackenvale")
		)!
		item.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "mouse"
			})
		)
		item.click()
		await new Promise((r) => setTimeout(r, 50))
		flushSync()
		await tick()
		const dialog = document.querySelector("[data-action-confirm]")!
		expect(dialog.textContent).toContain(FOLD_CONFIRM("Brackenvale"))
		const confirm = [...dialog.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === FOLD_LABEL("Brackenvale")
		)!
		confirm.click()
		expect(client.emits).toContainEqual({
			event: "sessions:foldInParent",
			payload: { sessionId: 9 }
		})
	})

	test("a row of notes on no book has no Merge", async () => {
		const items = await menuOf({ attached: false })
		expect(items.length).toBeGreaterThan(0)
		expect(labels(items).some((l) => /^Merge /.test(l))).toBe(false)
		expect(labels(items).some((l) => /clone/i.test(l))).toBe(false)
	})

	test("a book that is not the reader's own has no Merge", async () => {
		const items = await menuOf({ attached: true, sharedWithMe: true })
		expect(labels(items).some((l) => /^Merge /.test(l))).toBe(false)
	})
})
