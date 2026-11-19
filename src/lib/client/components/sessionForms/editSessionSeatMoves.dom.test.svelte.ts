/**
 * 🚧 Edit Session — moving a seat between a person's Personas group and the
 * AI-played group by "Played by": the choices, the confirmation built into the
 * row, and the `seatMoves` the save sends.
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
	/** A card with a live seat of both kinds. */
	k2?: boolean
}

/** Owner 1; G1 (2) and G2 (3) players, W (4) a watcher. */
async function openForm(o: Opts = {}) {
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
	const player = (over: Record<string, unknown>) => ({
		personaId: null,
		persona: null,
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
			metadata: {},
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
				...(o.k2
					? [
							seat({
								id: 27,
								characterId: 63,
								character: {
									id: 63,
									name: "Dax",
									nickname: null,
									userId: OWNER
								},
								seatedByUserId: OWNER
							})
						]
					: [])
			],
			cardlessSeatShown: {
				31: { name: "Mira", nickname: null, faceMediaId: null }
			},
			sessionPersonas: [
				player({
					id: 11,
					personaId: 61,
					persona: { id: 61, name: "Pip", description: "", userId: OWNER },
					userId: OWNER
				}),
				player({
					id: 13,
					personaId: 62,
					persona: { id: 62, name: "Quin", description: "", userId: G1 },
					userId: G1
				}),
				player({ id: 12, seatName: "Bo", userId: OWNER }),
				player({ id: 14, seatName: "Cal", castMemberId: 35, userId: OWNER }),
				...(o.k2
					? [
							player({
								id: 15,
								personaId: 63,
								persona: {
									id: 63,
									name: "Dax",
									description: "",
									userId: OWNER
								},
								userId: OWNER
							})
						]
					: [])
			],
			sessionGuests: [
				guestRow(G1, "gina"),
				guestRow(G2, "gus"),
				guestRow(W, "wes", false)
			],
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

/** The row that names a seat, within the card (Characters or Personas) that lists it. */
const rowIn = (card: "Characters" | "Personas", name: string): HTMLElement => {
	const section = [...document.querySelectorAll("section")].find((s) =>
		s.querySelector("h3")?.textContent?.startsWith(card)
	)!
	const hit = [...section.querySelectorAll<HTMLInputElement>("input.input")].find(
		(i) => i.value === name
	)
	if (hit) return hit.closest("li") as HTMLElement
	return [...section.querySelectorAll<HTMLElement>(".text-lead")]
		.find((e) => norm(e.textContent) === name)!
		.closest(".rounded-base") as HTMLElement
}
const select = (row: HTMLElement) =>
	row.querySelector<HTMLInputElement>('input[role="combobox"]')
const playedByIn = (row: HTMLElement) =>
	select(row)
		? row.querySelector<HTMLButtonElement>(
				'button[aria-label^="Show Played by, "]'
			)
		: null
const listOf = (row: HTMLElement) => {
	const id = select(row)!.getAttribute("aria-controls")!
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
const groupOf = (row: HTMLElement) =>
	row.querySelector<HTMLElement>('[role="group"][aria-label^="Move "]')
const button = (row: HTMLElement, label: string) =>
	row.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
async function press(b: HTMLButtonElement | null | undefined) {
	b!.click()
	flushSync()
	await tick()
	flushSync()
}
function save() {
	const b = [...document.querySelectorAll("button")].find(
		(x) => x.textContent?.trim() === "Save"
	) as HTMLButtonElement
	b.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

const ORLA = () => rowIn("Characters", "Orla")
const PIP = () => rowIn("Personas", "Pip")

describe("Edit Session — Played by offers the moves", () => {
	test("a persona row: the owner's card, a guest's card and a card-less member's seat offer No one; a named seat with neither does not", async () => {
		await openForm()
		expect(await optionsOf(PIP())).toEqual(["You", "gina", "gus", "No one"])
		expect(await optionsOf(rowIn("Personas", "Quin"))).toEqual([
			"gina",
			"No one"
		])
		expect(await optionsOf(rowIn("Personas", "Cal"))).toEqual([
			"You",
			"gina",
			"gus",
			"No one"
		])
		expect(await optionsOf(rowIn("Personas", "Bo"))).toEqual([
			"You",
			"gina",
			"gus"
		])
	})

	test("an AI-played row: the owner's card and a card-less member offer each person as a persona; a guest's card only that guest", async () => {
		await openForm()
		const all = [
			"No one",
			"gina",
			"gus",
			"You as a persona",
			"gina as a persona",
			"gus as a persona"
		]
		expect(await optionsOf(ORLA())).toEqual(all)
		expect(await optionsOf(rowIn("Characters", "Mira"))).toEqual(all)
		expect(await optionsOf(rowIn("Characters", "Gil"))).toEqual([
			"gina",
			"gina as a persona"
		])
	})

	test("a guest sees no move choice", async () => {
		await openForm({ viewerId: G1 })
		expect(playedByIn(rowIn("Personas", "Quin"))).toBeNull()
		expect(playedByIn(PIP())).toBeNull()
		expect(playedByIn(ORLA())).toBeNull()
		expect(await optionsOf(rowIn("Characters", "Mira"))).toEqual([
			"No one",
			"You"
		])
	})

	test("a card with a live seat of both kinds offers no move on either row", async () => {
		await openForm({ k2: true })
		const dax = [
			...document.querySelectorAll<HTMLInputElement>(
				'input[role="combobox"][aria-label="Played by, Dax"]'
			)
		]
		expect(dax.length).toBe(2)
		for (const input of dax) {
			const row = input.closest(".rounded-base") as HTMLElement
			const options = await optionsOf(row)
			expect(options.some((o) => o === "No one" && row.closest("section")?.querySelector("h3")?.textContent?.startsWith("Personas"))).toBe(false)
			expect(options.some((o) => o.endsWith("as a persona"))).toBe(false)
		}
	})
})

describe("Edit Session — confirming a move", () => {
	test("picking a move opens the confirmation with its sentence and drafts nothing", async () => {
		await openForm()
		await pick(PIP(), "No one")
		const group = groupOf(PIP())!
		expect(group.getAttribute("aria-label")).toBe("Move Pip")
		expect(norm(group.textContent)).toContain(
			"Pip moves to the characters the story plays when you save. Its earlier lines stay as they are."
		)
		expect(button(PIP(), "Move Pip")).not.toBeNull()
		expect(button(PIP(), "Cancel moving Pip")).not.toBeNull()
		expect(BODY()).not.toContain("Moves on Save")
		await pick(ORLA(), "gina as a persona")
		expect(norm(groupOf(ORLA())!.textContent)).toContain(
			"Orla moves to gina's personas when you save. Its earlier lines stay as they are."
		)
		await pick(rowIn("Characters", "Mira"), "You as a persona")
		expect(norm(groupOf(rowIn("Characters", "Mira"))!.textContent)).toContain(
			"Mira moves to your personas when you save. Its earlier lines stay as they are."
		)
		expect(save().seatMoves).toBeUndefined()
	})

	test("Cancel returns the Select to its value, drafts nothing and returns focus", async () => {
		await openForm()
		await pick(ORLA(), "gina as a persona")
		expect(select(ORLA())!.value).toBe("gina as a persona")
		await press(button(ORLA(), "Cancel moving Orla"))
		expect(groupOf(ORLA())).toBeNull()
		expect(select(ORLA())!.value).toBe("No one")
		expect(document.activeElement).toBe(select(ORLA()))
		expect(BODY()).not.toContain("Moves on Save")
		expect(save().seatMoves).toBeUndefined()
	})

	test("Move then Save sends the moves and no handover for those rows", async () => {
		await openForm()
		await pick(PIP(), "No one")
		await press(button(PIP(), "Move Pip"))
		expect(groupOf(PIP())).toBeNull()
		expect(select(PIP())!.value).toBe("No one")
		expect(norm(PIP().textContent)).toContain("Moves on Save")
		expect(document.activeElement).toBe(select(PIP()))
		await pick(ORLA(), "gus")
		await pick(ORLA(), "gina as a persona")
		await press(button(ORLA(), "Move Orla"))
		expect(select(ORLA())!.value).toBe("gina as a persona")
		await pick(rowIn("Characters", "Mira"), "You as a persona")
		await press(button(rowIn("Characters", "Mira"), "Move Mira"))
		const sent = save()
		expect(sent.seatMoves).toEqual([
			{ characterSeatId: 21, toUserId: G1 },
			{ characterSeatId: 22, toUserId: OWNER },
			{ playerSeatId: 11 }
		])
		expect(sent.seatHandovers).toBeUndefined()
	})

	test("the persona-row move sends exactly its player seat", async () => {
		await openForm()
		await pick(rowIn("Personas", "Cal"), "No one")
		await press(button(rowIn("Personas", "Cal"), "Move Cal"))
		expect(save().seatMoves).toEqual([{ playerSeatId: 14 }])
	})

	test("a non-move pick after a move clears it and sends the handover", async () => {
		await openForm()
		await pick(ORLA(), "gina as a persona")
		await press(button(ORLA(), "Move Orla"))
		await pick(ORLA(), "gus")
		expect(norm(ORLA().textContent)).not.toContain("Moves on Save")
		const sent = save()
		expect(sent.seatMoves).toBeUndefined()
		expect(sent.seatHandovers).toEqual([{ characterId: 51, toUserId: G2 }])
	})
})
