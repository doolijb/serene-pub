/**
 * Start a session › Who is in it: the chosen are a list, and a picker opens to
 * add more (owner, 2026-10-09).
 *
 * - The Characters list shows the cast in cast order, which is the order the
 *   picker's ticks were made in, and ↑ ↓ reorder it; × takes one out.
 * - **Add characters** opens the multi-select picker over everyone not yet
 *   in the cast and not played, and is disabled with its reason at the
 *   genre's cap; inside the picker, ticks stop at the room left.
 * - Who you play as is one row with **Change**, which opens the persona
 *   picker and replaces the choice.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, requests, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	/** Every request the form sent, in order. */
	const requests: Array<{ key: string; params: any }> = []
	return {
		listeners,
		requests,
		socket: { emit: () => {}, on: () => {}, off: () => {} }
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
		return () =>
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (
			key: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: () => {},
		error: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import StartSessionForm from "./StartSessionForm.svelte"

const GENRE = "test:genre/troupe@1"

const CHARACTERS = [
	{ id: 1, name: "Jasmine" },
	{ id: 2, name: "Bram" },
	{ id: 3, name: "Corin" },
	{ id: 4, name: "Dell" },
	{ id: 5, name: "You", isPersona: true, isDefaultPersona: true },
	{ id: 6, name: "Wren", isPersona: true }
]

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function feed(key: string, msg: unknown) {
	for (const h of listeners.get(key) ?? []) h(msg)
}

/**
 * The form on a genre that takes one to `max` characters and one persona, and
 * starts with the default persona chosen — which a genre has to say outright
 * since 2026-10-19 (`preselectDefault: true`); one that says nothing starts
 * with nobody played (the last cases below).
 */
async function render(max = 3, more: Record<string, unknown> = {}) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		props: { onCreated: () => {}, onCancel: () => {} }
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				name: "Troupe",
				description: "",
				shape: {
					characters: { min: 1, max },
					personas: { min: 1, max: 1, preselectDefault: true },
					...more
				}
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [
			{
				id: 1,
				genreId: GENRE,
				name: "Plain",
				enabled: true,
				isDefault: true
			}
		]
	})
	feed("characters:list", { characterList: CHARACTERS })
	feed("lorebooks:list", { lorebookList: [] })
	await settle()
}

const button = (label: string, root: ParentNode = document) =>
	root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const buttonByText = (text: string, root: ParentNode = document) =>
	[...root.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === text
	) ?? null

/** The names in one of the form's selected lists, top to bottom. */
function listed(label: "Characters" | "Who you play as"): string[] {
	const list = host.querySelector(`ul[aria-label="${label}"]`)
	if (!list) return []
	return [...list.querySelectorAll("li")].map(
		(li) => li.querySelector('[id$="-name"]')?.textContent?.trim() ?? ""
	)
}

/** The open dialog. A closed one stays in the document, marked closed. */
const openDialog = () =>
	document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')

function dialog(): HTMLElement {
	const el = openDialog()
	if (!el) throw new Error("no dialog is open")
	return el
}

/** The picker's checkbox named by `name`, through its `aria-labelledby`. */
function checkbox(name: string): HTMLInputElement {
	const box = [
		...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
	].find(
		(input) =>
			document
				.getElementById(input.getAttribute("aria-labelledby") ?? "")
				?.textContent?.trim() === name
	)
	if (!box) throw new Error(`no checkbox named ${name}`)
	return box
}

async function addCharacters(...names: string[]) {
	buttonByText("Add characters", host)!.click()
	await settle()
	for (const name of names) {
		checkbox(name).click()
		await settle()
	}
	const add = [...dialog().querySelectorAll("button")].find((b) =>
		b.textContent?.trim().startsWith("Add ")
	)!
	add.click()
	await settle()
}

