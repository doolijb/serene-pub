/**
 * Naming a relationship by dragging one node onto another: what the picker
 * offers for the pairing, and what the socket is handed.
 */
import { describe, expect, it } from "vitest"
import type { GraphNode } from "./graphModel"
import {
	createLinkParams,
	flipLink,
	isReplyFor,
	linkFormTitle,
	newLinkDraft,
	suggestionsFor,
	whenAtMoment,
	whenLabel,
	whenOptions
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
			branchId: null,
			description: "She holds the keys."
		})
	})

	it("draws the link on the line being read (#124)", () => {
		expect(createLinkParams(12, newLinkDraft(verity, marrow), 7).branchId).toBe(7)
	})

	it("sends the date the form chose, and none when it chose none (#120)", () => {
		expect(
			createLinkParams(12, newLinkDraft(verity, marrow, 88)).historyEntryId
		).toBe(88)
		expect(
			"historyEntryId" in createLinkParams(12, newLinkDraft(verity, marrow))
		).toBe(false)
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

const spell = (d: { year: number; month: number | null; day: number | null }) =>
	`Y${d.year}${d.month ? `-${d.month}` : ""}${d.day ? `-${d.day}` : ""}`

describe("the When picker (#120)", () => {
	const entries = [
		{ id: 5, name: "The flood", year: 3, month: 2, day: 12 },
		{ id: 6, name: "", year: 4, month: null, day: null }
	]

	it("names the entry and spells its date through the calendar", () => {
		expect(whenLabel(entries[0], spell)).toBe("The flood · Y3-2-12")
	})

	it("falls back to the date alone for an unnamed entry", () => {
		expect(whenLabel(entries[1], spell)).toBe("Y4")
	})

	it("offers No date first", () => {
		expect(whenOptions(entries, spell).map((o) => o.value)).toEqual([
			"",
			"5",
			"6"
		])
	})

	it("starts on the entry dated exactly the moment being read", () => {
		expect(whenAtMoment(entries, { year: 3, month: 2, day: 12 })).toBe(5)
	})

	it("starts undated at now and on a date no entry holds", () => {
		expect(whenAtMoment(entries, null)).toBeNull()
		expect(whenAtMoment(entries, { year: 3, month: 2, day: 13 })).toBeNull()
	})
})

describe("isReplyFor — the create reply that answers this form (#53, #55)", () => {
	const params = createLinkParams(12, newLinkDraft(verity, archive))
	const reply = {
		lorebookId: 12,
		from: { kind: "cast", bindingId: 1 } as const,
		to: {
			kind: "entry",
			entryId: 40,
			name: "The Archive",
			typeId: "core:entry/location"
		} as any
	}

	it("matches the book and both ends", () => {
		expect(isReplyFor(params, reply)).toBe(true)
	})

	it("ignores another book's link", () => {
		expect(isReplyFor(params, { ...reply, lorebookId: 13 })).toBe(false)
	})

	it("ignores a link between other ends", () => {
		expect(
			isReplyFor(params, {
				...reply,
				from: { kind: "cast", bindingId: 2 }
			})
		).toBe(false)
	})
})
