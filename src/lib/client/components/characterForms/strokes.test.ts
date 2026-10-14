import { afterEach, describe, expect, test, vi } from "vitest"
import type { Stroke, StrokeWhen } from "@serene-pub/sdk"

// Strokes are paused (`strokesFlag.ts`, owner 2026-10-11): the stroke
// arithmetic runs with the flag ON; `characterForSave` is checked both ways.
const strokesFlag = vi.hoisted(() => ({ on: true }))
vi.mock("$lib/shared/characters/strokesFlag", () => ({
	get STROKES_ENABLED() {
		return strokesFlag.on
	}
}))

import {
	backToOneText,
	characterForSave,
	findingsByStroke,
	offStrokeCount,
	strokeFindings,
	strokesForSave,
	strokesOfKind,
	strokeWithLabel,
	tokenLabel,
	uniqueSlug,
	whenChipText,
	whenSwitched,
	withKindStarted,
	withSplitApplied,
	withStrokeAdded,
	withStrokeDroppedAt,
	withStrokeDuplicated,
	withStrokeMoved,
	withStrokeRemoved
} from "./strokes"

const always = { mode: "always" } as const
const d = (text: string, extra: Partial<Stroke> = {}): Stroke => ({ kind: "description", text, when: always, ...extra })
const p = (text: string, extra: Partial<Stroke> = {}): Stroke => ({ kind: "personality", text, when: always, ...extra })
const texts = (all: Stroke[]) => all.map((s) => `${s.kind[0]}:${s.text}`)

describe("strokes of one kind inside the card's one list", () => {
	const card = [d("a"), p("x"), d("b"), p("y"), d("c")]

	test("strokesOfKind keeps whole-list indexes", () => {
		expect(strokesOfKind(card, "description").map((k) => k.index)).toEqual([0, 2, 4])
		expect(strokesOfKind(card, "personality").map((k) => k.index)).toEqual([1, 3])
	})

	test("add lands after the kind's last stroke, or at the end", () => {
		expect(texts(withStrokeAdded(card, p("z")))).toEqual(["d:a", "p:x", "d:b", "p:y", "p:z", "d:c"])
		expect(texts(withStrokeAdded([d("a")], p("z")))).toEqual(["d:a", "p:z"])
	})

	test("move swaps with the neighbour of the same kind; the other kind stays put", () => {
		expect(texts(withStrokeMoved(card, 2, -1))).toEqual(["d:b", "p:x", "d:a", "p:y", "d:c"])
		expect(texts(withStrokeMoved(card, 2, 1))).toEqual(["d:a", "p:x", "d:c", "p:y", "d:b"])
		expect(texts(withStrokeMoved(card, 0, -1))).toEqual(texts(card))
		expect(texts(withStrokeMoved(card, 3, 1))).toEqual(texts(card))
	})

	test("drop shifts the kind's strokes between; other kinds keep their slots", () => {
		expect(texts(withStrokeDroppedAt(card, 4, 0))).toEqual(["d:c", "p:x", "d:a", "p:y", "d:b"])
		expect(texts(withStrokeDroppedAt(card, 0, 1))).toEqual(texts(card))
	})

	test("remove and duplicate (slug made unique)", () => {
		expect(texts(withStrokeRemoved(card, 1))).toEqual(["d:a", "d:b", "p:y", "d:c"])
		const dup = withStrokeDuplicated([d("green", { slug: "eyes", label: "Eyes" })], 0)
		expect(dup.map((s) => s.slug)).toEqual(["eyes", "eyes-2"])
		expect(dup[1].label).toBe("Eyes")
		dup[1].when = { mode: "off" }
		expect(dup[0].when.mode).toBe("always")
	})

	test("does not mutate its input", () => {
		const before = JSON.stringify(card)
		withStrokeMoved(card, 2, -1)
		withStrokeRemoved(card, 0)
		withStrokeDuplicated(card, 0)
		expect(JSON.stringify(card)).toBe(before)
	})
})

describe("labels and slugs", () => {
	test("the slug follows the label until someone sets it", () => {
		const all = [d("green")]
		const labelled = strokeWithLabel(all, 0, "Eye colour")
		expect(labelled.slug).toBe("eye-colour")
		const relabelled = strokeWithLabel([labelled], 0, "Eyes")
		expect(relabelled.slug).toBe("eyes")
		const own = strokeWithLabel([{ ...labelled, slug: "my-eyes" }], 0, "Eyes")
		expect(own.slug).toBe("my-eyes")
		const cleared = strokeWithLabel([relabelled], 0, "")
		expect(cleared.slug).toBeUndefined()
		expect(cleared.label).toBeUndefined()
	})

	test("an auto slug avoids the card's other slugs", () => {
		const all = [d("x", { slug: "eyes" }), d("y")]
		expect(strokeWithLabel(all, 1, "Eyes").slug).toBe("eyes-2")
		expect(uniqueSlug("a", new Set(["a", "a-2"]))).toBe("a-3")
	})
})

