/**
 * 🚧 Edit Session — the Personas card grouped by person, S3's line, the
 * "Played by" control and the guest switches' new condition (gs-3a2).
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			},
			on: () => {},
			off: () => {}
		}
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () => {
			const rest = (listeners.get(key) ?? []).filter((h) => h !== handler)
			if (rest.length) listeners.set(key, rest)
			else listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) =>
			declareInterest(key, handler),
		requestWithInterest: (
			event: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"

beforeAll(async () => {
	await import("../modals/CharacterSelectList.svelte")
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

function deliver(key: string, msg: unknown) {
	const handlers = listeners.get(key)
	if (!handlers)
		throw new Error(
			`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`
		)
	for (const handler of handlers) handler(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"
const norm = (t: string | null | undefined) =>
	(t ?? "").replace(/\s+/g, " ").trim()
const BODY = () => norm(document.body.textContent)
const OWNER = 1
const G1 = 2
const G2 = 3
const W = 4

const guestRow = (userId: number, username: string, isPlayer = true) => ({
	sessionId: 7,
	userId,
	isPlayer,
	user: { id: userId, username, displayName: null }
})

interface Opts {
	viewerId?: number
	metadata?: Record<string, unknown>
	guests?: boolean
	/** Hide the seats a test does not need (kept: all). */
	cast?: boolean
}

/** Owner 1; G1 (2) and G2 (3) players, W (4) a watcher. */
async function openForm(o: Opts = {}) {
	const guests = o.guests ?? true
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map<string, unknown>([
			["userCtx", { user: { id: o.viewerId ?? OWNER, isAdmin: false } }],
			["systemSettingsCtx", { settings: { isAccountsEnabled: true } }]
		])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				shape: { characters: { min: 0 }, personas: { min: 0 } }
			}
		]
	})
	const seat = (over: Record<string, unknown>) => ({
		characterId: null,
		character: null,
		castMemberId: null,
		isActive: true,
		removedAt: null,
		...over
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: OWNER,
			name: "The crawl",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 5,
			metadata: o.metadata ?? {},
			sessionCharacters: [
				seat({
					id: 21,
					characterId: 51,
					character: { id: 51, name: "Orla", nickname: null, userId: OWNER },
					seatedByUserId: OWNER
				}),
				seat({
					id: 23,
					characterId: 52,
					character: { id: 52, name: "Gil", nickname: null, userId: G1 },
					seatedByUserId: G1
				}),
				seat({ id: 22, castMemberId: 31, seatedByUserId: OWNER }),
				seat({ id: 24, castMemberId: 32, seatedByUserId: G1 }),
				seat({ id: 25, castMemberId: 33, seatedByUserId: OWNER, isActive: false }),
				seat({ id: 26, castMemberId: 34, seatedByUserId: G2 })
			],
			cardlessSeatShown: {
				31: { name: "Mira", nickname: null, faceMediaId: null },
				32: { name: "Nox", nickname: null, faceMediaId: null },
				33: { name: "Pia", nickname: null, faceMediaId: null },
				34: { name: "Rex", nickname: null, faceMediaId: null }
			},
			sessionPersonas: [
				{
					id: 11,
					personaId: 61,
					persona: { id: 61, name: "Pip", description: "", userId: OWNER },
					userId: OWNER,
					isActive: true,
					removedAt: null
				},
				{
					id: 13,
					personaId: 62,
					persona: { id: 62, name: "Quin", description: "", userId: G1 },
					userId: G1,
					isActive: true,
					removedAt: null
				},
				{
					id: 12,
					personaId: null,
					persona: null,
					userId: OWNER,
					seatName: "Bo",
					isActive: true,
					removedAt: null
				}
			],
			sessionGuests: guests
				? [
						guestRow(G1, "gina"),
						guestRow(G2, "gus"),
						guestRow(W, "wes", false)
					]
				: [],
			tags: []
		}
	})
	await tick()
	flushSync()
	if (o.viewerId && o.viewerId !== OWNER)
		deliver("sessions:accountVisibility", {
			sessionId: 7,
			isOwner: false,
			isGuest: true,
			viewers: [{ userId: OWNER, username: "olga", role: "owner" }],
			exposed: { characters: [], personas: [], lorebooks: [] }
		})
}

