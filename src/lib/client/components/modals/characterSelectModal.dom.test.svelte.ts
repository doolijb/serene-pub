/**
 * The character picker, single mode.
 *
 * - A press on a row picks that row (`onSelect`).
 * - With `onCreateNew`, the picker offers **New character**, under the list
 *   or as the empty state's action.
 * - The empty state tells "everyone here is already chosen" (`excludeIds`
 *   covers every row) from "none exist yet".
 * - Search matches only what a row shows: never `creatorNotes`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import CharacterSelectModal from "./CharacterSelectModal.svelte"

const CHARACTERS = [
	{ id: 1, name: "Jasmine", description: "A florist." },
	{
		id: 2,
		name: "Bram",
		description: "A blacksmith.",
		creatorNotes: "Secretly a dragon."
	},
	{
		id: 3,
		name: "Corin",
		characterTags: [{ tag: { name: "Pirate" } }]
	}
]

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function render(props: Record<string, unknown> = {}) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(CharacterSelectModal, {
		target: host,
		props: {
			open: true,
			characters: CHARACTERS,
			onOpenChange: () => {},
			...props
		} as any
	})
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
	[...dialog().querySelectorAll('ul[aria-label="Characters"] li')].map(
		(li) => li.querySelector('[id$="-name"]')?.textContent?.trim() ?? ""
	)

const buttonByText = (text: string) =>
	[...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === text
	) ?? null

async function searchFor(term: string) {
	const input = dialog().querySelector<HTMLInputElement>(
		'input[aria-label="Search characters"]'
	)!
	input.value = term
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}

describe("CharacterSelectModal, single mode", () => {
	test("a press on a row picks that row", async () => {
		const onSelect = vi.fn()
		await render({ onSelect })
		expect(rowNames()).toEqual(["Jasmine", "Bram", "Corin"])
		// Rows are buttons named by the character's name.
		const bram = [...dialog().querySelectorAll("button")].find(
			(b) =>
				document
					.getElementById(b.getAttribute("aria-labelledby") ?? "")
					?.textContent?.trim() === "Bram"
		)!
		bram.click()
		await settle()
		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 2, name: "Bram" })
	})

	test("the heading names the dialog", async () => {
		await render()
		const labelledBy = dialog().getAttribute("aria-labelledby")
		expect(
			document.getElementById(labelledBy ?? "")?.textContent?.trim()
		).toBe("Select character")
	})

	test("onCreateNew offers New character under the list", async () => {
		const onCreateNew = vi.fn()
		await render({ onCreateNew })
		buttonByText("New character")!.click()
		expect(onCreateNew).toHaveBeenCalledTimes(1)
	})

	test("onCreateNew is the empty state's action when there are no characters", async () => {
		const onCreateNew = vi.fn()
		await render({ characters: [], onCreateNew })
		expect(dialog().textContent).toContain(
			"No characters yet — create one to get started."
		)
		buttonByText("New character")!.click()
		expect(onCreateNew).toHaveBeenCalledTimes(1)
	})

	test("no New character without onCreateNew", async () => {
		await render()
		expect(buttonByText("New character")).toBeNull()
	})

	test("says everyone is already chosen when excludeIds covers every row", async () => {
		await render({ excludeIds: [1, 2, 3] })
		expect(rowNames()).toEqual([])
		expect(dialog().textContent).toContain(
			"Everyone here is already chosen."
		)
		expect(dialog().textContent).not.toContain("No characters yet")
	})

	test("excludeIds leaves the chosen out and keeps the rest", async () => {
		await render({ excludeIds: [2] })
		expect(rowNames()).toEqual(["Jasmine", "Corin"])
	})

	test("search matches the name, the description and a tag, never creatorNotes", async () => {
		await render()
		await searchFor("dragon")
		expect(rowNames()).toEqual([])
		expect(dialog().textContent).toContain(
			'No characters found matching "dragon".'
		)

		await searchFor("blacksmith")
		expect(rowNames()).toEqual(["Bram"])

		await searchFor("jas")
		expect(rowNames()).toEqual(["Jasmine"])

		await searchFor("pirate")
		expect(rowNames()).toEqual(["Corin"])
	})

	test("the search box takes focus on open", async () => {
		await render()
		await new Promise((r) => setTimeout(r, 50))
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			"Search characters"
		)
	})
})
