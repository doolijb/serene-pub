/**
 * The Cast member page's card actions (S2c): "Edit the card" for a reader who
 * owns the member's card in their own book, and in a book that is not theirs
 * one muted line with "Edit my card" — outside the read-only form — both
 * opening the card in Characters.
 *
 * ⚠ The chosen tab is module state of `CastWorkspace` and so outlives each
 * mount: every test picks the Member tab it starts from.
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
const NIKO = 11
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
		character: { id: 70, userId: ME, name: "Bianca", isPersona: false }
	},
	{
		id: NIKO,
		name: "Niko",
		binding: "{{char:2}}",
		characterId: 71,
		character: { id: 71, userId: 2, name: "Niko", isPersona: false }
	},
	{
		id: 12,
		name: "The ferryman",
		binding: "{{char:3}}",
		characterId: null,
		character: null
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
	castId: number,
	book: {
		bookAccess?: "owner" | "shared" | "admin"
		bookName?: string | null
		ownerName?: string | null
	} = {}
) {
	const panelsCtx = {
		digest: {} as Record<string, unknown>,
		openPanel: vi.fn()
	}
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId })
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
	const memberTab = [
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-cast-member-page] [role="tab"]'
		)
	].find((t) => /^Member/.test(t.textContent ?? ""))
	memberTab?.click()
	await settle()
	return panelsCtx
}

const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const editCard = () =>
	document.querySelector<HTMLButtonElement>("[data-cast-edit-card]")
const editMyCard = () =>
	document.querySelector<HTMLButtonElement>("[data-cast-edit-my-card]")
const guestLine = () => document.querySelector("[data-cast-guest-line]")

describe("the member page's card actions", () => {
	test("the reader's own card in their own book: Edit the card opens it, no guest line", async () => {
		const panels = await mountMember(BIANCA)
		const btn = editCard()
		expect(btn).not.toBeNull()
		expect(text(btn)).toBe("Edit the card")
		expect(btn!.disabled).toBe(false)
		expect(guestLine()).toBeNull()
		expect(editMyCard()).toBeNull()
		btn!.click()
		expect(panels.digest.characterId).toBe(70)
		expect(panels.openPanel).toHaveBeenCalledWith({
			key: "characters",
			toggle: false
		})
	})

	test("their card in a shared book: the line, and Edit my card works though the form reads", async () => {
		const panels = await mountMember(BIANCA, {
			bookAccess: "shared",
			bookName: "Porto Alto",
			ownerName: "Hana"
		})
		expect(text(guestLine())).toBe(
			"Bianca lives in Hana's lorebook Porto Alto; your card seeds them."
		)
		expect(editCard()).toBeNull()
		const btn = editMyCard()
		expect(btn).not.toBeNull()
		expect(text(btn)).toBe("Edit my card")
		expect(btn!.disabled).toBe(false)
		expect(btn!.closest("fieldset")).toBeNull()
		expect(
			document
				.querySelector("fieldset[data-lore-read-only]")
				?.hasAttribute("disabled")
		).toBe(true)
		btn!.click()
		expect(panels.digest.characterId).toBe(70)
		expect(panels.openPanel).toHaveBeenCalledWith({
			key: "characters",
			toggle: false
		})
	})

	test("the owner's name unknown: the line says the lorebook without it", async () => {
		await mountMember(BIANCA, {
			bookAccess: "shared",
			bookName: "Porto Alto"
		})
		expect(text(guestLine())).toBe(
			"Bianca lives in the lorebook Porto Alto; your card seeds them."
		)
	})

	test("a shared book whose card is somebody else's: neither button, no line", async () => {
		await mountMember(NIKO, {
			bookAccess: "shared",
			bookName: "Porto Alto",
			ownerName: "Hana"
		})
		expect(editCard()).toBeNull()
		expect(editMyCard()).toBeNull()
		expect(guestLine()).toBeNull()
	})

	test("somebody else's card in the reader's own book: no Edit the card", async () => {
		await mountMember(NIKO)
		expect(document.querySelector("[data-cast-card]")).not.toBeNull()
		expect(editCard()).toBeNull()
	})

	test("a background member has no card to edit", async () => {
		await mountMember(12)
		expect(
			document.querySelector("[data-cast-member-page] h3")?.textContent
		).toMatch(/The ferryman/)
		expect(editCard()).toBeNull()
		expect(editMyCard()).toBeNull()
		expect(guestLine()).toBeNull()
	})
})
