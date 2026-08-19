/**
 * The rebuilt template context, checked against `PromptBuilder`'s own.
 *
 * Same method as the signal extraction: run the legacy steps on a fixture, run
 * the replacement on the same inputs, and compare field by field. The fields
 * that matter most are the JSON blobs — `characters` and `personas` — because
 * the default context templates consume them as raw JSON, so a difference in
 * key order or indentation is a difference in the prompt.
 *
 * The fixture below calls the *real* legacy helpers rather than reproducing
 * what they do. An earlier version of this file hand-rolled the interpolation
 * context, and so agreed with the replacement about a context both of them had
 * got wrong. A differential test that reconstructs the thing it is differencing
 * against is only testing the reconstruction.
 */

import { describe, it, expect } from "vitest"
import { buildTemplateContext } from "./templateContext"
import { InterpolationEngine } from "$lib/server/utils/promptBuilder/InterpolationEngine"
import { attachCharacterLoreToCharacters } from "$lib/server/utils/promptBuilder/LorebookBindingUtils"
import { joinWithAnd } from "$lib/shared/utils/joinWithAnd"

/**
 * The legacy blob construction, reproduced from `index.ts:660-729`.
 *
 * `buildTemplateContext` is private and reads `this`, so it cannot be called
 * directly. Rather than exporting it — which would change the file under test —
 * the same *calls* are made here, to the same helpers, in the same order. If
 * the legacy code changes, this fixture and the replacement disagree, which is
 * the signal that matters.
 */
function legacyBlobs({
	characters,
	personas,
	characterNames,
	personaNames,
	charName,
	personaName,
	narratorName,
	chat
}: any) {
	const engine = new InterpolationEngine()
	const ctx = engine.createInterpolationContext({
		currentCharacterName: charName,
		currentPersonaName: personaName,
		additionalContext: {
			characterNames: joinWithAnd(characterNames),
			personaNames: joinWithAnd(personaNames),
			narratorName
		}
	})
	const interpolatedChars = characters.map((c: any) =>
		engine.interpolateObject(c, ctx, [
			"name",
			"nickname",
			"description",
			"personality"
		])
	)
	const interpolatedPersonas = personas.map((p: any) =>
		engine.interpolateObject(p, ctx, ["name", "description"])
	)
	return {
		characters: JSON.stringify(
			attachCharacterLoreToCharacters(interpolatedChars, [], chat),
			null,
			2
		),
		personas: JSON.stringify(
			attachCharacterLoreToCharacters(interpolatedPersonas, [], chat),
			null,
			2
		)
	}
}

const alice = {
	id: 1,
	name: "Alice",
	description: "A knight sworn to {{user}}.",
	personality: "Steady."
}
const cara = { id: 2, name: "Cara", description: "A scout." }
const bob = { id: 1, name: "Bob", description: "A traveller." }

/** The shape `attachCharacterLoreToCharacters` reads: cast plus lorebook. */
const chat = () => ({
	chatCharacters: [{ character: { ...alice } }],
	chatPersonas: [{ persona: { ...bob } }],
	lorebook: undefined
})

const base = () => ({
	characters: [alice],
	personas: [bob],
	characterNames: ["Alice"],
	personaNames: ["Bob"],
	charName: "Alice",
	personaName: "Bob"
})

