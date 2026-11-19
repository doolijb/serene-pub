/**
 * 🚧 The lock on a cast member: the Locked toggle on the member's page, written
 * at once and never part of the draft; the line a reader gets when it is on;
 * the mark on a locked member's list row.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const toasts = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster: toasts }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import CastWorkspaceFixture from "../CastWorkspaceFixture.svelte"
import { staticBookData } from "../bookData.svelte"

const BOOK = 5
const VERITY = 10
const OREN = 11

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

const MEMBERS = [
	{
		id: VERITY,
		name: "Verity",
		binding: "{{char:1}}",
		characterId: null,
		character: null,
		castMemberLock: false
	},
	{
		id: OREN,
		name: "Oren",
		binding: "{{char:2}}",
		characterId: null,
		character: null,
		castMemberLock: true
	}
]

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
	store.load()
	for (const fn of Object.values(toasts)) fn.mockClear()
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	close()
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

async function mountMember(castId: number | null, readOnly = false) {
	loreRoute.set({
		lorebookId: BOOK,
		scope: "cast",
		...(castId != null ? { castId } : {})
	})
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				cast: MEMBERS as any,
				rawRows: {},
				scenes: [],
				bookAccess: readOnly ? ("shared" as const) : ("owner" as const)
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line: lineOf(null, [])
		}
	})
	await settle()
	;[
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-cast-member-page] [role="tab"]'
		)
	]
		.find((t) => /^Member/.test(t.textContent ?? ""))
		?.click()
	await settle()
}

const lockButton = () =>
	document.querySelector<HTMLButtonElement>("[data-cast-lock]")
const lockNote = () => document.querySelector("[data-cast-lock-note]")
const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const lockEmits = () =>
	client.emits.filter((e) => e.event === "lorebooks:updateBinding")

describe("the cast member lock", () => {
	test("an owner presses Locked; it writes at once and reads pressed after the reply", async () => {
		await mountMember(VERITY)
		expect(text(lockButton())).toBe("Locked")
		expect(lockButton()?.getAttribute("aria-pressed")).toBe("false")
		lockButton()!.click()
		await settle()
		expect(lockEmits().map((e) => e.payload)).toEqual([
			{ lorebookBinding: { id: VERITY, castMemberLock: true } }
		])
		client.dispatch("lorebooks:updateBinding", {
			lorebookBinding: { id: VERITY, castMemberLock: true }
		})
		await settle()
		expect(lockButton()?.getAttribute("aria-pressed")).toBe("true")
	})

	test("a refusal is said inline and no toast is raised", async () => {
		await mountMember(VERITY)
		lockButton()!.click()
		await settle()
		client.dispatch("lorebooks:updateBinding:error", {
			lorebookBinding: { id: VERITY },
			error: "You may not change this lorebook."
		})
		await settle()
		expect(text(document.querySelector("[data-cast-member-page]"))).toContain(
			"You may not change this lorebook."
		)
		expect(lockButton()?.getAttribute("aria-pressed")).toBe("false")
		expect(
			Object.values(toasts).reduce((n, fn) => n + fn.mock.calls.length, 0)
		).toBe(0)
	})

	test("a reader gets no button, and the line only when the member is locked", async () => {
		await mountMember(OREN, true)
		expect(lockButton() === null).toBe(true)
		expect(text(lockNote())).toBe(
			"Locked: sessions and their routines leave it as it is."
		)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await mountMember(VERITY, true)
		expect(lockButton() === null).toBe(true)
		expect(lockNote() === null).toBe(true)
	})

	test("a locked member's list row has the mark, an unlocked one has none", async () => {
		await mountMember(null)
		const mark = (id: number) =>
			!!document.querySelector(
				`[data-cast-row][data-cast-id="${id}"] [data-lock-mark]`
			)
		expect(mark(OREN)).toBe(true)
		expect(mark(VERITY)).toBe(false)
	})
})
