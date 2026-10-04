/**
 * The member page's presences read the line the way the World bar does (plan
 * A5): the line's own, each ancestor line's up to its fork cut, never a
 * sibling's — `presencesOnLine` / `appearancesOf`, not a filter of its own.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { openBookTime } from "../time/bookTime.svelte"
import PresencesPanel from "./PresencesPanel.svelte"

const BOOK = 5
const MEMBER = 9

/** A off main at Y5; B off main at now; C off A at Y7. */
const BRANCHES = [
	{ id: 1, name: "Exile", lorebookId: BOOK, forkedFromBranchId: null, forkYear: 5, forkMonth: null, forkDay: null },
	{ id: 2, name: "Sibling", lorebookId: BOOK, forkedFromBranchId: null, forkYear: null, forkMonth: null, forkDay: null },
	{ id: 3, name: "Return", lorebookId: BOOK, forkedFromBranchId: 1, forkYear: 7, forkMonth: null, forkDay: null }
] as any[]

const presence = (id: number, branchId: number | null, fromYear: number) => ({
	id,
	castId: MEMBER,
	branchId,
	personalPosition: id * 10,
	fromYear,
	fromMonth: null,
	fromDay: null,
	untilYear: null,
	untilMonth: null,
	untilDay: null,
	note: null
})

const PRESENCES = [
	presence(1, null, 1), // main, before every cut: seen on C
	presence(2, null, 6), // main after A's Y5 fork: never C's past
	presence(3, 1, 2), // on A, before C's Y7 fork: C's past
	presence(4, 2, 1), // a sibling line's
	presence(5, 3, 8), // C's own
	{ ...presence(6, null, 1), castId: 99 } // someone else's
]

let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	setSocket({ connected: true, id: "tab", on() {}, off() {}, emit() {} } as never)
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, BRANCHES)
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	openBookTime.open(null)
	setSocket(null)
	document.body.innerHTML = ""
})

async function show(branchId: number | null, moment?: string) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(PresencesPanel, {
		target,
		props: {
			lorebookId: BOOK,
			castId: MEMBER,
			memberName: "Verity",
			presences: PRESENCES,
			line: lineOf(branchId, BRANCHES),
			branchName: BRANCHES.find((b) => b.id === branchId)?.name ?? null,
			moment
		} as any
	})
	flushSync()
	await tick()
	flushSync()
}

const listed = () =>
	[...document.querySelectorAll("[data-lore-presences] li")].map((li) =>
		li.textContent?.replace(/\s+/g, " ").trim()
	)
const badges = () =>
	[...document.querySelectorAll("[data-lore-presences] li")].map((li) =>
		[...li.querySelectorAll(".badge")].map((b) => b.textContent?.trim())
	)
const text = () => document.body.textContent?.replace(/\s+/g, " ") ?? ""

describe("PresencesPanel reads the line's chain", () => {
	test("a fork of a fork lists its parent's presences before the fork, and none main made after the earlier cut", async () => {
		await show(3)
		const rows = listed()
		expect(rows.map((r) => r?.match(/at (\d+)/)?.[1])).toEqual(["10", "30", "50"])
		// Whose line each one is, said the way the amendments list says it.
		expect(badges()).toEqual([["at 10"], ["at 30", "from Exile"], ["at 50", "Return only"]])
	})

	test("who is here now is the World bar's answer", async () => {
		await show(3)
		expect(text()).toContain("at 10, 30 and 50")
	})

	test("main reads main's own only", async () => {
		await show(null)
		expect(listed().map((r) => r?.match(/at (\d+)/)?.[1])).toEqual(["10", "20"])
	})

	test("at a moment, a presence that has not begun is listed but not here", async () => {
		await show(3, "Y3")
		expect(listed()).toHaveLength(3)
		expect(text()).toContain("at 10 and 30")
	})
})

describe("PresencesPanel says which lines a removal takes it off", () => {
	const removeAt = (position: number) =>
		(
			document.querySelector(
				`button[aria-label="Remove the presence at ${position}"]`
			) as HTMLButtonElement
		).click()

	test("a presence from the line it was forked from comes off that line and every line reading it", async () => {
		await show(3)
		removeAt(30)
		flushSync()
		expect(text()).toContain(
			"Remove this presence? It was placed on Exile, so it comes off Exile and Return."
		)
	})

	test("main's comes off every line that reads it", async () => {
		await show(3)
		removeAt(10)
		flushSync()
		expect(text()).toContain(
			"Remove this presence? It was placed on main, so it comes off main, Exile, Sibling and Return."
		)
	})

	test("the line's own, read nowhere else, names the line", async () => {
		await show(3)
		removeAt(50)
		flushSync()
		expect(text()).toContain("Remove this presence from Return?")
	})
})
