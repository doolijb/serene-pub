/**
 * What the Adventure genre's four agents are actually TOLD, rendered.
 *
 * Every assertion here is a sentence a live receipt showed missing. The
 * planner read "Difficulty is :" and the narrator "Keep the tone ." because the
 * genre's fields were merged onto the context AFTER the instructions were
 * interpolated; the narrator was given no place, no cast and no beats, and
 * opened its scene on a dock with a character nobody had written; the keeper was
 * shown no vocabulary and answered a Rest with stamina 90 on a slot that stops
 * at 10.
 *
 * The four bindings are pure — a Task is handed no services — so this runs on
 * literals with no database, against the prompts the catalog actually ships.
 */

import { describe, expect, it } from "vitest"
import { ADVENTURE_SLOTS, CORE_PROMPTS } from "@serene-pub/core-catalog"
import { coreBindings } from "./bindings"

const bindings = coreBindings()

/** The shipped row for one agent, by the pool it lives in. */
const shipped = (nodeType: string, seedEnds: string) =>
	CORE_PROMPTS.find(
		(p) => p.nodeType === nodeType && p.seedKey.endsWith(seedEnds)
	)!.fields as Record<string, string>

const CAST = {
	sessionCharacters: [
		{
			character: {
				id: 1,
				name: "Verity",
				description: "A quiet archivist who remembers everything."
			},
			enabled: true,
		}
	],
	sessionPersonas: [
		{ persona: { id: 1, name: "Jody", description: "A traveller." } }
	],
	currentCharacterId: 1
}

/** A session mid-play: the world has a clock and a sky, Verity has her bars. */
const STATE = {
	world: { "time-of-day": "morning", weather: "clear" },
	cast: { verity: { hp: 20, stamina: 10, mood: "calm", trust: 0 } }
}

const PLAN = {
	beats: [
		"The wind whistles through cracks in the stone walls.",
		"Shadows move across the dusty shelves."
	],
	speakers: [{ name: "Verity", intent: "share what she knows" }],
	worldHints: {
		location: "The Archive",
		timeOfDay: "night",
		weather: "storm"
	},
	needsLookup: false
}

const FIELDS = { tone: "grounded", difficulty: "normal", trustNarrator: false }

const ctx = {
	random: () => 0,
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
} as any

/** One agent's rendered instructions, as they would reach the model. */
async function instructionsOf(
	definitionId: string,
	prompts: Record<string, string>,
	input: Record<string, unknown>
): Promise<string> {
	const result: any = await bindings[definitionId]!(
		{ cast: CAST, prompts, ...input } as any,
		ctx
	)
	expect(result.kind, `${definitionId} did not build`).toBe("ok")
	return String(result.value.templateContext.instructions)
}

describe("the genre's fields reach the prose that names them", () => {
	it("renders the planner's difficulty", async () => {
		const text = await instructionsOf(
			"core:task/build-planner-context@1",
			shipped("core:task/build-planner-context", "adventure-planner"),
			{ state: STATE, fields: FIELDS }
		)
		expect(text).toContain("Difficulty is normal")
		expect(text).not.toContain("Difficulty is :")
	})

	it("renders the narrator's tone", async () => {
		const text = await instructionsOf(
			"core:task/build-scene-context@1",
			shipped("core:task/build-scene-context", "adventure-narrator"),
			{ state: STATE, plan: PLAN, fields: FIELDS }
		)
		expect(text).toContain("Keep the tone grounded")
	})
})

describe("the narrator is anchored", () => {
	const narrator = () =>
		instructionsOf(
			"core:task/build-scene-context@1",
			shipped("core:task/build-scene-context", "adventure-narrator"),
			{ state: STATE, plan: PLAN, fields: FIELDS }
		)

	it("names the place, the hour and the sky", async () => {
		const text = await narrator()
		// The state answers first and the plan's hint second, which is what
		// makes a FIRST turn work: nothing has written a location down yet.
		expect(text).toContain("The Archive")
		expect(text).toContain("morning")
		expect(text).toContain("clear")
	})

	it("names the cast and the player, and nobody else", async () => {
		const text = await narrator()
		expect(text).toContain("Verity")
		expect(text).toContain("Address the player as Jody")
	})

	it("carries the plan's beats verbatim", async () => {
		const text = await narrator()
		for (const beat of PLAN.beats) expect(text).toContain(beat)
	})

	it("shows the numbers it is told to treat as fact", async () => {
		const text = await narrator()
		expect(text).toContain("The world as it stands")
		// Alphabetical by slot id, which is what makes the summary the same
		// paragraph every turn rather than whatever order a bag iterated in.
		expect(text).toContain("Verity: hp 20, mood calm, stamina 10, trust 0.")
		expect(text).toContain("The world: time-of-day is morning")
	})

	it("states the four rules the scene kept breaking", async () => {
		const text = await narrator()
		expect(text).toContain("Invent no named characters")
		expect(text).toContain("Do not move the scene to a new place")
		expect(text).toContain("Do not write dialogue for the cast")
	})

	it("falls back to the plan's hint when the world has no location", async () => {
		const text = await instructionsOf(
			"core:task/build-scene-context@1",
			shipped("core:task/build-scene-context", "adventure-narrator"),
			{
				state: { world: {}, cast: {} },
				plan: PLAN,
				fields: FIELDS
			}
		)
		expect(text).toContain("The Archive")
	})
})

