/**
 * Edit Session › the Benched section (owner 2026-11-10): Bench and Bring back
 * wait for Save and are written by `sessions:setCastSeatEnabled` before the
 * update; a benched seat stays in the update's lists; fallen rows say so; and
 * Reassign and Remove show only where a benched seat allows them.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
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

type Seat = Record<string, unknown>
const charSeat = (
	id: number,
	cardId: number,
	name: string,
	over: Seat = {}
) => ({
	id,
	characterId: cardId,
	character: { id: cardId, name },
	castMemberId: null,
	isActive: true,
	removedAt: null,
	...over
})
const memberSeat = (id: number, memberId: number, over: Seat = {}) => ({
	id,
	characterId: null,
	character: null,
	castMemberId: memberId,
	isActive: true,
	removedAt: null,
	...over
})
const personaSeat = (
	id: number,
	cardId: number,
	name: string,
	over: Seat = {}
) => ({
	id,
	personaId: cardId,
	persona: { id: cardId, name, userId: 1 },
	userId: 1,
	seatName: null,
	isActive: true,
	removedAt: null,
	...over
})
const cardlessSeat = (id: number, name: string, over: Seat = {}) => ({
	id,
	personaId: null,
	persona: null,
	userId: 1,
	seatName: name,
	isActive: true,
	removedAt: null,
	...over
})

/** Wren, Mira, Pia and Ann are in play; Bryn, Tess, Quin and Bo are benched. */
function sessionMsg(over: Record<string, unknown> = {}) {
	return {
		session: {
			id: 7,
			userId: 1,
			name: "The crawl",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 5,
			sessionCharacters: [
				charSeat(20, 3, "Wren"),
				charSeat(22, 4, "Bryn", { isActive: false }),
				memberSeat(21, 31),
				memberSeat(23, 32, { isActive: false })
			],
			cardlessSeatShown: {
				31: { name: "Mira", nickname: null, faceMediaId: null },
				32: { name: "Tess", nickname: null, faceMediaId: null }
			},
			sessionPersonas: [
				personaSeat(50, 5, "Pia"),
				personaSeat(51, 6, "Quin", { isActive: false }),
				cardlessSeat(40, "Ann"),
				cardlessSeat(41, "Bo", { isActive: false })
			],
			sessionGuests: [],
			tags: [],
			...over
		}
	}
}

async function openForm(over: Record<string, unknown> = {}) {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map([["userCtx", { user: { id: 1, isAdmin: false } }]])
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
	deliver("sessions:get#7", sessionMsg(over))
	await tick()
	flushSync()
}

const btn = (label: string) =>
	document.querySelector(
		`button[aria-label="${label}"]`
	) as HTMLButtonElement | null
const textBtn = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	) as HTMLButtonElement
const live = () =>
	document.querySelector("p.sr-only[aria-live=polite]")?.textContent?.trim()
const flat = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
const focused = (el: HTMLElement | null) => document.activeElement === el
const seatEnabled = () =>
	emitted.filter(([e]) => e === "sessions:setCastSeatEnabled")
const order = () => emitted.map(([e]) => e)
/** The Bench buttons in document order, by `data-seat-action`. */
const benchOrder = (kind: string) =>
	[...document.querySelectorAll(`[data-seat-action^="${kind}:"]`)]
		.filter((b) => b.getAttribute("aria-label")?.startsWith("Bench "))
		.map((b) => b.getAttribute("data-seat-action"))

function save() {
	textBtn("Save").click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

/** The items of the menu a trigger opens (closed menus stay in the DOM, so never the whole page). */
function itemsOf(trigger: HTMLElement): HTMLElement[] {
	const id = trigger.getAttribute("aria-controls") ?? ""
	const panel = document.getElementById(id)
	return panel
		? [...panel.querySelectorAll<HTMLElement>("[role=menuitem]")]
		: []
}
let opened: HTMLElement | null = null
async function menuLabels(name: string): Promise<string[]> {
	opened = btn(`More actions for ${name}`)!
	opened.click()
	await tick()
	flushSync()
	return itemsOf(opened).map((el) => el.textContent?.trim() ?? "")
}
async function pickMenuItem(label: string) {
	const item = itemsOf(opened!).find(
		(el) => el.textContent?.trim() === label
	)!
	item.dispatchEvent(
		new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })
	)
	item.click()
	flushSync()
	await tick()
}

