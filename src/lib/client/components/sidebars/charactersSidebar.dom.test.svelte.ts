/**
 * The Characters view is wired onto `characters:page` (plan §34.4): one row
 * per character, asked a page at a time, narrowed by the server.
 *
 * Mounted whole in the dock (happy-dom lays nothing out, so the view measures
 * compact and opening a card's detail replaces the list). The socket, the
 * interest registry and the two contexts that own the page events are stood in
 * for and recorded; the heavy children (the form, the creator, the detail
 * panel) are stubbed — they have their own tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const {
	emitted,
	socket,
	listeners,
	listen,
	requested,
	pageListeners,
	failListeners
} = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		},
		/** Every `requestWithInterest`, with the handler its reply goes to. */
		requested: [] as Array<{
			event: string
			params: any
			handler: (msg: any) => void
		}>,
		pageListeners: [] as Array<(msg: any) => void>,
		failListeners: [] as Array<(msg: any) => void>
	}
})

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket,
	typedSocketOrNull: () => socket
}))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (
		event: string,
		params: unknown,
		handler: (msg: any) => void
	) => {
		requested.push({ event, params, handler })
		return () => {}
	},
	onConnect: () => () => {}
}))
vi.mock("$lib/client/contexts/characterRows.svelte", () => ({
	onCharactersPage: (l: (msg: any) => void) => pageListeners.push(l),
	onCharactersPageFailed: (l: (msg: any) => void) => failListeners.push(l)
}))
vi.mock("$lib/client/contexts/characterImports.svelte", () => ({
	onCardImported: () => {},
	onImportResolved: () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		warning: () => {},
		info: () => {},
		success: () => {}
	}
}))
vi.mock("../characterForms/CharacterForm.svelte", () => ({
	default: () => {}
}))
vi.mock("../modals/CharacterCreatorModal.svelte", () => ({
	default: () => {}
}))
vi.mock("../characterForms/CharacterViewPanel.svelte", () => ({
	default: () => {}
}))

import CharactersSidebar from "./CharactersSidebar.svelte"
import {
	CHARACTER_ROWS_STALE_CURSOR,
	type CharacterRow
} from "$lib/shared/characters/characterRows"

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
	return {
		rowKey: "card:1",
		hasCard: true,
		cardId: 1,
		castMemberId: null,
		cardIsMine: true,
		shownName: "Brix",
		nickname: null,
		summary: "The station's crew support.",
		face: null,
		reach: { lorebookCount: 2, lorebook: null },
		hasOwnWords: false,
		isFavorite: false,
		isPersona: false,
		isDefaultPersona: false,
		embeddingModel: null,
		folderId: null,
		isSharedWithMe: false,
		ownerName: null,
		readableMember: null,
		tags: [{ name: "crew", colorPreset: null }],
		...over
	}
}

const own = () => makeRow()
const foldered = () =>
	makeRow({
		rowKey: "card:2",
		cardId: 2,
		shownName: "Mira",
		summary: "",
		folderId: 5,
		tags: []
	})
const member = () =>
	makeRow({
		rowKey: "member:9",
		hasCard: false,
		cardId: null,
		castMemberId: 9,
		cardIsMine: false,
		shownName: "Zed",
		summary: "",
		tags: [],
		reach: {
			lorebookCount: 1,
			lorebook: {
				id: 4,
				name: "Vale",
				sessionId: null,
				sessionName: null
			}
		}
	})
const shared = () =>
	makeRow({
		rowKey: "card:3",
		cardId: 3,
		cardIsMine: false,
		isSharedWithMe: true,
		ownerName: "Kit",
		shownName: "Ora",
		summary: "",
		tags: []
	})
const bookOnly = () =>
	makeRow({
		rowKey: "card:4",
		cardId: 4,
		cardIsMine: false,
		shownName: "Quill",
		summary: "",
		tags: [],
		readableMember: { castMemberId: 11, lorebookId: 6 }
	})

