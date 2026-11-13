/**
 * 🚧 The Sprites tab of a cast member the card draws: `fromCard` sets are shown
 * read-only under a muted line; an editor keeps Upload and the standard set.
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
const body = () => (document.body.textContent ?? "").replace(/\s+/g, " ")

const cardSets = [{ ...set(5, "armour"), isDefault: true }]

describe("SpritesTab with fromCard", () => {
	test("no own sets: the card's sets, the line, no 'has no sprites', no edit controls; an editor keeps Upload and the standard set", async () => {
		await mountTab({ castMemberId: 3 })
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [],
			fromCard: { characterId: 7, sets: cardSets }
		})
		await settle()
		expect(body()).toContain(
			"From the card: Bianca is drawn with these until they have sprites of their own."
		)
		expect(body()).toContain("armour")
		expect(body()).not.toContain("has no sprites")
		expect(document.querySelector('img[alt="joy sprite"]')).not.toBeNull()
		expect(
			document.querySelector(
				'[aria-label="More actions for the joy sprite"]'
			)
		).toBeNull()
		expect(buttonLabelled(/Fill empty sprites/)).toBeUndefined()
		expect(buttonLabelled(/Upload images/)).toBeDefined()
		expect(buttonLabelled(/start from the standard set/)).toBeDefined()
	})

	test("a reader (not an editor) sees the card's sets and no write controls", async () => {
		await mountTab({ castMemberId: 3 }, false)
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [],
			fromCard: { characterId: 7, sets: cardSets }
		})
		await settle()
		expect(body()).toContain("From the card:")
		expect(body()).not.toContain("has no sprites")
		expect(buttonLabelled(/Upload images/)).toBeUndefined()
		expect(buttonLabelled(/start from the standard set/)).toBeUndefined()
	})

	test("own empty sets plus fromCard: the own sets and the 'Until these have pictures' line", async () => {
		await mountTab({ castMemberId: 3 })
		client.dispatch("characters:listSprites", {
			castMemberId: 3,
			sets: [
				{
					id: 1,
					name: "winter",
					isDefault: true,
					sprites: [{ id: 1, label: "joy", position: 0, media: null }]
				}
			],
			fromCard: { characterId: 7, sets: cardSets }
		})
		await settle()
		expect(body()).toContain("winter")
		expect(body()).toContain(
			"Until these have pictures, Bianca is drawn with the card's sprites."
		)
		expect(body()).not.toContain("From the card:")
	})

	test("a card owner's tab ignores fromCard; without it the old empty state stands", async () => {
		await mountTab({ characterId: 7 }, false)
		client.dispatch("characters:listSprites", { characterId: 7, sets: [] })
		await settle()
		expect(body()).toContain("Bianca has no sprites.")
	})
})
