/**
 * The persona picker: the character picker's look over `characters:list`.
 *
 * - Rows are `CharacterPickRow` buttons, one column: the personas only, the
 *   default persona first, then by name; `excludeIds` leaves some out.
 * - A press picks: the id, or the whole row with `returnFullPersona`, and
 *   the picker closes.
 * - **Show all characters** widens the rows to the whole library.
 * - The search box takes focus on open; the heading names the dialog.
 * - Search matches only what a row shows: never `creatorNotes`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners } = vi.hoisted(() => ({
	listeners: new Map<string, Array<(msg: any) => void>>()
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
			_params: unknown,
			handler: (msg: any) => void
		) => declareInterest(key, handler)
	}
})

import PersonaSelectModal from "./PersonaSelectModal.svelte"

const CHARACTERS = [
	{ id: 1, name: "Jasmine", description: "A florist." },
	{
		id: 2,
		name: "Wren",
		isPersona: true,
		creatorNotes: "Secretly a dragon."
	},
	{ id: 3, name: "You", isPersona: true, isDefaultPersona: true },
	{ id: 4, name: "Ash", isPersona: true, description: "A wanderer." }
]

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
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

async function render(props: Record<string, unknown> = {}) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(PersonaSelectModal, {
		target: host,
		props: {
			open: true,
			onOpenChange: () => {},
			onSelect: () => {},
			...props
		} as any
	})
	await settle()
	feed("characters:list", { characterList: CHARACTERS })
	await settle()
}

function dialog(): HTMLElement {
	const el = document.querySelector<HTMLElement>(
		'[role="dialog"][data-state="open"]'
	)
	if (!el) throw new Error("no dialog is open")
	return el
}

/** The names on the picker's rows, top to bottom. */
const rowNames = () =>
	[...dialog().querySelectorAll("ul li")].map(
		(li) => li.querySelector('[id$="-name"]')?.textContent?.trim() ?? ""
	)

/** The row button named by `name`, through its `aria-labelledby`. */
function row(name: string): HTMLButtonElement {
	const button = [
		...dialog().querySelectorAll<HTMLButtonElement>("ul li button")
	].find(
		(b) =>
			document
				.getElementById(b.getAttribute("aria-labelledby") ?? "")
				?.textContent?.trim() === name
	)
	if (!button) throw new Error(`no row named ${name}`)
	return button
}

async function searchFor(term: string) {
	const input = dialog().querySelector<HTMLInputElement>(
		'input[aria-label^="Search"]'
	)!
	input.value = term
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}

describe("PersonaSelectModal", () => {
	test("rows are the personas, the default first, in one list", async () => {
		await render()
		expect(rowNames()).toEqual(["You", "Ash", "Wren"])
		expect(dialog().querySelectorAll("ul").length).toBe(1)
		expect(
			dialog().querySelector('ul[aria-label="Personas"]')
		).not.toBeNull()
	})

	test("excludeIds leaves the chosen out", async () => {
		await render({ excludeIds: [3] })
		expect(rowNames()).toEqual(["Ash", "Wren"])
	})

	test("every persona already chosen says so, not that none exist", async () => {
		await render({ excludeIds: [2, 3, 4] })
		expect(rowNames()).toEqual([])
		expect(dialog().textContent).toContain("Everyone here is already chosen.")
		expect(dialog().textContent).not.toContain("No personas yet")
	})

	test("a press hands back the id and closes", async () => {
		const onSelect = vi.fn()
		const onOpenChange = vi.fn()
		await render({ onSelect, onOpenChange })
		row("Wren").click()
		await settle()
		expect(onSelect).toHaveBeenCalledWith(2)
		expect(onOpenChange).toHaveBeenCalledWith({ open: false })
	})

	test("returnFullPersona hands back the row", async () => {
		const onSelect = vi.fn()
		await render({ onSelect, returnFullPersona: true })
		row("Ash").click()
		await settle()
		expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 4, name: "Ash" })
	})

	test("onclose closes it when there is no onOpenChange", async () => {
		const onclose = vi.fn()
		await render({ onOpenChange: undefined, onclose })
		row("Ash").click()
		await settle()
		expect(onclose).toHaveBeenCalledTimes(1)
	})

	test("Show all characters widens the rows to the whole library", async () => {
		await render()
		expect(rowNames()).not.toContain("Jasmine")
		const toggle = dialog().querySelector<HTMLInputElement>(
			'input[name="personaSelectShowAll"]'
		)!
		toggle.click()
		await settle()
		expect(rowNames()).toEqual(["You", "Ash", "Jasmine", "Wren"])
		expect(
			dialog().querySelector('input[aria-label="Search characters"]')
		).not.toBeNull()
	})

	test("the search box takes focus on open", async () => {
		await render()
		await new Promise((r) => setTimeout(r, 50))
		expect(dialog().contains(document.activeElement)).toBe(true)
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			"Search personas"
		)
	})

	test("the heading names the dialog, and the description describes it", async () => {
		await render({
			title: "Add Persona to Session",
			description: "Select a persona to add."
		})
		const el = dialog()
		expect(
			document
				.getElementById(el.getAttribute("aria-labelledby") ?? "")
				?.textContent?.trim()
		).toBe("Add Persona to Session")
		expect(
			document
				.getElementById(el.getAttribute("aria-describedby") ?? "")
				?.textContent?.trim()
		).toBe("Select a persona to add.")
	})

	test("search matches the name and the description, never creatorNotes", async () => {
		await render()
		await searchFor("dragon")
		expect(rowNames()).toEqual([])
		expect(dialog().textContent).toContain(
			'No personas found matching "dragon".'
		)
		await searchFor("wanderer")
		expect(rowNames()).toEqual(["Ash"])
		await searchFor("wre")
		expect(rowNames()).toEqual(["Wren"])
	})

	test("onCreateNew offers New persona", async () => {
		const onCreateNew = vi.fn()
		await render({ onCreateNew })
		const button = [...dialog().querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "New persona"
		)!
		button.click()
		expect(onCreateNew).toHaveBeenCalledTimes(1)
	})
})
