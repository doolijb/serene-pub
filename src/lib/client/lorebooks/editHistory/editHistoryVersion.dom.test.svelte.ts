/**
 * 🚧 The Edit history fold for a card version or a cast version: the same
 * fold as an entry's, asked and answered on `characterVersions:*`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
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
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import EditHistory from "./EditHistory.svelte"

const VERSION = 7

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
let props: { characterVersionId: number; restoreBlocked?: string }

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
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

async function mountFold(over: Partial<typeof props> = {}) {
	const live = $state({ characterVersionId: VERSION, ...over })
	props = live
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(EditHistory, { target, props })
	await settle()
}

const change = (over: Record<string, unknown> = {}) => ({
	key: "name",
	label: "Name",
	before: "Hobor",
	after: "Harbor",
	wasAbsent: false,
	nowAbsent: false,
	...over
})
const redlines = (over: Record<string, unknown> = {}) => ({
	characterVersionId: VERSION,
	cardId: 3,
	lorebookId: null,
	canRestore: true,
	canClear: true,
	redlines: [31, 30, 29].map((id) => ({
		id,
		amendmentId: null,
		version: null,
		cause: "save",
		who: "You",
		mine: true,
		at: new Date(Date.now() - id * 60_000).toISOString(),
		changes: [change()]
	})),
	...over
})
const send = (res: unknown) =>
	client.dispatch("characterVersions:redlines", res)
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

describe("a version's Edit history", () => {
	test("asks for the version's list; no edits draws no fold", async () => {
		await mountFold()
		expect(sent("characterVersions:redlines")[0]!.payload).toEqual({
			characterVersionId: VERSION
		})
		send(redlines({ redlines: [] }))
		await settle()
		expect(fold()).toBeNull()
	})

	test("the closed fold names the count", async () => {
		await mountFold()
		send(redlines())
		await settle()
		expect(fold()!.textContent!.trim()).toBe("Edit history · 3 edits")
		expect(fold()!.getAttribute("aria-expanded")).toBe("false")
	})

	test("another version's reply is ignored", async () => {
		await mountFold()
		send(redlines({ characterVersionId: 99 }))
		await settle()
		expect(fold()).toBeNull()
	})

	test("Restore sends the row's id; a refusal reads inline", async () => {
		await mountFold()
		send(redlines())
		await settle()
		await openFold()
		document
			.querySelector<HTMLButtonElement>(
				"[data-redline-id='30'] button[title]"
			)!
			.click()
		await settle()
		expect(sent("characterVersions:restoreRedline")[0]!.payload).toEqual({
			redlineId: 30
		})
		client.dispatch("characterVersions:restoreRedline:error", {
			redlineId: 30,
			error: "Name is taken."
		})
		await settle()
		expect(
			document
				.querySelector("[data-redline-id='30'] [role='alert']")
				?.textContent?.trim()
		).toBe("Name is taken.")
	})

	test("restoreBlocked disables Restore and carries its words as the title", async () => {
		await mountFold({
			restoreBlocked: "Save or discard your changes first."
		})
		send(redlines())
		await settle()
		await openFold()
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>(
				"[data-redline-id] button[title]"
			)
		]
		expect(buttons.length).toBe(3)
		for (const b of buttons) {
			expect(b.disabled).toBe(true)
			expect(b.title).toBe("Save or discard your changes first.")
		}
	})

	test("the open fold ends with Clear edit history…, which asks and clears", async () => {
		await mountFold()
		send(redlines())
		await settle()
		expect(byText(/^Clear edit history…$/)).toBeUndefined()
		await openFold()
		byText(/^Clear edit history…$/)!.click()
		await settle()
		const dialog = text('[data-testid="clear-edit-history-dialog"]')
		expect(dialog).toContain("Clear this version's edit history?")
		expect(dialog).toContain("Removes its 3 edits.")
		byText(/^Clear edit history$/)!.click()
		await settle()
		expect(sent("characterVersions:clearRedlines")[0]!.payload).toEqual({
			characterVersionId: VERSION
		})
		client.dispatch("characterVersions:clearRedlines", {
			characterVersionId: VERSION,
			cleared: 3
		})
		send(redlines({ redlines: [] }))
		await settle()
		expect(fold()).toBeNull()
	})

	test("no Clear button without canClear", async () => {
		await mountFold()
		send(redlines({ canClear: false }))
		await settle()
		await openFold()
		expect(byText(/^Clear edit history…$/)).toBeUndefined()
	})

	test("a picture change says only that it changed; a follows side reads in words", async () => {
		await mountFold()
		send(
			redlines({
				redlines: [
					{
						...redlines().redlines[0],
						changes: [
							change({
								key: "avatar",
								label: "Picture",
								before: null,
								after: null,
								noPreview: true
							}),
							change({
								key: "summary",
								label: "Summary",
								before: null,
								beforeFollows: true,
								after: "Mine"
							})
						]
					}
				]
			})
		)
		await settle()
		await openFold()
		const row = text("[data-redline-id='31']")
		expect(row).toContain("Picture: changed")
		expect(row).toContain("Summary: (follows the card) → Mine")
	})

	test("another version closes the fold and asks again", async () => {
		await mountFold()
		send(redlines())
		await settle()
		await openFold()
		expect(fold()!.getAttribute("aria-expanded")).toBe("true")
		props.characterVersionId = 8
		await settle()
		expect(fold()).toBeNull()
		expect(sent("characterVersions:redlines").at(-1)!.payload).toEqual({
			characterVersionId: 8
		})
		send(redlines({ characterVersionId: 8 }))
		await settle()
		expect(fold()!.getAttribute("aria-expanded")).toBe("false")
	})
})