const text = (el: Element) => el.textContent?.replace(/\s+/g, " ") ?? ""
const wait = (ms = 50) => new Promise((r) => setTimeout(r, ms))
async function settle() {
	for (let i = 0; i < 4; i++) await tick()
	flushSync()
}
function hear(key: string, msg: unknown) {
	for (const handler of [...(listeners.get(key) ?? [])]) handler(msg)
	flushSync()
}
const pageAsks = () =>
	emitted.filter(([event]) => event === "characters:page").map(([, p]) => p)
const lastAsk = () => pageAsks().at(-1)
/** Answers the latest page ask (or the id given). */
function reply(
	rows: CharacterRow[],
	nextCursor: string | null = null,
	requestId?: string
) {
	const id = requestId ?? lastAsk().requestId
	for (const l of [...pageListeners]) l({ rows, nextCursor, requestId: id })
	flushSync()
}
function refuse(error: string, requestId?: string) {
	const id = requestId ?? lastAsk().requestId
	for (const l of [...failListeners]) l({ error, requestId: id })
	flushSync()
}

let target: HTMLElement
let view: Record<string, any>
let opened: Array<Record<string, unknown>>
let panels: { digest: Record<string, any>; [k: string]: any }

beforeEach(async () => {
	emitted.length = 0
	listeners.clear()
	requested.length = 0
	pageListeners.length = 0
	failListeners.length = 0
	opened = []
	try {
		globalThis.localStorage?.removeItem?.(
			"serene-pub:viewMode:charactersSidebar"
		)
	} catch {
		// No storage: the toggle starts at its default either way.
	}
	// A `$state` proxy, so the view's writes to `digest` land on this object.
	const fresh = $state({
		digest: {} as Record<string, any>,
		viewWidth: "dock",
		openPanel: (o: Record<string, unknown>) => opened.push(o),
		openView: () => {}
	})
	panels = fresh
	target = document.createElement("div")
	document.body.appendChild(target)
	view = mount(CharactersSidebar, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", panels],
			["systemSettingsCtx", { settings: {} }],
			["userSettingsCtx", { settings: {} }]
		])
	})
	flushSync()
	await settle()
})

afterEach(() => {
	vi.useRealTimers()
	unmount(view)
	target.remove()
	document.body.innerHTML = ""
})

/** Opens the filter popout. */
async function openFilter() {
	const trigger = target.querySelector(
		'button[aria-label="Filter characters"]'
	) as HTMLElement
	trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
	trigger.click()
	await wait()
	flushSync()
}
const radio = (name: string) =>
	[...document.body.querySelectorAll('[role="radio"]')].find(
		(r) => r.textContent?.trim() === name
	) as HTMLElement
async function pick(name: string) {
	await openFilter()
	radio(name).click()
	await settle()
}
const clearChip = (label: string) =>
	target.querySelector(
		`button[aria-label="Clear filter: ${label}"]`
	) as HTMLElement | null
const rowButton = (name: string) =>
	[...target.querySelectorAll('button[title="Go to character"]')].find((b) =>
		b.getAttribute("aria-label")?.includes(name)
	) as HTMLElement
/** Opens a row's menu; returns its items' elements. */
async function openRowMenu(name: string) {
	const item = rowButton(name).closest(".rounded-lg")!
	const trigger = item.querySelector(
		'button[aria-label="Character options"]'
	) as HTMLElement
	trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
	trigger.click()
	await wait()
	flushSync()
	const menu = document.getElementById(trigger.getAttribute("aria-controls")!)
	return [
		...(menu?.querySelectorAll('[role="menuitem"]') ?? [])
	] as HTMLElement[]
}
const labels = (items: HTMLElement[]) => items.map((m) => m.textContent?.trim())

