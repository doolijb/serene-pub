/**
 * Less-confusing plan A3 (2026-10-11): inside the home wizard the Library
 * says Pick, not Import.
 *
 * "Browse the library" on the wizard's Character step opens the Library
 * beside it, and a card taken there is chosen on the step. While that step
 * is on screen (`wizardCharacterStep.active`) the detail's primary reads
 * **Pick this character** and the chip on the chosen card **Picked**;
 * anywhere else they stay **Import** and **In your characters**.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import LibraryDetail from "./LibraryDetail.svelte"
import { wizardCharacterStep } from "$lib/client/wizard/wizardCharacterStep.svelte"
import type { LibraryCatalogItem } from "$lib/shared/library/types"

const item: LibraryCatalogItem = {
	name: "Ada",
	description: "A lighthouse keeper.",
	tags: [],
	author: "someone",
	version: "1",
	spec: "chara_card_v2",
	file: "ada.png",
	category: "",
	source: "github-serenepub",
	sourceRef: null
}

let app: ReturnType<typeof mount> | null = null

function render(importedCharacterId: number | null = null) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(LibraryDetail, {
		target: host,
		props: {
			item,
			imageUrl: null,
			importing: false,
			importedCharacterId,
			onImport: () => {},
			onOpenInCharacters: () => {}
		}
	})
	flushSync()
	return host
}

const primary = (host: HTMLElement) =>
	host
		.querySelector<HTMLButtonElement>("button.preset-filled-primary-500")
		?.textContent?.trim() ?? ""

afterEach(() => {
	if (app) unmount(app)
	app = null
	wizardCharacterStep.active = false
	wizardCharacterStep.pickedCharacterId = null
	document.body.innerHTML = ""
})

describe("the Library detail inside the wizard", () => {
	test("outside the wizard the primary is Import", () => {
		const host = render()
		expect(primary(host)).toBe("Import")
	})

	test("on the Character step the primary is Pick this character", () => {
		wizardCharacterStep.active = true
		const host = render()
		expect(primary(host)).toBe("Pick this character")
		expect(host.textContent).not.toContain("Import")
	})

	test("the step coming and going relabels a mounted detail", () => {
		const host = render()
		wizardCharacterStep.active = true
		flushSync()
		expect(primary(host)).toBe("Pick this character")
		wizardCharacterStep.active = false
		flushSync()
		expect(primary(host)).toBe("Import")
	})

	test("the card chosen on the step reads Picked", () => {
		wizardCharacterStep.active = true
		wizardCharacterStep.pickedCharacterId = 7
		const host = render(7)
		expect(host.textContent).toContain("Picked")
		expect(host.textContent).not.toContain("In your characters")
	})

	test("an imported card the step did not choose stays In your characters", () => {
		wizardCharacterStep.active = true
		wizardCharacterStep.pickedCharacterId = 8
		const host = render(7)
		expect(host.textContent).toContain("In your characters")
		expect(host.textContent).not.toContain("Picked")
	})

	test("outside the wizard an imported card reads In your characters", () => {
		wizardCharacterStep.pickedCharacterId = 7
		const host = render(7)
		expect(host.textContent).toContain("In your characters")
		expect(host.textContent).not.toContain("Picked")
	})
})
