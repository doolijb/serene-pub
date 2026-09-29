/**
 * The resolution rules, pinned separately from the rendering.
 *
 * These are the decisions `buildTemplateContext` refuses to make. Each test
 * below stands for a rule that reads like a duplicate of another rule and is
 * not — the kind that survives a rewrite only if something fails when it is
 * tidied away.
 */

import { describe, it, expect } from "vitest"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"
import { buildTemplateContext } from "$lib/server/pipelines/prompt/templateContext"
import {
	CHARACTER_DETAIL as D,
	characterDetailOf
} from "$lib/server/pipelines/prompt/promptFields"

const cc = ({ character, ...over }: any = {}) => ({
	enabled: true,
	...over,
	character: {
		id: 1,
		name: "Alice",
		description: "A knight.",
		personality: "Steady.",
		...character
	}
})

const cp = (name = "Bob") => ({
	persona: { id: 1, name, description: "A traveller." }
})

const base = () => ({
	sessionCharacters: [cc()],
	sessionPersonas: [cp()],
	promptConfig: { systemPrompt: "Be brief." },
	currentCharacterId: 1
})

const cara = (over: Record<string, unknown> = {}) =>
	cc({
		...over,
		character: {
			id: 2,
			name: "Cara",
			description: "A scout.",
			personality: "Quick."
		}
	})

describe("the enabled filter", () => {
	it("names only enabled characters, but still shows a switched-off one's card", async () => {
		// The cards filter ignores `enabled`; the names filter reads it
		// (index.ts:288-306 vs :260-271). Merging them would either drop a
		// card or add a name.
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [cc(), cara({ enabled: false })]
		})
		expect(r.characterNames).toEqual(["Alice"])
		expect(r.characters.map((c) => c.name)).toEqual(["Alice", "Cara"])
	})

	it("reads no per-character visibility any more — a stray one changes nothing", async () => {
		// The per-seat switch is retired (2026-09-27); a row still carrying
		// the old column's value renders exactly as one without it.
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [cc(), cara({ visibility: "hidden" })]
		})
		expect(r.characters.map((c) => c.name)).toEqual(["Alice", "Cara"])
		expect(r.characterNames).toEqual(["Alice", "Cara"])
	})

	it("leaves out an absent field rather than carrying a null into the prompt", async () => {
		// These cards are stringified into the prompt, so `"personality": null`
		// is a line the model reads.
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [
				cc({ character: { personality: null, nickname: null } })
			]
		})
		expect(JSON.stringify(r.characters)).not.toContain("null")
	})
})

describe("characterDetail, the session's level for every non-speaker", () => {
	const two = (characterDetail?: unknown) =>
		resolveContextInput({
			...base(),
			sessionCharacters: [cc(), cara()],
			...(characterDetail === undefined ? {} : { characterDetail })
		})

	it("defaults to full: absent is exactly what every card rendered before", async () => {
		const absent = two()
		expect(absent.characters).toEqual([
			{ name: "Alice", description: "A knight.", personality: "Steady." },
			{ name: "Cara", description: "A scout.", personality: "Quick." }
		])
		expect(absent.characterNames).toEqual(["Alice", "Cara"])
		// `full`, and anything unrecognised, is the same object.
		expect(two(D.FULL)).toEqual(absent)
		expect(two("visible")).toEqual(absent)
		expect(characterDetailOf(undefined)).toBe(D.FULL)
	})

	it("brief keeps who a non-speaker is, not how they behave", async () => {
		const r = two(D.BRIEF)
		expect(r.characters).toEqual([
			{ name: "Alice", description: "A knight.", personality: "Steady." },
			{ name: "Cara", description: "A scout." }
		])
		expect(r.characterNames).toEqual(["Alice", "Cara"])
	})

	it("speaker-only drops every other card and every name, the speaker's included", async () => {
		const r = two(D.SPEAKER_ONLY)
		expect(r.characters).toEqual([
			{ name: "Alice", description: "A knight.", personality: "Steady." }
		])
		// The old *hidden* rule, kept exactly: no exception for the speaker.
		expect(r.characterNames).toEqual([])
	})

	it("never trims the speaker", async () => {
		for (const level of [D.FULL, D.BRIEF, D.SPEAKER_ONLY])
			expect(two(level).characters[0]).toEqual({
				name: "Alice",
				description: "A knight.",
				personality: "Steady."
			})
	})

	it("trims the rendered character block, level by level", async () => {
		const rendered = async (level: string) =>
			(await buildTemplateContext(two(level))).characters as string
		const full = await rendered(D.FULL)
		const brief = await rendered(D.BRIEF)
		const only = await rendered(D.SPEAKER_ONLY)
		expect(full).toContain('"personality": "Quick."')
		expect(brief).toContain('"name": "Cara"')
		expect(brief).not.toContain('"personality": "Quick."')
		expect(brief).toContain('"personality": "Steady."')
		expect(only).not.toContain("Cara")
		expect(only).toContain('"personality": "Steady."')
	})
})