describe("when", () => {
	test("switching keeps keyword settings, chip says the count", () => {
		const kw = whenSwitched({ mode: "always" }, "keywords")
		expect(kw).toEqual({ mode: "keywords", keys: [], matchMode: "substring", caseSensitive: false })
		const held: StrokeWhen = { mode: "keywords", keys: ["sea"], matchMode: "word" }
		expect(whenSwitched(held, "keywords")).toBe(held)
		expect(whenSwitched(held, "off")).toEqual({ mode: "off" })
		expect(whenChipText(held)).toBe("Keywords 1")
		expect(whenChipText({ mode: "off" })).toBe("Off")
		expect(whenChipText({ mode: "always" })).toBe("Always")
	})
})

describe("findings", () => {
	test("filed under the stroke and field they name", () => {
		const map = findingsByStroke([
			{ path: "strokes[2].slug", message: "slug 'a' is already used" },
			{ path: "strokes[2].when.keys[0]", message: "a key is non-empty text" },
			{ path: "strokes", message: "too many" }
		])
		expect(map.get(2)).toEqual([
			{ field: "slug", message: "Slug 'a' is already used." },
			{ field: "when", message: "A key is non-empty text." }
		])
		expect(map.get(-1)?.[0].field).toBe("stroke")
	})

	test("a duplicate slug is found on the second stroke", () => {
		const map = strokeFindings([d("a", { slug: "eyes" }), p("b", { slug: "eyes" })])
		expect(map.get(1)?.[0].field).toBe("slug")
		expect(map.has(0)).toBe(false)
	})
})

describe("the card as a whole", () => {
	test("tokens label", () => {
		expect(tokenLabel(12, "llama-3")).toBe("≈ 12 tokens (llama-3)")
		expect(tokenLabel(1, null)).toBe("≈ 1 token (estimate)")
		expect(tokenLabel(5)).toBe("≈ 5 tokens")
	})

	test("save folds a never-split field into one stroke, appended", () => {
		const all = [d("a"), d("b")]
		const sent = strokesForSave(all, { description: "ignored", personality: "  Shy.  " })
		expect(texts(sent)).toEqual(["d:a", "d:b", "p:Shy."])
		expect(strokesForSave([], { description: "x", personality: "y" })).toEqual([])
	})

	test("starting a kind keeps its prose as the first stroke", () => {
		expect(texts(withKindStarted([d("a")], "personality", "Shy."))).toEqual(["d:a", "p:Shy.", "p:"])
		expect(texts(withKindStarted([d("a")], "personality", " "))).toEqual(["d:a", "p:"])
	})

	test("split replaces only its kind", () => {
		const out = withSplitApplied([p("x")], "description", [d("1"), d("2")])
		expect(texts(out)).toEqual(["p:x", "d:1", "d:2"])
	})

	test("back to one text compiles each kind and clears strokes", () => {
		const all = [d("Tall."), d("Old.", { label: "Age" }), d("gone", { when: { mode: "off" } })]
		const out = backToOneText(all, { description: "", personality: "Kept." })
		expect(out).toEqual({ description: "Tall.\n\nAge: Old.", personality: "Kept.", strokes: [] })
		expect(offStrokeCount(all)).toBe(1)
	})
})

describe("characterForSave — what the form sends", () => {
	afterEach(() => {
		strokesFlag.on = true
	})
	const draft = {
		name: "Ada",
		description: "As typed.",
		personality: "Calm.",
		strokes: [{ kind: "description", text: "A knight.", when: { mode: "always" } }] as Stroke[]
	}

	test("strokes paused: no strokes key, the prose as typed", () => {
		strokesFlag.on = false
		const sent = characterForSave(draft)
		expect("strokes" in sent).toBe(false)
		expect(sent).toEqual({ name: "Ada", description: "As typed.", personality: "Calm." })
		expect("strokes" in characterForSave({ ...draft, strokes: [] })).toBe(false)
	})

	test("strokes on: the draft's strokes, a never-split field folded in", () => {
		expect(characterForSave(draft).strokes).toEqual([
			{ kind: "description", text: "A knight.", when: { mode: "always" } },
			{ kind: "personality", text: "Calm.", when: { mode: "always" } }
		])
	})
})
