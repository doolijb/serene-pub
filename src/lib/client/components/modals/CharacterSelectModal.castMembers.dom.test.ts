/**
 * 🚧 The Add characters picker and a book's cast (plan §34.2, 2026-11-09):
 * one picker, the cast first under the book's name, a member and its card one
 * row. Card ids and member ids share one range, so the two lists never mix.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import CharacterSelectModal from "./CharacterSelectModal.svelte"
import * as Modal from "./CharacterSelectModal.svelte"

// Plain tsc sees a `*.svelte` module as its default export only.
const castPickMembers = (rows: unknown[]) =>
	(Modal as any).castPickMembers(rows) as unknown[]

const CARDS = [
	{ id: 1, name: "Jasmine" },
	{ id: 2, name: "Bram" }
]
// Mira is card-less (member 1 shares an id with card 1). Old Tom is card-less.
// Bramble is the member linked to card 2: one individual with Bram's card.
const MEMBERS = [
	{ id: 1, name: "Mira", cardId: null },
	{ id: 9, name: "Old Tom", faceMediaId: 4, cardId: null },
	{ id: 12, name: "Bramble", cardId: 2 }
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
			multiSelect: true,
			characters: CARDS,
			onOpenChange: () => {},
			...props
		} as any
	})
	await settle()
}

const dialog = () =>
	document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')!

const groupLabels = () =>
	[...dialog().querySelectorAll("h3")].map((h) => h.textContent?.trim())

const tick1 = (name: string) => {
	const input = [...dialog().querySelectorAll("input[type=checkbox]")].find(
		(i) =>
			document
				.getElementById(i.getAttribute("aria-labelledby") ?? "")
				?.textContent?.trim() === name
	) as HTMLInputElement
	input.click()
	flushSync()
}

const names = (list: string) =>
	[...dialog().querySelectorAll(`ul[aria-label="${list}"] li`)].map((li) =>
		li.querySelector('[id$="-name"]')?.textContent?.trim()
	)

const addButton = () =>
	[...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) =>
		b.textContent?.trim().startsWith("Add")
	)!

async function searchFor(term: string) {
	const input = dialog().querySelector<HTMLInputElement>(
		'input[aria-label="Search characters"]'
	)!
	input.value = term
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}

const book = { castMembers: MEMBERS, castGroupLabel: "Harrow" }

const dialogText = () => dialog().textContent ?? ""

describe("CharacterSelectModal, one picker for the cast", () => {
	test("with no castMembers there are no group labels", async () => {
		await render()
		expect(groupLabels()).toEqual([])
		expect(names("Characters")).toEqual(["Jasmine", "Bram"])
	})

	test("the cast group comes first under the book's name; a member and its card are one row", async () => {
		await render(book)
		expect(groupLabels()).toEqual(["Harrow", "Your other characters"])
		expect(names("Cast members")).toEqual(["Mira", "Old Tom", "Bramble"])
		// Bram's card is merged into Bramble, so it is not repeated.
		expect(names("Characters")).toEqual(["Jasmine"])
		expect(dialogText()).toContain(
			"Picking one adds someone new to the story."
		)
	})

	test("neither old line is drawn", async () => {
		await render(book)
		expect(dialogText()).not.toContain(
			"Cast members with no character card."
		)
		expect(groupLabels()).not.toContain("Character cards")
	})

	test("the second group's heading and line appear only when both groups have rows", async () => {
		await render({
			castMembers: [{ id: 9, name: "Old Tom", cardId: null }],
			castGroupLabel: "Harrow",
			characters: []
		})
		expect(groupLabels()).toEqual(["Harrow"])
		expect(dialogText()).not.toContain("adds someone new")
	})

	test("picking a merged row returns the card id; a card-less row returns the member id", async () => {
		const onMultiSelect = vi.fn()
		await render({ ...book, onMultiSelect })
		tick1("Bramble")
		expect(addButton().textContent?.trim()).toBe("Add 1 character")
		tick1("Mira")
		tick1("Jasmine")
		expect(addButton().textContent?.trim()).toBe("Add 3 characters")
		addButton().click()
		// Card 2 (Bramble's), card 1 (Jasmine); member 1 (Mira) apart.
		expect(onMultiSelect).toHaveBeenCalledWith([2, 1], [1])
	})

	test("a card-less row is drawn like a carded one", async () => {
		await render(book)
		const rows = [
			...dialog().querySelectorAll('ul[aria-label="Cast members"] li')
		]
		const shape = (li: Element) =>
			[...li.querySelectorAll("*")].map((e) => e.tagName).join(",")
		expect(shape(rows[0])).toBe(shape(rows[2]))
	})

	test("search filters both groups", async () => {
		await render(book)
		await searchFor("ra")
		// Mira and Bramble hold "ra"; Jasmine and Old Tom do not.
		expect(names("Cast members")).toEqual(["Mira", "Bramble"])
		expect(names("Characters")).toEqual([])
	})

	test("selectedLimit counts both groups", async () => {
		await render({ ...book, selectedLimit: 2 })
		tick1("Jasmine")
		tick1("Mira")
		const other = [...dialog().querySelectorAll("input[type=checkbox]")]
			.filter((i) => !(i as HTMLInputElement).checked)
			.map((i) => (i as HTMLInputElement).disabled)
		expect(other).toEqual([true, true])
	})

	test("excluded members and excluded cards are not offered", async () => {
		await render({ ...book, excludeCastMemberIds: [1], excludeIds: [2] })
		// Bramble's card is chosen already, so Bramble is not offered either.
		expect(names("Cast members")).toEqual(["Old Tom"])
		expect(names("Characters")).toEqual(["Jasmine"])
	})

	test("single mode offers carded members first and no card-less ones, and picks the card", async () => {
		const onSelect = vi.fn()
		await render({ ...book, multiSelect: false, onSelect })
		expect(names("Cast members")).toEqual(["Bramble"])
		expect(names("Characters")).toEqual(["Jasmine"])
		dialog()
			.querySelector<HTMLButtonElement>(
				'ul[aria-label="Cast members"] li button'
			)!
			.click()
		expect(onSelect).toHaveBeenCalledWith(CARDS[1])
	})

	test("castPickMembers keeps every row with no overlay", () => {
		const rows = [
			{ id: 1, name: "A", characterId: null, overlayOf: null },
			{ id: 2, name: "B", characterId: 5, overlayOf: null },
			{ id: 3, name: "C", characterId: null, overlayOf: 1 },
			{
				id: 4,
				name: "D",
				ownNickname: "Dee",
				characterId: null,
				overlayOf: null,
				faceMediaId: 7
			}
		] as any
		expect(castPickMembers(rows)).toEqual([
			{ id: 1, name: "A", faceMediaId: null, cardId: null },
			{ id: 2, name: "B", faceMediaId: null, cardId: 5 },
			{ id: 4, name: "Dee", faceMediaId: 7, cardId: null }
		])
	})
})
