/**
 * Naming a relationship by dragging one node onto another: what the picker
 * offers for the pairing, and what the socket is handed.
 */
import { describe, expect, it } from "vitest"
import type { GraphNode } from "./graphModel"
import {
	createLinkParams,
	flipLink,
	linkFormTitle,
	newLinkDraft,
	suggestionsFor
} from "./linkDraft"

const node = (over: Partial<GraphNode> & { key: string }): GraphNode => ({
	kind: over.key.startsWith("cast") ? "cast" : "entry",
	id: Number(over.key.split("#")[1]),
	name: "Somebody",
	state: "active",
	visibility: "normal",
	...over
})

const verity = node({ key: "cast#1", name: "Verity" })
const marrow = node({ key: "cast#2", name: "Marrow" })
const archive = node({ key: "entry#40", name: "The Archive" })
const undercroft = node({ key: "entry#41", name: "The Undercroft" })

describe("suggestionsFor — the list the pairing offers", () => {
	it("offers roads between two entries", () => {
		expect(
			suggestionsFor(archive, undercroft).map((s) => s.type)
		).toContain("connects to")
	})

	it("offers standing between two members", () => {
		expect(suggestionsFor(verity, marrow).map((s) => s.type)).toContain(
			"ally"
		)
	})

	it("offers keeping between a member and a place, whichever end is dragged", () => {
		expect(suggestionsFor(verity, archive).map((s) => s.type)).toContain(
			"keeper of"
		)
		expect(suggestionsFor(archive, verity).map((s) => s.type)).toContain(
			"keeper of"
		)
	})
})

describe("newLinkDraft — what the form opens on", () => {
	it("starts on the pairing's first suggestion, pointing the way it was dragged", () => {
		const draft = newLinkDraft(verity, archive)
		expect(draft.relationshipType).toBe("keeper of")
		expect(draft.reversed).toBe(false)
		expect(draft.description).toBe("")
	})

	it("names the two ends in the order they were dragged", () => {
		expect(linkFormTitle(newLinkDraft(verity, archive))).toBe(
			"Verity → The Archive"
		)
	})

	it("names them the other way once the direction is turned round", () => {
		expect(linkFormTitle(flipLink(newLinkDraft(verity, archive)))).toBe(
			"The Archive → Verity"
		)
	})
})

describe("createLinkParams — what the socket is handed", () => {
	it("sends both ends in the endpoint shape, in the drawn direction", () => {
		expect(
			createLinkParams(12, {
				...newLinkDraft(verity, archive),
				description: "She holds the keys."
			})
		).toEqual({
			lorebookId: 12,
			from: { kind: "cast", bindingId: 1 },
			to: { kind: "entry", entryId: 40 },
			relationshipType: "keeper of",
			status: "active",
			visibility: "acknowledged",
			description: "She holds the keys."
		})
	})

	it("swaps the ends when the direction is turned round", () => {
		const params = createLinkParams(
			12,
			flipLink(newLinkDraft(verity, archive))
		)
		expect(params.from).toEqual({ kind: "entry", entryId: 40 })
		expect(params.to).toEqual({ kind: "cast", bindingId: 1 })
	})

	it("leaves the description out rather than sending an empty one", () => {
		expect(
			createLinkParams(12, newLinkDraft(verity, marrow)).description
		).toBeUndefined()
	})

	it("sends whatever type was typed, vocabulary or not", () => {
		expect(
			createLinkParams(12, {
				...newLinkDraft(archive, undercroft),
				relationshipType: "  the old way  "
			}).relationshipType
		).toBe("the old way")
	})
})
