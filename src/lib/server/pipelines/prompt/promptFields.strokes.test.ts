/**
 * Card strokes in the card (DESIGN-card-strokes A.4): `compileCharacter` reads
 * a card painted in strokes, and a card with none is exactly what it was.
 */

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest"

// Strokes are paused (`strokesFlag.ts`, owner 2026-10-11): ON while this file
// loads (the characters layout reads it once, at import) and for the stroke
// cases; the "strokes paused" block turns it OFF for `compileCharacter`.
const strokesFlag = vi.hoisted(() => ({ on: true }))
vi.mock("$lib/shared/characters/strokesFlag", () => ({
	get STROKES_ENABLED() {
		return strokesFlag.on
	}
}))
import { resolveStrokes, type Stroke } from "@serene-pub/sdk"
import {
	CHARACTER_DETAIL as D,
	compileCharacter,
	resolveContextInput
} from "$lib/server/pipelines/prompt/promptFields"
import { buildTemplateContext } from "$lib/server/pipelines/prompt/templateContext"

const alice = {
	id: 1,
	name: "Alice",
	description: "A knight.",
	personality: "Steady."
}

const STROKES: Stroke[] = [
	{ kind: "description", text: "A knight of the ash road.", when: { mode: "always" } },
	{
		kind: "description",
		slug: "debt",
		text: "She owes the ferryman a life.",
		when: { mode: "keywords", keys: ["ferry"] }
	},
	{ kind: "description", text: "Hidden.", when: { mode: "off" } },
	{ kind: "personality", label: "Temper", text: "slow to anger", when: { mode: "always" } },
	{
		kind: "personality",
		label: "Fear",
		text: "deep water",
		when: { mode: "keywords", keys: ["river"] }
	}
]

/** Resolved as `core:task/card-strokes@1` would: `ferry` said, `river` not. */
const resolved = () =>
	resolveStrokes(STROKES, (when) => when.keys.includes("ferry"))

describe("a card with no strokes", () => {
	it("is the four-field card it always was", () => {
		for (const strokes of [undefined, null, []])
			expect(compileCharacter({ ...alice, strokes } as any, D.FULL)).toEqual({
				name: "Alice",
				description: "A knight.",
				personality: "Steady."
			})
		expect(compileCharacter(alice, D.BRIEF)).toEqual({
			name: "Alice",
			description: "A knight."
		})
	})
})