describe("template context", () => {
	it("produces the same character and persona blobs as the legacy path", () => {
		// Byte-identical, because the default templates render these as raw
		// JSON: a difference in indentation is a difference in the prompt.
		const c = chat()
		const expected = legacyBlobs({ ...base(), chat: c })
		const built = buildTemplateContext({ ...base(), chat: c })

		expect(built.characters).toBe(expected.characters)
		expect(built.personas).toBe(expected.personas)
	})

	it("interpolates macros in descriptions, not just in the template", () => {
		// `{{user}}` inside a character card has to resolve before the card is
		// stringified — after that it is JSON, and Handlebars will not reach in.
		const built = buildTemplateContext(base())
		expect(built.characters).toContain("A knight sworn to Bob.")
		expect(built.characters).not.toContain("{{user}}")
	})

	it("interpolates the scenario it is given, and chooses no scenario itself", () => {
		// Which scenario wins — the chat's or the character's — is a rule with
		// a group-chat special case (index.ts:364-383). It stays upstream; this
		// builder renders the winner.
		const built = buildTemplateContext({
			...base(),
			scenario: "{{char}} meets {{user}} at the gate."
		})
		expect(built.scenario).toBe("Alice meets Bob at the gate.")
	})

	it("names only the characters it was told to name", () => {
		// `characterNames` is the visible, active subset and is passed in;
		// deriving it from the cards would name a hidden character in every
		// prompt that renders `{{characterNames}}`.
		const built = buildTemplateContext({
			...base(),
			characters: [alice, cara],
			characterNames: ["Alice"]
		})
		expect(built.characterNames).toBe("Alice")
		expect(built.characters).toContain("Cara")

		const both = buildTemplateContext({
			...base(),
			characters: [alice, cara],
			characterNames: ["Alice", "Cara"]
		})
		expect(both.characterNames).toBe("Alice and Cara")
		expect(both.personaNames).toBe("Bob")
	})

	it("exposes the narrator's configured name to the prompt texts", () => {
		// Narrator-mode configs reference `{{narratorName}}` in their own text
		// (index.ts:670-676). Losing it renders the literal handlebars into the
		// system prompt.
		const built = buildTemplateContext({
			...base(),
			narratorName: "The GM",
			texts: { instructions: "You are {{narratorName}}." }
		})
		expect(built.instructions).toBe("You are The GM.")
	})

	it("aliases char/character and user/persona, as the legacy shape does", () => {
		const built = buildTemplateContext(base())
		expect(built.char).toBe(built.character)
		expect(built.user).toBe(built.persona)
	})

	it("carries no back-reference to a builder", () => {
		// `__promptBuilderInstance` was how the infill engines reached back into
		// the builder mid-render. Its absence is the coupling being removed, not
		// a field that was forgotten — a node cannot reach back into anything.
		expect("__promptBuilderInstance" in buildTemplateContext(base())).toBe(
			false
		)
	})

	describe("the three pairs of post-history text", () => {
		it("keeps the config's instructions apart from the seed's", () => {
			// The legacy path reads `postHistoryInstructions` for the top-level
			// variable and `promptPostHistoryInstructions` for the one placed
			// next to the seed (index.ts:437 vs :444). They come from different
			// config fields; feeding one to both is the collapse this pins.
			const built = buildTemplateContext({
				...base(),
				texts: {
					postHistoryInstructions: "Top level.",
					promptPostHistoryInstructions: "Next to the seed."
				}
			})
			expect(built.postHistoryInstructions).toBe("Top level.")
			expect(built.postHistory!.instructions).toBe("Next to the seed.")
		})

		it("keeps the character's example dialogue apart from the config's", () => {
			const built = buildTemplateContext({
				...base(),
				texts: {
					exampleDialogue: "Config examples.",
					charExampleDialogue: "Alice's examples."
				}
			})
			expect(built.exampleDialogue).toBe("Config examples.")
			expect(built.postHistory!.exampleDialogue).toBe("Alice's examples.")
		})

		it("takes the speaker's own reinforcement text rather than looking it up", () => {
			// Resolved from the current character upstream. Searching the cast
			// by display name — the earlier draft here — picks the wrong card
			// the moment two characters share a nickname.
			const built = buildTemplateContext({
				...base(),
				texts: { charPostHistory: "Alice never lies." }
			})
			expect(built.postHistory!.charInstructions).toBe(
				"Alice never lies."
			)
		})

		it("reports whether there is anything to place at all", () => {
			expect(buildTemplateContext(base()).postHistory!.hasContent).toBe(
				false
			)
			// Any one of the three is enough, matching index.ts:447.
			for (const texts of [
				{ promptPostHistoryInstructions: "x" },
				{ charPostHistory: "x" },
				{ charExampleDialogue: "x" }
			])
				expect(
					buildTemplateContext({ ...base(), texts }).postHistory!
						.hasContent
				).toBe(true)
			// The *top-level* one is not one of the three: it renders where the
			// template puts it, not next to the seed.
			expect(
				buildTemplateContext({
					...base(),
					texts: { postHistoryInstructions: "x" }
				}).postHistory!.hasContent
			).toBe(false)
		})
	})

	it("an absent field renders as nothing rather than as undefined", () => {
		const built = buildTemplateContext(base())
		expect(built.exampleDialogue).toBe("")
		expect(built.postHistoryInstructions).toBe("")
		expect(built.instructions).toBe("")
	})

	it("refuses lore it cannot bind rather than dropping it", () => {
		// The bindings live on the chat's lorebook. Without a chat the entries
		// would attach to nobody and the prompt would come out short with
		// nothing to show for it.
		expect(() =>
			buildTemplateContext({
				...base(),
				characterLore: [{ id: 1, name: "x", content: "y" } as any]
			})
		).toThrow(/without a chat/)
	})

	it("attaches bound character lore to the card that owns it", () => {
		const c = {
			chatCharacters: [{ character: { ...alice } }],
			chatPersonas: [{ persona: { ...bob } }],
			lorebook: {
				id: 7,
				lorebookBindings: [{ id: 3, characterId: 1 }]
			}
		}
		const built = buildTemplateContext({
			...base(),
			chat: c,
			characterLore: [
				{
					id: 1,
					name: "Oath",
					content: "Sworn at the gate.",
					lorebookId: 7,
					lorebookBindingId: 3
				} as any
			]
		})
		expect(built.characters).toContain("extra lore")
		expect(built.characters).toContain("Sworn at the gate.")
	})
})
