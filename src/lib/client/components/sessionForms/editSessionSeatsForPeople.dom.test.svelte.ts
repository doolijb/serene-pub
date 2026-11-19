/**
 * Edit session › Participants › Personas: the owner seats a card, a card-less
 * cast member or a named seat for a person who plays, and hands a carded
 * persona of their own to one.
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
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
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
	const handlers = listeners.get(key) ?? []
	if (!handlers.length) throw new Error(`nothing listens on ${key}`)
	for (const h of [...handlers]) h(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"
const norm = (t: string | null | undefined) =>
	(t ?? "").replace(/\s+/g, " ").trim()
const BODY = () => norm(document.body.textContent)
const OWNER = 1
const BO = 2
const WATCHER = 4

const ORLA = {
	id: 51,
	name: "Orla",
	description: "Mine",
	userId: OWNER,
	isPersona: true
}

async function openForm(o: { viewerId?: number; guestCard?: boolean } = {}) {
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
			sessionCharacters: [],
			sessionPersonas: [
				{
					id: 11,
					personaId: 61,
					persona: { id: 61, name: "Pip", description: "", userId: OWNER },
					// The owner's card, seated for Bo or kept by the owner.
					userId: o.guestCard ? BO : OWNER,
					isActive: true,
					removedAt: null
				},
				...(o.guestCard
					? []
					: [
							{
								id: 13,
								personaId: 62,
								persona: {
									id: 62,
									name: "Quin",
									description: "",
									userId: BO
								},
								userId: BO,
								isActive: true,
								removedAt: null
							}
						])
			],
			sessionGuests: [
				{
					sessionId: 7,
					userId: BO,
					isPlayer: true,
					user: { id: BO, username: "bo", displayName: null }
				},
				{
					sessionId: 7,
					userId: WATCHER,
					isPlayer: false,
					user: { id: WATCHER, username: "wes", displayName: null }
				}
			],
			tags: []
		}
	})
	deliver("characters:list", { characterList: [ORLA] })
	if (listeners.has("lorebooks:bindingList#5"))
		deliver("lorebooks:bindingList#5", {
		lorebookId: 5,
		lorebookBindingList: [
			{
				id: 41,
				kind: "member",
				characterId: null,
				name: "Tess",
				nickname: null,
				faceMediaId: null
			}
		]
	})
	await tick()
	flushSync()
}

const headings = () => {
	const card = [...document.querySelectorAll("section")].find((s) =>
		s.querySelector("h3")?.textContent?.startsWith("Personas")
	)!
	return [...card.querySelectorAll("h4")].map((h) => norm(h.textContent))
}
/** A group's section of the Personas card, from its heading to the next. */
const groupOf = (heading: string): string => {
	const card = [...document.querySelectorAll("section")].find((s) =>
		s.querySelector("h3")?.textContent?.startsWith("Personas")
	)!
	const h4s = [...card.querySelectorAll("h4")]
	const at = h4s.findIndex((h) => norm(h.textContent) === heading)
	const parts: string[] = []
	for (
		let n: Element | null = h4s[at].nextElementSibling;
		n && n !== h4s[at + 1];
		n = n.nextElementSibling
	)
		parts.push(norm(n.textContent))
	return parts.join(" | ")
}
const byLabel = (label: string) =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const flush = async () => {
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
async function pickCard(addLabel: string) {
	byLabel(addLabel)!.click()
	await flush()
	const row = [...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Orla")
	) as HTMLButtonElement
	row.click()
	await flush()
}
function save() {
	const b = [...document.querySelectorAll("button")].find(
		(x) => x.textContent?.trim() === "Save"
	) as HTMLButtonElement
	b.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}
async function choose(input: HTMLInputElement, label: string) {
	const show = input.parentElement!.querySelector<HTMLButtonElement>(
		'button[aria-label^="Show "]'
	)!
	show.click()
	await flush()
	const list = document.getElementById(input.getAttribute("aria-controls")!)!
	;[...list.querySelectorAll<HTMLElement>('[role="option"]')]
		.find((o) => norm(o.textContent) === label)!
		.click()
	await flush()
}
const combo = (name: string) =>
	document.querySelector<HTMLInputElement>(
		`input[role="combobox"][aria-label="${name}"]`
	)

describe("Edit Session — seats for other people (the owner)", () => {
	test("a group for each player guest, even empty; none for a watcher", async () => {
		await openForm()
		expect(headings()).toEqual(["You", "bo"])
		expect(byLabel("Add a persona for bo")).not.toBeNull()
		expect(byLabel("Add a persona")).not.toBeNull()
	})

	test("Add a persona for bo: the card is a pending row in bo's group and saves for bo", async () => {
		await openForm()
		await pickCard("Add a persona for bo")
		expect(groupOf("bo")).toContain("Orla")
		expect(groupOf("bo")).toContain("Ready to add")
		expect(groupOf("You")).not.toContain("Orla")
		const sent = save()
		expect(sent.playerSeatsFor).toEqual([{ characterId: 51, toUserId: BO }])
		expect(sent.personaIds).toContain(51)
	})

	test("a card added in the owner's own group sends no playerSeatsFor", async () => {
		await openForm()
		await pickCard("Add a persona")
		expect(groupOf("You")).toContain("Orla")
		expect(save().playerSeatsFor).toBeUndefined()
	})

	test("the character picker offers a cast member until a player seat holds it", async () => {
		const pickerOffers = async () => {
			const add = [...document.querySelectorAll("button")].find((b) =>
				b.textContent?.includes("Add a character")
			) as HTMLButtonElement
			add.click()
			await flush()
			const text = (
				document.querySelector('[role="dialog"]') ?? document.body
			).textContent
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
			)
			await flush()
			return !!text?.includes("Tess")
		}
		await openForm()
		expect(await pickerOffers()).toBe(true)
		await choose(combo("Add a cast member for bo")!, "Tess")
		expect(await pickerOffers()).toBe(false)
	})

	test("a cast member and a named seat each add a pending row and an entry", async () => {
		await openForm()
		await choose(combo("Add a cast member for bo")!, "Tess")
		expect(groupOf("bo")).toContain("Tess")
		expect(combo("Add a cast member for bo")).toBeNull()
		const name = document.querySelector<HTMLInputElement>(
			'input[aria-label="New seat name"]'
		)!
		const add = [...document.querySelectorAll("button")].filter(
			(b) => b.textContent?.trim() === "Add a seat"
		)[1] as HTMLButtonElement
		expect(add.disabled).toBe(true)
		const inputs = [
			...document.querySelectorAll<HTMLInputElement>(
				'input[aria-label="New seat name"]'
			)
		]
		expect(name).toBe(inputs[0])
		inputs[1].value = "The Fox"
		inputs[1].dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(add.disabled).toBe(false)
		add.click()
		await flush()
		expect(groupOf("bo")).toContain("The Fox")
		expect(save().playerSeatsFor).toEqual([
			{ castMemberId: 41, toUserId: BO },
			{ seatName: "The Fox", toUserId: BO }
		])
	})

	test("Played by shows on the owner's carded persona, and on bo's only to move it; bo takes Pip", async () => {
		await openForm()
		expect(combo("Played by, Pip")).not.toBeNull()
		// bo's own card is handed to no one else: its control offers only bo and the move (S2).
		expect(combo("Played by, Quin")).not.toBeNull()
		await choose(combo("Played by, Pip")!, "bo")
		expect(groupOf("bo")).toContain("Pip")
		expect(groupOf("You")).not.toContain("Pip")
		expect(save().seatHandovers).toEqual([{ playerSeatId: 11, toUserId: BO }])
	})
})

describe("Edit Session — the guest's view of the owner's card seated for them", () => {
	test("it is in their own group with no bench, remove or reorder control", async () => {
		await openForm({ viewerId: BO, guestCard: true })
		expect(groupOf("You")).toContain("Pip")
		expect(byLabel("Bench Pip")).toBeNull()
		expect(byLabel("Remove Pip from the session")).toBeNull()
		expect(byLabel("Move Pip up")).toBeNull()
		expect(combo("Played by, Pip")).toBeNull()
	})
})
