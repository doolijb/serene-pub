import { describe, it, expect } from "vitest"
import {
	MAX_MENTIONS,
	MENTION_EXTRACTOR_VERSION,
	extractMentions
} from "$lib/server/pipelines/ranking/mentions"
import {
	EMPTY_GAZETTEER,
	buildGazetteer
} from "$lib/server/pipelines/ranking/entities"

/** The world the retrieval plan's own examples are set in. */
const world = buildGazetteer([
	{ name: "Vell", ref: { kind: "character", id: 2 } },
	{ name: "The Ashguard Riders", ref: { kind: "entry", id: 1 } }
])

const texts = (text: string, gazetteer = world) =>
	extractMentions(text, gazetteer).mentions.map((m) => m.text)

describe("descriptive mentions", () => {
	it("finds the reference no other mechanism can", () => {
		// "the order" shares no token with "The Ashguard Riders", so no key
		// matches it, no trigram folds it onto the title, and the gazetteer has
		// nothing to look up. This mechanism exists for exactly this string.
		expect(texts("I hear the order rides at dawn.")).toContain(
			"the order rides"
		)
	})

	it("reads a description that opens a sentence", () => {
		// The capital on "The" is orthography, not a name — and rejecting every
		// sentence-initial description would throw away most of them in
		// dialogue.
		expect(texts("The gatehouse is shut.")).toEqual(["The gatehouse"])
	})

	it("keeps a modifier stack together", () => {
		expect(texts("She crossed the old stone bridge and waited.")).toEqual([
			"the old stone bridge"
		])
	})

	it("takes demonstratives, and not the indefinite article", () => {
		expect(texts("That bridge is out.")).toEqual(["That bridge"])
		expect(texts("A bridge is out.")).toEqual([])
	})
})

describe("what it refuses, which is the safety rule", () => {
	/**
	 * Exact and trigram matching own invented names; entity vectors own
	 * descriptive references. Both halves of that are asserted here, because
	 * both are what stops a confident wrong link on a name whose vector is
	 * assembled from subword fragments.
	 */
	it("never emits a name the gazetteer already claims", () => {
		// Lower case throughout, so nothing about the *shape* of this refuses
		// it — the gazetteer does, because "ashguard" is a distinctive token of
		// "The Ashguard Riders" and the exact matcher resolves it to a row.
		expect(texts("the ashguard rode out at dawn")).toEqual([])
		// And without a vocabulary it is an ordinary description again, which
		// is what proves the gazetteer is what refused it.
		expect(texts("the ashguard rode out at dawn", EMPTY_GAZETTEER)).toEqual(
			["the ashguard rode"]
		)
	})

	it("never emits a capitalised run", () => {
		// `extractEntities`' open tier claims these, and they are the invented
		// proper nouns embeddings are least reliable about.
		expect(texts("He met The Warden at dusk.")).toEqual([])
		expect(texts("She rode with the Ashguard Riders.")).toEqual([])
	})

	it("drops heads that describe nothing", () => {
		expect(texts("Tell me about the same thing again.")).toEqual([])
		expect(texts("It was the other one.")).toEqual([])
	})

	it("drops the whole run rather than trimming to a modifier", () => {
		// ⚠ Trimming back was the first version and it manufactured junk: "the
		// old ways" gave up `ways` and kept "the old", a modifier standing in
		// for a head.
		expect(texts("She missed the old ways.")).toEqual([])
	})

	it("never runs a description across a sentence end", () => {
		// The entity extractor's own first bug, one construct over: runs merging
		// across a full stop produced "Shut. The" and matched nothing.
		expect(texts("Watch the gate. Riders come.")).toEqual(["the gate"])
	})
})

describe("ordering and bounds", () => {
	it("puts the most recent description first", () => {
		// The reply is being written for the end of the window, so proximity
		// leads — ruling R4's other half.
		expect(texts("Watch the gate. Then hold the tower.")).toEqual([
			"the tower",
			"the gate"
		])
	})

	it("counts a repeat rather than repeating it", () => {
		const found = extractMentions(
			"the gate was shut. Nobody opened the gate.",
			EMPTY_GAZETTEER
		).mentions
		const gate = found.find((m) => m.text === "the gate")
		expect(gate?.count).toBe(2)
		// The *last* occurrence wins the position: the question proximity asks
		// is how recently it was said.
		expect(gate!.position).toBeGreaterThan(0)
	})

	it("is bounded, and deterministic at the bound", () => {
		const text = Array.from(
			{ length: 40 },
			(_, i) => `Hold the tower${i}.`
		).join(" ")
		const first = extractMentions(text, EMPTY_GAZETTEER).mentions
		expect(first.length).toBe(MAX_MENTIONS)
		expect(extractMentions(text, EMPTY_GAZETTEER).mentions).toEqual(first)
	})

	it("carries its own version, because a model will replace it", () => {
		expect(extractMentions("the gate").extractorVersion).toBe(
			MENTION_EXTRACTOR_VERSION
		)
	})

	it("says nothing about nothing", () => {
		expect(texts("")).toEqual([])
		expect(texts("Vell nodded.")).toEqual([])
	})
})
