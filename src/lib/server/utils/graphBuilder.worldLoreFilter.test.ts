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
			constructor(_opts: unknown) {}
		}
	})
}))

const conn = { id: 1, name: "c", type: "openai_session" } as any
const sampling = { id: 1, name: "s" } as any
const contextConfig = { id: 1 } as any
const promptConfig = { id: 1 } as any

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
	worldLore?: Array<{ name: string; category?: string | null }>
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
		contextConfig,
		promptConfig,
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
