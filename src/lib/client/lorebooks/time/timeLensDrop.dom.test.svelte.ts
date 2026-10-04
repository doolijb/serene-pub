/**
 * The Time lens's drop-to-date (plan B7).
 *
 * A row dropped onto the line — or pressed, which drops it at the end — is
 * dated, and only that row: the date is held for the entry it was dropped
 * for, after the reader has said the open draft may go. Held any earlier,
 * the draft effect would write it into the draft being left (even on
 * Cancel), the undated row would never open, and the stale date would
 * re-date the next entry opened.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import TimeLens from "./TimeLens.svelte"

const BOOK = 4

const row = (id: number, year: number | null, name: string) => ({
	id,
	typeId: HISTORY_TYPE_ID,
	lorebookId: BOOK,
	name,
	content: `${name} happened.`,
	keys: [],
	year,
	month: null,
	day: null,
	branchId: null
})

const entries = [
	row(1, 3, "The siege"),
	row(2, 5, "The thaw"),
	row(3, null, "The vow")
]

let app: ReturnType<typeof mount> | null = null
const emitted: string[] = []
let unregister: (() => void) | null = null
const guard = $state({ hasUnsavedChanges: false })

beforeEach(() => {
	emitted.length = 0
	setSocket({
		connected: true,
		id: "tab-a",
		on() {},
		off() {},
		emit(event: string) {
			emitted.push(event)
		}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
	loreRoute.set({ ...emptyRoute(), lorebookId: BOOK, entryId: 1 })
	guard.hasUnsavedChanges = false
	unregister = loreRoute.registerUnsavedChanges(() => guard.hasUnsavedChanges)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(TimeLens, {
		target,
		// The cast comes from the workspace's book data (plan B4).
		context: bookDataContext(
			staticBookData(() => ({ lorebookId: BOOK, cast: [] }))
		),
		props: {
			lorebookId: BOOK,
			scopeTitle: "History",
			mode: "desk",
			entries: entries as any,
			scenes: [],
			session: null,
			decisions: null,
			get hasUnsavedChanges() {
				return guard.hasUnsavedChanges
			},
			set hasUnsavedChanges(v: boolean) {
				guard.hasUnsavedChanges = v
			}
		}
	})
	flushSync()
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	unregister?.()
	if (loreRoute.confirming) loreRoute.resolveConfirm(false)
	loreRoute.set(emptyRoute())
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

const year = () => document.querySelector<HTMLInputElement>("#dteYear")!
const undatedChip = () =>
	document.querySelector<HTMLButtonElement>('[data-lore-undated="3"]')!

function typeYear(value: string) {
	year().value = value
	year().dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

describe("pressing an undated row dates it at the end of the line", () => {
	test("Cancel on the prompt leaves the open draft exactly as it was typed", async () => {
		expect(year().value).toBe("3")
		typeYear("4")
		expect(guard.hasUnsavedChanges).toBe(true)

		undatedChip().click()
		await settle()
		expect(loreRoute.confirming).toBe(true)
		// Asked, not yet answered: the draft being left is untouched.
		expect(year().value).toBe("4")

		loreRoute.resolveConfirm(false)
		await settle()
		expect(loreRoute.route.entryId).toBe(1)
		expect(year().value).toBe("4")
	})

	test("Leave opens the undated row with the date, and no other entry takes it", async () => {
		typeYear("4")
		undatedChip().click()
		await settle()
		loreRoute.resolveConfirm(true)
		await settle()

		expect(loreRoute.route.entryId).toBe(3)
		// The end of the line is the newest date, year 5.
		expect(year().value).toBe("5")

		// The dropped row's date is its own: opening another entry next does
		// not re-date that one.
		guard.hasUnsavedChanges = false
		loreRoute.set({ ...loreRoute.route, entryId: 1 })
		await settle()
		expect(year().value).toBe("3")
	})

	test("pressed with nothing typed, it asks nothing and opens the row dated", async () => {
		undatedChip().click()
		await settle()
		expect(loreRoute.confirming).toBe(false)
		expect(loreRoute.route.entryId).toBe(3)
		expect(year().value).toBe("5")
	})
})

describe("the Time lens reads the workspace's book (plan B4)", () => {
	test("it asks for no cast of its own on mount", () => {
		expect(emitted).not.toContain("lorebooks:bindingList")
	})
})
