/**
 * The Sprites tab with an owner: a card keeps its scoped keys; a cast
 * member's own sets are scoped on `member:<id>` (★cp-scope-1), match on
 * `castMemberId`, and draw for whoever may edit their lorebook.
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
import { INTEREST_SYNC_EVENT } from "$lib/shared/sockets/interest"
import SpritesTab from "./SpritesTab.svelte"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		listeners,
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

const set = (id: number, name: string) => ({
	id,
	name,
	isDefault: true,
	sprites: [
		{
			id: id * 10,
			label: "joy",
			position: 0,
			media: { uuid: "u" + id, rev: 0 }
		}
	]
})

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: true })
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

async function mountTab(owner: any, isOwner = true) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(SpritesTab, {
		target,
		context: new Map([["userCtx", { user: { id: 1, isAdmin: true } }]]),
		props: { owner, characterName: "Bianca", isOwner }
	})
	await settle()
}
const emitsOf = (event: string) =>
	client.emits.filter((e) => e.event === event).map((e) => e.payload)
/** The interest keys last declared to the server. */
const declaredKeys = (): string[] =>
	[...client.emits].reverse().find((e) => e.event === INTEREST_SYNC_EVENT)
		?.payload.keys ?? []
const buttonLabelled = (re: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		re.test(b.textContent ?? "")
	)
const body = () => document.body.textContent ?? ""

describe("SpritesTab with a card owner", () => {
	test("asks with characterId, hears the scoped key, offers Fill", async () => {
		await mountTab({ characterId: 7 })
		expect(emitsOf("characters:listSprites")).toEqual([{ characterId: 7 }])
		expect(declaredKeys()).toContain("characters:listSprites#7")
		expect(declaredKeys()).not.toContain("characters:listSprites")
		client.dispatch("characters:listSprites", { castMemberId: 3, sets: [] })
		client.dispatch("characters:listSprites", {
			characterId: 7,
			sets: [set(1, "armour")]
		})
		await settle()
		expect(buttonLabelled(/Fill empty sprites/)).toBeDefined()
		expect(body()).toContain("armour")
	})
})

describe("SpritesTab with a member owner", () => {
	test("asks with castMemberId on the member-scoped key; hears only its own reply", async () => {
		await mountTab({ castMemberId: 3 })
		expect(emitsOf("characters:listSprites")).toEqual([{ castMemberId: 3 }])
		expect(declaredKeys()).toContain("characters:listSprites#member:3")
		expect(declaredKeys()).not.toContain("characters:listSprites")
		client.dispatch("characters:listSprites", {
			castMemberId: 4,
			sets: [set(2, "other-member")]
		})
		client.dispatch("characters:listSprites", {
			characterId: 7,
			sets: [set(3, "a-card")]
		})
		await settle()
		expect(body()).not.toContain("other-member")
		expect(body()).not.toContain("a-card")
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [set(1, "winter")]
		})
		await settle()
		expect(body()).toContain("winter")
	})

	test("a write emits castMemberId; Fill previews with castMemberId alone", async () => {
		await mountTab({ castMemberId: 3 })
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [set(1, "winter")]
		})
		await settle()
		expect(buttonLabelled(/Fill empty sprites/)).toBeDefined()
		expect(emitsOf("images:drawingSheet")).toEqual([{ castMemberId: 3 }])
		expect(declaredKeys()).toContain("characters:previewSpriteFill")
		expect(declaredKeys()).toContain("characters:spriteFill")
		expect(declaredKeys()).toContain("characters:expressSprite")
		buttonLabelled(/Fill empty sprites/)?.click()
		await settle()
		const previews = emitsOf("characters:previewSpriteFill")
		expect(previews).toHaveLength(1)
		expect(previews[0].castMemberId).toBe(3)
		expect("characterId" in previews[0]).toBe(false)
		// Another owner's preview reply is dropped.
		client.dispatch("characters:previewSpriteFill", {
			characterId: 7,
			labels: ["joy"],
			line: "x",
			notices: []
		})
		// The standard set, from the empty state of a member with no sets.
		client.dispatch("characters:listSprites", { castMemberId: 3, sets: [] })
		await settle()
	})

	test("Re-express is offered on its own sheet reply, not another owner's", async () => {
		await mountTab({ castMemberId: 3 })
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [
				{
					...set(1, "winter"),
					sprites: [
						{
							id: 1,
							label: "neutral",
							position: 0,
							media: { uuid: "n", rev: 0 }
						},
						{
							id: 2,
							label: "joy",
							position: 1,
							media: { uuid: "j", rev: 0 }
						}
					]
				}
			]
		})
		client.dispatch("images:drawingSheet", {
			castMemberId: 4,
			expressions: true
		})
		client.dispatch("images:drawingSheet", {
			characterId: 3,
			expressions: true
		})
		await settle()
		const offered = async () => {
			;(
				document.querySelector(
					'[aria-label="More actions for the joy sprite"]'
				) as HTMLButtonElement | null
			)?.click()
			await settle()
			return [...document.querySelectorAll("[role=menuitem]")].some(
				(el) => /Re-express from neutral/.test(el.textContent ?? "")
			)
		}
		expect(await offered()).toBe(false)
		client.dispatch("images:drawingSheet", {
			castMemberId: 3,
			expressions: true
		})
		await settle()
		expect(await offered()).toBe(true)
		expect(emitsOf("images:drawingSheet")).toEqual([{ castMemberId: 3 }])
	})

	test("the standard set from the empty state emits castMemberId", async () => {
		await mountTab({ castMemberId: 3 })
		client.dispatch("characters:listSprites", { castMemberId: 3, sets: [] })
		await settle()
		buttonLabelled(/start from the standard set/)?.click()
		await settle()
		expect(emitsOf("characters:addStandardSprites")).toEqual([
			{ castMemberId: 3, setId: undefined }
		])
	})

	test("isOwner false hides the write controls and Fill, even for an admin", async () => {
		await mountTab({ castMemberId: 3 }, false)
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [set(1, "winter")]
		})
		await settle()
		expect(buttonLabelled(/Fill empty sprites/)).toBeUndefined()
		expect(buttonLabelled(/^\s*Upload\s*$/)).toBeUndefined()
		expect(
			document.querySelector('[aria-label="Sprite set options"]')
		).toBeNull()
	})
})
