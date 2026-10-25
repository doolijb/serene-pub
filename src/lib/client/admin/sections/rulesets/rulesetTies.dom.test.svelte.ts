/**
 * 🚧 Screen 1 of "Ties on the graph" (lane T2, 2026-10-23): the editor's
 * entry type card for a tie — the far-end picker, the sides worked out from
 * the ends, what reads onto the lorebook graph, and the grid of what the
 * model is told of each field (words on, the number off). What the card sets
 * is what the document saves.
 *
 * ⚠ No DOM node is ever handed to `expect`: every check compares a boolean,
 * a string or plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import RulesetEntryTypesSection from "./RulesetEntryTypesSection.svelte"
import { sectionsFormOf, writeEntryType } from "./rulesetSectionsForm"

const DOC = {
	id: "acme.lab:ruleset/hollow-hearts@1",
	version: "1.0.0",
	name: { en: "Hollow Hearts" },
	entryTypes: [
		{
			id: "bond",
			name: { en: "Bond" },
			relational: true,
			farEnd: "person",
			prose: "What two people are to each other.",
			fields: {
				affection: { type: "integer", min: 0, max: 10, default: 3, label: { en: "Affection" } },
				standing: { type: "enum", of: ["cold", "wary", "warm", "close"], label: { en: "Standing" } },
				tie: { type: "string", label: { en: "Tie" } }
			},
			readsOnto: { standing: "relationship-type" }
		},
		{ id: "keepsake", name: { en: "Keepsake" }, prose: "A small thing kept.", fields: { worn: { type: "enum", of: ["new", "worn"], label: { en: "Worn" } } } }
	]
}

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	target?.remove()
})

function render() {
	const form = $state(sectionsFormOf(DOC as never, "Hollow Hearts"))
	target = document.createElement("div")
	document.body.appendChild(target)
	app = mount(RulesetEntryTypesSection, { target, props: { form, scopes: [] } })
	flushSync()
	return form
}
const text = (sel: string) => (document.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim()
const click = (sel: string) => {
	;(document.querySelector(sel) as HTMLElement).click()
	flushSync()
}

describe("the editor's card for a tie (screen 1)", () => {
	test("the far end picked, the sides worked out; another end changes them; the card says what it is", () => {
		const form = render()
		const bond = '[data-entry-type="bond"]'
		expect(text(`${bond} [data-entry-kind]`)).toBe("between two people")
		expect(document.querySelector(`${bond} [data-far-end="person"]`)?.getAttribute("aria-pressed")).toBe("true")
		expect(text(`${bond} [data-tie-sides]`)).toBe("Two · each person holds their own side")
		click(`${bond} [data-far-end="place"]`)
		expect(text(`${bond} [data-tie-sides]`)).toBe("One · held by the world")
		expect(text(`${bond} [data-entry-kind]`)).toBe("to a place")
		expect(writeEntryType(form.entryTypes[0]!)).toMatchObject({ farEnd: "place" })
		// Clicking the picked end again unsays it: the sides wait for an end.
		click(`${bond} [data-far-end="place"]`)
		expect(text(`${bond} [data-tie-sides]`)).toContain("Say what the other end may be")
		expect("farEnd" in (writeEntryType(form.entryTypes[0]!) as object)).toBe(false)
		// A held thing says no ends.
		expect(document.querySelector('[data-entry-type="keepsake"] [data-tie-ends]')).toBeNull()
		expect(text('[data-entry-type="keepsake"] [data-entry-kind]')).toBe("held")
	})

	test("what reads onto the lorebook graph: the type from a words field, the name from another; numbers are never offered", () => {
		const form = render()
		const bond = '[data-entry-type="bond"]'
		expect(text(`${bond} [data-reads-onto] h4`)).toBe("On the lorebook graph")
		expect(text(`#onto-type-${form.entryTypes[0]!.uid}`)).toBe("Standing")
		expect(text(`#onto-name-${form.entryTypes[0]!.uid}`)).toBe("Nothing")
		click(`#onto-name-${form.entryTypes[0]!.uid}`)
		const options = [...document.querySelectorAll(`#onto-name-${form.entryTypes[0]!.uid}-list [role=option]`)].map((o) => (o.textContent ?? "").trim())
		expect(options).toEqual(["Nothing", "Standing", "Tie"])
		;([...document.querySelectorAll(`#onto-name-${form.entryTypes[0]!.uid}-list [role=option]`)].find((o) => o.textContent?.trim() === "Tie") as HTMLElement).click()
		flushSync()
		expect(writeEntryType(form.entryTypes[0]!)).toMatchObject({ readsOnto: { standing: "relationship-type", tie: "relationship-name" } })
		// A held thing's fields are copied onto its own entry instead.
		expect(text('[data-entry-type="keepsake"] [data-reads-onto]')).toContain("Copied onto its own entry")
	})

	test("the sharing grid: words on and the number off by default; ticks save only what differs", () => {
		const form = render()
		const row = (f: string) => `[data-entry-type="bond"] [data-share-field="${f}"]`
		const boxes = (f: string) => [...document.querySelectorAll(`${row(f)} input[type=checkbox]`)].map((b) => (b as HTMLInputElement).checked)
		expect(boxes("affection")).toEqual([true, false])
		expect(boxes("standing")).toEqual([true])
		expect(text(row("standing"))).toContain("words only")
		;(document.querySelectorAll(`${row("affection")} input[type=checkbox]`)[1] as HTMLInputElement).click()
		;(document.querySelectorAll(`${row("standing")} input[type=checkbox]`)[0] as HTMLInputElement).click()
		flushSync()
		expect(writeEntryType(form.entryTypes[0]!)).toMatchObject({ modelShare: { affection: { number: true }, standing: { words: false } } })
		expect(boxes("affection")).toEqual([true, true])
	})
})
