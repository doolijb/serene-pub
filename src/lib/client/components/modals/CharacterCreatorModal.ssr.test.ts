/**
 * The character creator, rendered — its element ids (2026-09-17).
 *
 * Three creators are mounted at once on the home page with the characters
 * panel open (the panel's, the page's character and persona creators), and a
 * Skeleton dialog renders its content hidden while closed, so three inputs
 * shared `id="characterCreatorStepName"` and every `<label for>` resolved to
 * whichever came first in the DOM. The ids are `$props.id()`-derived now.
 *
 * `render` from `svelte/server`: the repo
 * has no browser test environment, and the markup is what this is about.
 * Two instances in one document are not renderable this way, so the pin is
 * the next best thing — the id is not the literal, it is what the label and
 * the error's `aria-describedby` reference, and it follows the render's
 * `idPrefix`, which is how two instances come to differ.
 */
import { describe, expect, test, vi } from "vitest"
import { render } from "svelte/server"

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))

import CharacterCreatorModal from "./CharacterCreatorModal.svelte"

function renderOpen(idPrefix: string): string {
	return render(CharacterCreatorModal, {
		props: { open: true },
		idPrefix
	}).body
}

/** `id="…"` of the input the *Name\** label points at. */
function nameInputId(html: string): string {
	const label = html.match(/<label[^>]*\sfor="([^"]+)"[^>]*>\s*Name\*/)
	expect(label, "the Name label").toBeTruthy()
	return label![1]!
}

describe("CharacterCreatorModal ids", () => {
	test("the name input's id is per instance, and the label points at it", () => {
		const html = renderOpen("one")
		const id = nameInputId(html)
		expect(id).not.toBe("characterCreatorStepName")
		expect(id.startsWith("one")).toBe(true)
		expect(html).toContain(`id="${id}"`)
		// Exactly one element carries it.
		expect(html.split(`id="${id}"`)).toHaveLength(2)
		// None of the old literals survive anywhere in the markup.
		for (const literal of [
			"characterCreatorStepName",
			"characterCreatorStepDescription",
			"stepNickname",
			"stepPersonality",
			"stepFirstMessage",
			'id="name-error"',
			'id="description-error"'
		])
			expect(html).not.toContain(literal)
	})

	test("two instances get two ids", () => {
		expect(nameInputId(renderOpen("one"))).not.toBe(
			nameInputId(renderOpen("two"))
		)
	})
})
