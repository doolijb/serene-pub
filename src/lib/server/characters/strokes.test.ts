import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import type { Stroke } from "@serene-pub/sdk"
import {
	applyStrokesToCard,
	strokeCompiledText,
	strokesRefusal,
	StrokesRefused
} from "./strokes"
import {
	mergeStrokeBook,
	planCardImport,
	serenepubStrokesAndDowry
} from "./cardIO"

// Strokes are paused (`strokesFlag.ts`, owner 2026-10-11): the stroke
// behaviour runs with the flag ON; the "strokes paused" block turns it OFF.
const strokesFlag = vi.hoisted(() => ({ on: true }))
vi.mock("$lib/shared/characters/strokesFlag", () => ({
	get STROKES_ENABLED() {
		return strokesFlag.on
	}
}))

const always = { mode: "always" } as const
const strokes: Stroke[] = [
	{ kind: "description", text: "A tall woman.", when: always },
	{ kind: "personality", label: "Mood", text: "wry", when: always },
	{ kind: "description", label: "Eyes", text: "grey", when: always },
	{ kind: "personality", text: "patient", when: { mode: "off" } },
	{
		kind: "personality",
		label: "Fear",
		text: "the sea",
		when: { mode: "keywords", keys: ["ship"] }
	}
]

describe("applyStrokesToCard", () => {
	test("absent strokes leave the fields alone", () => {
		const fields = { description: "prose", personality: "p" }
		expect(applyStrokesToCard(fields)).toBe(fields)
	})

	test("empty strokes are the legacy shape — prose is the truth", () => {
		const fields = { strokes: [], description: "prose", personality: null }
		expect(applyStrokesToCard(fields)).toEqual(fields)
	})

	test("null strokes read as empty", () => {
		expect(
			applyStrokesToCard({ strokes: null, description: "prose" })
		).toEqual({ strokes: [], description: "prose" })
	})

	test("strokes compile into the prose columns, overwriting sent prose", () => {
		const out = applyStrokesToCard({
			strokes,
			description: "stale",
			personality: "stale",
			name: "Ada"
		})
		expect(out.description).toBe("A tall woman.\n\nEyes: grey")
		// `off` never compiles; keyword strokes do in the cached column.
		expect(out.personality).toBe("Mood: wry; Fear: the sea")
		expect(out.name).toBe("Ada")
		expect(out.strokes).toBe(strokes)
	})

	test("no description stroke → empty description (the column is NOT NULL)", () => {
		const out = applyStrokesToCard({
			strokes: [{ kind: "personality", text: "calm", when: always }]
		})
		expect(out.description).toBe("")
		expect(out.personality).toBe("calm")
	})

	test("no personality stroke → null personality", () => {
		const out = applyStrokesToCard({
			strokes: [{ kind: "description", text: "x", when: always }],
			personality: "old"
		})
		expect(out.personality).toBeNull()
	})

	test("a duplicate slug is refused with a sentence", () => {
		const bad: Stroke[] = [
			{ kind: "description", slug: "eyes", text: "a", when: always },
			{ kind: "description", slug: "eyes", text: "b", when: always }
		]
		expect(() => applyStrokesToCard({ strokes: bad })).toThrow(StrokesRefused)
		expect(() => applyStrokesToCard({ strokes: bad })).toThrow(
			/^Stroke 2: slug 'eyes' is already used/
		)
	})

	test("a regex key that does not compile is refused", () => {
		const bad: Stroke[] = [
			{
				kind: "description",
				text: "a",
				when: { mode: "keywords", keys: ["(open"], matchMode: "regex" }
			}
		]
		expect(strokesRefusal(bad)).toMatch(/^Stroke 1: '\(open' is not a regular expression\.$/)
	})

	test("a non-list is refused", () => {
		expect(strokesRefusal("nope")).toBe("Strokes are a list.")
	})
})

describe("strokeCompiledText", () => {
	test("labelled and bare", () => {
		expect(strokeCompiledText(strokes[1])).toBe("Mood: wry")
		expect(strokeCompiledText(strokes[0])).toBe("A tall woman.")
	})
})

describe("strokes paused (STROKES_ENABLED off)", () => {
	beforeAll(() => {
		strokesFlag.on = false
	})
	afterAll(() => {
		strokesFlag.on = true
	})

	test("applyStrokesToCard passes prose through and clears strokes when prose is written", () => {
		expect(
			applyStrokesToCard({ strokes, description: "As typed.", personality: "Calm." })
		).toEqual({ description: "As typed.", personality: "Calm.", strokes: [] })
		expect(applyStrokesToCard({ description: "Only prose." })).toEqual({
			description: "Only prose.",
			strokes: []
		})
	})

	test("applyStrokesToCard drops strokes sent without prose, and never refuses", () => {
		const bad = [{ kind: "nope" }] as unknown as Stroke[]
		expect(applyStrokesToCard({ strokes: bad })).toEqual({})
	})

	test("planCardImport ignores serenepub.strokes and holds a plain book", () => {
		const plan = planCardImport({
			description: "Prose as written.",
			personality: "Wry",
			extensions: { serenepub: { strokes }, other: { a: 1 } },
			character_book: {
				name: "Plain",
				entries: [{ keys: ["satchel"], content: "Letters.", enabled: true }]
			}
		})
		expect(plan.fields).toEqual({
			strokes: [],
			description: "Prose as written.",
			personality: "Wry",
			extensions: { other: { a: 1 } }
		})
		expect(plan.book).toBe("held")
		expect((plan.heldBook as any).entries).toHaveLength(1)
		expect(plan.summary).toEqual([])
	})

	test("planCardImport keeps a plain book whole and held when the card has no strokes", () => {
		const plan = planCardImport({
			description: "A courier.",
			character_book: {
				entries: [{ keys: ["satchel"], content: "Letters.", enabled: true }]
			}
		})
		expect(plan.book).toBe("held")
		expect(plan.fields.strokes).toEqual([])
		expect(plan.summary).toEqual([])
	})

	test("export adds no stroke entries and no serenepub.strokes", () => {
		const book = { name: "Own", entries: [{ id: 1, keys: ["a"], content: "A." }] }
		expect(mergeStrokeBook(book, strokes, "Card")).toBe(book)
		expect(mergeStrokeBook(undefined, strokes, "Card")).toBeUndefined()
		expect(serenepubStrokesAndDowry(strokes, null)).toEqual({})
	})
})