// kind, seated name, the seat's write, the update's list and every id it holds.
const KINDS = [
	{
		kind: "character",
		seated: "Wren",
		benched: "Bryn",
		write: { characterId: 3 },
		backWrite: { characterId: 4 },
		list: "characterIds",
		ids: [4, 3]
	},
	{
		kind: "member",
		seated: "Mira",
		benched: "Tess",
		write: { castMemberId: 31 },
		backWrite: { castMemberId: 32 },
		list: "castMemberIds",
		ids: [32, 31]
	},
	{
		kind: "persona",
		seated: "Pia",
		benched: "Quin",
		write: { playerSeatId: 50 },
		backWrite: { playerSeatId: 51 },
		list: "personaIds",
		ids: [6, 5]
	},
	{
		kind: "player",
		seated: "Ann",
		benched: "Bo",
		write: { playerSeatId: 40 },
		backWrite: { playerSeatId: 41 },
		list: "playerSeats",
		ids: [41, 40]
	}
] as const

describe("Edit Session — Bench", () => {
	test.each(KINDS)(
		"benching a $kind seat moves it to Benched, waits for Save and keeps its id in the update",
		async (k) => {
			await openForm()
			btn(`Bench ${k.seated}`)!.click()
			flushSync()
			await tick()
			expect(btn(`Bench ${k.seated}`) === null).toBe(true)
			const back = btn(`Bring back ${k.seated}`)
			expect(back === null).toBe(false)
			expect(focused(back)).toBe(true)
			expect(live()).toBe(`${k.seated} benched — waits for Save.`)
			// Nothing leaves before Save.
			expect(seatEnabled().length).toBe(0)
			const sent = save()
			expect(sent).toBeTruthy()
			expect(seatEnabled()).toEqual([
				[
					"sessions:setCastSeatEnabled",
					{ sessionId: 7, ...k.write, enabled: false }
				]
			])
			expect(order().indexOf("sessions:setCastSeatEnabled")).toBeLessThan(
				order().indexOf("sessions:update")
			)
			const held =
				k.list === "playerSeats" ? sent.playerSeats : sent[k.list]
			// The benched seat stays in what Save sends: the server unseats the omitted.
			if (k.list === "playerSeats") {
				// A card-less player seat travels as seat changes only; none removes it.
				expect(held).toBeUndefined()
				expect(sent.playerSeatChanges).toBeUndefined()
			} else {
				expect(held).toEqual(k.ids)
			}
		}
	)

	test("the Benched section lists its two zones and the intro", async () => {
		await openForm()
		const headings = [...document.querySelectorAll("h3")].map((h) =>
			h.textContent?.trim()
		)
		expect(headings.includes("Benched")).toBe(true)
		expect(headings.includes("The fallen")).toBe(false)
		expect(headings.includes("Removed")).toBe(false)
		expect(flat()).toContain(
			"In the session, out of the turns. Their lines stay theirs."
		)
		expect(
			document.querySelector('[aria-label="Benched characters"]') === null
		).toBe(false)
		expect(
			document.querySelector('[aria-label="Benched players"]') === null
		).toBe(false)
		expect(flat()).toContain(
			"Changes here wait for Save — adding, benching, bringing back and reordering. Reassigning a benched seat's lines happens at once."
		)
	})

	test("Bench and Bring back are real buttons, reachable and moving focus from the keyboard", async () => {
		await openForm()
		const bench = btn("Bench Wren")!
		expect(bench.tagName).toBe("BUTTON")
		expect(bench.tabIndex >= 0).toBe(true)
		bench.focus()
		expect(focused(bench)).toBe(true)
		bench.click()
		flushSync()
		await tick()
		const back = btn("Bring back Wren")!
		expect(back.tagName).toBe("BUTTON")
		expect(back.tabIndex >= 0).toBe(true)
		expect(focused(back)).toBe(true)
		back.click()
		flushSync()
		await tick()
		expect(focused(btn("Bench Wren"))).toBe(true)
		expect(live()).toBe("Wren brought back — waits for Save.")
		// Back where it was saved: nothing to write.
		save()
		expect(seatEnabled()).toEqual([])
	})
})