const personasHeadings = () => {
	const card = [...document.querySelectorAll("section")].find(
		(s) => s.querySelector("h3")?.textContent?.startsWith("Personas")
	)!
	return [...card.querySelectorAll("h4")].map((h) => norm(h.textContent))
}
/** The row (card) that names a seat. */
const rowOf = (name: string): HTMLElement => {
	const hit = [...document.querySelectorAll<HTMLInputElement>("input.input")].find(
		(i) => i.value === name
	)
	if (hit) return hit.closest("li") as HTMLElement
	const named = [...document.querySelectorAll<HTMLElement>(".text-lead")].find(
		(e) => norm(e.textContent) === name
	)
	return named!.closest(".rounded-base") as HTMLElement
}
const lineOf = (name: string) =>
	norm(rowOf(name).querySelector(".text-xs")?.textContent)
const playedByIn = (row: HTMLElement) =>
	row.querySelector<HTMLButtonElement>(
		'input[role="combobox"][aria-label^="Played by, "]'
	)
		? row.querySelector<HTMLButtonElement>(
				'button[aria-label^="Show Played by, "]'
			)
		: null
/** The open list of a row's Played by: the listbox its input controls. */
const listOf = (row: HTMLElement) => {
	const id = row
		.querySelector('input[role="combobox"]')!
		.getAttribute("aria-controls")!
	return [
		...document
			.getElementById(id)!
			.querySelectorAll<HTMLElement>('[role="option"]')
	]
}
const optionsOf = async (row: HTMLElement) => {
	playedByIn(row)!.click()
	await tick()
	flushSync()
	return listOf(row).map((o) => norm(o.textContent))
}
async function pick(row: HTMLElement, label: string) {
	await optionsOf(row)
	listOf(row)
		.find((o) => norm(o.textContent) === label)!
		.click()
	await tick()
	flushSync()
}
function save() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Save"
	) as HTMLButtonElement
	button.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}
const bench = (who: string) =>
	document.querySelector(`button[aria-label="Bench ${who}"]`)
const switchInput = (name: string) =>
	document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null

describe("Edit Session — the Personas card by person", () => {
	test("the owner sees one group each for themselves, G1 and every other guest who plays, in that order", async () => {
		await openForm()
		// An empty group shows for each player guest: the owner can add a persona there (PS1, 2026-11-17).
		expect(personasHeadings()).toEqual(["You", "gina", "gus"])
		expect(rowOf("Pip")).not.toBeNull()
		expect(rowOf("Quin").closest("div[class*='flex-col']")).not.toBe(
			rowOf("Pip").closest("div[class*='flex-col']")
		)
	})

	test("a guest sees You and the owner's username, with controls only in their own group", async () => {
		await openForm({ viewerId: G1 })
		expect(personasHeadings()).toEqual(["olga", "You"])
		expect(bench("Quin")).not.toBeNull()
		expect(bench("Pip")).toBeNull()
		expect(bench("Bo")).toBeNull()
	})
})

