/**
 * A place's Links list (plan places-graph §10.3, B5).
 *
 * Each row is the relationship said from the place and opens into the same
 * `RelationshipFields` the canvas edits with; **Link a place** draws a new
 * one; every write goes through the one store at once. The canvas reads the
 * same store, so a change on either surface shows on the other as soon as
 * the server's push lands.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => socket }))

import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { lineOf, MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import { edgesOnLine } from "../graphs/asOf"
import type { PoolItem } from "../poolFilter"
import { BookRelationships } from "../relationships.svelte"
import PlaceLinks from "./PlaceLinks.svelte"

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()
const emitted: { event: string; params: any }[] = []
const socket = {
	connected: true,
	on(event: string, fn: Listener) {
		listeners.set(event, [...(listeners.get(event) ?? []), fn])
	},
	off(event: string, fn?: Listener) {
		if (!fn) throw new Error(`bare socket.off("${event}")`)
		listeners.set(
			event,
			(listeners.get(event) ?? []).filter((f) => f !== fn)
		)
	},
	emit(event: string, params: unknown) {
		emitted.push({ event, params })
	}
}
const push = (event: string, payload: unknown) => {
	for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
	flushSync()
}
const sent = (event: string) => emitted.filter((e) => e.event === event)

const BOOK = 12
const LOCATION = "core:entry/location"
const GUARDROOM = 40
const HALL = 41
const CRYPT = 42
const NAMES: Record<number, string> = {
	[GUARDROOM]: "The Guardroom",
	[HALL]: "The Drowned Hall",
	[CRYPT]: "The Crypt"
}

const end = (id: number) => ({
	kind: "entry" as const,
	entryId: id,
	name: NAMES[id],
	typeId: LOCATION as any
})

const rel = (
	id: number,
	over: Partial<Sockets.NarrativeGraph.NarrativeRelationship> = {}
) =>
	({
		id,
		lorebookId: BOOK,
		from: end(GUARDROOM),
		to: end(HALL),
		fromNodeId: null,
		toNodeId: null,
		fromEntryId: GUARDROOM,
		toEntryId: HALL,
		historyEntryId: null,
		sceneId: null,
		branchId: null,
		relationshipType: "leads north to",
		reverseRelationshipType: null,
		name: "",
		description: "",
		visibility: "acknowledged",
		status: "active",
		reason: null,
		embedding: null,
		embeddingModel: null,
		createdAt: "",
		updatedAt: "",
		...over
	}) as Sockets.NarrativeGraph.NarrativeRelationship

const item = (id: number): PoolItem => ({
	key: `entry#${id}`,
	id,
	kind: LOCATION,
	name: NAMES[id],
	content: "",
	keys: [],
	pinned: false,
	off: false,
	archived: false,
	machineWritten: false,
	parentKey: null,
	order: 0,
	position: 0,
	priority: 0,
	createdAt: 0,
	updatedAt: 0
})
const POOL = [item(GUARDROOM), item(HALL), item(CRYPT)]

let store: BookRelationships
let close: () => void
const mounted: ReturnType<typeof mount>[] = []

beforeEach(() => {
	listeners.clear()
	emitted.length = 0
	_resetInterestForTests()
	setInterestUser({ id: 1, isAdmin: false })
	store = new BookRelationships(socket)
	close = store.open(BOOK)
})

afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	close()
	document.body.innerHTML = ""
})

function list(relationships: Sockets.NarrativeGraph.NarrativeRelationship[]) {
	push("narrativeGraph:list", {
		lorebookId: BOOK,
		nodes: [
			{ id: 7, lorebookId: BOOK, name: "Verity" } as any
		],
		relationships,
		relationshipCounts: { castToCast: 0 },
		ungraphedSceneCount: 0,
		unresolvedCastSceneCount: 0,
		namelessBindingCount: 0,
		ungraphedUnsummarizedCount: 0,
		totalSummarizedCount: 0,
		ungraphedHistoryEntryCount: 0,
		totalDirectHistoryEntryCount: 0,
		branchCounts: []
	})
}

function render(
	placeId: number,
	opts: {
		branchId?: number | null
		line?: Line
		createPlace?: (name: string) => Promise<{ id: number; name: string }>
		pool?: PoolItem[]
		/** The place's body as the editor holds it — where an Exits line is read. */
		content?: string
	} = {}
) {
	const host = document.createElement("div")
	document.body.append(host)
	const app = mount(PlaceLinks, {
		target: host,
		props: {
			place: { id: placeId, name: NAMES[placeId] },
			lorebookId: BOOK,
			relationships: store,
			pool: opts.pool ?? POOL,
			reading: {
				branchId: opts.branchId ?? null,
				line: opts.line ?? MAIN_LINE,
				moment: undefined,
				datedBy: [],
				lineName: (id: number | null) => (id == null ? "main" : `line ${id}`)
			},
			createPlace: opts.createPlace,
			content: opts.content
		}
	})
	mounted.push(app)
	flushSync()
	return host
}

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const sentences = (host: HTMLElement) =>
	[...host.querySelectorAll("[data-place-link-sentence]")].map((el) =>
		el.textContent?.trim()
	)
