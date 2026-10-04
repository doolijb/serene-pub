/**
 * Places and objects were being minted as characters.
 *
 * A live build proposed "Seraphis Station" — the literal setting of every scene
 * in its own lorebook, and already a World Lore entry — as a person node with
 * an `active` state. The only defence was one line of the extraction prompt
 * ("no places, no objects") sitting directly beneath "If the scene places them
 * in the setting, they belong here", so the prompt argued with itself. There
 * was no structural backstop at all: no schema, no node type, no cross-check.
 *
 * The filter is deliberately narrow, because the obvious version of it is
 * dangerous. Lore entries about PEOPLE are routine, so "reject any name
 * matching a World Lore title" would silently refuse a genuinely new character
 * who happens to have a page — recreating, in the fix, exactly the silent-drop
 * failure this work spent its time removing. Hence two constraints, both
 * pinned below: it only sees names about to be minted (a bound character
 * resolves earlier and never reaches it), and it reports what it screens.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const runQueuedLLMCallMock = vi.fn()

vi.mock("./runQueuedLLMCall", () => ({
	runQueuedLLMCall: (...args: unknown[]) => runQueuedLLMCallMock(...args)
}))

vi.mock("./getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({
		Adapter: class {
			/** The composed stop list, handed over at construction. */
			stops: any
			withStops(s: any) {
				this.stops = s
				return this
			}
			constructor(_opts: unknown) {}
		}
	})
}))

const conn = { id: 1, name: "c", type: "openai_session" } as any
// A real post-0171 row: a shape naming its vocabulary, values, and the
// switchboard saying which of them are in play. The `as any` used to hide
// that this literal was not a row at all.
const sampling = {
	id: 1,
	name: "s",
	shape: "core:shape/text-gen@1",
	values: {},
	enabled: []
} as any

function respondByLabel(map: Record<string, string>, fallback = "{}") {
	runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
		const label: string = opts?.label ?? ""
		for (const [needle, text] of Object.entries(map)) {
			if (label.includes(needle)) return { text }
		}
		return { text: fallback }
	})
}

const seedAria = {
	id: 10,
	name: "Aria",
	nodeState: "active",
	summary: "a scout",
	aliases: []
}

function scene(id: number) {
	return {
		id,
		name: `Scene ${id}`,
		summary: "Something happened at the station.",
		historyEntryId: id,
		historyEntry: { id, year: id, month: null, day: null },
		participantCharacters: null,
		mentionedCharacters: null
	}
}

async function build(
	participants: string[],
	worldLore?: Array<{ name: string; category?: string | null; typeId?: string }>
) {
	const { buildGraphFromScenes } = await import("./graphBuilder")
	respondByLabel({
		"character extraction": JSON.stringify({
			participants,
			mentioned: []
		}),
		"Character Perspective": '{"relationships": []}'
	})
	return buildGraphFromScenes({
		scenes: [scene(1)] as any,
		connection: conn,
		sampling,
		seedNodes: [seedAria],
		worldLore
	})
}

const names = (r: Awaited<ReturnType<typeof build>>) =>
	r.proposal.nodes.map((n) => n.name)

beforeEach(() => runQueuedLLMCallMock.mockReset())
afterEach(() => runQueuedLLMCallMock.mockReset())

describe("World Lore screens proposed character nodes", () => {
	test("a place with a lore entry is not minted as a character", async () => {
		const result = await build(
			["Aria", "Seraphis Station"],
			[{ name: "Seraphis Station" }]
		)
		expect(names(result)).not.toContain("Seraphis Station")
		expect(result.filteredWorldLoreNames).toEqual(["Seraphis Station"])
	})

	test("it REPORTS rather than dropping silently", async () => {
		// The whole reason this is safe to ship. A filtered name the user
		// disagrees with has to be visible, or the fix becomes the next
		// invisible failure.
		const result = await build(
			["Aria", "The Drift Zones"],
			[{ name: "The Drift Zones" }]
		)
		expect(result.filteredWorldLoreNames).toEqual(["The Drift Zones"])
	})

	test("when the screen leaves nothing, the error says so instead of 'no characters found'", async () => {
		// A scene naming only its own setting resolves nobody, which trips the
		// build's total-failure guard. Reporting that as "no characters were
		// found in any summary" would be both false and unactionable — a name
		// WAS found, and the user needs to know which, and why it was refused.
		await expect(
			build(["Seraphis Station"], [{ name: "Seraphis Station" }])
		).rejects.toThrow(/Seraphis Station.*World Lore/s)
	})

	test("an ALREADY-BOUND character with a lore page is untouched", async () => {
		// The false positive that matters most. Aria is a seeded binding, so
		// she resolves before the filter is ever consulted — having a lore page
		// about her cannot un-person her.
		const result = await build(["Aria"], [{ name: "Aria" }])
		expect(result.filteredWorldLoreNames).toEqual([])
		// Resolved to the seed, so nothing new is proposed and nothing is lost.
		expect(names(result)).toEqual([])
	})

	test("a character-tagged lore entry screens nothing — the opt-out", async () => {
		// `category` is free text and usually unset, so it cannot carry the
		// filter; it is honoured one-way, to spare an entry the user has
		// already told us is about a person.
		const result = await build(
			["Rhea Marlin"],
			[{ name: "Rhea Marlin", category: "Characters" }]
		)
		expect(result.filteredWorldLoreNames).toEqual([])
		expect(names(result)).toContain("Rhea Marlin")
	})

	test("with no World Lore at all, nothing is screened", async () => {
		const result = await build(["Seraphis Station"])
		expect(result.filteredWorldLoreNames).toEqual([])
		expect(names(result)).toContain("Seraphis Station")
	})

	test("a genuinely new character with no lore page is unaffected", async () => {
		const result = await build(
			["Cassia", "Seraphis Station"],
			[{ name: "Seraphis Station" }]
		)
		expect(names(result)).toEqual(["Cassia"])
	})
})