describe("a card painted in strokes", () => {
	it("before any step ran, compiles every enabled stroke — keyword ones included — and carries no pieces", () => {
		const card = compileCharacter({ ...alice, strokes: STROKES }, D.FULL)
		expect(card).toEqual({
			name: "Alice",
			description: "A knight of the ash road.\n\nShe owes the ferryman a life.",
			personality: "Temper: slow to anger; Fear: deep water"
		})
	})

	it("once resolved, compiles always + fired only, and carries the fired pieces in order", () => {
		const card = compileCharacter({ ...alice, strokes: resolved() }, D.FULL)
		expect(card).toEqual({
			name: "Alice",
			description: "A knight of the ash road.\n\nShe owes the ferryman a life.",
			personality: "Temper: slow to anger",
			strokes: [
				{ kind: "description", text: "A knight of the ash road.", fired: true },
				{
					kind: "description",
					slug: "debt",
					text: "She owes the ferryman a life.",
					fired: true
				},
				{ kind: "personality", label: "Temper", text: "slow to anger", fired: true }
			]
		})
		// Field order is constant: the pieces come last.
		expect(Object.keys(card!)).toEqual([
			"name",
			"description",
			"personality",
			"strokes"
		])
	})

	it("drops an unfired keyword stroke, and the field when nothing of its kind fired", () => {
		const none = resolveStrokes(STROKES, () => false)
		const card = compileCharacter(
			{ ...alice, strokes: none.filter((s) => s.kind === "personality") },
			D.FULL
		)
		// Only personality strokes, none of them always-on but Temper.
		expect(card).toEqual({
			name: "Alice",
			description: "A knight.",
			personality: "Temper: slow to anger",
			strokes: [
				{ kind: "personality", label: "Temper", text: "slow to anger", fired: true }
			]
		})
		const keywordOnly = resolveStrokes(
			[STROKES[1]!, STROKES[4]!],
			() => false
		)
		expect(compileCharacter({ ...alice, strokes: keywordOnly }, D.FULL)).toEqual({
			name: "Alice",
			strokes: []
		})
	})

	it("keeps a kind with no strokes on its column", () => {
		const descOnly = resolveStrokes([STROKES[0]!], () => false)
		expect(compileCharacter({ ...alice, strokes: descOnly }, D.FULL)).toEqual({
			name: "Alice",
			description: "A knight of the ash road.",
			personality: "Steady.",
			strokes: [
				{ kind: "description", text: "A knight of the ash road.", fired: true }
			]
		})
	})

	it("brief drops personality strokes as it drops the field", () => {
		const card = compileCharacter({ ...alice, strokes: resolved() }, D.BRIEF)
		expect(card).toEqual({
			name: "Alice",
			description: "A knight of the ash road.\n\nShe owes the ferryman a life.",
			strokes: [
				{ kind: "description", text: "A knight of the ash road.", fired: true },
				{
					kind: "description",
					slug: "debt",
					text: "She owes the ferryman a life.",
					fired: true
				}
			]
		})
	})

	it("compiles a labelled personality PList-shaped, an unlabelled one by line", () => {
		const plist = resolveStrokes(
			[
				{ kind: "personality", label: "Eyes", text: "green", when: { mode: "always" } },
				{ kind: "personality", label: "Voice", text: "low", when: { mode: "always" } }
			],
			() => false
		)
		expect(
			compileCharacter({ ...alice, strokes: plist }, D.FULL)!.personality
		).toBe("Eyes: green; Voice: low")
		const lines = resolveStrokes(
			[
				{ kind: "personality", text: "Calm.", when: { mode: "always" } },
				{ kind: "personality", text: "Kind.", when: { mode: "always" } }
			],
			() => false
		)
		expect(
			compileCharacter({ ...alice, strokes: lines }, D.FULL)!.personality
		).toBe("Calm.\nKind.")
	})
})

describe("the rendered characters block", () => {
	const ctx = (strokes: unknown) =>
		resolveContextInput({
			sessionCharacters: [{ enabled: true, character: { ...alice, strokes } as any }],
			sessionPersonas: [],
			promptConfig: {},
			currentCharacterId: 1
		})

	/** The JSON inside the shipped heading and fence. */
	const body = (s: string) => s.slice(s.indexOf("["), s.lastIndexOf("]") + 1)

	it("renders a stroked field as its list — labelled pieces as objects — and never the pieces array", async () => {
		const rendered = (await buildTemplateContext(ctx(resolved())))
			.characters as string
		expect(JSON.parse(body(rendered))).toEqual([
			{
				name: "Alice",
				description: ["A knight of the ash road.", "She owes the ferryman a life."],
				personality: [{ Temper: "slow to anger" }]
			}
		])
		expect(rendered).not.toContain('"strokes"')
		expect(rendered).not.toContain('"fired"')
	})

	it("renders a card with no strokes byte for byte as before", async () => {
		const plain = (await buildTemplateContext(ctx(undefined)))
			.characters as string
		expect(body(plain)).toBe(
			JSON.stringify(
				[{ name: "Alice", description: "A knight.", personality: "Steady." }],
				null,
				2
			)
		)
	})
})

describe("strokes paused (STROKES_ENABLED off)", () => {
	beforeAll(() => {
		strokesFlag.on = false
	})
	afterAll(() => {
		strokesFlag.on = true
	})

	it("reads the prose columns, never a compile of stored or resolved strokes", () => {
		for (const strokes of [STROKES, resolved()])
			expect(compileCharacter({ ...alice, strokes } as any, D.FULL)).toEqual({
				name: "Alice",
				description: "A knight.",
				personality: "Steady."
			})
	})
})