const rowOf = (host: HTMLElement, id: number) =>
	host.querySelector<HTMLElement>(`[data-place-link="${id}"]`)!
const buttonIn = (root: ParentNode, text: string) =>
	[...root.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === text
	)!
const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}

describe("PlaceLinks — each row said from this place", () => {
	test("lists every relationship the place is an end of, in its own words", () => {
		list([
			rel(1, { reverseRelationshipType: "leads south to", name: "the rusted iron door" }),
			rel(2, { from: end(CRYPT), to: end(GUARDROOM), relationshipType: "leads up to" }),
			rel(3, { from: end(HALL), to: end(CRYPT) })
		])
		const host = render(GUARDROOM)
		expect(sentences(host)).toEqual([
			"The rusted iron door leads north to The Drowned Hall.",
			"One way, into here from The Crypt."
		])
		// Said from the far end, the same row reads the other way.
		const hall = render(HALL)
		expect(sentences(hall)).toContain(
			"The rusted iron door leads south to The Guardroom."
		)
	})

	test("says so while the store has not answered, and when nothing links it", () => {
		const host = render(GUARDROOM)
		expect(host.textContent).toContain("Reading this place's links")
		list([])
		expect(host.querySelector("[data-place-links-empty]")).not.toBeNull()
	})
})

describe("PlaceLinks — Link a place", () => {
	test("picks another place and draws the link through the store", async () => {
		list([])
		const host = render(GUARDROOM)
		host.querySelector<HTMLButtonElement>("[data-place-link-add]")!.click()
		flushSync()
		const form = host.querySelector<HTMLElement>("[data-place-link-new]")!
		expect(form).not.toBeNull()
		// Nothing to link to yet: the button says what is missing.
		const submit = form.querySelector<HTMLButtonElement>("[data-place-link-submit]")!
		expect(submit.disabled).toBe(true)

		form.querySelector<HTMLButtonElement>('button[aria-label="Show The other place options"]')!.click()
		await settle()
		const options = [
			...document.querySelectorAll<HTMLElement>('[role="listbox"][data-state="open"] [role="option"]')
		]
		expect(options.map((o) => o.textContent?.trim())).toEqual([
			"The Crypt",
			"The Drowned Hall"
		])
		options[0].click()
		await settle()

		// The canvas's own fields, pre-filled with the first suggestion.
		expect(form.querySelector("[data-relationship-fields]")).not.toBeNull()
		type(
			form.querySelector<HTMLInputElement>('input[placeholder="the rusted iron door"]')!,
			"the trapdoor"
		)
		expect(submit.disabled).toBe(false)
		submit.click()
		flushSync()
		const [create] = sent("narrativeGraph:createRelationship")
		expect(create.params).toMatchObject({
			lorebookId: BOOK,
			from: { kind: "entry", entryId: GUARDROOM },
			to: { kind: "entry", entryId: CRYPT },
			relationshipType: "connects to",
			reverseRelationshipType: "connects to",
			name: "the trapdoor",
			branchId: null
		})

		// The server's push is what lists it — here and on every surface.
		push("narrativeGraph:createRelationship", {
			relationship: rel(9, {
				to: end(CRYPT),
				relationshipType: "connects to",
				reverseRelationshipType: "connects to",
				name: "the trapdoor"
			})
		})
		await settle()
		expect(host.querySelector("[data-place-link-new]")).toBeNull()
		expect(sentences(host)).toEqual(["The trapdoor connects to The Crypt."])
	})

	test("New place… writes the place, then links it", async () => {
		list([])
		const createPlace = vi.fn(async (name: string) => ({ id: 77, name }))
		const host = render(GUARDROOM, { createPlace })
		host.querySelector<HTMLButtonElement>("[data-place-link-add]")!.click()
		flushSync()
		const form = host.querySelector<HTMLElement>("[data-place-link-new]")!
		form.querySelector<HTMLButtonElement>('button[aria-label="Show The other place options"]')!.click()
		await settle()
		const fresh = [
			...document.querySelectorAll<HTMLElement>('[role="listbox"][data-state="open"] [role="option"]')
		].find((o) => o.textContent?.trim() === "New place…")!
		fresh.click()
		await settle()
		const submit = form.querySelector<HTMLButtonElement>("[data-place-link-submit]")!
		expect(submit.disabled).toBe(true)
		type(form.querySelector<HTMLInputElement>("[data-place-link-new-name]")!, "The Cistern")
		expect(submit.textContent?.trim()).toBe("Create and link")
		submit.click()
		await settle()
		expect(createPlace).toHaveBeenCalledWith("The Cistern")
		const [create] = sent("narrativeGraph:createRelationship")
		expect(create.params.to).toEqual({ kind: "entry", entryId: 77 })
	})
})

