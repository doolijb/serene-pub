/**
 * A room's `Exits:` line, taken apart (plan places-graph §11, B7).
 *
 * The Lair's drafting prompts still write a room's ways out as one prose line
 * (`LAIR_ROOM_CONTENT_SHAPE`: `Exits: <direction> → <room>, …`). The place
 * editor's **Read links from the Exits line** reads it on request and offers
 * the links it names; nothing parses it at write time (Q4 is open). The parser
 * is pure and resolves nothing: which place a name answers to is the room
 * rule's (`locationRowOf`), and what is already linked is the Links list's.
 */
import { describe, expect, it } from "vitest"
import { exitsLineOf, parseExitsLine } from "./exitsLine"

const ROOM = (exits: string) =>
	[
		"A low stone room by the gate, smelling of pitch.",
		"",
		exits,
		"Contents: a brazier, two stools.",
		"Hazards: None.",
		"Occupants: Nobody."
	].join("\n")

describe("exitsLineOf — the line itself", () => {
	it("is the text after Exits:, or null when the body has no such line", () => {
		expect(exitsLineOf(ROOM("Exits: north → The Drowned Hall"))).toBe(
			"north → The Drowned Hall"
		)
		expect(exitsLineOf("A room with no ways out written down.")).toBeNull()
		expect(exitsLineOf("")).toBeNull()
		expect(exitsLineOf(undefined)).toBeNull()
		// "Exits" inside a sentence is not the line.
		expect(exitsLineOf("The exits: none of them are safe.\nMore.")).toBeNull()
	})

	it("reads the line however it is dressed: case, bold, a bullet", () => {
		expect(exitsLineOf("exits: up → The Keep")).toBe("up → The Keep")
		expect(exitsLineOf("**Exits:** up → The Keep")).toBe("up → The Keep")
		expect(exitsLineOf("- Exits: up → The Keep")).toBe("up → The Keep")
		expect(exitsLineOf("  EXITS : up → The Keep  ")).toBe("up → The Keep")
	})

	it("is an empty line, not null, when the line is there with nothing on it", () => {
		expect(exitsLineOf(ROOM("Exits:"))).toBe("")
	})

	it("reads the first Exits line only", () => {
		expect(
			exitsLineOf("Exits: north → The Hall\nExits: south → The Pit")
		).toBe("north → The Hall")
	})
})

describe("parseExitsLine — the ways it names", () => {
	it("reads → and -> alike, each way out to the room it leads to", () => {
		expect(
			parseExitsLine(
				ROOM("Exits: north → The Drowned Hall, down -> The Cistern")
			)
		).toEqual([
			{ bearing: "north", to: "The Drowned Hall", longerNames: [], wording: "leads north to", name: "" },
			{ bearing: "down", to: "The Cistern", longerNames: [], wording: "leads down to", name: "" }
		])
	})

	it("says a direction as the words of a way: 'leads north to', lower-cased at the front", () => {
		const [way] = parseExitsLine("Exits: North → The Hall")
		expect(way).toMatchObject({ bearing: "North", wording: "leads north to" })
		const [stairs] = parseExitsLine("Exits: down the stairs → The Cistern")
		expect(stairs.wording).toBe("leads down the stairs to")
		// Words that already say "leads" are not said twice, nor a trailing "to".
		expect(parseExitsLine("Exits: leads west → The Yard")[0].wording).toBe(
			"leads west to"
		)
		expect(parseExitsLine("Exits: east to → The Yard")[0].wording).toBe(
			"leads east to"
		)
	})

	it("makes a way that is a thing — 'a rusted iron door' — the link's name, and says it 'leads to'", () => {
		expect(
			parseExitsLine("Exits: a rusted iron door → The Drowned Hall, the well -> The Cistern")
		).toEqual([
			{
				bearing: "a rusted iron door",
				to: "The Drowned Hall",
				longerNames: [],
				wording: "leads to",
				name: "a rusted iron door"
			},
			{ bearing: "the well", to: "The Cistern", longerNames: [], wording: "leads to", name: "the well" }
		])
	})

	it("reads an arrow with nothing before it as a plain 'leads to'", () => {
		expect(parseExitsLine("Exits: → The Yard")).toEqual([
			{ bearing: "", to: "The Yard", longerNames: [], wording: "leads to", name: "" }
		])
	})

	it("reads nothing from a blank line, 'none yet', or ways with no room named", () => {
		expect(parseExitsLine(ROOM("Exits:"))).toEqual([])
		expect(parseExitsLine(ROOM("Exits: none yet"))).toEqual([])
		expect(parseExitsLine(ROOM("Exits: None."))).toEqual([])
		expect(parseExitsLine("Exits: north → , south → ?, west → …")).toEqual([])
		// The prompt's own placeholder, echoed back unfilled, names no room.
		expect(parseExitsLine("Exits: <direction> → <room>")).toEqual([])
		expect(parseExitsLine("No exits line at all.")).toEqual([])
	})

	it("leaves out a piece with no arrow and keeps the rest", () => {
		expect(
			parseExitsLine("Exits: a crack in the wall, north → The Hall; up -> The Keep.")
		).toEqual([
			{ bearing: "north", to: "The Hall", longerNames: [], wording: "leads north to", name: "" },
			{ bearing: "up", to: "The Keep", longerNames: [], wording: "leads up to", name: "" }
		])
	})

	it("keeps a name nothing answers to as written — which place it is, is not the parser's", () => {
		expect(parseExitsLine("Exits: south → the Old Well")).toEqual([
			{ bearing: "south", to: "the Old Well", longerNames: [], wording: "leads south to", name: "" }
		])
	})

	it("strips what dresses a name — quotes, bold, brackets, a full stop", () => {
		expect(
			parseExitsLine(
				'Exits: north → "The Hall", east → **The Yard**, west → [The Pit], up → (The Keep).'
			).map((w) => w.to)
		).toEqual(["The Hall", "The Yard", "The Pit", "The Keep"])
	})
})

