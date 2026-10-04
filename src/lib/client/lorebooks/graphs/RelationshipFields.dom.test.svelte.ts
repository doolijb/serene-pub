/**
 * One set of fields for a relationship (plan places-graph §6.2, B3): the
 * chips pre-fill Both ways, From there it… shows only while Both ways is on,
 * and two cast members are never offered a way back.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import RelationshipFields from "./RelationshipFields.svelte"
import type { RelationshipFieldsValue } from "./linkDraft"
import type { LinkPairing } from "$lib/shared/lorebooks/linkVocabulary"

describe("RelationshipFields", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement

	afterEach(() => {
		if (app) unmount(app)
		app = null
		document.body.innerHTML = ""
	})

	function render(pairing: LinkPairing, initial: Partial<RelationshipFieldsValue> = {}) {
		const props = $state({
			value: {
				relationshipType: "leads to",
				reverseRelationshipType: null,
				name: "",
				description: "",
				status: "active",
				visibility: "acknowledged",
				historyEntryId: null,
				...initial
			} as RelationshipFieldsValue,
			pairing,
			onChange: (next: RelationshipFieldsValue) => {
				props.value = next
			}
		})
		host = document.createElement("div")
		document.body.append(host)
		app = mount(RelationshipFields, { target: host, props })
		flushSync()
		return props
	}

	const chip = (type: string) =>
		[...host.querySelectorAll<HTMLButtonElement>("button.chip")].find(
			(b) => b.textContent?.trim() === type
		)!
	const reverseInput = () =>
		host.querySelector<HTMLInputElement>('input[placeholder="leads back to"]')
	const text = () => host.textContent ?? ""

	test("a both-ways suggestion turns Both ways on and says it from the far end", () => {
		const props = render("entry-entry")
		expect(text()).toContain("Both ways")
		expect(reverseInput()).toBeNull()

		chip("is inside").click()
		flushSync()
		expect(props.value.relationshipType).toBe("is inside")
		expect(props.value.reverseRelationshipType).toBe("holds")
		expect(text()).toContain("From there it…")
		expect(reverseInput()?.value).toBe("holds")

		chip("leads to").click()
		flushSync()
		expect(props.value.reverseRelationshipType).toBeNull()
		expect(reverseInput()).toBeNull()
	})

	test("types the far end's words into the reverse", () => {
		const props = render("entry-entry", {
			relationshipType: "leads north to",
			reverseRelationshipType: "leads north to"
		})
		const input = reverseInput()!
		input.value = "leads south to"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(props.value.reverseRelationshipType).toBe("leads south to")
	})

	test("names the relationship", () => {
		const props = render("entry-entry")
		const name = host.querySelector<HTMLInputElement>(
			'input[placeholder="the rusted iron door"]'
		)!
		name.value = "the rusted iron door"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		expect(props.value.name).toBe("the rusted iron door")
	})

	test("never offers two cast members a way back", () => {
		render("cast-cast", { relationshipType: "ally" })
		expect(text()).not.toContain("Both ways")
		expect(reverseInput()).toBeNull()
	})
})