describe("PlaceLinks — a row edits and unlinks through the store", () => {
	test("opens into the canvas's fields and saves at once, with the line", async () => {
		list([rel(1)])
		const host = render(GUARDROOM)
		rowOf(host, 1).querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()
		flushSync()
		const row = rowOf(host, 1)
		expect(row.querySelector("[data-relationship-fields]")).not.toBeNull()
		const save = row.querySelector<HTMLButtonElement>("[data-place-link-save]")!
		// Nothing changed yet, so nothing to save.
		expect(save.disabled).toBe(true)
		type(
			row.querySelector<HTMLInputElement>('input[placeholder="the rusted iron door"]')!,
			"the rusted iron door"
		)
		save.click()
		flushSync()
		const [update] = sent("narrativeGraph:updateRelationship")
		expect(update.params).toMatchObject({
			relationship: { id: 1, name: "the rusted iron door" },
			branchId: null
		})
		// Never the ends: the editor does not move a relationship.
		expect(update.params.relationship.from).toBeUndefined()
		push("narrativeGraph:updateRelationship", {
			relationship: rel(1, { name: "the rusted iron door" })
		})
		await settle()
		expect(sentences(host)).toEqual([
			"The rusted iron door leads north to The Drowned Hall."
		])
		expect(rowOf(host, 1).querySelector("[data-relationship-fields]")).toBeNull()
	})

	test("unlinks after asking, and the push takes the row away", () => {
		list([rel(1), rel(2, { to: end(CRYPT) })])
		const host = render(GUARDROOM)
		rowOf(host, 2).querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()
		flushSync()
		rowOf(host, 2).querySelector<HTMLButtonElement>("[data-place-link-unlink]")!.click()
		flushSync()
		expect(rowOf(host, 2).textContent).toContain("Unlink The Crypt?")
		expect(sent("narrativeGraph:deleteRelationship")).toHaveLength(0)
		rowOf(host, 2).querySelector<HTMLButtonElement>("[data-place-link-confirm-unlink]")!.click()
		flushSync()
		expect(sent("narrativeGraph:deleteRelationship")[0].params).toEqual({
			id: 2,
			branchId: null
		})
		push("narrativeGraph:deleteRelationship", { id: 2, lorebookId: BOOK })
		expect(host.querySelector('[data-place-link="2"]')).toBeNull()
		expect(sentences(host)).toEqual(["Leads north to The Drowned Hall."])
	})

	test("a row another line owns is read-only, naming the line to open", () => {
		list([rel(1), rel(2, { branchId: 5, to: end(CRYPT) })])
		const host = render(GUARDROOM, {
			branchId: 5,
			line: lineOf(5, [{ id: 5, forkedFromBranchId: null }])
		})
		rowOf(host, 1).querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()
		flushSync()
		const row = rowOf(host, 1)
		expect(row.querySelector("[data-link-locked]")?.textContent?.trim()).toBe(
			"This link belongs to main. Open that line to change it."
		)
		expect(row.querySelector("[data-relationship-fields]")).toBeNull()
		expect(row.querySelector("[data-place-link-unlink]")).toBeNull()
		// The fork's own row is the fork's to change.
		rowOf(host, 2).querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()
		flushSync()
		expect(rowOf(host, 2).querySelector("[data-relationship-fields]")).not.toBeNull()
	})
})

