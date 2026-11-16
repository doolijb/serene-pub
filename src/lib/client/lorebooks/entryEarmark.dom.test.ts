/**
 * The earmark notice in the entry forms: asked when an existing entry opens,
 * on Check again and once after a refused save; while it stands every Save is
 * off and a refused save keeps what was typed.
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
		default: (await import("./EntryEarmarkContentFixture.svelte")).default
	})
)

import { setSocket } from "$lib/client/sockets/socketInstance"
import { toaster } from "$lib/client/utils/toaster"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import { BookRelationships } from "./relationships.svelte"
import { staticBookData } from "./bookData.svelte"
import CastWorkspaceFixture from "./CastWorkspaceFixture.svelte"
import LorebooksWorkspace from "./LorebooksWorkspace.svelte"

const BOOK = 5
const ENTRY = 1
const VERITY = 10
const LORE = 201
const SENTENCE =
	"Story sweep in Mira's tavern may update this entry when it finishes. Your changes are kept here: save again then."

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
const askedRequestId = () =>
	(sent("entries:update").at(-1)!.payload as { requestId?: string }).requestId
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
		entryList: [row]
	})
	await settle()
	await new Promise((r) => setTimeout(r, 300))
	await settle()
}

const notice = () =>
	document
		.querySelector("[data-entry-earmark-notice]")
		?.textContent?.replace(/\s+/g, " ")
		.trim() ?? null
const saveButtons = (scope: ParentNode = document) =>
	[...scope.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
		/^\s*(Save|Save & next)\s*$/.test(b.textContent ?? "")
	)
const saveDisabled = (scope: ParentNode = document) => {
	const buttons = saveButtons(scope)
	if (buttons.length === 0) throw new Error("no Save button")
	return buttons.every((b) => b.disabled)
}
const contentField = () =>
	document.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Content"]'
	)!

describe("the entry form", () => {
	test("a sentence on open shows the notice and turns Save off; Check again with null clears it", async () => {
		await openEntry()
		expect(sent("entries:earmark")).toHaveLength(1)
		expect(sent("entries:earmark")[0]!.payload).toEqual({ entryId: ENTRY })
		earmark(ENTRY, SENTENCE)
		await settle()
		expect(notice()?.includes(SENTENCE)).toBe(true)
		expect(saveDisabled()).toBe(true)

		const check = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Check again"
		)!
		check.click()
		await settle()
		expect(sent("entries:earmark")).toHaveLength(2)
		earmark(ENTRY, null)
		await settle()
		expect(notice()).toBeNull()
		expect(saveDisabled()).toBe(false)
	})

	test("an answer for another entry is ignored", async () => {
		await openEntry()
		earmark(99, SENTENCE)
		await settle()
		expect(notice()).toBeNull()
	})

	test("a refused save keeps the typed text, asks once, and shows the notice with Save off", async () => {
		await openEntry()
		earmark(ENTRY, null)
		await settle()
		expect(saveDisabled()).toBe(false)

		const field = contentField()
		field.value = "A grey harbor, now with a lighthouse."
		field.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		saveButtons()[0]!.click()
		await settle()
		expect(sent("entries:update")).toHaveLength(1)

		client.dispatch("entries:update:error", {
			error: SENTENCE,
			requestId: askedRequestId()
		})
		await settle()
		expect(sent("entries:earmark")).toHaveLength(2)
		earmark(ENTRY, SENTENCE)
		await settle()

		expect(contentField().value).toBe(
			"A grey harbor, now with a lighthouse."
		)
		expect(
			document.querySelector('[data-action-confirm][data-state="open"]')
		).toBeNull()
		expect(notice()?.includes(SENTENCE)).toBe(true)
		expect(saveDisabled()).toBe(true)
	})
})

describe("the form's save claims only its own answer", () => {
	async function startSave() {
		await openEntry()
		earmark(ENTRY, null)
		await settle()
		const field = contentField()
		field.value = "A grey harbor, now with a lighthouse."
		field.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		saveButtons()[0]!.click()
		await settle()
		expect(sent("entries:update")).toHaveLength(1)
	}

	test("a bulk run's refusal does not settle it, and its own reply then does", async () => {
		await startSave()
		const mine = askedRequestId()
		expect(typeof mine).toBe("string")
		vi.mocked(toaster.error).mockClear()
		client.dispatch("entries:update:error", {
			error: SENTENCE,
			requestId: "someone-else"
		})
		await settle()
		expect(toaster.error).not.toHaveBeenCalled()
		expect(sent("entries:earmark")).toHaveLength(1)

		client.dispatch("entries:update", {
			entry: { ...row, id: ENTRY },
			requestId: mine
		})
		await settle()
		expect(toaster.success).toHaveBeenCalled()
		expect(toaster.error).not.toHaveBeenCalled()
	})

	test("its own refusal is said by the form", async () => {
		await startSave()
		vi.mocked(toaster.error).mockClear()
		client.dispatch("entries:update:error", {
			error: SENTENCE,
			requestId: askedRequestId()
		})
		await settle()
		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(
			JSON.stringify(vi.mocked(toaster.error).mock.calls[0])
		).toContain(SENTENCE)
	})
})

describe("the cast member's Lore tab", () => {
	test("a sentence on open shows the notice and turns Save off", async () => {
		openBookTime.open(BOOK)
		const store = new BookRelationships(client as any)
		close = store.open(BOOK)
		store.load()
		loreRoute.set({
			lorebookId: BOOK,
			scope: "cast",
			castId: VERITY,
			entryId: LORE
		})
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(CastWorkspaceFixture, {
			target,
			context: new Map<string, unknown>([
				[
					"userSettingsCtx",
					{ settings: { showAdvancedControls: true } }
				]
			]),
			props: {
				store,
				data: staticBookData(() => ({
					lorebookId: BOOK,
					cast: [
						{
							id: VERITY,
							name: "Verity",
							binding: "{{char:1}}",
							characterId: null,
							character: null
						}
					] as any,
					rawRows: {
						[HISTORY_TYPE_ID]: [] as any,
						[CHARACTER_LORE_TYPE_ID]: [
							{
								id: LORE,
								lorebookId: BOOK,
								typeId: CHARACTER_LORE_TYPE_ID,
								branchId: null,
								lorebookBindingId: VERITY,
								name: "Her debt",
								content: "She owes the guild.",
								keys: [],
								enabled: true
							}
						] as any
					}
				})),
				lorebookId: BOOK,
				mode: "desk",
				hasUnsavedChanges: false,
				presences: [],
				line: lineOf(null, [])
			}
		})
		await settle()
		expect(sent("entries:earmark")).toHaveLength(1)
		earmark(LORE, SENTENCE)
		await settle()
		expect(notice()?.includes(SENTENCE)).toBe(true)
		expect(saveDisabled(document.getElementById("cast-member-lore")!)).toBe(
			true
		)
	})
})
