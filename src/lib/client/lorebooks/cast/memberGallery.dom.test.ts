/**
 * The member page's **Gallery** tab (a member's own pictures, through
 * `EntityGalleryTab` with a member owner): it asks `characters:listGallery`
 * with `castMemberId`, shows Delete to an editor (★cp-del) but no *Set as
 * avatar* or likeness, and offers Upload only when the book is editable.
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
const emitsOf = (event: string) =>
	client.emits.filter((e) => e.event === event).map((e) => e.payload)
const image = (id: number) => ({
	id,
	uuid: `u-${id}`,
	url: `/media/u-${id}`,
	thumbUrl: `/media/u-${id}?thumb`,
	kind: "image"
})
const buttonLabelled = (re: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		re.test((b.textContent ?? "").trim())
	)
const panelText = () =>
	document.querySelector("#cast-member-gallery")?.textContent ?? ""

describe("the member page's Gallery tab", () => {
	test("mounts the gallery on the member's own pictures", async () => {
		await mountMember()
		expect(tabEl(/^Gallery/)).toBeDefined()
		expect(emitsOf("characters:listGallery")).toEqual([])
		tabEl(/^Gallery/)!.click()
		await settle()
		expect(emitsOf("characters:listGallery")).toEqual([
			{ castMemberId: BIANCA }
		])
		// Another owner's reply is ignored; the member's own is shown.
		client.dispatch("characters:listGallery", {
			characterId: 70,
			images: [image(1)]
		})
		await settle()
		expect(panelText()).not.toContain("No images yet")
		expect(
			document.querySelectorAll("#cast-member-gallery img")
		).toHaveLength(0)
		client.dispatch("characters:listGallery", {
			castMemberId: BIANCA,
			images: [image(2), image(3)]
		})
		await settle()
		expect(
			document.querySelectorAll("#cast-member-gallery img")
		).toHaveLength(2)
	})

	test("an editor may Upload, Generate and Delete; no avatar or likeness for a member", async () => {
		await mountMember()
		tabEl(/^Gallery/)!.click()
		await settle()
		client.dispatch("characters:listGallery", {
			castMemberId: BIANCA,
			images: [image(2), image(3)]
		})
		await settle()
		expect(buttonLabelled(/^Upload$/)).toBeDefined()
		expect(buttonLabelled(/Generate portrait/)).toBeDefined()
		const triggers = document.querySelectorAll(
			'[aria-label="More actions for this image"]'
		)
		expect(triggers.length).toBe(2)
		;(triggers[0] as HTMLElement).click()
		await settle()
		const text = document.body.textContent ?? ""
		expect(/Delete/.test(text)).toBe(true)
		expect(/Set as avatar|Use as likeness/.test(text)).toBe(false)
	})

	test("a read-only book hides Upload", async () => {
		await mountMember({ bookAccess: "shared", readOnly: true })
		tabEl(/^Gallery/)!.click()
		await settle()
		client.dispatch("characters:listGallery", {
			castMemberId: BIANCA,
			images: [image(2)]
		})
		await settle()
		expect(buttonLabelled(/^Upload$/)).toBeUndefined()
		expect(
			document.querySelector('[aria-label="More actions for this image"]')
		).toBeNull()
	})
})
