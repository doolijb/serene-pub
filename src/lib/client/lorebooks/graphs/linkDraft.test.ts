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
	linkDraftChanged,
	linkDraftProblem,
	linkFormTitle,
	newLinkDraft,
	NEW_PLACE_OPTION,
	otherEndOptions,
	pickSuggestion,
	relationshipFieldsProblem,
	retargetLink,
	setBothWays,
	suggestionsFor,
	updateLinkParams,
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
			"keeps"
		)
		expect(suggestionsFor(archive, verity).map((s) => s.type)).toContain(
			"keeps"
		)
	})
})

describe("newLinkDraft — what the form opens on", () => {
	it("starts on the pairing's first suggestion, pointing the way it was dragged", () => {
		const draft = newLinkDraft(verity, archive)
		expect(draft.relationshipType).toBe("keeps")
		expect(draft.reversed).toBe(false)
		expect(draft.description).toBe("")
	})

	it("turns a member↔place draft drawn from the place round, so its words read from the member", () => {
		const draft = newLinkDraft(archive, verity)
		expect(draft.relationshipType).toBe("keeps")
		expect(draft.reversed).toBe(true)
		expect(linkFormTitle(draft)).toBe("Verity → The Archive")
		expect(createLinkParams(12, draft)).toMatchObject({
			from: { kind: "cast", bindingId: 1 },
			to: { kind: "entry", entryId: 40 },
			relationshipType: "keeps"
		})
		// Two places, and two members, keep the way they were drawn.
		expect(newLinkDraft(archive, undercroft).reversed).toBe(false)
		expect(newLinkDraft(verity, marrow).reversed).toBe(false)
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
			relationshipType: "keeps",
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

describe("Both ways — the reverse relationship type (plan B3)", () => {
	const suggestion = (type: string) =>
		suggestionsFor(archive, undercroft).find((s) => s.type === type)!

	it("opens a place↔place draft on a suggestion that pre-fills Both ways", () => {
		const draft = newLinkDraft(archive, undercroft)
		expect(draft.relationshipType).toBe("connects to")
		expect(draft.reverseRelationshipType).toBe("connects to")
		expect(draft.name).toBe("")
	})

	it("opens a member↔place and a member↔member draft one way", () => {
		expect(newLinkDraft(verity, archive).reverseRelationshipType).toBeNull()
		expect(newLinkDraft(verity, marrow).reverseRelationshipType).toBeNull()
	})

	it("turns Both ways off when a one-way suggestion is picked", () => {
		const draft = pickSuggestion(
			newLinkDraft(archive, undercroft),
			suggestion("leads to"),
			"entry-entry"
		)
		expect(draft.relationshipType).toBe("leads to")
		expect(draft.reverseRelationshipType).toBeNull()
	})

	it("pre-fills `holds` for `is inside`", () => {
		expect(
			pickSuggestion(
				newLinkDraft(archive, undercroft),
				suggestion("is inside"),
				"entry-entry"
			).reverseRelationshipType
		).toBe("holds")
	})

	it("repeats the words when Both ways is turned on over a wording of your own", () => {
		const draft = setBothWays(
			{
				...newLinkDraft(archive, undercroft),
				relationshipType: "the old way",
				reverseRelationshipType: null
			},
			true,
			"entry-entry"
		)
		expect(draft.reverseRelationshipType).toBe("the old way")
	})

	it("takes the suggestion's own reverse when Both ways is turned on over one", () => {
		const draft = setBothWays(
			{
				...newLinkDraft(archive, undercroft),
				relationshipType: "is inside",
				reverseRelationshipType: null
			},
			true,
			"entry-entry"
		)
		expect(draft.reverseRelationshipType).toBe("holds")
	})

	it("clears the reverse when Both ways is turned off", () => {
		expect(
			setBothWays(newLinkDraft(archive, undercroft), false, "entry-entry")
				.reverseRelationshipType
		).toBeNull()
	})

	it("never gives two cast members a reverse", () => {
		expect(
			setBothWays(newLinkDraft(verity, marrow), true, "cast-cast")
				.reverseRelationshipType
		).toBeNull()
	})

	it("says what is missing before a save", () => {
		const draft = newLinkDraft(archive, undercroft)
		expect(relationshipFieldsProblem(draft)).toBeNull()
		expect(
			relationshipFieldsProblem({ ...draft, relationshipType: "  " })
		).toBe("Say what joins them.")
		expect(
			relationshipFieldsProblem({ ...draft, reverseRelationshipType: " " })
		).toBe("Say how it reads from the other end, or turn Both ways off.")
	})
})

describe("createLinkParams — the name and the reverse (plan B3)", () => {
	it("sends the name and the reverse, trimmed", () => {
		const params = createLinkParams(12, {
			...newLinkDraft(archive, undercroft),
			relationshipType: " leads north to ",
			reverseRelationshipType: " leads south to ",
			name: "  the rusted iron door "
		})
		expect(params.relationshipType).toBe("leads north to")
		expect(params.reverseRelationshipType).toBe("leads south to")
		expect(params.name).toBe("the rusted iron door")
	})

	it("leaves a blank name and a one-way reverse out", () => {
		const params = createLinkParams(12, {
			...newLinkDraft(archive, undercroft),
			reverseRelationshipType: null
		})
		expect("name" in params).toBe(false)
		expect("reverseRelationshipType" in params).toBe(false)
	})
})

describe("updateLinkParams — what an edit sends (plan B3)", () => {
	const row = {
		id: 90,
		lorebookId: 12,
		from: { kind: "entry", entryId: 40, name: "The Archive", typeId: "core:entry/location" },
		to: { kind: "entry", entryId: 41, name: "The Undercroft", typeId: "core:entry/location" },
		relationshipType: "leads down to",
		reverseRelationshipType: "leads up to",
		name: "the spiral stair",
		description: "Worn in the middle.",
		status: "active",
		visibility: "acknowledged",
		reason: null,
		historyEntryId: 5,
		branchId: 3
	} as any

	it("round-trips the name and the reverse, and says which line it is read from", () => {
		expect(updateLinkParams(row, 3)).toEqual({
			relationship: {
				id: 90,
				relationshipType: "leads down to",
				reverseRelationshipType: "leads up to",
				name: "the spiral stair",
				description: "Worn in the middle.",
				status: "active",
				visibility: "acknowledged",
				reason: null,
				historyEntryId: 5
			},
			branchId: 3
		})
	})

	it("sends a null reverse once Both ways is off, so the server clears it", () => {
		expect(
			updateLinkParams({ ...row, reverseRelationshipType: null }, null)
				.relationship.reverseRelationshipType
		).toBeNull()
	})

	it("sends main as null, never leaves the line out", () => {
		expect(updateLinkParams(row, null)).toHaveProperty("branchId", null)
	})

	it("never resends the ends", () => {
		const { relationship } = updateLinkParams(row, 3)
		expect("from" in relationship).toBe(false)
		expect("to" in relationship).toBe(false)
	})
})

/**
 * Plan places-graph B4: the other end is picked from every place on the line
 * (or made on the spot), so the draft may be retargeted across pairings.
 */
describe("retargetLink — a new far end (B4)", () => {
	it("offers the new pairing's words when the old ones were only the old pairing's offer", () => {
		const draft = newLinkDraft(verity, marrow)
		expect(draft.relationshipType).toBe("neutral")
		const next = retargetLink(draft, archive)
		expect(next.to).toBe(archive)
		expect(next.relationshipType).toBe("keeps")
		expect(next.reverseRelationshipType).toBeNull()
		expect(next.reversed).toBe(false)
	})

	it("turns an offered member↔place draft from a place round to read from the member", () => {
		const fromPlace = newLinkDraft(archive, undercroft)
		const next = retargetLink(fromPlace, verity)
		expect(next.relationshipType).toBe("keeps")
		expect(next.reversed).toBe(true)
		expect(linkFormTitle(next)).toBe("Verity → The Archive")
		// Back to a place: the way it was drawn again.
		expect(retargetLink(next, undercroft).reversed).toBe(false)
	})

	it("keeps the way typed words were drawn", () => {
		const typed = {
			...newLinkDraft(archive, undercroft),
			relationshipType: "is haunted by"
		}
		expect(retargetLink(typed, verity).reversed).toBe(false)
	})

	it("keeps words the writer typed", () => {
		const draft = {
			...newLinkDraft(archive, undercroft),
			relationshipType: "tunnels under"
		}
		expect(retargetLink(draft, verity).relationshipType).toBe(
			"tunnels under"
		)
	})

	it("keeps the words and the way back within one pairing", () => {
		const draft = pickSuggestion(
			newLinkDraft(archive, undercroft),
			{ type: "is inside", reverse: "holds" },
			"entry-entry"
		)
		const next = retargetLink(draft, node({ key: "entry#42", name: "The Keep" }))
		expect(next.relationshipType).toBe("is inside")
		expect(next.reverseRelationshipType).toBe("holds")
	})

	it("never leaves a way back between two cast members", () => {
		const draft = {
			...newLinkDraft(verity, archive),
			relationshipType: "guards",
			reverseRelationshipType: "is guarded by"
		}
		expect(retargetLink(draft, marrow).reverseRelationshipType).toBeNull()
	})
})

describe("linkDraftProblem — why Name it waits (B4)", () => {
	it("asks for the other end while the draft points at itself", () => {
		expect(linkDraftProblem(newLinkDraft(archive, archive))).toBe(
			"Pick the other end."
		)
	})

	it("titles a draft with no far end yet by its one end", () => {
		expect(linkFormTitle(newLinkDraft(archive, archive))).toBe(
			"The Archive → …"
		)
	})

	it("otherwise says what the fields lack, or nothing", () => {
		expect(
			linkDraftProblem({
				...newLinkDraft(archive, undercroft),
				relationshipType: " "
			})
		).toBe("Say what joins them.")
		expect(linkDraftProblem(newLinkDraft(archive, undercroft))).toBeNull()
	})
})

describe("otherEndOptions — the far end's searchable list (B4)", () => {
	const place = (key: string, name: string) =>
		node({ key, name, typeId: "core:entry/location" })
	const lore = node({ key: "entry#50", name: "The Reach", typeId: "core:entry/world-lore" })
	const candidates = [verity, place("entry#1", "The Guardroom"), lore, place("entry#2", "The Hall")]

	it("lists places first, then cast, then other lore, leaving out the near end", () => {
		expect(
			otherEndOptions(candidates, "entry#1", false).map((o) => [o.group, o.label])
		).toEqual([
			["Places", "The Hall"],
			["Cast", "Verity"],
			["Lore", "The Reach"]
		])
	})

	it("ends on New place…, listed whatever is typed", () => {
		const last = otherEndOptions(candidates, "entry#1", true).at(-1)
		expect(last).toEqual({
			value: NEW_PLACE_OPTION,
			label: "New place…",
			unfiltered: true
		})
	})
})

describe("linkDraftChanged — a new link's form counts as unsaved once touched (plan B7)", () => {
	it("is clean as it opened, whatever it opened on", () => {
		const opened = newLinkDraft(verity, archive, 7)
		expect(linkDraftChanged(opened, { ...opened })).toBe(false)
	})

	it("is changed by a word, a field, the far end or the direction", () => {
		const opened = newLinkDraft(verity, archive)
		expect(
			linkDraftChanged(opened, { ...opened, relationshipType: "guards" })
		).toBe(true)
		expect(linkDraftChanged(opened, { ...opened, name: "the vow" })).toBe(true)
		expect(linkDraftChanged(opened, { ...opened, historyEntryId: 3 })).toBe(
			true
		)
		expect(linkDraftChanged(opened, retargetLink(opened, undercroft))).toBe(
			true
		)
		expect(
			linkDraftChanged(opened, { ...opened, reversed: !opened.reversed })
		).toBe(true)
	})
})