describe("Start a session › Who is in it", () => {
	test("starts with nobody in the cast and the default persona played", async () => {
		await render()
		expect(listed("Characters")).toEqual([])
		expect(host.textContent?.replace(/\s+/g, " ")).toContain(
			"No one yet. Add the characters you'll talk to."
		)
		expect(listed("Who you play as")).toEqual(["You"])
		expect(buttonByText("Add characters", host)!.disabled).toBe(false)
	})

	test("a grey Start says why under it, and the reason goes once the cast is in", async () => {
		await render()
		const start = buttonByText("Start", host)!
		expect(start.disabled).toBe(true)
		const reason = host.querySelector("#start-session-reason")
		expect(reason?.textContent?.trim()).toBe("Add at least one character.")
		expect(start.getAttribute("aria-describedby")).toBe(
			"start-session-reason"
		)
		await addCharacters("Corin")
		expect(buttonByText("Start", host)!.disabled).toBe(false)
		expect(host.querySelector("#start-session-reason")).toBeNull()
	})

	test("⏳ a genre still saying 'required' (RF fix 2): Start is offered with no book; with none to pick, Create a lorebook, and the new book is chosen", async () => {
		await render(3, { lorebook: "required" })
		await addCharacters("Corin")
		// Never required: the session's own book is its world until one is chosen.
		expect(host.querySelector("#start-session-reason")).toBeNull()
		expect(buttonByText("Start", host)!.disabled).toBe(false)
		expect(host.querySelector("#start-lorebook-heading")?.textContent?.trim()).toBe("Lorebook")
		expect(host.textContent).not.toContain("needs a lorebook")
		expect(host.textContent).toContain("This genre can start without")

		buttonByText("Create a lorebook", host)!.click()
		await settle()
		const name = dialog().querySelector<HTMLInputElement>(
			"#new-lorebook-name"
		)!
		name.value = "Atlas"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		buttonByText("Create", dialog())!.click()
		await settle()

		const create = requests.find((r) => r.key === "lorebooks:create")
		expect(create?.params.name).toBe("Atlas")
		// Another tab's book is not taken for this one.
		feed("lorebooks:create", {
			lorebook: { id: 8, name: "Elsewhere" },
			requestId: "someone-else"
		})
		feed("lorebooks:create", {
			lorebook: { id: 9, name: "Atlas" },
			requestId: create?.params.requestId
		})
		await settle()

		const chosen = host.querySelector(
			'[role="radiogroup"][aria-labelledby="start-lorebook-heading"] [aria-checked="true"]'
		)
		expect(chosen?.textContent).toContain("Atlas")
		expect(buttonByText("Start", host)!.disabled).toBe(false)
	})

	test("one enabled preset is answered silently, with no Preset card", async () => {
		await render()
		expect(host.querySelector("#start-preset-heading")).toBeNull()
	})

	test("Add characters opens the picker; two picked are added in the order ticked", async () => {
		await render()
		buttonByText("Add characters", host)!.click()
		await settle()

		const picker = dialog()
		expect(picker.textContent).toContain("Add characters")
		// The played character is not offered for the cast.
		const offered = [
			...picker.querySelectorAll('input[type="checkbox"]')
		].map((input) =>
			document
				.getElementById(input.getAttribute("aria-labelledby") ?? "")
				?.textContent?.trim()
		)
		expect(offered).not.toContain("You")
		expect(offered).toContain("Wren")

		checkbox("Corin").click()
		await settle()
		checkbox("Jasmine").click()
		await settle()
		const add = buttonByText("Add 2 characters", picker)!
		expect(add.disabled).toBe(false)
		add.click()
		await settle()

		expect(openDialog()).toBeNull()
		expect(listed("Characters")).toEqual(["Corin", "Jasmine"])
	})

	test("the picker's Add is disabled with nothing ticked, and leaves out who is in the cast", async () => {
		await render()
		await addCharacters("Corin")
		buttonByText("Add characters", host)!.click()
		await settle()
		expect(buttonByText("Add", dialog())!.disabled).toBe(true)
		expect(() => checkbox("Corin")).toThrow()
	})

	test("↑ ↓ reorder the cast", async () => {
		await render()
		await addCharacters("Corin", "Jasmine", "Bram")

		expect(button("Move Corin up", host)!.disabled).toBe(true)
		expect(button("Move Bram down", host)!.disabled).toBe(true)

		button("Move Jasmine up", host)!.click()
		await settle()
		expect(listed("Characters")).toEqual(["Jasmine", "Corin", "Bram"])

		button("Move Corin down", host)!.click()
		await settle()
		expect(listed("Characters")).toEqual(["Jasmine", "Bram", "Corin"])
	})

	test("× removes one from the cast", async () => {
		await render()
		await addCharacters("Corin", "Jasmine")
		button("Remove Corin", host)!.click()
		await settle()
		expect(listed("Characters")).toEqual(["Jasmine"])
		// One left: nothing to reorder.
		expect(button("Move Jasmine up", host)).toBeNull()
	})

	test("Add characters is disabled at the genre's cap, with the reason", async () => {
		await render(2)
		await addCharacters("Corin")

		// One place left: the picker stops ticking at it.
		buttonByText("Add characters", host)!.click()
		await settle()
		expect(dialog().textContent).toContain("Room for 1 more.")
		checkbox("Jasmine").click()
		await settle()
		expect(checkbox("Bram").disabled).toBe(true)
		buttonByText("Add 1 character", dialog())!.click()
		await settle()

		expect(listed("Characters")).toEqual(["Corin", "Jasmine"])
		const add = buttonByText("Add characters", host)!
		expect(add.disabled).toBe(true)
		const reason = document.getElementById(
			add.getAttribute("aria-describedby") ?? ""
		)
		expect(reason?.textContent?.trim()).toBe(
			"The cast is full — this genre takes at most 2 characters."
		)
	})

	test("Change replaces who you play as", async () => {
		await render()
		button("Change who you play as", host)!.click()
		await settle()
		// The persona picker reads its own list.
		feed("characters:list", { characterList: CHARACTERS })
		await settle()

		const wren = [...dialog().querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Wren")
		)!
		wren.click()
		await settle()

		expect(openDialog()).toBeNull()
		expect(listed("Who you play as")).toEqual(["Wren"])
	})

	test("a genre that does not preselect starts with nobody played, and creates with no persona", async () => {
		// Ruled 2026-10-19: a genre that says nothing preselects nobody (Story,
		// and Dungeon Crawler, where a persona is only a seed for the seat).
		await render(3, {
			characters: { min: 0 },
			personas: { min: 0 }
		})
		expect(listed("Who you play as")).toEqual([])
		expect(buttonByText("Choose who you play as", host)).not.toBeNull()
		expect(host.textContent).toContain("Who you play as — optional")

		buttonByText("Start", host)!.click()
		await settle()
		const create = requests.find((r) => r.key === "sessions:create")
		expect(create?.params.personaIds).toEqual([])
	})

	test("an optional persona is removable with ×, and the default does not come back", async () => {
		await render(3, {
			characters: { min: 0 },
			personas: { min: 0, max: 1, preselectDefault: true }
		})
		expect(listed("Who you play as")).toEqual(["You"])

		button("Remove You", host)!.click()
		await settle()
		expect(listed("Who you play as")).toEqual([])
		const choose = buttonByText("Choose who you play as", host)!
		expect(document.activeElement).toBe(choose)

		// A later change to the lists does not refill the removed default.
		feed("characters:list", { characterList: [...CHARACTERS] })
		await settle()
		expect(listed("Who you play as")).toEqual([])

		buttonByText("Start", host)!.click()
		await settle()
		const create = requests.find((r) => r.key === "sessions:create")
		expect(create?.params.personaIds).toEqual([])
	})

	test("a required persona has Change but no ×", async () => {
		await render()
		expect(listed("Who you play as")).toEqual(["You"])
		expect(button("Change who you play as", host)).not.toBeNull()
		expect(button("Remove You", host)).toBeNull()
	})

	test("the picker takes focus, and Escape closes it", async () => {
		await render()
		buttonByText("Add characters", host)!.click()
		await settle()
		await new Promise((r) => setTimeout(r, 50))
		const picker = dialog()
		expect(picker.contains(document.activeElement)).toBe(true)
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			"Search characters"
		)

		document.activeElement!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		await settle()
		expect(openDialog()).toBeNull()
	})
})
