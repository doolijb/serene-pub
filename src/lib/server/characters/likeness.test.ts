/**
 * 🚧 Likeness (DESIGN-image-generation §5): the pure rules, the card round
 * trip (export → import keeps all three fields), SillyTavern's
 * `sd_character_prompt` read in one direction, and the prompt path's macros
 * and `core:var/likenesses@1`.
 */
import { describe, it, expect } from "vitest"
import {
	likenessFromCardExtensions,
	likenessOf,
	readLikeness,
	sanitizeLikeness,
	withLikeness
} from "$lib/server/characters/likeness"
import { buildCharacterCardV3 } from "$lib/server/utils/characterCardParser"
import { planCardImport } from "$lib/server/characters/cardIO"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"
import { buildTemplateContext } from "$lib/server/pipelines/prompt/templateContext"
import { getVariable } from "@serene-pub/sdk"
import { objectLayoutSource } from "$lib/server/pipelines/entities/objectVariableLayouts"
import { CORE_TEMPLATE_ENGINE } from "$lib/shared/pipelines/templateEngines"

const LIKENESS = {
	imageMediaId: 42,
	prompt: "adult woman, red braid, green cloak, freckles",
	negative: "glasses, beard"
}

describe("likenessOf", () => {
	it("falls back to the avatar when the card names no likeness image", () => {
		const l = likenessOf({
			avatarMediaId: 7,
			extensions: { serenepub: { likeness: { prompt: "tall" } } }
		})
		expect(l).toEqual({
			imageMediaId: 7,
			imageIsAvatar: true,
			prompt: "tall",
			negative: ""
		})
	})

	it("prefers its own image over the avatar", () => {
		const l = likenessOf({
			avatarMediaId: 7,
			extensions: { serenepub: { likeness: LIKENESS } }
		})
		expect(l.imageMediaId).toBe(42)
		expect(l.imageIsAvatar).toBe(false)
		expect(l.negative).toBe("glasses, beard")
	})

	it("is empty, not absent, with neither a likeness nor an avatar", () => {
		expect(likenessOf({ extensions: {}, avatarMediaId: null })).toEqual({
			imageMediaId: null,
			imageIsAvatar: false,
			prompt: "",
			negative: ""
		})
	})

	it("treats a malformed stored likeness as none", () => {
		const l = likenessOf({
			avatarMediaId: 3,
			extensions: {
				serenepub: { likeness: { imageMediaId: "9", prompt: 5 } }
			}
		})
		expect(l).toEqual({
			imageMediaId: 3,
			imageIsAvatar: true,
			prompt: "",
			negative: ""
		})
	})
})

describe("sanitizeLikeness / withLikeness", () => {
	it("drops unknown keys, trims text and refuses bad ids", () => {
		expect(
			sanitizeLikeness({
				imageMediaId: -1,
				prompt: "  tall  ",
				negative: "",
				extra: 1
			})
		).toEqual({ prompt: "tall" })
		expect(sanitizeLikeness({ prompt: "  " })).toBeNull()
		expect(sanitizeLikeness("x")).toBeNull()
	})

	it("sets and clears without touching other keys", () => {
		const ext = { foreign: { a: 1 }, serenepub: { other: true } }
		const set = withLikeness(ext, LIKENESS)
		expect(set).toEqual({
			foreign: { a: 1 },
			serenepub: { other: true, likeness: LIKENESS }
		})
		expect(ext).toEqual({ foreign: { a: 1 }, serenepub: { other: true } })
		expect(withLikeness(set, null)).toEqual(ext)
		expect(withLikeness({ serenepub: { likeness: LIKENESS } }, null)).toEqual(
			{}
		)
	})
})