describe("the Characters view reads characters:page", () => {
	test("mount asks for the first page with a request id and no characters:list", () => {
		const asks = pageAsks()
		expect(asks).toHaveLength(1)
		expect(asks[0].requestId).toMatch(/^chr-page-\d+$/)
		expect(asks[0].limit).toBe(50)
		expect(asks[0].cursor).toBeUndefined()
		expect(emitted.some(([e]) => e === "characters:list")).toBe(false)
	})

	test("a reply draws a card row with the Card badge and its reach line, a member's row without", async () => {
		reply([own(), member()])
		await settle()
		const brix = rowButton("Brix").closest(".rounded-lg")!
		expect(brix.querySelector('[data-badge="surface"]')?.textContent).toBe(
			"Card"
		)
		expect(text(brix)).toContain("In 2 lorebooks")
		const zed = rowButton("Zed").closest(".rounded-lg")!
		expect(zed.querySelector("[data-badge]")).toBeNull()
		expect(text(zed)).toContain("In Vale")
	})

	test("groups run own, folder, Only in lorebooks, Shared with you", async () => {
		hear("characterFolders:list", { folders: [{ id: 5, name: "Crew" }] })
		reply([shared(), member(), foldered(), own(), bookOnly()])
		await settle()
		const body = text(target)
		const at = (s: string) => body.indexOf(s)
		expect(at("Brix")).toBeGreaterThan(-1)
		expect(at("Brix")).toBeLessThan(at("Crew"))
		expect(at("Crew")).toBeLessThan(at("Mira"))
		expect(at("Mira")).toBeLessThan(at("Only in lorebooks"))
		expect(at("Only in lorebooks")).toBeLessThan(at("Zed"))
		expect(at("Zed")).toBeLessThan(at("Quill"))
		expect(at("Quill")).toBeLessThan(at("Shared with you"))
		expect(at("Shared with you")).toBeLessThan(at("Ora"))
	})

	test("a reply for another request id is ignored", async () => {
		reply([own()], null, "chr-page-nope")
		await settle()
		expect(text(target)).not.toContain("Brix")
	})

	test("Load more asks with the cursor and appends, skipping a row already there", async () => {
		reply([own()], "c1")
		await settle()
		const more = [...target.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Load more"
		) as HTMLElement
		more.click()
		await settle()
		const ask = lastAsk()
		expect(ask.cursor).toBe("c1")
		reply([own(), member()], null)
		await settle()
		const body = text(target)
		expect(body).toContain("Zed")
		expect(
			target.querySelectorAll('button[title="Go to character"]')
		).toHaveLength(2)
		expect(
			[...target.querySelectorAll("button")].some(
				(b) => b.textContent?.trim() === "Load more"
			)
		).toBe(false)
	})

	test("a stale cursor asks page one again; any other refusal asks nothing", async () => {
		reply([own()], "c1")
		await settle()
		;(
			[...target.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Load more"
			) as HTMLElement
		).click()
		await settle()
		const before = pageAsks().length
		refuse("The model fell over.")
		await settle()
		expect(pageAsks()).toHaveLength(before)
		;(
			[...target.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Load more"
			) as HTMLElement
		).click()
		await settle()
		expect(pageAsks()).toHaveLength(before + 1)
		refuse(CHARACTER_ROWS_STALE_CURSOR)
		await settle()
		expect(pageAsks()).toHaveLength(before + 2)
		expect(lastAsk().cursor).toBeUndefined()
	})

	test("a characters:list push asks page one again, coalesced", async () => {
		reply([own()])
		await settle()
		const before = pageAsks().length
		vi.useFakeTimers()
		hear("characters:list", { characterList: [] })
		hear("characters:list", { characterList: [] })
		expect(pageAsks()).toHaveLength(before)
		vi.advanceTimersByTime(200)
		expect(pageAsks()).toHaveLength(before + 1)
		expect(lastAsk().cursor).toBeUndefined()
		expect(lastAsk().limit).toBe(50)
	})
})