describe("Edit Session — dragging persona seats", () => {
	const dnd = (
		zone: Element,
		type: "consider" | "finalize",
		items: object[],
		trigger: string
	) =>
		zone.dispatchEvent(
			new CustomEvent(type, {
				detail: { items, info: { trigger, id: "1", source: "pointer" } }
			})
		)
	const pip = { id: 61, name: "Pip", description: "", userId: OWNER }
	const quin = { id: 62, name: "Quin", description: "", userId: G1 }

	// The library's order for a drag from zone A over zone B and dropped there:
	// consider(A, dragStarted, items with the row), consider(A, draggedLeft,
	// without it), consider(B, draggedEntered, with it), finalize(B,
	// droppedIntoZone), finalize(A, droppedIntoAnother, A's rows without it).
	// A zone the form refuses never receives the row, so B's finalize holds
	// only B's own rows.
	const refused = async (
		fromName: string,
		fromCard: object,
		toName: string,
		toCard: object
	) => {
		await openForm()
		const from = rowOf(fromName).parentElement!
		const to = rowOf(toName).parentElement!
		dnd(from, "consider", [fromCard], "dragStarted")
		dnd(from, "consider", [], "draggedLeft")
		dnd(to, "consider", [toCard, fromCard], "draggedEnteredAnother")
		dnd(to, "finalize", [toCard], "droppedIntoZone")
		dnd(from, "finalize", [], "droppedIntoAnother")
		await tick()
		await tick()
		flushSync()
		expect(rowOf(fromName).parentElement).toBe(from)
		expect(rowOf(toName).parentElement).toBe(to)
	}

	test("my persona dropped into another person's group returns to where it was", async () => {
		await refused("Pip", pip, "Quin", quin)
	})

	test("another person's persona dropped into my group returns to where it was", async () => {
		await refused("Quin", quin, "Pip", pip)
	})

	test("a seat dragged to Benched and back works from every group", async () => {
		await openForm()
		const benched = () =>
			document.querySelector('ul[aria-label="Benched players"]')!
		const sent = () =>
			emitted
				.filter(([e]) => e === "sessions:setCastSeatEnabled")
				.map(([, p]) => p)
		for (const [name, card, id] of [
			["Pip", pip, 11],
			["Quin", quin, 13]
		] as const) {
			emitted.length = 0
			const zone = rowOf(name).parentElement!
			dnd(zone, "consider", [card], "dragStarted")
			dnd(zone, "consider", [], "draggedLeft")
			dnd(benched(), "consider", [card], "draggedEnteredAnother")
			dnd(benched(), "finalize", [card], "droppedIntoZone")
			dnd(zone, "finalize", [], "droppedIntoAnother")
			await tick()
			flushSync()
			expect(
				benched().textContent
			).toContain(name)
			// and back into the group it came from
			const bench = benched()
			dnd(bench, "consider", [card], "dragStarted")
			dnd(bench, "consider", [], "draggedLeft")
			dnd(zone, "consider", [card], "draggedEnteredAnother")
			dnd(zone, "finalize", [card], "droppedIntoZone")
			dnd(bench, "finalize", [], "droppedIntoAnother")
			await tick()
			flushSync()
			expect(rowOf(name).parentElement).toBe(zone)
			dnd(zone, "consider", [card], "dragStarted")
			dnd(zone, "consider", [], "draggedLeft")
			dnd(benched(), "consider", [card], "draggedEnteredAnother")
			dnd(benched(), "finalize", [card], "droppedIntoZone")
			dnd(zone, "finalize", [], "droppedIntoAnother")
			await tick()
			flushSync()
			save()
			expect(sent()).toContainEqual(
				expect.objectContaining({ playerSeatId: id, enabled: false })
			)
		}
	})
})

describe("Edit Session — what is said beside a character seat", () => {
	test("a guest sees no line beside an owner-seated card or member", async () => {
		await openForm({ viewerId: G2 })
		expect(lineOf("Orla")).toBe("")
		expect(lineOf("Mira")).toBe("")
	})

	test("a G1-seated member says gina's character, to the owner and to G2", async () => {
		await openForm()
		expect(lineOf("Nox")).toBe("gina's character")
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await openForm({ viewerId: G2 })
		expect(lineOf("Nox")).toBe("gina's character")
		expect(lineOf("Gil")).toBe("gina's character")
	})
})

