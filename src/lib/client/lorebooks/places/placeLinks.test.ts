/**
 * A place's Links list, as arithmetic (plan places-graph §10.3, B5).
 *
 * Every relationship the place is an end of, said from the place with the
 * one sentence (`relationshipSentence`), on the line being read: its own and
 * its ancestors' up to each fork, never a sibling's. A row another line owns
 * is shown read-only with the line to open; a row dated after the moment is
 * listed after the rest, with its date.
 */
import { describe, expect, it } from "vitest"
import { lineOf, MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import type { RelationshipEndRef } from "$lib/shared/lorebooks/linkVocabulary"
import type { PoolItem } from "../poolFilter"
import {
	newPlaceLink,
	placeChoices,
	placeLinkFields,
	placeLinkRows,
	placeLinkStands,
	type PlaceLinkReading
} from "./placeLinks"

const LOCATION = "core:entry/location"
const GUARDROOM = 40
const HALL = 41
const CRYPT = 42
const REACH = 50

const NAMES: Record<string, string> = {
	[`entry:${GUARDROOM}`]: "the Guardroom",
	[`entry:${HALL}`]: "the Drowned Hall",
	[`entry:${CRYPT}`]: "the Crypt",
	[`entry:${REACH}`]: "the Reach",
	"cast:7": "Verity"
}
const nameOf = (end: RelationshipEndRef) => NAMES[`${end.kind}:${end.id}`] ?? "?"

const place = (id: number) => ({
	kind: "entry" as const,
	entryId: id,
	name: NAMES[`entry:${id}`],
	typeId: LOCATION as any
})

const rel = (
	id: number,
	over: Partial<Sockets.NarrativeGraph.NarrativeRelationship> = {}
) =>
	({
		id,
		lorebookId: 1,
		from: place(GUARDROOM),
		to: place(HALL),
		fromNodeId: null,
		toNodeId: null,
		fromEntryId: GUARDROOM,
		toEntryId: HALL,
		historyEntryId: null,
		sceneId: null,
		branchId: null,
		relationshipType: "leads north to",
		reverseRelationshipType: null,
		name: "",
		description: "",
		visibility: "acknowledged",
		status: "active",
		reason: null,
		embedding: null,
		embeddingModel: null,
		createdAt: "",
		updatedAt: "",
		...over
	}) as Sockets.NarrativeGraph.NarrativeRelationship

const reading = (over: Partial<PlaceLinkReading> = {}): PlaceLinkReading => ({
	placeId: GUARDROOM,
	branchId: null,
	line: MAIN_LINE,
	moment: undefined,
	datedBy: [],
	nameOf,
	lineName: (id) => (id == null ? "main" : `line ${id}`),
	...over
})

describe("placeLinkRows — each row said from this place", () => {
	it("says an outbound relationship with its relationship type", () => {
		const [row] = placeLinkRows([rel(1)], reading())
		expect(row).toMatchObject({
			id: 1,
			way: "out",
			sentence: "Leads north to the Drowned Hall.",
			otherName: "the Drowned Hall",
			other: { kind: "entry", id: HALL },
			pairing: "entry-entry",
			locked: null,
			later: null
		})
	})

	it("says a both-ways relationship from its far end through the reverse", () => {
		const door = rel(2, {
			reverseRelationshipType: "leads south to",
			name: "the rusted iron door"
		})
		const [row] = placeLinkRows([door], reading({ placeId: HALL }))
		expect(row.way).toBe("back")
		expect(row.sentence).toBe(
			"The rusted iron door leads south to the Guardroom."
		)
	})

	it("says a one-way relationship into this place as a way in", () => {
		const [row] = placeLinkRows([rel(3)], reading({ placeId: HALL }))
		expect(row.way).toBe("inbound")
		expect(row.sentence).toBe("One way, into here from the Guardroom.")
	})

	it("names a cast member at the far end, and pairs it as cast-entry", () => {
		const keeper = rel(4, {
			from: { kind: "cast", bindingId: 7 },
			fromNodeId: 7,
			fromEntryId: null,
			relationshipType: "keeps"
		})
		const [row] = placeLinkRows([keeper], reading({ placeId: HALL }))
		expect(row.pairing).toBe("cast-entry")
		expect(row.otherName).toBe("Verity")
		// Said as drawn, both ends named (B4), the member its subject: the
		// default member↔place suggestion reads as a sentence from here.
		expect(row.sentence).toBe("Verity keeps the Drowned Hall.")
	})

	it("lists only the relationships this place is an end of", () => {
		const elsewhere = rel(5, { from: place(HALL), to: place(CRYPT) })
		expect(placeLinkRows([rel(1), elsewhere], reading()).map((r) => r.id)).toEqual([1])
	})
})

describe("placeLinkRows — the line being read", () => {
	// Line 5 forked off main; line 6 is its sibling.
	const branches = [
		{ id: 5, forkedFromBranchId: null },
		{ id: 6, forkedFromBranchId: null }
	]

	it("shows main's row on a fork read-only, naming the line to open", () => {
		const rows = placeLinkRows(
			[rel(1), rel(2, { branchId: 5, to: place(CRYPT) })],
			reading({ branchId: 5, line: lineOf(5, branches) })
		)
		expect(rows.map((r) => [r.id, r.locked])).toEqual([
			[1, "This link belongs to main. Open that line to change it."],
			[2, null]
		])
	})

	it("never lists a sibling line's row", () => {
		const rows = placeLinkRows(
			[rel(1, { branchId: 6 }), rel(2, { branchId: 5, to: place(CRYPT) })],
			reading({ branchId: 5, line: lineOf(5, branches) })
		)
		expect(rows.map((r) => r.id)).toEqual([2])
	})

	it("lists a row dated after the moment last, with its date", () => {
		const datedBy = [
			{ id: 90, year: 2, month: null, day: null },
			{ id: 91, year: 9, month: null, day: null }
		]
		const rows = placeLinkRows(
			[
				rel(1, { historyEntryId: 91 }),
				rel(2, { to: place(CRYPT), historyEntryId: 90 }),
				rel(3, { to: place(REACH) })
			],
			reading({ moment: "Y5", datedBy })
		)
		expect(rows.map((r) => [r.id, r.later])).toEqual([
			[2, null],
			[3, null],
			[1, "Y9 · later"]
		])
	})

	/**
	 * Review round: the canvas and "From here:" leave out a link whose far
	 * end is archived as of the moment. The list keeps it — the only place
	 * it can still be seen and unlinked — marked, last, and not counted.
	 */
	it("marks a link whose far end is archived at the moment, lists it last and does not count it", () => {
		const rows = placeLinkRows(
			[rel(1), rel(2, { to: place(CRYPT) }), rel(3, { to: place(REACH) })],
			reading({
				isArchived: (end) => end.kind === "entry" && end.id === HALL
			})
		)
		expect(rows.map((r) => [r.id, r.archived])).toEqual([
			[2, false],
			[3, false],
			[1, true]
		])
		expect(rows.filter(placeLinkStands).map((r) => r.id)).toEqual([2, 3])
	})

	it("counts neither a later link nor an archived far end as standing", () => {
		const datedBy = [{ id: 91, year: 9, month: null, day: null }]
		const rows = placeLinkRows(
			[rel(1, { historyEntryId: 91 }), rel(2, { to: place(CRYPT) })],
			reading({ moment: "Y5", datedBy, isArchived: () => false })
		)
		expect(rows.filter(placeLinkStands).map((r) => r.id)).toEqual([2])
	})
})

describe("the other end of a new link", () => {
	const item = (id: number, over: Partial<PoolItem> = {}): PoolItem => ({
		key: `entry#${id}`,
		id,
		kind: LOCATION,
		name: NAMES[`entry:${id}`] ?? `#${id}`,
		content: "",
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: 0,
		position: 0,
		priority: 0,
		createdAt: 0,
		updatedAt: 0,
		...over
	})

	it("offers every other place on the line, archived ones left out, by name", () => {
		const pool = [
			item(GUARDROOM),
			item(HALL),
			item(CRYPT, { archived: true }),
			item(REACH, { kind: "core:entry/world-lore" }),
			item(60, { name: "an Antechamber" })
		]
		expect(placeChoices(pool, GUARDROOM).map((p) => p.id)).toEqual([60, HALL])
	})

	it("starts from this place, both ways, with the first suggestion", () => {
		const draft = newPlaceLink(
			{ id: GUARDROOM, name: "the Guardroom" },
			{ id: HALL, name: "the Drowned Hall" },
			91
		)
		expect(draft.from).toMatchObject({ key: `entry#${GUARDROOM}`, kind: "entry" })
		expect(draft.to).toMatchObject({ key: `entry#${HALL}`, kind: "entry" })
		expect(draft.relationshipType).toBe("connects to")
		expect(draft.reverseRelationshipType).toBe("connects to")
		expect(draft.historyEntryId).toBe(91)
	})

	it("edits a stored relationship's own fields, never its ends", () => {
		const fields = placeLinkFields(
			rel(2, {
				reverseRelationshipType: "leads south to",
				name: "the rusted iron door",
				reason: "found in Y2"
			})
		)
		expect(fields).toEqual({
			id: 2,
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to",
			name: "the rusted iron door",
			description: "",
			status: "active",
			visibility: "acknowledged",
			reason: "found in Y2",
			historyEntryId: null
		})
	})
})
