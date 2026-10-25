/**
 * 🚧 A rules list entry's editor (lane C1): the list's own fields, drawn
 * from its piece shape, written into the draft as the entry stores them,
 * with the write gate's refusal under the field it is about.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}))
// The core fields' content editor is a contenteditable the test does not drive.
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import "@serene-pub/core-catalog"
import { getRuleset, i18nText } from "@serene-pub/sdk"
import DerivedEntryEditor from "./DerivedEntryEditor.svelte"
import { rememberRulesLists } from "./derivedPiece"
import { rulesListDoor } from "."

const rules = getRuleset("core:ruleset/vis-itineris@1")!
const rep = rules.repertoires.find((r) => r.id === "weapons")!
const WEAPONS = {
	typeId: "core:entry/vis-itineris.weapons",
	label: i18nText(rep.label) ?? "Weapons",
	repertoireId: "weapons",
	piece: rep.piece,
	libraryRows: 12
}

let app: Record<string, any> | null = null

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	flushSync()
}

function editorWith(row: Record<string, unknown>) {
	rememberRulesLists([WEAPONS])
	const draft = $state<Record<string, any>>({ ...row })
	const el = document.createElement("div")
	document.body.append(el)
	app = mount(DerivedEntryEditor, {
		target: el,
		props: {
			lorebookId: 1,
			draft,
			source: null,
			isNew: true,
			bindings: [],
			vectorizationEnabled: false,
			siblings: []
		}
	})
	return draft
}

const field = (key: string) =>
	document.querySelector<HTMLElement>(`[data-piece-field="${key}"]`)

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
	input.value = value
	input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("DerivedEntryEditor", () => {
	test("draws the list's own fields beside the core ones", async () => {
		editorWith(rulesListDoor(WEAPONS).newDraft(1))
		await settle()
		expect(
			document
				.querySelector("[data-rules-list-fields]")
				?.getAttribute("data-rules-list-fields")
		).toBe(WEAPONS.typeId)
		for (const key of ["description", "category", "damage", "hands"])
			expect(field(key) !== null, key).toBe(true)
		// Worn and how long it lasts are a holder's, never the book's weapon's.
		expect(field("equipped") === null).toBe(true)
		expect(field("duration") === null).toBe(true)
	})

	test("a piece field typed is saved into the draft as stored", async () => {
		const draft = editorWith(rulesListDoor(WEAPONS).newDraft(1))
		await settle()
		type(
			field("description")!.querySelector("textarea")!,
			"A short, light blade."
		)
		type(field("hands")!.querySelector("input")!, "1")
		type(
			field("damage")!.querySelector<HTMLInputElement>(
				'input[type="number"]'
			)!,
			"2"
		)
		await settle()
		expect(draft.description).toBe("A short, light blade.")
		expect(draft.hands).toBe(1)
		expect(draft.damage).toEqual({ dice: 2 })
	})

	test("the write gate's refusal shows under the field it is about", async () => {
		editorWith({
			...rulesListDoor(WEAPONS).newDraft(1),
			name: "Dagger",
			description: "Short.",
			category: "simple"
		})
		await settle()
		const alert = field("damage")!.querySelector('[role="alert"]')
		expect(alert?.textContent?.trim()).toBe("Add damage to save this.")
		// The door's own check says no until it is fixed.
		const door = rulesListDoor(WEAPONS)
		expect(
			door.validate(
				{ name: "Dagger", description: "Short.", category: "simple" },
				[]
			)
		).toBe(false)
		expect(
			door.validate(
				{
					name: "Dagger",
					description: "Short.",
					category: "simple",
					damage: { dice: 1, die: "d4" },
					supply: "unlimited"
				},
				[]
			)
		).toBe(true)
	})
})