describe("Edit Session — Bring back", () => {
	test.each(KINDS)(
		"bringing back a benched $kind seat puts it last in its seated list and writes enabled: true on Save",
		async (k) => {
			await openForm()
			btn(`Bring back ${k.benched}`)!.click()
			flushSync()
			await tick()
			const bench = btn(`Bench ${k.benched}`)
			expect(bench === null).toBe(false)
			expect(focused(bench)).toBe(true)
			expect(live()).toBe(`${k.benched} brought back — waits for Save.`)
			// Seated list: the old seat first, the brought-back one last.
			const names = benchOrder(k.kind).map((a) =>
				document
					.querySelector(`[data-seat-action="${a}"]`)
					?.getAttribute("aria-label")
			)
			expect(names).toEqual([`Bench ${k.seated}`, `Bench ${k.benched}`])
			expect(seatEnabled().length).toBe(0)
			save()
			expect(seatEnabled()).toEqual([
				[
					"sessions:setCastSeatEnabled",
					{ sessionId: 7, ...k.backWrite, enabled: true }
				]
			])
		}
	)
})

describe("Edit Session — fallen seats", () => {
	const fallenSession = () => ({
		sessionCharacters: [
			charSeat(20, 3, "Wren"),
			charSeat(22, 4, "Bryn", {
				isActive: false,
				fellInStory: true,
				castMemberId: 9
			})
		],
		sessionPersonas: [
			personaSeat(50, 5, "Pia"),
			// Bo fell: the player made a newer card-less character.
			cardlessSeat(61, "Bo", { isActive: false }),
			cardlessSeat(70, "Bo II")
		]
	})

	test("a character marked fellInStory and a player seat followed by a newer one show the Skull", async () => {
		await openForm(fallenSession())
		const text = document.body.textContent ?? ""
		expect(text.split("Fell in the story").length - 1).toBe(2)
		expect(document.querySelectorAll("svg.lucide-skull").length).toBe(2)
		// They keep Bring back, and have no Reassign.
		expect(btn("Bring back Bryn") === null).toBe(false)
		expect(btn("Bring back Bo") === null).toBe(false)
		expect(btn("More actions for Bryn") === null).toBe(true)
	})

	test("a benched persona seat marked fellInStory shows the Skull", async () => {
		await openForm({
			sessionPersonas: [
				personaSeat(50, 5, "Pia"),
				personaSeat(51, 6, "Quin", { isActive: false, fellInStory: true })
			]
		})
		expect(flat().includes("Fell in the story")).toBe(true)
		expect(document.querySelectorAll("svg.lucide-skull").length).toBe(1)
	})

	test("bringing one back says it comes back as it is, with a link to its cast member", async () => {
		await openForm(fallenSession())
		const note =
			"They come back as they are; their story still says deceased until you change it."
		expect(flat().includes(note)).toBe(false)
		btn("Bring back Bryn")!.click()
		flushSync()
		await tick()
		expect(flat().includes(note)).toBe(true)
		const link = [...document.querySelectorAll("a")].find(
			(a) => a.textContent?.trim() === "Open Bryn in the lorebook"
		)
		expect(link === undefined).toBe(false)
		const href = link!.getAttribute("href") ?? ""
		expect(href.startsWith("/lorebooks#lore=5")).toBe(true)
		expect(href.includes("cast=9")).toBe(true)
	})

	test("a fallen player seat shows the note too, with no link without a cast member", async () => {
		await openForm(fallenSession())
		btn("Bring back Bo")!.click()
		flushSync()
		await tick()
		const note =
			"They come back as they are; their story still says deceased until you change it."
		expect(flat().includes(note)).toBe(true)
		expect(
			[...document.querySelectorAll("a")].some((a) =>
				a.textContent?.includes("Open Bo in the lorebook")
			)
		).toBe(false)
	})

	test("no book, no link", async () => {
		await openForm({
			...fallenSession(),
			lorebookId: null,
			ownBookId: null
		})
		btn("Bring back Bryn")!.click()
		flushSync()
		await tick()
		expect(
			[...document.querySelectorAll("a")].some((a) =>
				a.textContent?.includes("in the lorebook")
			)
		).toBe(false)
	})

	test("putting it back on the bench takes the note away", async () => {
		await openForm(fallenSession())
		btn("Bring back Bryn")!.click()
		flushSync()
		await tick()
		btn("Bench Bryn")!.click()
		flushSync()
		await tick()
		expect(flat().includes("They come back as they are")).toBe(false)
	})
})

