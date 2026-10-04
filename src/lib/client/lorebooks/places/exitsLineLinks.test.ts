/**
 * The links a room's `Exits:` line names, judged against the book (plan
 * places-graph §11, B7).
 *
 * **Read links from the Exits line** turns the prose line the Lair's drafts
 * still write into links — on request, never at write time (Q4 is open), and
 * never without the person confirming. Each way out is resolved by the one
 * room rule (`locationRowOf`), and judged against the place's Links rows by
 * the words the one-row-per-way guard compares: a link that already says it
 * is not offered again, so the action is idempotent.
 */
import { describe, expect, it } from "vitest"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import type { RelationshipEndRef } from "$lib/shared/lorebooks/linkVocabulary"
import { parseExitsLine } from "$lib/shared/lorebooks/exitsLine"
import { createLinkParams } from "../graphs/linkDraft"
import type { PoolItem } from "../poolFilter"
import {
	exitsLineDraft,
	exitsLineLinks,
	exitsLineTicks,
	isOffered
} from "./exitsLineLinks"
import { placeLinkRows } from "./placeLinks"
// New in the review round: read off the module, so its absence fails its own cases only.
import * as judged from "./exitsLineLinks"

const LOCATION = "core:entry/location"
const WORLD = "core:entry/world"
const GUARDROOM = 40
const HALL = 41
const CISTERN = 42
const PIT = 43
const LORE = 44

const NAMES: Record<number, string> = {
	[GUARDROOM]: "The Guardroom",
	[HALL]: "The Drowned Hall",
	[CISTERN]: "The Cistern",
	[PIT]: "The Pit",
	[LORE]: "The Old Well"
}