describe("the scenario", () => {
	it("prefers the session's own", async () => {
		const r = resolveContextInput({
			...base(),
			sessionScenario: "At the gate.",
			sessionCharacters: [cc({ character: { scenario: "In the keep." } })]
		})
		expect(r.scenario).toBe("At the gate.")
	})

	it("falls back to the speaking character's in a one-to-one session", async () => {
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [cc({ character: { scenario: "In the keep." } })]
		})
		expect(r.scenario).toBe("In the keep.")
	})

	it("renders none at all in a group session with no scenario of its own", async () => {
		// Not a fallthrough: one member's scenario describes a situation the
		// rest of the cast is not in.
		const r = resolveContextInput({
			...base(),
			isGroup: true,
			sessionCharacters: [cc({ character: { scenario: "In the keep." } })]
		})
		expect(r.scenario).toBe("")
	})
})

describe("the prompt texts", () => {
	it("gives the character's own post-history text to both fields that want it", async () => {
		const r = resolveContextInput({
			...base(),
			promptConfig: {
				systemPrompt: "Be brief.",
				postHistoryInstructions: "Config text."
			},
			sessionCharacters: [
				cc({ character: { postHistoryInstructions: "Alice's text." } })
			]
		})
		// Top level: the character's wins over the config's.
		expect(r.texts!.postHistoryInstructions).toBe("Alice's text.")
		// Next to the seed: always the config's, never the character's.
		expect(r.texts!.promptPostHistoryInstructions).toBe("Config text.")
		expect(r.texts!.charPostHistory).toBe("Alice's text.")
	})

	it("falls back to the narrator config when there is no speaker", async () => {
		const r = resolveContextInput({
			...base(),
			currentCharacterId: null,
			promptConfig: {
				systemPrompt: "Narrate.",
				postHistoryInstructions: "Config text."
			}
		})
		expect(r.texts!.postHistoryInstructions).toBe("Config text.")
		expect(r.texts!.charPostHistory).toBeUndefined()
	})

	it("names the whole cast as the speaker in narrator mode", async () => {
		const r = resolveContextInput({
			...base(),
			currentCharacterId: null,
			sessionCharacters: [
				cc(),
				cc({
					character: { id: 2, name: "Cara", description: "A scout." }
				})
			]
		})
		expect(r.charName).toBe("Alice and Cara")
	})

	it("prefers a nickname for the speaker's name", async () => {
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [cc({ character: { nickname: "The Knight" } })]
		})
		expect(r.charName).toBe("The Knight")
	})
})

describe("the example dialogue", () => {
	const withDialogues = () => ({
		...base(),
		sessionCharacters: [
			cc({ character: { exampleDialogues: ["one", "two", "three"] } })
		]
	})

	it("is chosen by the caller and reported, so a replay reproduces it", async () => {
		// The legacy path calls `Math.random()` inside the build, which makes
		// two compiles of one turn differ with nothing in the receipt to say
		// why. Here the index is an input and an output.
		const r = resolveContextInput({
			...withDialogues(),
			pickExample: () => 2
		})
		expect(r.texts!.exampleDialogue).toBe("three")
		expect(r.exampleDialogueIndex).toBe(2)
	})

	it("clamps a chooser that points past the end rather than rendering nothing", async () => {
		const r = resolveContextInput({
			...withDialogues(),
			pickExample: () => 99
		})
		expect(r.texts!.exampleDialogue).toBe("three")
		expect(r.exampleDialogueIndex).toBe(2)
	})

	it("reports no index when the character has no examples", async () => {
		const r = resolveContextInput(base())
		expect(r.texts!.exampleDialogue).toBeUndefined()
		expect(r.exampleDialogueIndex).toBe(null)
	})

	it("is the same on two runs given the same inputs", async () => {
		const a = resolveContextInput(withDialogues())
		const b = resolveContextInput(withDialogues())
		expect(a.texts!.exampleDialogue).toBe(b.texts!.exampleDialogue)
	})
})

describe("end to end", () => {
	it("feeds straight into the context builder", async () => {
		// The two halves are separate so each can be wrong on its own; this is
		// the check that they still meet.
		const resolved = resolveContextInput({
			...base(),
			sessionScenario: "{{char}} meets {{user}}."
		})
		const ctx = await buildTemplateContext(resolved)
		// Each value arrives through its shipped layout, so these assert what
		// the layout was *given* rather than what it wrapped it in — the
		// wrapper is `variableTemplates.parity.test.ts`'s subject, not this
		// file's, and pinning it here would break this test every time a
		// heading is reworded.
		expect(ctx.scenario).toContain("Alice meets Bob.")
		expect(ctx.characterNames).toBe("Alice")
		expect(ctx.instructions).toContain("Be brief.")
		expect(ctx.characters).toContain('"name": "Alice"')
	})
})
