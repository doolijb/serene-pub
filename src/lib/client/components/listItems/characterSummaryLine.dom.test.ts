/**
 * Less-confusing plan F1 (2026-10-11): a character's row and tile show a line
 * written to be read under the name, never the raw card sheet
 * ("Name: Brix Gender: Female (Designate) Role: …").
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import CharacterListItem from "./CharacterListItem.svelte"
import CharacterCardItem from "./CharacterCardItem.svelte"

const BRIX = {
	id: 7,
	name: "Brix",
	nickname: null,
	isFavorite: false,
	isPersona: false,
	isDefaultPersona: false,
	creatorNotes: "",
	summary: null,
	embeddingModel: null,
	description: [
		"Name: Brix",
		"Gender: Female (Designate)",
		"Role: Synthetic Lifeform, Station Crew Support",
		"Appearance: |",
		"Brix presents as a human female with a slender, efficient build. Her features are placid."
	].join("\n")
} as any

let apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

function render(component: any, character: any) {
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(component, {
			target: host,
			props: { character, showControls: false }
		})
	)
	flushSync()
	return host
}

describe("the summary line under a character's name", () => {
	test("the list row reads the first prose sentence, not the sheet", () => {
		const host = render(CharacterListItem, BRIX)
		const line = host.querySelector("#character-desc-7")?.textContent?.trim()
		expect(line).toBe(
			"Brix presents as a human female with a slender, efficient build."
		)
		expect(host.textContent).not.toContain("Gender:")
	})

	test("the tile reads the card's own Summary first", () => {
		const host = render(CharacterCardItem, {
			...BRIX,
			summary: "The station's synthetic crew support."
		})
		expect(host.textContent).toContain("The station's synthetic crew support.")
		expect(host.textContent).not.toContain("Name: Brix")
	})

	test("a card that is nothing but sheet lines shows no line", () => {
		const host = render(CharacterListItem, {
			...BRIX,
			description: "Name: Brix\nGender: Female"
		})
		expect(host.querySelector("#character-desc-7")).toBeNull()
	})
})