describe("Edit Session — Reassign and Remove", () => {
	test("a benched carded seat offers Reassign; Remove only with no lines", async () => {
		await openForm()
		expect(await menuLabels("Bryn")).toEqual(["Reassign…"])
	})

	test("a benched carded seat with lines offers only Reassign", async () => {
		await openForm({
			sessionCharacters: [
				charSeat(20, 3, "Wren"),
				charSeat(22, 4, "Bryn", { isActive: false, hasLines: true })
			]
		})
		expect(await menuLabels("Bryn")).toEqual(["Reassign…"])
	})

	test("a benched player seat with no lines offers Reassign and Remove", async () => {
		await openForm({
			sessionPersonas: [
				personaSeat(50, 5, "Pia"),
				personaSeat(51, 6, "Quin", { isActive: false, hasLines: false })
			]
		})
		expect(await menuLabels("Quin")).toEqual(["Reassign…", "Remove"])
	})

	test("a benched carded seat with no lines offers both", async () => {
		await openForm({
			sessionCharacters: [
				charSeat(20, 3, "Wren"),
				charSeat(22, 4, "Bryn", { isActive: false, hasLines: false })
			]
		})
		expect(await menuLabels("Bryn")).toEqual(["Reassign…", "Remove"])
	})

	test("a fallen benched seat has no Reassign, only Remove when it has no lines", async () => {
		await openForm({
			sessionCharacters: [
				charSeat(20, 3, "Wren"),
				charSeat(22, 4, "Bryn", {
					isActive: false,
					fellInStory: true,
					hasLines: false
				})
			]
		})
		expect(await menuLabels("Bryn")).toEqual(["Remove"])
	})

	test("a benched persona offers Reassign; a benched card-less seat has no Reassign", async () => {
		await openForm({
			sessionPersonas: [
				personaSeat(50, 5, "Pia"),
				personaSeat(51, 6, "Quin", { isActive: false }),
				cardlessSeat(41, "Bo", { isActive: false })
			]
		})
		expect(btn("More actions for Bo") === null).toBe(true)
		expect(await menuLabels("Quin")).toEqual(["Reassign…"])
	})

	test("a seated seat offers neither, and a seat benched only in the draft neither", async () => {
		await openForm({
			sessionCharacters: [
				charSeat(20, 3, "Wren", { hasLines: false }),
				charSeat(22, 4, "Bryn", { isActive: false })
			]
		})
		expect(btn("More actions for Wren") === null).toBe(true)
		expect(btn("Remove Wren from the session") === null).toBe(true)
		btn("Bench Wren")!.click()
		flushSync()
		await tick()
		// Benched here, not on the server: no Reassign, and Remove waits for the bench to be saved.
		expect(btn("More actions for Wren") === null).toBe(true)
	})

	test("removing a benched seat with no lines drops its id from the update", async () => {
		await openForm({
			sessionCharacters: [
				charSeat(20, 3, "Wren"),
				charSeat(22, 4, "Bryn", { isActive: false, hasLines: false })
			]
		})
		await menuLabels("Bryn")
		await pickMenuItem("Remove")
		// Asks first.
		expect(document.body.textContent).toContain("Remove character?")
		textBtn("Remove").click()
		flushSync()
		const sent = save()
		expect(sent.characterIds).toEqual([3])
		expect(seatEnabled()).toEqual([])
	})
})

describe("Edit Session — an unsaved row", () => {
	test("has no Bench, and keeps Ready to add and its X", async () => {
		await openForm()
		deliver("characters:list", {
			characterList: [
				{ id: 3, name: "Wren" },
				{ id: 8, name: "Dov" }
			]
		})
		textBtn("Add a character").click()
		flushSync()
		await tick()
		const dov = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Dov")
		) as HTMLButtonElement
		dov.click()
		flushSync()
		await tick()
		expect(btn("Bench Dov") === null).toBe(true)
		expect(btn("Remove Dov from the session") === null).toBe(false)
		expect(document.body.textContent).toContain("Ready to add")
	})
})