/**
 * Review round. An open row follows an edit made elsewhere while nothing is
 * typed in it, and says so — rather than letting Save quietly put the old
 * values back — once something is. Unlink waits for the server.
 */
describe("PlaceLinks — an open row and edits made elsewhere", () => {
	const nameField = (row: HTMLElement) =>
		row.querySelector<HTMLInputElement>('input[placeholder="the rusted iron door"]')!
	const open = (host: HTMLElement, id: number) => {
		rowOf(host, id).querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()
		flushSync()
		return rowOf(host, id)
	}

	test("follows the canvas's edit while nothing is typed here", async () => {
		list([rel(1)])
		const host = render(GUARDROOM)
		open(host, 1)
		push("narrativeGraph:updateRelationship", {
			relationship: rel(1, { name: "the canvas door" })
		})
		await settle()
		const row = rowOf(host, 1)
		expect(nameField(row).value).toBe("the canvas door")
		expect(row.querySelector("[data-place-link-stale]")).toBeNull()
		// Nothing of this row's own to save: Save does not revert the canvas.
		expect(row.querySelector<HTMLButtonElement>("[data-place-link-save]")!.disabled).toBe(true)
	})

	test("keeps what was typed here and says the link changed elsewhere", async () => {
		list([rel(1)])
		const host = render(GUARDROOM)
		type(nameField(open(host, 1)), "my door")
		push("narrativeGraph:updateRelationship", {
			relationship: rel(1, { name: "the canvas door" })
		})
		await settle()
		const row = rowOf(host, 1)
		expect(nameField(row).value).toBe("my door")
		expect(row.querySelector("[data-place-link-stale]")?.textContent).toContain(
			"changed elsewhere"
		)
	})

	test("an unlink the server refuses says why in the row and keeps it", async () => {
		list([rel(1)])
		const host = render(GUARDROOM)
		open(host, 1).querySelector<HTMLButtonElement>("[data-place-link-unlink]")!.click()
		flushSync()
		const confirm = rowOf(host, 1).querySelector<HTMLButtonElement>(
			"[data-place-link-confirm-unlink]"
		)!
		confirm.click()
		flushSync()
		// On its way: a second press sends nothing.
		expect(confirm.disabled).toBe(true)
		push("narrativeGraph:deleteRelationship:error", {
			error: "This relationship belongs to main. Open that line to change it."
		})
		await settle()
		expect(sent("narrativeGraph:deleteRelationship")).toHaveLength(1)
		expect(rowOf(host, 1).querySelector("[data-place-link-error]")?.textContent).toContain(
			"belongs to main"
		)
	})
})

describe("PlaceLinks — a far end archived at the moment", () => {
	test("is listed last, badged, and not counted, as the canvas leaves it out", () => {
		list([rel(1), rel(2, { to: end(CRYPT) })])
		const pool = POOL.map((p) =>
			p.id === HALL ? { ...p, archived: true } : p
		)
		const host = render(GUARDROOM, { pool })
		const rows = [...host.querySelectorAll<HTMLElement>("[data-place-link]")]
		expect(rows.map((r) => r.dataset.placeLink)).toEqual(["2", "1"])
		expect(rowOf(host, 1).hasAttribute("data-link-archived")).toBe(true)
		expect(rowOf(host, 1).textContent).toContain("archived")
		expect(host.querySelector("h4")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Links 1"
		)
	})
})