const item = (id: number, over: Partial<PoolItem> = {}): PoolItem => ({
	key: `entry#${id}`,
	id,
	kind: LOCATION,
	name: NAMES[id],
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

const POOL = [
	item(GUARDROOM),
	item(HALL),
	item(CISTERN, { keys: ["cistern, the tank"] }),
	item(PIT, { archived: true }),
	// World lore, not a place: an Exits line never names it.
	item(LORE, { kind: WORLD })
]

const end = (id: number) => ({
	kind: "entry" as const,
	entryId: id,
	name: NAMES[id],
	typeId: LOCATION as any
})

const rel = (
	id: number,
	over: Partial<Sockets.NarrativeGraph.NarrativeRelationship> = {}
) =>
	({
		id,
		lorebookId: 1,
		from: end(GUARDROOM),
		to: end(HALL),
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

const nameOf = (end: RelationshipEndRef) => NAMES[end.id]
const rowsOf = (
	rels: Sockets.NarrativeGraph.NarrativeRelationship[],
	placeId = GUARDROOM
) =>
	placeLinkRows(rels, {
		placeId,
		branchId: null,
		line: MAIN_LINE,
		moment: undefined,
		datedBy: [],
		nameOf,
		lineName: () => "main"
	})

const read = (
	line: string,
	rels: Sockets.NarrativeGraph.NarrativeRelationship[] = [],
	placeId = GUARDROOM
) =>
	exitsLineLinks(parseExitsLine(line), {
		place: { id: placeId, name: NAMES[placeId] },
		pool: POOL,
		rows: rowsOf(rels, placeId)
	})

describe("exitsLineLinks — each name found by the room rule", () => {
	it("finds a place by its name, a looser spelling, or a key, and says the link from here", () => {
		const links = read(
			"Exits: north → the drowned hall, down → Cistern, east -> the tank"
		)
		expect(links.map((l) => [l.state, l.place?.id, l.sentence])).toEqual([
			["ready", HALL, "Leads north to The Drowned Hall."],
			["ready", CISTERN, "Leads down to The Cistern."],
			["ready", CISTERN, "Leads east to The Cistern."]
		])
	})

	it("lists a name no place answers to as unresolved, said as written", () => {
		const [link] = read("Exits: south → the Old Well")
		// "The Old Well" is world lore, not a place: it answers nothing here.
		expect(link).toMatchObject({
			state: "unresolved",
			place: null,
			sentence: "Leads south to the Old Well."
		})
	})

	it("never answers with a place archived at the moment (the line's reading)", () => {
		expect(read("Exits: down → The Pit")[0].state).toBe("unresolved")
	})

	it("names this place itself as here, which is never offered", () => {
		const [link] = read("Exits: back → The Guardroom")
		expect(link.state).toBe("here")
		expect(isOffered(link)).toBe(false)
	})

	it("keeps one link for a way named twice", () => {
		const links = read(
			"Exits: north → The Drowned Hall, North → drowned hall, up → The Drowned Hall"
		)
		expect(links.map((l) => l.signpost.wording)).toEqual([
			"leads north to",
			"leads up to"
		])
	})

	it("keeps a thing's name on the link it proposes", () => {
		const [link] = read("Exits: a rusted iron door → The Drowned Hall")
		expect(link.sentence).toBe(
			"A rusted iron door leads to The Drowned Hall."
		)
	})
})

describe("exitsLineLinks — idempotent against the links that stand", () => {
	it("does not offer a link that already says it (words and name, case aside)", () => {
		const [link] = read("Exits: North → The Drowned Hall", [
			rel(1, { relationshipType: "Leads North to" })
		])
		expect(link.state).toBe("linked")
		expect(link.standing).toEqual({
			sentence: "Leads North to The Drowned Hall.",
			later: null
		})
		expect(isOffered(link)).toBe(false)
	})

	it("reads a link drawn from the far end through its way back", () => {
		const back = rel(2, {
			from: end(HALL),
			to: end(GUARDROOM),
			fromEntryId: HALL,
			toEntryId: GUARDROOM,
			relationshipType: "leads south to",
			reverseRelationshipType: "leads north to"
		})
		expect(read("Exits: north → The Drowned Hall", [back])[0].state).toBe(
			"linked"
		)
	})

	it("offers, unticked, a way to a place another link already joins it to", () => {
		// Answer the door's link: `leads to` both ways.
		const door = rel(3, {
			relationshipType: "leads to",
			reverseRelationshipType: "leads to"
		})
		const [link] = read("Exits: north → The Drowned Hall", [door])
		expect(link.state).toBe("joined")
		expect(link.standing).toEqual({ sentence: "Leads to The Drowned Hall.", later: null })
		expect(isOffered(link)).toBe(true)
		expect(exitsLineTicks([link])).toEqual([])
	})

	it("counts a named link with the same words as another way (the guard's own rule)", () => {
		const named = rel(4, { name: "the rusted iron door" })
		expect(read("Exits: north → The Drowned Hall", [named])[0].state).toBe(
			"joined"
		)
	})

	it("counts a one-way link into here as joining the two", () => {
		const into = rel(5, {
			from: end(HALL),
			to: end(GUARDROOM),
			fromEntryId: HALL,
			toEntryId: GUARDROOM,
			relationshipType: "leads south to"
		})
		const [link] = read("Exits: north → The Drowned Hall", [into])
		expect(link.state).toBe("joined")
		expect(link.standing).toEqual({
			sentence: "One way, into here from The Drowned Hall.",
			later: null
		})
	})
})

describe("exitsLineTicks — what starts ticked", () => {
	it("ticks a way that resolves and is not linked; never a new place", () => {
		const links = read(
			"Exits: north → The Drowned Hall, south → The Old Well, back → The Guardroom",
			[]
		)
		expect(links.map((l) => [l.state, isOffered(l)])).toEqual([
			["ready", true],
			["unresolved", true],
			["here", false]
		])
		expect(exitsLineTicks(links)).toEqual([links[0].key])
	})
})

describe("exitsLineDraft — what a confirmed link writes", () => {
	it("is one way, from here, in the line's words, dated by the moment's entry", () => {
		const [signpost] = parseExitsLine("Exits: a rusted iron door → The Drowned Hall")
		const draft = exitsLineDraft(
			{ id: GUARDROOM, name: NAMES[GUARDROOM] },
			{ id: HALL, name: NAMES[HALL] },
			signpost,
			9
		)
		expect(createLinkParams(1, draft, null)).toEqual({
			lorebookId: 1,
			from: { kind: "entry", entryId: GUARDROOM },
			to: { kind: "entry", entryId: HALL },
			relationshipType: "leads to",
			name: "a rusted iron door",
			status: "active",
			visibility: "acknowledged",
			branchId: null,
			historyEntryId: 9
		})
	})
})

/**
 * B7 review round (2026-09-29): a name holding a comma or a note, two places
 * answering one name alike, a switched-off namesake, this place's own
 * namesake, a key that survives the place being made, the link that stands
 * named over one made true later, and what a read says once it closes.
 */
describe("exitsLineLinks — the review round", () => {
	const HERE = { id: GUARDROOM, name: NAMES[GUARDROOM] }
	const judge = (line: string, pool: PoolItem[], rows = rowsOf([])) =>
		exitsLineLinks(parseExitsLine(line), { place: HERE, pool, rows })

	it("prefers the name read through its comma when a place is called that", () => {
		const pool = [
			item(GUARDROOM),
			item(60, { name: "The Hall" }),
			item(61, { name: "The Hall, East Wing" })
		]
		const [wing] = judge("Exits: north → The Hall, East Wing", pool)
		expect([wing.state, wing.place?.id, wing.written, wing.sentence]).toEqual([
			"ready",
			61,
			"The Hall, East Wing",
			"Leads north to The Hall, East Wing."
		])
		// Nothing is called the longer reading: the name up to its comma.
		const [hall] = judge("Exits: north → The Hall, a crack in the wall", pool)
		expect([hall.state, hall.place?.id]).toEqual(["ready", 60])
	})

	it("finds a place past a note after its name", () => {
		const [link] = judge("Exits: north → The Drowned Hall (via the rope bridge)", POOL)
		expect([link.state, link.place?.id]).toEqual(["ready", HALL])
	})

	it("keys a way by itself, so the place made for it keeps its key", () => {
		const [before] = judge("Exits: west → The Old Well", POOL)
		const [after] = judge("Exits: west → The Old Well", [
			...POOL,
			item(90, { name: "The Old Well" })
		])
		expect([before.state, after.state]).toEqual(["unresolved", "ready"])
		expect(after.key).toBe(before.key)
	})

	it("links the first of two places a name answers alike, names the other, and ticks neither", () => {
		const pool = [item(GUARDROOM), item(HALL), item(70, { name: "The Drowned Hall" })]
		const [link] = judge("Exits: north → The Drowned Hall", pool)
		expect(link.place?.id).toBe(HALL)
		expect(link.namesakes).toEqual([{ id: 70, name: "The Drowned Hall" }])
		expect(exitsLineTicks([link])).toEqual([])
	})

	it("finds a switched-on place before a switched-off namesake, and a switched-off one when nothing else answers", () => {
		const pool = [
			item(GUARDROOM),
			item(70, { name: "The Drowned Hall", off: true }),
			item(HALL),
			item(71, { name: "The Vault", off: true })
		]
		const [hall, vault] = judge(
			"Exits: north → The Drowned Hall, down → The Vault",
			pool
		)
		expect([hall.place?.id, hall.namesakes]).toEqual([HALL, []])
		expect(exitsLineTicks([hall])).toEqual([hall.key])
		expect([vault.state, vault.place?.id]).toEqual(["ready", 71])
	})

	it("never takes this place for a name another place answers alike", () => {
		const pool = [item(GUARDROOM), item(72, { name: "The Guardroom" })]
		const [link] = judge("Exits: north → The Guardroom", pool)
		expect([link.state, link.place?.id]).toEqual(["ready", 72])
	})

	it("shows the link that stands at the moment before one made true later, and says when one is only later", () => {
		const door = rel(3, { relationshipType: "leads to", reverseRelationshipType: "leads to" })
		const beside = rel(4, { relationshipType: "is beside", reverseRelationshipType: "is beside" })
		const [later, now] = rowsOf([door, beside])
		const dated = { ...later, later: "1203-04-01 · later" }
		const [both] = judge("Exits: north → The Drowned Hall", POOL, [dated, now])
		expect(both.standing).toEqual({ sentence: now.sentence, later: null })
		const [onlyLater] = judge("Exits: north → The Drowned Hall", POOL, [dated])
		expect(onlyLater.standing).toEqual({
			sentence: dated.sentence,
			later: "1203-04-01 · later"
		})
	})
})

describe("exitsLineNote — what a read wrote, said once its view closes", () => {
	it("says the links written, and when a close stopped the rest", () => {
		const note = judged.exitsLineNote
		expect(note({ linked: 2, left: 0 })).toBe("Linked 2 ways from the Exits line.")
		expect(note({ linked: 1, left: 0 })).toBe("Linked 1 way from the Exits line.")
		expect(note({ linked: 1, left: 2 })).toBe(
			"Stopped: linked 1 way from the Exits line; 2 left unlinked."
		)
		expect(note({ linked: 0, left: 1 })).toBe(
			"Stopped: nothing from the Exits line was linked; 1 left unlinked."
		)
		expect(note({ linked: 0, left: 0 })).toBeNull()
	})
})