describe("the card carries the likeness", () => {
	const card = (extensions: Record<string, unknown>) =>
		buildCharacterCardV3({
			name: "Ash",
			description: "A rider.",
			uuid: "8a6e0f0e-3c55-4c43-9a0e-2f52b2f0d9a1",
			extensions
		} as any)

	it("export → import keeps all three fields", () => {
		const exported = card({ serenepub: { likeness: LIKENESS } })
		expect(exported.data.extensions.serenepub.likeness).toEqual(LIKENESS)
		const plan = planCardImport(exported.data)
		expect(readLikeness(plan.fields.extensions)).toEqual(LIKENESS)
		// And the round trip is stable: exporting the imported row again.
		const again = card(plan.fields.extensions)
		expect(again.data.extensions.serenepub.likeness).toEqual(LIKENESS)
	})

	it("exports no likeness key when the card has none", () => {
		const exported = card({})
		expect("likeness" in exported.data.extensions.serenepub).toBe(false)
	})

	it("reads SillyTavern's sd_character_prompt when ours is absent, and never writes it", () => {
		const st = {
			sd_character_prompt: { positive: "silver hair, cloak", negative: "hat" }
		}
		expect(likenessFromCardExtensions(st)).toEqual({
			prompt: "silver hair, cloak",
			negative: "hat"
		})
		const plan = planCardImport({ name: "Rell", description: "", extensions: st })
		expect(readLikeness(plan.fields.extensions)).toEqual({
			prompt: "silver hair, cloak",
			negative: "hat"
		})
		// A card exported from scratch never grows ST's key.
		const exported = card({ serenepub: { likeness: LIKENESS } })
		expect("sd_character_prompt" in exported.data.extensions).toBe(false)
	})

	it("ours wins over SillyTavern's", () => {
		expect(
			likenessFromCardExtensions({
				serenepub: { likeness: { prompt: "ours" } },
				sd_character_prompt: { positive: "theirs" }
			})
		).toEqual({ prompt: "ours" })
	})
})

describe("the likeness in the prompt", () => {
	const ash = {
		id: 1,
		name: "Ash",
		description: "A rider.",
		avatarMediaId: 5,
		extensions: {
			serenepub: { likeness: { prompt: "red braid", negative: "hat" } }
		}
	}
	const brannoc = { id: 2, name: "Brannoc", description: "A caravan master." }
	const off = {
		id: 3,
		name: "Ghost",
		description: "Switched off.",
		extensions: { serenepub: { likeness: { prompt: "pale" } } }
	}
	const rell = {
		id: 9,
		name: "Rell",
		description: "A cartographer.",
		extensions: { serenepub: { likeness: { prompt: "ink-stained hands" } } }
	}

	const resolved = () =>
		resolveContextInput({
			sessionCharacters: [
				{ character: ash as any },
				{ character: brannoc as any },
				{ enabled: false, character: off as any }
			],
			sessionPersonas: [{ persona: rell as any }],
			promptConfig: {
				systemPrompt: "Draw {{char}}: {{likeness}}. Avoid {{likenessNegative}}."
			} as any,
			currentCharacterId: 1
		})

	it("gives the speaker's likeness and everyone on stage's tag lines", () => {
		const r = resolved()
		expect(r.likeness).toEqual({ prompt: "red braid", negative: "hat" })
		expect(r.likenesses).toEqual([
			{ name: "Ash", prompt: "red braid" },
			{ name: "Brannoc", prompt: "" },
			{ name: "Rell", prompt: "ink-stained hands" }
		])
	})

	it("interpolates {{likeness}} / {{likenessNegative}} beside {{char}}", async () => {
		const ctx = await buildTemplateContext(resolved())
		expect(ctx.instructions).toContain("Draw Ash: red braid. Avoid hat.")
	})

	it("renders core:var/likenesses@1 as JSON, by its automatic layout and by the floor", async () => {
		const r = resolved()
		const expected = JSON.stringify(r.likenesses)
		// No layout selected: the floor is minified JSON.
		expect((await buildTemplateContext(r)).likenesses).toBe(expected)
		// The automatic layout core seeds for it renders the same bytes.
		const decl = getVariable("core:var/likenesses@1")
		expect(decl).toBeTruthy()
		const source = objectLayoutSource(decl!)
		expect(source).toBe("{{{json likenesses}}}")
		const viaLayout = await buildTemplateContext({
			...r,
			variables: {
				likenesses: { engine: CORE_TEMPLATE_ENGINE, source: source! }
			}
		})
		expect(viaLayout.likenesses).toBe(expected)
	})
})
