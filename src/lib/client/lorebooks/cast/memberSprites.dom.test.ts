/**
 * The member page's **Sprites** tab (a member's own sets, through
 * `SpritesTab` with a member owner) and the form's sprite set picker: the
 * member's own sets when any holds an image, else its card's.
 *
 * ⚠ The chosen tab is module state of `CastWorkspace`: pick Member first.
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
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import CastWorkspaceFixture from "../CastWorkspaceFixture.svelte"
import { staticBookData } from "../bookData.svelte"

const BOOK = 5
const BIANCA = 10
const ME = 1

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
		id: BIANCA,
		name: "Bianca",
		binding: "{{char:1}}",
		characterId: 70,
		character: { id: 70, userId: 2, name: "Bianca", isPersona: false }
	}
]

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: ME, isAdmin: false })
	openBookTime.open(BOOK)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
	store.load()
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

async function mountMember(
	book: { bookAccess?: "owner" | "shared" | "admin"; readOnly?: boolean } = {}
) {
	const panelsCtx = {
		digest: {} as Record<string, unknown>,
		openPanel: vi.fn()
	}
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: BIANCA })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: ME, isAdmin: false } }],
			["panelsCtx", panelsCtx]
		]),
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				cast: MEMBERS as any,
				rawRows: {},
				scenes: [],
				...book
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
	return panelsCtx
}

const tabEl = (label: RegExp) =>
	[
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-cast-member-page] [role="tab"]'
		)
	].find((t) => label.test((t.textContent ?? "").trim()))
/** What each combobox on show reads (the Select shows its choice in an input). */
const shownValues = (within: string) =>
	[
		...document.querySelectorAll<HTMLInputElement>(
			`${within} [data-scope="combobox"][data-part="input"]`
		)
	].map((i) => i.value)
const emitsOf = (event: string) =>
	client.emits.filter((e) => e.event === event).map((e) => e.payload)
const sets = (...named: [string, boolean][]) =>
	named.map(([name, image], i) => ({
		id: i + 1,
		name,
		isDefault: i === 0,
		sprites: [
			{
				id: i + 1,
				label: "joy",
				position: 0,
				media: image ? { uuid: "u", rev: 0 } : null
			}
		]
	}))
describe("the member page's Sprites tab", () => {
	test("mounts the sprite editor on the member's own sets", async () => {
		await mountMember()
		expect(tabEl(/^Sprites/)).toBeDefined()
		tabEl(/^Sprites/)!.click()
		await settle()
		expect(emitsOf("characters:listSprites")).toContainEqual({
			castMemberId: BIANCA
		})
		client.dispatch("characters:listSprites", {
			castMemberId: BIANCA,
			sets: sets(["winter", true])
		})
		await settle()
		expect(shownValues("#cast-member-sprites")).toContain(
			"winter (default)"
		)
	})

	test("the sprite set picker asks for the member's own sets too", async () => {
		await mountMember()
		expect(emitsOf("characters:listSprites")).toEqual(
			expect.arrayContaining([
				{ castMemberId: BIANCA },
				{ characterId: 70 }
			])
		)
	})

	test("the picker lists the member's own sets when one holds an image, else the card's", async () => {
		await mountMember()
		client.dispatch("characters:listSprites", {
			characterId: 70,
			sets: sets(["card-set", true])
		})
		client.dispatch("characters:listSprites", {
			castMemberId: BIANCA,
			sets: sets(["own-empty", false])
		})
		await settle()
		const page = () => shownValues("[data-cast-member-page]")
		// Nothing drawn in the member's own: the card's sets are offered.
		expect(page()).toContain("The card's default set")
		client.dispatch("characters:listSprites", {
			castMemberId: BIANCA,
			sets: sets(["own-drawn", true])
		})
		await settle()
		expect(page()).toContain("Their default set")
	})
})
