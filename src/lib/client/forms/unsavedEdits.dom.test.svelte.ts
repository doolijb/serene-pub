/**
 * The tracker's promises: dirty in the same tick, clean again when changed
 * back, clean after a save, and a server push that neither clobbers the
 * person's edits nor marks an untouched form dirty.
 */
import { describe, expect, test } from "vitest"
import { UnsavedEdits } from "./unsavedEdits.svelte"

function form(initial: Record<string, unknown>) {
	const draft = $state({ ...initial })
	const edits = new UnsavedEdits(() => draft, { unordered: ["ids"] })
	return { draft, edits }
}

describe("UnsavedEdits", () => {
	test("nothing is dirty before the first markSaved", () => {
		const { draft, edits } = form({ name: "Wren" })
		draft.name = "Ash"
		expect(edits.dirty).toBe(false)
	})

	test("dirty in the same tick, clean when changed back", () => {
		const { draft, edits } = form({ name: "Wren" })
		edits.markSaved()
		expect(edits.dirty).toBe(false)
		draft.name = "Ash"
		expect(edits.dirty).toBe(true)
		draft.name = "Wren"
		expect(edits.dirty).toBe(false)
	})

	test("the snapshot is a copy: editing the draft does not move it", () => {
		const { draft, edits } = form({ ids: [1, 2] })
		edits.markSaved()
		;(draft.ids as number[]).push(3)
		expect(edits.dirty).toBe(true)
	})

	test("input-shaped values and re-ordered sets are clean", () => {
		const { draft, edits } = form({ n: 5, note: null, ids: [1, 2] })
		edits.markSaved()
		draft.n = "5"
		draft.note = ""
		draft.ids = [2, 1]
		expect(edits.dirty).toBe(false)
	})

	test("save makes it clean", () => {
		const { draft, edits } = form({ name: "Wren" })
		edits.markSaved()
		draft.name = "Ash"
		edits.markSaved()
		expect(edits.dirty).toBe(false)
	})

	test("a push to a clean form replaces the draft and stays clean", () => {
		const { draft, edits } = form({ name: "Wren" })
		edits.markSaved()
		edits.adoptSaved({ name: "Rowan" }, (next) => Object.assign(draft, next))
		expect(draft.name).toBe("Rowan")
		expect(edits.dirty).toBe(false)
	})

	test("a push to a dirty form keeps the edits", () => {
		const { draft, edits } = form({ name: "Wren", note: "a" })
		edits.markSaved()
		draft.name = "Ash"
		edits.adoptSaved({ name: "Wren", note: "b" }, (next) =>
			Object.assign(draft, next)
		)
		expect(draft.name).toBe("Ash")
		expect(draft.note).toBe("a")
		expect(edits.dirty).toBe(true)
	})

	test("the echo of our own save is clean", () => {
		const { draft, edits } = form({ name: "Wren" })
		edits.markSaved()
		draft.name = "Ash"
		edits.adoptSaved({ name: "Ash" }, (next) => Object.assign(draft, next))
		expect(edits.dirty).toBe(false)
	})

	test("forget clears it", () => {
		const { draft, edits } = form({ name: "Wren" })
		edits.markSaved()
		draft.name = "Ash"
		edits.forget()
		expect(edits.dirty).toBe(false)
	})
})
