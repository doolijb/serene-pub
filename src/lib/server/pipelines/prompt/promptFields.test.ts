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
import { SessionCharacterVisibility as V } from "$lib/shared/constants/SessionCharacterVisibility"

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
	sessionCharacters: [cc()],
	sessionPersonas: [cp()],
	promptConfig: { systemPrompt: "Be brief." },
	currentCharacterId: 1
})

describe("the two visibility filters", () => {
	it("names only active characters, but still shows an inactive one's card", async () => {
		// The cards filter checks visibility; the names filter checks active
		// *and* visibility (index.ts:288-306 vs :260-271). Merging them would
		// either drop a card or add a name.
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [
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

	it("shows the speaker's card even when they are hidden, without naming them", async () => {
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [cc({ visibility: V.HIDDEN })]
		})
		expect(r.characters.map((c) => c.name)).toEqual(["Alice"])
		expect(r.characterNames).toEqual([])
	})

	it("drops a hidden character who is not the speaker", async () => {
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [
				cc(),
				cc({
					visibility: V.HIDDEN,
					character: { id: 2, name: "Cara", description: "A scout." }
				})
			]
		})
		expect(r.characters.map((c) => c.name)).toEqual(["Alice"])
	})

	it("a minimal character shows who they are, not how they behave", async () => {
		const r = resolveContextInput({
			...base(),
			currentCharacterId: 9,
			sessionCharacters: [cc({ visibility: V.MINIMAL })]
		})
		expect(r.characters[0].description).toBe("A knight.")
		expect("personality" in r.characters[0]).toBe(false)
	})

	it("the speaker is always shown in full, whatever their configured visibility", async () => {
		const r = resolveContextInput({
			...base(),
			sessionCharacters: [cc({ visibility: V.MINIMAL })]
		})
		expect(r.characters[0].personality).toBe("Steady.")
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
