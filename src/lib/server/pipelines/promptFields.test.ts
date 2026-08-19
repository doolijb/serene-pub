/**
 * The resolution rules, pinned separately from the rendering.
 *
 * These are the decisions `buildTemplateContext` refuses to make. Each test
 * below stands for a rule that reads like a duplicate of another rule and is
 * not — the kind that survives a rewrite only if something fails when it is
 * tidied away.
 */

import { describe, it, expect } from "vitest"
import { resolveContextInput } from "./promptFields"
import { buildTemplateContext } from "./templateContext"
import { ChatCharacterVisibility as V } from "$lib/shared/constants/ChatCharacterVisibility"

const cc = ({ character, ...over }: any = {}) => ({
	isActive: true,
	visibility: V.VISIBLE,
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
	chatCharacters: [cc()],
	chatPersonas: [cp()],
	promptConfig: { systemPrompt: "Be brief." },
	currentCharacterId: 1
})

describe("the two visibility filters", () => {
	it("names only active characters, but still shows an inactive one's card", () => {
		// The cards filter checks visibility; the names filter checks active
		// *and* visibility (index.ts:288-306 vs :260-271). Merging them would
		// either drop a card or add a name.
		const r = resolveContextInput({
			...base(),
			chatCharacters: [
				cc(),
				cc({
					isActive: false,
					character: { id: 2, name: "Cara", description: "A scout." }
				})
			]
		})
		expect(r.characterNames).toEqual(["Alice"])
		expect(r.characters.map((c) => c.name)).toEqual(["Alice", "Cara"])
	})

	it("shows the speaker's card even when they are hidden, without naming them", () => {
		const r = resolveContextInput({
			...base(),
			chatCharacters: [cc({ visibility: V.HIDDEN })]
		})
		expect(r.characters.map((c) => c.name)).toEqual(["Alice"])
		expect(r.characterNames).toEqual([])
	})

	it("drops a hidden character who is not the speaker", () => {
		const r = resolveContextInput({
			...base(),
			chatCharacters: [
				cc(),
				cc({
					visibility: V.HIDDEN,
					character: { id: 2, name: "Cara", description: "A scout." }
				})
			]
		})
		expect(r.characters.map((c) => c.name)).toEqual(["Alice"])
	})

	it("a minimal character shows who they are, not how they behave", () => {
		const r = resolveContextInput({
			...base(),
			currentCharacterId: 9,
			chatCharacters: [cc({ visibility: V.MINIMAL })]
		})
		expect(r.characters[0].description).toBe("A knight.")
		expect("personality" in r.characters[0]).toBe(false)
	})

	it("the speaker is always shown in full, whatever their configured visibility", () => {
		const r = resolveContextInput({
			...base(),
			chatCharacters: [cc({ visibility: V.MINIMAL })]
		})
		expect(r.characters[0].personality).toBe("Steady.")
	})

	it("leaves out an absent field rather than carrying a null into the prompt", () => {
		// These cards are stringified into the prompt, so `"personality": null`
		// is a line the model reads.
		const r = resolveContextInput({
			...base(),
			chatCharacters: [
				cc({ character: { personality: null, nickname: null } })
			]
		})
		expect(JSON.stringify(r.characters)).not.toContain("null")
	})
})

describe("the scenario", () => {
	it("prefers the chat's own", () => {
		const r = resolveContextInput({
			...base(),
			chatScenario: "At the gate.",
			chatCharacters: [cc({ character: { scenario: "In the keep." } })]
		})
		expect(r.scenario).toBe("At the gate.")
	})

	it("falls back to the speaking character's in a one-to-one chat", () => {
		const r = resolveContextInput({
			...base(),
			chatCharacters: [cc({ character: { scenario: "In the keep." } })]
		})
		expect(r.scenario).toBe("In the keep.")
	})

	it("renders none at all in a group chat with no scenario of its own", () => {
		// Not a fallthrough: one member's scenario describes a situation the
		// rest of the cast is not in.
		const r = resolveContextInput({
			...base(),
			isGroup: true,
			chatCharacters: [cc({ character: { scenario: "In the keep." } })]
		})
		expect(r.scenario).toBe("")
	})
})

describe("the prompt texts", () => {
	it("gives the character's own post-history text to both fields that want it", () => {
		const r = resolveContextInput({
			...base(),
			promptConfig: {
				systemPrompt: "Be brief.",
				postHistoryInstructions: "Config text."
			},
			chatCharacters: [
				cc({ character: { postHistoryInstructions: "Alice's text." } })
			]
		})
		// Top level: the character's wins over the config's.
		expect(r.texts!.postHistoryInstructions).toBe("Alice's text.")
		// Next to the seed: always the config's, never the character's.
		expect(r.texts!.promptPostHistoryInstructions).toBe("Config text.")
		expect(r.texts!.charPostHistory).toBe("Alice's text.")
	})

	it("falls back to the narrator config when there is no speaker", () => {
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

	it("names the whole cast as the speaker in narrator mode", () => {
		const r = resolveContextInput({
			...base(),
			currentCharacterId: null,
			chatCharacters: [
				cc(),
				cc({
					character: { id: 2, name: "Cara", description: "A scout." }
				})
			]
		})
		expect(r.charName).toBe("Alice and Cara")
	})

	it("prefers a nickname for the speaker's name", () => {
		const r = resolveContextInput({
			...base(),
			chatCharacters: [cc({ character: { nickname: "The Knight" } })]
		})
		expect(r.charName).toBe("The Knight")
	})
})

describe("the example dialogue", () => {
	const withDialogues = () => ({
		...base(),
		chatCharacters: [
			cc({ character: { exampleDialogues: ["one", "two", "three"] } })
		]
	})

	it("is chosen by the caller and reported, so a replay reproduces it", () => {
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

	it("clamps a chooser that points past the end rather than rendering nothing", () => {
		const r = resolveContextInput({
			...withDialogues(),
			pickExample: () => 99
		})
		expect(r.texts!.exampleDialogue).toBe("three")
		expect(r.exampleDialogueIndex).toBe(2)
	})

	it("reports no index when the character has no examples", () => {
		const r = resolveContextInput(base())
		expect(r.texts!.exampleDialogue).toBeUndefined()
		expect(r.exampleDialogueIndex).toBe(null)
	})

	it("is the same on two runs given the same inputs", () => {
		const a = resolveContextInput(withDialogues())
		const b = resolveContextInput(withDialogues())
		expect(a.texts!.exampleDialogue).toBe(b.texts!.exampleDialogue)
	})
})

describe("end to end", () => {
	it("feeds straight into the context builder", () => {
		// The two halves are separate so each can be wrong on its own; this is
		// the check that they still meet.
		const resolved = resolveContextInput({
			...base(),
			chatScenario: "{{char}} meets {{user}}."
		})
		const ctx = buildTemplateContext(resolved)
		expect(ctx.scenario).toBe("Alice meets Bob.")
		expect(ctx.characterNames).toBe("Alice")
		expect(ctx.instructions).toBe("Be brief.")
		expect(JSON.parse(ctx.characters as string)[0].name).toBe("Alice")
	})
})