describe("Edit Session — Played by", () => {
	test("each control's accessible name says its seat", async () => {
		await openForm()
		const names = (...seats: string[]) =>
			seats.map((n) =>
				rowOf(n)
					.querySelector('input[role="combobox"]')
					?.getAttribute("aria-label")
			)
		expect(names("Orla", "Mira", "Bo")).toEqual([
			"Played by, Orla",
			"Played by, Mira",
			"Played by, Bo"
		])
		expect(rowOf("Mira").querySelector("label")?.textContent?.trim()).toBe(
			"Played by"
		)
	})

	test("the owner's control on a member offers No one, the player guests and the moves to each person, never a watcher", async () => {
		await openForm()
		expect(await optionsOf(rowOf("Mira"))).toEqual([
			"No one",
			"gina",
			"gus",
			"You as a persona",
			"gina as a persona",
			"gus as a persona"
		])
	})

	test("a guest's carded character or persona offers only its guest and the move; absent on a benched seat", async () => {
		await openForm()
		// A guest's card is handed to no one else; the owner may move its seat (S2, MV1).
		expect(await optionsOf(rowOf("Gil"))).toEqual(["gina", "gina as a persona"])
		expect(playedByIn(rowOf("Pip"))).not.toBeNull()
		expect(await optionsOf(rowOf("Quin"))).toEqual(["gina", "No one"])
		expect(playedByIn(rowOf("Pia"))).toBeNull()
		// The owner's own card has it.
		expect(playedByIn(rowOf("Orla"))).not.toBeNull()
	})

	test("absent on a pending row", async () => {
		await openForm()
		deliver("characters:list", {
			characterList: [{ id: 8, name: "Dov", userId: OWNER }]
		})
		const add = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Add a character")
		) as HTMLButtonElement
		add.click()
		flushSync()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		;(
			[...document.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("Dov")
			) as HTMLButtonElement
		).click()
		flushSync()
		await tick()
		expect(BODY()).toContain("Ready to add")
		expect(playedByIn(rowOf("Dov"))).toBeNull()
	})

	test("present on a card-less named player seat with You and the guests", async () => {
		await openForm()
		expect(await optionsOf(rowOf("Bo"))).toEqual(["You", "gina", "gus"])
	})

	test("picking G1 then Save sends the handover; without a pick, none", async () => {
		await openForm()
		expect(save().seatHandovers).toBeUndefined()
		emitted.length = 0
		await pick(rowOf("Mira"), "gina")
		expect(save().seatHandovers).toEqual([{ castMemberId: 31, toUserId: G1 }])
	})

	test("a pick moves a named seat into that person's group before Save", async () => {
		await openForm()
		await pick(rowOf("Bo"), "gus")
		expect(personasHeadings()).toEqual(["You", "gina", "gus"])
		expect(save().seatHandovers).toEqual([{ playerSeatId: 12, toUserId: G2 }])
	})

	test("a guest: on an owner-seated member with take cast on, No one and You", async () => {
		await openForm({ viewerId: G1 })
		expect(await optionsOf(rowOf("Mira"))).toEqual(["No one", "You"])
	})

	test("a guest: absent with take cast off, on a benched member and on one G2 seated", async () => {
		await openForm({ viewerId: G1, metadata: { guestsTakeCast: false } })
		expect(playedByIn(rowOf("Mira"))).toBeNull()
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await openForm({ viewerId: G1 })
		expect(playedByIn(rowOf("Pia"))).toBeNull()
		expect(playedByIn(rowOf("Rex"))).toBeNull()
	})
})

describe("Edit Session — the guest seat switches need a guest", () => {
	test("absent with no guest, present with a saved guest", async () => {
		await openForm({ guests: false })
		expect(switchInput("guests-bring-own")).toBeNull()
		expect(BODY()).not.toContain("Guests can take cast members")
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await openForm()
		expect(switchInput("guests-bring-own")).not.toBeNull()
		expect(switchInput("guests-take-cast")).not.toBeNull()
	})

	test("present after a guest is added in the form", async () => {
		await openForm({ guests: false })
		expect(switchInput("guests-bring-own")).toBeNull()
		;(
			[...document.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("Add guests")
			) as HTMLButtonElement
		).click()
		flushSync()
		await tick()
		deliver("users:list", {
			users: [{ id: G1, username: "gina", displayName: null }]
		})
		;(
			[...document.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("gina")
			) as HTMLButtonElement
		).click()
		flushSync()
		;(
			[...document.querySelectorAll("button")].find((b) =>
				/^Add\b.*\(?1\)?|^Add 1/.test(b.textContent?.trim() ?? "")
			) as HTMLButtonElement
		).click()
		flushSync()
		await tick()
		expect(BODY()).toContain("Ready to add")
		expect(switchInput("guests-bring-own")).not.toBeNull()
	})
})