describe("places and items screen too (places plan L1), by their whole title", () => {
	const PLACE = "core:entry/location"
	const ITEM = "core:entry/item"

	test("a place is screened whatever its category says — no person-word opt-out", async () => {
		// L1 review: "Castle", "Forecastle", "Orchard", "Charnel", "Charms",
		// "Folkestone" all hit /char|person|people|cast|npc|folk/, so a place
		// filed under one was minted as a character on Rebuild.
		for (const category of ["Castle", "Orchard", "Folkestone"]) {
			const result = await build(["Aria", "Greywater Keep"], [{ name: "Greywater Keep", category, typeId: PLACE }])
			expect(names(result)).not.toContain("Greywater Keep")
			expect(result.filteredWorldLoreNames).toEqual(["Greywater Keep"])
		}
		const item = await build(["Aria", "The Moon Charm"], [{ name: "The Moon Charm", category: "Charms", typeId: ITEM }])
		expect(item.filteredWorldLoreNames).toEqual(["The Moon Charm"])
	})

	test("a place screens its own name — articles and one typo aside — and nothing longer", async () => {
		const crypt = [{ name: "The Crypt", typeId: PLACE }]
		expect((await build(["Crypt"], crypt).catch(() => null)) ?? "screened").toBe("screened")
		expect((await build(["Aria", "the crypt"], crypt)).filteredWorldLoreNames).toEqual(["the crypt"])
		expect((await build(["Aria", "The Cript"], crypt)).filteredWorldLoreNames).toEqual(["The Cript"])
		// L1 review: a short place title swallowed new characters named after it.
		for (const [title, character] of [
			["The Crypt", "Crypt Keeper"],
			["The Crypt", "the Crypt Keeper"],
			["Thorne Manor", "Thorne"],
			["The Tower", "Captain of the Tower"],
			["The Market", "Market Vendor"]
		]) {
			const result = await build(["Aria", character!], [{ name: title!, typeId: PLACE }])
			expect(names(result)).toContain(character)
			expect(result.filteredWorldLoreNames).toEqual([])
		}
		const key = await build(["Aria", "Iron"], [{ name: "The Iron Key", typeId: ITEM }])
		expect(names(key)).toContain("Iron")
	})

	test("world lore keeps the looser rule and its opt-out", async () => {
		// A lore page titled "The Crypt" still screens "Crypt Keeper" — the
		// cast matcher's subset rule, unchanged — and a person-tagged page
		// still screens nothing.
		expect((await build(["Aria", "Crypt Keeper"], [{ name: "The Crypt" }])).filteredWorldLoreNames).toEqual([
			"Crypt Keeper"
		])
		expect(
			(await build(["Aria", "Rhea Marlin"], [{ name: "Rhea Marlin", category: "Characters", typeId: "core:entry/world-lore" }]))
				.filteredWorldLoreNames
		).toEqual([])
	})
})

describe("isWholeTitle", () => {
	test("the same words in any order, articles aside, or one typo", async () => {
		const { isWholeTitle } = await import("./graphBuilder")
		expect(isWholeTitle("The Crypt", "Crypt")).toBe(true)
		expect(isWholeTitle("Keep, Greywater", "Greywater Keep")).toBe(true)
		expect(isWholeTitle("Seraphis Station", "Seraphis Staton")).toBe(true)
		expect(isWholeTitle("The Crypt", "Crypt Keeper")).toBe(false)
		expect(isWholeTitle("Thorne Manor", "Thorne")).toBe(false)
		expect(isWholeTitle("The", "The")).toBe(false)
	})
})