/**
 * B7 review round (2026-09-29): the shapes a drafted line takes that the
 * first cut misread — a second arrow in one piece, a comma or a note in a
 * name, a colon or another arrow for the arrow, a proper name before it —
 * and a line long enough to stall a backtracking pattern.
 */
describe("parseExitsLine — the review round's lines", () => {
	const pairs = (line: string) =>
		parseExitsLine(line).map((s) => [s.bearing, s.to])

	it("reads ways joined by 'and' or a full stop as two, never one name with an arrow in it", () => {
		expect(pairs("Exits: north → The Hall and south → The Kitchen")).toEqual([
			["north", "The Hall"],
			["south", "The Kitchen"]
		])
		expect(pairs("Exits: north → Hall. South → Cellar.")).toEqual([
			["north", "Hall"],
			["South", "Cellar"]
		])
		// Nothing says where the room's name ends and the next way begins.
		expect(parseExitsLine("Exits: north → A -> B")).toEqual([])
		for (const s of parseExitsLine(
			"Exits: north → The Hall and down → The Crypt, east -> x -> y"
		))
			expect(s.to).not.toMatch(/→|->/)
	})

	it("reads a name through the comma pieces after it, longest first — a name may hold a comma", () => {
		expect(parseExitsLine("Exits: north → The Hall, East Wing")).toEqual([
			{
				bearing: "north",
				to: "The Hall",
				longerNames: ["The Hall, East Wing"],
				wording: "leads north to",
				name: ""
			}
		])
		expect(
			parseExitsLine(
				"Exits: north → The Hall, East Wing, Upper, south → The Pit"
			).map((s) => [s.to, s.longerNames])
		).toEqual([
			["The Hall", ["The Hall, East Wing, Upper", "The Hall, East Wing"]],
			["The Pit", []]
		])
	})

	it("takes a trailing note and ? … — off a name, and keeps the note's reading as a longer one", () => {
		const first = (to: string) => parseExitsLine(`Exits: north → ${to}`)[0]
		expect(first("The Hall (locked)")).toMatchObject({
			to: "The Hall",
			longerNames: ["The Hall (locked)"]
		})
		expect(first("The Drowned Hall (via the rope bridge).").to).toBe(
			"The Drowned Hall"
		)
		expect(first("The Hall [barred]").to).toBe("The Hall")
		expect(first("The Hall?").to).toBe("The Hall")
		expect(first("The Hall…").to).toBe("The Hall")
		expect(first("The Hall —").to).toBe("The Hall")
		expect(first("The Hall — the door is barred").to).toBe("The Hall")
		// A name wholly in brackets is the name, not a note.
		expect(first("(The Keep)").to).toBe("The Keep")
	})

	it("reads a colon, or any common arrow, as the arrow — but never 'to' in prose", () => {
		expect(pairs("Exits: north: The Hall, down: The Crypt")).toEqual([
			["north", "The Hall"],
			["down", "The Crypt"]
		])
		for (const arrow of ["⇒", "➜", "➔", "⟹", "—>", "==>", "-->"])
			expect(pairs(`Exits: up ${arrow} The Keep`)).toEqual([["up", "The Keep"]])
		// A line written with arrows keeps a colon inside a name.
		expect(parseExitsLine("Exits: north → The Hall: West").map((s) => s.to)).toEqual([
			"The Hall: West"
		])
		// "to" is prose's word ("the way back to town is blocked"), not an arrow.
		expect(parseExitsLine("Exits: north to The Hall")).toEqual([])
	})

	it("reads a proper name before the arrow as the link's name, and an article alone as nothing", () => {
		expect(parseExitsLine("Exits: Kings Road → The Palace")[0]).toMatchObject({
			wording: "leads to",
			name: "Kings Road"
		})
		expect(parseExitsLine("Exits: a → The Hall")[0]).toMatchObject({
			wording: "leads to",
			name: ""
		})
		expect(parseExitsLine("Exits: NORTH EAST → The Hall")[0].wording).toBe(
			"leads north east to"
		)
		expect(parseExitsLine("Exits: Down the stairs → The Hall")[0].wording).toBe(
			"leads down the stairs to"
		)
	})

	it("reads a pathological line in linear time", () => {
		for (const filler of [
			" ".repeat(50_000),
			"-".repeat(50_000),
			"=".repeat(50_000),
			".".repeat(50_000),
			"(".repeat(20_000)
		]) {
			const started = performance.now()
			parseExitsLine(`Exits: north${filler}x → The Hall${filler}y`)
			exitsLineOf(`Exits: a${filler}b`)
			expect(performance.now() - started).toBeLessThan(500)
		}
	})
})
