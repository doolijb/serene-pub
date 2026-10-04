/**
 * **Who a side character is, when the fact says so by reference** (plan A28
 * review, 2026-09-30) — `build-side-character-context@1`'s `speaker`
 * out-port, which the lore lane beside it reads as the voice whose private
 * lore it may take.
 *
 * A fact that names somebody by row — the `characterId` a Lair pick carries,
 * or the participant reference (`ref`) a Whodunit Answer press carries — is
 * that person. The name is a label, and never a second lookup: two suspects
 * sharing a name are two people, and a reference the cast does not seat is
 * still the person it names rather than the first card whose name matches.
 * A fact that names somebody only by name resolves by name, as it always did.
 */

import { describe, expect, it } from "vitest"
import { coreBindings } from "./bindings"

const bindings = coreBindings()

/** Two suspects called Verity, and Brask. */
const CAST = {
	sessionCharacters: [
		{ character: { id: 1, name: "Verity", description: "The archivist." }, enabled: true },
		{ character: { id: 2, name: "Verity", description: "Her twin, the forger." }, enabled: true },
		{ character: { id: 3, name: "Brask", description: "Carries the lamp." }, enabled: true }
	],
	sessionPersonas: [{ persona: { id: 9, name: "Hale", description: "The detective." } }],
	currentCharacterId: null
}

const ctx = {
	random: () => 0,
	signal: new AbortController().signal,
	progress: () => {},
	log: () => {}
} as any

async function contextFor(sideCharacter: Record<string, unknown>) {
	const result: any = await bindings["core:task/build-side-character-context@1"]!(
		{ cast: CAST, prompts: { systemPrompt: "Answer as {{char}}." }, sideCharacter } as any,
		ctx
	)
	expect(result.kind, JSON.stringify(result)).toBe("ok")
	return result.value as { speaker: unknown; templateContext: Record<string, unknown> }
}

describe("a fact that names somebody by reference is that person", () => {
	it("the second Verity, by her reference, is the second Verity — card and speaker", async () => {
		const out = await contextFor({ name: "Verity", ref: "character:2" })
		expect(out.speaker).toBe("character:2")
		expect(String(out.templateContext.characters)).toContain("Her twin, the forger.")
	})

	it("a reference the cast does not seat is still that person, never the first card whose name matches", async () => {
		const out = await contextFor({ name: "Verity", ref: "character:7" })
		expect(out.speaker).toBe("character:7")
	})

	it("a renamed card, by its reference, is still them", async () => {
		const out = await contextFor({ name: "Verity the Elder", ref: "character:1" })
		expect(out.speaker).toBe("character:1")
	})

	it("an id is the same claim as a reference", async () => {
		expect((await contextFor({ characterId: 2 })).speaker).toBe("character:2")
		expect((await contextFor({ name: "Verity", characterId: 7 })).speaker).toBe("character:7")
	})
})

describe("a fact that names somebody only by name resolves by name", () => {
	it("a name the cast holds is that member", async () => {
		expect((await contextFor({ name: "Brask" })).speaker).toBe("character:3")
	})

	it("a name the cast does not hold is nobody in the cast", async () => {
		expect((await contextFor({ name: "The innkeeper" })).speaker).toBeNull()
	})
})
