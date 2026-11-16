/**
 * 🚧 The entry form's Edit history: a closed fold with the count, rows with
 * who / cause / time / changes, Restore, and the ⋯ menu's Clear edit history…
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
vi.mock(
	"$lib/client/components/lorebookForms/LoreContentField.svelte",
	async () => ({
		default: (await import("../EntryEarmarkContentFixture.svelte")).default
	})
)

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import LorebooksWorkspace from "../LorebooksWorkspace.svelte"
import EditHistory from "./EditHistory.svelte"

const BOOK = 5
const ENTRY = 1
const VERITY = 10
const LORE = 201

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
let close: (() => void) | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	close?.()
	close = null
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

const sent = (event: string) => client.emits.filter((e) => e.event === event)
const earmark = (entryId: number, notice: string | null) =>
	client.dispatch("entries:earmark", { entryId, lorebookId: BOOK, notice })

const row = {
	id: ENTRY,
	lorebookId: BOOK,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	name: "Harbor",
	content: "A grey harbor.",
	keys: [],
	enabled: true
}

async function openEntry() {
	loreRoute.set({ lorebookId: BOOK, scope: "all", entryId: ENTRY } as any)
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
			["userSettingsCtx", { settings: { showAdvancedControls: false } }]
		]),
		props: {}
	})
	await settle()
	client.dispatch("lorebooks:list", {
		lorebookList: [
			{ id: BOOK, name: "Book", userId: 1, timelineEnabled: false }
		]
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
		entryList: [row]
	})
	await settle()
	await new Promise((r) => setTimeout(r, 300))
	await settle()
}

const LONG = "A grey harbor.\n".repeat(20)
const redlines = (over: Record<string, unknown> = {}) => ({
	entryId: ENTRY,
	lorebookId: BOOK,
	canRestore: true,
	canClear: true,
	redlines: [
		{
			id: 31,
			amendmentId: null,
			version: null,
			cause: "save",
			who: "You",
			mine: true,
			at: new Date(Date.now() - 5 * 60_000).toISOString(),
			changes: [
				{
					key: "name",
					label: "Name",
					before: "Hobor",
					after: "Harbor",
					wasAbsent: false,
					nowAbsent: false
				},
				{
					key: "content",
					label: "Content",
					before: LONG,
					after: "x",
					wasAbsent: false,
					nowAbsent: false
				}
			]
		},
		{
			id: 30,
			amendmentId: 4,
			version: "the change from Year 7",
			cause: "routine",
			who: "Scribe in Tavern night",
			mine: false,
			at: new Date(Date.now() - 3 * 3600_000).toISOString(),
			changes: [
				{
					key: "keys",
					label: "Keys",
					before: ["a"],
					after: ["a", "b"],
					wasAbsent: false,
					nowAbsent: false
				}
			]
		},
		{
			id: 29,
			amendmentId: null,
			version: null,
			cause: "save",
			who: "Ana",
			mine: false,
			at: new Date(Date.now() - 86400_000 * 3).toISOString(),
			changes: []
		}
	],
	...over
})
const send = (res: unknown) => client.dispatch("entries:redlines", res)
const fold = () =>
	document.querySelector<HTMLButtonElement>(
		'[data-testid="edit-history"] > button'
	)
const text = (sel = '[data-testid="edit-history"]') =>
	document.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const byText = (re: RegExp) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
		re.test(b.textContent?.trim() ?? "")
	)
async function openFold() {
	fold()!.click()
	await settle()
}
async function openMenu() {
	document
		.querySelector<HTMLButtonElement>(
			'button[aria-label="More actions for this entry"]'
		)!
		.click()
	await settle()
}
const CLEAR = /^Clear edit history…$/

describe("the entry form's Edit history", () => {
	test("asks for the list, and an entry with no edits draws no fold", async () => {
		await openEntry()
		expect(sent("entries:redlines")[0]!.payload).toEqual({ entryId: ENTRY })
		send(redlines({ redlines: [] }))
		await settle()
		expect(fold()).toBeNull()
	})

	test("the fold is closed on load and names the count", async () => {
		await openEntry()
		send(redlines())
		await settle()
		expect(fold()!.textContent!.trim()).toBe("Edit history · 3 edits")
		expect(fold()!.getAttribute("aria-expanded")).toBe("false")
		expect(document.querySelector("[data-redline-id]")).toBeNull()
	})

	test("a row shows who, cause, time, version and a short change", async () => {
		await openEntry()
		send(redlines())
		await settle()
		await openFold()
		const first = text("[data-redline-id='31']")
		expect(first).toContain("You")
		expect(first).toContain("Saved")
		expect(first).toContain("5 minutes ago")
		expect(first).toContain("Name: Hobor → Harbor")
		const second = text("[data-redline-id='30']")
		expect(second).toContain("Scribe in Tavern night")
		expect(second).toContain("Wrote")
		expect(second).toContain("On the change from Year 7")
		expect(second).toContain("Keys: a → a, b")
		const when = document.querySelector(
			"[data-redline-id='31'] [title]:not(button)"
		)!
		expect(when.getAttribute("title")!.length).toBeGreaterThan(0)
	})

	test("a long change sits behind Show, which reveals Before and After", async () => {
		await openEntry()
		send(redlines())
		await settle()
		await openFold()
		const show = byText(/^Show$/)!
		expect(show.getAttribute("aria-expanded")).toBe("false")
		expect(text("[data-redline-id='31']")).not.toContain("Before")
		show.click()
		await settle()
		const row = text("[data-redline-id='31']")
		expect(row).toContain("Before")
		expect(row).toContain("After")
		expect(byText(/^Hide$/)!.getAttribute("aria-expanded")).toBe("true")
	})

	test("Restore sends the row's id; a refusal reads inline", async () => {
		await openEntry()
		send(redlines())
		await settle()
		await openFold()
		document
			.querySelector<HTMLButtonElement>(
				"[data-redline-id='30'] button[title]"
			)!
			.click()
		await settle()
		expect(sent("entries:restoreRedline")[0]!.payload).toEqual({
			redlineId: 30
		})
		client.dispatch("entries:restoreRedline:error", {
			redlineId: 30,
			error: "Key moved on."
		})
		await settle()
		const alert = document.querySelector(
			"[data-redline-id='30'] [role='alert']"
		)
		expect(alert?.textContent?.trim()).toBe("Key moved on.")
		expect(
			document.querySelector("[data-redline-id='31'] [role='alert']")
		).toBeNull()
	})

	test("Restore is not drawn when canRestore is false", async () => {
		await openEntry()
		send(redlines({ canRestore: false }))
		await settle()
		await openFold()
		expect(byText(/^Restore$/)).toBeUndefined()
	})

	test("the ⋯ item names the count and confirming clears the entry's history", async () => {
		await openEntry()
		send(redlines())
		await settle()
		await openMenu()
		byText(CLEAR)!.click()
		await settle()
		const dialog = text('[data-testid="clear-edit-history-dialog"]')
		expect(dialog).toContain("Removes its 3 edits.")
		byText(/^Clear edit history$/)!.click()
		await settle()
		expect(sent("entries:clearRedlines")[0]!.payload).toEqual({
			entryId: ENTRY
		})
		client.dispatch("entries:clearRedlines", {
			lorebookId: BOOK,
			entryId: ENTRY,
			cleared: 3
		})
		send(redlines({ redlines: [] }))
		await settle()
		expect(
			document
				.querySelector('[data-testid="clear-edit-history-dialog"]')
				?.getAttribute("data-state") ?? "closed"
		).toBe("closed")
		expect(fold()).toBeNull()
	})

	test("the ⋯ item is not drawn without canClear or without edits", async () => {
		await openEntry()
		send(redlines({ canClear: false }))
		await settle()
		await openMenu()
		expect(byText(CLEAR)).toBeUndefined()
		send(redlines({ canClear: true, redlines: [] }))
		await settle()
		expect(byText(CLEAR)).toBeUndefined()
	})
})

describe("EditHistory scoped by version", () => {
	const mk = (id: number, amendmentId: number | null) => ({
		id,
		amendmentId,
		version: null,
		cause: "save",
		who: "You",
		mine: true,
		at: new Date(Date.now() - id * 60_000).toISOString(),
		changes: [
			{
				key: "name",
				label: "Name",
				before: "a",
				after: "b",
				wasAbsent: false,
				nowAbsent: false
			}
		]
	})
	const reply = (rows: ReturnType<typeof mk>[]) => ({
		entryId: ENTRY,
		lorebookId: BOOK,
		canRestore: true,
		canClear: true,
		redlines: rows
	})
	const rowIds = () =>
		[...document.querySelectorAll("[data-redline-id]")].map((e) =>
			e.getAttribute("data-redline-id")
		)

	async function mountHistory(extra: Record<string, unknown> = {}) {
		const target = document.createElement("div")
		document.body.append(target)
		const states: Array<{ count: number }> = []
		app = mount(EditHistory, {
			target,
			props: {
				lorebookId: BOOK,
				entryId: ENTRY,
				onState: (s: { count: number }) => states.push(s),
				...extra
			}
		})
		await settle()
		return states
	}

	test("amendmentIds draws only those rows; the reported count stays whole", async () => {
		const states = await mountHistory({
			amendmentIds: [4],
			variant: "rows"
		})
		send(reply([mk(31, null), mk(30, 4), mk(29, 5)]))
		await settle()
		expect(rowIds()).toEqual(["30"])
		expect(states[states.length - 1]!.count).toBe(3)
	})

	test("null selects the entry's own edits", async () => {
		await mountHistory({ amendmentIds: [null], variant: "rows" })
		send(reply([mk(31, null), mk(30, 4)]))
		await settle()
		expect(rowIds()).toEqual(["31"])
	})

	test("rows variant: Restore, no fold button, no dialog; nothing when empty", async () => {
		await mountHistory({ variant: "rows" })
		send(reply([mk(31, null)]))
		await settle()
		expect(rowIds()).toEqual(["31"])
		expect(
			document.querySelector('[data-testid="edit-history"]')
		).toBeNull()
		expect(
			document.querySelector("[aria-controls^='edit-history-body']")
		).toBeNull()
		expect(
			document.querySelector('[data-testid="clear-edit-history-dialog"]')
		).toBeNull()
		expect(
			[...document.querySelectorAll("button")].some(
				(b) => b.textContent?.trim() === "Restore"
			)
		).toBe(true)
		send(reply([]))
		await settle()
		expect(document.body.textContent?.trim()).toBe("")
	})

	test("foldLabel words the fold", async () => {
		await mountHistory({
			amendmentIds: [4],
			foldLabel: (n: number) => `Mine · ${n}`
		})
		send(reply([mk(31, null), mk(30, 4)]))
		await settle()
		expect(
			document
				.querySelector('[data-testid="edit-history"] > button')!
				.textContent!.trim()
		).toBe("Mine · 1")
	})
})
