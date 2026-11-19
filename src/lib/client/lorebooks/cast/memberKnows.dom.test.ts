/**
 * 🚧 The Knows tab on a member's page, in a real CastWorkspace: the owner is
 * offered it after the marks read and sees its count after the member read; a
 * reader of a shared book sends no read and sees no tab; a member whose read
 * the server refuses sees no tab and no refusal; a button writes the tie at
 * the page's reading. ⚠ No DOM node is ever handed to `expect`.
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

type Listener = (payload: any) => void

const BOOK = 5
const VERITY = 10

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

async function mountMember(bookAccess: "owner" | "shared" = "owner") {
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: VERITY })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings: { showAdvancedControls: false } }]
		]),
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				bookAccess,
				cast: [
					{
						id: VERITY,
						name: "Verity",
						binding: "{{char:1}}",
						characterId: null,
						character: null
					}
				] as any,
				rows: {
					"world-lore": [
						{ id: 21, name: "Harbor", archived: false },
						{ id: 22, name: "Lighthouse", archived: false },
						{ id: 23, name: "Old map", archived: true }
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
}

const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const tabs = () => [
	...document.querySelectorAll<HTMLElement>(
		'[data-cast-member-page] [role="tablist"][aria-label$="\'s page"] [role="tab"]'
	)
]
const knowsTab = () => tabs().find((t) => text(t).startsWith("Knows"))
const asked = (pred: (p: any) => boolean = () => true) =>
	client.emits.filter(
		(e) => e.event === "entryKnowledge:list" && pred(e.payload)
	)
const marksAsk = () => asked((p) => !p.castMemberId && !p.entryId)[0]
const memberAsk = () => asked((p) => p.castMemberId === VERITY)[0]

function answerMarks(req: any, marked: number[] = []) {
	client.dispatch("entryKnowledge:list", {
		lorebookId: BOOK,
		branchId: null,
		moment: null,
		markedEntryIds: marked,
		rows: [],
		requestId: req.payload.requestId
	})
}
const tieWinner = {
	tieId: 1,
	kind: "knows",
	relationshipType: "knows",
	hand: true,
	date: null
}
function answerMember(req: any) {
	client.dispatch("entryKnowledge:list", {
		lorebookId: BOOK,
		castMemberId: VERITY,
		branchId: null,
		moment: null,
		markedEntryIds: [],
		rows: [
			{
				castMemberId: VERITY,
				name: "Verity",
				entryId: 21,
				known: true,
				winner: tieWinner,
				hand: "knows",
				overruled: null,
				placeEntry: false
			}
		],
		requestId: req.payload.requestId
	})
}

describe("the Knows tab", () => {
	test("the owner is offered it after the marks read, and its count follows the member read", async () => {
		await mountMember()
		expect(knowsTab()).toBeUndefined()
		expect(memberAsk()).toBeUndefined()
		answerMarks(marksAsk())
		await settle()
		expect(text(knowsTab())).toBe("Knows")
		expect(memberAsk().payload).toMatchObject({
			lorebookId: BOOK,
			castMemberId: VERITY,
			branchId: null,
			moment: null
		})
		answerMember(memberAsk())
		await settle()
		expect(text(knowsTab())).toBe("Knows 1")
	})

	test("a reader of a shared book sends no read and sees no tab", async () => {
		await mountMember("shared")
		expect(asked()).toHaveLength(0)
		expect(knowsTab()).toBeUndefined()
	})

	test("pressing a button writes the tie for the member and entry at the reading", async () => {
		await mountMember()
		answerMarks(marksAsk())
		await settle()
		answerMember(memberAsk())
		await settle()
		knowsTab()!.click()
		await settle()
		const pool = document.getElementById("cast-member-knows")!
		expect(text(pool)).toContain("Tied to Verity")
		const other = pool.querySelector('[data-knows-row="22"]')!
		// An archived entry is not offered.
		expect(pool.querySelector('[data-knows-row="23"]')).toBeNull()
		other
			.querySelector<HTMLButtonElement>('[data-knows-add="kept_from"]')!
			.click()
		await settle()
		const write = client.emits.find(
			(e) => e.event === "entryKnowledge:setTie"
		)!
		expect(write.payload).toMatchObject({
			lorebookId: BOOK,
			castMemberId: VERITY,
			entryId: 22,
			hand: "kept_from",
			branchId: null,
			moment: null
		})
	})

	test("a member whose read is refused sees no tab and no refusal, even with Knows remembered", async () => {
		await mountMember()
		client.dispatch("entryKnowledge:list:error", {
			error: "Only the owner may read who knows.",
			lorebookId: BOOK,
			requestId: marksAsk().payload.requestId
		})
		await settle()
		expect(knowsTab()).toBeUndefined()
		expect(text(document.body)).not.toContain("Only the owner may read")
		expect(asked((p) => !!p.castMemberId)).toHaveLength(0)
		// The page shows Member, not an empty panel.
		expect(document.getElementById("cast-member-member")!.hidden).toBe(
			false
		)
		expect(document.getElementById("cast-member-knows")!.hidden).toBe(true)
	})
})