describe("PlaceLinks — one store, two surfaces", () => {
	test("a link written on the canvas shows here at once, and one written here reaches the canvas", async () => {
		list([rel(1)])
		// The canvas's read of the same store: the line's relationships.
		let canvas: Sockets.NarrativeGraph.NarrativeRelationship[] = []
		const stop = $effect.root(() => {
			$effect(() => {
				canvas = edgesOnLine(store.all, MAIN_LINE, [])
			})
		})
		flushSync()
		const guardroom = render(GUARDROOM)
		const hall = render(HALL)

		// The canvas draws a link (its own create), and the push lands.
		void store
			.create({
				lorebookId: BOOK,
				from: { kind: "entry", entryId: CRYPT },
				to: { kind: "entry", entryId: GUARDROOM },
				relationshipType: "is inside",
				reverseRelationshipType: "holds",
				status: "active",
				visibility: "acknowledged",
				branchId: null
			})
			.catch(() => {})
		push("narrativeGraph:createRelationship", {
			relationship: rel(3, {
				from: end(CRYPT),
				to: end(GUARDROOM),
				relationshipType: "is inside",
				reverseRelationshipType: "holds"
			})
		})
		expect(sentences(guardroom)).toContain("Holds The Crypt.")

		// The place editor rewords a row; the push reaches the canvas, and the
		// far end's editor reads it from its own side.
		rowOf(guardroom, 1).querySelector<HTMLButtonElement>("button[aria-expanded]")!.click()
		flushSync()
		const bothWays = rowOf(guardroom, 1).querySelector<HTMLInputElement>(
			'[data-relationship-fields] input[placeholder="the rusted iron door"]'
		)!
		type(bothWays, "the stair")
		rowOf(guardroom, 1).querySelector<HTMLButtonElement>("[data-place-link-save]")!.click()
		flushSync()
		expect(sent("narrativeGraph:updateRelationship")).toHaveLength(1)
		push("narrativeGraph:updateRelationship", {
			relationship: rel(1, { name: "the stair", reverseRelationshipType: "leads down to" })
		})
		await settle()
		expect(canvas.find((r) => r.id === 1)?.name).toBe("the stair")
		expect(sentences(hall)).toContain("The stair leads down to The Guardroom.")
		expect(sentences(guardroom)).toContain("The stair leads north to The Drowned Hall.")
		stop()
	})
})

/**
 * B7: **Read links from the Exits line** — a room's prose `Exits:` line (as
 * the Lair's drafts still write it) read on request into the links it
 * names. Nothing is written until the person confirms; a way already linked
 * is not offered again; a name no place answers to is offered as a new place.
 */