describe("the filters narrow the ask", () => {
	test.each([
		["Has a card", { hasCard: true }],
		["No card", { hasCard: false }],
		["Follows its card", { follows: "card" }],
		["Has its own words", { follows: "own" }],
		["Favorites", { favorites: true }],
		["Personas", { personas: true }],
		["crew", { tags: ["crew"] }]
	])(
		"%s re-asks with its key, shows its chip, and clearing re-asks without it",
		async (label, expected) => {
			reply([own()])
			await settle()
			await pick(label)
			expect(lastAsk().filters).toEqual(expected)
			const chip = clearChip(label)
			expect(chip).not.toBeNull()
			chip!.click()
			await settle()
			expect(lastAsk().filters).toEqual({})
			expect(clearChip(label)).toBeNull()
		}
	)

	test("a lorebook pick asks with its id and its chip says the book's name", async () => {
		reply([own()])
		await settle()
		await openFilter()
		const ask = requested.find((r) => r.event === "lorebooks:list")!
		expect(ask).toBeDefined()
		ask.handler({
			lorebookList: [
				{ id: 9, name: "Zeta" },
				{ id: 4, name: "Vale" }
			]
		})
		await settle()
		const names = [...document.body.querySelectorAll('[role="radio"]')].map(
			(r) => r.textContent?.trim()
		)
		expect(names.indexOf("Vale")).toBeLessThan(names.indexOf("Zeta"))
		radio("Vale").click()
		await settle()
		expect(lastAsk().filters).toEqual({ lorebookId: 4 })
		const chip = clearChip("Vale")
		expect(chip).not.toBeNull()
		chip!.click()
		await settle()
		expect(lastAsk().filters).toEqual({})
	})

	test("In my stories asks with inMyStories, offers a Story group, and off clears the Story pick", async () => {
		reply([own()])
		await settle()
		await openFilter()
		const sw = document.body.querySelector('[role="switch"]') as HTMLElement
		expect(sw.getAttribute("aria-checked")).toBe("false")
		sw.click()
		await settle()
		expect(lastAsk().filters).toEqual({ inMyStories: true })
		expect(clearChip("In my stories")).not.toBeNull()
		requested
			.find((r) => r.event === "sessions:list")!
			.handler({ sessionList: [{ id: 30, name: "Salt road" }] })
		await settle()
		radio("Salt road").click()
		await settle()
		expect(lastAsk().filters).toEqual({ inMyStories: true, sessionId: 30 })
		expect(clearChip("Salt road")).not.toBeNull()
		clearChip("In my stories")!.click()
		await settle()
		expect(lastAsk().filters).toEqual({})
		expect(clearChip("Salt road")).toBeNull()
	})
})

describe("what a row opens and offers", () => {
	test("a cast member's row opens it in Lorebooks", async () => {
		reply([member()])
		await settle()
		rowButton("Zed").click()
		await settle()
		expect(panels.digest.lore).toEqual({
			lorebookId: 4,
			scope: "cast",
			castId: 9
		})
		expect(opened).toEqual([{ key: "lorebooks", toggle: false }])
	})

	test("someone else's book-only card opens its readable member", async () => {
		reply([bookOnly()])
		await settle()
		rowButton("Quill").click()
		await settle()
		expect(panels.digest.lore).toEqual({
			lorebookId: 6,
			scope: "cast",
			castId: 11
		})
		expect(opened).toEqual([{ key: "lorebooks", toggle: false }])
	})

	test("an own card opens the detail", async () => {
		reply([own()])
		await settle()
		expect(
			target.querySelector('section[aria-label="View character"]')
		).toBeNull()
		rowButton("Brix").click()
		await settle()
		expect(
			target.querySelector('section[aria-label="View character"]')
		).not.toBeNull()
	})

	test("Copy to my characters: a cast member and a shared card, never an own card", async () => {
		reply([own(), member(), shared()])
		await settle()
		expect(labels(await openRowMenu("Brix"))).not.toContain(
			"Copy to my characters"
		)

		const copyOf = async (name: string) => {
			const items = await openRowMenu(name)
			expect(labels(items)).toContain("Copy to my characters")
			const entry = items.find(
				(m) => m.textContent?.trim() === "Copy to my characters"
			)!
			entry.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					pointerType: "mouse"
				})
			)
			entry.click()
			await wait()
			await settle()
			return emitted
				.filter(([e]) => e === "characters:duplicate")
				.at(-1)![1]
		}
		expect(await copyOf("Zed")).toEqual({ castMemberId: 9 })
		// A refusal re-arms the verb.
		hear("characters:duplicate:error", { error: "no" })
		expect(await copyOf("Ora")).toEqual({ characterId: 3 })
	})
})

describe("the view is named Characters", () => {
	test("the toolbar and list say Characters and nothing says Character cards", async () => {
		reply([own()])
		await settle()
		expect(target.querySelector('[aria-label="Characters"]')).not.toBeNull()
		expect(
			target.querySelector('[aria-label="Characters list and drop zone"]')
		).not.toBeNull()
		expect(target.innerHTML).not.toContain("Character cards")
	})
})
