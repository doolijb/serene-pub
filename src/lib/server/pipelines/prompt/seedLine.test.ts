/**
 * The seed decision, one voice at a time (R-C, 2026-09-17).
 *
 * Two nodes read this rule and neither can see the other's answer —
 * `build-template-context@1` takes the name, `process-messages@1` takes
 * whether the row exists — so what is pinned here is that the two halves come
 * from one expression. A second copy of the narrator branch beside the first
 * is exactly how they would come to disagree, and disagreeing looks like a
 * prompt that ends `Verity:` under a genre that asked for a narrator.
 *
 * The fourth case is the one that protects every install: **absent** is not a
 * default resolved somewhere, it is the character path, expression for
 * expression.
 */

import { describe, it, expect } from "vitest"
import { resolveSeedLine } from "$lib/server/pipelines/prompt/seedLine"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"
import { processMessages } from "$lib/server/pipelines/prompt/messages"
import { SEED_MESSAGE_ID } from "$lib/server/pipelines/prompt/messages"

const names = {
	characterName: "Verity",
	speakerName: "The shopkeeper",
	ownVoiceName: "The GM"
}

describe("the voice a channel declares", () => {
	it("character seeds under the speaking cast member", () => {
		expect(resolveSeedLine({ voice: "character", ...names })).toEqual({
			seed: true,
			name: "Verity"
		})
	})

	it("narrator seeds under the narrator, whoever is seated", () => {
		// ⚠ `characterName` is supplied and deliberately ignored. This is the
		// whole of what was missing: the narrator name was reachable only when
		// nobody was speaking, so a genre that narrates one channel of a cast
		// session had no way to ask for it.
		expect(resolveSeedLine({ voice: "narrator", ...names })).toEqual({
			seed: true,
			name: "The GM"
		})
	})

	it("narrator falls back to the word when no name is configured", () => {
		expect(
			resolveSeedLine({ voice: "narrator", characterName: "Verity" })
		).toEqual({ seed: true, name: "Narrator" })
	})

	it("none writes no row, and still resolves a name", () => {
		// The name is resolved whatever `seed` says, so the node that only
		// wants the name never has to know about the other half — and so a
		// caller reading one and not the other cannot produce a seed line
		// named after the wrong person.
		expect(resolveSeedLine({ voice: "none", ...names })).toEqual({
			seed: false,
			name: "Verity"
		})
	})

	it("absent is the character path", () => {
		expect(resolveSeedLine(names)).toEqual(
			resolveSeedLine({ voice: "character", ...names })
		)
	})
})

describe("the fallbacks the character path already had", () => {
	it("falls to the side character, then the narrator, then the word", () => {
		expect(resolveSeedLine({ ...names, characterName: null }).name).toBe(
			"The shopkeeper"
		)
		expect(
			resolveSeedLine({
				characterName: null,
				ownVoiceName: "The GM"
			}).name
		).toBe("The GM")
		expect(resolveSeedLine({ characterName: null }).name).toBe("Narrator")
	})

	it("keeps a cast member whose name resolves to nothing", () => {
		// `!= null`, not `||`. A seated character with an empty name is still
		// the speaker; falling through to the narrator on their behalf would
		// be a change of behaviour wearing the clothes of a tidy-up.
		expect(
			resolveSeedLine({ ...names, characterName: "" }).name
		).toBe("")
	})
})

describe("both halves, read by the two nodes that read them", () => {
	const cast = {
		sessionCharacters: [
			{
				enabled: true,
				character: { id: 1, name: "Verity", description: "A writer." }
			}
		],
		sessionPersonas: [
			{ persona: { id: 2, name: "Bob", description: "A reader." } }
		],
		promptConfig: {},
		currentCharacterId: 1,
		narratorName: "The GM"
	}

	const seedOf = (turnChannelVoice?: any) =>
		processMessages({
			messages: [],
			cast: {},
			charName: "Verity",
			personaName: "Bob",
			seedName: resolveContextInput({ ...cast, turnChannelVoice })
				.seedName,
			turnChannelVoice
		}).messages.find((m) => m.id === SEED_MESSAGE_ID)

	it("puts the narrator on the line for a narrator channel", () => {
		expect(seedOf("narrator")).toMatchObject({ name: "The GM" })
	})

	it("puts the speaker on it for a character channel, and for none declared", () => {
		expect(seedOf("character")).toMatchObject({ name: "Verity" })
		expect(seedOf(undefined)).toMatchObject({ name: "Verity" })
	})

	it("writes no line at all for a channel with no voice", () => {
		expect(seedOf("none")).toBeUndefined()
	})
})

/**
 * The pipeline's own voice, named (lair re-plan R5): a turn nobody speaks
 * seeds under the genre's fallback envoy — the Lair's Castellan — before the
 * prompt's narrator name, by the one rule (`ownVoiceName`) the page and the
 * transcript read too.
 */
describe("the own voice's name (R5)", () => {
	const base = {
		sessionCharacters: [
			{
				enabled: true,
				character: { id: 1, name: "Brannoc", description: "A delver." }
			}
		],
		sessionPersonas: [],
		promptConfig: {},
		// A narrator turn: nobody in the cast is speaking.
		currentCharacterId: null,
		narratorName: "Narrator"
	}
	const steward = { slug: "steward", name: { en: "Steward" }, fallback: true }

	it("a genre that declares a fallback envoy seeds under it, seated or only declared", () => {
		expect(
			resolveContextInput({ ...base, declaredEnvoys: [steward] } as any).seedName
		).toBe("Steward")
		expect(
			resolveContextInput({ ...base, envoys: [steward] } as any).seedName
		).toBe("Steward")
		// A narrator-voice channel too, whoever is seated.
		expect(
			resolveContextInput({
				...base,
				currentCharacterId: 1,
				turnChannelVoice: "narrator",
				declaredEnvoys: [steward]
			} as any).seedName
		).toBe("Steward")
	})

	it("a genre without one keeps the narrator name, and a speaker keeps theirs", () => {
		expect(resolveContextInput(base as any).seedName).toBe("Narrator")
		expect(
			resolveContextInput({
				...base,
				declaredEnvoys: [{ ...steward, fallback: false }]
			} as any).seedName
		).toBe("Narrator")
		expect(
			resolveContextInput({
				...base,
				currentCharacterId: 1,
				declaredEnvoys: [steward]
			} as any).seedName
		).toBe("Brannoc")
	})
})