describe("a voice is given the same place and the same cast", () => {
	it("names where it is standing and who is there", async () => {
		const text = await instructionsOf(
			"core:task/build-side-character-context@1",
			shipped(
				"core:task/build-side-character-context",
				"adventure-voice"
			),
			{
				sideCharacter: { name: "Verity", intent: "share what she knows" },
				state: STATE,
				plan: PLAN
			}
		)
		expect(text).toContain("The Archive")
		expect(text).toContain("Address the player as Jody")
		expect(text).toContain("the cast above is complete")
	})

	it("leaves a pipeline that wires neither state nor plan exactly as it was", async () => {
		// `core:spec/chat-side-character` shares this surface and wires neither,
		// so nothing computed for the adventure may appear in its context.
		const result: any = await bindings[
			"core:task/build-side-character-context@1"
		]!(
			{
				cast: CAST,
				prompts: { systemPrompt: "Be brief." },
				sideCharacter: { name: "Verity" }
			} as any,
			ctx
		)
		expect(result.kind).toBe("ok")
		for (const key of [
			"location",
			"timeOfDay",
			"weather",
			"beats",
			"slots"
		])
			expect(Object.keys(result.value.templateContext)).not.toContain(key)
	})
})

describe("the keeper is given its vocabulary", () => {
	const keeper = (seed: string) =>
		instructionsOf(
			"core:task/build-keeper-context@1",
			shipped("core:task/build-keeper-context", seed),
			{ state: STATE, reply: "Verity looks up.", fields: FIELDS }
		)

	it("is shown the scene it is reporting on", async () => {
		// The keeper runs after the write, so the shared transcript it is
		// assembled with predates the reply: without this the state-keeper is
		// asked what a scene made true and shown every message but that scene.
		const text = await keeper("adventure-keeper")
		expect(text).toContain("Verity looks up.")
	})

	it("states each tracked value's type and bounds", async () => {
		const text = await keeper("adventure-keeper")
		expect(text).toContain("stamina: a whole number from 0 to 10")
		expect(text).toContain("hp: a whole number from 0 to 20")
		expect(text).toContain("trust: a whole number from -5 to 5")
	})

	it("spells out every enum member, which is what a 12B model guesses at", async () => {
		const text = await keeper("adventure-keeper")
		expect(text).toContain(
			"mood: one of calm, wary, afraid, angry, hopeful"
		)
		expect(text).toContain("time-of-day: one of morning, day, dusk, night")
		expect(text).toContain("weather: one of clear, fog, rain, storm, snow")
	})

	it("lists a slot the session tracks but has no value for", async () => {
		// `location` has no default, so it is ABSENT until somebody sets it —
		// and a keeper shown only the keys that have values is a keeper that
		// can never name the place. The vocabulary is the declarations.
		const text = await instructionsOf(
			"core:task/build-keeper-context@1",
			shipped("core:task/build-keeper-context", "adventure-keeper"),
			{
				state: {
					...STATE,
					slots: ADVENTURE_SLOTS.map((d) => ({
						id: d.id,
						key: d.id
							.replace(/^.*:slot\//, "")
							.replace(/@\d+$/, ""),
						type: d.type,
						appliesTo: d.appliesTo
					}))
				},
				reply: "Verity looks up."
			}
		)
		expect(text).toContain(
			"location: a short line of text, at most 120 characters"
		)
	})

	it("gives Rest and Time passes the same list", async () => {
		for (const seed of ["adventure-rest", "adventure-clock"]) {
			const text = await keeper(seed)
			expect(text, seed).toContain(
				"mood: one of calm, wary, afraid, angry, hopeful"
			)
			expect(text, seed).toContain("stamina: a whole number from 0 to 10")
		}
	})
})