describe("PlaceLinks — Read links from the Exits line", () => {
	const ROOM =
		"A low stone room by the gate.\n\nExits: north → The Drowned Hall, down -> the crypt, west → The Old Well\nContents: a brazier."
	const readButton = (host: HTMLElement) =>
		host.querySelector<HTMLButtonElement>("[data-exits-read]")
	const panel = (host: HTMLElement) =>
		host.querySelector<HTMLElement>("[data-exits-links]")!
	const ways = (host: HTMLElement) =>
		[...panel(host).querySelectorAll<HTMLElement>("[data-exits-link]")].map(
			(row) => ({
				state: row.dataset.exitsState,
				sentence: row.querySelector("[data-exits-sentence]")?.textContent?.trim(),
				ticked: row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? null
			})
		)
	const confirm = (host: HTMLElement) =>
		panel(host).querySelector<HTMLButtonElement>("[data-exits-confirm]")!
	const tick = (host: HTMLElement, index: number) => {
		panel(host)
			.querySelectorAll<HTMLElement>("[data-exits-link]")
			[index].querySelector<HTMLInputElement>('input[type="checkbox"]')!
			.click()
		flushSync()
	}
	/** Answer the newest create the way the server's push does. */
	const answerCreate = (id: number, from: number, to: number) => {
		const params = sent("narrativeGraph:createRelationship").at(-1)!.params
		push("narrativeGraph:createRelationship", {
			relationship: rel(id, {
				from: end(from),
				to: end(to),
				fromEntryId: from,
				toEntryId: to,
				relationshipType: params.relationshipType,
				reverseRelationshipType: params.reverseRelationshipType ?? null,
				name: params.name ?? ""
			})
		})
	}

	test("is offered only when the body has an Exits line", () => {
		list([])
		expect(readButton(render(GUARDROOM, { content: "A room, no ways written." }))).toBeNull()
		const host = render(GUARDROOM, { content: ROOM })
		expect(readButton(host)?.textContent?.trim()).toBe("Read links from the Exits line")
	})

	test("previews each way, found by the room rule, and writes nothing until confirmed", () => {
		list([])
		const host = render(GUARDROOM, { content: ROOM, createPlace: async (name) => ({ id: 90, name }) })
		readButton(host)!.click()
		flushSync()
		expect(panel(host).textContent).toContain("north → The Drowned Hall")
		expect(ways(host)).toEqual([
			{ state: "ready", sentence: "Leads north to The Drowned Hall.", ticked: true },
			{ state: "ready", sentence: "Leads down to The Crypt.", ticked: true },
			// No place is called that: offered as a new place, never ticked for you.
			{ state: "unresolved", sentence: "Leads west to The Old Well.", ticked: false }
		])
		expect(panel(host).textContent).toContain("New place")
		expect(confirm(host).textContent?.trim()).toBe("Link 2")
		// Cancel sends nothing.
		buttonIn(panel(host), "Cancel").click()
		flushSync()
		expect(host.querySelector("[data-exits-links]")).toBeNull()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(0)
		expect(sent("entries:create")).toHaveLength(0)
	})

	test("links the ticked ways one at a time, one way, in the line's words", async () => {
		list([])
		const host = render(GUARDROOM, { content: ROOM })
		readButton(host)!.click()
		flushSync()
		tick(host, 1) // leave the crypt out
		expect(confirm(host).textContent?.trim()).toBe("Link 1")
		confirm(host).click()
		await settle()
		const creates = sent("narrativeGraph:createRelationship")
		expect(creates).toHaveLength(1)
		expect(creates[0].params).toEqual({
			lorebookId: BOOK,
			from: { kind: "entry", entryId: GUARDROOM },
			to: { kind: "entry", entryId: HALL },
			relationshipType: "leads north to",
			status: "active",
			visibility: "acknowledged",
			branchId: null
		})
		answerCreate(20, GUARDROOM, HALL)
		await settle()
		expect(host.querySelector("[data-exits-links]")).toBeNull()
		expect(sentences(host)).toEqual(["Leads north to The Drowned Hall."])
	})

	test("sends the next link only once the last one is answered", async () => {
		list([])
		const host = render(GUARDROOM, { content: ROOM })
		readButton(host)!.click()
		flushSync()
		confirm(host).click()
		await settle()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(1)
		answerCreate(20, GUARDROOM, HALL)
		await settle()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(2)
		expect(sent("narrativeGraph:createRelationship")[1].params.to).toEqual({
			kind: "entry",
			entryId: CRYPT
		})
		answerCreate(21, GUARDROOM, CRYPT)
		await settle()
		expect(host.querySelector("[data-exits-links]")).toBeNull()
	})

	test("a new place ticked is made once by name, then linked", async () => {
		list([])
		const createPlace = vi.fn(async (name: string) => ({ id: 90, name }))
		const host = render(GUARDROOM, {
			content: "Exits: west → The Old Well, down → the old well",
			createPlace
		})
		readButton(host)!.click()
		flushSync()
		expect(confirm(host).disabled).toBe(true)
		tick(host, 0)
		tick(host, 1)
		expect(confirm(host).textContent?.trim()).toBe("Create and link 2")
		confirm(host).click()
		await settle()
		expect(createPlace).toHaveBeenCalledTimes(1)
		expect(createPlace).toHaveBeenCalledWith("The Old Well")
		expect(sent("narrativeGraph:createRelationship")[0].params.to).toEqual({
			kind: "entry",
			entryId: 90
		})
		answerCreate(30, GUARDROOM, 90)
		await settle()
		expect(createPlace).toHaveBeenCalledTimes(1)
		expect(sent("narrativeGraph:createRelationship")[1].params).toMatchObject({
			to: { kind: "entry", entryId: 90 },
			relationshipType: "leads down to"
		})
	})

	test("is idempotent: a way already linked is shown, not offered, and nothing is sent", () => {
		list([
			rel(1),
			rel(2, { to: end(CRYPT), toEntryId: CRYPT, relationshipType: "leads down to" })
		])
		const host = render(GUARDROOM, {
			content: "Exits: north → The Drowned Hall, down → The Crypt"
		})
		readButton(host)!.click()
		flushSync()
		expect(ways(host)).toEqual([
			{ state: "linked", sentence: "Leads north to The Drowned Hall.", ticked: null },
			{ state: "linked", sentence: "Leads down to The Crypt.", ticked: null }
		])
		expect(panel(host).textContent).toContain("Already linked")
		expect(confirm(host).disabled).toBe(true)
		confirm(host).click()
		flushSync()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(0)
	})

	test("a way to a place already joined another way is offered unticked, with the link that stands", () => {
		list([rel(1, { relationshipType: "leads to", reverseRelationshipType: "leads to" })])
		const host = render(GUARDROOM, { content: "Exits: north → The Drowned Hall" })
		readButton(host)!.click()
		flushSync()
		expect(ways(host)).toEqual([
			{ state: "joined", sentence: "Leads north to The Drowned Hall.", ticked: false }
		])
		expect(panel(host).textContent).toContain("Leads to The Drowned Hall.")
	})

	test("a link the server refuses says why on its way and keeps the panel open", async () => {
		list([])
		const host = render(GUARDROOM, { content: "Exits: north → The Drowned Hall" })
		readButton(host)!.click()
		flushSync()
		confirm(host).click()
		await settle()
		push("narrativeGraph:createRelationship:error", { error: "Branch not found in this lorebook." })
		await settle()
		expect(panel(host).querySelector("[data-exits-error]")?.textContent).toContain(
			"Branch not found"
		)
		expect(ways(host)[0].state).toBe("ready")
	})

	// ── The review round (2026-09-29): the reviewer's probes P1–P6 ──────────

	test("is offered only once the store has read the place's links, so a way already joined is never ticked for you (P1)", async () => {
		const host = render(GUARDROOM, { content: "Exits: north → The Drowned Hall" })
		expect(readButton(host)).toBeNull()
		// Answer the door's both-ways link arrives with the list.
		list([rel(1, { relationshipType: "leads to", reverseRelationshipType: "leads to" })])
		await settle()
		readButton(host)!.click()
		flushSync()
		expect(ways(host)).toEqual([
			{ state: "joined", sentence: "Leads north to The Drowned Hall.", ticked: false }
		])
		expect(confirm(host).disabled).toBe(true)
	})

	test("is not offered while the store's read has failed (P6)", () => {
		list([])
		store.load()
		push("narrativeGraph:list:error", { error: "The graph could not be read." })
		const host = render(GUARDROOM, { content: "Exits: north → The Drowned Hall" })
		expect(store.error).toBeTruthy()
		expect(readButton(host)).toBeNull()
	})

	test("a way ticked for you drops its tick when another link comes to join the two; one you ticked keeps it", async () => {
		list([])
		const host = render(GUARDROOM, {
			content: "Exits: north → The Drowned Hall, down → The Crypt"
		})
		readButton(host)!.click()
		flushSync()
		// Untick and tick the crypt again: now it is the person's own tick.
		tick(host, 1)
		tick(host, 1)
		// Links written elsewhere (the canvas, Answer the door) land.
		const both = { relationshipType: "leads to", reverseRelationshipType: "leads to" }
		push("narrativeGraph:createRelationship", { relationship: rel(5, both) })
		push("narrativeGraph:createRelationship", {
			relationship: rel(6, { ...both, to: end(CRYPT), toEntryId: CRYPT })
		})
		await settle()
		expect(ways(host)).toEqual([
			{ state: "joined", sentence: "Leads north to The Drowned Hall.", ticked: false },
			{ state: "joined", sentence: "Leads down to The Crypt.", ticked: true }
		])
		expect(confirm(host).textContent?.trim()).toBe("Link 1")
	})

	test("reads ways joined by 'and' as two, and offers no junk place (P4)", () => {
		list([])
		const createPlace = vi.fn(async (name: string) => ({ id: 91, name }))
		const host = render(GUARDROOM, {
			content: "Exits: north → The Drowned Hall and down → The Crypt",
			createPlace
		})
		readButton(host)!.click()
		flushSync()
		expect(ways(host)).toEqual([
			{ state: "ready", sentence: "Leads north to The Drowned Hall.", ticked: true },
			{ state: "ready", sentence: "Leads down to The Crypt.", ticked: true }
		])
	})

	test("a name holding a comma links the place called that, not the one before its comma (P5)", () => {
		list([])
		const pool = [
			item(GUARDROOM),
			{ ...item(HALL), name: "The Hall" },
			{ ...item(CRYPT), name: "The Hall, East Wing" }
		]
		const host = render(GUARDROOM, { content: "Exits: north → The Hall, East Wing", pool })
		readButton(host)!.click()
		flushSync()
		expect(ways(host)).toEqual([
			{ state: "ready", sentence: "Leads north to The Hall, East Wing.", ticked: true }
		])
	})

	test("two places a name answers alike: neither ticked for you, and the view says why", () => {
		list([])
		const pool = [item(GUARDROOM), item(HALL), { ...item(CRYPT), name: "The Drowned Hall" }]
		const host = render(GUARDROOM, { content: "Exits: north → The Drowned Hall", pool })
		readButton(host)!.click()
		flushSync()
		expect(ways(host)).toEqual([
			{ state: "ready", sentence: "Leads north to The Drowned Hall.", ticked: false }
		])
		const note = panel(host).querySelector<HTMLElement>("[data-exits-namesakes]")!
		expect(note.textContent?.replace(/\s+/g, " ").trim()).toBe(
			"Another place is also called “The Drowned Hall”, so this is not ticked for you. To choose which one is linked, use Link a place."
		)
		const box = panel(host).querySelector<HTMLInputElement>('input[type="checkbox"]')!
		expect(box.getAttribute("aria-describedby")).toBe(note.id)
	})

	test("a refusal after a new place is made stays on its way, still ticked (P2)", async () => {
		list([])
		const props = $state({
			place: { id: GUARDROOM, name: NAMES[GUARDROOM] },
			lorebookId: BOOK,
			relationships: store,
			pool: [...POOL] as PoolItem[],
			reading: {
				branchId: null,
				line: MAIN_LINE,
				moment: undefined,
				datedBy: [],
				lineName: () => "main"
			},
			// The workspace's pool gains the place as soon as it is made.
			createPlace: vi.fn(async (name: string) => {
				props.pool = [...props.pool, { ...item(GUARDROOM), key: "entry#90", id: 90, name }]
				return { id: 90, name }
			}),
			content: "Exits: west → The Old Well"
		})
		const host = document.createElement("div")
		document.body.append(host)
		mounted.push(mount(PlaceLinks, { target: host, props }))
		flushSync()
		readButton(host)!.click()
		flushSync()
		tick(host, 0)
		confirm(host).click()
		await settle()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(1)
		push("narrativeGraph:createRelationship:error", {
			error: "These two are already linked that way."
		})
		await settle()
		expect(panel(host).querySelector("[data-exits-error]")?.textContent).toContain(
			"already linked that way"
		)
		expect(ways(host)).toEqual([
			{ state: "ready", sentence: "Leads west to The Old Well.", ticked: true }
		])
		expect(props.createPlace).toHaveBeenCalledTimes(1)
	})

	test("Link a place while links are being written stops the rest and says what was written (P3)", async () => {
		list([])
		const host = render(GUARDROOM, {
			content: "Exits: north → The Drowned Hall, down → The Crypt"
		})
		readButton(host)!.click()
		flushSync()
		confirm(host).click()
		await settle()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(1)
		buttonIn(host, "Link a place").click()
		flushSync()
		expect(host.querySelector("[data-exits-links]")).toBeNull()
		// The link already sent still lands; the crypt is never sent.
		answerCreate(20, GUARDROOM, HALL)
		await settle()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(1)
		expect(host.querySelector("[data-exits-note]")?.textContent?.trim()).toBe(
			"Stopped: linked 1 way from the Exits line; 1 left unlinked."
		)
	})

	test("Cancel while links are being written stops the rest and says what was written", async () => {
		list([])
		const host = render(GUARDROOM, {
			content: "Exits: north → The Drowned Hall, down → The Crypt"
		})
		readButton(host)!.click()
		flushSync()
		confirm(host).click()
		await settle()
		buttonIn(panel(host), "Cancel").click()
		flushSync()
		expect(host.querySelector("[data-exits-links]")).toBeNull()
		expect(host.querySelector("[data-exits-note]")?.textContent?.trim()).toBe(
			"Stopped: nothing from the Exits line was linked; 1 left unlinked."
		)
		answerCreate(20, GUARDROOM, HALL)
		await settle()
		expect(sent("narrativeGraph:createRelationship")).toHaveLength(1)
		expect(host.querySelector("[data-exits-note]")?.textContent?.trim()).toBe(
			"Stopped: linked 1 way from the Exits line; 1 left unlinked."
		)
	})
})
